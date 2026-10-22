#!/usr/bin/env bash
# M1-cierre · Prueba controlada de las 4 alertas de Cloud Monitoring de KL (módulo kl-alerting). SOLO recursos exclusivos de KL en DEV:
#   - el Cloud Run Job beeside-dev-kl-worker (ejecuciones con argumentos sustituidos: no arrancan el worker ni abren la base),
#   - el Cloud Scheduler beeside-dev-kl-worker-tick (pausa temporal y reanudación),
#   - un Cloud Scheduler TEMPORAL beeside-dev-kl-alerttest que falla a propósito (se elimina al terminar).
# No toca beeside_kl, el bucket de exportaciones, el export diario, el backend ni recursos de otras plataformas. Los correos van al canal de alertas de KL.
# Uso: ALERTS_CONFIRM=yes bash scripts/kl/m1/alerts-test.sh <check|a3|a12|a4|all>
# Orden recomendado: check → a3 (≈30 min) → a12 (≈15 min) → a4 (≈10 min). a3 va primero: una ejecución fallida cuenta como «ejecución completada» y rompería la ausencia.
set -uo pipefail
[[ "${ALERTS_CONFIRM:-}" == "yes" ]] || { echo "STOP: requiere ALERTS_CONFIRM=yes" >&2; exit 2; }
P="${KL_PROJECT:-beeside-dev-508220}"; R=northamerica-south1; LOC=us-south1; JOB=beeside-dev-kl-worker; TICK=beeside-dev-kl-worker-tick; EXPORT=beeside-dev-kl-daily-export
TESTJ=beeside-dev-kl-alerttest; SA="beeside-dev-kl-scheduler@$P.iam.gserviceaccount.com"; PREFIX="KL dev"; T0="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; export T0
log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
tok() { gcloud auth print-access-token 2>/dev/null; }
api() { curl -s -H "Authorization: Bearer $(tok)" "$1"; }
sched_state() { gcloud scheduler jobs describe "$1" --location "$LOC" --project "$P" --format='value(state)' 2>/dev/null; }
policies() { api "https://monitoring.googleapis.com/v3/projects/$P/alertPolicies" | python3 -c '
import json,sys
d=json.load(sys.stdin)
for p in d.get("alertPolicies",[]):
    if p["displayName"].startswith(sys.argv[1]): print(p["name"].split("/")[-1], "|", p["displayName"], "|", "enabled" if p.get("enabled",True) else "DISABLED", "|", len(p.get("notificationChannels",[])), "canal(es)")' "$PREFIX"; }
pid() { policies | grep -F "$1" | head -1 | cut -d' ' -f1; }
# ¿hay una alerta abierta para la política? (API v3 alerts; si no está disponible devuelve UNKNOWN y la confirmación es por correo)
open_alert() { api "https://monitoring.googleapis.com/v3/projects/$P/alerts?filter=policy.name%3D%22projects%2F$P%2FalertPolicies%2F$1%22&pageSize=10" | T0="$T0" python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: print("UNKNOWN"); sys.exit()
if "error" in d: print("UNKNOWN"); sys.exit()
import os
a=[x for x in d.get("alerts",[]) if x.get("openTime","")>=os.environ.get("T0","")]  # solo incidentes abiertos DESPUÉS de empezar la prueba
print("OPEN" if any(x.get("state")=="OPEN" for x in a) else ("CLOSED" if a else "NONE"))'; }
wait_alert() { # $1 política, $2 minutos máximos
  local end=$(( $(date +%s) + $2*60 )) s
  while [ "$(date +%s)" -lt "$end" ]; do s="$(open_alert "$1")"; log "   alerta $1: $s"; case "$s" in OPEN|CLOSED) echo "$s"; return 0 ;; UNKNOWN) echo UNKNOWN; return 0 ;; esac; sleep 60; done; echo NONE; }

phase_check() {
  log "— check: estado previo"
  gcloud auth print-access-token >/dev/null 2>&1 || { echo "STOP: gcloud sin sesión (gcloud auth login)"; exit 4; }
  policies; echo "   tick=$(sched_state $TICK) export=$(sched_state $EXPORT)"
  gcloud alpha monitoring channels list --project "$P" --format='value(displayName,type,verificationStatus,enabled)' 2>/dev/null | grep -i "KL" || echo "   (canal: no legible con gcloud alpha; verificar en la consola)"
  echo "   ejecuciones en curso del worker: $(gcloud run jobs executions list --job $JOB --region $R --project $P --filter='status.runningCount>0' --format='value(name)' 2>/dev/null | wc -l | tr -d ' ')"
}
phase_a3() {  # ausencia de ejecuciones 20 min
  local id; id="$(pid 'no executions')"; [ -n "$id" ] || { echo "STOP: política 3 no encontrada"; exit 1; }
  trap 'gcloud scheduler jobs resume "$TICK" --location "$LOC" --project "$P" >/dev/null 2>&1; log "tick reanudado: $(sched_state $TICK)"' EXIT
  log "— a3: pausa del tick (reanuda al salir)"; gcloud scheduler jobs pause "$TICK" --location "$LOC" --project "$P" >/dev/null || exit 1
  log "   tick=$(sched_state $TICK); esperando hasta 40 min"; R3="$(wait_alert "$id" 40)"; log "   resultado a3: $R3"
}
phase_a12() { # fallas de ejecución y de intentos
  local i1 i2; i1="$(pid 'execution failed')"; i2="$(pid 'repeated failed attempts')"
  log "— a12: 2 ejecuciones que fallan a propósito (cada una = 2 intentos por max_retries=1)"
  for n in 1 2; do gcloud run jobs execute "$JOB" --region "$R" --project "$P" --wait --args="^@^-e@process.exit(1)" 2>&1 | tail -1; done
  R1="$(wait_alert "$i1" 20)"; R2="$(wait_alert "$i2" 20)"; log "   resultado a1: $R1 · a2: $R2"
}
phase_a4() {  # error de Cloud Scheduler en un job con prefijo KL
  local id; id="$(pid 'Cloud Scheduler')"
  trap 'gcloud scheduler jobs delete "$TESTJ" --location "$LOC" --project "$P" --quiet >/dev/null 2>&1; log "job temporal eliminado: $(sched_state $TESTJ || true)"' EXIT
  log "— a4: job temporal que falla (404 a propósito)"
  gcloud scheduler jobs create http "$TESTJ" --location "$LOC" --project "$P" --schedule "0 0 1 1 *" --http-method POST \
    --uri "https://$R-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$P/jobs/beeside-dev-kl-alerttest-inexistente:run" \
    --oauth-service-account-email "$SA" --quiet >/dev/null || { echo "PENDIENTE: no se pudo crear el job temporal (¿actAs sobre $SA?)"; exit 1; }
  gcloud scheduler jobs run "$TESTJ" --location "$LOC" --project "$P" >/dev/null; R4="$(wait_alert "$id" 15)"; log "   resultado a4: $R4"
}
case "${1:-}" in check) phase_check ;; a3) phase_a3 ;; a12) phase_a12 ;; a4) phase_a4 ;; all) phase_check; ( phase_a3 ); ( phase_a12 ); ( phase_a4 ) ;; *) echo "uso: alerts-test.sh <check|a3|a12|a4|all>"; exit 3 ;; esac
