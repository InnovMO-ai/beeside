#!/usr/bin/env bash
# CI + local: database-backed backend suites, each runtime-role suite in its OWN database.
# Root cause it fixes (CI 2026-10-16, job fa4-postgres): fa4-verify publishes a catalog version (leak test, data committed)
# and fa4-v1-delivery, sharing the same database, then sealed results against that version instead of the seed catalog.
# The suites document "use a dedicated database"; the workflow shared one. No assertion is relaxed here.
# Requires: PGHOST/PGUSER/PGPASSWORD of a superuser on a throwaway PostgreSQL (CI service container). Never point it at a real database.
set -euo pipefail
: "${PGHOST:?}" "${PGUSER:?}" "${PGPASSWORD:?}"
case "$PGHOST" in 127.0.0.1|localhost) ;; *) echo "refusing: PGHOST must be a local throwaway server"; exit 2;; esac
PGPORT=${PGPORT:-5432}; ADM="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}"
cd "$(dirname "$0")/../../backend"
# Canonical login topology (same names and binder as production `beeside`, infra/db/provision-beeside.sh):
#   beeside_runtime            Precision runtime login -> member of beeside_runtime_role only
#   beeside_discovery_runtime  Discovery runtime login -> member of beeside_discovery_rw only (bound by domain-roles-prepare)
for r in beeside_runtime beeside_discovery_runtime; do
  psql -v ON_ERROR_STOP=1 -qc "DO \$\$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$r') THEN CREATE ROLE $r LOGIN PASSWORD 'rt'; END IF; END\$\$"
done
# Every runtime-role suite must declare its domain here; an undeclared one fails the run (it would otherwise be tested with the wrong privileges).
domain_of(){ case "$1" in
  continuity-runtime-role) echo precision;;
  fa4-verify|fa4-v1-delivery|fa4-rc-runtime|privacy-guards-canonical) echo discovery;;
  *) echo "UNDECLARED";; esac; }
fresh_db(){ psql -qc "DROP DATABASE IF EXISTS $1 WITH (FORCE)"; psql -v ON_ERROR_STOP=1 -qc "CREATE DATABASE $1"; DATABASE_URL="$ADM/$1" npx drizzle-kit migrate >/dev/null; }
bind_roles(){ MIGRATION_DATABASE_URL="$ADM/$1" DISCOVERY_RUNTIME_LOGIN=beeside_discovery_runtime PRECISION_RUNTIME_LOGIN=beeside_runtime node dist/scripts/domain-roles-prepare.js >/dev/null; }
# 1. Rolled-back suites (single shared database, every test in a transaction that is rolled back); runtime-role suites skip here.
if [ -z "${ONLY_RUNTIME_SUITES:-}" ]; then
fresh_db it_shared
env -u TEST_RUNTIME_ADMIN_DATABASE_URL -u TEST_RUNTIME_DATABASE_URL TEST_DATABASE_URL="$ADM/it_shared" \
  npx jest --runInBand -c jest.integration.config.js
fi
# 2. Runtime-role suites: committed data, actual least-privilege login, one dedicated database per suite.
for f in $(grep -lE 'TEST_RUNTIME_DATABASE_URL' src/__integration__/*.int.test.ts src/*/__integration__/*.int.test.ts 2>/dev/null | sort); do
  name=$(basename "$f" .int.test.ts); dom=$(domain_of "$name")
  [ "$dom" = UNDECLARED ] && { echo "runtime-role suite $name has no declared domain in scripts/ci/integration.sh"; exit 3; }
  login=$([ "$dom" = precision ] && echo beeside_runtime || echo beeside_discovery_runtime)
  db="rt_$(printf '%s' "$name" | tr -c 'a-z0-9' '_')"
  fresh_db "$db"; bind_roles "$db"
  echo "== runtime-role suite $name ($dom, login $login) on dedicated database $db"
  TEST_DATABASE_URL="$ADM/$db" TEST_RUNTIME_ADMIN_DATABASE_URL="$ADM/$db" TEST_RUNTIME_DATABASE_URL="postgres://${login}:rt@${PGHOST}:${PGPORT}/$db" \
    npx jest --runInBand -c jest.integration.config.js "$f"
done
# 3. Owner-only suites (production preparation / stabilization reset): owner credential on a dedicated database with the shared canonical schema.
#    Their legacy-database variant (24 migrations) belongs to the release/discovery-v1 line, not to main.
for f in $(grep -lE 'TEST_RUNTIME_ADMIN_DATABASE_URL' src/__integration__/*.int.test.ts src/*/__integration__/*.int.test.ts 2>/dev/null | xargs grep -LE 'TEST_RUNTIME_DATABASE_URL' | sort); do
  name=$(basename "$f" .int.test.ts)
  case "$name" in discovery-prod-prepare|discovery-stabilization-reset) ;; *) echo "owner-only suite $name has no declared domain in scripts/ci/integration.sh"; exit 3;; esac
  db="own_$(printf '%s' "$name" | tr -c 'a-z0-9' '_')"
  fresh_db "$db"
  echo "== owner-only suite $name (discovery, shared canonical schema) on dedicated database $db"
  TEST_DATABASE_URL="$ADM/$db" TEST_RUNTIME_ADMIN_DATABASE_URL="$ADM/$db" TEST_SHARED_DOMAIN_SCHEMA=1 \
    npx jest --runInBand -c jest.integration.config.js "$f"
done
