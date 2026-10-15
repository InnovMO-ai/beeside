#!/usr/bin/env bash
# Logging metrics + alert policies for Discovery production (hooks). Idempotent. DRY_RUN=1 (default) only prints. Needs ALERT_CHANNEL (a Cloud Monitoring
# notification channel id, owned by the platform). Without it nothing is created and the preflight already refuses the deployment.
set -euo pipefail
: "${PROJECT_ID:?}"; : "${ALERT_CHANNEL:?ALERT_CHANNEL is required}"
DRY_RUN=${DRY_RUN:-1}; HERE="$(cd "$(dirname "$0")" && pwd)"
run() { echo "+ $*"; if [ "$DRY_RUN" = "0" ]; then "$@"; fi; }
metric() { # name description filter
  if [ "$DRY_RUN" = "0" ] && gcloud --project "$PROJECT_ID" logging metrics describe "$1" >/dev/null 2>&1; then echo "metric $1 exists"; return; fi
  run gcloud --project "$PROJECT_ID" logging metrics create "$1" --description "$2" --log-filter "$3"
}
metric discovery_error_logs "Discovery: any ERROR log from the production services" 'resource.type="cloud_run_revision" AND resource.labels.service_name=~"^discovery-(web|backend|worker)$" AND severity>=ERROR'
metric discovery_outbox_tick_failed "Discovery: the e-mail worker could not complete a cycle" 'resource.type="cloud_run_revision" AND resource.labels.service_name="discovery-worker" AND jsonPayload.message="fa4 email outbox tick failed"'
metric discovery_outbox_dead "Discovery: an e-mail reached the DEAD state (retries exhausted)" 'resource.type="cloud_run_revision" AND resource.labels.service_name="discovery-worker" AND jsonPayload.message="fa4 email outbox" AND jsonPayload.dead>0'
metric discovery_gate_bruteforce "Discovery: repeated failed access-gate attempts (429)" 'resource.type="cloud_run_revision" AND resource.labels.service_name="discovery-web" AND httpRequest.status=429'
for P in policy-5xx policy-error-logs policy-outbox policy-gate; do
  TMP="$(mktemp)"; sed "s#__CHANNEL__#projects/${PROJECT_ID}/notificationChannels/${ALERT_CHANNEL}#g; s#__PROJECT__#${PROJECT_ID}#g" "$HERE/$P.json" > "$TMP"
  run gcloud --project "$PROJECT_ID" alpha monitoring policies create --policy-from-file "$TMP"
  rm -f "$TMP"
done
echo "Also (after the load balancer exists, platform-owned): an uptime check on https://<host>/discovery/brand/beeside-lockup.png (public by design) and Cloud SQL CPU/disk alerts."
