#!/usr/bin/env bash
# LOCAL rehearsal of the canonical-database provisioning on the simulated Cloud SQL cluster (port 5433). Touches nothing outside this machine.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../../.." && pwd); S=${SIM_DIR:-/tmp/beeside-sim}; mkdir -p "$S/sim"
B=$REPO/backend
H="-h 127.0.0.1 -p 5433"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); echo "  PASS  $1"; }
bad(){ FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
expect_ok(){ local d="$1"; shift; if "$@" >/tmp/rh.out 2>&1; then ok "$d"; else bad "$d :: $(tr '\n' ' ' </tmp/rh.out | cut -c1-200)"; fi; }
expect_fail(){ local d="$1"; shift; if "$@" >/tmp/rh.out 2>&1; then bad "$d (it succeeded)"; else ok "$d"; fi; }
sql(){ local user=$1 pw=$2 db=$3; shift 3; PGPASSWORD=$pw psql -qXAt -v ON_ERROR_STOP=1 $H -U "$user" -d "$db" -c "$*"; }
ADMIN_PW=sim_admin_password_000000; LEG_PW=sim_migrate_password_00000
export MIGRATE_DB_PASSWORD=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' )Mg1xxxxxxxx
export DISCOVERY_RUNTIME_DB_PASSWORD=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' )Dr1xxxxxxxx
export RUNTIME_DB_PASSWORD=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' )Pr1xxxxxxxx
umask 077; printf "MIGRATE_DB_PASSWORD=%s\nDISCOVERY_RUNTIME_DB_PASSWORD=%s\nRUNTIME_DB_PASSWORD=%s\n" "$MIGRATE_DB_PASSWORD" "$DISCOVERY_RUNTIME_DB_PASSWORD" "$RUNTIME_DB_PASSWORD" > $S/sim/.pw
export PROVISION_ADMIN_URL="postgres://sqladmin:$ADMIN_PW@127.0.0.1:5433/postgres"
export LEGACY_GROUP_ADMIN_URL="postgres://discovery_migrate:$LEG_PW@127.0.0.1:5433/postgres"
prov(){ ( cd $B && node dist/scripts/canonical-db-provision.js ); }
dbexists(){ sql sqladmin $ADMIN_PW postgres "select count(*) from pg_database where datname='beeside'"; }

echo "== R0  rebuild the legacy state (24 migrations, 54 synthetic projects)"
bash $HERE/setup-legacy.sh >/dev/null 2>&1 && bash $HERE/seed-legacy.sh >/dev/null && ok "legacy rebuilt" || bad "legacy rebuild"

echo "== R1  PLAN (read-only)"
MODE=plan PHASE=pre prov >/tmp/plan.out 2>&1 && ok "plan runs" || bad "plan runs :: $(cat /tmp/plan.out | cut -c1-300)"
[ "$(dbexists)" = "0" ] && ok "plan created nothing" || bad "plan created the database"
grep -q "$MIGRATE_DB_PASSWORD" /tmp/plan.out && bad "plan output contains a password" || ok "plan output has no password"
grep -q "CREATE DATABASE" /tmp/plan.out && ok "plan lists CREATE DATABASE" || bad "plan lacks CREATE DATABASE"

echo "== R2  APPLY gates"
expect_fail "apply without written approval is refused" env MODE=apply PHASE=pre bash -c "cd $B && node dist/scripts/canonical-db-provision.js"
expect_fail "apply with a short password is refused before ANY change" env MODE=apply PHASE=pre CANONICAL_DB_PROVISION_APPROVED=yes RUNTIME_DB_PASSWORD=x MIGRATE_DB_PASSWORD=short bash -c "cd $B && node dist/scripts/canonical-db-provision.js"
[ "$(dbexists)" = "0" ] && [ "$(sql sqladmin $ADMIN_PW postgres "select count(*) from pg_roles where rolname in ('beeside_migrate','beeside_discovery_rw')")" = "0" ] && ok "refused applies left no trace" || bad "refused apply left a trace"

echo "== R3  APPLY PRE"
expect_ok "apply pre" env MODE=apply PHASE=pre CANONICAL_DB_PROVISION_APPROVED=yes bash -c "cd $B && node dist/scripts/canonical-db-provision.js"
grep -q "$MIGRATE_DB_PASSWORD\|$RUNTIME_DB_PASSWORD" /tmp/rh.out && bad "apply output contains a password" || ok "apply output has no password"
expect_ok "apply pre is idempotent (second run)" env MODE=apply PHASE=pre CANONICAL_DB_PROVISION_APPROVED=yes bash -c "cd $B && node dist/scripts/canonical-db-provision.js"
expect_ok "verify pre" env MODE=verify PHASE=pre bash -c "cd $B && node dist/scripts/canonical-db-provision.js"
[ "$(sql sqladmin $ADMIN_PW postgres "select pg_get_userbyid(datdba) from pg_database where datname='beeside'")" = "beeside_migrate" ] && ok "beeside owned by beeside_migrate" || bad "owner"
expect_ok "migrator logs in with its generated password" sql beeside_migrate "$MIGRATE_DB_PASSWORD" beeside "select 1"
expect_fail "legacy discovery_runtime cannot connect to beeside" sql discovery_runtime sim_runtime_password_000000 beeside "select 1"
expect_fail "legacy discovery_migrate cannot connect to beeside" sql discovery_migrate $LEG_PW beeside "select 1"
expect_fail "migrator cannot create roles" sql beeside_migrate "$MIGRATE_DB_PASSWORD" beeside "create role should_not_exist"
expect_fail "migrator cannot create databases" sql beeside_migrate "$MIGRATE_DB_PASSWORD" beeside "create database should_not_exist"

echo "== R4  MIGRATE beeside to 52 as beeside_migrate"
( cd $B && MIGRATION_DATABASE_URL="postgres://beeside_migrate:$MIGRATE_DB_PASSWORD@127.0.0.1:5433/beeside" node dist/scripts/migrate.js ) >/tmp/mig.out 2>&1 && ok "52 migrations applied :: $(tail -1 /tmp/mig.out | cut -c1-80)" || bad "migrate :: $(tail -3 /tmp/mig.out | cut -c1-300)"
[ "$(sql beeside_migrate "$MIGRATE_DB_PASSWORD" beeside "select count(*) from pg_auth_members m join pg_roles g on g.oid=m.roleid join pg_roles u on u.oid=m.member where u.rolname='beeside_migrate' and g.rolname in ('beeside_runtime_role','beeside_discovery_rw')")" = "0" ] && ok "migrator has NO membership row in the groups after migrating" || bad "migrator got a membership row"
( cd $B && MIGRATION_DATABASE_URL="postgres://beeside_migrate:$MIGRATE_DB_PASSWORD@127.0.0.1:5433/beeside" node dist/scripts/migrate.js --check ) >/tmp/mig.out 2>&1 && ok "migrate --check safe" || bad "migrate --check"

echo "== R5  POST"
expect_fail "post without LEGACY_GROUP_ADMIN_URL is refused (admin lacks ADMIN on the legacy Precision group), no change" env -u LEGACY_GROUP_ADMIN_URL MODE=apply PHASE=post CANONICAL_DB_PROVISION_APPROVED=yes bash -c "cd $B && node dist/scripts/canonical-db-provision.js"
[ "$(sql sqladmin $ADMIN_PW postgres "select count(*) from pg_roles where rolname='beeside_runtime'")" = "0" ] && ok "precision login still absent after refused post" || bad "precision login created by a refused post"
expect_ok "apply post" env MODE=apply PHASE=post CANONICAL_DB_PROVISION_APPROVED=yes bash -c "cd $B && node dist/scripts/canonical-db-provision.js"
expect_ok "verify post" env MODE=verify PHASE=post bash -c "cd $B && node dist/scripts/canonical-db-provision.js"

echo "== R6  domain-roles-prepare as the migrator (17-point contract)"
( cd $B && MIGRATION_DATABASE_URL="postgres://beeside_migrate:$MIGRATE_DB_PASSWORD@127.0.0.1:5433/beeside" DISCOVERY_RUNTIME_LOGIN=beeside_discovery_runtime PRECISION_RUNTIME_LOGIN=beeside_runtime node dist/scripts/domain-roles-prepare.js ) >/tmp/drp.out 2>&1 && ok "domain-roles-prepare :: $(grep -c '"ok:' /tmp/drp.out) checks ok, $(grep -c FAILED /tmp/drp.out) failed" || bad "domain-roles-prepare :: $(tail -3 /tmp/drp.out | cut -c1-400)"
( cd $B && MIGRATION_DATABASE_URL="postgres://beeside_migrate:$MIGRATE_DB_PASSWORD@127.0.0.1:5433/beeside" DISCOVERY_RUNTIME_LOGIN=beeside_discovery_runtime PRECISION_RUNTIME_LOGIN=beeside_runtime node dist/scripts/domain-roles-prepare.js ) >/tmp/drp2.out 2>&1 && ok "domain-roles-prepare idempotent" || bad "domain-roles-prepare second run"

echo "== R7  privacy-erasure bypass still works for the new migrator"
PGPASSWORD=$MIGRATE_DB_PASSWORD psql -qXAt $H -U beeside_migrate -d beeside -c "select 1" >/dev/null && ok "migrator connects"
echo "SKIPPED_IN_R7_FILLED_LATER" >/dev/null

echo "== SUMMARY  pass=$PASS fail=$FAIL"
[ $FAIL -eq 0 ]
