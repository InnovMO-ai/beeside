#!/usr/bin/env bash
# PRECISION — ESTABILIZACIÓN (STABILIZATION): gated, phase-by-phase deployment of Precision Center into the SAME GCP project and Cloud SQL instance as Discovery,
# against the ONE canonical database `beeside` (logical domain separation, db_domain_registry; migrations 0050/0051).
# NOTHING here has been executed against GCP. Written for the confirmed target: project beeside-discovery-prod, region northamerica-south1,
# instance discovery-db, database beeside (the legacy `discovery` database stays untouched during the transition).
#
#   ./infra/deploy/precision-stabilization.sh <phase>
#   phases, in order:  check  identities  build  backup  [infra/db/provision-beeside.sh pre]  migrate  [infra/db/provision-beeside.sh post]  prepare  seed  deploy  admin  baseline  smoke
#   transition (ESTABILIZACIÓN -> PRODUCCIÓN):  audit [REQUIRE_CLEAN=1]  — read-only verification that no fictitious customer/project data remains
#
# Read-only / non-destructive without approval: check, build, smoke, audit.
# Everything that writes to the database or changes a service/identity (identities, backup, migrate, prepare, seed, deploy, admin, baseline) refuses to run unless
#   APPROVAL=STABILIZATION_DEPLOYMENT_APPROVAL
# The database server itself (roles, the `beeside` database) is provisioned by infra/db/provision-beeside.sh, run by the Product Owner with his own admin
# credential and its own approval (CANONICAL_DB_PROVISION_APPROVED). This script never holds or sees the Cloud SQL admin credential.
#
# IDENTITIES (least privilege; none of them is Discovery's):
#   precision-backend@  runtime of the API. Reads ONLY its own secrets (database URL, hash secret, Control Center secrets). cloudsql.client on the instance only.
#   precision-web@      runtime of the web tier. Holds NO secret and NO database access; its only permission is run.invoker on the backend (it calls it with a Google ID token).
#   precision-migrate@  runs the migration / prepare / seed / audit jobs. Reads ONLY the migration database URL. cloudsql.client on the instance only.
# EXPOSURE: the backend has no unauthenticated access and no allUsers binding (invoker = precision-web only); the web is gated by IAP, only ACCESS_MEMBER.
#   Anonymous requests to either service must return 302/401/403 (smoke S1-S3). No load-balancer or Cloud Armor change is made here.
# POOLS: DB_POOL_MAX=3 + PRECISION_DB_POOL_MAX=8 per backend instance, max 2 instances (infra/db/connection-plan.json; `npm run db:connection-budget` must say OK).
# NOTE: `deploy` replaces the backend's env vars/secrets; run `admin` AFTER every `deploy` (it re-applies the Control Center sign-in configuration).
# DRY_RUN=1 prints every gcloud command instead of running it. Secret VALUES are never printed.
set -euo pipefail

PHASE=${1:-}
PROJECT=${PROJECT:-beeside-discovery-prod}
if [ "$PROJECT" != "beeside-discovery-prod" ] && [ "${ALLOW_OTHER_PROJECT:-0}" != 1 ]; then echo "REFUSED: PROJECT=$PROJECT is not the confirmed target (beeside-discovery-prod). Set ALLOW_OTHER_PROJECT=1 only for a rehearsal project." >&2; exit 2; fi
REGION=${REGION:-northamerica-south1}
TAG=${TAG:-$(git rev-parse --short HEAD)}
ACCESS_MEMBER=${ACCESS_MEMBER:-domain:beeside.you}              # who may open ESTABILIZACIÓN through IAP
SQL_INSTANCE=${SQL_INSTANCE:-discovery-db}
DB_NAME=${DB_NAME:-beeside}
AR_REPO=${AR_REPO:-precision}
REPO=${REGION}-docker.pkg.dev/${PROJECT}/${AR_REPO}
SQL_CONN=${PROJECT}:${REGION}:${SQL_INSTANCE}
BACKEND=${BACKEND:-precision-backend}
WEB=${WEB:-precision-web}
MIGRATE_JOB=${MIGRATE_JOB:-precision-migrate}
CHECK_JOB=${CHECK_JOB:-precision-migrate-check}
DOMAIN_JOB=${DOMAIN_JOB:-precision-domain-roles}
SEED_JOB=${SEED_JOB:-precision-kl-seed}                          # loads the INITIAL Knowledge Layer seed (never an empty layer in production)
ADMIN_JOB=${ADMIN_JOB:-precision-admin-bootstrap}
AUDIT_JOB=${AUDIT_JOB:-precision-stabilization-audit}
SEED_BUCKET=${SEED_BUCKET:-}                                     # private bucket holding manifest.json + the seed files (read-only mount); required by `seed`
REQUIRED_COUNTRIES=${REQUIRED_COUNTRIES:-MX}
ADMIN_OIDC_CLIENT_ID=${ADMIN_OIDC_CLIENT_ID:-}                    # the Google OAuth Web client (Internal, beeside.you) created in the console; required by `admin`
ADMIN_BOOTSTRAP_EMAIL=${ADMIN_BOOTSTRAP_EMAIL:-}                  # the first SUPER_ADMIN (a beeside.you account); required by `admin`
ADMIN_DOMAINS=${ADMIN_DOMAINS:-beeside.you}
# identities
BACKEND_SA_NAME=${BACKEND_SA_NAME:-precision-backend}; WEB_SA_NAME=${WEB_SA_NAME:-precision-web}; MIGRATE_SA_NAME=${MIGRATE_SA_NAME:-precision-migrate}
BACKEND_SA=${BACKEND_SA_NAME}@${PROJECT}.iam.gserviceaccount.com
WEB_SA=${WEB_SA_NAME}@${PROJECT}.iam.gserviceaccount.com
MIG_SA=${MIGRATE_SA_NAME}@${PROJECT}.iam.gserviceaccount.com
# secrets (created by infra/db/provision-beeside.sh: MIG_SECRET and S_URL; the rest by `identities` / `admin`)
MIG_SECRET=${MIG_SECRET:-beeside-migration-database-url}
S_URL=${S_URL:-precision-database-url}
S_HASH=${S_HASH:-precision-hash-secret}
S_ADMIN_OIDC_SECRET=${S_ADMIN_OIDC_SECRET:-precision-admin-oidc-client-secret}   # created by the operator in Secret Manager (never printed, never in this repo)
S_ADMIN_SESSION=${S_ADMIN_SESSION:-precision-admin-session-secret}
RT_USER=${RT_USER:-beeside_runtime}                                 # Precision runtime login in `beeside`
DISCOVERY_RUNTIME_LOGIN=${DISCOVERY_RUNTIME_LOGIN:-beeside_discovery_runtime}   # Discovery's runtime login in `beeside` (its own group beeside_discovery_rw)
SQL_CLIENT_CONDITION=${SQL_CLIENT_CONDITION:-1}                     # restrict roles/cloudsql.client to the one instance (IAM condition); set 0 if the condition syntax is rejected
DRY_RUN=${DRY_RUN:-0}

g() { if [ "$DRY_RUN" = 1 ]; then echo "+ gcloud --project $PROJECT $*" >&2; else gcloud --project "$PROJECT" "$@"; fi; }
need_approval() { [ "${APPROVAL:-}" = "STABILIZATION_DEPLOYMENT_APPROVAL" ] || { echo "REFUSED: phase '$PHASE' changes the production environment; set APPROVAL=STABILIZATION_DEPLOYMENT_APPROVAL after the gate is approved." >&2; exit 3; }; }
secret_exists() { gcloud --project "$PROJECT" secrets describe "$1" >/dev/null 2>&1; }
ensure_secret() {
  if [ "$DRY_RUN" = 1 ]; then echo "+ ensure secret $1 (generated value, never printed)"; return 0; fi
  secret_exists "$1" || { printf '%s' "$2" | gcloud --project "$PROJECT" secrets create "$1" --data-file=- --replication-policy=automatic >/dev/null; echo "created secret $1"; }
}
require_secret() { # a secret created by the operator / by provision-beeside.sh: this script never invents its value
  if [ "$DRY_RUN" = 1 ]; then echo "+ require secret $1 (created outside this script)"; return 0; fi
  secret_exists "$1" || { echo "STOP: secret $1 does not exist yet. $2" >&2; exit 4; }
}
grant_secret() { g secrets add-iam-policy-binding "$1" --member "serviceAccount:$2" --role roles/secretmanager.secretAccessor >/dev/null; }
sa_ensure() { # account-id display-name
  if [ "$DRY_RUN" = 1 ]; then echo "+ ensure service account $1"; return 0; fi
  gcloud --project "$PROJECT" iam service-accounts describe "$1@${PROJECT}.iam.gserviceaccount.com" >/dev/null 2>&1 || g iam service-accounts create "$1" --display-name "$2"; }
run_job() { # name image script secrets env sa
  g run jobs deploy "$1" --region "$REGION" --image "$2" --command node --args "$3" --set-secrets "$4" --set-env-vars "$5" \
    --set-cloudsql-instances "$SQL_CONN" --service-account "$6" --max-retries 0 --task-timeout 300
  g run jobs execute "$1" --region "$REGION" --wait
}
pnum() { if [ "$DRY_RUN" = 1 ]; then echo PNUM; else gcloud --project "$PROJECT" projects describe "$PROJECT" --format='value(projectNumber)'; fi; }

case "$PHASE" in
check)
  echo "== read-only: identity, project, instance hardening"
  g auth list --filter=status:ACTIVE --format='value(account)'
  g projects describe "$PROJECT" --format='value(projectId,projectNumber)'
  g sql instances describe "$SQL_INSTANCE" --format='table(name,region,settings.tier,settings.availabilityType,settings.deletionProtectionEnabled,settings.backupConfiguration.enabled,settings.backupConfiguration.pointInTimeRecoveryEnabled)'
  if [ "$DRY_RUN" != 1 ]; then
    gcloud --project "$PROJECT" sql instances describe "$SQL_INSTANCE" --format=json | REGION="$REGION" python3 -c '
import json, os, sys
d = json.load(sys.stdin); s = d["settings"]
checks = {"REGIONAL availability": s.get("availabilityType") == "REGIONAL", "deletion protection": s.get("deletionProtectionEnabled") is True,
          "automated backups": s.get("backupConfiguration", {}).get("enabled") is True, "point-in-time recovery": s.get("backupConfiguration", {}).get("pointInTimeRecoveryEnabled") is True,
          "region matches REGION": d.get("region") == os.environ["REGION"]}
bad = [k for k, v in checks.items() if not v]
sys.exit("NOT production-grade: " + ", ".join(bad)) if bad else print("instance hardening OK")'
    echo "== the canonical database must exist (created by infra/db/provision-beeside.sh pre)"
    gcloud --project "$PROJECT" sql databases list --instance "$SQL_INSTANCE" --format='value(name)' | grep -qx "$DB_NAME" && echo "database $DB_NAME present" || echo "database $DB_NAME NOT present yet (expected before provisioning)"
  fi
  echo "== read-only: Precision services must not be public (expect no allUsers / allAuthenticatedUsers)"
  g run services get-iam-policy "$BACKEND" --region "$REGION" --format='value(bindings.members)' || true
  echo "== read-only migration state of the TARGET database (expects safe=true; expected=52; pending = what this build adds)"
  g run jobs deploy "$CHECK_JOB" --region "$REGION" --image "${REPO}/backend-api:${TAG}" --command node --args dist/scripts/migrate.js,--check \
    --set-secrets "MIGRATION_DATABASE_URL=${MIG_SECRET}:latest" --set-cloudsql-instances "$SQL_CONN" --service-account "$MIG_SA" --max-retries 0 --task-timeout 120
  g run jobs execute "$CHECK_JOB" --region "$REGION" --wait
  echo 'Read the job log for {"message":"migration state",...,"safe":true}. safe=false => STOP; do not touch the database.'
  ;;
identities)
  need_approval
  echo "== service accounts (one per role; none is Discovery's)"
  sa_ensure "$BACKEND_SA_NAME" "Precision Center API runtime (ESTABILIZACIÓN)"
  sa_ensure "$WEB_SA_NAME" "Precision Center web tier (invoker of the backend only)"
  sa_ensure "$MIGRATE_SA_NAME" "Precision Center migration / prepare jobs"
  echo "== secrets: only what the backend itself needs; values generated here are never printed; connection strings come from infra/db/provision-beeside.sh"
  ensure_secret "$S_HASH" "$(openssl rand -hex 32)"
  require_secret "$MIG_SECRET" "Run: APPROVAL=CANONICAL_DB_PROVISION_APPROVED infra/db/provision-beeside.sh pre"
  grant_secret "$S_HASH" "$BACKEND_SA"
  grant_secret "$MIG_SECRET" "$MIG_SA"
  if [ "$DRY_RUN" = 1 ] || secret_exists "$S_URL"; then grant_secret "$S_URL" "$BACKEND_SA"
  else echo "note: $S_URL does not exist yet (created by provision-beeside.sh post); 'prepare' binds it to $BACKEND_SA_NAME"; fi
  echo "== Cloud SQL access: the backend and the migration jobs only, and only on the instance ${SQL_INSTANCE}"
  for sa in "$BACKEND_SA" "$MIG_SA"; do
    if [ "$SQL_CLIENT_CONDITION" = 1 ]; then
      g projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:${sa}" --role roles/cloudsql.client \
        --condition="title=precision-sql-instance-only,expression=resource.type == \"sqladmin.googleapis.com/Instance\" && resource.name == \"projects/${PROJECT}/instances/${SQL_INSTANCE}\"" >/dev/null
    else
      g projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:${sa}" --role roles/cloudsql.client --condition=None >/dev/null
    fi
  done
  echo "== image repository (created once, private)"
  if [ "$DRY_RUN" = 1 ] || ! gcloud --project "$PROJECT" artifacts repositories describe "$AR_REPO" --location "$REGION" >/dev/null 2>&1; then
    g artifacts repositories create "$AR_REPO" --repository-format docker --location "$REGION" --description "Precision Center images"
  fi
  g artifacts repositories add-iam-policy-binding "$AR_REPO" --location "$REGION" --member "serviceAccount:${BACKEND_SA}" --role roles/artifactregistry.reader >/dev/null
  g artifacts repositories add-iam-policy-binding "$AR_REPO" --location "$REGION" --member "serviceAccount:${MIG_SA}" --role roles/artifactregistry.reader >/dev/null
  g artifacts repositories add-iam-policy-binding "$AR_REPO" --location "$REGION" --member "serviceAccount:${WEB_SA}" --role roles/artifactregistry.reader >/dev/null
  echo "The web identity ${WEB_SA_NAME} holds no secret and no database role. Its invoker binding on the backend is added by 'deploy'."
  ;;
build)
  # idempotent API enablement (changes no data)
  g services enable cloudbuild.googleapis.com iap.googleapis.com
  g builds submit --config infra/deploy/cloudbuild-precision-stabilization.yaml --substitutions "_REPO=${REPO},_TAG=${TAG}" .
  ;;
backup)
  need_approval
  g sql backups create --instance "$SQL_INSTANCE" --description "pre-precision-stabilization-${TAG}"
  g sql backups list --instance "$SQL_INSTANCE" --limit 1 --format='table(id,type,status,windowStartTime)'
  echo "Backups are per INSTANCE (they include the legacy discovery database). Proceed only if the newest backup status is SUCCESSFUL."
  ;;
migrate)
  need_approval
  echo "== apply migrations to ${DB_NAME} (migration identity: the NOCREATEROLE owner beeside_migrate). The job itself refuses an unsafe state before writing anything."
  g run jobs deploy "$MIGRATE_JOB" --region "$REGION" --image "${REPO}/backend-api:${TAG}" --command node --args dist/scripts/migrate.js \
    --set-secrets "MIGRATION_DATABASE_URL=${MIG_SECRET}:latest" --set-cloudsql-instances "$SQL_CONN" --service-account "$MIG_SA" --max-retries 0 --task-timeout 600
  g run jobs execute "$MIGRATE_JOB" --region "$REGION" --wait
  echo "== verify: expected applied=52 pending=[]"
  g run jobs execute "$CHECK_JOB" --region "$REGION" --wait
  echo "Next: infra/db/provision-beeside.sh post (Precision login + memberships), then 'prepare'."
  ;;
prepare)
  need_approval
  require_secret "$S_URL" "Run: PHASE=post APPROVAL=CANONICAL_DB_PROVISION_APPROVED infra/db/provision-beeside.sh post"
  grant_secret "$S_URL" "$BACKEND_SA"
  echo "== data-domain roles (shared canonical database): verify the 17-point isolation contract with the logins provisioned for ${DB_NAME}"
  echo "   Discovery login ${DISCOVERY_RUNTIME_LOGIN} -> beeside_discovery_rw only; Precision login ${RT_USER} -> beeside_runtime_role only, read-only on Discovery's 14 tables. The job fails if anything differs."
  run_job "$DOMAIN_JOB" "${REPO}/backend-api:${TAG}" dist/scripts/domain-roles-prepare.js "MIGRATION_DATABASE_URL=${MIG_SECRET}:latest" "DISCOVERY_RUNTIME_LOGIN=${DISCOVERY_RUNTIME_LOGIN},PRECISION_RUNTIME_LOGIN=${RT_USER}" "$MIG_SA"
  ;;
seed)
  need_approval
  : "${SEED_BUCKET:?SEED_BUCKET (private bucket with manifest.json and the initial Knowledge Layer files) is required}"
  echo "== initial Knowledge Layer seed: the first connection is NEVER an empty layer (idempotent; unchanged files are skipped, changed ones become new versions)"
  g run jobs deploy "$SEED_JOB" --region "$REGION" --image "${REPO}/backend-api:${TAG}" --command node --args dist/scripts/kl-seed.js,--manifest,/seed/manifest.json,--countries,"$REQUIRED_COUNTRIES" \
    --set-secrets "DATABASE_URL=${MIG_SECRET}:latest" --add-volume "name=seed,type=cloud-storage,bucket=${SEED_BUCKET},readonly=true" --add-volume-mount "volume=seed,mount-path=/seed" \
    --set-cloudsql-instances "$SQL_CONN" --service-account "$MIG_SA" --max-retries 0 --task-timeout 900
  g run jobs execute "$SEED_JOB" --region "$REGION" --wait
  echo 'The job fails (exit 1) unless every required country has published knowledge. `deploy` then starts the backend with PRECISION_REQUIRE_KNOWLEDGE_SEED=true.'
  ;;
deploy)
  need_approval
  PNUM=$(pnum)
  WEB_URL=https://${WEB}-${PNUM}.${REGION}.run.app
  BACKEND_URL=https://${BACKEND}-${PNUM}.${REGION}.run.app
  echo "== backend: no unauthenticated access and no public invoker binding; ingress all but the invoker is the web identity only (anonymous = 403). Runtime identity ${BACKEND_SA_NAME}; NO migration credential."
  g run deploy "$BACKEND" --region "$REGION" --service-account "$BACKEND_SA" --min-instances 0 --max-instances 2 --memory 512Mi --cpu 1 --concurrency 40 \
    --image "${REPO}/backend-api:${TAG}" --no-allow-unauthenticated --ingress all --add-cloudsql-instances "$SQL_CONN" \
    --set-env-vars "NODE_ENV=production,APP_BASE_URL=${WEB_URL},TRUST_PROXY_HOPS=2,DB_POOL_MAX=3,PRECISION_DB_POOL_MAX=8,DB_APPLICATION_NAME=precision-backend,PRECISION_API_ENABLED=true,PRECISION_ENTITLEMENT_PROVIDER=core,PRECISION_FA_CONTEXT_PROVIDER=discovery,PRECISION_UNDERSTANDING_INTERPRETER=rules,PRECISION_MODEL_PROVIDER=scripted,PRECISION_OH_PROVIDER=simulator,PRECISION_PUBLISH_MANIFESTS_ON_BOOT=true,PRECISION_KNOWLEDGE_SEED_ON_BOOT=true,PRECISION_REQUIRE_KNOWLEDGE_SEED=true,PRECISION_REQUIRED_KNOWLEDGE_COUNTRIES=${REQUIRED_COUNTRIES},FA4_API_ENABLED=false" \
    --set-secrets "DATABASE_URL=${S_URL}:latest,SECURITY_HASH_SECRET=${S_HASH}:latest"
  echo "== web: its own identity (no secrets, no database), calls the backend with a Google ID token, never indexed"
  g run deploy "$WEB" --region "$REGION" --service-account "$WEB_SA" --min-instances 0 --max-instances 2 --memory 256Mi --cpu 1 \
    --image "${REPO}/frontend-app:${TAG}" --no-allow-unauthenticated --ingress all \
    --set-env-vars "API_UPSTREAM_URL=${BACKEND_URL},UPSTREAM_AUTH_AUDIENCE=${BACKEND_URL},ROBOTS_NOINDEX=true,ROOT_REDIRECT=/precision"
  # the same web service is also reachable at its other run.app hostname: allow that origin too (the browser Origin must match the API allow-list)
  ALT_WEB_URL=$([ "$DRY_RUN" = 1 ] && echo "https://<web status.url>" || gcloud --project "$PROJECT" run services describe "$WEB" --region "$REGION" --format 'value(status.url)')
  g run services update "$BACKEND" --region "$REGION" --update-env-vars "ALLOWED_ORIGINS=${ALT_WEB_URL}" >/dev/null
  g run services add-iam-policy-binding "$BACKEND" --region "$REGION" --member "serviceAccount:${WEB_SA}" --role roles/run.invoker >/dev/null
  echo "== the gate: IAP on the web service, only ${ACCESS_MEMBER}"
  g beta run services update "$WEB" --region "$REGION" --iap
  g beta run services add-iam-policy-binding "$WEB" --region "$REGION" --member "serviceAccount:service-${PNUM}@gcp-sa-iap.iam.gserviceaccount.com" --role roles/run.invoker >/dev/null
  g iap web add-iam-policy-binding --resource-type=cloud-run --service "$WEB" --region "$REGION" --member "$ACCESS_MEMBER" --role roles/iap.httpsResourceAccessor >/dev/null
  echo "ESTABILIZACIÓN: ${WEB_URL}/precision  (internal Google accounts only; do NOT distribute the URL)"
  ;;
admin)
  need_approval
  : "${ADMIN_OIDC_CLIENT_ID:?ADMIN_OIDC_CLIENT_ID (Google OAuth Web client, Internal) is required}"
  : "${ADMIN_BOOTSTRAP_EMAIL:?ADMIN_BOOTSTRAP_EMAIL (first SUPER_ADMIN, a ${ADMIN_DOMAINS} account) is required}"
  PNUM=$(pnum)
  WEB_URL=https://${WEB}-${PNUM}.${REGION}.run.app
  echo "== Control Center sign-in reuses the organization's Google identity (standard OIDC; no separate identity provider)"
  require_secret "$S_ADMIN_OIDC_SECRET" "Create it from the OAuth client secret in Secret Manager (never paste it in chat)."
  ensure_secret "$S_ADMIN_SESSION" "$(openssl rand -hex 32)"
  for s in "$S_ADMIN_OIDC_SECRET" "$S_ADMIN_SESSION"; do grant_secret "$s" "$BACKEND_SA"; done
  g run services update "$BACKEND" --region "$REGION" \
    --update-env-vars "ADMIN_API_ENABLED=true,ADMIN_APP_ORIGIN=${WEB_URL},ADMIN_OIDC_ISSUER=https://accounts.google.com,ADMIN_OIDC_CLIENT_ID=${ADMIN_OIDC_CLIENT_ID},ADMIN_OIDC_REDIRECT_URI=${WEB_URL}/api/admin/auth/callback,ADMIN_ALLOWED_EMAIL_DOMAINS=${ADMIN_DOMAINS}" \
    --update-secrets "ADMIN_OIDC_CLIENT_SECRET=${S_ADMIN_OIDC_SECRET}:latest,ADMIN_SESSION_SECRET=${S_ADMIN_SESSION}:latest"
  echo "== first SUPER_ADMIN (one-time, audited; refuses if one already exists; creates no credential)"
  g run jobs deploy "$ADMIN_JOB" --region "$REGION" --image "${REPO}/backend-api:${TAG}" --command node --args dist/scripts/admin-bootstrap.js \
    --set-secrets "DATABASE_URL=${MIG_SECRET}:latest" --set-env-vars "ADMIN_BOOTSTRAP_EMAIL=${ADMIN_BOOTSTRAP_EMAIL},ADMIN_ALLOWED_EMAIL_DOMAINS=${ADMIN_DOMAINS}" \
    --set-cloudsql-instances "$SQL_CONN" --service-account "$MIG_SA" --max-retries 0 --task-timeout 120
  g run jobs execute "$ADMIN_JOB" --region "$REGION" --wait
  echo "Register ${WEB_URL}/api/admin/auth/callback as the authorized redirect URI of the OAuth client (console). Control Center: ${WEB_URL}/admin (IAP + Google sign-in; /ops-control is reserved and shows 'Not available')."
  ;;
baseline)
  need_approval
  echo "== clean baseline: run AFTER seed+admin and BEFORE any fictitious data is entered. It is the cheapest way back to a clean database at the PRODUCCIÓN transition."
  g sql backups create --instance "$SQL_INSTANCE" --description "precision-stabilization-clean-baseline-${TAG}"
  g sql backups list --instance "$SQL_INSTANCE" --limit 1 --format='table(id,type,status,windowStartTime,description)'
  echo "Record the backup id. Restoring it (or a gated, registry-driven purge) is decided and approved separately at the PRODUCCIÓN transition. Backups are per INSTANCE: a restore also rewinds the legacy discovery database."
  ;;
audit)
  echo "== read-only: classifies every table with the privacy erasure registry; counts only, no row content"
  AUDIT_ARGS=dist/scripts/stabilization-audit.js
  [ "${REQUIRE_CLEAN:-0}" = 1 ] && AUDIT_ARGS=dist/scripts/stabilization-audit.js,--require-clean
  g run jobs deploy "$AUDIT_JOB" --region "$REGION" --image "${REPO}/backend-api:${TAG}" --command node --args "$AUDIT_ARGS" \
    --set-secrets "DATABASE_URL=${MIG_SECRET}:latest" --set-cloudsql-instances "$SQL_CONN" --service-account "$MIG_SA" --max-retries 0 --task-timeout 120
  g run jobs execute "$AUDIT_JOB" --region "$REGION" --wait
  echo "REQUIRE_CLEAN=1 fails the job (exit 1) while any customer/project test data or unclassified table remains. The job log is the evidence."
  ;;
smoke)
  PNUM=$(pnum)
  WEB_URL=https://${WEB}-${PNUM}.${REGION}.run.app; BACKEND_URL=https://${BACKEND}-${PNUM}.${REGION}.run.app
  code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }
  echo "S1 anonymous web:      $(code "$WEB_URL/precision")  (expect 302/401/403, never 200)"
  echo "S2 anonymous backend:  $(code "$BACKEND_URL/health/ready")  (expect 401/403, never 200)"
  echo "S3 anonymous API:      $(code "$WEB_URL/api/precision/center")  (expect 302/401/403)"
  echo "S4 backend ready (authenticated as the invoker): $(curl -s --max-time 20 -H "Authorization: Bearer $(gcloud auth print-identity-token --audiences="$BACKEND_URL")" "$BACKEND_URL/health/ready")  (expect {\"status\":\"ready\"})"
  echo "S4b the web identity holds no secret: $(gcloud --project "$PROJECT" run services describe "$WEB" --region "$REGION" --format='value(spec.template.spec.containers[0].env)' | grep -ci secret) secret references (expect 0)"
  g run jobs execute "$CHECK_JOB" --region "$REGION" --wait
  echo "S5 migration state must read: applied=52 pending=[] safe=true (see the job log)"
  echo "S6 knowledge layer is not empty (read-only):"
  g run jobs update "$SEED_JOB" --region "$REGION" --args dist/scripts/kl-seed.js,--check,--countries,"$REQUIRED_COUNTRIES"
  g run jobs execute "$SEED_JOB" --region "$REGION" --wait
  echo "S7 Discovery is unaffected: its own smoke (anonymous 403 on the backend, gate on the web) must read the same as before this deployment."
  echo "S8+ product checks through IAP: see docs/precision-stabilization-go-no-go-2026-10-16.md section 7"
  ;;
*) echo "usage: $0 {check|identities|build|backup|migrate|prepare|seed|deploy|admin|baseline|audit|smoke}   (project beeside-discovery-prod; see the header for the order)"; exit 2 ;;
esac
