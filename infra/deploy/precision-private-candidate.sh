#!/usr/bin/env bash
# PRECISION — PRIVATE PRODUCTION CANDIDATE: gated, phase-by-phase deployment into the production environment (Terraform `envs/production`).
# NOTHING here has been executed against GCP. Pattern proven in staging/fa4-internal/deploy-gcp.sh; names follow the Terraform modules.
#
#   PROJECT=<prod project id> ./infra/deploy/precision-private-candidate.sh <phase>
#   phases, in order:  check  build  backup  migrate  prepare  deploy  smoke
#
# Read-only / non-destructive without approval: check, build, smoke.
# Everything that writes to the database or changes a service (backup, migrate, prepare, deploy) refuses to run unless
#   APPROVAL=PRIVATE_PRODUCTION_CANDIDATE_DEPLOYMENT_APPROVAL
# DRY_RUN=1 prints every gcloud command instead of running it. Secret VALUES are generated inside Secret Manager and never printed.
set -euo pipefail

PHASE=${1:-}
: "${PROJECT:?PROJECT (the production GCP project id) is required}"
REGION=${REGION:-northamerica-south1}
ENVN=${ENVN:-production}
TAG=${TAG:-$(git rev-parse --short HEAD)}
ACCESS_MEMBER=${ACCESS_MEMBER:-domain:beeside.you}              # who may open the private candidate through IAP
SQL_INSTANCE=${SQL_INSTANCE:-beeside-${ENVN}-canonical-db}
DB_NAME=${DB_NAME:-beeside}
AR_REPO=${AR_REPO:-beeside-${ENVN}}
REPO=${REGION}-docker.pkg.dev/${PROJECT}/${AR_REPO}
SQL_CONN=${PROJECT}:${REGION}:${SQL_INSTANCE}
BACKEND=${BACKEND:-beeside-${ENVN}-backend-api}
WEB=${WEB:-beeside-${ENVN}-frontend-app}
MIGRATE_JOB=${MIGRATE_JOB:-beeside-${ENVN}-migrate}            # created by Terraform (modules/migration-job), runs as the migration runner
CHECK_JOB=${CHECK_JOB:-beeside-${ENVN}-migrate-check}
ROLE_JOB=${ROLE_JOB:-beeside-${ENVN}-runtime-role}
MIG_SA=${MIG_SA:-beeside-${ENVN}-migration-runner@${PROJECT}.iam.gserviceaccount.com}
MIG_SECRET=${MIG_SECRET:-beeside-${ENVN}-migration-database-url}
RT_SA=${RT_SA:-beeside-${ENVN}-runtime@${PROJECT}.iam.gserviceaccount.com}   # dedicated runtime identity (created below, least privilege)
S_PW=precision-${ENVN}-db-runtime-password
S_HASH=precision-${ENVN}-hash-secret
S_URL=precision-${ENVN}-database-url
RT_USER=${RT_USER:-beeside_runtime}
DRY_RUN=${DRY_RUN:-0}

g() { if [ "$DRY_RUN" = 1 ]; then echo "+ gcloud --project $PROJECT $*"; else gcloud --project "$PROJECT" "$@"; fi; }
need_approval() { [ "${APPROVAL:-}" = "PRIVATE_PRODUCTION_CANDIDATE_DEPLOYMENT_APPROVAL" ] || { echo "REFUSED: phase '$PHASE' changes the production environment; set APPROVAL=PRIVATE_PRODUCTION_CANDIDATE_DEPLOYMENT_APPROVAL after the gate is approved." >&2; exit 3; }; }
secret_exists() { gcloud --project "$PROJECT" secrets describe "$1" >/dev/null 2>&1; }
ensure_secret() {
  if [ "$DRY_RUN" = 1 ]; then echo "+ ensure secret $1 (generated value, never printed)"; return 0; fi
  secret_exists "$1" || { printf '%s' "$2" | gcloud --project "$PROJECT" secrets create "$1" --data-file=- --replication-policy=automatic >/dev/null; echo "created secret $1"; }
}
run_job() { # name image script secrets env sa
  g run jobs deploy "$1" --region "$REGION" --image "$2" --command node --args "$3" --set-secrets "$4" --set-env-vars "$5" \
    --set-cloudsql-instances "$SQL_CONN" --service-account "$6" --max-retries 0 --task-timeout 300
  g run jobs execute "$1" --region "$REGION" --wait
}

case "$PHASE" in
check)
  echo "== read-only: identity, project, instance hardening"
  g auth list --filter=status:ACTIVE --format='value(account)'
  g projects describe "$PROJECT" --format='value(projectId,projectNumber)'
  g sql instances describe "$SQL_INSTANCE" --format='table(name,region,settings.tier,settings.availabilityType,settings.deletionProtectionEnabled,settings.backupConfiguration.enabled,settings.backupConfiguration.pointInTimeRecoveryEnabled)'
  if [ "$DRY_RUN" != 1 ]; then
    gcloud --project "$PROJECT" sql instances describe "$SQL_INSTANCE" --format=json | python3 -c '
import json, sys
s = json.load(sys.stdin)["settings"]
checks = {"REGIONAL availability": s.get("availabilityType") == "REGIONAL", "deletion protection": s.get("deletionProtectionEnabled") is True, "automated backups": s.get("backupConfiguration", {}).get("enabled") is True}
bad = [k for k, v in checks.items() if not v]
sys.exit("NOT production-grade: " + ", ".join(bad)) if bad else print("instance hardening OK")'
  fi
  g artifacts repositories describe "$AR_REPO" --location "$REGION" --format='value(name)'
  echo "== read-only migration state of the TARGET database (expects safe=true; expected=50; pending = what this build adds)"
  g run jobs deploy "$CHECK_JOB" --region "$REGION" --image "${REPO}/backend-api:${TAG}" --command node --args dist/scripts/migrate.js,--check \
    --set-secrets "MIGRATION_DATABASE_URL=${MIG_SECRET}:latest" --set-cloudsql-instances "$SQL_CONN" --service-account "$MIG_SA" --max-retries 0 --task-timeout 120
  g run jobs execute "$CHECK_JOB" --region "$REGION" --wait
  echo 'Read the job log for {"message":"migration state",...,"safe":true}. safe=false => STOP; do not touch the database.'
  ;;
build)
  # idempotent API enablement (Terraform's list does not include these two); changes no data
  g services enable cloudbuild.googleapis.com iap.googleapis.com
  g builds submit --config infra/deploy/cloudbuild-precision-candidate.yaml --substitutions "_REPO=${REPO},_TAG=${TAG}" .
  ;;
backup)
  need_approval
  g sql backups create --instance "$SQL_INSTANCE" --description "pre-precision-candidate-${TAG}"
  g sql backups list --instance "$SQL_INSTANCE" --limit 1 --format='table(id,type,status,windowStartTime)'
  echo "Proceed only if the newest backup status is SUCCESSFUL."
  ;;
migrate)
  need_approval
  echo "== apply migrations (migration identity). The job itself refuses an unsafe state before writing anything."
  g run jobs update "$MIGRATE_JOB" --region "$REGION" --image "${REPO}/backend-api:${TAG}" --command node --args dist/scripts/migrate.js
  g run jobs execute "$MIGRATE_JOB" --region "$REGION" --wait
  echo "== verify: expected applied=50 pending=[]"
  g run jobs execute "$CHECK_JOB" --region "$REGION" --wait
  ;;
prepare)
  need_approval
  echo "== dedicated runtime service account (least privilege)"
  gcloud --project "$PROJECT" iam service-accounts describe "$RT_SA" >/dev/null 2>&1 || g iam service-accounts create "beeside-${ENVN}-runtime" --display-name "beeside ${ENVN} runtime (Precision candidate)"
  echo "== secrets (values generated here, never printed)"
  RT_PW=$(openssl rand -hex 24)
  ensure_secret "$S_PW" "$RT_PW"
  [ "$DRY_RUN" = 1 ] || RT_PW=$(gcloud --project "$PROJECT" secrets versions access latest --secret "$S_PW")
  ensure_secret "$S_HASH" "$(openssl rand -hex 32)"
  ensure_secret "$S_URL" "postgres://${RT_USER}:${RT_PW}@/${DB_NAME}?host=/cloudsql/${SQL_CONN}"
  for s in "$S_PW" "$S_HASH" "$S_URL"; do g secrets add-iam-policy-binding "$s" --member "serviceAccount:${RT_SA}" --role roles/secretmanager.secretAccessor >/dev/null; done
  g secrets add-iam-policy-binding "$S_PW" --member "serviceAccount:${MIG_SA}" --role roles/secretmanager.secretAccessor >/dev/null
  g projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:${RT_SA}" --role roles/cloudsql.client --condition=None >/dev/null
  echo "== runtime login role (outside the migrations), verified by the job itself"
  run_job "$ROLE_JOB" "${REPO}/backend-api:${TAG}" dist/scripts/runtime-role-prepare.js "MIGRATION_DATABASE_URL=${MIG_SECRET}:latest,RUNTIME_DB_PASSWORD=${S_PW}:latest" "RUNTIME_DB_USER=${RT_USER}" "$MIG_SA"
  ;;
deploy)
  need_approval
  PNUM=$(gcloud --project "$PROJECT" projects describe "$PROJECT" --format='value(projectNumber)' 2>/dev/null || echo PNUM)
  WEB_URL=https://${WEB}-${PNUM}.${REGION}.run.app
  BACKEND_URL=https://${BACKEND}-${PNUM}.${REGION}.run.app
  COMMON=(--region "$REGION" --service-account "$RT_SA" --min-instances 0 --max-instances 2 --memory 512Mi --cpu 1)
  echo "== backend: private (no unauthenticated access, no public invoker), runtime identity only, NO migration credential"
  g run deploy "$BACKEND" "${COMMON[@]}" --image "${REPO}/backend-api:${TAG}" --no-allow-unauthenticated --add-cloudsql-instances "$SQL_CONN" \
    --set-env-vars "NODE_ENV=production,APP_BASE_URL=${WEB_URL},TRUST_PROXY_HOPS=2,PRECISION_API_ENABLED=true,PRECISION_ENTITLEMENT_PROVIDER=core,PRECISION_FA_CONTEXT_PROVIDER=discovery,PRECISION_UNDERSTANDING_INTERPRETER=rules,PRECISION_MODEL_PROVIDER=scripted,PRECISION_OH_PROVIDER=simulator,PRECISION_PUBLISH_MANIFESTS_ON_BOOT=true,PRECISION_KNOWLEDGE_SEED_ON_BOOT=true,FA4_API_ENABLED=true,FA4_ENV=staging,FA4_EMAIL_TRANSPORT=log" \
    --set-secrets "DATABASE_URL=${S_URL}:latest,SECURITY_HASH_SECRET=${S_HASH}:latest"
  echo "== web: private, calls the backend with a Google ID token, never indexed"
  g run deploy "$WEB" "${COMMON[@]}" --image "${REPO}/frontend-app:${TAG}" --no-allow-unauthenticated \
    --set-env-vars "API_UPSTREAM_URL=${BACKEND_URL},UPSTREAM_AUTH_AUDIENCE=${BACKEND_URL},ROBOTS_NOINDEX=true,ROOT_REDIRECT=/precision"
  # the same web service is also reachable at its other run.app hostname: allow that origin too (the browser Origin must match the API allow-list)
  ALT_WEB_URL=$([ "$DRY_RUN" = 1 ] && echo "https://<web status.url>" || gcloud --project "$PROJECT" run services describe "$WEB" --region "$REGION" --format 'value(status.url)')
  g run services update "$BACKEND" --region "$REGION" --update-env-vars "ALLOWED_ORIGINS=${ALT_WEB_URL}" >/dev/null
  g run services add-iam-policy-binding "$BACKEND" --region "$REGION" --member "serviceAccount:${RT_SA}" --role roles/run.invoker >/dev/null
  echo "== the gate: IAP on the web service, only ${ACCESS_MEMBER}"
  g beta run services update "$WEB" --region "$REGION" --iap
  g beta run services add-iam-policy-binding "$WEB" --region "$REGION" --member "serviceAccount:service-${PNUM}@gcp-sa-iap.iam.gserviceaccount.com" --role roles/run.invoker >/dev/null
  g iap web add-iam-policy-binding --resource-type=cloud-run --service "$WEB" --region "$REGION" --member "$ACCESS_MEMBER" --role roles/iap.httpsResourceAccessor >/dev/null
  echo "Private candidate: ${WEB_URL}/precision  (internal Google accounts only; do NOT distribute the URL)"
  ;;
smoke)
  PNUM=$(gcloud --project "$PROJECT" projects describe "$PROJECT" --format='value(projectNumber)')
  WEB_URL=https://${WEB}-${PNUM}.${REGION}.run.app; BACKEND_URL=https://${BACKEND}-${PNUM}.${REGION}.run.app
  code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }
  echo "S1 anonymous web:      $(code "$WEB_URL/precision")  (expect 302/401/403, never 200)"
  echo "S2 anonymous backend:  $(code "$BACKEND_URL/health/ready")  (expect 401/403, never 200)"
  echo "S3 anonymous API:      $(code "$WEB_URL/api/precision/center")  (expect 302/401/403)"
  echo "S4 backend ready (authenticated as the invoker): $(curl -s --max-time 20 -H "Authorization: Bearer $(gcloud auth print-identity-token --audiences="$BACKEND_URL")" "$BACKEND_URL/health/ready")  (expect {\"status\":\"ready\"})"
  g run jobs execute "$CHECK_JOB" --region "$REGION" --wait
  echo "S5 migration state must read: applied=50 pending=[] safe=true (see the job log)"
  echo "S6+ product checks through IAP: see docs/precision-private-production-candidate-go-no-go-2026-10-16.md section 7"
  ;;
*) echo "usage: PROJECT=<id> $0 {check|build|backup|migrate|prepare|deploy|smoke}"; exit 2 ;;
esac
