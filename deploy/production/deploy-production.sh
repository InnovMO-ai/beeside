#!/usr/bin/env bash
# Discovery Public v1.0 — PRODUCTION deployment (Cloud Run). SEPARATE from staging (staging/fa4-internal/deploy-gcp.sh is never used for production).
#
#   DRY_RUN=1 (default)  prints every command and changes nothing.
#   DRY_RUN=0 PROD_CONFIRM=DEPLOY-TO-PRODUCTION:<PROJECT_ID> bash deploy/production/deploy-production.sh deploy/production/production.env
#
# It deploys: migration+seed jobs, backend (private), web (Discovery-only, access gate), worker (outbox), alert hooks. It does NOT create or modify what is owned by the
# platform: the GCP project, Cloud SQL (instance, database, login roles), Secret Manager VALUES, Artifact Registry repository, service accounts' org policy, load balancer,
# DNS, certificate, notification channels. The preflight refuses to continue unless those were confirmed.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
ENV_FILE=${1:-deploy/production/production.env}
DRY_RUN=${DRY_RUN:-1}
[ -f "$ENV_FILE" ] || { echo "env file not found: $ENV_FILE (copy deploy/production/production.env.example)"; exit 2; }

echo "== 1. preflight (nothing is deployed unless it passes)"
PF_ARGS=(--env-file "$ENV_FILE" --dist frontend/dist)
[ "$DRY_RUN" = "0" ] && PF_ARGS+=(--verify-gcloud)
node scripts/fa4-production-preflight.js "${PF_ARGS[@]}" || { echo "Refusing to deploy: fix the items above."; exit 1; }

# load the (non-secret) configuration safely
eval "$(node -e 'const {parseEnvFile}=require("./scripts/fa4-production-preflight.js");const e=parseEnvFile(require("fs").readFileSync(process.argv[1],"utf8"));for(const [k,v] of Object.entries(e))console.log(`export ${k}=${JSON.stringify(v)}`)' "$ENV_FILE")"

if [ "$DRY_RUN" = "0" ]; then
  [ "${PROD_CONFIRM:-}" = "DEPLOY-TO-PRODUCTION:${PROJECT_ID}" ] || { echo "PROD_CONFIRM must be DEPLOY-TO-PRODUCTION:${PROJECT_ID}"; exit 3; }
  [ -z "$(git status --porcelain)" ] || { echo "working tree is not clean"; exit 3; }
  [ "$(git rev-parse --short HEAD)" = "$IMAGE_TAG" ] || { echo "IMAGE_TAG ($IMAGE_TAG) must be the commit being deployed ($(git rev-parse --short HEAD))"; exit 3; }
else
  echo "(DRY RUN: commands are printed, nothing is executed)"
fi
run() { echo "+ $*"; if [ "$DRY_RUN" = "0" ]; then "$@"; fi; }
g() { gcloud --project "$PROJECT_ID" "$@"; }
url_of() { if [ "$DRY_RUN" = "0" ]; then g run services describe "$1" --region "$REGION" --format 'value(status.url)'; else echo "https://<$1-url>"; fi; }

REPO="${REGION}-docker.pkg.dev/${PROJECT_ID}/discovery"
SA() { echo "discovery-$1@${PROJECT_ID}.iam.gserviceaccount.com"; }
ENV_COMMON="NODE_ENV=production,FA4_API_ENABLED=true,APP_BASE_URL=${APP_BASE_URL},FA4_PUBLIC_PATH=${FA4_PUBLIC_PATH},ALLOWED_ORIGINS=${ALLOWED_ORIGINS},TRUST_PROXY_HOPS=${TRUST_PROXY_HOPS},FA4_EMAIL_TRANSPORT=smtp,SMTP_HOST=${SMTP_HOST},SMTP_PORT=${SMTP_PORT:-587},SMTP_USER=${SMTP_USER},MAIL_FROM=${MAIL_FROM},MAIL_REPLY_TO=${MAIL_REPLY_TO},FA4_PRIVACY_VERSION=${FA4_PRIVACY_VERSION},FA4_PRIVACY_URL=${FA4_PRIVACY_URL:-https://www.beeside.you/privacy},FA4_TERMS_URL=${FA4_TERMS_URL:-https://beeside.you/termsandconditions}"
[ "${FA4_PREMIUM_COMMERCIAL_CONTENT_ALLOWED:-}" = "true" ] && ENV_COMMON="${ENV_COMMON},FA4_PREMIUM_COMMERCIAL_CONTENT_ALLOWED=true"
SECRETS_COMMON="DATABASE_URL=${SECRET_DATABASE_URL}:latest,SECURITY_HASH_SECRET=${SECRET_HASH}:latest,SMTP_PASSWORD=${SECRET_SMTP_PASSWORD}:latest"

echo "== 2. images"
run gcloud --project "$PROJECT_ID" builds submit --config deploy/production/cloudbuild.production.yaml \
  --substitutions "_REPO=${REPO},_TAG=${IMAGE_TAG},_PRIVACY_URL=${FA4_PRIVACY_URL:-https://www.beeside.you/privacy},_PREMIUM_URL=${VITE_FA4_PREMIUM_PURCHASE_URL:-}" .

echo "== 3. migrations + catalog seed (own job, own database role; the runtime services never see this credential)"
for J in migrate seed; do
  CMD=dist/scripts/migrate.js; [ "$J" = "seed" ] && CMD=dist/scripts/seed-fa4-catalog.js
  EXTRA="MIGRATION_DATABASE_URL=${SECRET_MIGRATION_DATABASE_URL}:latest"; [ "$J" = "seed" ] && EXTRA="DATABASE_URL=${SECRET_MIGRATION_DATABASE_URL}:latest"
  run g run jobs deploy "discovery-${J}" --region "$REGION" --image "${REPO}/discovery-backend:${IMAGE_TAG}" --command node --args "$CMD" \
    --set-cloudsql-instances "$SQL_CONNECTION_NAME" --service-account "$(SA migrate)" --set-secrets "$EXTRA" --set-env-vars NODE_ENV=production --max-retries 0 --task-timeout 600
  run g run jobs execute "discovery-${J}" --region "$REGION" --wait
done

echo "== 4. backend (private: IAM-only invoker; reachable only by the web and worker identities)"
run g run deploy discovery-backend --region "$REGION" --image "${REPO}/discovery-backend:${IMAGE_TAG}" --service-account "$(SA backend)" \
  --no-allow-unauthenticated --ingress all --add-cloudsql-instances "$SQL_CONNECTION_NAME" --min-instances 1 --max-instances 5 --cpu 1 --memory 512Mi \
  --set-env-vars "$ENV_COMMON" --set-secrets "$SECRETS_COMMON"
BACKEND_URL=$(url_of discovery-backend)
run g run services add-iam-policy-binding discovery-backend --region "$REGION" --member "serviceAccount:$(SA web)" --role roles/run.invoker

echo "== 5. web (Discovery-only static server + /discovery/api/fa4 proxy; controlled-access gate is RUNTIME configuration)"
WEB_ENV="NODE_ENV=production,SERVE_MODE=discovery,PUBLIC_PATH=${PUBLIC_PATH},ACCESS_GATE_MODE=${ACCESS_GATE_MODE},ROBOTS_NOINDEX=${ROBOTS_NOINDEX:-false},API_UPSTREAM_URL=${BACKEND_URL},UPSTREAM_AUTH_AUDIENCE=${BACKEND_URL}"
WEB_SECRETS=()
[ "$ACCESS_GATE_MODE" = "basic" ] && WEB_SECRETS=(--set-secrets "ACCESS_GATE_CREDENTIALS=${SECRET_ACCESS_GATE_CREDENTIALS}:latest")
run g run deploy discovery-web --region "$REGION" --image "${REPO}/discovery-web:${IMAGE_TAG}" --service-account "$(SA web)" \
  --no-allow-unauthenticated --ingress internal-and-cloud-load-balancing --min-instances 1 --max-instances 5 --cpu 1 --memory 256Mi \
  --set-env-vars "$WEB_ENV" "${WEB_SECRETS[@]}"

echo "== 6. e-mail outbox worker (always on; several replicas are safe — rows are leased)"
run g run deploy discovery-worker --region "$REGION" --image "${REPO}/discovery-backend:${IMAGE_TAG}" --service-account "$(SA worker)" \
  --command node --args dist/fa4/worker.js --no-allow-unauthenticated --ingress internal --no-cpu-throttling --min-instances 1 --max-instances 2 --cpu 1 --memory 512Mi \
  --add-cloudsql-instances "$SQL_CONNECTION_NAME" --set-env-vars "$ENV_COMMON" --set-secrets "$SECRETS_COMMON"

echo "== 7. logging metrics + alerts (hooks)"
run env PROJECT_ID="$PROJECT_ID" ALERT_CHANNEL="$ALERT_CHANNEL" DRY_RUN="$DRY_RUN" bash deploy/production/alerts/apply-alerts.sh

cat <<MSG

Done (DRY_RUN=$DRY_RUN). NOT done by this script — owned by the platform and confirmed in the preflight:
  · load balancer + managed certificate + DNS routing beeside.you/discovery* (and the reserved /ops-control) to discovery-web; the default backend stays the company website
  · the organization-policy exception that lets the load balancer invoke discovery-web (Domain Restricted Sharing)
  · Cloud SQL instance/database/roles, backups + PITR, Secret Manager values, Artifact Registry repo, notification channel
Next: team smoke test behind the gate (docs/fa4/RELEASE_AUDIT_DISCOVERY_V1.md §10), then deploy/production/RUNBOOK.md.
MSG
