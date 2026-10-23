#!/usr/bin/env bash
# PRECISION V2.0 — canonical database `beeside` on the existing Cloud SQL instance (shared by Discovery and Precision Center).
# RUN BY THE PRODUCT OWNER in his own Terminal, with his own Cloud SQL admin credential, only after WRITTEN approval. NOTHING here has been executed against GCP.
# The admin credential is typed at a hidden prompt (or already exported as PROVISION_ADMIN_URL); it is never printed, never written to disk, never sent to chat.
#
#   plan    read-only: connects, prints what would be created/changed. Needs no passwords.      (safe to run first)
#   verify  read-only: measures the provisioned state against the contract                        PHASE=pre|post
#   pre     APPROVAL=CANONICAL_DB_PROVISION_APPROVED   groups, migrator, Discovery login, database `beeside`, CONNECT      -> then run the migrations (precision-stabilization.sh migrate)
#   post    APPROVAL=CANONICAL_DB_PROVISION_APPROVED   Precision login + group memberships                                -> then precision-stabilization.sh prepare
#
# Connection: start the Cloud SQL Auth Proxy yourself, e.g.  cloud-sql-proxy beeside-discovery-prod:northamerica-south1:discovery-db --port 5434
# and answer the prompts. The legacy `discovery` database is NOT modified (unless LEGACY_HARDEN=yes is added, a separately approved, reversible step).
# Passwords: 3 random values created in Secret Manager on first use (never printed) and reused afterwards; the logins are set to exactly those values on every run.
# DRY_RUN=1 prints the gcloud commands instead of running them.  SECRET_STORE=dir:/path uses files instead of Secret Manager (local rehearsals only).
set -euo pipefail
MODE=${1:-}; PHASE=${PHASE:-pre}
HERE=$(cd "$(dirname "$0")" && pwd); BACKEND_DIR=${BACKEND_DIR:-$HERE/../../backend}
PROJECT=${PROJECT:-beeside-discovery-prod}; REGION=${REGION:-northamerica-south1}; SQL_INSTANCE=${SQL_INSTANCE:-discovery-db}
DB_NAME=${CANONICAL_DB:-beeside}; SQL_CONN=${PROJECT}:${REGION}:${SQL_INSTANCE}
MIGRATOR=${MIGRATOR_LOGIN:-beeside_migrate}; DISC_LOGIN=${DISCOVERY_RUNTIME_LOGIN:-beeside_discovery_runtime}; PREC_LOGIN=${PRECISION_RUNTIME_LOGIN:-beeside_runtime}
S_MIG_PW=${S_MIG_PW:-beeside-migrate-password};  S_DISC_PW=${S_DISC_PW:-beeside-discovery-runtime-password};  S_PREC_PW=${S_PREC_PW:-beeside-runtime-password}
S_MIG_URL=${S_MIG_URL:-beeside-migration-database-url}; S_PREC_URL=${S_PREC_URL:-precision-database-url}; S_DISC_URL=${S_DISC_URL:-discovery-beeside-database-url}
DRY_RUN=${DRY_RUN:-0}; SECRET_STORE=${SECRET_STORE:-gcp}

[ "$PHASE" = pre ] || [ "$PHASE" = post ] || { echo "PHASE must be pre or post" >&2; exit 2; }
[ -f "$BACKEND_DIR/dist/scripts/canonical-db-provision.js" ] || { echo "build the backend first (npm run build --workspace=backend): dist/scripts/canonical-db-provision.js is missing" >&2; exit 2; }

# ---- secret store -------------------------------------------------------------------------------------------------------------------------------------------------
secret_exists() { case "$SECRET_STORE" in dir:*) [ -f "${SECRET_STORE#dir:}/$1" ];; *) gcloud --project "$PROJECT" secrets describe "$1" >/dev/null 2>&1;; esac; }
secret_read()   { case "$SECRET_STORE" in dir:*) cat "${SECRET_STORE#dir:}/$1";; *) gcloud --project "$PROJECT" secrets versions access latest --secret "$1";; esac; }
secret_create() { # name value  (value arrives on stdin, never on a command line)
  case "$SECRET_STORE" in
    dir:*) ( umask 077; mkdir -p "${SECRET_STORE#dir:}"; cat > "${SECRET_STORE#dir:}/$1" );;
    *) gcloud --project "$PROJECT" secrets create "$1" --data-file=- --replication-policy=automatic >/dev/null;;
  esac
}
ensure_password() { # secret name -> prints nothing; creates a 48-hex-char random password when missing
  if [ "$DRY_RUN" = 1 ]; then echo "+ ensure secret $1 (random 48 hex chars, never printed)"; return 0; fi
  if secret_exists "$1"; then echo "secret $1: exists, reused"; else openssl rand -hex 24 | secret_create "$1"; echo "secret $1: created"; fi
}
ensure_url() { # secret name, login, password-secret
  if [ "$DRY_RUN" = 1 ]; then echo "+ ensure secret $1 (connection string for $2, never printed)"; return 0; fi
  if secret_exists "$1"; then echo "secret $1: exists, left as is"; return 0; fi
  printf 'postgres://%s:%s@/%s?host=/cloudsql/%s' "$2" "$(secret_read "$3")" "$DB_NAME" "$SQL_CONN" | secret_create "$1"; echo "secret $1: created"
}

# ---- admin connection (hidden prompt; never echoed) ---------------------------------------------------------------------------------------------------------------
if [ -z "${PROVISION_ADMIN_URL:-}" ]; then
  PROXY_PORT=${PROXY_PORT:-5434}; ADMIN_USER=${ADMIN_USER:-postgres}
  printf 'Cloud SQL admin user [%s]: ' "$ADMIN_USER" >&2; read -r u; ADMIN_USER=${u:-$ADMIN_USER}
  printf 'Password for %s (hidden): ' "$ADMIN_USER" >&2; read -rs ADMIN_PW; echo >&2
  PROVISION_ADMIN_URL=$(ADMIN_USER=$ADMIN_USER ADMIN_PW=$ADMIN_PW PORT=$PROXY_PORT node -e 'const e=encodeURIComponent;process.stdout.write(`postgres://${e(process.env.ADMIN_USER)}:${e(process.env.ADMIN_PW)}@127.0.0.1:${process.env.PORT}/postgres`)')
  unset ADMIN_PW
fi
export PROVISION_ADMIN_URL
# POST needs, once, the role that created the legacy Precision group (production: discovery_migrate) for the single GRANT into beeside_runtime_role,
# unless the admin already holds ADMIN OPTION on it (`plan` says which). Also needed for LEGACY_HARDEN=yes (the owner of the legacy database).
if { [ "$MODE" = post ] || [ "$MODE" = plan -a "$PHASE" = post ] || [ "${LEGACY_HARDEN:-}" = yes ]; } && [ -z "${LEGACY_GROUP_ADMIN_URL:-}" ] && [ -t 0 ]; then
  printf 'Legacy group owner (discovery_migrate) password, hidden; Enter to skip if the plan does not need it: ' >&2; read -rs LPW; echo >&2
  if [ -n "$LPW" ]; then
    LEGACY_GROUP_ADMIN_URL=$(LU=${LEGACY_OWNER:-discovery_migrate} LPW=$LPW PORT=${PROXY_PORT:-5434} node -e 'const e=encodeURIComponent;process.stdout.write(`postgres://${e(process.env.LU)}:${e(process.env.LPW)}@127.0.0.1:${process.env.PORT}/postgres`)')
    export LEGACY_GROUP_ADMIN_URL
  fi
  unset LPW
fi
run_cli() { ( cd "$BACKEND_DIR" && PHASE="$PHASE" node dist/scripts/canonical-db-provision.js ); }

case "$MODE" in
plan)   MODE=plan   run_cli ;;
verify) MODE=verify run_cli ;;
pre|post)
  [ "${APPROVAL:-}" = "CANONICAL_DB_PROVISION_APPROVED" ] || { echo "REFUSED: '$MODE' changes the production database server; set APPROVAL=CANONICAL_DB_PROVISION_APPROVED after the written approval." >&2; exit 3; }
  [ "$MODE" = "$PHASE" ] || PHASE=$MODE
  for s in "$S_MIG_PW" "$S_DISC_PW"; do ensure_password "$s"; done
  [ "$PHASE" = post ] && ensure_password "$S_PREC_PW"
  if [ "$DRY_RUN" = 1 ]; then echo "+ (DRY_RUN) would now run: MODE=apply PHASE=$PHASE canonical-db-provision with the passwords read from Secret Manager"; exit 0; fi
  MIGRATE_DB_PASSWORD=$(secret_read "$S_MIG_PW"); DISCOVERY_RUNTIME_DB_PASSWORD=$(secret_read "$S_DISC_PW")
  RUNTIME_DB_PASSWORD=""; [ "$PHASE" = post ] && RUNTIME_DB_PASSWORD=$(secret_read "$S_PREC_PW")
  export MIGRATE_DB_PASSWORD DISCOVERY_RUNTIME_DB_PASSWORD RUNTIME_DB_PASSWORD
  CANONICAL_DB_PROVISION_APPROVED=yes MODE=apply run_cli
  if [ "$PHASE" = pre ]; then ensure_url "$S_MIG_URL" "$MIGRATOR" "$S_MIG_PW"; ensure_url "$S_DISC_URL" "$DISC_LOGIN" "$S_DISC_PW"
  else ensure_url "$S_PREC_URL" "$PREC_LOGIN" "$S_PREC_PW"; fi
  echo "next: $( [ "$PHASE" = pre ] && echo 'run the migrations (precision-stabilization.sh migrate), then PHASE=post' || echo 'precision-stabilization.sh prepare (domain-roles-prepare verifies the 17-point contract)')"
  ;;
*) echo "usage: [PHASE=pre|post] $0 {plan|verify|pre|post}"; exit 2 ;;
esac
