#!/usr/bin/env bash
# Verifica el ORIGEN de los checks obligatorios sobre el commit exacto (L1 v3, B3). Nombres protegidos y workflow esperado de cada uno:
#   kl-gate, kl-gate-push -> .github/workflows/kl-preflight.yml      kl-tests, kl-images -> .github/workflows/kl-ci.yml
#   (0005) checks obligatorios de ci.yml: build-lint-test (<workspace>), container-images, dependency-audit, secrets-scan, fa4-copy-inventory,
#   integration-postgres -> .github/workflows/ci.yml. Se leen TODAS las páginas de la API y se exige que el total coincida (sin truncar).
# STOP si, sobre HEAD_SHA, existe: (a) un check-run con nombre protegido que NO provenga de la app GitHub Actions (id 15368); (b) un check-run con nombre
# protegido cuya ejecución (run) no pertenezca a este repositorio, al workflow esperado y a la misma check suite (0005); (c) un estado de commit (Statuses API) con nombre protegido.
# Entorno: REPO, HEAD_SHA, GH_TOKEN. En pruebas: KL_API_DIR con respuestas JSON. Termina con 0 (OK) o 1 (STOP). Errores de API => STOP.
set -u
: "${REPO:?}" "${HEAD_SHA:?}"
ACTIONS_APP_ID=15368
api() { if [ -n "${KL_API_DIR:-}" ]; then cat "$KL_API_DIR/$(printf '%s' "$1" | tr '/?&=' '____').json" 2>/dev/null; else gh api "$1" 2>/dev/null; fi; }
# 0005: listas paginadas (un check protegido no puede esconderse en la página 2). En pruebas, KL_API_DIR puede traer varias páginas concatenadas.
api_all() { if [ -n "${KL_API_DIR:-}" ]; then api "$1"; else gh api --paginate "$1" 2>/dev/null; fi; }
command -v python3 >/dev/null 2>&1 || { echo "STOP     verify-check-origin: falta python3"; exit 1; }
CR="$(api_all "repos/$REPO/commits/$HEAD_SHA/check-runs?per_page=100")" && [ -n "$CR" ] || { echo "STOP     no se pudieron leer los check-runs de ${HEAD_SHA:0:12}"; exit 1; }
ST="$(api_all "repos/$REPO/commits/$HEAD_SHA/statuses?per_page=100")" && [ -n "$ST" ] || { echo "STOP     no se pudieron leer los estados de commit de ${HEAD_SHA:0:12}"; exit 1; }
# Primera pasada: qué ejecuciones (run id) aparecen detrás de cada check protegido
PLAN="$(printf '%s' "$CR" | python3 -I -c '
import json,re,sys
raw=sys.stdin.read(); dec=json.JSONDecoder(); i=0; runs=[]; totals=set()
while i<len(raw):
    while i<len(raw) and raw[i].isspace(): i+=1
    if i>=len(raw): break
    o,i=dec.raw_decode(raw,i)
    if not isinstance(o,dict) or not isinstance(o.get("check_runs"),list): raise ValueError("pagina sin check_runs")
    runs+=o["check_runs"]; totals.add(o.get("total_count"))
totals.discard(None)
if len(totals)>1 or (totals and list(totals)[0]!=len(runs)): raise ValueError("lista truncada o incoherente")
app=int(sys.argv[1])
exp={"kl-gate":"kl-preflight.yml","kl-gate-push":"kl-preflight.yml","kl-tests":"kl-ci.yml","kl-images":"kl-ci.yml",
     "container-images":"ci.yml","dependency-audit":"ci.yml","secrets-scan":"ci.yml","fa4-copy-inventory":"ci.yml","integration-postgres":"ci.yml"}
def wf(n):
    if n in exp: return exp[n]
    if n=="build-lint-test" or (n.startswith("build-lint-test (") and n.endswith(")")): return "ci.yml"
    return None
for c in runs:
    n=c.get("name") or ""
    if wf(n) is None: continue
    if (c.get("app") or {}).get("id")!=app: print("BAD app-ajena %s (app %s)"%(n,(c.get("app") or {}).get("slug"))); continue
    m=re.search(r"/actions/runs/(\d+)",c.get("details_url") or "")
    if not m: print("BAD sin-run %s"%n); continue
    su=(c.get("check_suite") or {}).get("id")
    if not isinstance(su,int): print("BAD sin-suite %s"%n.replace(" ","\u00a0")); continue
    print("RUN %s %s %s %s"%(m.group(1),n.replace(" ","\u00a0"),wf(n),su))
' "$ACTIONS_APP_ID" 2>/dev/null)" || { echo "STOP     respuesta de check-runs ilegible"; exit 1; }
RC=0
while IFS= read -r line; do
  case "$line" in
    BAD*) echo "STOP     check protegido con origen no válido: ${line#BAD }"; RC=1 ;;
    RUN*) set -- $line; rid="$2"; nm="$(printf '%s' "$3" | sed 's/\xc2\xa0/ /g')"; wf="$4"; su="$5"
          R="$(api "repos/$REPO/actions/runs/$rid")" || R=""
          printf '%s' "${R:-{\}}" | python3 -I -c '
import json,sys
r=json.load(sys.stdin); repo,wf,sha,su=sys.argv[1:5]
# 0005: details_url lo escribe quien crea el check-run; el vínculo fiable es la check suite del run (check_suite_id) = la del check-run.
ok=r.get("path")==".github/workflows/"+wf and (r.get("repository") or {}).get("full_name")==repo and r.get("head_sha")==sha and str(r.get("check_suite_id"))==su
sys.exit(0 if ok else 1)' "$REPO" "$wf" "$HEAD_SHA" "$su" 2>/dev/null || { echo "STOP     check '$nm' proviene del run $rid que NO es $wf de $REPO sobre ${HEAD_SHA:0:12}"; RC=1; } ;;
  esac
done <<EOF2
$PLAN
EOF2
OUTST="$(printf '%s' "$ST" | python3 -I -c '
import json,sys
raw=sys.stdin.read(); dec=json.JSONDecoder(); i=0; d=[]
while i<len(raw):
    while i<len(raw) and raw[i].isspace(): i+=1
    if i>=len(raw): break
    o,i=dec.raw_decode(raw,i)
    if not isinstance(o,list): raise ValueError("estados no es una lista")
    d+=o
names={"kl-gate","kl-gate-push","kl-tests","kl-images","container-images","dependency-audit","secrets-scan","fa4-copy-inventory","integration-postgres"}
prot=lambda c: isinstance(c,str) and (c in names or c=="build-lint-test" or c.startswith("build-lint-test ("))
bad=sorted({s.get("context") for s in d if isinstance(s,dict) and prot(s.get("context"))})
if bad: print("STOP     estado de commit (Statuses API) con nombre protegido: "+", ".join(bad)); sys.exit(1)' 2>/dev/null)" || { echo "${OUTST:-STOP     estados de commit ilegibles}"; RC=1; }
[ "$RC" = 0 ] && echo "OK       origen de los checks protegidos verificado para ${HEAD_SHA:0:12} (GitHub Actions, workflow y repositorio esperados)"
exit "$RC"
