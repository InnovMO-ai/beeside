#!/usr/bin/env bash
# PRECISION V2.0 — lifecycle of the TEMPORARY Cloud SQL clone used for the canonical-database rehearsal.
# RUN BY THE PRODUCT OWNER in his own Terminal, only after WRITTEN approval of the clone. NOTHING here has been executed against GCP.
#
# Safety model (why this cannot reach another project or the production instance by accident):
#   1. FIXED TARGET. Project, region, source instance, proxy port and secrets directory are CONSTANTS of this file. They cannot be changed by environment variables: if PROJECT,
#      REGION, SOURCE_INSTANCE, SOURCE, CLONE, ALLOW_OTHER_PROJECT, SQL_INSTANCE, PROXY_PORT or REHEARSAL_DIR is set, or gcloud has an API-endpoint override, the script STOPS.
#      The only inputs are TAG (^[0-9a-z]{1,12}$), TTL_HOURS (1..24), PITR_LAG_MIN, RUN, APPROVAL, CONFIRM_DELETE. Every gcloud call carries an explicit --project.
#   2. IDENTITY CHECK before every write: the instance's connectionName must be exactly <project>:<region>:<clone> and, after creation, carry the label purpose=rehearsal.
#   3. Default = PRINT ONLY. Nothing is executed (not even a read) unless RUN=1; every mutating phase additionally needs APPROVAL=CLONE_REHEARSAL_APPROVED.
#   4. CREDENTIAL WINDOW. The clone inherits the production users WITH their production passwords. `create` is ONE atomic phase: clone -> rotate EVERY user's password
#      (new random values) -> label pw_rotated=yes -> verify network and TLS. There is no human step between the clone becoming RUNNABLE and the rotation (seconds). Production
#      passwords are never read, typed or used. `status` flags any rehearsal clone that lacks pw_rotated=yes as UNROTATED. The inherited password could only be used through
#      the Cloud SQL Auth Proxy by a principal holding cloudsql.client (the same principals that can already reach production), because the source has no authorized networks;
#      `preflight` and `create` refuse to proceed if the SOURCE had them (the clone would inherit them).
#   5. NETWORK / TLS GATE. Before any later step the script re-reads the clone and STOPS unless: no authorized networks, sslMode is ENCRYPTED_ONLY (or stricter), and the
#      users are exactly the expected ones. `harden`, `mark` and `resize` refuse to run without the gate evidence written by `create`.
#   6. A marker ROLE (NOLOGIN, rehearsal_marker_<random>) is created on the clone. Every SQL step (rehearse-on-clone.sh) refuses to run unless the server has it.
#   7. Secrets live only in $HOME/.beeside-rehearsal/<clone> (0700) and are overwritten and removed by `teardown`. Nothing goes to Secret Manager.
#   8. CONTROLLED DELETION AFTER ANY FAILURE. No phase ever deletes anything by itself: when create/harden/mark/resize stops, the script prints the stage reached, what state the
#      clone may be in (e.g. "exists, still holds PRODUCTION passwords") and the exact `teardown` command. `teardown` is the ONLY place that deletes, and always demands the exact
#      clone name (CONFIRM_DELETE), the exact connectionName <project>:<region>:<clone> and the label purpose=rehearsal. A clone that failed before it was labelled needs the extra
#      UNLABELED_OK=yes. A clone that no longer exists (or whose deletion protection cannot be cleared) is handled without guessing.
#
#   plan        print the whole procedure (all phases) and the cost envelope. Executes nothing.
#   preflight   RUN=1                       read-only: gcloud overrides, source identity/state/PITR, source network+TLS posture, no leftover clone.
#   create      RUN=1 APPROVAL=...          point-in-time clone -> immediate rotation of every password -> labels -> network/TLS gate.
#   netcheck    RUN=1                       read-only: re-run the network/TLS/users gate on the clone at any time.
#   harden      RUN=1 APPROVAL=...          ZONAL, PITR off, automatic backups off (cost).
#   mark        RUN=1 APPROVAL=...          needs the Auth Proxy on the clone (port 5435): creates the marker role.
#   resize      RUN=1 APPROVAL=...          optional drill: db-custom-2-7680, measure restart time and max_connections, revert.
#   status      RUN=1                       read-only: every rehearsal clone, age, expiry, EXPIRED / UNROTATED flags.
#   teardown    RUN=1 APPROVAL=... CONFIRM_DELETE=<clone name>    disable deletion protection on the CLONE, delete it, verify, shred the local secrets.
set -euo pipefail
PHASE=${1:-plan}

die() { echo "STOP: $*" >&2; exit "${2:-2}"; }
note() { echo "-- $*" >&2; }
STAGE=none   # create: none -> started -> cloned -> rotating -> rotated -> labeled -> verified
on_exit() { # prints, never deletes
  local rc=$?; trap - EXIT
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 3 ] && [ "${RUN:-0}" = 1 ] && [ "${HELP_DONE:-0}" != 1 ] && [ "${TARGET_OK:-0}" = 1 ]; then
    case "${PHASE:-}" in create|harden|mark|resize) failure_help "$rc";; esac
  fi
  exit "$rc"
}
trap on_exit EXIT
failure_help() { # $1 exit code
  HELP_DONE=1
  local un=""; local state
  case "$PHASE:$STAGE" in
    create:none|create:started) state="the clone was NOT created yet, or gcloud stopped while the clone operation was in flight: check whether the instance exists (status). If it exists it still holds PRODUCTION passwords";;
    create:cloned|create:rotating) state="the clone EXISTS and still holds PRODUCTION passwords (rotation did not finish)";;
    create:rotated) state="the clone EXISTS, its passwords were rotated, but its labels were not set (status will show UNROTATED because the label is missing)";;
    create:labeled) state="the clone EXISTS, rotated and labelled, but the final identity / users / network / TLS verification failed or was interrupted";;
    create:verified) state="the clone EXISTS and passed every check; only the evidence file could not be written";;
    *) state="the clone EXISTS; phase '$PHASE' stopped part-way (its changes are partial but contained in the clone)";;
  esac
  case "$PHASE:$STAGE" in create:none|create:started|create:cloned|create:rotating|create:rotated) un="UNLABELED_OK=yes ";; esac
  {
    echo "== PHASE '$PHASE' STOPPED (exit $1) at stage '$STAGE'"
    echo "== State: $state."
    echo "== NOTHING was deleted. To inspect:  RUN=1 TAG=$TAG bash $0 status"
    echo "== To remove the clone (needs your explicit confirmation; run it only if you decide so):"
    echo "==   RUN=1 APPROVAL=CLONE_REHEARSAL_APPROVED CONFIRM_DELETE=$CLONE ${un}TAG=$TAG bash $0 teardown"
  } >&2
}

# ---- 1. fixed target: no variable can redirect this script ---------------------------------------------------------------------------------------------------------
for v in PROJECT REGION SOURCE_INSTANCE SOURCE CLONE ALLOW_OTHER_PROJECT SQL_INSTANCE PROXY_PORT REHEARSAL_DIR; do
  [ -z "${!v-}" ] || die "the variable $v is set: this script has a FIXED target and accepts no redirection (unset it: env -u $v ...)"
done
if env | grep -q '^CLOUDSDK_API_ENDPOINT_OVERRIDES_'; then die "a CLOUDSDK_API_ENDPOINT_OVERRIDES_* variable is set: gcloud could talk to another API endpoint"; fi
readonly PROJECT=beeside-discovery-prod REGION=northamerica-south1 SOURCE=discovery-db PROXY_PORT=5435
readonly SRC_CONN="$PROJECT:$REGION:$SOURCE"
readonly EXPECTED_USERS="postgres discovery_migrate discovery_runtime"
TAG=${TAG:-$(date -u +%m%d%H%M)}
printf '%s' "$TAG" | grep -Eq '^[0-9a-z]{1,12}$' || die "TAG must match ^[0-9a-z]{1,12}$ (got '$TAG')"
readonly CLONE="discovery-db-rehearsal-$TAG"
[ "$CLONE" != "$SOURCE" ] || die "the clone cannot be the source instance"
TTL_HOURS=${TTL_HOURS:-8}; PITR_LAG_MIN=${PITR_LAG_MIN:-15}
case "$TTL_HOURS" in ''|*[!0-9]*) die "TTL_HOURS must be a whole number";; esac
[ "$TTL_HOURS" -ge 1 ] && [ "$TTL_HOURS" -le 24 ] || die "TTL_HOURS must be between 1 and 24 (hard maximum life of the clone: 24 h)"
case "$PITR_LAG_MIN" in ''|*[!0-9]*) die "PITR_LAG_MIN must be a whole number";; esac
[ "$PITR_LAG_MIN" -ge 1 ] && [ "$PITR_LAG_MIN" -le 60 ] || die "PITR_LAG_MIN must be between 1 and 60"
[ -n "${HOME:-}" ] && [ "$HOME" != "/" ] || die "HOME is not set"
readonly REHEARSAL_DIR="$HOME/.beeside-rehearsal/$CLONE"
TARGET_OK=1   # from here on the target is validated: failure_help may name the clone
RUN=${RUN:-0}; MUTATE=0; [ "${APPROVAL:-}" = "CLONE_REHEARSAL_APPROVED" ] && MUTATE=1

# ---- execution helpers: print-only unless RUN=1 -------------------------------------------------------------------------------------------------------------------
g() { # gcloud; 'W' = writes (needs approval), 'R' = read
  local kind=$1; shift
  if [ "$RUN" != 1 ]; then echo "+ gcloud --project $PROJECT $*"; return 0; fi
  if [ "$kind" = W ] && [ "$MUTATE" != 1 ]; then die "'$PHASE' changes GCP: set APPROVAL=CLONE_REHEARSAL_APPROVED after the written approval" 3; fi
  gcloud --project "$PROJECT" "$@"
}
need_approval() { [ "$RUN" != 1 ] || [ "$MUTATE" = 1 ] || die "'$PHASE' changes GCP: set APPROVAL=CLONE_REHEARSAL_APPROVED after the written approval" 3; }
dv() { gcloud --project "$PROJECT" sql instances describe "$1" --format="value($2)"; }
secret_dir() { ( umask 077; mkdir -p "$REHEARSAL_DIR" ); chmod 700 "$REHEARSAL_DIR"; }
newpw() { openssl rand -hex 24; }
expiry_label() { if date -u -d "+${TTL_HOURS} hours" +%Y%m%dt%H%M >/dev/null 2>&1; then date -u -d "+${TTL_HOURS} hours" +%Y%m%dt%H%M; else date -u -v+"${TTL_HOURS}"H +%Y%m%dt%H%M; fi; }
ts_pitr() { if date -u -d "-${PITR_LAG_MIN} minutes" +%Y-%m-%dT%H:%M:%S.000Z >/dev/null 2>&1; then date -u -d "-${PITR_LAG_MIN} minutes" +%Y-%m-%dT%H:%M:%S.000Z; else date -u -v-"${PITR_LAG_MIN}"M +%Y-%m-%dT%H:%M:%S.000Z; fi; }
psql_clone() { PGPASSWORD=$(cat "$REHEARSAL_DIR/pw_$1") psql -qXAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PROXY_PORT" -U "$1" -d "$2" -c "$3"; }

# identity: the instance we are about to touch is exactly the clone (never the source), in the fixed project and region
assert_identity() { # level: basic | labeled | rotated
  local cn; cn=$(dv "$CLONE" connectionName) || die "cannot describe $CLONE"
  [ "$cn" = "$PROJECT:$REGION:$CLONE" ] || die "identity check failed: connectionName is '$cn', expected '$PROJECT:$REGION:$CLONE'"
  [ "$cn" != "$SRC_CONN" ] || die "identity check failed: the target is the production instance"
  if [ "$1" != basic ]; then [ "$(dv "$CLONE" settings.userLabels.purpose)" = rehearsal ] || die "$CLONE does not carry the label purpose=rehearsal"; fi
  if [ "$1" = rotated ]; then [ "$(dv "$CLONE" settings.userLabels.pw_rotated)" = yes ] || die "$CLONE is UNROTATED (label pw_rotated=yes missing): its production passwords were not replaced. Run teardown"; fi
}
# network / TLS gate for any instance (the source before cloning, the clone after)
netcheck_instance() { # name
  local n=$1 an ssl
  an=$(dv "$n" settings.ipConfiguration.authorizedNetworks) || die "cannot read the network settings of $n"
  [ -z "$an" ] || die "$n has authorized networks ($an): a clone inherits exposure. Nothing was changed"
  ssl=$(dv "$n" settings.ipConfiguration.sslMode)
  case "$ssl" in ENCRYPTED_ONLY|TRUSTED_CLIENT_CERTIFICATE_REQUIRED) ;; *) die "$n sslMode is '${ssl:-unknown}': TLS enforcement cannot be confirmed (need ENCRYPTED_ONLY or stricter)";; esac
  echo "netcheck $n: authorizedNetworks=none sslMode=$ssl ipv4Enabled=$(dv "$n" settings.ipConfiguration.ipv4Enabled) privateNetwork=$(dv "$n" settings.ipConfiguration.privateNetwork)"
}
users_gate() { # the clone has exactly the expected users
  local u bad=""
  for u in $(gcloud --project "$PROJECT" sql users list --instance "$CLONE" --format='value(name)'); do case " $EXPECTED_USERS " in *" $u "*) ;; *) bad="$bad $u";; esac; done
  [ -z "$bad" ] || die "the clone inherited unexpected users:$bad. Their production passwords were NOT rotated by this script. Run teardown"
}
gcloud_config_gate() {
  if gcloud config list --format=json 2>/dev/null | grep -q '"api_endpoint_overrides"'; then die "gcloud has api_endpoint_overrides configured: remove them (gcloud config unset api_endpoint_overrides/sql) before continuing"; fi
  echo "gcloud account: $(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1)"
}

phase_plan() {
  RUN=0
  cat <<EOF
== Rehearsal clone: $CLONE (source $SRC_CONN) · fixed target, no redirection by variables · life ≤ ${TTL_HOURS} h (hard max 24 h) · secrets in $REHEARSAL_DIR
-- 1 preflight (read-only)
EOF
  phase_preflight; echo "-- 2 create = clone + IMMEDIATE rotation + labels + network/TLS gate (one atomic phase, no human step in between)"; phase_create
  echo "-- 3 harden"; phase_harden; echo "-- 4 mark (needs: cloud-sql-proxy $SRC_CONN --port $PROXY_PORT with the CLONE connection name: $PROJECT:$REGION:$CLONE)"; phase_mark
  echo "-- 5 rehearse (SQL side, no GCP):  bash infra/db/rehearsal/rehearse-on-clone.sh"
  echo "-- 6 resize drill (optional)"; phase_resize; echo "-- 7 status (any time)"; phase_status; echo "-- 8 teardown"; phase_teardown
  echo "Cost envelope (list prices of Iowa, México not verified): 1 vCPU/3.75 GB regional 0.144 USD/h, zonal about half; 8 h ≈ 0.6–1.2 USD; 24 h hard max ≈ 3.5 USD (4.5 with a 30 % regional premium)."
}

phase_preflight() {
  if [ "$RUN" = 1 ]; then gcloud_config_gate; fi
  g R sql instances describe "$SOURCE" --format="value(connectionName,state,databaseVersion,region,settings.tier,settings.availabilityType,settings.backupConfiguration.pointInTimeRecoveryEnabled,settings.ipConfiguration.sslMode)"
  g R sql instances get-latest-recovery-time "$SOURCE"
  g R sql instances list --filter="name~^discovery-db-rehearsal" --format="table(name,state,createTime)"
  if [ "$RUN" = 1 ]; then
    local v; v=$(dv "$SOURCE" connectionName); [ "$v" = "$SRC_CONN" ] || die "the source's connectionName is '$v', expected '$SRC_CONN'"
    v=$(dv "$SOURCE" state); [ "$v" = RUNNABLE ] || die "the source is not RUNNABLE ($v)"
    v=$(dv "$SOURCE" databaseVersion); [ "$v" = POSTGRES_16 ] || die "the source is not POSTGRES_16 ($v)"
    v=$(dv "$SOURCE" settings.backupConfiguration.pointInTimeRecoveryEnabled); [ "$v" = True ] || [ "$v" = true ] || die "point-in-time recovery is not enabled on the source: the restore drill cannot run"
    netcheck_instance "$SOURCE"
    local h f; h=$(gcloud sql instances patch --help 2>&1 || true)
    for f in update-labels no-backup enable-point-in-time-recovery availability-type deletion-protection tier; do printf '%s' "$h" | grep -q -- "$f" || die "the installed gcloud does not document the flag '$f' of 'sql instances patch': update gcloud (gcloud components update) before continuing"; done
    printf '%s' "$(gcloud sql instances clone --help 2>&1 || true)" | grep -q -- "point-in-time" || die "the installed gcloud does not document --point-in-time for 'sql instances clone': update gcloud"
    echo "gcloud flags used by the rehearsal are documented by this gcloud version"
    v=$(gcloud --project "$PROJECT" sql instances list --filter="name~^discovery-db-rehearsal" --format="value(name)")
    [ -z "$v" ] || die "a rehearsal clone already exists ($v): one at a time; run status/teardown first"
    echo "preflight ok · point-in-time target would be $(ts_pitr)"
  fi
}

rotate_all_passwords() { # immediate: every expected user of the clone gets a new random password
  local u
  if [ "$RUN" = 1 ]; then STAGE=rotating; fi
  for u in $EXPECTED_USERS; do
    if [ "$RUN" = 1 ]; then
      newpw > "$REHEARSAL_DIR/pw_$u"; chmod 600 "$REHEARSAL_DIR/pw_$u"
      if ! gcloud --project "$PROJECT" sql users set-password "$u" --instance "$CLONE" --password "$(cat "$REHEARSAL_DIR/pw_$u")" --quiet >/dev/null; then
        echo "!! ROTATION FAILED for $u: the clone still holds PRODUCTION passwords (users already rotated in this run are listed in $REHEARSAL_DIR/pw_*; $u and any later user were NOT). Decide now: remove the clone (command below)." >&2; exit 4
      fi
      echo "password of $u on the clone replaced by a new random value (stored only in $REHEARSAL_DIR)"
    else
      echo "+ gcloud --project $PROJECT sql users set-password $u --instance $CLONE --password <new random, never printed> --quiet"
    fi
  done
}

phase_create() {
  need_approval
  if [ "$RUN" = 1 ]; then
    gcloud_config_gate
    [ "$(dv "$SOURCE" connectionName)" = "$SRC_CONN" ] || die "the source's connectionName is not $SRC_CONN"
    netcheck_instance "$SOURCE"   # a clone inherits the source's exposure: refuse to clone an exposed source
    secret_dir
    date -u +%s > "$REHEARSAL_DIR/create_started"; STAGE=started
  fi
  g W sql instances clone "$SOURCE" "$CLONE" --point-in-time "$(ts_pitr)"
  if [ "$RUN" = 1 ]; then
    STAGE=cloned
    assert_identity basic
    date -u +%s > "$REHEARSAL_DIR/created_epoch"; echo "$CLONE" > "$REHEARSAL_DIR/clone_name"
  fi
  rotate_all_passwords                                   # <- first action after the clone exists
  if [ "$RUN" = 1 ]; then STAGE=rotated; fi
  g W sql instances patch "$CLONE" --update-labels "purpose=rehearsal,pw_rotated=yes,expires_utc=$(expiry_label),owner=product-owner" --quiet
  if [ "$RUN" = 1 ]; then
    STAGE=labeled
    assert_identity rotated
    users_gate
    netcheck_instance "$CLONE"
    printf '%s %s\n' "$(date -u +%s)" "$PROJECT:$REGION:$CLONE" > "$REHEARSAL_DIR/netcheck_ok"; STAGE=verified
    echo "create complete: passwords rotated, network and TLS verified"
  else
    echo "+ (verify) identity=$PROJECT:$REGION:$CLONE, label pw_rotated=yes, users exactly [$EXPECTED_USERS], no authorized networks, sslMode ENCRYPTED_ONLY or stricter -> write netcheck_ok"
  fi
}

require_gate() { # harden / mark / resize: identity + rotation + a fresh network/TLS check + evidence of the create gate
  [ -f "$REHEARSAL_DIR/netcheck_ok" ] || die "no network/TLS gate evidence in $REHEARSAL_DIR: run create (it writes it)"
  assert_identity rotated; users_gate; netcheck_instance "$CLONE"
}

phase_netcheck() {
  if [ "$RUN" != 1 ]; then echo "+ gcloud --project $PROJECT sql instances describe $CLONE (identity, labels, authorizedNetworks, sslMode) and sql users list"; return 0; fi
  assert_identity rotated; users_gate; netcheck_instance "$CLONE"; echo "network/TLS gate ok"
}

phase_harden() {
  need_approval
  if [ "$RUN" = 1 ]; then require_gate; fi
  g W sql instances patch "$CLONE" --availability-type ZONAL --quiet
  g W sql instances patch "$CLONE" --no-enable-point-in-time-recovery --quiet   # PITR needs automatic backups: switch it off first
  g W sql instances patch "$CLONE" --no-backup --quiet
}

phase_mark() {
  need_approval
  if [ "$RUN" != 1 ]; then echo "+ (gate) then psql through the proxy on port $PROXY_PORT as postgres with the NEW clone password: CREATE ROLE rehearsal_marker_<random> NOLOGIN"; return 0; fi
  require_gate
  [ -f "$REHEARSAL_DIR/pw_postgres" ] || die "no clone password found in $REHEARSAL_DIR (run create)"
  psql_clone postgres postgres "select 1" >/dev/null 2>&1 || die "cannot log in through the proxy on port $PROXY_PORT with the CLONE password: start  cloud-sql-proxy $PROJECT:$REGION:$CLONE --port $PROXY_PORT  (if it points at another instance this failure is the guard working)"
  local m; m="rehearsal_marker_$(openssl rand -hex 8)"; echo "$m" > "$REHEARSAL_DIR/marker"
  psql_clone postgres postgres "CREATE ROLE $m NOLOGIN" >/dev/null
  [ "$(psql_clone postgres postgres "select count(*) from pg_roles where rolname='$m'")" = 1 ] || die "marker role not readable back"
  echo "marker written; the clone is the only server that answers to the clone credentials and carries it"
}

phase_resize() {
  need_approval
  if [ "$RUN" = 1 ]; then require_gate; fi
  g W sql instances patch "$CLONE" --tier db-custom-2-7680 --quiet
  if [ "$RUN" = 1 ]; then psql_clone postgres postgres "show max_connections" | sed 's/^/max_connections at db-custom-2-7680: /'; fi
  g W sql instances patch "$CLONE" --tier db-custom-1-3840 --quiet
  note "wall-clock time of each patch is the restart cost to expect on the real instance (the clone is ZONAL, the real one is REGIONAL: failover makes the real one shorter)"
}

phase_status() {
  g R sql instances list --filter="name~^discovery-db-rehearsal" --format="table(name,state,settings.availabilityType,createTime,settings.userLabels.purpose,settings.userLabels.pw_rotated,settings.userLabels.expires_utc)"
  if [ "$RUN" = 1 ]; then
    local now n=0 line nm pu pr ex; now=$(date -u +%Y%m%dt%H%M)
    for line in $(gcloud --project "$PROJECT" sql instances list --filter="name~^discovery-db-rehearsal" --format="csv[no-heading](name,settings.userLabels.purpose,settings.userLabels.pw_rotated,settings.userLabels.expires_utc)"); do
      n=$((n+1)); nm=${line%%,*}; line=${line#*,}; pu=${line%%,*}; line=${line#*,}; pr=${line%%,*}; ex=${line#*,}
      if [ "$pr" != yes ]; then echo "UNROTATED $nm: may still hold PRODUCTION passwords. Run teardown now"
      elif [ -z "$ex" ] || [ "$now" \> "$ex" ]; then echo "EXPIRED   $nm (expires_utc=${ex:-none}): run teardown now"
      else echo "ok        $nm (expires_utc=$ex)"; fi
    done
    [ "$n" -gt 0 ] || echo "no rehearsal clone exists"
  fi
}

phase_teardown() {
  need_approval
  local exists=1 lst
  if [ "$RUN" = 1 ]; then
    [ "${CONFIRM_DELETE:-}" = "$CLONE" ] || die "to delete set CONFIRM_DELETE=$CLONE (exact name of the clone)" 3
    lst=$(gcloud --project "$PROJECT" sql instances list --filter="name=$CLONE" --format='value(name)') || die "cannot list the instances: nothing was deleted and the local secrets were kept"
    if [ -z "$lst" ]; then
      exists=0; note "no instance named $CLONE exists in $PROJECT (already deleted, or never created): only the local secrets will be destroyed"
    else
      assert_identity basic
      if [ "$(dv "$CLONE" settings.userLabels.purpose)" != rehearsal ]; then
        [ "${UNLABELED_OK:-}" = yes ] || die "refusing: $CLONE does not carry the label purpose=rehearsal (a clone whose creation failed before labelling needs UNLABELED_OK=yes)"
        note "deleting an UNLABELED clone because UNLABELED_OK=yes; its identity matched $PROJECT:$REGION:$CLONE"
      fi
    fi
  fi
  if [ "$exists" = 1 ]; then
    g W sql instances patch "$CLONE" --no-deletion-protection --quiet || note "could not clear deletion protection on $CLONE (it may be busy or unprotected): the delete below reports if it is still blocked"
    g W sql instances delete "$CLONE" --quiet
    g R sql instances list --filter="name~^discovery-db-rehearsal" --format="value(name)"
  fi
  if [ "$RUN" = 1 ]; then
    lst=$(gcloud --project "$PROJECT" sql instances list --filter="name=$CLONE" --format='value(name)') || die "cannot verify the deletion: local secrets kept"
    [ -z "$lst" ] || die "the clone still exists: local secrets kept so that you can retry teardown"
    echo "clone $CLONE deleted; the source $SOURCE untouched: $(dv "$SOURCE" state)"
    if [ -d "$REHEARSAL_DIR" ]; then
      local f
      for f in "$REHEARSAL_DIR"/* "$REHEARSAL_DIR"/.[!.]*; do [ -f "$f" ] || continue; if command -v shred >/dev/null 2>&1; then shred -u "$f"; else rm -P "$f"; fi; done
      rmdir "$REHEARSAL_DIR" 2>/dev/null || true; echo "local rehearsal secrets destroyed"
    fi
  else
    echo "+ shred/rm -P every file in $REHEARSAL_DIR, then rmdir"
  fi
}

case "$PHASE" in
  plan) phase_plan ;;
  preflight|create|netcheck|harden|mark|resize|status|teardown) "phase_$PHASE" ;;
  *) echo "usage: [RUN=1 APPROVAL=CLONE_REHEARSAL_APPROVED] $0 {plan|preflight|create|netcheck|harden|mark|resize|status|teardown}"; exit 2 ;;
esac
