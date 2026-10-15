# Discovery Public v1.0 — production runbook (controlled launch)

Public home `https://beeside.you/discovery` · reserved `https://beeside.you/ops-control` (blocked) · technical alias `/fa4` redirects to `/discovery/`.
This is the final production product: the same deployment is opened commercially later by **configuration only** (`set-access.sh open`), never by moving host or rebuilding.

## 0. What is where

| Piece | Cloud Run | Notes |
|---|---|---|
| `discovery-web` | service, ingress = load balancer only | Discovery-only static server. Answers only `/discovery/…`; forwards only `/discovery/api/fa4/…` to the backend (prefix stripped); `/ops-control` → 404 (reserved); legacy `/api/fa`, `/api/admin`, `/admin`, `/` → 404. Gate + noindex are runtime env. |
| `discovery-backend` | service, IAM-only invoker | Express API. Production fail-closed config (privacy version, SMTP, hash secret, proxy hops, https origins). |
| `discovery-worker` | service, min 1, CPU always on | E-mail outbox poller (`dist/fa4/worker.js`). Safe with several replicas. |
| `discovery-migrate`, `discovery-seed` | jobs | Run with the **migration** database role; the runtime services never receive that credential. |

Owned by the platform (the scripts never create them): GCP project, Cloud SQL (+ database, owner and runtime login roles, backups, PITR), Secret Manager values, Artifact Registry repo, load balancer + certificate + DNS, org-policy exception, notification channel.

## 1. Release

1. `cp deploy/production/production.env.example deploy/production/production.env` and fill it (names/non-secret values; secrets by Secret Manager name). `LAUNCH_PHASE=controlled`.
2. Build the web bundle once to let the preflight inspect it: `VITE_BASE_PATH=/discovery/ VITE_DISCOVERY_ONLY=true npm run build --workspace=frontend`.
3. `node scripts/fa4-production-preflight.js --env-file deploy/production/production.env --dist frontend/dist --verify-gcloud` — must print `PREFLIGHT PASSED`. Any MISSING / INVALID / EXTERNAL line blocks the release.
4. Dry run: `DRY_RUN=1 bash deploy/production/deploy-production.sh deploy/production/production.env` — review every command.
5. Release: `DRY_RUN=0 PROD_CONFIRM=DEPLOY-TO-PRODUCTION:<PROJECT_ID> bash deploy/production/deploy-production.sh deploy/production/production.env` (clean tree, `IMAGE_TAG` = HEAD).
6. Verify: `GET /health` on the web service shows the active gate; team smoke test behind the gate (RELEASE_AUDIT §10): cover → journey → preview → «Corregir algo» → e-mail delivery (arrives from contact@beeside.you, logo loads) → Start Your Expansion → locked.
7. Real prospect data only after `LEGAL1_CONFIRMED` (Legal) — the preflight WARNs until then.

## 2. Access gate (controlled → open)

| Mode | Meaning |
|---|---|
| `basic` | The web service asks for credentials (one `user:password` per line in the secret named by `SECRET_ACCESS_GATE_CREDENTIALS`, password ≥ 12). Public by design: `/health`, `/robots.txt`, `/discovery/brand/*` (e-mail clients fetch the logo without cookies). `/ops-control` is never gated — it is blocked. 10 failed attempts/10 min per address → 429. |
| `edge` | Access is enforced in front of the service (IAP / proxy / Cloud Armor); the app adds nothing. Requires `EDGE_GATE_CONFIRMED=true`. |
| `off` | Open. Only for `LAUNCH_PHASE=open` (explicit confirmations, Legal, purchase URL, approved comparison). |

An invalid or missing gate configuration makes the new revision refuse to start (the previous revision keeps serving). Commands: `set-access.sh close` (emergency/controlled) · `edge` · `I_CONFIRM_OPEN_COMMERCIAL_ACCESS=yes set-access.sh open`. All are environment changes on `discovery-web`; **no rebuild, same hostname**. Closed deployments are `noindex` (header + robots) — `open` also lifts that.

## 3. Rollback

- Application: `rollback-production.sh <service> [<revision>]` (traffic switch). **Safe only before the first sealed delivery.** Migrations 0022/0023 are additive and are not reverted; after real deliveries exist, previous code cannot interpret sealed results.
- Data: point-in-time restore of the Cloud SQL instance to a new instance, then re-point `SECRET_DATABASE_URL` and redeploy. Restoring loses everything after the chosen time — decide with the business owner; delivered results are append-only, so partial manual repairs are not allowed.
- Gate emergency: `set-access.sh close`. E-mail emergency: scale `discovery-worker` to 0 (rows stay queued, nothing is lost).

## 4. Logs and alerts

Structured JSON logs; e-mail addresses masked; no tokens, answers or message bodies (private links live in the URL fragment and never reach the server). Filters: errors `severity>=ERROR`; worker cycle `jsonPayload.message="fa4 email outbox"` (`sent`/`failed`/`dead`); gate abuse `httpRequest.status=429`. `alerts/apply-alerts.sh` creates the log-based metrics and four policies (5xx, ERROR logs, outbox DEAD/stalled, gate brute force) on `ALERT_CHANNEL`. Platform adds: uptime check on `/discovery/brand/beeside-lockup.png`, Cloud SQL CPU/disk/connection alerts. Cloud Error Reporting groups Cloud Run errors automatically; there is no paging beyond the notification channel.

## 5. Privacy operations

Authorized erasure only: `SELECT fa4_anonymize_project('<project_id>', '<actor>', '<reason>')` as the database owner (scrubs the YEV model, both snapshots, demand-signal payloads, contacts; keeps legal evidence and the append-only structure; revokes tokens). No retention period is applied automatically except the 180-day purge of orphan pre-project contact requests; retention policy is a Legal decision.

## 6. Reserved `/ops-control`

Blocked (404, noindex) until the Discovery administration surface is connected. It must never serve the legacy Control Center and never redirect to `/admin`. Connecting it later is a code change + edge rule, not part of this release.
