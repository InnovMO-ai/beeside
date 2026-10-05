#!/usr/bin/env bash
# FA4 INTERNAL STAGING on the existing beeside-dev GCP project (Cloud Run + the shared Cloud SQL instance). Idempotent, reversible (see teardown).
# Nothing here touches the `beeside` database, the legacy Cloud Run services or main. Secrets are generated and kept in Secret Manager only.
set -euo pipefail
PROJECT=${PROJECT:-beeside-dev-508220}; REGION=${REGION:-northamerica-south1}
SQL_INSTANCE=${SQL_INSTANCE:-beeside-dev-canonical-db}
REPO=${REGION}-docker.pkg.dev/${PROJECT}/beeside-dev
TAG=${TAG:-$(git rev-parse --short HEAD)}
ACCESS_MEMBER=${ACCESS_MEMBER:-domain:beeside.you}          # who may open the staging through IAP
PNUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
RUN_SA=${PNUM}-compute@developer.gserviceaccount.com
SQL_CONN=${PROJECT}:${REGION}:${SQL_INSTANCE}
LABEL="STAGING INTERNO · datos de prueba"
g() { gcloud --project "$PROJECT" "$@"; }

echo "== APIs"; g services enable cloudbuild.googleapis.com iap.googleapis.com

secret_exists() { g secrets describe "$1" >/dev/null 2>&1; }
ensure_secret() { secret_exists "$1" || { printf '%s' "$2" | g secrets create "$1" --data-file=- --replication-policy=automatic >/dev/null; echo "created secret $1"; }; }
echo "== secrets (values never printed)"
RT_PW=$(secret_exists fa4-staging-db-runtime-password && g secrets versions access latest --secret fa4-staging-db-runtime-password || openssl rand -hex 24)
ensure_secret fa4-staging-db-runtime-password "$RT_PW"
ensure_secret fa4-staging-hash-secret "$(openssl rand -hex 32)"
ensure_secret fa4-staging-database-url "postgres://fa4_staging_runtime:${RT_PW}@/fa4_staging?host=/cloudsql/${SQL_CONN}"
for s in fa4-staging-db-runtime-password fa4-staging-hash-secret fa4-staging-database-url; do
  g secrets add-iam-policy-binding "$s" --member "serviceAccount:${RUN_SA}" --role roles/secretmanager.secretAccessor >/dev/null
done

echo "== build images ($TAG)"
g builds submit --config staging/fa4-internal/cloudbuild.yaml --substitutions "_REPO=${REPO},_TAG=${TAG},_ENV_LABEL=${LABEL}" .

echo "== prepare job (separate database fa4_staging, migrations, catalog, runtime role)"
g run jobs deploy fa4-staging-prepare --region "$REGION" --image "${REPO}/fa4-staging-backend:${TAG}" \
  --command node --args dist/scripts/fa4-staging-prepare.js \
  --set-secrets "MIGRATION_DATABASE_URL=beeside-dev-migration-database-url:latest,FA4_STAGING_RUNTIME_PASSWORD=fa4-staging-db-runtime-password:latest" \
  --set-cloudsql-instances "$SQL_CONN" --service-account "$RUN_SA" --max-retries 0 --task-timeout 300
g run jobs execute fa4-staging-prepare --region "$REGION" --wait

echo "== backend (private, min 0 / max 1)"
COMMON=(--region "$REGION" --service-account "$RUN_SA" --min-instances 0 --max-instances 1 --memory 512Mi --cpu 1)
g run deploy fa4-staging-backend "${COMMON[@]}" --image "${REPO}/fa4-staging-backend:${TAG}" --no-allow-unauthenticated \
  --add-cloudsql-instances "$SQL_CONN" \
  --set-env-vars "NODE_ENV=staging,FA4_ENV=staging,FA4_API_ENABLED=true,APP_BASE_URL=https://placeholder.invalid" \
  --set-secrets "DATABASE_URL=fa4-staging-database-url:latest,SECURITY_HASH_SECRET=fa4-staging-hash-secret:latest"
BACKEND_URL=$(g run services describe fa4-staging-backend --region "$REGION" --format 'value(status.url)')

echo "== web (frontend; IAP in front)"
g run deploy fa4-staging-web "${COMMON[@]}" --image "${REPO}/fa4-staging-web:${TAG}" --no-allow-unauthenticated \
  --set-env-vars "API_UPSTREAM_URL=${BACKEND_URL},UPSTREAM_AUTH_AUDIENCE=${BACKEND_URL},ROBOTS_NOINDEX=true,STAGING_TEST_LEGAL=true"
WEB_URL=$(g run services describe fa4-staging-web --region "$REGION" --format 'value(status.url)')
g run services update fa4-staging-backend --region "$REGION" --update-env-vars "APP_BASE_URL=${WEB_URL}" >/dev/null
# the web service may call the private backend
g run services add-iam-policy-binding fa4-staging-backend --region "$REGION" --member "serviceAccount:${RUN_SA}" --role roles/run.invoker >/dev/null

echo "== IAP on the web service"
g beta run services update fa4-staging-web --region "$REGION" --iap
g beta run services add-iam-policy-binding fa4-staging-web --region "$REGION" --member "serviceAccount:service-${PNUM}@gcp-sa-iap.iam.gserviceaccount.com" --role roles/run.invoker >/dev/null
g iap web add-iam-policy-binding --resource-type=cloud-run --service fa4-staging-web --region "$REGION" --member "$ACCESS_MEMBER" --role roles/iap.httpsResourceAccessor >/dev/null
echo "FA4 staging: ${WEB_URL}/fa4   (sign in with a ${ACCESS_MEMBER} Google account)"

# Teardown (reversible): 
#   gcloud run services delete fa4-staging-web fa4-staging-backend --region $REGION; gcloud run jobs delete fa4-staging-prepare --region $REGION
#   gcloud secrets delete fa4-staging-db-runtime-password / -hash-secret / -database-url
#   DROP DATABASE fa4_staging; DROP ROLE fa4_staging_runtime;   (as beeside_app, via a one-off job or the SQL console)
