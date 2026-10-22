# Discovery Code — stage 2 report (DSC-09, 36, 37, 38, 40, J-check, PD-39)

Branch `feat/fa4-launch-config`. Statuses: IMPLEMENTED / TESTED / INTEGRATED only. Not deployed, not merged. L1 convergence: PENDING.

## Verification A — `/links/request` timing / enumeration (MEASUREMENT ONLY, no fix)
Local backend (`backend/dist`, scratch DB `fa4_e2e`, inline dispatch, rate limits off, fictitious addresses), 300 rounds each, sequential, loopback.

| Case | median ms | p95 ms |
|---|---|---|
| Known address, first request (enqueues a link) | 3.00 | 6.61 |
| Known address, second request (cooldown, nothing enqueued) | 1.29 | 2.68 |
| Unknown address | 0.79 | 1.61 |

Body and status are identical in every case (`200 {"ok":true}`); the only observable difference is latency (≈2 ms locally, from the enqueue insert). Not measured against production (it would send real mail). Any correction (e.g. constant-time padding or always enqueueing asynchronously) is NOT implemented; if it needs a shared component → ALERTA L1.

## Verification B / C
B: `e2e/yev-hero.spec.ts` + `hero-widths.spec.ts` green at 375/768/1024/1440 with the help trigger in the hero. C: hero SHA-1 asserted in `heroAssets.test.ts`.

## Uptime (read-only, VERIFY FIRST)
(a) Necessity for Commercial Readiness: YES — nothing today detects the site being unreachable (no uptime check exists; `gcloud monitoring uptime list-configs` → 0). (b) Equivalent supervision: 4 enabled alert policies (5xx, ERROR logs, outbox failing/DEAD, gate brute force) with a notification channel; they fire only when traffic/worker runs, so they do not replace an external probe. Cloud Run min-instance 1 on the worker, Cloud SQL HA/PITR on. (c) Shared infrastructure: the probe would live in the Discovery GCP project, behind the access gate (a `/health` path is already exposed by the web service); no shared/Architecture component is involved. Recommendation: add one HTTPS uptime check on the Discovery `/health` + alert to the existing channel before COMMERCIAL READINESS (infra change: needs Product authorisation, not done here).

## Notes for Product
- Hero: white text + dark-blue veil follows the approved prototype (vs "keep current veil").
- Help on the decision screen assumes the size/decision mapping in `copy/help.ts`.
- «Hablar con beeside» is a `mailto:` link in the YEV (PD-31); the `contact=open` e-mail deep link still opens the contact dialog.
- DSC-36 supersedes "30 min → cover". DSC-07 untouched (blocked by L1).
