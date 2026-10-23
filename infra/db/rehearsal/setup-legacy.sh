#!/usr/bin/env bash
# Builds a local stand-in for the PRODUCTION Cloud SQL instance (Q09/Q10 facts): managed admin that is NOT a real superuser, discovery_migrate / discovery_runtime
# as Cloud SQL API users (cloudsqlsuperuser members), DB `discovery` at migration 24 created by discovery_migrate. Port 5433. Idempotent: drops and rebuilds.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../../.." && pwd); S=${SIM_DIR:-/tmp/beeside-sim}; mkdir -p "$S/sim"
W=$REPO/backend
P="psql -v ON_ERROR_STOP=1 -qX -p 5433 -U postgres"
pg_lsclusters | grep -q "sim.*online" || pg_ctlcluster 16 sim start
su postgres -c "$P -d postgres" <<'SQL'
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('discovery','beeside') AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS beeside;
DROP DATABASE IF EXISTS discovery;
DO $$ DECLARE r text; BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('beeside_migrate','beeside_discovery_runtime','beeside_runtime','discovery_runtime','discovery_migrate','sqladmin','beeside_runtime_role','beeside_discovery_rw','beeside_analytics_reader','cloudsqlsuperuser') LOOP
    EXECUTE format('DROP OWNED BY %I', r); EXECUTE format('DROP ROLE %I', r);
  END LOOP; END $$;
CREATE ROLE cloudsqlsuperuser NOLOGIN CREATEROLE CREATEDB;
CREATE ROLE sqladmin LOGIN CREATEROLE CREATEDB PASSWORD 'sim_admin_password_000000' IN ROLE cloudsqlsuperuser;
CREATE ROLE discovery_migrate LOGIN CREATEROLE CREATEDB PASSWORD 'sim_migrate_password_00000' IN ROLE cloudsqlsuperuser;
CREATE ROLE discovery_runtime LOGIN CREATEROLE CREATEDB PASSWORD 'sim_runtime_password_000000' IN ROLE cloudsqlsuperuser;
CREATE DATABASE discovery OWNER discovery_migrate;
SQL
# 24 migrations only (what production has), applied by discovery_migrate
rm -rf $S/sim/mig24 && mkdir -p $S/sim/mig24 && cp -r $W/db/migrations/. $S/sim/mig24/
python3 - <<PY
import json
p="$S/sim/mig24/meta/_journal.json"; j=json.load(open(p)); j["entries"]=j["entries"][:24]; json.dump(j,open(p,"w"))
PY
cat > $S/sim/migrate-n.js <<JS
const path=require("path");const W="$W/..";
const {drizzle}=require(W+"/node_modules/drizzle-orm/node-postgres");const {migrate}=require(W+"/node_modules/drizzle-orm/node-postgres/migrator");const {Pool}=require(W+"/node_modules/pg");
(async()=>{const pool=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
await migrate(drizzle(pool),{migrationsFolder:process.argv[2],migrationsTable:"__drizzle_migrations",migrationsSchema:"drizzle"});
console.log(JSON.stringify((await pool.query("SELECT count(*)::int n FROM drizzle.__drizzle_migrations")).rows[0]));await pool.end();})().catch(e=>{console.error(e.message);process.exit(1)});
JS
MIGRATION_DATABASE_URL="postgres://discovery_migrate:sim_migrate_password_00000@127.0.0.1:5433/discovery" node $S/sim/migrate-n.js $S/sim/mig24
# Production evidence Q13: the legacy database is owned by cloudsqlsuperuser (tables stay owned by discovery_migrate).
su postgres -c "psql -v ON_ERROR_STOP=1 -qX -p 5433 -U postgres -d postgres -c 'ALTER DATABASE discovery OWNER TO cloudsqlsuperuser'"
# Role mechanics. SIM_Q13=prod (default) reproduces the PRODUCTION evidence (Part B Q13, 2026-10-17): discovery_migrate has NO membership row in beeside_runtime_role,
# discovery_runtime is a member whose grantor is the platform (here the bootstrap superuser, in production cloudsqladmin). ASSUMPTION (to be confirmed on the clone): the platform
# lets cloudsqlsuperuser members administer the group, modelled as ADMIN OPTION on beeside_runtime_role held by cloudsqlsuperuser (INHERIT FALSE, SET FALSE: no privileges).
# SIM_Q13=creator-row keeps the earlier hazard model: PostgreSQL 16 creator ADMIN row left on discovery_migrate (used as the negative control of the privacy-bypass check).
su postgres -c "psql -v ON_ERROR_STOP=1 -qX -p 5433 -U postgres -d discovery" <<SQL
GRANT beeside_runtime_role TO discovery_runtime;
SQL
if [ "${SIM_Q13:-prod}" = prod ]; then
su postgres -c "psql -v ON_ERROR_STOP=1 -qX -p 5433 -U postgres -d discovery" <<'SQL'
REVOKE beeside_runtime_role FROM discovery_migrate CASCADE;
GRANT beeside_runtime_role TO discovery_runtime;
GRANT beeside_runtime_role TO cloudsqlsuperuser WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
SQL
fi
