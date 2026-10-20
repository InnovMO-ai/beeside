#!/usr/bin/env bash
# S2 · Habilitar el Admin API (Control Center) en beeside-dev-backend-api con Google Workspace como IdP (opción A).
# Misma imagen que hoy (main): NO despliega KL. Una sola revisión nueva del servicio compartido; si la verificación falla, devuelve el tráfico a la
# revisión previa automáticamente. Ningún valor secreto pasa por este script: el servicio los monta desde Secret Manager.
#   OIDC_CLIENT_ID=<id>.apps.googleusercontent.com bash scripts/kl/g2/s2-enable-admin-api.sh plan
#   S2_CONFIRM=yes OIDC_CLIENT_ID=<id>.apps.googleusercontent.com bash scripts/kl/g2/s2-enable-admin-api.sh apply
set -euo pipefail
MODE="${1:-}"; P="${KL_PROJECT:-beeside-dev-508220}"; R="${KL_REGION:-northamerica-south1}"; SVC=beeside-dev-backend-api
ORIGIN="${ADMIN_APP_ORIGIN:-https://beeside-dev-frontend-app-amwsj4v5uq-pv.a.run.app}"
REDIRECT="$ORIGIN/api/admin/auth/callback"; ISSUER="https://accounts.google.com"; DOMAINS="${ADMIN_ALLOWED_EMAIL_DOMAINS:-beeside.you}"
CID="${OIDC_CLIENT_ID:-}"
[[ "$MODE" == "plan" || "$MODE" == "apply" ]] || { echo "uso: OIDC_CLIENT_ID=… $0 plan|apply" >&2; exit 2; }
[[ "$CID" =~ ^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$ ]] || { echo "STOP: OIDC_CLIENT_ID ausente o con formato inesperado (se espera <número>-<texto>.apps.googleusercontent.com)" >&2; exit 2; }

fail() { echo "STOP: $*" >&2; exit 1; }
echo "== precondiciones (solo lectura)"
n=$(gcloud secrets versions list beeside-dev-sso-client-secret --project "$P" --filter="state=ENABLED" --format="value(name)" | wc -l | tr -d ' ')
[[ "$n" -ge 1 ]] || fail "beeside-dev-sso-client-secret no tiene ninguna versión habilitada (falta el paso client-secret de S1)"
n=$(gcloud secrets versions list beeside-dev-admin-session-secret --project "$P" --filter="state=ENABLED" --format="value(name)" | wc -l | tr -d ' ')
[[ "$n" -ge 1 ]] || fail "beeside-dev-admin-session-secret no tiene versión habilitada"
SA="$(gcloud run services describe "$SVC" --region "$R" --project "$P" --format='value(spec.template.spec.serviceAccountName)')"
for s in beeside-dev-sso-client-secret beeside-dev-admin-session-secret; do
  gcloud secrets get-iam-policy "$s" --project "$P" --format='value(bindings.members)' | grep -q "serviceAccount:$SA" || fail "$SA no tiene secretAccessor sobre $s"
done
CURRENT_ENV="$(gcloud run services describe "$SVC" --region "$R" --project "$P" --format='value(spec.template.spec.containers[0].env[].name)')"
echo "$CURRENT_ENV" | tr ';' '\n' | grep -qx ADMIN_API_ENABLED && fail "ADMIN_API_ENABLED ya está definido: revisar el estado antes de repetir"
PREV="$(gcloud run services describe "$SVC" --region "$R" --project "$P" --format='value(status.latestReadyRevisionName)')"
echo "revisión actual (para rollback): $PREV"
echo "emisor: $ISSUER · origen: $ORIGIN · redirect URI (debe estar registrada EXACTA en Google): $REDIRECT · dominios: $DOMAINS · client id: $CID"
[[ "$MODE" == "plan" ]] && { echo "(plan: no se cambió nada)"; exit 0; }
[[ "${S2_CONFIRM:-}" == "yes" ]] || { echo "STOP: apply exige S2_CONFIRM=yes" >&2; exit 2; }

echo "== aplicando una revisión nueva (misma imagen)"
gcloud run services update "$SVC" --region "$R" --project "$P" --quiet \
  --update-secrets "ADMIN_OIDC_CLIENT_SECRET=beeside-dev-sso-client-secret:latest,ADMIN_SESSION_SECRET=beeside-dev-admin-session-secret:latest" \
  --update-env-vars "ADMIN_API_ENABLED=true,ADMIN_APP_ORIGIN=$ORIGIN,ADMIN_OIDC_ISSUER=$ISSUER,ADMIN_OIDC_CLIENT_ID=$CID,ADMIN_OIDC_REDIRECT_URI=$REDIRECT,ADMIN_ALLOWED_EMAIL_DOMAINS=$DOMAINS"
NEW="$(gcloud run services describe "$SVC" --region "$R" --project "$P" --format='value(status.latestReadyRevisionName)')"
rollback() { echo "ROLLBACK: tráfico de vuelta a $PREV"; gcloud run services update-traffic "$SVC" --region "$R" --project "$P" --to-revisions "$PREV=100" --quiet; exit 1; }
echo "revisión nueva: $NEW"

echo "== verificación"
URL="$(gcloud run services describe "$SVC" --region "$R" --project "$P" --format='value(status.url)')"
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
[[ "$(code "$URL/health")" == "200" ]] || { echo "falla: /health"; rollback; }
[[ "$(code "$URL/health/ready")" == "200" ]] || { echo "falla: /health/ready"; rollback; }
c="$(code "$URL/api/admin/me")"; [[ "$c" == "401" || "$c" == "403" ]] || { echo "falla: /api/admin/me sin sesión devolvió $c (se esperaba 401/403)"; rollback; }
LOC="$(curl -s -o /dev/null -D - "$URL/api/admin/auth/login" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')"
[[ "$LOC" == "$ISSUER"* || "$LOC" == https://accounts.google.com/* ]] || { echo "falla: /auth/login no redirige a Google"; rollback; }
for needle in "client_id=$CID" "code_challenge_method=S256" "redirect_uri=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$REDIRECT")"; do
  [[ "$LOC" == *"$needle"* ]] || { echo "falla: la URL de autorización no contiene $needle"; rollback; }
done
echo "OK: Admin API activo en $NEW; /auth/login redirige a Google con PKCE S256 y la redirect URI esperada. Falta S3: el inicio de sesión real del titular."
