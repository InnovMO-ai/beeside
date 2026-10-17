#!/usr/bin/env bash
# Database preparation for Discovery production: backend image → migrations → runtime-login membership + least-privilege verification → catalog seed.
# Touches ONLY the production database schema/catalog (no customer data exists). Idempotent. DRY_RUN=1 default.
# Shared canonical database (migrations 0050/0051): the prepare job puts the runtime login in its OWN group and verifies the isolation contract.
# The dedicated legacy Discovery database (24 migrations, no domain roles) needs ALLOW_LEGACY_RUNTIME_GROUP=1 explicitly; the job refuses otherwise.
#   IMAGE_TAG=<sha> DRY_RUN=0 bash deploy/production/prepare-database.sh        (SKIP_BUILD=1 when the image already exists)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
PROJECT_ID=${PROJECT_ID:-beeside-discovery-prod}; REGION=${REGION:-northamerica-south1}; SQL_INSTANCE=${SQL_INSTANCE:-discovery-db}
IMAGE_TAG=${IMAGE_TAG:?set IMAGE_TAG (the commit SHA)}; DRY_RUN=${DRY_RUN:-1}
SECRET_MIGRATION_DATABASE_URL=${SECRET_MIGRATION_DATABASE_URL:-discovery-migration-db-url}
REPO="${REGION}-docker.pkg.dev/${PROJECT_ID}/discovery"; SQL_CONN="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
SA="discovery-migrate@${PROJECT_ID}.iam.gserviceaccount.com"
run() { echo "+ $*"; if [ "$DRY_RUN" = "0" ]; then "$@"; fi; }
g() { gcloud --project "$PROJECT_ID" "$@"; }
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  run g builds submit --config deploy/production/cloudbuild.backend.yaml --service-account "projects/${PROJECT_ID}/serviceAccounts/discovery-build@${PROJECT_ID}.iam.gserviceaccount.com" --substitutions "_REPO=${REPO},_TAG=${IMAGE_TAG}" .
fi
job() { # name script secretsSpec
  run g run jobs deploy "discovery-$1" --region "$REGION" --image "${REPO}/discovery-backend:${IMAGE_TAG}" --command node --args "$2" \
    --set-cloudsql-instances "$SQL_CONN" --service-account "$SA" --set-secrets "$3" --set-env-vars "NODE_ENV=production,RUNTIME_LOGIN_ROLE=discovery_runtime,ALLOW_LEGACY_RUNTIME_GROUP=${ALLOW_LEGACY_RUNTIME_GROUP:-0},PRECISION_RUNTIME_LOGIN=${PRECISION_RUNTIME_LOGIN:-}" --max-retries 0 --task-timeout 600
  run g run jobs execute "discovery-$1" --region "$REGION" --wait
}
job migrate dist/scripts/migrate.js "MIGRATION_DATABASE_URL=${SECRET_MIGRATION_DATABASE_URL}:latest"
job prepare dist/scripts/discovery-prod-prepare.js "MIGRATION_DATABASE_URL=${SECRET_MIGRATION_DATABASE_URL}:latest"
job seed dist/scripts/seed-fa4-catalog.js "DATABASE_URL=${SECRET_MIGRATION_DATABASE_URL}:latest"
echo "Database ready (DRY_RUN=$DRY_RUN)."
