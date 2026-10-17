#!/usr/bin/env bash
# PRECISION V2.0 — SQL-side rehearsal of the canonical database ON THE TEMPORARY CLONE (after clone-rehearsal.sh create + harden + mark).
# Touches ONLY the server that carries the rehearsal marker (see clone-rehearsal.sh). Never reads production secrets: every credential comes from $REHEARSAL_DIR.
# It is the production procedure (provision-beeside.sh pre/post, migrate, domain-roles-prepare, domain-data-sync, legacy hardening) executed for real against Cloud SQL's
# real role model, plus the negative tests and the rollback drill. Everything it creates lives in the clone and disappears with it.
#
#   needs: the Auth Proxy running on the clone (cloud-sql-proxy beeside-discovery-prod:northamerica-south1:<clone> --port 5435), psql, node, the built backend (npm run build --workspace=backend)
#   run:   bash infra/db/rehearsal/rehearse-on-clone.sh        (APPROVAL is implied by having created the clone; the marker is the gate)
# Output: PASS/FAIL per check, INFO lines for measurements, evidence folder with the sanitized log (no secret values; the log is scanned for them at the end).
# Exit 0 only when every check passes (WARN and INFO do not fail the run).
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../../.." && pwd); B=$REPO/backend
CLONE=${CLONE:-$(cat "${REHEARSAL_DIR:-/nonexistent}/clone_name" 2>/dev/null || true)}
REHEARSAL_DIR=${REHEARSAL_DIR:-$HOME/.beeside-rehearsal/$CLONE}
HOST=${CLONE_HOST:-127.0.0.1}; PORT=${PROXY_PORT:-5435}; ADMIN=${ADMIN_USER:-postgres}
LEGDB=${LEGACY_DB:-discovery}; NEWDB=${CANONICAL_DB:-beeside}
EVID=${EVIDENCE_DIR:-$HOME/Downloads/rehearsal-evidence-$(date -u +%Y%m%dT%H%M%SZ)}
S="$REHEARSAL_DIR/secrets"; mkdir -p "$EVID"; ( umask 077; mkdir -p "$S" )
exec > >(tee -a "$EVID/log.txt") 2>&1
PASS=0; FAIL=0; WARN=0
ok(){ PASS=$((PASS+1)); echo "  PASS  $1"; }
bad(){ FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
warn(){ WARN=$((WARN+1)); echo "  WARN  $1"; }
info(){ echo "  INFO  $1"; }
die(){ echo "STOP: $*" >&2; exit 9; }
eq(){ [ "$1" = "$2" ] && ok "$3 ($1)" || bad "$3 (got '$1', expected '$2')"; }
expect_ok(){ local d="$1"; shift; if "$@" >"$EVID/.last" 2>&1; then ok "$d"; else bad "$d :: $(tr '\n' ' ' <"$EVID/.last" | cut -c1-240)"; fi; }
expect_fail(){ local d="$1"; shift; if "$@" >"$EVID/.last" 2>&1; then bad "$d (it succeeded)"; else ok "$d"; fi; }
pw(){ cat "$REHEARSAL_DIR/pw_$1" 2>/dev/null || cat "$S/$1" 2>/dev/null; }
sqlu(){ local user=$1 pass=$2 db=$3; shift 3; PGPASSWORD=$pass psql -qXAt -v ON_ERROR_STOP=1 -h "$HOST" -p "$PORT" -U "$user" -d "$db" -c "$*"; }
adm(){ sqlu "$ADMIN" "$(pw "$ADMIN")" "${DB:-postgres}" "$@"; }
admdb(){ local db=$1; shift; sqlu "$ADMIN" "$(pw "$ADMIN")" "$db" "$@"; }
enc(){ node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }
url(){ echo "postgres://$(enc "$1"):$(enc "$2")@$HOST:$PORT/$3"; }

# ---- 0. gate: only the marked clone --------------------------------------------------------------------------------------------------------------------------------
echo "== S0  gate (marker role) and clone fidelity"
[ -d "$REHEARSAL_DIR" ] || die "no rehearsal directory ($REHEARSAL_DIR): create/harden/mark the clone first"
[ -f "$REHEARSAL_DIR/marker" ] || die "no marker file: run clone-rehearsal.sh mark first"
M=$(cat "$REHEARSAL_DIR/marker"); case "$M" in rehearsal_marker_[0-9a-f]*) ;; *) die "malformed marker file";; esac
GOT=$(admdb postgres "select count(*) from pg_roles where rolname='$M'" 2>/dev/null) || die "cannot log in as $ADMIN with the clone credentials on $HOST:$PORT"
[ "$GOT" = 1 ] || die "the server on $HOST:$PORT does NOT carry the rehearsal marker role: this is not the clone. Nothing was executed."
ok "marker verified: this server is the rehearsal clone"
export BACKEND_DIR=$B
LEGMIG=$(pw discovery_migrate); LEGRT=$(pw discovery_runtime)
dm(){ sqlu discovery_migrate "$LEGMIG" $LEGDB "$@"; }
eq "$(admdb postgres "show server_version_num" | cut -c1-2)" 16 "PostgreSQL 16"
eq "$(admdb postgres "select count(*) from pg_database where datname='$NEWDB'")" 0 "the canonical database does not exist yet"
info "legacy encoding/collation: $(admdb postgres "select pg_encoding_to_char(encoding)||' / '||datcollate from pg_database where datname='$LEGDB'")"
info "legacy database owner: $(admdb postgres "select pg_get_userbyid(datdba) from pg_database where datname='$LEGDB'")"
for t in "fa4_project ${EXPECT_PROJECTS:-54}" "fa4_result ${EXPECT_RESULTS:-39}" "fa4_event ${EXPECT_EVENTS:-402}"; do set -- $t
  n=$(dm "select count(*) from $1"); [ "$n" = "$2" ] && ok "clone data matches the Part B evidence: $1 = $n" || warn "$1 = $n (Part B evidence says $2; production may have moved since)"; done
info "members of beeside_runtime_role (all, incl. cloudsql*): $(admdb "$LEGDB" "select coalesce(string_agg(pg_get_userbyid(member)||'[admin='||admin_option||',inherit='||inherit_option||']', ', '),'none') from pg_auth_members where roleid='beeside_runtime_role'::regrole")"
info "role attributes of discovery_migrate: $(admdb "$LEGDB" "select 'super='||rolsuper||' createrole='||rolcreaterole||' createdb='||rolcreatedb from pg_roles where rolname='discovery_migrate'")"
eq "$(admdb "$LEGDB" "select count(*) from pg_auth_members m where m.roleid='beeside_runtime_role'::regrole and m.member='discovery_migrate'::regrole")" 0 "Q13 reproduced: discovery_migrate has NO membership row in beeside_runtime_role"
BEFORE_ROLES=$(admdb postgres "select string_agg(rolname,',' order by rolname) from pg_roles where rolname in ('beeside_migrate','beeside_discovery_runtime','beeside_runtime','beeside_discovery_rw','beeside_analytics_reader','beeside_runtime_role')")
info "managed roles that exist BEFORE provisioning: $BEFORE_ROLES"

# ---- provisioning building blocks ---------------------------------------------------------------------------------------------------------------------------------
export PROVISION_ADMIN_URL="$(url "$ADMIN" "$(pw "$ADMIN")" postgres)" LEGACY_GROUP_ADMIN_URL="$(url discovery_migrate "$LEGMIG" postgres)"
export SECRET_STORE="dir:$S" PROXY_PORT="$PORT"
WRAP="bash $REPO/infra/db/provision-beeside.sh"
prov(){ ( cd "$B" && node dist/scripts/canonical-db-provision.js ); }
migrate_new(){ ( cd "$B" && MIGRATION_DATABASE_URL="$(url beeside_migrate "$(pw beeside-migrate-password)" $NEWDB)" node dist/scripts/migrate.js "$@" ); }
drp(){ ( cd "$B" && MIGRATION_DATABASE_URL="$(url beeside_migrate "$(pw beeside-migrate-password)" $NEWDB)" DISCOVERY_RUNTIME_LOGIN=beeside_discovery_runtime PRECISION_RUNTIME_LOGIN=beeside_runtime node dist/scripts/domain-roles-prepare.js ); }
bm(){ sqlu beeside_migrate "$(pw beeside-migrate-password)" $NEWDB "$@"; }
bdr(){ sqlu beeside_discovery_runtime "$(pw beeside-discovery-runtime-password)" $NEWDB "$@"; }
brt(){ sqlu beeside_runtime "$(pw beeside-runtime-password)" $NEWDB "$@"; }
dm(){ sqlu discovery_migrate "$LEGMIG" $LEGDB "$@"; }

provision_all() { # $1 = label
  echo "== $1  PRE → migrate → POST → 17-point contract"
  expect_ok "plan PRE is read-only and runs" env MODE=plan PHASE=pre bash -c "cd $B && node dist/scripts/canonical-db-provision.js"
  grep -q "$(pw "$ADMIN")" "$EVID/.last" && bad "plan output contains the admin password" || ok "plan output has no password"
  expect_fail "pre without APPROVAL is refused" env -u APPROVAL $WRAP pre
  expect_ok "pre (wrapper, written approval)" env APPROVAL=CANONICAL_DB_PROVISION_APPROVED PHASE=pre $WRAP pre
  expect_ok "pre is idempotent" env APPROVAL=CANONICAL_DB_PROVISION_APPROVED PHASE=pre $WRAP pre
  expect_ok "verify PRE has no errors" env PHASE=pre $WRAP verify
  eq "$(adm "select pg_get_userbyid(datdba) from pg_database where datname='$NEWDB'")" beeside_migrate "$NEWDB owned by beeside_migrate"
  eq "$(adm "select (rolsuper or pg_has_role(oid,'cloudsqlsuperuser','member'))::text from pg_roles where rolname='beeside_migrate'")" false "GN6: the migrator is neither superuser nor a cloudsqlsuperuser member"
  eq "$(adm "select (rolcreaterole or rolcreatedb or rolreplication or rolbypassrls)::text from pg_roles where rolname='beeside_migrate'")" false "GN6: the migrator has no CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS"
  expect_ok "the migrator logs in with its generated password" bm "select 1"
  expect_fail "legacy discovery_migrate cannot enter $NEWDB" sqlu discovery_migrate "$LEGMIG" $NEWDB "select 1"
  expect_fail "legacy discovery_runtime cannot enter $NEWDB" sqlu discovery_runtime "$LEGRT" $NEWDB "select 1"
  expect_fail "the migrator cannot create roles" bm "create role should_not_exist"
  expect_fail "the migrator cannot create databases" bm "create database should_not_exist"
  T0=$(date +%s); migrate_new >"$EVID/.mig" 2>&1 && ok "migrations applied to $NEWDB :: $(tail -1 "$EVID/.mig" | cut -c1-80)" || bad "migrate :: $(tail -3 "$EVID/.mig" | cut -c1-300)"
  info "migration wall time: $(( $(date +%s) - T0 )) s"
  migrate_new --check >"$EVID/.mig" 2>&1 && ok "migrate --check: safe, nothing pending" || bad "migrate --check"
  eq "$(bm "select count(*) from pg_auth_members m where m.member='beeside_migrate'::regrole and m.roleid in ('beeside_runtime_role'::regrole,'beeside_discovery_rw'::regrole)")" 0 "migrator has NO membership row in the runtime groups after migrating"
  MODE=plan PHASE=post prov >"$EVID/.plan" 2>&1; grep -q "holds no ADMIN OPTION" "$EVID/.plan" && info "POST needs the legacy group owner (LEGACY_GROUP_ADMIN_URL): the admin holds NO ADMIN OPTION on beeside_runtime_role" || info "POST needs no legacy owner: the admin already holds ADMIN OPTION on beeside_runtime_role"
  expect_ok "post (wrapper, written approval)" env APPROVAL=CANONICAL_DB_PROVISION_APPROVED PHASE=post $WRAP post
  expect_ok "verify POST has no errors" env PHASE=post $WRAP verify
  drp >"$EVID/.drp" 2>&1 && ok "domain-roles-prepare :: $(grep -c '"ok:' "$EVID/.drp") checks ok, $(grep -c FAILED "$EVID/.drp") failed" || bad "domain-roles-prepare :: $(tail -3 "$EVID/.drp" | cut -c1-400)"
  drp >"$EVID/.drp2" 2>&1 && ok "domain-roles-prepare is idempotent" || bad "domain-roles-prepare second run"
}

provision_all "S1"

# ---- data: copy, reconcile, permissions, privacy bypass, rollback replay ---------------------------------------------------------------------------------------------
echo "== S2  data copy discovery → $NEWDB (dry run, copy, idempotency, late writes, reconcile)"
SRC=$(url discovery_migrate "$LEGMIG" $LEGDB); DST=$(url beeside_migrate "$(pw beeside-migrate-password)" $NEWDB)
sync(){ ( cd "$B" && node dist/scripts/domain-data-sync.js ); }
SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST DRY_RUN=yes sync >"$EVID/.s1" 2>&1; info "dry-run exit=$? (2 = sides differ, expected before the copy)"
eq "$(bm "select count(*) from fa4_project")" 0 "dry run wrote nothing"
expect_fail "a real sync is refused without DOMAIN_SYNC_APPROVED" env SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST bash -c "cd $B && node dist/scripts/domain-data-sync.js"
T0=$(date +%s); SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST DOMAIN_SYNC_APPROVED=yes sync >"$EVID/.s2" 2>&1 && ok "copy ok, every table checksum matches" || bad "copy :: $(tail -c 400 "$EVID/.s2")"
info "copy wall time: $(( $(date +%s) - T0 )) s"
LEGN=$(dm "select count(*) from fa4_project"); eq "$(bm "select count(*) from fa4_project")" "$LEGN" "projects copied"
SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST DOMAIN_SYNC_APPROVED=yes sync >"$EVID/.s3" 2>&1 && node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").pop());process.exit(r.tables.every(t=>t.inserted===0&&t.updated===0)?0:1)' "$EVID/.s3" && ok "second run inserts/updates nothing" || bad "second run changed rows"
LEGNAME=$(dm "select email from fa4_project order by created_at limit 1")
sqlu discovery_runtime "$LEGRT" $LEGDB "INSERT INTO fa4_project (email, locale, step_key, answers, status) SELECT 'late'||g||'@beeside.you','es','S1','{\"late\":true}','IN_PROGRESS' FROM generate_series(1,5) g" >/dev/null && ok "5 late writes on the legacy side (as the legacy runtime)" || bad "late writes"
dm "UPDATE fa4_project SET answers = answers || '{\"edited_after_copy\":true}', updated_at = now() + interval '1 second' WHERE email = '$LEGNAME'" >/dev/null
SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST DRY_RUN=yes sync >/dev/null 2>&1; [ $? -eq 2 ] && ok "dry run detects the divergence (exit 2)" || bad "dry run did not detect divergence"
SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST DOMAIN_SYNC_APPROVED=yes sync >"$EVID/.s4" 2>&1 && ok "reconcile ok, checksums match" || bad "reconcile :: $(tail -c 400 "$EVID/.s4")"
eq "$(bm "select count(*) from fa4_project")" "$((LEGN+5))" "late projects reconciled"
eq "$(bm "select answers->>'edited_after_copy' from fa4_project where email='$LEGNAME'")" true "the newer update wins"

echo "== S3  runtime permissions on $NEWDB"
expect_ok "Discovery runtime inserts a project" bdr "insert into fa4_project (email,locale,step_key,answers) values ('cut1@beeside.you','es','S1','{}')"
expect_ok "Discovery runtime updates a project" bdr "update fa4_project set step_key='S2', updated_at=now() where email='cut1@beeside.you'"
expect_fail "Discovery runtime cannot DELETE" bdr "delete from fa4_project where email='cut1@beeside.you'"
expect_fail "Discovery runtime cannot read operator accounts" bdr "select count(*) from admin_user"
expect_fail "Discovery runtime cannot create objects" bdr "create table x(i int)"
expect_fail "Discovery runtime cannot read Precision data" bdr "select count(*) from company"
expect_ok "Precision runtime reads Discovery records" brt "select count(*) from fa4_project"
expect_fail "Precision runtime cannot write Discovery records" brt "update fa4_project set step_key='X'"
expect_fail "Precision runtime cannot insert Discovery records" brt "insert into fa4_project (email,locale,step_key,answers) values ('p@x','es','S','{}')"
expect_ok "Precision runtime reads its own tables" brt "select count(*) from admin_user"
expect_fail "Precision runtime cannot create objects" brt "create table x(i int)"
expect_fail "Precision runtime cannot become another role" brt "set role beeside_migrate"
expect_fail "Discovery runtime cannot become another role" bdr "set role beeside_migrate"

echo "== S4  privacy bypass (erasure / anonymisation executor) on real Cloud SQL"
BYP="begin; set local fa4.erasure='on'; update fa4_result set model='{\"erased\":true}' where result_seq=(select min(result_seq) from fa4_result); select 'bypass-active'; rollback"
eq "$(bm "$BYP" 2>&1 | grep -c bypass-active)" 1 "migrator in $NEWDB can run the anonymisation bypass"
eq "$(dm "$BYP" 2>&1 | grep -c bypass-active)" 1 "legacy discovery_migrate in $LEGDB can run it too (Q13: no membership row; R1 does not apply in production)"

echo "== S5  rollback replay: writes made on $NEWDB after the cutover go back to $LEGDB"
bdr "insert into fa4_project (email,locale,step_key,answers) select 'post'||g||'@beeside.you','es','S1','{\"post\":true}' from generate_series(1,3) g" >/dev/null
bdr "update fa4_project set answers = answers || '{\"edited_on_beeside\":true}', updated_at = now() + interval '2 seconds' where email='$LEGNAME'" >/dev/null
SYNC_SOURCE_URL=$DST SYNC_TARGET_URL=$SRC DOMAIN_SYNC_APPROVED=yes sync >"$EVID/.s5" 2>&1 && ok "rollback replay ok, checksums match" || bad "rollback replay :: $(tail -c 400 "$EVID/.s5")"
eq "$(dm "select count(*) from fa4_project")" "$(bm "select count(*) from fa4_project")" "legacy now holds every project"
eq "$(dm "select answers->>'edited_on_beeside' from fa4_project where email='$LEGNAME'")" true "the update made on $NEWDB reached legacy"
eq "$(sqlu discovery_runtime "$LEGRT" $LEGDB "select count(*) from fa4_project")" "$(dm "select count(*) from fa4_project")" "legacy runtime still works on $LEGDB"

echo "== S6  legacy hardening (PUBLIC CONNECT) and its rollback, on a database owned by $(admdb postgres "select pg_get_userbyid(datdba) from pg_database where datname='$LEGDB'")"
MODE=verify PHASE=post prov 2>&1 | grep -q '"severity":"WARN"' && ok "verify warns that the new logins still reach the legacy database" || warn "no WARN before hardening (check the verify output)"
expect_ok "post + LEGACY_HARDEN applied" env MIGRATE_DB_PASSWORD="$(pw beeside-migrate-password)" DISCOVERY_RUNTIME_DB_PASSWORD="$(pw beeside-discovery-runtime-password)" RUNTIME_DB_PASSWORD="$(pw beeside-runtime-password)" MODE=apply PHASE=post LEGACY_HARDEN=yes CANONICAL_DB_PROVISION_APPROVED=yes bash -c "cd $B && node dist/scripts/canonical-db-provision.js"
expect_fail "the new Precision login can no longer enter the legacy database" sqlu beeside_runtime "$(pw beeside-runtime-password)" $LEGDB "select 1"
expect_fail "the new Discovery login can no longer enter the legacy database" sqlu beeside_discovery_runtime "$(pw beeside-discovery-runtime-password)" $LEGDB "select 1"
expect_ok "legacy discovery_runtime still works after hardening" sqlu discovery_runtime "$LEGRT" $LEGDB "select count(*) from fa4_project"
expect_ok "rollback of the hardening: GRANT CONNECT TO PUBLIC (as discovery_migrate)" dm "grant connect on database $LEGDB to public"
expect_ok "after the rollback the original access is back" sqlu beeside_runtime "$(pw beeside-runtime-password)" $LEGDB "select 1"

# ---- rollback drill of the provisioning itself, then repeat from zero -----------------------------------------------------------------------------------------------
echo "== S7  rollback drill: remove everything the provisioning created, prove legacy is untouched, provision again"
LEGSNAP="$(dm "select count(*) from fa4_project")|$(adm "select count(*) from pg_auth_members where member='discovery_runtime'::regrole and roleid='beeside_runtime_role'::regrole")"
adm "select pg_terminate_backend(pid) from pg_stat_activity where datname='$NEWDB'" >/dev/null 2>&1
adm "GRANT beeside_migrate TO \"$ADMIN\" WITH SET TRUE, INHERIT TRUE" >/dev/null && ok "temporary: admin joins the database owner" || bad "owner join"
expect_ok "DROP DATABASE $NEWDB" adm "DROP DATABASE $NEWDB"
adm "REVOKE beeside_migrate FROM \"$ADMIN\"" >/dev/null
for r in beeside_runtime beeside_discovery_runtime beeside_migrate; do adm "DROP ROLE IF EXISTS $r" >/dev/null 2>&1 && ok "DROP ROLE $r" || bad "DROP ROLE $r :: $(adm "select 1" 2>&1 | head -c 0)"; done
for r in beeside_discovery_rw beeside_analytics_reader; do case ",$BEFORE_ROLES," in *",$r,"*) info "$r existed before: kept";; *) adm "DROP ROLE IF EXISTS $r" >/dev/null 2>&1 && ok "DROP ROLE $r (created by the provisioning)" || bad "DROP ROLE $r";; esac; done
eq "$(adm "select count(*) from pg_roles where rolname='beeside_runtime_role'")" 1 "the legacy group beeside_runtime_role was NOT dropped"
eq "$(dm "select count(*) from fa4_project")|$(adm "select count(*) from pg_auth_members where member='discovery_runtime'::regrole and roleid='beeside_runtime_role'::regrole")" "$LEGSNAP" "legacy data and the legacy runtime membership are exactly as before the drill"
expect_ok "legacy runtime still works" sqlu discovery_runtime "$LEGRT" $LEGDB "select count(*) from fa4_project"
rm -f "$S"/beeside-*   # the provisioning generates fresh passwords
provision_all "S8"
eq "$(bm "select count(*) from fa4_project")" 0 "after rollback + re-provision $NEWDB is empty again (a repeatable procedure)"

echo "== S9  leakage scan of the evidence"
LEAK=0; for f in "$REHEARSAL_DIR"/pw_* "$S"/*; do [ -f "$f" ] || continue; v=$(cat "$f"); [ -n "$v" ] && grep -rqF -- "$v" "$EVID" 2>/dev/null && { LEAK=1; echo "  LEAK  a secret value appears in the evidence ($(basename "$f"))"; }; done
[ $LEAK = 0 ] && ok "no secret value appears in the evidence folder" || bad "a secret value leaked into the evidence"
rm -f "$EVID"/.last "$EVID"/.mig "$EVID"/.plan "$EVID"/.drp "$EVID"/.drp2 "$EVID"/.s[0-9]

echo "== SUMMARY  pass=$PASS fail=$FAIL warn=$WARN  · evidence: $EVID"
[ $FAIL -eq 0 ]
