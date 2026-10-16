#!/usr/bin/env bash
# Discovery production — platform provisioning (idempotent). Creates the GCP resources that the deployment script assumes but never creates:
# project baseline, Artifact Registry, service accounts, Cloud SQL (HA, backups, PITR), database + roles, Secret Manager secrets (values generated here, NEVER printed),
# IAM, and a reserved global IP for the load balancer. It does NOT create the load balancer, certificate, DNS or any public exposure, and it deploys no service.
#
#   DRY_RUN=1 (default) prints; DRY_RUN=0 executes.   bash deploy/production/provision-infra.sh
set -euo pipefail
PROJECT_ID=${PROJECT_ID:-beeside-discovery-prod}
REGION=${REGION:-northamerica-south1}
SQL_INSTANCE=${SQL_INSTANCE:-discovery-db}
SQL_TIER=${SQL_TIER:-db-custom-1-3840}
DB_NAME=${DB_NAME:-discovery}
DRY_RUN=${DRY_RUN:-1}
# the echoed command masks any password argument: no secret value ever reaches a terminal or a log
run() { echo "+ $*" | sed -E 's/(--password|--root-password) [^ ]+/\1 ***/g'; if [ "$DRY_RUN" = "0" ]; then local n=0; until "$@"; do n=$((n+1)); [ $n -ge 6 ] && return 1; echo "  (retry $n: eventual consistency)"; sleep 8; done; fi; }
g() { gcloud --project "$PROJECT_ID" "$@"; }
exists() { g "$@" >/dev/null 2>&1; }
rand() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "${1:-32}"; }
PNUM=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
SQL_CONN="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
SA() { echo "discovery-$1@${PROJECT_ID}.iam.gserviceaccount.com"; }

echo "== Artifact Registry"
exists artifacts repositories describe discovery --location "$REGION" || run g artifacts repositories create discovery --repository-format docker --location "$REGION" --description "Discovery production images"

echo "== service accounts (one per role; no keys are ever created)"
for r in backend web worker migrate build; do
  exists iam service-accounts describe "$(SA $r)" || run g iam service-accounts create "discovery-$r" --display-name "Discovery production — $r"
done
run g projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$(SA build)" --role roles/logging.logWriter --condition=None
run g artifacts repositories add-iam-policy-binding discovery --location "$REGION" --member "serviceAccount:$(SA build)" --role roles/artifactregistry.writer
exists storage buckets describe "gs://${PROJECT_ID}_cloudbuild" || run g storage buckets create "gs://${PROJECT_ID}_cloudbuild" --location "$REGION" --uniform-bucket-level-access
run g storage buckets add-iam-policy-binding "gs://${PROJECT_ID}_cloudbuild" --member "serviceAccount:$(SA build)" --role roles/storage.objectViewer
for r in backend worker migrate; do
  run g projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$(SA $r)" --role roles/cloudsql.client --condition=None
  run g projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$(SA $r)" --role roles/logging.logWriter --condition=None
done
run g projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$(SA web)" --role roles/logging.logWriter --condition=None

ROOT_PW=$( [ "$DRY_RUN" = "0" ] && rand 40 || echo x )
echo "== Cloud SQL (Postgres 16, regional HA, daily backups 14 d, PITR 7 d, deletion protection, TLS only, no authorized networks)"
if ! exists sql instances describe "$SQL_INSTANCE"; then
  run g sql instances create "$SQL_INSTANCE" --database-version POSTGRES_16 --region "$REGION" --edition ENTERPRISE --tier "$SQL_TIER" \
    --availability-type REGIONAL --storage-type SSD --storage-size 20 --storage-auto-increase \
    --backup-start-time 07:00 --retained-backups-count 14 --enable-point-in-time-recovery --retained-transaction-log-days 7 \
    --maintenance-window-day SUN --maintenance-window-hour 9 --deletion-protection --ssl-mode ENCRYPTED_ONLY \
    --database-flags cloudsql.iam_authentication=off --root-password "$ROOT_PW"
fi
secret() { # name value-producer-fn  — creates the secret + first version only if it does not exist
  if exists secrets describe "$1"; then echo "secret $1 exists (unchanged)"; return; fi
  run g secrets create "$1" --replication-policy automatic
  if [ "$DRY_RUN" = "0" ]; then printf '%s' "$2" | g secrets versions add "$1" --data-file=- >/dev/null; else echo "+ (add generated version to $1)"; fi
}
secret discovery-postgres-root-password "$ROOT_PW"   # break-glass superuser password, only in Secret Manager
exists sql databases describe "$DB_NAME" --instance "$SQL_INSTANCE" || run g sql databases create "$DB_NAME" --instance "$SQL_INSTANCE"

echo "== secrets (generated here, stored only in Secret Manager; values are never printed)"
MIG_PW=$( [ "$DRY_RUN" = "0" ] && rand 32 || echo x ); RT_PW=$( [ "$DRY_RUN" = "0" ] && rand 32 || echo x )
if ! exists secrets describe discovery-migration-db-url; then
  run g sql users create discovery_migrate --instance "$SQL_INSTANCE" --password "$MIG_PW"
  run g sql users create discovery_runtime --instance "$SQL_INSTANCE" --password "$RT_PW"
  secret discovery-migration-db-url "postgres://discovery_migrate:${MIG_PW}@/${DB_NAME}?host=/cloudsql/${SQL_CONN}"
  secret discovery-db-url "postgres://discovery_runtime:${RT_PW}@/${DB_NAME}?host=/cloudsql/${SQL_CONN}"
else echo "database credentials secrets exist (users and secrets unchanged)"; fi
secret discovery-hash-secret "$( [ "$DRY_RUN" = "0" ] && rand 48 || echo x )"
GATE_USER=${GATE_USER:-team}
secret discovery-access-gate-credentials "${GATE_USER}:$( [ "$DRY_RUN" = "0" ] && rand 24 || echo x )"
# SMTP: only the (empty) secret CONTAINER is created. Its VALUE is the Google Workspace app password for contact@beeside.you and is loaded directly into Secret Manager by its owner;
# no process of ours ever receives, prints or logs it.
exists secrets describe discovery-smtp-password || run g secrets create discovery-smtp-password --replication-policy automatic
bind() { run g secrets add-iam-policy-binding "$1" --member "serviceAccount:$(SA $2)" --role roles/secretmanager.secretAccessor; }
bind discovery-db-url backend; bind discovery-db-url worker
bind discovery-hash-secret backend; bind discovery-hash-secret worker
bind discovery-smtp-password backend; bind discovery-smtp-password worker
bind discovery-migration-db-url migrate
bind discovery-access-gate-credentials web

echo "== reserved global IP for the future load balancer (no LB, no certificate, no DNS here)"
exists compute addresses describe discovery-lb-ip --global || run g compute addresses create discovery-lb-ip --global --ip-version IPV4

echo "Provisioning done (DRY_RUN=$DRY_RUN). Next: deploy/production/RUNBOOK.md §1. Read the gate password with:  gcloud secrets versions access latest --secret discovery-access-gate-credentials --project $PROJECT_ID"
