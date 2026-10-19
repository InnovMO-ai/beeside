#!/usr/bin/env bash
# Códigos de salida: 0 verificada · 1 falla · 3 aún no ha disparado · 4 no se pudo consultar (sin sesión de gcloud o sin permisos).
# Verificación de solo lectura de la PRIMERA exportación PROGRAMADA de beeside_kl (cierre de G2). Comprueba tres cosas, todas posteriores al disparo programado:
#   (1) el intento del scheduler terminó con HTTP 200; (2) existe una versión nueva de gs://…/daily/beeside_kl.sql.gz; (3) la operación EXPORT de Cloud SQL
#   está DONE y fue emitida por beeside-dev-kl-scheduler@… . Uso: bash scripts/kl/g2/verify-scheduled-export.sh [AAAA-MM-DDTHH:MM:SSZ del disparo esperado]
set -uo pipefail
P="${KL_PROJECT:-beeside-dev-508220}"; LOC=us-south1; J=beeside-dev-kl-daily-export; I=beeside-dev-kl-db
# Sin sesión válida de gcloud NO se puede afirmar nada (antes devolvía «aún no ha disparado» por error): se aborta con código 4.
gcloud auth print-access-token >/dev/null 2>&1 || { echo "STOP (exit 4): gcloud no tiene sesión válida; ejecuta «gcloud auth login» y repite. No se verificó nada." >&2; exit 4; }
STATE0="$(gcloud scheduler jobs describe $J --location $LOC --project $P --format='value(state)' 2>/dev/null)"
[[ -n "$STATE0" ]] || { echo "STOP (exit 4): no se pudo leer el schedule $J (permisos, proyecto o red). No se verificó nada." >&2; exit 4; }
SINCE="${1:-$(gcloud scheduler jobs describe $J --location $LOC --project $P --format='value(scheduleTime)' 2>/dev/null)}"
OBJ="gs://$P-beeside-dev-kl-exports/daily/beeside_kl.sql.gz"; EXPECT_SA="beeside-dev-kl-scheduler@$P.iam.gserviceaccount.com"
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; echo "ahora $now · estado del schedule: $(gcloud scheduler jobs describe $J --location $LOC --project $P --format='value(state)')"
LAST="${LAST_OVERRIDE:-$(gcloud scheduler jobs describe $J --location $LOC --project $P --format="value(lastAttemptTime)")}"
if [[ -z "$LAST" ]]; then echo "RESULTADO: AÚN NO HA DISPARADO (lastAttemptTime vacío). Próximo disparo: $(gcloud scheduler jobs describe $J --location $LOC --project $P --format='value(scheduleTime)')"; exit 3; fi
echo "último intento del scheduler: $LAST"
ok=1
# (1) intento HTTP 200 (registro de Cloud Scheduler, posterior al disparo programado)
ST="$(gcloud logging read "resource.type=\"cloud_scheduler_job\" AND resource.labels.job_id=\"$J\" AND jsonPayload.\"@type\"=\"type.googleapis.com/google.cloud.scheduler.logging.AttemptFinished\" AND timestamp>=\"$LAST\"" --project $P --limit 1 --format='value(httpRequest.status)' 2>/dev/null)"
[[ "$ST" == "200" ]] && echo "OK  (1) intento del scheduler: HTTP 200" || { echo "FALLA (1) intento del scheduler: '${ST:-sin registro}'"; ok=0; }
# (2) versión nueva del objeto
NEW="$(gcloud storage ls -a --long "$OBJ" 2>/dev/null | awk -v t="$LAST" '$2>=t {print $2, $1" bytes", $3}' | tail -1)"
[[ -n "$NEW" ]] && echo "OK  (2) versión nueva del objeto: $NEW" || { echo "FALLA (2) no hay versión de $OBJ posterior a $LAST"; gcloud storage ls -a --long "$OBJ" 2>&1 | tail -3; ok=0; }
# (3) operación EXPORT posterior al disparo, hecha por la cuenta del scheduler (se busca entre las últimas operaciones; el filtro de gcloud por tipo no es fiable)
RES="$(gcloud sql operations list --instance $I --project $P --limit 100 --format=json 2>/dev/null | python3 -c '
import sys,json
last,exp=sys.argv[1],sys.argv[2]
ops=[o for o in json.load(sys.stdin) if o.get("operationType")=="EXPORT" and o.get("startTime","")>last]
good=[o for o in ops if o.get("user")==exp and o.get("status")=="DONE"]
if good: o=good[0]; print("OK|%s|DONE|%s|%s"%(o["name"],o["user"],o["startTime"]))
elif ops: o=ops[0]; print("BAD|%s|%s|%s|%s"%(o["name"],o.get("status"),o.get("user"),o["startTime"]))
else: print("NONE")' "$LAST" "$EXPECT_SA")"
case "$RES" in
  OK\|*) IFS='|' read -r _ OPN _ USR START <<<"$RES"; echo "OK  (3) operación EXPORT $OPN: DONE, user=$USR, inicio $START" ;;
  BAD\|*) echo "FALLA (3) hay EXPORT posterior pero no cumple (nombre|estado|usuario|inicio): ${RES#BAD|} · se esperaba user=$EXPECT_SA y DONE"; ok=0 ;;
  *) echo "FALLA (3) no hay ninguna operación EXPORT posterior a $LAST"; ok=0 ;;
esac
[[ $ok == 1 ]] && { echo "RESULTADO: PRIMERA EXPORTACIÓN PROGRAMADA VERIFICADA (G2 puede cerrarse)"; exit 0; } || { echo "RESULTADO: NO VERIFICADA (revisar arriba; si procede: bash scripts/kl/g2/d9-scheduler.sh pause export)"; exit 1; }
