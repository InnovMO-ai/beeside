#!/usr/bin/env bash
# Deletes ALL data generated during the STABILIZATION stage (fictitious data) before real use. Keeps the schema and the catalog. Refuses if any real (non-test) consent exists.
#   PLAN (read-only, deletes nothing):  DRY_RUN=0 RESET_MODE=plan IMAGE_TAG=<sha> bash deploy/production/reset-stabilization-data.sh
#   RESET:  DRY_RUN=0 RESET_CONFIRM=DELETE-ALL-STABILIZATION-DATA IMAGE_TAG=<sha> bash deploy/production/reset-stabilization-data.sh
# No TRUNCATE/CASCADE: it refuses (deleting nothing) when another domain holds rows that reference Discovery records (a promoted project).
set -euo pipefail
PROJECT_ID=${PROJECT_ID:-beeside-discovery-prod}; REGION=${REGION:-northamerica-south1}; SQL_INSTANCE=${SQL_INSTANCE:-discovery-db}
IMAGE_TAG=${IMAGE_TAG:?set IMAGE_TAG (an image that contains dist/scripts/discovery-stabilization-reset.js)}; DRY_RUN=${DRY_RUN:-1}
REPO="${REGION}-docker.pkg.dev/${PROJECT_ID}/discovery"
run() { echo "+ $*"; if [ "$DRY_RUN" = "0" ]; then "$@"; fi; }
if [ "$DRY_RUN" = "0" ] && [ "${RESET_MODE:-}" != "plan" ]; then [ "${RESET_CONFIRM:-}" = "DELETE-ALL-STABILIZATION-DATA" ] || { echo "RESET_CONFIRM=DELETE-ALL-STABILIZATION-DATA is required (or RESET_MODE=plan for the read-only plan)"; exit 3; }; fi
run gcloud --project "$PROJECT_ID" run jobs deploy discovery-reset --region "$REGION" --image "${REPO}/discovery-backend:${IMAGE_TAG}" --command node --args dist/scripts/discovery-stabilization-reset.js \
  --set-cloudsql-instances "${PROJECT_ID}:${REGION}:${SQL_INSTANCE}" --service-account "discovery-migrate@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-secrets "MIGRATION_DATABASE_URL=discovery-migration-db-url:latest" --set-env-vars "NODE_ENV=production,RESET_CONFIRM=${RESET_CONFIRM:-NOT-CONFIRMED},RESET_MODE=${RESET_MODE:-}" --max-retries 0
run gcloud --project "$PROJECT_ID" run jobs execute discovery-reset --region "$REGION" --wait
run gcloud --project "$PROJECT_ID" run jobs delete discovery-reset --region "$REGION" --quiet
echo "Done (DRY_RUN=$DRY_RUN). Also purge test mailbox messages (contact+smoke-*@beeside.you) and reviewers' browsers (sessionStorage) manually if needed."
