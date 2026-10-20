"""KL 1.0 · Prueba de estructuración ICE 2025 (solo Workspace, sin implementación).
Lee el texto extraído de las boletas y del anexo metodológico (documentos del proyecto),
produce registros normalizados con procedencia y ejecuta controles de calidad.
No inventa datos: todo valor proviene del texto; lo no resoluble queda marcado."""
import json, re, sys, unicodedata
from pathlib import Path

BASE = Path(sys.argv[1])
BOL = (BASE / "ICE-2025_Boletas-.pdf.txt").read_text()
ANX = (BASE / "anexo.txt").read_text()

def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s).strip()

# 53 indicadores: id, nombre en boleta (prefijo), subíndice, clase, fuente primaria (anexo)
IND = [
 # id, prefijo boleta, subindice, tipo
 ("homicidios","Homicidios","derecho","objetivo"),
 ("robo_vehiculos","Robo de vehículos","derecho","objetivo"),
 ("incidencia_delictiva","Incidencia delictiva","derecho","objetivo"),
 ("delitos_no_denunciados","Delitos no denunciados","derecho","encuesta_victimizacion"),
 ("percepcion_seguridad","Percepción de seguridad","derecho","percepcion"),
 ("notarios","Competencia en servicios notariales","derecho","objetivo"),
 ("agresiones_periodistas","Agresiones a periodistas","derecho","registro_ong"),
 ("aguas_residuales","Caudal tratado de aguas residuales","sociedad","objetivo"),
 ("morbilidad_respiratoria","Morbilidad por enfermedades","sociedad","objetivo"),
 ("camas_hospital","Camas de hospital","sociedad","objetivo"),
 ("cobertura_educativa","Cobertura educativa","sociedad","objetivo"),
 ("acceso_salud","Acceso a instituciones de salud","sociedad","objetivo"),
 ("esperanza_vida","Esperanza de vida","sociedad","objetivo"),
 ("mortalidad_infantil","Mortalidad infantil","sociedad","objetivo"),
 ("personal_medico","Personal médico y de enfermería","sociedad","objetivo"),
 ("personal_especialidad","Personal médico con especialidad","sociedad","objetivo"),
 ("heridos_transito","Heridos en accidentes de tránsito","infraestructura","objetivo"),
 ("telefonia_movil","Telefonía móvil","infraestructura","objetivo"),
 ("acceso_internet","Acceso a internet","infraestructura","objetivo"),
 ("terminales_pv","Terminales punto de venta","infraestructura","objetivo"),
 ("banca_movil","Uso de banca móvil","infraestructura","objetivo"),
 ("captacion_ahorro","Captación de ahorro","infraestructura","objetivo"),
 ("pasajeros_aereos","Flujo de pasajeros aéreos","infraestructura","objetivo"),
 ("carga_aerea","Carga aérea","infraestructura","objetivo"),
 ("pib_turistico","PIB turístico","innovacion_economia","objetivo"),
 ("ied","Inversión extranjera directa","innovacion_economia","objetivo"),
 ("exportaciones","Exportación de mercancías","innovacion_economia","objetivo"),
 ("pib_per_capita","PIB per cápita","innovacion_economia","objetivo"),
 ("crecimiento_pib","Crecimiento del PIB","innovacion_economia","objetivo"),
 ("diversificacion","Diversificación económica","innovacion_economia","objetivo"),
 ("complejidad","Complejidad económica en sectores","innovacion_economia","indice_compuesto"),
 ("patentes","Patentes","innovacion_economia","objetivo"),
 ("intensidad_energetica","Intensidad energética","innovacion_economia","objetivo"),
 ("informalidad","Informalidad laboral","mercado_trabajo","objetivo"),
 ("ingreso_promedio","Ingreso promedio de trabajadores","mercado_trabajo","objetivo"),
 ("desigualdad_salarial","Desigualdad salarial","mercado_trabajo","objetivo"),
 ("bajo_linea_bienestar","Personas con ingresos por debajo","mercado_trabajo","objetivo"),
 ("jornadas_48h","Jornadas laborales de más de 48","mercado_trabajo","objetivo"),
 ("educacion_superior","Población con educación superior","mercado_trabajo","objetivo"),
 ("mujeres_pea","Mujeres económicamente activas","mercado_trabajo","objetivo"),
 ("brecha_genero","Brecha de ingresos por género","mercado_trabajo","objetivo"),
 ("dif_informalidad_genero","Diferencia de informalidad laboral","mercado_trabajo","objetivo"),
 ("escolaridad","Grado de escolaridad","mercado_trabajo","objetivo"),
 ("crecimiento_imss","Crecimiento de puesto de trabajo","mercado_trabajo","objetivo"),
 ("crecimiento_ue50","Crecimiento de las unidades","mercado_trabajo","objetivo"),
 ("tasa_participacion","Tasa de participación","mercado_trabajo","objetivo"),
 ("deuda_estatal","Deuda estatal y de organismos","sistema_politico","objetivo"),
 ("costo_deuda","Costo promedio de la deuda","sistema_politico","objetivo"),
 ("ingresos_propios","Ingresos propios","sistema_politico","objetivo"),
 ("mejora_regulatoria","Indicador subnacional de mejora","sistema_politico","indice_compuesto"),
 ("percepcion_corrupcion","Percepción de corrupción estatal","sistema_politico","percepcion"),
 ("consulta_finanzas","Consulta de información de finanzas","sistema_politico","encuesta_conducta"),
 ("participacion_ciudadana","Participación ciudadana","sistema_politico","objetivo"),
]
assert len(IND) == 53

# Metadatos tomados literalmente del anexo (fuente original y serie). Campo 'anx' = nombre en anexo.
ANNEX_KEYS = {
 "pib_per_capita":"PIB per cápita","crecimiento_pib":"Crecimiento del","ied":"Inversión \nextranjera",
 "complejidad":"Complejidad \neconómica","exportaciones":"Exportaciones \nde mercancías",
 "diversificacion":"Diversificación \neconómica","acceso_internet":"Acceso a \ninternet",
 "terminales_pv":"Terminales\npunto de venta","pasajeros_aereos":"Flujo de\npasajeros",
 "carga_aerea":"Carga aérea","informalidad":"Informalidad \nlaboral","ingreso_promedio":"Ingreso promedio\nde trabajadores",
 "educacion_superior":"Población con\neducación","crecimiento_imss":"Crecimiento de \npuesto de",
 "tasa_participacion":"Tasa de \nparticipación","percepcion_seguridad":"Percepción de\nseguridad",
 "percepcion_corrupcion":"Percepción de\ncorrupción","mejora_regulatoria":"Indicador\nsubnacional",
 "costo_deuda":"Costo \npromedio",
}
def annex_meta(key):
    a = ANNEX_KEYS.get(key)
    if not a: return None
    i = ANX.find(a)
    if i < 0: return {"error": "no_localizado_en_anexo"}
    seg = ANX[i:i+900]
    f = re.search(r"Fuente:\s*(.+?)(?:\n(?:[A-ZÁÉÍÓÚ][a-záéíóú]+[\s\n]|Qué mide|\d{1,2}\n)|$)", seg, re.S)
    u = re.search(r"Unidades:\s*(.+?)\n(?:Fuente|.*\nFuente)", seg, re.S)
    fuente = re.sub(r"\s+", " ", f.group(1)).strip() if f else None
    years = re.findall(r"(?:19|20)\d{2}", fuente or "")
    return {"fuente_anexo": fuente, "unidad_anexo": re.sub(r"\s+"," ",u.group(1)).strip() if u else None,
            "ultimo_anio_serie": max(years) if years else None,
            "estimado": bool(fuente and "estimada" in fuente)}

ENT = {"Aguascalientes":"MX-AGU","Baja California":"MX-BCN","Baja California Sur":"MX-BCS","Campeche":"MX-CAM",
 "Coahuila":"MX-COA","Colima":"MX-COL","Chiapas":"MX-CHP","Chihuahua":"MX-CHH","Ciudad de México":"MX-CMX",
 "Durango":"MX-DUR","Guanajuato":"MX-GUA","Guerrero":"MX-GRO","Hidalgo":"MX-HID","Jalisco":"MX-JAL","México":"MX-MEX",
 "Michoacán":"MX-MIC","Morelos":"MX-MOR","Nayarit":"MX-NAY","Nuevo León":"MX-NLE","Oaxaca":"MX-OAX","Puebla":"MX-PUE",
 "Querétaro":"MX-QUE","Quintana Roo":"MX-ROO","San Luis Potosí":"MX-SLP","Sinaloa":"MX-SIN","Sonora":"MX-SON",
 "Tabasco":"MX-TAB","Tamaulipas":"MX-TAM","Tlaxcala":"MX-TLA","Veracruz":"MX-VER","Yucatán":"MX-YUC","Zacatecas":"MX-ZAC"}

VAL = re.compile(r"(?:^|(?<=\s))(-?\$?-?[\d,]+(?:\.\d+)?%?|-)\s+(\d{1,2}|-)$")
def parse_value(raw):
    if raw == "-": return None
    s = raw.replace("$","").replace(",","").replace("%","")
    return float(s)

pages = BOL.split("\n\n")
records, issues = [], []
for pidx, page in enumerate(pages, start=1):
    m = re.search(r"\n([A-ZÁÉÍÓÚ][^\n]+?) Posición: (\d+)\n", page)
    if not m: continue
    ent, general = m.group(1).strip(), int(m.group(2))
    nums = re.findall(r"RESULTADOS POR ESTADO\n(\d) ?(\d)(?:\n|$)", page)
    book_page = int("".join(nums[-1])) if nums else None
    pending = []
    for line in page.split("\n"):
        line = line.strip()
        mv = VAL.search(line)
        if mv and mv.start() > 0:
            pending.append(line[:mv.start()].strip())
        name_txt = norm(" ".join(pending))
        if mv and pending:
            hit = sorted([i for i in IND if name_txt.startswith(norm(i[1]))], key=lambda i: -len(i[1]))
            if hit:
                iid, pref, sub, tipo = hit[0]
                units = re.findall(r"\(((?:[^()]|\([^()]*\))*)\)", " ".join(pending))
                unit = re.match(r"(.*)", units[-1]) if units else None  # último paréntesis = unidad (v1 tomaba el primero: error detectado por QA en 'Crecimiento de puesto de trabajo (IMSS)')
                records.append({
                  "record_id": f"imco.ice2025.{iid}.{ENT.get(ent,'?')}",
                  "indicator_id": iid, "indicator_label_doc": pref, "subindex": sub, "indicator_kind": tipo,
                  "entity_label_doc": ent, "entity_id": ENT.get(ent),
                  "value_raw": mv.group(1), "value": parse_value(mv.group(1)),
                  "rank_raw": mv.group(2), "rank": None if mv.group(2)=="-" else int(mv.group(2)),
                  "unit_doc": re.sub(r"\s+"," ",unit.group(1)).strip() if unit else None,
                  "locator": {"doc":"ICE-2025_Boletas-.pdf","pdf_page":(book_page-34 if book_page else None),"book_page":book_page},
                  "entity_general_rank": general})
            pending = []
            continue
        if mv and not pending:
            continue
        if line and line not in ("trabajo","Gobiernos","Medio ambiente","Economía") and not any(h in line for h in ("Indicador Cifra","Posición","RESULTADOS","INSTITUTO","ÍNDICE DE","El desempeño","!La entidad")):
            pending.append(line)

# ---- Enriquecimiento con anexo y política KL ----
PRIMARY = {  # fuente primaria (clase A) cuando IMCO es intermediario; None si no hay primaria pública registrable
 "informalidad":"INEGI·ENOE","ingreso_promedio":"INEGI·ENOE","educacion_superior":"INEGI·ENOE","tasa_participacion":"INEGI·ENOE",
 "crecimiento_imss":"IMSS·Puestos de trabajo afiliados","pib_per_capita":"INEGI·PIBE (BIE)","crecimiento_pib":"INEGI·PIBE (BIE)",
 "exportaciones":"INEGI·Exportaciones por entidad (BIE)","diversificacion":"INEGI·DENUE","ied":"SE·Estadística oficial IED",
 "terminales_pv":"CNBV·Bases de inclusión financiera","pasajeros_aereos":"SICT/AFAC·Estadística operacional de aeropuertos",
 "carga_aerea":"SICT/AFAC·Estadística operacional de aeropuertos","acceso_internet":"INEGI·ENIGH / Censo",
 "complejidad":None,"percepcion_seguridad":"INEGI·ENVIPE","percepcion_corrupcion":"INEGI·ENCIG","mejora_regulatoria":"ONMR (sociedad civil)",
 "costo_deuda":"SHCP·Indicadores de financiamientos"}
for r in records:
    meta = annex_meta(r["indicator_id"]) or {}
    r["annex"] = meta
    r["statistical_period"] = meta.get("ultimo_anio_serie")
    r["period_confidence"] = ("inferido_del_anexo_estimado" if meta.get("estimado") else
                              "inferido_del_anexo" if meta.get("ultimo_anio_serie") else "no_declarado")
    r["publication_date"] = "2025-06-09"
    r["intermediary"] = "IMCO"
    r["original_source"] = PRIMARY.get(r["indicator_id"])
    r["source_class"] = "B"
    r["precision_eligible"] = (False if (r["indicator_kind"]=="percepcion" or r["value"] is None)
                               else "solo_contexto" if r["indicator_kind"]=="indice_compuesto" else True)
    r["exclusion_reason"] = ("percepcion" if r["indicator_kind"]=="percepcion" else
                             "sin_valor_en_documento" if r["value"] is None else None)
    r["status"] = "candidate"

# ---- Controles de calidad ----
from collections import Counter, defaultdict
qa = {}
per_ent = Counter(r["entity_id"] for r in records)
qa["entidades"] = len(per_ent)
qa["registros"] = len(records)
qa["entidades_incompletas"] = {e:c for e,c in per_ent.items() if c != 53}
qa["indicadores_faltantes"] = {e: sorted(set(i[0] for i in IND) - {r["indicator_id"] for r in records if r["entity_id"]==e}) for e in per_ent if per_ent[e]!=53}
# rango 1..32 y empates
ranks = defaultdict(list)
for r in records:
    if r["rank"] is not None: ranks[r["indicator_id"]].append((r["rank"], r["entity_id"], r["value"]))
qa["rangos_fuera_1_32"] = [(k,x) for k,v in ranks.items() for x in v if not 1<=x[0]<=32]
ties = {}
for k,v in ranks.items():
    c = Counter(x[0] for x in v); t = {rk:[e for rr,e,_ in v if rr==rk] for rk,n in c.items() if n>1}
    if t: ties[k] = t
qa["empates_de_posicion"] = ties
# coherencia valor-posición (monotonía): detecta dirección e inconsistencias
mono = {}
for k,v in ranks.items():
    v2 = sorted(v); vals = [x[2] for x in v2 if x[2] is not None]
    inc = sum(1 for a,b in zip(vals,vals[1:]) if b>a); dec = sum(1 for a,b in zip(vals,vals[1:]) if b<a)
    direction = "menor_es_mejor" if inc>dec else "mayor_es_mejor"
    viol = [(v2[i][1],v2[i+1][1]) for i in range(len(v2)-1) if v2[i][2] is not None and v2[i+1][2] is not None and
            ((direction=="mayor_es_mejor" and v2[i+1][2]>v2[i][2]) or (direction=="menor_es_mejor" and v2[i+1][2]<v2[i][2]))]
    mono[k] = {"direccion_inferida":direction,"violaciones":viol}
qa["monotonia_valor_posicion"] = {k:v for k,v in mono.items() if v["violaciones"]}
qa["direccion"] = {k:v["direccion_inferida"] for k,v in mono.items()}
qa["valores_nulos"] = [(r["indicator_id"], r["entity_id"], r["value_raw"]) for r in records if r["value"] is None]
qa["unidad_boleta_vs_anexo"] = sorted({(r["indicator_id"], r["unit_doc"], (r["annex"] or {}).get("unidad_anexo")) for r in records if r["annex"]})
qa["percepcion_excluidos"] = sum(1 for r in records if r["exclusion_reason"]=="percepcion")

out = BASE / "out"; out.mkdir(exist_ok=True)
(out/"ice2025_records.json").write_text(json.dumps(records, ensure_ascii=False, indent=1))
(out/"ice2025_qa.json").write_text(json.dumps(qa, ensure_ascii=False, indent=1, default=str))
print(json.dumps({k:(v if k not in("direccion","unidad_boleta_vs_anexo") else "...") for k,v in qa.items()}, ensure_ascii=False, indent=1, default=str)[:6000])
