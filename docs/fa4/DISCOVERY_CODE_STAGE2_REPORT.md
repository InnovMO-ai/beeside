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

## Audit closure (2026-10-22)
### 1. DSC-40 hero contrast — measured, then veil intensity only
Spec `frontend/e2e/hero-contrast.spec.ts`: foreground hidden, bare backdrop screenshot, lightest decile (p90) of the pixels under each element, ratio of #fff against it (WCAG relative luminance). Minimums: text 4.5 (h1 and logo/controls, large or UI: 3).

| Width | Element | Before (veil .50→.15) | After (veil .52→.48) |
|---|---|---|---|
| 375 | eyebrow / h1 / sub / help trigger / logo | 4.16 / 2.92 / **2.31** / 4.92 / 4.90 | 5.80 / 5.22 / 4.83 / 6.15 / 6.00 |
| 768 | same | 4.22 / 2.87 / **2.36** / 5.04 / 5.25 | 5.65 / 5.15 / 4.83 / 6.08 / 5.99 |
| 1024 | same | 4.22 / 2.94 / **2.48** / 4.77 / 11.30 | 5.64 / 5.17 / 4.91 / 5.80 / 12.11 |
| 1440 | same | 4.32 / 2.97 / **2.53** / 4.89 / 9.86 | 5.63 / 5.16 / 4.96 / 5.80 / 10.70 |

Before: eyebrow, h1 and sub failed. Changed ONLY the gradient alpha of `.res-hero.photo .hero-photo::after` (`.5 → .15` became `.52 → .48`, same colour and stops). Image, crop, typography, layout and content position untouched. The spec stays as a regression guard.

### 2. DSC-36 activity semantics
Proposal: `docs/fa4/DSC36_ACTIVITY_SEMANTICS_PROPOSAL.md` (no L1 alert). Implemented as proposed: heartbeat `POST /api/fa4/session/activity` every 2 min while the tab is visible and the person interacted (pointer move/down, keyboard, scroll, touch, wheel, input) since the previous beat; `updated_at` = last activity (monotonic, ≤ 1 write/min, IN_PROGRESS only, constant answer). Closed browser / asleep → no beats → the worker sweeps as before. Tests: integration 13 (heartbeat), frontend 14b.

### 3. Help map — MATCH — NO CHANGE
Compared row by row with `DSC-37_HELP_CONTENT_v1.md` §3 and `DISCOVERY_HELP_DESIGN_VALIDATION.md` (final mapping, with S1: G not rendered): every row identical, pinned by a unit test. The earlier «assumption» was only the assignment of two app screens to approved rows: the *reason* and *decision* steps are both stage «Por qué y cuándo» (C · D); the «Tamaño del proyecto» block (shown inside the decision step when the person does not already know what they need) uses the «Tamaño» row (D · C). No new mapping. Design may confirm that the size block counts as its own row.
