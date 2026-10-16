#!/usr/bin/env bash
# Rolls a production Cloud Run service back to a previous revision (traffic switch only; no data is touched).
#   bash deploy/production/rollback-production.sh <service> [<revision>]      (no revision = list them)
#   DRY_RUN=0 PROD_CONFIRM=ROLLBACK:<PROJECT_ID> bash deploy/production/rollback-production.sh discovery-web discovery-web-00007-abc
# LIMIT (do not hide it): safe only BEFORE the first sealed delivery. Migrations are additive and are NOT reverted; after real deliveries exist, older code cannot read
# sealed results — recover by restoring the database (point-in-time) instead; see RUNBOOK.md.
set -euo pipefail
: "${PROJECT_ID:?set PROJECT_ID}"; : "${REGION:?set REGION}"
SERVICE=${1:?service: discovery-web | discovery-backend | discovery-worker}; REV=${2:-}
case "$SERVICE" in discovery-web|discovery-backend|discovery-worker) ;; *) echo "unknown service"; exit 2;; esac
if [ -z "$REV" ]; then gcloud --project "$PROJECT_ID" run revisions list --service "$SERVICE" --region "$REGION" --limit 10; exit 0; fi
DRY_RUN=${DRY_RUN:-1}
if [ "$DRY_RUN" = "0" ]; then [ "${PROD_CONFIRM:-}" = "ROLLBACK:${PROJECT_ID}" ] || { echo "PROD_CONFIRM must be ROLLBACK:${PROJECT_ID}"; exit 3; }; fi
echo "+ gcloud --project $PROJECT_ID run services update-traffic $SERVICE --region $REGION --to-revisions $REV=100"
[ "$DRY_RUN" = "0" ] && gcloud --project "$PROJECT_ID" run services update-traffic "$SERVICE" --region "$REGION" --to-revisions "$REV=100"
echo "Remember: the database schema is not rolled back (see the limit in this script's header)."
