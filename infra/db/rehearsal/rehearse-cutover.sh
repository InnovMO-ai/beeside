#!/usr/bin/env bash
# LOCAL rehearsal #2: data copy, reconciliation, new-runtime permissions, privacy bypass, rollback, legacy hardening. Run AFTER rehearse-provision.sh (needs its state and sim/.pw).
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../../.." && pwd); S=${SIM_DIR:-/tmp/beeside-sim}; mkdir -p "$S/sim"
B=$REPO/backend; H="-h 127.0.0.1 -p 5433"
set -a; . $S/sim/.pw; set +a
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); echo "  PASS  $1"; }
bad(){ FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
expect_ok(){ local d="$1"; shift; if "$@" >/tmp/rc.out 2>&1; then ok "$d"; else bad "$d :: $(tr '\n' ' ' </tmp/rc.out | cut -c1-260)"; fi; }
expect_fail(){ local d="$1"; shift; if "$@" >/tmp/rc.out 2>&1; then bad "$d (it succeeded)"; else ok "$d"; fi; }
eq(){ [ "$1" = "$2" ] && ok "$3 ($1)" || bad "$3 (got '$1', expected '$2')"; }
sql(){ local user=$1 pw=$2 db=$3; shift 3; PGPASSWORD=$pw psql -qXAt -v ON_ERROR_STOP=1 $H -U "$user" -d "$db" -c "$*"; }
LEG=sim_migrate_password_00000; LRT=sim_runtime_password_000000; ADM=sim_admin_password_000000
bm(){ sql beeside_migrate "$MIGRATE_DB_PASSWORD" beeside "$@"; }
dm(){ sql discovery_migrate $LEG discovery "$@"; }
bdr(){ sql beeside_discovery_runtime "$DISCOVERY_RUNTIME_DB_PASSWORD" beeside "$@"; }
brt(){ sql beeside_runtime "$RUNTIME_DB_PASSWORD" beeside "$@"; }
SRC="postgres://discovery_migrate:$LEG@127.0.0.1:5433/discovery"
DST="postgres://beeside_migrate:$MIGRATE_DB_PASSWORD@127.0.0.1:5433/beeside"
sync(){ ( cd $B && node dist/scripts/domain-data-sync.js ); }

echo "== C1  dry run (reads both sides, writes nothing)"
SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST DRY_RUN=yes sync >/tmp/c1.out 2>&1; echo "     exit=$? (2 = sides differ, expected before the copy)"
eq "$(bm "select count(*) from fa4_project")" 0 "dry run wrote nothing"
grep -q '"ignoredSourceTables"' /tmp/c1.out && ok "dry run reports source tables outside the domain" || bad "no ignored report"

echo "== C2  forward copy discovery -> beeside"
expect_fail "real run refused without DOMAIN_SYNC_APPROVED" env SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST bash -c "cd $B && node dist/scripts/domain-data-sync.js"
expect_fail "source = target refused" env SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$SRC DOMAIN_SYNC_APPROVED=yes bash -c "cd $B && node dist/scripts/domain-data-sync.js"
SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST DOMAIN_SYNC_APPROVED=yes sync >/tmp/c2.out 2>&1 && ok "copy ok, every table checksum matches" || bad "copy :: $(tail -c 500 /tmp/c2.out)"
eq "$(bm "select count(*) from fa4_project")" 54 "projects copied"
eq "$(bm "select count(*) from fa4_result")" 18 "sealed results copied"
eq "$(bm "select count(*) from fa4_event")" 54 "events copied"
eq "$(dm "select count(*) from fa4_project")" 54 "legacy unchanged (still 54)"
python3 - <<PY
import json
r=json.loads(open('/tmp/c2.out').read().strip().splitlines()[-1])
print("     tables:",len(r['tables']),"| inserted:",sum(t['inserted'] for t in r['tables']),"| mismatches:",[t['table'] for t in r['tables'] if not t['match']],"| missing on source:",r['missingOnSource'],"| source tables outside domain with rows:",[(t['table'],t['rows']) for t in r['ignoredSourceTables'] if t['rows']])
PY
echo "== C3  idempotent re-run"
SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST DOMAIN_SYNC_APPROVED=yes sync >/tmp/c3.out 2>&1 && ok "second run ok" || bad "second run"
python3 - <<PY && ok "second run inserted/updated nothing" || bad "second run changed rows"
import json,sys
r=json.loads(open('/tmp/c3.out').read().strip().splitlines()[-1]); sys.exit(0 if all(t['inserted']==0 and t['updated']==0 for t in r['tables']) else 1)
PY

echo "== C4  late writes on the legacy side, then reconcile"
export PGPASSWORD=$LRT
psql -qXAt -v ON_ERROR_STOP=1 $H -U discovery_runtime -d discovery <<'SQL' >/dev/null
INSERT INTO fa4_project (email, locale, step_key, answers, status) SELECT 'late'||g||'@beeside.you','es','S1','{"late":true}','IN_PROGRESS' FROM generate_series(1,5) g;
UPDATE fa4_project SET answers = answers || '{"edited_after_copy":true}', updated_at = now() + interval '1 second' WHERE email = 'tester1@beeside.you';
SQL
unset PGPASSWORD
SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST DRY_RUN=yes sync >/dev/null 2>&1; [ $? -eq 2 ] && ok "dry run detects the divergence (exit 2)" || bad "dry run did not detect divergence"
SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST DOMAIN_SYNC_APPROVED=yes sync >/tmp/c4.out 2>&1 && ok "reconcile ok, checksums match" || bad "reconcile :: $(tail -c 400 /tmp/c4.out)"
eq "$(bm "select count(*) from fa4_project")" 59 "5 late projects reconciled"
eq "$(bm "select answers->>'edited_after_copy' from fa4_project where email='tester1@beeside.you'")" true "updated row reconciled (newer updated_at wins)"

echo "== C5  the new runtime logins on beeside"
expect_ok "Discovery runtime inserts a project" bdr "insert into fa4_project (email,locale,step_key,answers) values ('cut1@beeside.you','es','S1','{}')"
expect_ok "Discovery runtime updates a project" bdr "update fa4_project set step_key='S2', updated_at=now() where email='cut1@beeside.you'"
expect_fail "Discovery runtime cannot DELETE" bdr "delete from fa4_project where email='cut1@beeside.you'"
expect_fail "Discovery runtime cannot read operator accounts" bdr "select count(*) from admin_user"
expect_fail "Discovery runtime cannot create objects" bdr "create table x(i int)"
expect_fail "Discovery runtime cannot read Precision data" bdr "select count(*) from company"
expect_ok "Precision runtime reads Discovery records" brt "select count(*) from fa4_project"
expect_fail "Precision runtime cannot write Discovery records" brt "update fa4_project set step_key='X'"
expect_fail "Precision runtime cannot insert Discovery records" brt "insert into fa4_project (email,locale,step_key,answers) values ('p@x','es','S','{}')"
expect_ok "Precision runtime can read its own tables" brt "select count(*) from admin_user"
expect_fail "Precision runtime cannot create objects" brt "create table x(i int)"
expect_fail "legacy discovery_runtime cannot enter beeside" sql discovery_runtime $LRT beeside "select 1"

echo "== C6  privacy bypass (erasure/anonymisation) in beeside vs the legacy creator-row hazard"
R=$(bm "begin; set local fa4.erasure='on'; update fa4_result set model='{\"erased\":true}' where result_seq=(select min(result_seq) from fa4_result); select 'bypass-active'; rollback" 2>&1 | grep -c bypass-active)
eq "$R" 1 "migrator in beeside can run the anonymisation bypass"
R=$(dm "begin; set local fa4.erasure='on'; update fa4_result set model='{\"erased\":true}' where result_seq=(select min(result_seq) from fa4_result); select 'bypass-active'; rollback" 2>&1 | grep -c bypass-active)
eq "$R" 0 "legacy discovery_migrate CANNOT (creator ADMIN row in beeside_runtime_role) — hazard to confirm in production with Q13"

echo "== C7  rollback: writes made on beeside after the cutover are replayed into discovery"
bdr "insert into fa4_project (email,locale,step_key,answers) select 'post'||g||'@beeside.you','es','S1','{\"post\":true}' from generate_series(1,3) g" >/dev/null
bdr "update fa4_project set answers = answers || '{\"edited_on_beeside\":true}', updated_at = now() + interval '2 seconds' where email='tester2@beeside.you'" >/dev/null
SYNC_SOURCE_URL=$DST SYNC_TARGET_URL=$SRC DOMAIN_SYNC_APPROVED=yes sync >/tmp/c7.out 2>&1 && ok "rollback replay ok, checksums match" || bad "rollback :: $(tail -c 500 /tmp/c7.out)"
eq "$(dm "select count(*) from fa4_project")" 63 "legacy now holds every project (54+5+1+3)"
eq "$(dm "select answers->>'edited_on_beeside' from fa4_project where email='tester2@beeside.you'")" true "update made on beeside reached legacy"
eq "$(sql discovery_runtime $LRT discovery "select count(*) from fa4_project")" 63 "legacy runtime still works on discovery"

echo "== C8  optional legacy hardening (PUBLIC CONNECT) and its rollback"
export PROVISION_ADMIN_URL="postgres://sqladmin:$ADM@127.0.0.1:5433/postgres" LEGACY_GROUP_ADMIN_URL="$SRC"
( cd $B && MODE=verify PHASE=post node dist/scripts/canonical-db-provision.js ) 2>&1 | grep -q '"severity":"WARN"' && ok "verify warns that the new logins still reach the legacy database" || bad "no WARN before hardening"
( cd $B && MODE=apply PHASE=post LEGACY_HARDEN=yes CANONICAL_DB_PROVISION_APPROVED=yes node dist/scripts/canonical-db-provision.js ) >/tmp/c8.out 2>&1 && ok "post + LEGACY_HARDEN applied" || bad "harden :: $(tail -c 300 /tmp/c8.out)"
( cd $B && MODE=verify PHASE=post node dist/scripts/canonical-db-provision.js ) 2>&1 | grep -q '"severity":"WARN"' && bad "WARN persists after hardening" || ok "warning cleared after hardening"
expect_fail "new Precision login can no longer enter the legacy database" sql beeside_runtime "$RUNTIME_DB_PASSWORD" discovery "select 1"
expect_ok "legacy discovery_runtime still works after hardening" sql discovery_runtime $LRT discovery "select count(*) from fa4_project"
dm "grant connect on database discovery to public" >/dev/null && ok "rollback of the hardening: GRANT CONNECT TO PUBLIC" || bad "hardening rollback"
expect_ok "after the rollback the legacy state is the original again" sql beeside_runtime "$RUNTIME_DB_PASSWORD" discovery "select 1"

echo "== C9  connection footprint of the three runtimes and migrator (pool limits)"
eq "$(sql sqladmin $ADM postgres "select count(*) from pg_stat_activity where usename in ('beeside_migrate','beeside_discovery_runtime','beeside_runtime') and state is not null")" 0 "no idle sessions left behind by the rehearsal tools"

echo "== SUMMARY  pass=$PASS fail=$FAIL"
[ $FAIL -eq 0 ]
