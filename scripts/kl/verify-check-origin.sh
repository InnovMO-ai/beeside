#!/usr/bin/env bash
# Verifica el ORIGEN de los checks obligatorios sobre el commit exacto (L1 v3, B3). Nombres protegidos y workflow esperado de cada uno:
#   kl-gate, kl-gate-push -> .github/workflows/kl-preflight.yml      kl-tests, kl-images -> .github/workflows/kl-ci.yml
# STOP si, sobre HEAD_SHA, existe: (a) un check-run con nombre protegido que NO provenga de la app GitHub Actions (id 15368); (b) un check-run con nombre
# protegido cuya ejecución (run) no pertenezca a este repositorio y al workflow esperado; (c) un estado de commit (Statuses API) con nombre protegido.
# Entorno: REPO, HEAD_SHA, GH_TOKEN. En pruebas: KL_API_DIR con respuestas JSON. Termina con 0 (OK) o 1 (STOP). Errores de API => STOP.
set -u
: "${REPO:?}" "${HEAD_SHA:?}"
ACTIONS_APP_ID=15368
api() { if [ -n "${KL_API_DIR:-}" ]; then cat "$KL_API_DIR/$(printf '%s' "$1" | tr '/?&=' '____').json" 2>/dev/null; else gh api "$1" 2>/dev/null; fi; }
command -v python3 >/dev/null 2>&1 || { echo "STOP     verify-check-origin: falta python3"; exit 1; }
CR="$(api "repos/$REPO/commits/$HEAD_SHA/check-runs?per_page=100")" && [ -n "$CR" ] || { echo "STOP     no se pudieron leer los check-runs de ${HEAD_SHA:0:12}"; exit 1; }
ST="$(api "repos/$REPO/commits/$HEAD_SHA/statuses?per_page=100")" && [ -n "$ST" ] || { echo "STOP     no se pudieron leer los estados de commit de ${HEAD_SHA:0:12}"; exit 1; }
# Primera pasada: qué ejecuciones (run id) aparecen detrás de cada check protegido
PLAN="$(printf '%s' "$CR" | python3 -I -c '
import json,re,sys
d=json.load(sys.stdin); app=int(sys.argv[1]); out=[]
exp={"kl-gate":"kl-preflight.yml","kl-gate-push":"kl-preflight.yml","kl-tests":"kl-ci.yml","kl-images":"kl-ci.yml"}
for c in d.get("check_runs",[]):
    n=c.get("name")
    if n not in exp: continue
    if (c.get("app") or {}).get("id")!=app: print("BAD app-ajena %s (app %s)"%(n,(c.get("app") or {}).get("slug"))); continue
    m=re.search(r"/actions/runs/(\d+)",c.get("details_url") or "")
    if not m: print("BAD sin-run %s"%n); continue
    print("RUN %s %s %s"%(m.group(1),n,exp[n]))
' "$ACTIONS_APP_ID" 2>/dev/null)" || { echo "STOP     respuesta de check-runs ilegible"; exit 1; }
RC=0
while IFS= read -r line; do
  case "$line" in
    BAD*) echo "STOP     check protegido con origen no válido: ${line#BAD }"; RC=1 ;;
    RUN*) set -- $line; rid="$2"; nm="$3"; wf="$4"
          R="$(api "repos/$REPO/actions/runs/$rid")" || R=""
          printf '%s' "${R:-{\}}" | python3 -I -c '
import json,sys
r=json.load(sys.stdin); repo,wf,sha=sys.argv[1:4]
ok=r.get("path")==".github/workflows/"+wf and (r.get("repository") or {}).get("full_name")==repo and r.get("head_sha")==sha
sys.exit(0 if ok else 1)' "$REPO" "$wf" "$HEAD_SHA" 2>/dev/null || { echo "STOP     check '$nm' proviene del run $rid que NO es $wf de $REPO sobre ${HEAD_SHA:0:12}"; RC=1; } ;;
  esac
done <<EOF2
$PLAN
EOF2
OUTST="$(printf '%s' "$ST" | python3 -I -c '
import json,sys
d=json.load(sys.stdin); names={"kl-gate","kl-gate-push","kl-tests","kl-images"}
if not isinstance(d,list): raise ValueError("estados no es una lista")
bad=sorted({s.get("context") for s in d if s.get("context") in names})
if bad: print("STOP     estado de commit (Statuses API) con nombre protegido: "+", ".join(bad)); sys.exit(1)' 2>/dev/null)" || { echo "${OUTST:-STOP     estados de commit ilegibles}"; RC=1; }
[ "$RC" = 0 ] && echo "OK       origen de los checks protegidos verificado para ${HEAD_SHA:0:12} (GitHub Actions, workflow y repositorio esperados)"
exit "$RC"
