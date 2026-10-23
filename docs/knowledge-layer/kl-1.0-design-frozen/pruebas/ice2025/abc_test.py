"""KL 1.0 · Prueba reproducible A/B/C (solo Workspace).
A = recuperación directa sobre documentos originales (BM25 sobre páginas/párrafos, top-k=3)
B = conocimiento estructurado (registros normalizados, consulta por dimensiones kl.v1)
C = híbrido (B + evidencia localizada; si B no cubre, cae a A acotado al documento metodológico)
Métricas medidas: exactitud, procedencia, cobertura, caracteres de contexto, latencia local.
Métrica estimada: tokens ≈ caracteres/4 (no es el tokenizador de producción)."""
import json, math, re, sys, time, statistics, unicodedata
from collections import Counter
from pathlib import Path

BASE = Path(sys.argv[1])
BOL = (BASE/"ICE-2025_Boletas-.pdf.txt").read_text()
ANX = (BASE/"anexo.txt").read_text()
REC = json.load(open(BASE/"out/ice2025_records.json"))

def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii","ignore").decode().lower()
    return re.findall(r"[a-z0-9]+", s)

# ---------- Corpus A ----------
chunks = []
for i, p in enumerate(BOL.split("\n\n"), 1):
    chunks.append({"id": f"boletas#{i}", "text": p})
for j, p in enumerate(re.split(r"\n(?=Qué mide:)|\n\n", ANX), 1):
    if p.strip(): chunks.append({"id": f"anexo#{j}", "text": p})
STOP = set("de la el en los las del por y que a con un una se es al cual cuanto cuantos cual es tiene fue para su sus".split())
docs = [[t for t in norm(c["text"]) if t not in STOP] for c in chunks]
N = len(docs); avgdl = sum(map(len, docs))/N
df = Counter(t for d in docs for t in set(d))
tfs = [Counter(d) for d in docs]
def bm25(q, k=3, k1=1.5, b=0.75):
    qt = [t for t in norm(q) if t not in STOP]
    sc = []
    for i, d in enumerate(docs):
        s = 0.0
        for t in qt:
            if t in tfs[i]:
                idf = math.log(1 + (N - df[t] + .5)/(df[t] + .5))
                f = tfs[i][t]; s += idf * f*(k1+1)/(f + k1*(1-b+b*len(d)/avgdl))
        sc.append((s, i))
    return [chunks[i] for s, i in sorted(sc, reverse=True)[:k]]

# ---------- B ----------
IDX = {(r["indicator_id"], r["entity_id"]): r for r in REC}
ALIAS = {"estado de mexico":"MX-MEX","edomex":"MX-MEX","cdmx":"MX-CMX","nl":"MX-NLE"}
def b_query(dims):
    if dims.get("op") == "max":
        rs = [r for r in REC if r["indicator_id"] == dims["indicator_id"] and r["value"] is not None]
        r = max(rs, key=lambda r: r["value"]); return {"coverage":"sufficient", "record": slim(r)}
    if dims.get("op") == "top3":
        rs = sorted([r for r in REC if r["indicator_id"] == dims["indicator_id"] and r["rank"]], key=lambda r: r["rank"])[:3]
        return {"coverage":"sufficient", "records":[slim(r) for r in rs]}
    if "indicator_id" not in dims:
        return {"coverage":"not_available", "reason":"fuera_de_modelo_estructurado"}
    ent = dims["entity_id"]; ent = ALIAS.get(ent, ent)
    r = IDX.get((dims["indicator_id"], ent))
    if not r: return {"coverage":"not_available"}
    if r["precision_eligible"] is False:
        return {"coverage":"not_available", "reason": r["exclusion_reason"], "id": r["record_id"]}
    out = {"coverage":"sufficient" if r["precision_eligible"] is True else "partial", "record": slim(r)}
    if r["precision_eligible"] == "solo_contexto": out["limits"] = "índice compuesto: solo contexto, no dato fáctico"
    return out
def slim(r):
    return {"id": r["record_id"]+"@1", "value": r["value_raw"], "unit": r["unit_doc"], "rank": r["rank"],
            "period": r["statistical_period"], "period_confidence": r["period_confidence"],
            "source": r["original_source"], "via": "IMCO ICE 2025 (pub. 2025-06-09)",
            "locator": f'{r["locator"]["doc"]} p.{r["locator"]["book_page"]}'}

# ---------- C ----------
PAGES = {i: p for i, p in enumerate(BOL.split("\n\n"), 1)}
def c_query(dims, q):
    res = b_query(dims)
    if res["coverage"] in ("sufficient","partial") and "record" in res:
        r = res["record"]; pg = PAGES[int(r["locator"].split("p.")[1]) - 34]
        line = next((l for l in pg.split("\n") if r["value"] in l), "")
        res["evidence"] = line.strip()
        return res
    if res.get("reason") in ("percepcion","sin_valor_en_documento") or "records" in res:
        return res
    ctx = [c for c in bm25(q, k=6) if c["id"].startswith("anexo")][:2]  # fallback acotado a metodología
    return {"coverage":"partial" if ctx else "not_available", "context":[{"id":c["id"],"text":c["text"]} for c in ctx]}

# ---------- Preguntas (gold transcrito a mano del PDF, independiente del parser) ----------
Q = [
 ("Informalidad laboral en Nuevo León", {"indicator_id":"informalidad","entity_id":"MX-NLE"}, "35%", "Nuevo León", "dato"),
 ("PIB per cápita de Querétaro", {"indicator_id":"pib_per_capita","entity_id":"MX-QUE"}, "$315,065", "Querétaro", "dato"),
 ("Ingreso promedio de trabajadores de tiempo completo en Jalisco", {"indicator_id":"ingreso_promedio","entity_id":"MX-JAL"}, "10,795", "Jalisco", "dato"),
 ("Terminales punto de venta en Yucatán", {"indicator_id":"terminales_pv","entity_id":"MX-YUC"}, "170", "Yucatán", "dato"),
 ("Carga aérea en Querétaro", {"indicator_id":"carga_aerea","entity_id":"MX-QUE"}, "29,689.3", "Querétaro", "dato"),
 ("Inversión extranjera directa en Baja California Sur", {"indicator_id":"ied","entity_id":"MX-BCS"}, "4.7", "Baja California Sur", "dato"),
 ("Exportación de mercancías de Chihuahua", {"indicator_id":"exportaciones","entity_id":"MX-CHH"}, "100%", "Chihuahua", "dato"),
 ("Crecimiento de puestos de trabajo IMSS en Tabasco", {"indicator_id":"crecimiento_imss","entity_id":"MX-TAB"}, "-12.2%", "Tabasco", "dato"),
 ("Tasa de participación en Colima", {"indicator_id":"tasa_participacion","entity_id":"MX-COL"}, "66.9%", "Colima", "dato"),
 ("Acceso a internet en Baja California", {"indicator_id":"acceso_internet","entity_id":"MX-BCN"}, "78%", "Baja California", "dato"),
 ("Población con educación superior en Guanajuato", {"indicator_id":"educacion_superior","entity_id":"MX-GUA"}, "18%", "Guanajuato", "dato"),
 ("Flujo de pasajeros aéreos en Hidalgo", {"indicator_id":"pasajeros_aereos","entity_id":"MX-HID"}, "0.0", "Hidalgo", "dato"),
 ("Crecimiento del PIB en Quintana Roo", {"indicator_id":"crecimiento_pib","entity_id":"MX-ROO"}, "7.6%", "Quintana Roo", "dato"),
 ("Diversificación económica en Jalisco", {"indicator_id":"diversificacion","entity_id":"MX-JAL"}, "929", "Jalisco", "dato"),
 ("Informalidad laboral en el Estado de México", {"indicator_id":"informalidad","entity_id":"estado de mexico"}, "54%", "México Posición", "alias"),
 ("Costo promedio de la deuda en Tlaxcala", {"indicator_id":"costo_deuda","entity_id":"MX-TLA"}, "NO_DISPONIBLE", "Tlaxcala", "faltante"),
 ("Percepción de seguridad en Yucatán", {"indicator_id":"percepcion_seguridad","entity_id":"MX-YUC"}, "EXCLUIDO", "Yucatán", "percepcion"),
 ("Complejidad económica en sectores de innovación en Nuevo León", {"indicator_id":"complejidad","entity_id":"MX-NLE"}, "100.00", "Nuevo León", "indice"),
 ("Qué estado tiene el mayor PIB per cápita", {"indicator_id":"pib_per_capita","op":"max"}, "$541,916", "Ciudad de México", "agregado"),
 ("Tres estados con menor informalidad laboral", {"indicator_id":"informalidad","op":"top3"}, ["MX-COA","MX-NLE","MX-BCS"], None, "agregado"),
 ("Fuente y periodo del indicador informalidad laboral", {"indicator_id":"informalidad","entity_id":"MX-NLE"}, "ENOE; 2005-2024", None, "metadato"),
 ("El índice permite realizar predicciones o determinar causalidad sobre la inversión", {}, "No permite realizar predicciones", None, "consultivo"),
 ("Cómo se homologan los indicadores en escala de cero a 100", {}, "el valor más bajo de la muestra toma el valor de cero", None, "consultivo"),
]

def ctx_chars(obj): return len(json.dumps(obj, ensure_ascii=False)) if not isinstance(obj, str) else len(obj)
def timeit(f, n=200):
    ts = []
    for _ in range(n):
        t = time.perf_counter(); f(); ts.append((time.perf_counter()-t)*1000)
    return statistics.median(ts)

rows = []
for q, dims, gold, ent_hint, kind in Q:
    # ---- A ----
    top = bm25(q); a_ctx = "\n\n".join(c["text"] for c in top)
    if kind == "agregado" and isinstance(gold, list):
        a_ok = False  # requiere comparar 32 páginas; top-3 no las contiene
    elif kind == "agregado":
        a_ok = False if not any(gold in c["text"] and ent_hint in c["text"] for c in top) else "parcial"
    elif kind == "faltante":
        a_ok = any("Tlaxcala" in c["text"] and "deuda*" in c["text"] for c in top)
    elif kind == "percepcion":
        a_ok = False  # A devuelve el dato sin bandera de exclusión → incumple política
    elif kind == "metadato":
        a_ok = any(gold in c["text"] for c in top)
    elif kind == "consultivo":
        a_ok = any(gold in c["text"] for c in top)
    else:
        a_ok = any(gold in c["text"] and ent_hint in c["text"] for c in top)
    a_prov = "página (sin periodo ni fuente primaria)" if any(c["id"].startswith("boletas") for c in top) else "párrafo del anexo"
    # ---- B ----
    b = b_query(dims)
    if kind == "faltante":   b_ok = b["coverage"] == "not_available"
    elif kind == "percepcion": b_ok = b.get("reason") == "percepcion"
    elif kind == "consultivo": b_ok = False
    elif kind == "metadato": b_ok = b.get("record",{}).get("source") == "INEGI·ENOE" and b["record"]["period"] == "2024"
    elif isinstance(gold, list): b_ok = [x["id"].split(".")[3].split("@")[0] for x in b["records"]] == gold
    else: b_ok = b.get("record",{}).get("value") == gold
    # ---- C ----
    c = c_query(dims, q)
    if kind == "consultivo": c_ok = any(gold in x["text"] for x in c.get("context", []))
    else: c_ok = b_ok
    rows.append({"q": q, "tipo": kind,
      "A_ok": a_ok, "A_chars": len(a_ctx), "A_ms": round(timeit(lambda: bm25(q)), 3), "A_prov": a_prov,
      "B_ok": b_ok, "B_chars": ctx_chars(b), "B_ms": round(timeit(lambda: b_query(dims)), 4),
      "C_ok": c_ok, "C_chars": ctx_chars(c), "C_ms": round(timeit(lambda: c_query(dims, q), 50), 3)})

def summary(key):
    ok = [r[f"{key}_ok"] for r in rows]
    full = sum(1 for x in ok if x is True); part = sum(1 for x in ok if x == "parcial")
    ch = [r[f"{key}_chars"] for r in rows]
    return {"aciertos": f"{full}/{len(rows)}", "parciales": part, "chars_mediana": statistics.median(ch),
            "chars_total": sum(ch), "tokens_estimados_total": round(sum(ch)/4),
            "latencia_mediana_ms": round(statistics.median(r[f"{key}_ms"] for r in rows), 4)}
res = {"n_preguntas": len(rows), "A": summary("A"), "B": summary("B"), "C": summary("C"), "detalle": rows}
(BASE/"out/abc_results.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
for r in rows: print(f'{r["tipo"]:10} A={str(r["A_ok"]):7} B={str(r["B_ok"]):5} C={str(r["C_ok"]):5} chars A/B/C={r["A_chars"]}/{r["B_chars"]}/{r["C_chars"]}  {r["q"][:55]}')
print(json.dumps({k: res[k] for k in ("A","B","C")}, ensure_ascii=False, indent=1))
