#!/usr/bin/env bash
# Discovery production — EDGE: global external HTTPS load balancer in front of discovery-web (serverless NEG), Google-managed certificate, HTTP→HTTPS redirect, Cloud Armor.
# Run AFTER discovery-web exists and the hostname is decided; the certificate becomes ACTIVE only once DNS for HOSTNAME points at the reserved IP (a DNS change owned by
# whoever controls the beeside.you zone). Nothing here changes DNS. Not part of deploy-production.sh on purpose (platform-owned, rarely changes).
#   HOSTNAME=discovery.beeside.you DRY_RUN=0 bash deploy/production/provision-edge.sh
set -euo pipefail
PROJECT_ID=${PROJECT_ID:-beeside-discovery-prod}; REGION=${REGION:-northamerica-south1}
HOSTNAME=${HOSTNAME:?set HOSTNAME, e.g. discovery.beeside.you}; DRY_RUN=${DRY_RUN:-1}
RATE_LIMIT_PER_MIN=${RATE_LIMIT_PER_MIN:-300}
run() { echo "+ $*"; if [ "$DRY_RUN" = "0" ]; then "$@"; fi; }
g() { gcloud --project "$PROJECT_ID" "$@"; }
exists() { g "$@" >/dev/null 2>&1; }
echo "== serverless NEG → discovery-web"
exists compute network-endpoint-groups describe discovery-web-neg --region "$REGION" || run g compute network-endpoint-groups create discovery-web-neg --region "$REGION" --network-endpoint-type serverless --cloud-run-service discovery-web
echo "== Cloud Armor (per-IP rate limit; add an IP allow-list rule here if the controlled phase should also be network-restricted)"
exists compute security-policies describe discovery-edge || {
  run g compute security-policies create discovery-edge --description "Discovery edge: rate limit"
  run g compute security-policies rules create 1000 --security-policy discovery-edge --action throttle --rate-limit-threshold-count "$RATE_LIMIT_PER_MIN" --rate-limit-threshold-interval-sec 60 --conform-action allow --exceed-action deny-429 --enforce-on-key IP --src-ip-ranges '*' --description "per-IP throttle"
}
echo "== backend service + URL map"
exists compute backend-services describe discovery-web-backend --global || {
  run g compute backend-services create discovery-web-backend --global --load-balancing-scheme EXTERNAL_MANAGED --protocol HTTPS --security-policy discovery-edge --enable-logging --logging-sample-rate 1.0
  run g compute backend-services add-backend discovery-web-backend --global --network-endpoint-group discovery-web-neg --network-endpoint-group-region "$REGION"
}
exists compute url-maps describe discovery-url-map || run g compute url-maps create discovery-url-map --default-service discovery-web-backend
echo "== managed certificate + proxies + forwarding rules on the reserved IP"
exists compute ssl-certificates describe discovery-cert --global || run g compute ssl-certificates create discovery-cert --global --domains "$HOSTNAME"
exists compute target-https-proxies describe discovery-https-proxy || run g compute target-https-proxies create discovery-https-proxy --url-map discovery-url-map --ssl-certificates discovery-cert
exists compute forwarding-rules describe discovery-https --global || run g compute forwarding-rules create discovery-https --global --load-balancing-scheme EXTERNAL_MANAGED --address discovery-lb-ip --target-https-proxy discovery-https-proxy --ports 443
# plain HTTP only redirects to HTTPS (never serves content)
if ! exists compute url-maps describe discovery-http-redirect; then
  if [ "$DRY_RUN" = "0" ]; then
    TMP="$(mktemp)"; printf 'name: discovery-http-redirect\ndefaultUrlRedirect:\n  redirectResponseCode: MOVED_PERMANENTLY_DEFAULT\n  httpsRedirect: true\n' > "$TMP"
    g compute url-maps import discovery-http-redirect --source "$TMP" --global; rm -f "$TMP"
  else echo "+ (import url-map discovery-http-redirect: httpsRedirect)"; fi
fi
exists compute target-http-proxies describe discovery-http-proxy || run g compute target-http-proxies create discovery-http-proxy --url-map discovery-http-redirect
exists compute forwarding-rules describe discovery-http --global || run g compute forwarding-rules create discovery-http --global --load-balancing-scheme EXTERNAL_MANAGED --address discovery-lb-ip --target-http-proxy discovery-http-proxy --ports 80
IP=$( [ "$DRY_RUN" = "0" ] && g compute addresses describe discovery-lb-ip --global --format='value(address)' || echo "<reserved-ip>" )
cat <<MSG

Edge ready (DRY_RUN=$DRY_RUN). DNS action for the owner of the zone:   $HOSTNAME  A  $IP
The managed certificate turns ACTIVE after that record resolves (usually 15–60 min):
  gcloud compute ssl-certificates describe discovery-cert --global --project $PROJECT_ID --format='value(managed.status,managed.domainStatus)'
MSG
