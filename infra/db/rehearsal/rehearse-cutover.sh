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
SYNCJS="cd $B && node dist/scripts/domain-data-sync.js"; RECJS="cd $B && node dist/scripts/domain-erasure-reconcile.js"
LEGR="postgres://discovery_runtime:$LRT@127.0.0.1:5433/discovery"
rc(){ "$@" >/tmp/rc.out 2>&1; local c=$?; [ $c -eq 2 ] && cp /tmp/rc.out /tmp/rc.fail.$RANDOM; [ $c -eq 2 ] && tail -1 /tmp/rc.out | python3 -c "import sys,json; r=json.loads(sys.stdin.read()); print('     (tables that differ: %s)' % [(t['table'],t['sourceRows'],t['targetRows']) for t in r.get('tables',[]) if not t['match']], file=sys.stderr)" 2>/dev/null; echo $c; }   # prints the exit code (diagnostic on stderr), output kept in /tmp/rc.out
failmsg(){ local d="$1" pat="$2"; shift 2; local out; if out=$("$@" 2>&1); then bad "$d (it succeeded)"; elif printf '%s' "$out" | grep -q "$pat"; then ok "$d"; else bad "$d (failed, but not with '$pat': $(echo "$out" | tr '\n' ' ' | cut -c1-160))"; fi; }
# does the side still hold personal data for a project? (t/f, independent of the tool under test)
resid(){ $1 "select (p.status<>'ANONYMIZED' or p.email<>'anonymized+'||p.project_id||'@invalid.invalid' or p.answers<>'{}'::jsonb or exists(select 1 from fa4_result r where r.project_id=p.project_id and r.model<>'{\"anonymized\": true}'::jsonb) or exists(select 1 from fa4_contact_request c where c.project_id=p.project_id and c.name<>'anonymized')) from fa4_project p where p.project_id='$2'"; }

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

echo "== C6  privacy bypass (erasure/anonymisation) in beeside, in the legacy database, and the creator-row hazard as a NEGATIVE CONTROL"
BYP="begin; set local fa4.erasure='on'; update fa4_result set model='{\"erased\":true}' where result_seq=(select min(result_seq) from fa4_result); select 'bypass-active'; rollback"
eq "$(bm "$BYP" 2>&1 | grep -c bypass-active)" 1 "migrator in beeside can run the anonymisation bypass"
eq "$(dm "$BYP" 2>&1 | grep -c bypass-active)" 1 "legacy discovery_migrate can run it (production evidence Q13: no membership row)"
su postgres -c "psql -qX -p 5433 -d discovery -c 'GRANT beeside_runtime_role TO discovery_migrate WITH ADMIN TRUE, INHERIT FALSE, SET FALSE'" >/dev/null 2>&1
eq "$(dm "$BYP" 2>&1 | grep -c bypass-active)" 0 "control: with a creator ADMIN-only row the bypass is OFF (the hazard the design avoids for beeside_migrate)"
su postgres -c "psql -qX -p 5433 -d discovery -c 'REVOKE beeside_runtime_role FROM discovery_migrate'" >/dev/null 2>&1
eq "$(dm "$BYP" 2>&1 | grep -c bypass-active)" 1 "control reverted"

echo "== C6b  F1: the privacy bypass is closed to BOTH application runtimes (migration 0052) and stays open to the authorised migrator"
DEL=$(bm "select project_id from fa4_project p where exists (select 1 from fa4_result r where r.project_id=p.project_id and not r.legacy_unsealed) order by project_id limit 1")
[ -n "$DEL" ] && ok "a delivered project exists to test with" || bad "no delivered project in the seed"
failmsg "F1 Discovery runtime on beeside cannot rewrite a delivered project with fa4.erasure=on (BV604)" "BV604\|closed to editing" bdr "begin; set local fa4.erasure='on'; update fa4_project set answers='{\"x\":1}' where project_id='$DEL'; rollback"
failmsg "F1 Discovery runtime on beeside cannot touch the sealed result either" "permission denied\|append-only" bdr "begin; set local fa4.erasure='on'; update fa4_result set model='{\"x\":1}' where project_id='$DEL'; rollback"
failmsg "F1 Precision runtime has no bypass (no write privilege on Discovery records)" "permission denied" brt "begin; set local fa4.erasure='on'; update fa4_project set answers='{\"x\":1}' where project_id='$DEL'; rollback"
failmsg "F1 legacy discovery_runtime (control) is refused the same way" "BV604\|closed to editing" sql discovery_runtime $LRT discovery "begin; set local fa4.erasure='on'; update fa4_project set answers='{\"x\":1}' where project_id='$DEL'; rollback"
eq "$(bm "select count(*) from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member where u.rolname='beeside_discovery_runtime' and r.rolname='beeside_runtime_role'")" 0 "isolation kept: the Discovery login is still NOT in the Precision runtime group (no widening)"
eq "$(bm "begin; select fa4_anonymize_project('$DEL','sim-operator','F1 legitimate erasure by the migrator'); select status from fa4_project where project_id='$DEL'; rollback" 2>&1 | grep -c ANONYMIZED)" 1 "F1 the authorised migrator can still anonymise a delivered project on beeside"
eq "$(dm "begin; select fa4_anonymize_project('$DEL','sim-operator','F1 legitimate erasure by the migrator'); select status from fa4_project where project_id='$DEL'; rollback" 2>&1 | grep -c ANONYMIZED)" 1 "F1 the legacy migrator can still anonymise a delivered project"
eq "$(bm "select count(*) from fa4_project where status='ANONYMIZED'")" 0 "the checks above changed nothing (all rolled back)"

echo "== C7  rollback: writes made on beeside after the cutover are replayed into discovery"
bdr "insert into fa4_project (email,locale,step_key,answers) select 'post'||g||'@beeside.you','es','S1','{\"post\":true}' from generate_series(1,3) g" >/dev/null
bdr "update fa4_project set answers = answers || '{\"edited_on_beeside\":true}', updated_at = now() + interval '2 seconds' where email='tester2@beeside.you'" >/dev/null
SYNC_SOURCE_URL=$DST SYNC_TARGET_URL=$SRC DOMAIN_SYNC_APPROVED=yes sync >/tmp/c7.out 2>&1 && ok "rollback replay ok, checksums match" || bad "rollback :: $(tail -c 500 /tmp/c7.out)"
eq "$(dm "select count(*) from fa4_project")" 63 "legacy now holds every project (54+5+1+3)"
eq "$(dm "select answers->>'edited_on_beeside' from fa4_project where email='tester2@beeside.you'")" true "update made on beeside reached legacy"
eq "$(sql discovery_runtime $LRT discovery "select count(*) from fa4_project")" 63 "legacy runtime still works on discovery"

echo "== C10  F2 BEFORE the cutover: an erasure executed on the LEGACY side must reach beeside before any data moves"
PL=$(bm "select project_id from fa4_project p where p.status='DELIVERED' and not exists (select 1 from fa4_privacy_erasure_log l where l.project_id=p.project_id) order by project_id limit 9")
[ "$(echo "$PL" | wc -l)" -ge 9 ] && ok "9 delivered projects available" || bad "not enough delivered projects"
P1=$(echo "$PL" | sed -n 1p); P2=$(echo "$PL" | sed -n 2p); P3=$(echo "$PL" | sed -n 3p); P4=$(echo "$PL" | sed -n 4p); P5=$(echo "$PL" | sed -n 5p); P6=$(echo "$PL" | sed -n 6p); P7=$(echo "$PL" | sed -n 7p)
PRECISION_BEFORE=$(bm "select md5(string_agg(t::text,'' order by t::text)) from admin_user t")
eq "$(resid bm $P1)" t "P1 holds personal data on beeside"
dm "select fa4_anonymize_project('$P1','sim-operator','F2 rehearsal: erasure executed on legacy')" >/dev/null
eq "$(resid dm $P1)" f "P1 anonymised on legacy"
eq "$(resid bm $P1)" t "the two sides now disagree (beeside still holds P1)"
NP=$(bm "select count(*) from fa4_project")
eq "$(rc env SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST DRY_RUN=yes bash -c "$SYNCJS")" 2 "dry run reports the disagreement (exit 2)"
grep -q '"converged":false' /tmp/rc.out && ok "dry run says erasure.converged=false" || bad "dry run does not report the erasure state"
eq "$(rc env SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST DOMAIN_SYNC_APPROVED=yes bash -c "$SYNCJS")" 3 "FAIL SAFE: the forward sync is refused by the privacy gate (exit 3)"
eq "$(resid bm $P1)" t "nothing was written by the refused sync"
eq "$(bm "select count(*) from fa4_project")" $NP "project count unchanged by the refused sync"
eq "$(rc env ERASURE_SIDE_A_URL=$SRC ERASURE_SIDE_B_URL=$DST DRY_RUN=yes bash -c "$RECJS")" 2 "reconcile dry run: not converged (exit 2), writes nothing"
eq "$(resid bm $P1)" t "dry run applied nothing"
eq "$(rc env ERASURE_SIDE_A_URL=$SRC ERASURE_SIDE_B_URL=$DST bash -c "$RECJS")" 1 "reconcile refused without ERASURE_RECONCILE_APPROVED"
eq "$(rc env ERASURE_SIDE_A_URL=$SRC ERASURE_SIDE_B_URL=$SRC ERASURE_RECONCILE_APPROVED=yes bash -c "$RECJS")" 1 "reconcile refused when both sides are the same database"
eq "$(rc env ERASURE_SIDE_A_URL=$SRC ERASURE_SIDE_B_URL=$DST ERASURE_RECONCILE_APPROVED=yes bash -c "$RECJS")" 0 "reconcile applies the legacy erasure on beeside"
eq "$(resid bm $P1)" f "P1 is anonymised on beeside (status, e-mail, answers, sealed result)"
eq "$(bm "select count(*) from fa4_privacy_erasure_log where project_id='$P1' and reason like 'propagated of erasure %'")" 1 "evidence: beeside log has ONE new row naming the origin"
eq "$(dm "select count(*) from fa4_privacy_erasure_log where project_id='$P1'")" 1 "evidence: the legacy log is untouched"
eq "$(bm "select count(*) from fa4_project where status='ANONYMIZED'")" 1 "only the erased project was anonymised"
eq "$(rc env ERASURE_SIDE_A_URL=$SRC ERASURE_SIDE_B_URL=$DST ERASURE_RECONCILE_APPROVED=yes bash -c "$RECJS")" 0 "reconcile is idempotent"
eq "$(grep -o '"applied":0' /tmp/rc.out | wc -l)" 2 "second run applied nothing on either side"
eq "$(rc env SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST DOMAIN_SYNC_APPROVED=yes bash -c "$SYNCJS")" 0 "forward sync now succeeds, every checksum matches"
eq "$(bm "select count(*) from fa4_privacy_erasure_log where project_id='$P1'")" 2 "the sync copied the log rows: beeside holds origin + propagated"
eq "$(dm "select count(*) from fa4_privacy_erasure_log where project_id='$P1'")" 1 "a forward sync writes nothing on legacy (the propagated row reaches it with the next reverse sync)"
eq "$(resid bm $P1)" f "P1 still anonymised after the sync"

echo "== C11  F2 AFTER the cutover: an erasure executed on beeside survives the rollback to discovery"
bm "select fa4_anonymize_project('$P2','sim-operator','F2 rehearsal: erasure executed on beeside after the cutover')" >/dev/null
eq "$(resid bm $P2)" f "P2 anonymised on beeside"
eq "$(resid dm $P2)" t "legacy still holds P2 (the rollback target is stale)"
NL=$(dm "select count(*) from fa4_project")
eq "$(rc env SYNC_SOURCE_URL=$DST SYNC_TARGET_URL=$SRC DOMAIN_SYNC_APPROVED=yes bash -c "$SYNCJS")" 3 "FAIL SAFE: the reverse sync is refused by the privacy gate (exit 3)"
eq "$(resid dm $P2)" t "legacy untouched by the refused reverse sync"
eq "$(dm "select count(*) from fa4_project")" $NL "legacy project count unchanged"
failmsg "the legacy RUNTIME cannot be used to propagate (only the migrator may run the erasure function)" "could not be applied\|permission denied" env ERASURE_SIDE_A_URL=$LEGR ERASURE_SIDE_B_URL=$DST ERASURE_RECONCILE_APPROVED=yes bash -c "$RECJS"
eq "$(resid dm $P2)" t "a failed propagation changed nothing"
eq "$(rc env ERASURE_SIDE_A_URL=$SRC ERASURE_SIDE_B_URL=$DST ERASURE_RECONCILE_APPROVED=yes bash -c "$RECJS")" 0 "reconcile applies the beeside erasure on legacy with the legacy migrator"
eq "$(resid dm $P2)" f "legacy P2 anonymised before the rollback"
eq "$(dm "select count(*) from fa4_privacy_erasure_log where project_id='$P2' and reason like 'propagated of erasure %'")" 1 "evidence on legacy: one propagated row naming beeside"
eq "$(rc env SYNC_SOURCE_URL=$DST SYNC_TARGET_URL=$SRC DOMAIN_SYNC_APPROVED=yes bash -c "$SYNCJS")" 0 "reverse sync (rollback replay) succeeds"
eq "$(resid dm $P2)" f "NO REAPPEARANCE: legacy P2 stays anonymised after the replay"
eq "$(sql discovery_runtime $LRT discovery "select status || ':' || (email like 'anonymized+%@invalid.invalid') from fa4_project where project_id='$P2'")" "ANONYMIZED:true" "the legacy application sees an anonymised project"
failmsg "the legacy application cannot rewrite the erased delivered project" "BV604\|closed to editing" sql discovery_runtime $LRT discovery "update fa4_project set answers='{\"x\":1}' where project_id='$P2'"
eq "$(rc env SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST DOMAIN_SYNC_APPROVED=yes bash -c "$SYNCJS")" 0 "forward sync again (re-cutover) succeeds"
eq "$(resid bm $P2)" f "NO REAPPEARANCE the other way: beeside P2 stays anonymised"
eq "$(bm "select count(*) from fa4_privacy_erasure_log")" "$(dm "select count(*) from fa4_privacy_erasure_log")" "both erasure logs hold the same history"

echo "== C12  F2 DURING the transition: an erasure recorded while the sync runs, and a held lock"
cat > /tmp/during.js <<'JS'
const rq = (m) => require(require.resolve(m, { paths: [process.env.BACK] }));
const { Client } = rq("pg");
const { runSync } = require(process.env.BACK + "/dist/db/domain-data-sync");
(async () => {
  const [s, t, x] = [new Client({ connectionString: process.env.SRC }), new Client({ connectionString: process.env.DST }), new Client({ connectionString: process.env.SRC })];
  await Promise.all([s.connect(), t.connect(), x.connect()]);
  let fired = false;
  const when = process.env.WHEN === "first" ? /row_to_json/ : /row_to_json.*fa4_privacy_erasure_log/;
  const src = { query: async (sql, p) => { if (!fired && when.test(sql)) { fired = true; await x.query("select fa4_anonymize_project($1::uuid,'sim-operator','erasure recorded while the sync runs')", [process.env.PID]); } return s.query(sql, p); } };
  try { await runSync(src, t, {}); console.log("NO-ERROR"); } catch (e) { console.log(e.name + ": " + String(e.message).slice(0, 110)); }
  await Promise.all([s.end(), t.end(), x.end()]);
})();
JS
NP=$(bm "select count(*) from fa4_project")
OUT=$(WHEN=log BACK=$B SRC=$SRC DST=$DST PID=$P3 node /tmp/during.js 2>&1)
echo "$OUT" | grep -q "^ErasureGateError" && ok "the sync aborted at its final check: an erasure was recorded on the source while it ran :: $(echo "$OUT" | cut -c1-120)" || bad "no abort: $OUT"
eq "$(resid dm $P3)" f "the erasure itself stands (legacy P3 anonymised)"
eq "$(resid bm $P3)" t "ROLLBACK: nothing of that sync reached beeside"
eq "$(bm "select count(*) from fa4_project")" $NP "beeside project count unchanged"
OUT=$(WHEN=first BACK=$B SRC=$SRC DST=$DST PID=$P7 node /tmp/during.js 2>&1)
echo "$OUT" | grep -q "^NO-ERROR" && bad "an erasure in the middle of the copy did not abort the sync" || ok "an erasure recorded in the middle of the copy aborts the sync as well :: $(echo "$OUT" | cut -c1-100)"
eq "$(resid bm $P7)" t "ROLLBACK: nothing of that sync reached beeside (P7)"
eq "$(rc env ERASURE_SIDE_A_URL=$SRC ERASURE_SIDE_B_URL=$DST ERASURE_RECONCILE_APPROVED=yes bash -c "$RECJS")" 0 "reconcile after the late erasure"
eq "$(rc env SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST DOMAIN_SYNC_APPROVED=yes bash -c "$SYNCJS")" 0 "the repeated sync succeeds"
( bm "begin; lock table fa4_privacy_erasure_log in row exclusive mode; select pg_sleep(6); rollback" >/dev/null 2>&1 & ) ; sleep 1.5
eq "$(rc env SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST DOMAIN_SYNC_APPROVED=yes DOMAIN_SYNC_LOCK_TIMEOUT_MS=1000 bash -c "$SYNCJS")" 1 "an erasure holding the log makes the sync fail fast (lock timeout), writing nothing"
grep -q "lock timeout" /tmp/rc.out && ok "the failure is the lock timeout" || bad "unexpected failure: $(tail -c 200 /tmp/rc.out)"
sleep 5

echo "== C13  F2 emergency rollback: beeside unreachable, erasures applied to legacy from a verified manifest"
bm "select fa4_anonymize_project('$P4','sim-operator','F2 rehearsal: erasure executed on beeside, then beeside is lost')" >/dev/null
rm -f /tmp/rh-mf.json
eq "$(rc env ERASURE_SIDE_A_URL=$SRC ERASURE_SIDE_B_URL=$DST DRY_RUN=yes ERASURE_EXPORT_MANIFEST=/tmp/rh-mf.json bash -c "$RECJS")" 2 "the manifest is exported while beeside is still reachable"
eq "$(stat -c %a /tmp/rh-mf.json)" 600 "the manifest file is private (0600)"
grep -qi '@\|answers\|"email"' /tmp/rh-mf.json && bad "the manifest carries personal data" || ok "the manifest carries identifiers only, no personal data"
sed 's/"actor":"sim-operator"/"actor":"someone-else"/' /tmp/rh-mf.json > /tmp/rh-mf-bad.json
eq "$(rc env ERASURE_SIDE_A_URL=$SRC ERASURE_MANIFEST_FILE=/tmp/rh-mf-bad.json ERASURE_RECONCILE_APPROVED=yes bash -c "$RECJS")" 3 "a tampered manifest is refused (SHA-256 mismatch)"
eq "$(resid dm $P4)" t "the refused manifest changed nothing"
eq "$(rc env ERASURE_SIDE_A_URL=$SRC ERASURE_MANIFEST_FILE=/tmp/rh-mf.json ERASURE_RECONCILE_APPROVED=yes bash -c "$RECJS")" 0 "the verified manifest is applied on legacy alone"
eq "$(resid dm $P4)" f "legacy P4 anonymised without reaching beeside"
eq "$(dm "select count(*) from fa4_privacy_erasure_log where project_id='$P4' and reason like 'propagated of erasure %'")" 1 "evidence: propagated row on legacy"
eq "$(rc env ERASURE_SIDE_A_URL=$SRC ERASURE_SIDE_B_URL=$DST ERASURE_RECONCILE_APPROVED=yes bash -c "$RECJS")" 0 "when beeside is back both sides converge"
eq "$(rc env SYNC_SOURCE_URL=$DST SYNC_TARGET_URL=$SRC DOMAIN_SYNC_APPROVED=yes bash -c "$SYNCJS")" 0 "and the replay succeeds"

echo "== C14  F2 fail-safe behaviour and the database-level backstop (migration 0053 on beeside)"
bm "select fa4_anonymize_project('$P5','sim-operator','F2 rehearsal: P5')" >/dev/null
failmsg "no erasure function / no erasure log -> not converged, stop (exit 3)" "missing" env ERASURE_SIDE_A_URL="postgres://sqladmin:$ADM@127.0.0.1:5433/postgres" ERASURE_SIDE_B_URL=$DST DRY_RUN=yes bash -c "$RECJS"
failmsg "tombstone: the migrator cannot put an e-mail back on an erased project" "BV607\|cannot receive personal data" bm "update fa4_project set email='back@example.invalid' where project_id='$P1'"
failmsg "tombstone: nobody can reopen the answers of an erased project (migrator; the delivered-project guard answers first)" "BV607\|BV604\|cannot receive personal data\|closed to editing" bm "update fa4_project set answers='{\"x\":1}' where project_id='$P1'"
failmsg "tombstone: the Discovery runtime cannot either" "BV607\|BV604\|cannot receive\|closed to editing" bdr "update fa4_project set answers='{\"x\":1}' where project_id='$P1'"
failmsg "tombstone: a contact request with personal data cannot be attached to an erased project" "BV607\|only the scrubbed form" bm "insert into fa4_contact_request (project_id,name,company,email,message,language,client_request_id) values ('$P1','Late Name','Co','late@example.invalid','late message','es','late-bm')"
failmsg "tombstone: an ANONYMIZED row cannot be inserted carrying personal data" "BV607\|scrubbed values only" bm "insert into fa4_project (project_id,email,locale,step_key,answers,status) values (gen_random_uuid(),'x@example.invalid','es','S1','{}','ANONYMIZED')"
eq "$(bm "begin; select fa4_anonymize_project('$P1','sim-operator','second erasure is harmless'); select count(*) from fa4_privacy_erasure_log where project_id='$P1'; rollback" 2>&1 | grep -c '^3$')" 1 "tombstone: a second legitimate erasure still works (idempotent)"
# residue: personal data attached on the LEGACY side after the project was erased (legacy has no tombstone yet)
dm "insert into fa4_contact_request (project_id,name,company,email,message,language,client_request_id) values ('$P1','Late Name','Co','late@example.invalid','late message','es','late-dm')" >/dev/null
eq "$(rc env SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST DOMAIN_SYNC_APPROVED=yes bash -c "$SYNCJS")" 3 "residual personal data on an erased project stops the sync (exit 3)"
eq "$(bm "select count(*) from fa4_contact_request where client_request_id='late-dm'")" 0 "and it never reached beeside"
eq "$(rc env ERASURE_SIDE_A_URL=$SRC ERASURE_SIDE_B_URL=$DST ERASURE_RECONCILE_APPROVED=yes bash -c "$RECJS")" 0 "reconcile re-scrubs the residue on legacy"
eq "$(dm "select name from fa4_contact_request where client_request_id='late-dm'")" anonymized "the late contact is scrubbed"
eq "$(dm "select count(*) from fa4_privacy_erasure_log where project_id='$P1' and reason like 'residual re-scrub%'")" 1 "evidence: a re-scrub row names the residue"
eq "$(rc env SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST DOMAIN_SYNC_APPROVED=yes bash -c "$SYNCJS")" 0 "then the sync copies the scrubbed form (the tombstone accepts it)"
eq "$(bm "select name from fa4_contact_request where client_request_id='late-dm'")" anonymized "beeside holds only the scrubbed contact"
IPP=$(bm "select project_id from fa4_project where status='IN_PROGRESS' order by project_id limit 1")
bm "select fa4_anonymize_project('$IPP','sim-operator','F2 rehearsal: an in-progress project')" >/dev/null
failmsg "tombstone: the Discovery runtime edits in-progress projects, but NOT an erased one (answers)" "BV607\|cannot receive" bdr "update fa4_project set answers='{\"x\":1}', updated_at=now() where project_id='$IPP'"
failmsg "tombstone: nor can an erased project be reopened (status)" "BV607\|cannot receive" bdr "update fa4_project set status='IN_PROGRESS' where project_id='$IPP'"
expect_ok "tombstone: an ordinary in-progress project is still editable by the Discovery runtime" bdr "update fa4_project set step_key='S9', updated_at=now() where status='IN_PROGRESS' and project_id<>'$IPP' and email='cut1@beeside.you'"
eq "$(rc env ERASURE_SIDE_A_URL=$SRC ERASURE_SIDE_B_URL=$DST ERASURE_RECONCILE_APPROVED=yes bash -c "$RECJS")" 0 "reconcile carries the in-progress erasure to legacy"
eq "$(rc env SYNC_SOURCE_URL=$DST SYNC_TARGET_URL=$SRC DOMAIN_SYNC_APPROVED=yes bash -c "$SYNCJS")" 0 "and the replay keeps legacy in step"
eq "$(rc env SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST DOMAIN_SYNC_APPROVED=yes bash -c "$SYNCJS")" 0 "and so does the forward copy"
eq "$(bm "select md5(string_agg(t::text,'' order by t::text)) from admin_user t")" "$PRECISION_BEFORE" "isolation: none of this touched the Precision-domain tables"
eq "$(bm "select count(*) from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member where u.rolname='beeside_discovery_runtime' and r.rolname='beeside_runtime_role'")" 0 "isolation: the Discovery login still outside the Precision group"

echo "== C15  OPTIONAL legacy protection: the same tombstone on discovery during the window, and its rollback"
LEGSQL(){ PGPASSWORD=$LEG psql -qXAt -v ON_ERROR_STOP=1 $H -U discovery_migrate -d discovery -1 -f "$1"; }
LEGTRG(){ dm "select count(*) from pg_trigger where tgname like 'fa4_tombstone_%'"; }
eq "$(LEGTRG)" 0 "legacy has no tombstone triggers before"
LEGSQL $REPO/backend/db/migrations/0053_privacy_erasure_tombstone.sql >/dev/null 2>&1 && ok "migration 0053 SQL applied to legacy as discovery_migrate (single transaction)" || bad "legacy tombstone apply"
eq "$(LEGTRG)" 4 "4 triggers on legacy"
failmsg "legacy: the legacy runtime cannot attach personal data to an erased project" "BV607\|only the scrubbed form" sql discovery_runtime $LRT discovery "insert into fa4_contact_request (project_id,name,company,email,message,language,client_request_id) values ('$P1','N','C','n@example.invalid','m','es','late-lr')"
failmsg "legacy: nor reopen an erased in-progress project" "BV607\|cannot receive" sql discovery_runtime $LRT discovery "update fa4_project set email='back@example.invalid' where project_id='$P1'"
expect_ok "legacy: normal application writes still work" sql discovery_runtime $LRT discovery "update fa4_project set step_key='S3', updated_at=now() where email='cut1@beeside.you'"
dm "select fa4_anonymize_project('$P6','sim-operator','F2 rehearsal: erasure under the legacy tombstone')" >/dev/null && ok "legacy: a legitimate erasure still works under the tombstone" || bad "legacy erasure under tombstone"
eq "$(resid dm $P6)" f "legacy P6 anonymised"
eq "$(rc env ERASURE_SIDE_A_URL=$SRC ERASURE_SIDE_B_URL=$DST ERASURE_RECONCILE_APPROVED=yes bash -c "$RECJS")" 0 "reconcile works against a protected legacy"
eq "$(rc env SYNC_SOURCE_URL=$SRC SYNC_TARGET_URL=$DST DOMAIN_SYNC_APPROVED=yes bash -c "$SYNCJS")" 0 "forward sync works against a protected legacy"
eq "$(rc env SYNC_SOURCE_URL=$DST SYNC_TARGET_URL=$SRC DOMAIN_SYNC_APPROVED=yes bash -c "$SYNCJS")" 0 "reverse sync works against a protected legacy"
LEGSQL $REPO/infra/db/legacy/legacy-erasure-guard-rollback.sql >/dev/null 2>&1 && ok "rollback SQL applied" || bad "legacy tombstone rollback"
eq "$(LEGTRG)" 0 "legacy is back to its original trigger set"
eq "$(dm "select count(*) from pg_proc where proname='fa4_erased_project_guard'")" 0 "and the function is gone"
eq "$(dm "select count(*) from fa4_project")" "$(bm "select count(*) from fa4_project")" "no data was lost by applying or rolling back the protection"

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
