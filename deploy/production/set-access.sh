#!/usr/bin/env bash
# Changes the access gate of the RUNNING web service. Runtime configuration only: no rebuild, no new image, same hostname.
#   bash deploy/production/set-access.sh close     # emergency / controlled phase: gate = basic, not indexable (credentials secret must already be bound)
#   bash deploy/production/set-access.sh edge      # gate provided by the edge (IAP / proxy); the app does not enforce one
#   I_CONFIRM_OPEN_COMMERCIAL_ACCESS=yes bash deploy/production/set-access.sh open     # commercial opening: gate off, indexable
set -euo pipefail
: "${PROJECT_ID:?set PROJECT_ID}"; : "${REGION:?set REGION}"
MODE=${1:?close | edge | open}; DRY_RUN=${DRY_RUN:-1}
case "$MODE" in
  close) VARS="ACCESS_GATE_MODE=basic,ROBOTS_NOINDEX=true";;
  edge)  VARS="ACCESS_GATE_MODE=edge,ROBOTS_NOINDEX=true";;
  open)  [ "${I_CONFIRM_OPEN_COMMERCIAL_ACCESS:-}" = "yes" ] || { echo "opening is a deliberate decision: set I_CONFIRM_OPEN_COMMERCIAL_ACCESS=yes (after the open-phase preflight passed: LAUNCH_PHASE=open)"; exit 3; }
         VARS="ACCESS_GATE_MODE=off,ROBOTS_NOINDEX=false";;
  *) echo "unknown mode"; exit 2;;
esac
echo "+ gcloud --project $PROJECT_ID run services update discovery-web --region $REGION --update-env-vars $VARS"
[ "$DRY_RUN" = "0" ] && gcloud --project "$PROJECT_ID" run services update discovery-web --region "$REGION" --update-env-vars "$VARS"
[ "$DRY_RUN" = "0" ] || echo "(DRY RUN: set DRY_RUN=0 to apply)"
echo "The page answers /health with the active gate mode; the new revision starts and refuses to start if the configuration is invalid (fail closed)."
