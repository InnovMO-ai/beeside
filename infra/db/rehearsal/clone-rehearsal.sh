#!/usr/bin/env bash
# PRECISION V2.0 — lifecycle of the TEMPORARY Cloud SQL clone used for the canonical-database rehearsal.
# RUN BY THE PRODUCT OWNER in his own Terminal, only after WRITTEN approval of the clone. NOTHING here has been executed against GCP.
#
# Safety model (why this cannot reach production by accident):
#   1. Default = PRINT ONLY. Nothing is executed (not even a read) unless RUN=1; every mutating phase additionally needs APPROVAL=CLONE_REHEARSAL_APPROVED.
#   2. The only gcloud commands that write are on the CLONE name, which must match ^discovery-db-rehearsal-[0-9a-z-]+$ and may never equal the source instance.
#   3. The clone is a point-in-time clone of the source (read-only on the source; same project is mandatory for Cloud SQL clones).
#   4. Immediately after creation the clone gets NEW random passwords for every user it inherited from production (postgres, discovery_migrate, discovery_runtime). Production
#      credentials are never read, typed or used for the rehearsal, and the clone's credentials open nothing in production.
#   5. A marker ROLE (NOLOGIN, rehearsal_marker_<random>) is created on the clone. Every later SQL step (rehearse-on-clone.sh) refuses to run unless the connected server has it.
#      A Cloud SQL Auth Proxy accidentally pointed at production would fail twice: wrong password, and no marker.
#   6. The clone gets labels purpose=rehearsal and an expiry (default 8 h, hard maximum 24 h) that `status` checks; `teardown` refuses anything without purpose=rehearsal.
#   7. Secrets live only in a 0700 directory on this Mac ($REHEARSAL_DIR) and are overwritten and removed by `teardown`. Nothing goes to Secret Manager.
#
#   plan        print the whole procedure (all phases) and the cost envelope. Executes nothing.
#   preflight   RUN=1                       read-only: source state, PITR window, no leftover clone.
#   create      RUN=1 APPROVAL=...          point-in-time clone of the source (the restore drill: its duration is the RTO of a restore by clone).
#   harden      RUN=1 APPROVAL=...          assert no authorized networks, ZONAL, no PITR/automatic backups, labels, new random passwords.
#   mark        RUN=1 APPROVAL=...          needs the Auth Proxy on the clone (port 5435): creates the marker role and checks the clone is not production.
#   resize      RUN=1 APPROVAL=...          optional drill: db-custom-2-7680, measure restart time and max_connections, revert.
#   status      RUN=1                       read-only: every instance labelled purpose=rehearsal, age, expiry, EXPIRED flag.
#   teardown    RUN=1 APPROVAL=... CONFIRM_DELETE=<clone name>    disable deletion protection on the CLONE, delete it, verify, shred the local secrets.
set -euo pipefail
PHASE=${1:-plan}
PROJECT=${PROJECT:-beeside-discovery-prod}; REGION=${REGION:-northamerica-south1}; SOURCE=${SOURCE_INSTANCE:-discovery-db}
TAG=${TAG:-$(date -u +%m%d%H%M)}; CLONE=${CLONE:-discovery-db-rehearsal-$TAG}
TTL_HOURS=${TTL_HOURS:-8}; PROXY_PORT=${PROXY_PORT:-5435}; PITR_LAG_MIN=${PITR_LAG_MIN:-15}
REHEARSAL_DIR=${REHEARSAL_DIR:-$HOME/.beeside-rehearsal/$CLONE}
RUN=${RUN:-0}; MUTATE=0; [ "${APPROVAL:-}" = "CLONE_REHEARSAL_APPROVED" ] && MUTATE=1
EXPECTED_PROJECT=beeside-discovery-prod

die() { echo "STOP: $*" >&2; exit "${2:-2}"; }
note() { echo "-- $*" >&2; }
# ---- static guards (evaluated before anything else, in every mode) ------------------------------------------------------------------------------------------------
[ "$PROJECT" = "$EXPECTED_PROJECT" ] || [ "${ALLOW_OTHER_PROJECT:-0}" = 1 ] || die "project must be $EXPECTED_PROJECT"
case "$CLONE" in discovery-db-rehearsal-*) ;; *) die "the clone name must start with discovery-db-rehearsal- (got '$CLONE')";; esac
printf '%s' "$CLONE" | grep -Eq '^discovery-db-rehearsal-[0-9a-z-]+$' || die "invalid clone name '$CLONE'"
[ "$CLONE" != "$SOURCE" ] || die "the clone cannot be the source instance"
case "$TTL_HOURS" in ''|*[!0-9]*) die "TTL_HOURS must be a whole number";; esac
[ "$TTL_HOURS" -ge 1 ] && [ "$TTL_HOURS" -le 24 ] || die "TTL_HOURS must be between 1 and 24 (hard maximum life of the clone: 24 h)"
case "$PROXY_PORT" in 5434) die "port 5434 is the production proxy port used by the other operator scripts: use another one (default 5435)";; esac

# ---- execution helpers: print-only unless RUN=1 -------------------------------------------------------------------------------------------------------------------
g() { # gcloud; mutating commands (first arg 'W') need approval
  local kind=$1; shift
  if [ "$RUN" != 1 ]; then echo "+ gcloud --project $PROJECT $*"; return 0; fi
  if [ "$kind" = W ] && [ "$MUTATE" != 1 ]; then die "'$PHASE' changes GCP: set APPROVAL=CLONE_REHEARSAL_APPROVED after the written approval" 3; fi
  gcloud --project "$PROJECT" "$@"
}
need_approval() { [ "$RUN" != 1 ] || [ "$MUTATE" = 1 ] || die "'$PHASE' changes GCP: set APPROVAL=CLONE_REHEARSAL_APPROVED after the written approval" 3; }
describe_val() { gcloud --project "$PROJECT" sql instances describe "$1" --format="value($2)"; }
secret_dir() { ( umask 077; mkdir -p "$REHEARSAL_DIR" ); chmod 700 "$REHEARSAL_DIR"; }
newpw() { openssl rand -hex 24; }
expiry_label() { # UTC yyyymmddthhmm of now+TTL (label values: lowercase letters, digits, - _)
  if date -u -d "+${TTL_HOURS} hours" +%Y%m%dt%H%M >/dev/null 2>&1; then date -u -d "+${TTL_HOURS} hours" +%Y%m%dt%H%M; else date -u -v+"${TTL_HOURS}"H +%Y%m%dt%H%M; fi
}
ts_pitr() { if date -u -d "-${PITR_LAG_MIN} minutes" +%Y-%m-%dT%H:%M:%S.000Z >/dev/null 2>&1; then date -u -d "-${PITR_LAG_MIN} minutes" +%Y-%m-%dT%H:%M:%S.000Z; else date -u -v-"${PITR_LAG_MIN}"M +%Y-%m-%dT%H:%M:%S.000Z; fi; }
psql_clone() { # user db sql   (password from the 0700 directory; connects ONLY through the local proxy port)
  PGPASSWORD=$(cat "$REHEARSAL_DIR/pw_$1") psql -qXAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PROXY_PORT" -U "$1" -d "$2" -c "$3"
}

phase_plan() {
  RUN=0
  cat <<EOF
== Rehearsal clone: $CLONE (source $SOURCE, project $PROJECT, region $REGION) · life ≤ ${TTL_HOURS} h (hard max 24 h) · secrets in $REHEARSAL_DIR
-- 1 preflight (read-only)
EOF
  phase_preflight; echo "-- 2 create (restore drill)"; phase_create; echo "-- 3 harden"; phase_harden; echo "-- 4 mark (needs: cloud-sql-proxy $PROJECT:$REGION:$CLONE --port $PROXY_PORT)"; phase_mark
  echo "-- 5 rehearse (SQL side, no GCP):  bash infra/db/rehearsal/rehearse-on-clone.sh"
  echo "-- 6 resize drill (optional)"; phase_resize; echo "-- 7 status (any time)"; phase_status; echo "-- 8 teardown"; phase_teardown
  echo "Cost envelope (list prices of Iowa, México not verified): 1 vCPU/3.75 GB regional 0.144 USD/h, zonal about half; 8 h ≈ 0.6–1.2 USD; 24 h hard max ≈ 3.5 USD (4.5 with a 30 % regional premium)."
}

phase_preflight() {
  g R sql instances describe "$SOURCE" --format="value(name,state,databaseVersion,region,settings.tier,settings.availabilityType,settings.backupConfiguration.pointInTimeRecoveryEnabled)"
  g R sql instances get-latest-recovery-time "$SOURCE"
  g R sql instances list --filter="name~^discovery-db-rehearsal" --format="table(name,state,createTime)"
  if [ "$RUN" = 1 ]; then
    local v; v=$(describe_val "$SOURCE" state); [ "$v" = RUNNABLE ] || die "the source is not RUNNABLE ($v)"
    v=$(describe_val "$SOURCE" databaseVersion); [ "$v" = POSTGRES_16 ] || die "the source is not POSTGRES_16 ($v)"
    v=$(describe_val "$SOURCE" settings.backupConfiguration.pointInTimeRecoveryEnabled); [ "$v" = True ] || [ "$v" = true ] || die "point-in-time recovery is not enabled on the source: the restore drill cannot run"
    local h f; h=$(gcloud sql instances patch --help 2>&1 || true)
    for f in update-labels no-backup enable-point-in-time-recovery availability-type deletion-protection tier; do printf '%s' "$h" | grep -q -- "$f" || die "the installed gcloud does not document the flag '$f' of 'sql instances patch': update gcloud (gcloud components update) before continuing"; done
    printf '%s' "$(gcloud sql instances clone --help 2>&1 || true)" | grep -q -- "point-in-time" || die "the installed gcloud does not document --point-in-time for 'sql instances clone': update gcloud"
    echo "gcloud flags used by the rehearsal are documented by this gcloud version"
    v=$(gcloud --project "$PROJECT" sql instances list --filter="name~^discovery-db-rehearsal" --format="value(name)")
    [ -z "$v" ] || die "a rehearsal clone already exists ($v): one at a time; run status/teardown first"
    echo "preflight ok · point-in-time target would be $(ts_pitr)"
  fi
}

phase_create() {
  need_approval
  g W sql instances clone "$SOURCE" "$CLONE" --point-in-time "$(ts_pitr)"
  if [ "$RUN" = 1 ]; then secret_dir; date -u +%s > "$REHEARSAL_DIR/created_epoch"; echo "$CLONE" > "$REHEARSAL_DIR/clone_name"; fi
}

phase_harden() {
  need_approval
  if [ "$RUN" = 1 ]; then
    [ "$(describe_val "$CLONE" state)" = RUNNABLE ] || die "the clone is not RUNNABLE yet"
    local an; an=$(describe_val "$CLONE" settings.ipConfiguration.authorizedNetworks)
    [ -z "$an" ] || die "the clone has authorized networks ($an): remove them before continuing (the source has none; a clone must not widen exposure)"
    echo "clone sslMode: $(describe_val "$CLONE" settings.ipConfiguration.sslMode)"
    secret_dir
  fi
  g W sql instances patch "$CLONE" --availability-type ZONAL --quiet
  g W sql instances patch "$CLONE" --no-enable-point-in-time-recovery --quiet   # PITR needs automatic backups: switch it off first
  g W sql instances patch "$CLONE" --no-backup --quiet
  g W sql instances patch "$CLONE" --update-labels "purpose=rehearsal,expires_utc=$(expiry_label),owner=product-owner" --quiet
  for u in postgres discovery_migrate discovery_runtime; do
    if [ "$RUN" = 1 ]; then
      newpw > "$REHEARSAL_DIR/pw_$u"; chmod 600 "$REHEARSAL_DIR/pw_$u"
      gcloud --project "$PROJECT" sql users set-password "$u" --instance "$CLONE" --password "$(cat "$REHEARSAL_DIR/pw_$u")" --quiet >/dev/null
      echo "password of $u on the clone replaced by a new random value (stored only in $REHEARSAL_DIR)"
    else
      echo "+ gcloud --project $PROJECT sql users set-password $u --instance $CLONE --password <new random, never printed> --quiet"
    fi
  done
  note "the password is briefly visible in the local process list of this Mac; it only opens the throw-away clone"
}

phase_mark() {
  need_approval
  if [ "$RUN" != 1 ]; then echo "+ psql (through the proxy on port $PROXY_PORT, as postgres with the NEW clone password): CREATE ROLE rehearsal_marker_<random> NOLOGIN"; return 0; fi
  [ -f "$REHEARSAL_DIR/pw_postgres" ] || die "run harden first (no clone password found in $REHEARSAL_DIR)"
  psql_clone postgres postgres "select 1" >/dev/null 2>&1 || die "cannot log in through the proxy on port $PROXY_PORT with the CLONE password: start  cloud-sql-proxy $PROJECT:$REGION:$CLONE --port $PROXY_PORT  (if it points at another instance this failure is the guard working)"
  local m; m="rehearsal_marker_$(openssl rand -hex 8)"; echo "$m" > "$REHEARSAL_DIR/marker"
  psql_clone postgres postgres "CREATE ROLE $m NOLOGIN" >/dev/null
  [ "$(psql_clone postgres postgres "select count(*) from pg_roles where rolname='$m'")" = 1 ] || die "marker role not readable back"
  echo "marker written; the clone is the only server that answers to the clone credentials and carries it"
}

phase_resize() {
  need_approval
  g W sql instances patch "$CLONE" --tier db-custom-2-7680 --quiet
  if [ "$RUN" = 1 ]; then psql_clone postgres postgres "show max_connections" | sed 's/^/max_connections at db-custom-2-7680: /'; fi
  g W sql instances patch "$CLONE" --tier db-custom-1-3840 --quiet
  note "wall-clock time of each patch is the restart cost to expect on the real instance (the clone is ZONAL, the real one is REGIONAL: failover makes the real one shorter)"
}

phase_status() {
  g R sql instances list --filter="labels.purpose=rehearsal" --format="table(name,state,settings.availabilityType,createTime,settings.userLabels.expires_utc)"
  if [ "$RUN" = 1 ]; then
    local now; now=$(date -u +%Y%m%dt%H%M); local n=0
    for line in $(gcloud --project "$PROJECT" sql instances list --filter="labels.purpose=rehearsal" --format="csv[no-heading](name,settings.userLabels.expires_utc)"); do
      n=$((n+1)); local nm=${line%%,*} ex=${line#*,}
      if [ -z "$ex" ] || [ "$now" \> "$ex" ]; then echo "EXPIRED  $nm (expires_utc=${ex:-none}): run teardown now"; else echo "ok       $nm (expires_utc=$ex)"; fi
    done
    [ "$n" -gt 0 ] || echo "no rehearsal clone exists"
  fi
}

phase_teardown() {
  need_approval
  if [ "$RUN" = 1 ]; then
    [ "${CONFIRM_DELETE:-}" = "$CLONE" ] || die "to delete set CONFIRM_DELETE=$CLONE (exact name of the clone)" 3
    [ "$(describe_val "$CLONE" settings.userLabels.purpose)" = rehearsal ] || die "refusing: $CLONE does not carry the label purpose=rehearsal"
  fi
  g W sql instances patch "$CLONE" --no-deletion-protection --quiet
  g W sql instances delete "$CLONE" --quiet
  g R sql instances list --filter="name~^discovery-db-rehearsal" --format="value(name)"
  if [ "$RUN" = 1 ]; then
    [ -z "$(gcloud --project "$PROJECT" sql instances list --filter="name=$CLONE" --format='value(name)')" ] || die "the clone still exists"
    echo "clone $CLONE deleted; the source $SOURCE untouched: $(describe_val "$SOURCE" state)"
    if [ -d "$REHEARSAL_DIR" ]; then
      for f in "$REHEARSAL_DIR"/* "$REHEARSAL_DIR"/.[!.]*; do [ -f "$f" ] || continue; if command -v shred >/dev/null 2>&1; then shred -u "$f"; else rm -P "$f"; fi; done
      rmdir "$REHEARSAL_DIR" 2>/dev/null || true; echo "local rehearsal secrets destroyed"
    fi
  else
    echo "+ shred/rm -P every file in $REHEARSAL_DIR, then rmdir"
  fi
}

case "$PHASE" in
  plan) phase_plan ;;
  preflight|create|harden|mark|resize|status|teardown) "phase_$PHASE" ;;
  *) echo "usage: [RUN=1 APPROVAL=CLONE_REHEARSAL_APPROVED] $0 {plan|preflight|create|harden|mark|resize|status|teardown}"; exit 2 ;;
esac
