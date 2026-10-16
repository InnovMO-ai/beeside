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
# STEPS selects what runs (default: all). Example: STEPS="images web alerts" deploys the closed web tier before the backend can start.
want() { case " ${STEPS:-images database backend web worker alerts} " in *" $1 "*) return 0;; *) return 1;; esac; }
g() { gcloud --project "$PROJECT_ID" "$@"; }
PNUM=$( [ "$DRY_RUN" = "0" ] && gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)' || echo "<project-number>" )
# deterministic Cloud Run URL (service-projectNumber.region.run.app): lets the web tier be deployed before the backend exists
url_of() { echo "https://$1-${PNUM}.${REGION}.run.app"; }
BACKEND_URL=$(url_of discovery-backend)

REPO="${REGION}-docker.pkg.dev/${PROJECT_ID}/discovery"
SA() { echo "discovery-$1@${PROJECT_ID}.iam.gserviceaccount.com"; }
ENV_COMMON="NODE_ENV=production,FA4_API_ENABLED=true,APP_BASE_URL=${APP_BASE_URL},FA4_PUBLIC_PATH=${FA4_PUBLIC_PATH},ALLOWED_ORIGINS=${ALLOWED_ORIGINS},TRUST_PROXY_HOPS=${TRUST_PROXY_HOPS},FA4_EMAIL_TRANSPORT=smtp,SMTP_HOST=${SMTP_HOST},SMTP_PORT=${SMTP_PORT:-587},SMTP_USER=${SMTP_USER},MAIL_FROM=${MAIL_FROM},MAIL_REPLY_TO=${MAIL_REPLY_TO},FA4_PRIVACY_URL=${FA4_PRIVACY_URL:-https://www.beeside.you/privacy},FA4_TERMS_URL=${FA4_TERMS_URL:-https://beeside.you/termsandconditions}"
[ "${FA4_PREMIUM_COMMERCIAL_CONTENT_ALLOWED:-}" = "true" ] && ENV_COMMON="${ENV_COMMON},FA4_PREMIUM_COMMERCIAL_CONTENT_ALLOWED=true"
# CLOSED TEST: no final Privacy version yet → fictitious data only, non-commercial, e-mail restricted to the test domains (backend records the marker CLOSED-TEST-NOT-LEGAL)
if [ "${FA4_CLOSED_TEST_MODE:-}" = "true" ]; then ENV_COMMON="${ENV_COMMON},FA4_CLOSED_TEST_MODE=true,FA4_CLOSED_TEST_EMAIL_DOMAINS=${FA4_CLOSED_TEST_EMAIL_DOMAINS:-beeside.you}"; else ENV_COMMON="${ENV_COMMON},FA4_PRIVACY_VERSION=${FA4_PRIVACY_VERSION}"; fi
SECRETS_COMMON="DATABASE_URL=${SECRET_DATABASE_URL}:latest,SECURITY_HASH_SECRET=${SECRET_HASH}:latest,SMTP_PASSWORD=${SECRET_SMTP_PASSWORD}:latest"

want images && {
echo "== 2. images"
run gcloud --project "$PROJECT_ID" builds submit --config deploy/production/cloudbuild.production.yaml \
  --substitutions "_REPO=${REPO},_TAG=${IMAGE_TAG},_PRIVACY_URL=${FA4_PRIVACY_URL:-https://www.beeside.you/privacy},_PREMIUM_URL=${VITE_FA4_PREMIUM_PURCHASE_URL:-}" .
}
want database && {
echo "== 3. migrations + least-privilege verification + catalog seed (own jobs, own database role; the runtime services never see this credential)"
run env PROJECT_ID="$PROJECT_ID" REGION="$REGION" IMAGE_TAG="$IMAGE_TAG" SKIP_BUILD=1 DRY_RUN="$DRY_RUN" SECRET_MIGRATION_DATABASE_URL="$SECRET_MIGRATION_DATABASE_URL" bash deploy/production/prepare-database.sh
}
want backend && {
echo "== 4. backend (private: IAM-only invoker; reachable only by the web and worker identities)"
run g run deploy discovery-backend --region "$REGION" --image "${REPO}/discovery-backend:${IMAGE_TAG}" --service-account "$(SA backend)" \
  --no-allow-unauthenticated --ingress all --add-cloudsql-instances "$SQL_CONNECTION_NAME" --min-instances 1 --max-instances 5 --cpu 1 --memory 512Mi \
  --set-env-vars "$ENV_COMMON" --set-secrets "$SECRETS_COMMON"
run g run services add-iam-policy-binding discovery-backend --region "$REGION" --member "serviceAccount:$(SA web)" --role roles/run.invoker
}

# --no-invoker-iam-check: the organization forbids granting allUsers (Domain Restricted Sharing), so the load balancer cannot hold an invoker binding. Reachability is
# restricted by INGRESS (load balancer only) and every request is gated by the application (ACCESS_GATE_MODE) — never by "public Cloud Run".}
want web && {
echo "== 5. web (Discovery-only static server + /discovery/api/fa4 proxy; controlled-access gate is RUNTIME configuration)"
CLOSED_WEB=""; [ "${FA4_CLOSED_TEST_MODE:-}" = "true" ] && CLOSED_WEB=",CLOSED_TEST_MODE=true"
WEB_ENV="NODE_ENV=production,SERVE_MODE=discovery${CLOSED_WEB},PUBLIC_PATH=${PUBLIC_PATH},ACCESS_GATE_MODE=${ACCESS_GATE_MODE},ROBOTS_NOINDEX=${ROBOTS_NOINDEX:-false},API_UPSTREAM_URL=${BACKEND_URL},UPSTREAM_AUTH_AUDIENCE=${BACKEND_URL}"
WEB_SECRETS=()
[ "$ACCESS_GATE_MODE" = "basic" ] && WEB_SECRETS=(--set-secrets "ACCESS_GATE_CREDENTIALS=${SECRET_ACCESS_GATE_CREDENTIALS}:latest")
run g run deploy discovery-web --region "$REGION" --image "${REPO}/discovery-web:${IMAGE_TAG}" --service-account "$(SA web)" \
  --no-allow-unauthenticated --no-invoker-iam-check --ingress internal-and-cloud-load-balancing --min-instances 1 --max-instances 5 --cpu 1 --memory 256Mi \
  --set-env-vars "$WEB_ENV" "${WEB_SECRETS[@]}"
}
want worker && {
echo "== 6. e-mail outbox worker (always on; several replicas are safe — rows are leased)"
run g run deploy discovery-worker --region "$REGION" --image "${REPO}/discovery-backend:${IMAGE_TAG}" --service-account "$(SA worker)" \
  --command node --args dist/fa4/worker.js --no-allow-unauthenticated --ingress internal --no-cpu-throttling --min-instances 1 --max-instances 2 --cpu 1 --memory 512Mi \
  --add-cloudsql-instances "$SQL_CONNECTION_NAME" --set-env-vars "$ENV_COMMON" --set-secrets "$SECRETS_COMMON"
}
want alerts && {
echo "== 7. logging metrics + alerts (hooks)"
run env PROJECT_ID="$PROJECT_ID" ALERT_CHANNEL="${ALERT_CHANNEL:-}" ALERT_EMAIL="${ALERT_EMAIL:-}" DRY_RUN="$DRY_RUN" bash deploy/production/alerts/apply-alerts.sh
}

cat <<MSG

Done (DRY_RUN=$DRY_RUN). NOT done by this script — owned by the platform and confirmed in the preflight:
  · load balancer + managed certificate + DNS routing beeside.you/discovery* (and the reserved /ops-control) to discovery-web; the default backend stays the company website
  · the organization-policy exception that lets the load balancer invoke discovery-web (Domain Restricted Sharing)
  · Cloud SQL instance/database/roles, backups + PITR, Secret Manager values, Artifact Registry repo, notification channel
Next: team smoke test behind the gate (docs/fa4/RELEASE_AUDIT_DISCOVERY_V1.md §10), then deploy/production/RUNBOOK.md.
MSG
