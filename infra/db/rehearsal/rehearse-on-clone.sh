#!/usr/bin/env bash
# PRECISION V2.0 — SQL-side rehearsal of the canonical database ON THE TEMPORARY CLONE (after clone-rehearsal.sh create + harden + mark).
# Touches ONLY the server that carries the rehearsal marker (see clone-rehearsal.sh). Never reads production secrets: every credential comes from $REHEARSAL_DIR.
# It is the production procedure (provision-beeside.sh pre/post, migrate, domain-roles-prepare, domain-data-sync, legacy hardening) executed for real against Cloud SQL's
# real role model, plus the negative tests and the rollback drill. Everything it creates lives in the clone and disappears with it.
#
#   needs: the Auth Proxy running on the clone (cloud-sql-proxy beeside-discovery-prod:northamerica-south1:<clone> --port 5435), psql, node, the built backend (npm run build --workspace=backend)
#   run:   TAG=<tag> bash infra/db/rehearsal/rehearse-on-clone.sh   (fixed target; the marker role and the netcheck_ok evidence are the gates; no host/port/db/dir overrides exist)
# Output: PASS/FAIL per check, INFO lines for measurements, evidence folder with the sanitized log (no secret values; the log is scanned for them at the end).
# Exit 0 only when every check passes (WARN and INFO do not fail the run).
#
# FAIL-FAST: every irreversible or destructive step (the reverse reconciliation into the legacy database, the legacy hardening, the persisted anonymisation, DROP DATABASE,
# DROP ROLE and every permission change) is preceded by identity_gate: it needs zero failed checks so far AND the marker role on every connection the step will use. A critical
# identity / isolation / integrity check (must_*) stops the run on the spot. The script NEVER deletes the clone: when it stops it prints the controlled teardown command
# (exact name and explicit confirmation are required there).
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../../.." && pwd); B=$REPO/backend
stop(){ echo "STOP: $*" >&2; exit 9; }
# ---- FIXED TARGET: no variable can point this script at another host, port, database, project or instance ---------------------------------------------------------
# Real mode: host 127.0.0.1, port 5435 (the Auth Proxy opened on the CLONE), admin postgres, legacy database discovery, canonical database beeside, secrets directory
# $HOME/.beeside-rehearsal/discovery-db-rehearsal-<TAG>. Anything that could redirect it makes the script stop. REHEARSAL_SIMULATOR=1 (local PostgreSQL simulator only) is the single
# switch that allows a different directory / admin / port, and even then only loopback port 5433 (never 5434, the production proxy port) is accepted.
for v in PROJECT REGION SOURCE_INSTANCE SOURCE SQL_INSTANCE ALLOW_OTHER_PROJECT CLONE CLONE_HOST LEGACY_DB CANONICAL_DB; do
  [ -z "${!v-}" ] || stop "the variable $v is set: this script has a FIXED target and accepts no redirection (unset it: env -u $v ...)"
done
if [ "${REHEARSAL_SIMULATOR:-0}" = 1 ]; then
  [ "${PROXY_PORT:-5433}" = 5433 ] || stop "simulator mode accepts only PROXY_PORT=5433"
  PORT=5433; ADMIN=${ADMIN_USER:-sqladmin}; REHEARSAL_DIR=${REHEARSAL_DIR:?simulator mode needs REHEARSAL_DIR}
  CLONE=$(cat "$REHEARSAL_DIR/clone_name" 2>/dev/null || echo simulator)
else
  for v in PROXY_PORT ADMIN_USER REHEARSAL_DIR REHEARSAL_APPLY_SQL; do [ -z "${!v-}" ] || stop "the variable $v is set: this script has a FIXED target (unset it: env -u $v ...). The clone is selected only by TAG"; done
  PORT=5435; ADMIN=postgres
  TAG=${TAG:?set TAG=<the tag used with clone-rehearsal.sh create>}
  printf '%s' "$TAG" | grep -Eq '^[0-9a-z]{1,12}$' || stop "TAG must match ^[0-9a-z]{1,12}$"
  CLONE="discovery-db-rehearsal-$TAG"
  [ -n "${HOME:-}" ] && [ "$HOME" != "/" ] || stop "HOME is not set"
  REHEARSAL_DIR="$HOME/.beeside-rehearsal/$CLONE"
fi
readonly HOST=127.0.0.1 LEGDB=discovery NEWDB=beeside CLONE PORT ADMIN REHEARSAL_DIR
[ "$PORT" != 5434 ] || stop "port 5434 is the production proxy port"
[ -d "$REHEARSAL_DIR" ] || stop "no rehearsal directory ($REHEARSAL_DIR): run clone-rehearsal.sh create/harden/mark first"
if [ "${REHEARSAL_SIMULATOR:-0}" != 1 ]; then
  # evidence that clone-rehearsal.sh create rotated the passwords and verified network + TLS on THIS clone, and that the clone has not outlived its 24 h maximum
  [ -f "$REHEARSAL_DIR/netcheck_ok" ] || stop "no network/TLS gate evidence (netcheck_ok) in $REHEARSAL_DIR: the clone was not created by clone-rehearsal.sh create"
  read -r NC_EPOCH NC_CONN < "$REHEARSAL_DIR/netcheck_ok" || stop "unreadable netcheck_ok"
  case "$NC_EPOCH" in ''|*[!0-9]*) stop "malformed netcheck_ok";; esac
  [ "$NC_CONN" = "beeside-discovery-prod:northamerica-south1:$CLONE" ] || stop "the gate evidence belongs to '$NC_CONN', not to $CLONE"
  AGE=$(( $(date -u +%s) - NC_EPOCH )); [ "$AGE" -ge 0 ] && [ "$AGE" -le 86400 ] || stop "the clone is older than 24 h (age ${AGE}s): tear it down and create a new one"
fi
# any accidental gcloud call from the tools below fails: this script never talks to GCP
SHIM=$(mktemp -d); printf '#!/bin/sh\necho "gcloud is disabled inside rehearse-on-clone.sh" >&2\nexit 97\n' > "$SHIM/gcloud"; chmod +x "$SHIM/gcloud"; export PATH="$SHIM:$PATH"
SECTION=init
on_exit(){ # prints, never deletes
  local rc=$?; trap - EXIT; rm -rf "$SHIM"
  if [ "$rc" -ne 0 ] && [ "${REHEARSAL_SIMULATOR:-0}" != 1 ]; then
    { echo "== The SQL rehearsal stopped in '$SECTION' (exit $rc). The clone $CLONE was NOT touched and NOT deleted."
      echo "== Evidence so far: ${EVID:-unknown}.  To remove the clone (your explicit decision):"
      echo "==   RUN=1 APPROVAL=CLONE_REHEARSAL_APPROVED CONFIRM_DELETE=$CLONE TAG=$TAG bash infra/db/rehearsal/clone-rehearsal.sh teardown"; } >&2
  fi
  exit "$rc"
}
trap on_exit EXIT
EVID=${EVIDENCE_DIR:-$HOME/Downloads/rehearsal-evidence-$(date -u +%Y%m%dT%H%M%SZ)}
S="$REHEARSAL_DIR/secrets"; mkdir -p "$EVID"; ( umask 077; mkdir -p "$S" )
exec > >(tee -a "$EVID/log.txt") 2>&1
PASS=0; FAIL=0; WARN=0
ok(){ PASS=$((PASS+1)); echo "  PASS  $1"; }
bad(){ FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
warn(){ WARN=$((WARN+1)); echo "  WARN  $1"; }
info(){ echo "  INFO  $1"; }
die(){ stop "$@"; }
eq(){ [ "$1" = "$2" ] && ok "$3 ($1)" || bad "$3 (got '$1', expected '$2')"; }
expect_ok(){ local d="$1"; shift; if "$@" >"$EVID/.last" 2>&1; then ok "$d"; else bad "$d :: $(tr '\n' ' ' <"$EVID/.last" | cut -c1-240)"; fi; }
expect_fail(){ local d="$1"; shift; if "$@" >"$EVID/.last" 2>&1; then bad "$d (it succeeded)"; else ok "$d"; fi; }
# a refusal counts only when the server refused it for the expected reason (a dropped connection or a typo is not a security control)
expect_fail_like(){ local d="$1" pat="$2"; shift 2; if "$@" >"$EVID/.last" 2>&1; then bad "$d (it succeeded)"; elif grep -qiE -- "$pat" "$EVID/.last"; then ok "$d"; else bad "$d (it failed for another reason: $(tr '\n' ' ' <"$EVID/.last" | cut -c1-160))"; fi; }
summary(){ echo "== SUMMARY  pass=$PASS fail=$FAIL warn=$WARN  · evidence: $EVID"; }
halt(){ echo "  HALT  $*"; echo "== HALTED in $SECTION. No destructive or irreversible operation after this point was executed (no reverse reconciliation, no permission change, no DROP DATABASE, no DROP ROLE)."; summary; exit 1; }
crit_gate(){ [ "$FAIL" -eq 0 ] || halt "$1: $FAIL check(s) failed before this step"; }
must_eq(){ if [ "$1" = "$2" ]; then ok "$3 ($1)"; else bad "$3 (got '$1', expected '$2')"; halt "critical check failed: $3"; fi; }
must_ok(){ local d="$1"; shift; if "$@" >"$EVID/.last" 2>&1; then ok "$d"; else bad "$d :: $(tr '\n' ' ' <"$EVID/.last" | cut -c1-240)"; halt "critical step failed: $d"; fi; }
must_fail_like(){ local d="$1" pat="$2"; shift 2; if "$@" >"$EVID/.last" 2>&1; then bad "$d (it succeeded)"; halt "critical isolation check failed: $d"; elif grep -qiE -- "$pat" "$EVID/.last"; then ok "$d"; else bad "$d (it failed for another reason)"; halt "critical isolation check failed: $d"; fi; }
pw(){ cat "$REHEARSAL_DIR/pw_$1" 2>/dev/null || cat "$S/$1" 2>/dev/null; }
sqlu(){ local user=$1 pass=$2 db=$3; shift 3; PGPASSWORD=$pass psql -qXAt -v ON_ERROR_STOP=1 -h "$HOST" -p "$PORT" -U "$user" -d "$db" -c "$*"; }
adm(){ sqlu "$ADMIN" "$(pw "$ADMIN")" "${DB:-postgres}" "$@"; }
admdb(){ local db=$1; shift; sqlu "$ADMIN" "$(pw "$ADMIN")" "$db" "$@"; }
enc(){ node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }
url(){ echo "postgres://$(enc "$1"):$(enc "$2")@$HOST:$PORT/$3"; }

# ---- 0. gate: only the marked clone --------------------------------------------------------------------------------------------------------------------------------
echo "== S0  gate (marker role) and clone fidelity"
[ -f "$REHEARSAL_DIR/marker" ] || die "no marker file: run clone-rehearsal.sh mark first"
M=$(cat "$REHEARSAL_DIR/marker"); case "$M" in rehearsal_marker_[0-9a-f]*) ;; *) die "malformed marker file";; esac
GOT=$(admdb postgres "select count(*) from pg_roles where rolname='$M'" 2>/dev/null) || die "cannot log in as $ADMIN with the clone credentials on $HOST:$PORT"
[ "$GOT" = 1 ] || die "the server on $HOST:$PORT does NOT carry the rehearsal marker role: this is not the clone. Nothing was executed."
ok "marker verified: this server is the rehearsal clone"
SECTION="S0 gate"
export BACKEND_DIR=$B
LEGMIG=$(pw discovery_migrate); LEGRT=$(pw discovery_runtime)
dm(){ sqlu discovery_migrate "$LEGMIG" $LEGDB "$@"; }
must_eq "$(admdb postgres "show server_version_num" | cut -c1-2)" 16 "PostgreSQL 16"
must_eq "$(admdb postgres "select count(*) from pg_database where datname='$NEWDB'")" 0 "the canonical database does not exist yet"
must_eq "$(admdb postgres "select count(*) from pg_database where datname='$LEGDB'")" 1 "the legacy database exists on this server"
must_eq "$(admdb postgres "select count(*) from pg_roles where rolname in ('beeside_migrate','beeside_discovery_runtime','beeside_runtime')")" 0 "the roles the rehearsal creates (and S7 drops) do not exist yet: S7 can only remove what this run created"
info "legacy encoding/collation: $(admdb postgres "select pg_encoding_to_char(encoding)||' / '||datcollate from pg_database where datname='$LEGDB'")"
info "legacy database owner: $(admdb postgres "select pg_get_userbyid(datdba) from pg_database where datname='$LEGDB'")"
for t in "fa4_project ${EXPECT_PROJECTS:-54}" "fa4_result ${EXPECT_RESULTS:-39}" "fa4_event ${EXPECT_EVENTS:-402}"; do set -- $t
  n=$(dm "select count(*) from $1"); [ "$n" = "$2" ] && ok "clone data matches the Part B evidence: $1 = $n" || warn "$1 = $n (Part B evidence says $2; production may have moved since)"; done
info "members of beeside_runtime_role (all, incl. cloudsql*): $(admdb "$LEGDB" "select coalesce(string_agg(pg_get_userbyid(member)||'[admin='||admin_option||',inherit='||inherit_option||']', ', '),'none') from pg_auth_members where roleid='beeside_runtime_role'::regrole")"
info "role attributes of discovery_migrate: $(admdb "$LEGDB" "select 'super='||rolsuper||' createrole='||rolcreaterole||' createdb='||rolcreatedb from pg_roles where rolname='discovery_migrate'")"
eq "$(admdb "$LEGDB" "select count(*) from pg_auth_members m where m.roleid='beeside_runtime_role'::regrole and m.member='discovery_migrate'::regrole")" 0 "Q13 reproduced: discovery_migrate has NO membership row in beeside_runtime_role"
BEFORE_ROLES=$(admdb postgres "select string_agg(rolname,',' order by rolname) from pg_roles where rolname in ('beeside_migrate','beeside_discovery_runtime','beeside_runtime','beeside_discovery_rw','beeside_analytics_reader','beeside_runtime_role')")
info "managed roles that exist BEFORE provisioning: $BEFORE_ROLES"
crit_gate "end of S0"

# identity / isolation / integrity gate in front of every destructive or irreversible step (also re-checks the 24 h life of the clone)
identity_gate(){ # $1 = the step about to run
  SECTION="gate before $1"; crit_gate "$1"
  local v
  v=$(admdb postgres "select count(*) from pg_roles where rolname='$M'" 2>/dev/null) || halt "$1: cannot reach the clone as $ADMIN"
  [ "$v" = 1 ] || halt "$1: the admin connection does not land on the marked clone"
  v=$(dm "select count(*) from pg_roles where rolname='$M'" 2>/dev/null) || halt "$1: cannot reach the clone as discovery_migrate"
  [ "$v" = 1 ] || halt "$1: the discovery_migrate connection does not land on the marked clone"
  if [ "$(admdb postgres "select count(*) from pg_database where datname='$NEWDB'")" = 1 ]; then
    v=$(bm "select count(*) from pg_roles where rolname='$M'" 2>/dev/null) || halt "$1: cannot reach the clone as beeside_migrate"
    [ "$v" = 1 ] || halt "$1: the beeside_migrate connection does not land on the marked clone"
  fi
  if [ "${REHEARSAL_SIMULATOR:-0}" != 1 ]; then
    read -r NC_EPOCH2 NC_CONN2 < "$REHEARSAL_DIR/netcheck_ok" 2>/dev/null || halt "$1: gate evidence (netcheck_ok) disappeared"
    [ "$NC_CONN2" = "beeside-discovery-prod:northamerica-south1:$CLONE" ] && [ $(( $(date -u +%s) - NC_EPOCH2 )) -le 86400 ] || halt "$1: the clone identity evidence is not valid any more (age > 24 h or another instance)"
  fi
  ok "identity gate before $1: no failed check so far; marker present on every connection this step uses"
}

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
  SECTION="$1 PRE"; crit_gate "$1: PRE checks (nothing is migrated on a database whose PRE state is wrong)"
  T0=$(date +%s); migrate_new >"$EVID/.mig" 2>&1 && ok "migrations applied to $NEWDB :: $(tail -1 "$EVID/.mig" | cut -c1-80)" || bad "migrate :: $(tail -3 "$EVID/.mig" | cut -c1-300)"
  info "migration wall time: $(( $(date +%s) - T0 )) s"
  migrate_new --check >"$EVID/.mig" 2>&1 && ok "migrate --check: safe, nothing pending" || bad "migrate --check"
  eq "$(bm "select count(*) from pg_auth_members m where m.member='beeside_migrate'::regrole and m.roleid in ('beeside_runtime_role'::regrole,'beeside_discovery_rw'::regrole)")" 0 "migrator has NO membership row in the runtime groups after migrating"
  SECTION="$1 migrate"; crit_gate "$1: migrations (no POST on a failed migration)"
  MODE=plan PHASE=post prov >"$EVID/.plan" 2>&1; grep -q "holds no ADMIN OPTION" "$EVID/.plan" && info "POST needs the legacy group owner (LEGACY_GROUP_ADMIN_URL): the admin holds NO ADMIN OPTION on beeside_runtime_role" || info "POST needs no legacy owner: the admin already holds ADMIN OPTION on beeside_runtime_role"
  expect_ok "post (wrapper, written approval)" env APPROVAL=CANONICAL_DB_PROVISION_APPROVED PHASE=post $WRAP post
  expect_ok "verify POST has no errors" env PHASE=post $WRAP verify
  drp >"$EVID/.drp" 2>&1 && ok "domain-roles-prepare :: $(grep -c '"ok:' "$EVID/.drp") checks ok, $(grep -c FAILED "$EVID/.drp") failed" || bad "domain-roles-prepare :: $(tail -3 "$EVID/.drp" | cut -c1-400)"
  drp >"$EVID/.drp2" 2>&1 && ok "domain-roles-prepare is idempotent" || bad "domain-roles-prepare second run"
  SECTION="$1 POST"; crit_gate "$1: POST / 17-point contract"
}

SECTION="S1 provision"; provision_all "S1"
if [ "${REHEARSAL_SIMULATOR:-0}" = 1 ] && [ -n "${REHEARSAL_APPLY_SQL:-}" ]; then   # simulator only: lets a PROPOSED fix be rehearsed end to end before it is adopted
  [ -f "$REHEARSAL_APPLY_SQL" ] || die "REHEARSAL_APPLY_SQL does not exist"
  sed 's/--> statement-breakpoint//' "$REHEARSAL_APPLY_SQL" > "$EVID/.apply.sql"
  must_ok "simulator only: proposed SQL applied as the database owner ($(basename "$REHEARSAL_APPLY_SQL"))" env PGPASSWORD="$(pw beeside-migrate-password)" psql -qXAt -v ON_ERROR_STOP=1 -h "$HOST" -p "$PORT" -U beeside_migrate -d $NEWDB -f "$EVID/.apply.sql"
  rm -f "$EVID/.apply.sql"
fi

# ---- data: copy, reconcile, permissions, privacy bypass, rollback replay ---------------------------------------------------------------------------------------------
echo "== S2  data copy discovery → $NEWDB (dry run, copy, idempotency, late writes, reconcile)"
identity_gate "S2 data copy"
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

echo "== S3  runtime permissions on $NEWDB (a refusal must be 'permission denied': a dropped connection is not a control)"
SECTION="S3 permissions"
expect_ok "Discovery runtime inserts a project" bdr "insert into fa4_project (email,locale,step_key,answers) values ('cut1@beeside.you','es','S1','{}')"
expect_ok "Discovery runtime updates a project" bdr "update fa4_project set step_key='S2', updated_at=now() where email='cut1@beeside.you'"
must_fail_like "Discovery runtime cannot DELETE" "permission denied" bdr "delete from fa4_project where email='cut1@beeside.you'"
must_fail_like "Discovery runtime cannot read operator accounts" "permission denied" bdr "select count(*) from admin_user"
must_fail_like "Discovery runtime cannot create objects" "permission denied" bdr "create table x(i int)"
must_fail_like "Discovery runtime cannot read Precision data" "permission denied" bdr "select count(*) from company"
expect_ok "Precision runtime reads Discovery records" brt "select count(*) from fa4_project"
must_fail_like "Precision runtime cannot write Discovery records" "permission denied" brt "update fa4_project set step_key='X'"
must_fail_like "Precision runtime cannot insert Discovery records" "permission denied" brt "insert into fa4_project (email,locale,step_key,answers) values ('p@x','es','S','{}')"
expect_ok "Precision runtime reads its own tables" brt "select count(*) from admin_user"
must_fail_like "Precision runtime cannot create objects" "permission denied" brt "create table x(i int)"
must_fail_like "Precision runtime cannot become another role" "permission denied" brt "set role beeside_migrate"
must_fail_like "Discovery runtime cannot become another role" "permission denied" bdr "set role beeside_migrate"

echo "== S4  privacy: the REAL anonymisation function, executed on clone data, effects verified (reversible transaction = gate; persisted run = S6b)"
SECTION="S4 privacy"
# Executes fa4_anonymize_project() (the authorised erasure path of the product) as the migration/owner role on a project that is a COPY in the clone, and checks in the same
# session: the data that must go is gone (email, answers, results' model and snapshots, demand-signal payloads, contact requests, tokens revoked), the structure and evidence that
# must stay is byte-identical (result ids/sequence/catalog version/time, legal acceptances, analytics events, marketing consents), exactly one new erasure-log row, no trace of the
# original email or of the client's free text anywhere in the project's rows, a different project untouched, the other projects not anonymised, the erasure flag does not leak.
# Only clone data is used (nothing is read from or written to production); a synthetic contact request is added to the target inside the clone so that path is always exercised.
PRIV_TPL=$(cat <<'SQL'
create temp table cz(v text) on commit drop;
insert into fa4_contact_request(project_id,name,company,email,message,language,client_request_id)
  values('@T@','Canary Person @H@','Canary Company @H@','canary.@H@@rehearsal.invalid','canary free text message @H@ for the rehearsal','es','rh-@H@');
insert into cz
  select v from (
    select p.email v from fa4_project p where p.project_id='@T@'
    union all select split_part(p.email,'@',1) from fa4_project p where p.project_id='@T@' and length(split_part(p.email,'@',1)) >= 5
    union all select jsonb_path_query(p.answers,'strict $.** ? (@.type()=="string")') #>> '{}' from fa4_project p where p.project_id='@T@'
    union all select c.name from fa4_contact_request c where c.project_id='@T@' union all select c.company from fa4_contact_request c where c.project_id='@T@'
    union all select c.email from fa4_contact_request c where c.project_id='@T@' union all select c.message from fa4_contact_request c where c.project_id='@T@'
  ) q where v is not null and ((v like '%@%' and length(v) >= 8) or (length(v) >= 12 and v ~ '[[:space:]]') or v ~ '^Canary');
create temp table pre on commit drop as select
  (select count(*) from fa4_project) n_proj,
  (select count(*) from fa4_project where status='ANONYMIZED') n_anon,
  (select count(*) from fa4_result where project_id='@T@') n_res,
  (select coalesce(md5(string_agg(result_id::text||'/'||result_seq::text||'/'||catalog_version||'/'||created_at::text, ',' order by result_id)),'') from fa4_result where project_id='@T@') res_struct,
  (select count(*) from fa4_demand_signal where project_id='@T@') n_sig,
  (select count(*) from fa4_contact_request where project_id='@T@') n_con,
  (select count(*) from fa4_access_token where project_id='@T@') n_tok,
  (select coalesce(md5(string_agg(to_jsonb(t)::text,'' order by acceptance_id)),'') from fa4_legal_acceptance t where project_id='@T@') legal,
  (select coalesce(md5(string_agg(to_jsonb(t)::text,'' order by event_id)),'') from fa4_event t where project_id='@T@') evt,
  (select coalesce(md5(string_agg(to_jsonb(t)::text,'' order by consent_id)),'') from fa4_marketing_consent t where project_id='@T@') mkt,
  (select count(*) from fa4_privacy_erasure_log where project_id='@T@') n_log,
  (select coalesce(md5(string_agg(x,'' order by x)),'') from (
      select 'p'||to_jsonb(t)::text x from fa4_project t where project_id='@C@' union all select 'r'||to_jsonb(t)::text from fa4_result t where project_id='@C@'
      union all select 's'||to_jsonb(t)::text from fa4_demand_signal t where project_id='@C@' union all select 'c'||to_jsonb(t)::text from fa4_contact_request t where project_id='@C@'
      union all select 'k'||to_jsonb(t)::text from fa4_access_token t where project_id='@C@' union all select 'l'||to_jsonb(t)::text from fa4_legal_acceptance t where project_id='@C@'
      union all select 'e'||to_jsonb(t)::text from fa4_event t where project_id='@C@' union all select 'm'||to_jsonb(t)::text from fa4_marketing_consent t where project_id='@C@'
      union all select 'd'||to_jsonb(t)::text from fa4_email_delivery t where project_id='@C@' union all select 'q'||to_jsonb(t)::text from fa4_continuation_request t where project_id='@C@'
      union all select 'g'||to_jsonb(t)::text from fa4_privacy_erasure_log t where project_id='@C@') z) ctl;
-- refusals first: an empty actor and an unknown project are rejected with the contract error and leave no trace
do $$ begin perform fa4_anonymize_project('@C@','','x'); raise exception 'ACCEPTED_EMPTY_ACTOR'; exception when sqlstate 'BV603' then null; end $$;
do $$ begin perform fa4_anonymize_project(gen_random_uuid(),'rehearsal','x'); raise exception 'ACCEPTED_UNKNOWN_PROJECT'; exception when sqlstate 'BV603' then null; end $$;
select fa4_anonymize_project('@T@','rehearsal-clone','clone rehearsal functional check');
-- the authorisation to bypass the append-only guard must not outlive the function, even in the same transaction
do $$ begin update fa4_result set model='{"leak":1}'::jsonb where project_id='@C@'; raise exception 'BYPASS_LEAKED'; exception when sqlstate 'BV601' then null; end $$;
do $$ begin update fa4_privacy_erasure_log set actor='tampered' where project_id='@T@'; raise exception 'LOG_MUTABLE'; exception when sqlstate 'BV601' then null; end $$;
select string_agg(k||'='||v, ' ' order by k) from (values
 ('email', (select (email = 'anonymized+'||project_id::text||'@invalid.invalid')::text from fa4_project where project_id='@T@')),
 ('answers_empty', (select (answers = '{}'::jsonb)::text from fa4_project where project_id='@T@')),
 ('status', (select (status = 'ANONYMIZED')::text from fa4_project where project_id='@T@')),
 ('result_model_erased', (select (count(*) filter (where model <> '{"anonymized": true}'::jsonb) = 0)::text from fa4_result where project_id='@T@')),
 ('result_snapshots_erased', (select (count(*) filter (where (source_snapshot is not null and source_snapshot <> '{"anonymized": true}'::jsonb) or (resolution_snapshot is not null and resolution_snapshot <> '{"anonymized": true}'::jsonb)) = 0)::text from fa4_result where project_id='@T@')),
 ('result_structure_kept', (select (count(*) = (select n_res from pre) and coalesce(md5(string_agg(result_id::text||'/'||result_seq::text||'/'||catalog_version||'/'||created_at::text, ',' order by result_id)),'') = (select res_struct from pre))::text from fa4_result where project_id='@T@')),
 ('signals_erased_kept', (select (count(*) = (select n_sig from pre) and count(*) filter (where payload <> '{"anonymized": true}'::jsonb) = 0)::text from fa4_demand_signal where project_id='@T@')),
 ('contacts_erased_kept', (select (count(*) = (select n_con from pre) and count(*) >= 1 and count(*) filter (where name <> 'anonymized' or company <> 'anonymized' or message <> 'anonymized' or email <> 'anonymized+'||contact_id::text||'@invalid.invalid') = 0)::text from fa4_contact_request where project_id='@T@')),
 ('tokens_revoked_kept', (select (count(*) = (select n_tok from pre) and count(*) filter (where revoked_at is null) = 0)::text from fa4_access_token where project_id='@T@')),
 ('legal_evidence_kept', (select (coalesce(md5(string_agg(to_jsonb(t)::text,'' order by acceptance_id)),'') = (select legal from pre))::text from fa4_legal_acceptance t where project_id='@T@')),
 ('analytics_events_kept', (select (coalesce(md5(string_agg(to_jsonb(t)::text,'' order by event_id)),'') = (select evt from pre))::text from fa4_event t where project_id='@T@')),
 ('marketing_consent_kept', (select (coalesce(md5(string_agg(to_jsonb(t)::text,'' order by consent_id)),'') = (select mkt from pre))::text from fa4_marketing_consent t where project_id='@T@')),
 ('erasure_log_one_row', (select ((select count(*) from fa4_privacy_erasure_log where project_id='@T@') = (select n_log from pre) + 1 and exists (select 1 from fa4_privacy_erasure_log where project_id='@T@' and mode='ANONYMIZE' and actor='rehearsal-clone' and reason='clone rehearsal functional check'))::text)),
 ('canary_set_not_empty', (select (count(*) >= 4)::text from cz)),
 ('no_trace_of_personal_data', (select (count(*) = 0)::text from (
      select to_jsonb(t)::text x from fa4_project t where project_id='@T@' union all select to_jsonb(t)::text from fa4_result t where project_id='@T@'
      union all select to_jsonb(t)::text from fa4_demand_signal t where project_id='@T@' union all select to_jsonb(t)::text from fa4_contact_request t where project_id='@T@'
      union all select to_jsonb(t)::text from fa4_access_token t where project_id='@T@' union all select to_jsonb(t)::text from fa4_legal_acceptance t where project_id='@T@'
      union all select to_jsonb(t)::text from fa4_event t where project_id='@T@' union all select to_jsonb(t)::text from fa4_marketing_consent t where project_id='@T@'
      union all select to_jsonb(t)::text from fa4_email_delivery t where project_id='@T@' union all select to_jsonb(t)::text from fa4_continuation_request t where project_id='@T@'
      union all select to_jsonb(t)::text from fa4_privacy_erasure_log t where project_id='@T@') s
    where exists (select 1 from cz where position(substr(to_jsonb(cz.v)::text, 2, length(to_jsonb(cz.v)::text) - 2) in s.x) > 0))),
 ('control_project_untouched', (select ((select coalesce(md5(string_agg(x,'' order by x)),'') from (
      select 'p'||to_jsonb(t)::text x from fa4_project t where project_id='@C@' union all select 'r'||to_jsonb(t)::text from fa4_result t where project_id='@C@'
      union all select 's'||to_jsonb(t)::text from fa4_demand_signal t where project_id='@C@' union all select 'c'||to_jsonb(t)::text from fa4_contact_request t where project_id='@C@'
      union all select 'k'||to_jsonb(t)::text from fa4_access_token t where project_id='@C@' union all select 'l'||to_jsonb(t)::text from fa4_legal_acceptance t where project_id='@C@'
      union all select 'e'||to_jsonb(t)::text from fa4_event t where project_id='@C@' union all select 'm'||to_jsonb(t)::text from fa4_marketing_consent t where project_id='@C@'
      union all select 'd'||to_jsonb(t)::text from fa4_email_delivery t where project_id='@C@' union all select 'q'||to_jsonb(t)::text from fa4_continuation_request t where project_id='@C@'
      union all select 'g'||to_jsonb(t)::text from fa4_privacy_erasure_log t where project_id='@C@') z) = (select ctl from pre))::text)),
 ('only_the_target_anonymised', (select ((select count(*) from fa4_project) = (select n_proj from pre) and (select count(*) from fa4_project where status='ANONYMIZED') = (select n_anon from pre) + 1)::text)),
 ('erasure_flag_closed', (select (coalesce(current_setting('fa4.erasure', true), '') in ('', 'off'))::text))
) c(k,v);
@END@
SQL
)
priv_pick() { # $1 runner, $2 offset-excluding project (or empty) -> a project that has a result, preferring sealed results, internal domain and access tokens
  local excl=""; [ -n "${2:-}" ] && excl="and p.project_id <> '$2'"
  $1 "select p.project_id from fa4_project p where p.status <> 'ANONYMIZED' and exists (select 1 from fa4_result r where r.project_id = p.project_id) $excl order by (exists (select 1 from fa4_result r where r.project_id = p.project_id and not r.legacy_unsealed)) desc, (exists (select 1 from fa4_access_token k where k.project_id = p.project_id)) desc, (p.email like '%@beeside.you') desc, p.created_at, p.project_id limit 1"
}
privacy_functional() { # $1 label  $2 runner (dm|bm)  $3 rollback|commit ; sets PRIV_T / PRIV_ORIG_MD5 for the persisted checks
  local lab=$1 run=$2 mode=$3 T C H sql out end="rollback" res k v
  T=$(priv_pick "$run" ""); C=$(priv_pick "$run" "$T")
  printf '%s' "$T" | grep -Eq '^[0-9a-f-]{36}$' && printf '%s' "$C" | grep -Eq '^[0-9a-f-]{36}$' && [ "$T" != "$C" ] || { bad "$lab: need two projects with a result in the clone data to test the erasure and a control (found: '${T:+target}' '${C:+control}')"; return 1; }
  PRIV_T=$T; PRIV_ORIG_MD5=$($run "select md5(email) from fa4_project where project_id='$T'"); H=$(openssl rand -hex 4)
  info "$lab: target project ${T:0:8}… (rows: results $($run "select count(*) from fa4_result where project_id='$T'"), signals $($run "select count(*) from fa4_demand_signal where project_id='$T'"), tokens $($run "select count(*) from fa4_access_token where project_id='$T'"), legal $($run "select count(*) from fa4_legal_acceptance where project_id='$T'"), events $($run "select count(*) from fa4_event where project_id='$T'")); control ${C:0:8}…"
  [ "$mode" = commit ] && end="commit"
  sql=${PRIV_TPL//@T@/$T}; sql=${sql//@C@/$C}; sql=${sql//@H@/$H}; sql=${sql//@END@/$end;}
  out=$($run "begin; $sql" 2>&1) || { bad "$lab: the anonymisation run failed :: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-300)"; return 1; }
  res=$(printf '%s\n' "$out" | grep -E '^[a-z_]+=(true|false)( |$)' | tail -1)
  [ -n "$res" ] || { bad "$lab: the verification query returned nothing :: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"; return 1; }
  for kv in $res; do k=${kv%%=*}; v=${kv#*=}; [ "$v" = true ] && ok "$lab: $k" || bad "$lab: $k"; done
  [ "$(printf '%s' "$res" | wc -w | tr -d ' ')" -ge 18 ] || bad "$lab: fewer verification results than expected ($res)"
}
# refusals that protect the erasure path, evaluated BEFORE it runs
expect_fail_like "the Discovery runtime cannot call fa4_anonymize_project" "permission denied" bdr "select fa4_anonymize_project(gen_random_uuid(),'a','b')"
expect_fail_like "the Precision runtime cannot call fa4_anonymize_project" "permission denied" brt "select fa4_anonymize_project(gen_random_uuid(),'a','b')"
expect_fail_like "a runtime session cannot open the append-only guard with the erasure flag (no UPDATE right on results)" "permission denied" bdr "begin; select set_config('fa4.erasure','on',true); update fa4_result set model='{}'::jsonb; rollback"
if [ "$(bm "select count(*) from fa4_result where not legacy_unsealed")" -gt 0 ]; then
  expect_fail_like "a runtime session cannot rewrite a delivered project's answers with the erasure flag (guard BV604)" "delivered projects are closed|permission denied" bdr "begin; select set_config('fa4.erasure','on',true); update fa4_project set answers='{\"rehearsal_tamper\":true}'::jsonb where project_id in (select project_id from fa4_result where not legacy_unsealed limit 1); rollback"
else info "no sealed result in the clone data: the delivered-project lock is covered by the tests of the repository, not exercised here"; fi
expect_fail_like "the migrator cannot touch a result without the erasure path (append-only)" "append-only" bm "update fa4_result set model='{}'::jsonb where result_seq=(select min(result_seq) from fa4_result)"
privacy_functional "S4 canonical $NEWDB (rolled back)" bm rollback
privacy_functional "S4 legacy $LEGDB, production role model (rolled back)" dm rollback
eq "$(bm "select count(*) from fa4_project where status='ANONYMIZED'")" 0 "the reversible runs left nothing behind in $NEWDB"
eq "$(dm "select count(*) from fa4_project where status='ANONYMIZED'")" 0 "the reversible runs left nothing behind in $LEGDB"
eq "$(bm "select count(*) from fa4_contact_request where client_request_id like 'rh-%'")" 0 "the synthetic contact requests were rolled back"
eq "$(brt "select count(*) from privacy_policy where status='approved'")" 0 "Precision erasure keeps its restriction: no privacy policy is approved by default, so privacy_erase_project() refuses everything"
expect_fail_like "privacy_erase_project() is reachable by the Precision runtime and refuses an unknown project" "not found" brt "select privacy_erase_project(gen_random_uuid(),'rehearsal',false,now())"
expect_fail_like "the Discovery runtime cannot call privacy_erase_project()" "permission denied" bdr "select privacy_erase_project(gen_random_uuid(),'rehearsal',false,now())"
expect_fail_like "a Precision runtime session cannot open the erasure delete path by setting the project flag (no DELETE right)" "permission denied" brt "begin; select set_config('app.privacy_erasure_project', gen_random_uuid()::text, true); delete from oh_delivery; rollback"
crit_gate "S4 privacy (nothing destructive runs when a privacy restriction or an anonymisation effect fails)"

echo "== S5  rollback replay: writes made on $NEWDB after the cutover go back to $LEGDB"
identity_gate "S5 reverse reconciliation (writes into $LEGDB)"
SECTION="S5 reverse reconciliation"
bdr "insert into fa4_project (email,locale,step_key,answers) select 'post'||g||'@beeside.you','es','S1','{\"post\":true}' from generate_series(1,3) g" >/dev/null
bdr "update fa4_project set answers = answers || '{\"edited_on_beeside\":true}', updated_at = now() + interval '2 seconds' where email='$LEGNAME'" >/dev/null
SYNC_SOURCE_URL=$DST SYNC_TARGET_URL=$SRC DOMAIN_SYNC_APPROVED=yes sync >"$EVID/.s5" 2>&1 && ok "rollback replay ok, checksums match" || bad "rollback replay :: $(tail -c 400 "$EVID/.s5")"
eq "$(dm "select count(*) from fa4_project")" "$(bm "select count(*) from fa4_project")" "legacy now holds every project"
eq "$(dm "select answers->>'edited_on_beeside' from fa4_project where email='$LEGNAME'")" true "the update made on $NEWDB reached legacy"
eq "$(sqlu discovery_runtime "$LEGRT" $LEGDB "select count(*) from fa4_project")" "$(dm "select count(*) from fa4_project")" "legacy runtime still works on $LEGDB"

SECTION="S6 legacy hardening"
identity_gate "S6 legacy hardening (permission change on $LEGDB)"
SECTION="S6 legacy hardening"
echo "== S6  legacy hardening (PUBLIC CONNECT) and its rollback, on a database owned by $(admdb postgres "select pg_get_userbyid(datdba) from pg_database where datname='$LEGDB'")"
MODE=verify PHASE=post prov 2>&1 | grep -q '"severity":"WARN"' && ok "verify warns that the new logins still reach the legacy database" || warn "no WARN before hardening (check the verify output)"
expect_ok "post + LEGACY_HARDEN applied" env MIGRATE_DB_PASSWORD="$(pw beeside-migrate-password)" DISCOVERY_RUNTIME_DB_PASSWORD="$(pw beeside-discovery-runtime-password)" RUNTIME_DB_PASSWORD="$(pw beeside-runtime-password)" MODE=apply PHASE=post LEGACY_HARDEN=yes CANONICAL_DB_PROVISION_APPROVED=yes bash -c "cd $B && node dist/scripts/canonical-db-provision.js"
expect_fail "the new Precision login can no longer enter the legacy database" sqlu beeside_runtime "$(pw beeside-runtime-password)" $LEGDB "select 1"
expect_fail "the new Discovery login can no longer enter the legacy database" sqlu beeside_discovery_runtime "$(pw beeside-discovery-runtime-password)" $LEGDB "select 1"
expect_ok "legacy discovery_runtime still works after hardening" sqlu discovery_runtime "$LEGRT" $LEGDB "select count(*) from fa4_project"
expect_ok "rollback of the hardening: GRANT CONNECT TO PUBLIC (as discovery_migrate)" dm "grant connect on database $LEGDB to public"
expect_ok "after the rollback the original access is back" sqlu beeside_runtime "$(pw beeside-runtime-password)" $LEGDB "select 1"

# ---- persisted anonymisation (commit-time constraints, what the application roles see afterwards) -----------------------------------------------------------------------
echo "== S6b persisted anonymisation on $NEWDB (committed in the clone) and what the application roles see afterwards"
identity_gate "S6b persisted anonymisation (irreversible inside the clone)"
privacy_functional "S6b canonical $NEWDB (committed)" bm commit
if [ -n "${PRIV_T:-}" ]; then
  eq "$(bdr "select status from fa4_project where project_id='$PRIV_T'")" ANONYMIZED "after COMMIT the Discovery runtime sees the project as ANONYMIZED"
  eq "$(brt "select status from fa4_project where project_id='$PRIV_T'")" ANONYMIZED "after COMMIT the Precision runtime sees it as ANONYMIZED"
  eq "$(bdr "select count(*) from fa4_project where md5(email)='$PRIV_ORIG_MD5'")" 0 "the original address no longer resolves to any project (an anonymised address is not resumable by email)"
  eq "$(bm "select count(*) from fa4_access_token where project_id='$PRIV_T' and revoked_at is null")" 0 "no live session or resume token remains"
  expect_fail_like "after COMMIT the results stay closed (append-only guard + erasure tombstone; no bypass left behind)" "append-only|only the scrubbed form" bm "update fa4_result set model='{}'::jsonb where project_id='$PRIV_T'"
  expect_fail_like "after COMMIT the erasure log is append-only" "append-only" bm "delete from fa4_privacy_erasure_log where project_id='$PRIV_T'"
  expect_ok "a second erasure of the same project is harmless" bm "select fa4_anonymize_project('$PRIV_T','rehearsal-clone','second run')"
  eq "$(bm "select status||'/'||(answers='{}'::jsonb)::text from fa4_project where project_id='$PRIV_T'")" "ANONYMIZED/true" "the second run keeps it anonymised"
fi
eq "$(bm "select count(*) from fa4_project where status='ANONYMIZED'")" 1 "exactly one project is anonymised in $NEWDB"
crit_gate "S6b persisted anonymisation (no DROP while the persisted erasure is not as specified)"

# ---- F2: the erasure must survive the transition (propagation to the legacy side, rollback without reappearance) ------------------------------------------------------------
echo "== S6c  F2: an erasure committed in $NEWDB must reach $LEGDB before a rollback, and the rollback must not bring the personal data back"
identity_gate "S6c erasure propagation (writes into $LEGDB, through its own migrator)"
SECTION="S6c erasure propagation"
recon(){ env ERASURE_SIDE_A_URL=$SRC ERASURE_SIDE_B_URL=$DST "$@" bash -c "cd $B && node dist/scripts/domain-erasure-reconcile.js"; }
gsync(){ env SYNC_SOURCE_URL=$1 SYNC_TARGET_URL=$2 DOMAIN_SYNC_APPROVED=yes bash -c "cd $B && node dist/scripts/domain-data-sync.js"; }
if [ -n "${PRIV_T:-}" ]; then
  eq "$(dm "select (status<>'ANONYMIZED')::text from fa4_project where project_id='$PRIV_T'")" true "before propagation legacy still holds the project that was erased in $NEWDB (the rollback target is stale)"
  NLEG=$(dm "select count(*) from fa4_project")
  gsync $DST $SRC >"$EVID/.s6c1" 2>&1; eq "$?" 3 "FAIL SAFE: the rollback replay is refused by the privacy gate while the two sides disagree (exit 3)"
  eq "$(dm "select (status<>'ANONYMIZED')::text from fa4_project where project_id='$PRIV_T'")" true "the refused replay wrote nothing into legacy"
  eq "$(dm "select count(*) from fa4_project")" "$NLEG" "legacy project count unchanged"
  recon DRY_RUN=yes >"$EVID/.s6c2" 2>&1; eq "$?" 2 "the reconciliation dry run reports the disagreement (exit 2) and writes nothing"
  eq "$(dm "select (status<>'ANONYMIZED')::text from fa4_project where project_id='$PRIV_T'")" true "the dry run applied nothing"
  recon ERASURE_RECONCILE_APPROVED=yes >"$EVID/.s6c3" 2>&1; eq "$?" 0 "the erasure is applied on legacy by the legacy migrator"
  eq "$(dm "select status from fa4_project where project_id='$PRIV_T'")" ANONYMIZED "legacy: the project is ANONYMIZED"
  eq "$(dm "select (email like 'anonymized+%@invalid.invalid' and answers='{}'::jsonb)::text from fa4_project where project_id='$PRIV_T'")" true "legacy: e-mail and answers are scrubbed"
  eq "$(dm "select count(*) from fa4_result where project_id='$PRIV_T' and model<>'{\"anonymized\": true}'::jsonb")" 0 "legacy: no sealed result keeps the model"
  eq "$(dm "select count(*) from fa4_privacy_erasure_log where project_id='$PRIV_T' and reason like 'propagated of erasure %'")" 1 "evidence: ONE new legacy log row naming its origin"
  gsync $DST $SRC >"$EVID/.s6c4" 2>&1; eq "$?" 0 "the rollback replay now succeeds"
  eq "$(dm "select status from fa4_project where project_id='$PRIV_T'")" ANONYMIZED "NO REAPPEARANCE: legacy keeps the project anonymised after the replay"
  eq "$(sqlu discovery_runtime "$LEGRT" $LEGDB "select (email like 'anonymized+%@invalid.invalid')::text from fa4_project where project_id='$PRIV_T'")" true "the legacy application sees no personal data"
  gsync $SRC $DST >"$EVID/.s6c5" 2>&1; eq "$?" 0 "re-cutover (forward copy) succeeds"
  eq "$(bm "select status from fa4_project where project_id='$PRIV_T'")" ANONYMIZED "NO REAPPEARANCE in $NEWDB after the forward copy"
  eq "$(bm "select count(*) from fa4_privacy_erasure_log")" "$(dm "select count(*) from fa4_privacy_erasure_log")" "both erasure logs hold the same history"
  expect_fail_like "database-level backstop (0053): nobody can put personal data back into the erased project in $NEWDB" "cannot receive personal data" bm "update fa4_project set email='back@example.invalid' where project_id='$PRIV_T'"
  IPP=$(bm "select project_id from fa4_project where status='IN_PROGRESS' order by project_id limit 1")
  bm "select fa4_anonymize_project('$IPP','rehearsal-clone','in-progress project erased')" >/dev/null
  expect_fail_like "tombstone: the Discovery runtime edits in-progress projects but NOT an erased one" "cannot receive personal data" bdr "update fa4_project set answers='{\"x\":1}', updated_at=now() where project_id='$IPP'"
  expect_fail_like "tombstone: an erased project cannot be reopened" "cannot receive personal data" bdr "update fa4_project set status='IN_PROGRESS' where project_id='$IPP'"
fi
crit_gate "S6c erasure propagation (no DROP while an erasure is not consistent across the sides)"

# ---- rollback drill of the provisioning itself, then repeat from zero -----------------------------------------------------------------------------------------------
echo "== S7  rollback drill: remove everything the provisioning created, prove legacy is untouched, provision again"
identity_gate "S7 rollback drill (DROP DATABASE, DROP ROLE)"
SECTION="S7 rollback drill"
# what is about to be dropped is exactly what this run created, nothing else
must_eq "$NEWDB" beeside "the database to drop is the fixed canonical name"
must_eq "$([ "$NEWDB" != "$LEGDB" ] && echo different)" different "the database to drop is not the legacy database"
must_eq "$(adm "select pg_get_userbyid(datdba) from pg_database where datname='$NEWDB'")" beeside_migrate "the database to drop is owned by the role this run created"
for r in beeside_runtime beeside_discovery_runtime beeside_migrate; do case ",$BEFORE_ROLES," in *",$r,"*) halt "role $r existed before provisioning: S7 must not drop it";; esac; done
ok "none of the roles to drop existed before the rehearsal"
LEGSNAP="$(dm "select count(*) from fa4_project")|$(adm "select count(*) from pg_auth_members where member='discovery_runtime'::regrole and roleid='beeside_runtime_role'::regrole")|$(dm "select md5(string_agg(email,',' order by email)) from fa4_project")"
adm "select pg_terminate_backend(pid) from pg_stat_activity where datname='$NEWDB' and pid <> pg_backend_pid()" >/dev/null 2>&1
must_ok "temporary: admin joins the database owner" adm "GRANT beeside_migrate TO \"$ADMIN\" WITH SET TRUE, INHERIT TRUE"
must_ok "DROP DATABASE $NEWDB" adm "DROP DATABASE $NEWDB"
must_ok "temporary membership removed" adm "REVOKE beeside_migrate FROM \"$ADMIN\""
for r in beeside_runtime beeside_discovery_runtime beeside_migrate; do must_ok "DROP ROLE $r" adm "DROP ROLE $r"; done
for r in beeside_discovery_rw beeside_analytics_reader; do case ",$BEFORE_ROLES," in *",$r,"*) info "$r existed before: kept";; *) must_ok "DROP ROLE $r (created by the provisioning)" adm "DROP ROLE IF EXISTS $r";; esac; done
must_eq "$(adm "select count(*) from pg_roles where rolname='beeside_runtime_role'")" 1 "the legacy group beeside_runtime_role was NOT dropped"
must_eq "$(dm "select count(*) from fa4_project")|$(adm "select count(*) from pg_auth_members where member='discovery_runtime'::regrole and roleid='beeside_runtime_role'::regrole")|$(dm "select md5(string_agg(email,',' order by email)) from fa4_project")" "$LEGSNAP" "legacy data and the legacy runtime membership are exactly as before the drill"
expect_ok "legacy runtime still works" sqlu discovery_runtime "$LEGRT" $LEGDB "select count(*) from fa4_project"
rm -f "$S"/beeside-*   # the provisioning generates fresh passwords
SECTION="S8 re-provision"
provision_all "S8"
eq "$(bm "select count(*) from fa4_project")" 0 "after rollback + re-provision $NEWDB is empty again (a repeatable procedure)"

echo "== S9  leakage scan of the evidence"
LEAK=0; for f in "$REHEARSAL_DIR"/pw_* "$S"/*; do [ -f "$f" ] || continue; v=$(cat "$f"); [ -n "$v" ] && grep -rqF -- "$v" "$EVID" 2>/dev/null && { LEAK=1; echo "  LEAK  a secret value appears in the evidence ($(basename "$f"))"; }; done
[ $LEAK = 0 ] && ok "no secret value appears in the evidence folder" || bad "a secret value leaked into the evidence"
PII=$(grep -Eho '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$EVID"/*.txt 2>/dev/null | grep -viE '@(invalid\.invalid|rehearsal\.invalid)$' | wc -l | tr -d ' ')
eq "$PII" 0 "no e-mail address of the clone data appears in the evidence (the privacy checks print counts and hashes only)"
rm -f "$EVID"/.last "$EVID"/.mig "$EVID"/.plan "$EVID"/.drp "$EVID"/.drp2 "$EVID"/.s[0-9]

echo "== SUMMARY  pass=$PASS fail=$FAIL warn=$WARN  · evidence: $EVID"
[ $FAIL -eq 0 ]
