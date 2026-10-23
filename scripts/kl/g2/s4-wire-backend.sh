#!/usr/bin/env bash
# S4 · Cableado de KL en el backend de dev: una revisión nueva de beeside-dev-backend-api con la segunda instancia de Cloud SQL, KL_DB_URL_APP /
# KL_DB_URL_READER (por referencia a Secret Manager) y PRECISION_KNOWLEDGE_PROVIDER=off. La imagen no cambia (ya es kl-backend, con KL).
# Si cualquier verificación falla devuelve el 100 % del tráfico a la revisión previa. Ningún valor secreto pasa por este script.
#   bash scripts/kl/g2/s4-wire-backend.sh plan
#   S4_CONFIRM=yes bash scripts/kl/g2/s4-wire-backend.sh apply
set -euo pipefail
MODE="${1:-}"; P="${KL_PROJECT:-beeside-dev-508220}"; R="${KL_REGION:-northamerica-south1}"; SVC=beeside-dev-backend-api
F="${ADMIN_APP_ORIGIN:-https://beeside-dev-frontend-app-amwsj4v5uq-pv.a.run.app}"
KL_CONN="$P:$R:beeside-dev-kl-db"
[[ "$MODE" == "plan" || "$MODE" == "apply" ]] || { echo "uso: $0 plan|apply" >&2; exit 2; }
fail() { echo "STOP: $*" >&2; exit 1; }

echo "== precondiciones (solo lectura)"
IMG="$(gcloud run services describe "$SVC" --region "$R" --project "$P" --format='value(spec.template.spec.containers[0].image)')"
[[ "$IMG" == */kl-backend:* ]] || fail "el servicio no corre una imagen kl-backend ($IMG): sin código de KL el cableado no tiene efecto"
ENVN="$(gcloud run services describe "$SVC" --region "$R" --project "$P" --format='value(spec.template.spec.containers[0].env[].name)' | tr ';' '\n')"
grep -qx ADMIN_API_ENABLED <<<"$ENVN" || fail "ADMIN_API_ENABLED no está definido: KL Admin exige el Admin API (S2)"
grep -qE '^KL_DB_URL_(APP|READER)$' <<<"$ENVN" && fail "KL_DB_URL_* ya está definido: revisar el estado antes de repetir"
grep -qE '^(KL_DB_URL_(AGENT|KNOWLEDGE|OWNER)|PRECISION_KNOWLEDGE_PROVIDER)$' <<<"$ENVN" && fail "hay variables que el backend se niega a aceptar o que ya existen: revisar"
SA="$(gcloud run services describe "$SVC" --region "$R" --project "$P" --format='value(spec.template.spec.serviceAccountName)')"
for s in beeside-dev-kl-app-url beeside-dev-kl-reader-precision-url; do
  gcloud secrets get-iam-policy "$s" --project "$P" --format='value(bindings.members)' | grep -q "serviceAccount:$SA" || fail "$SA no puede leer $s"
  [[ "$(gcloud secrets versions list "$s" --project "$P" --filter='state=ENABLED' --format='value(name)' | wc -l | tr -d ' ')" -ge 1 ]] || fail "$s sin versión habilitada"
done
[[ "$(gcloud sql instances describe beeside-dev-kl-db --project "$P" --format='value(state)')" == "RUNNABLE" ]] || fail "beeside-dev-kl-db no está RUNNABLE"
PREV="$(gcloud run services describe "$SVC" --region "$R" --project "$P" --format='value(status.latestReadyRevisionName)')"
echo "imagen: ${IMG##*/} · revisión actual (rollback): $PREV · cuenta del backend: $SA"
echo "haría: --add-cloudsql-instances $KL_CONN · KL_DB_URL_APP←beeside-dev-kl-app-url · KL_DB_URL_READER←beeside-dev-kl-reader-precision-url · PRECISION_KNOWLEDGE_PROVIDER=off"
[[ "$MODE" == "plan" ]] && { echo "(plan: no se cambió nada)"; exit 0; }
[[ "${S4_CONFIRM:-}" == "yes" ]] || { echo "STOP: apply exige S4_CONFIRM=yes" >&2; exit 2; }

echo "== aplicando (una revisión nueva, misma imagen)"
gcloud run services update "$SVC" --region "$R" --project "$P" --quiet \
  --add-cloudsql-instances "$KL_CONN" \
  --update-secrets "KL_DB_URL_APP=beeside-dev-kl-app-url:latest,KL_DB_URL_READER=beeside-dev-kl-reader-precision-url:latest" \
  --update-env-vars "PRECISION_KNOWLEDGE_PROVIDER=off"
NEW="$(gcloud run services describe "$SVC" --region "$R" --project "$P" --format='value(status.latestReadyRevisionName)')"
rollback() { echo "ROLLBACK: tráfico de vuelta a $PREV"; gcloud run services update-traffic "$SVC" --region "$R" --project "$P" --to-revisions "$PREV=100" --quiet; exit 1; }
echo "revisión nueva: $NEW"

echo "== verificación (por el origen del navegador)"
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
for p in /health /health/ready; do [[ "$(code "$F$p")" == "200" ]] || { echo "falla: $p"; rollback; }; done
c="$(code "$F/api/admin/me")"; [[ "$c" == "401" ]] || { echo "falla: /api/admin/me sin sesión = $c"; rollback; }
c="$(code "$F/api/admin/kl/me")"; [[ "$c" == "401" ]] || { echo "falla: /api/admin/kl/me sin sesión = $c (se esperaba 401)"; rollback; }
BODY="$(curl -s -D /tmp/kl_pub_hdr "$F/api/public/editions/abcdefghijklmnopqrstuvwxyz/status")"
[[ "$BODY" == '{"status":"unknown"}' ]] || { echo "falla: estado público inesperado ($BODY)"; rollback; }
grep -qi '^cache-control: no-store' /tmp/kl_pub_hdr || { echo "falla: sin Cache-Control: no-store"; rollback; }
rm -f /tmp/kl_pub_hdr
LOC="$(curl -s -o /dev/null -D - "$F/api/admin/auth/login" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')"
[[ "$LOC" == https://accounts.google.com/* ]] || { echo "falla: el login dejó de redirigir a Google"; rollback; }
echo "OK: KL cableado en $NEW. Falta la comprobación autenticada: el titular abre $F/api/admin/kl/me con su sesión."
