# DSC-36 ACTIVITY SEMANTICS — PROPOSAL

Branch `feat/fa4-launch-config`. Written BEFORE any code change (Product rule: «30 min since the last save» ≠ «30 min of inactivity»).

## Problem
The server sweep (`sweepIdleContinuations`) and the one-email-per-period rule key on `fa4_project.updated_at`, which today moves only on SAVES. A person who keeps reading / scrolling / moving the pointer on an open tab for more than 30 min without changing an answer would be treated as idle by the worker and receive the continuation e-mail while active.

## Solution (minimal)
A light **activity heartbeat**: `POST /api/fa4/session/activity`, authenticated by the tab's own session token (same bearer as every `/session/*` call).

- Server: `UPDATE fa4_project SET updated_at = $now WHERE project_id = $1 AND status = 'IN_PROGRESS' AND updated_at <= $now - 60 s`. Nothing else is written (no answers, no step, no event). Answer: `200 {"ok":true}`, identical whether or not a row was touched. DELIVERED / ANONYMIZED projects are never touched.
- Client (Fa4App): the tab already records interaction (`pointerdown`, `keydown`, `scroll`, `touchstart`, `wheel`, `input`); add `pointermove` (passive, only sets a timestamp). Every **2 min**, if the tab is **visible**, the project exists and is not idle/delivered/cover, AND there was interaction since the previous beat → send one heartbeat. No interaction → no heartbeat. Failures are ignored (best effort, no retry storm; the next interval tries again).

## Semantics on `updated_at`
`updated_at` becomes «last activity of the project» (saves OR heartbeat). It stays monotonic (never moves backwards). Consequences, all checked:
- **Idle period** (one e-mail per period = `updated_at`): activity opens a new period; an e-mail already sent for an older period does not block a future one after new real activity — that is the intended meaning.
- **Order of «most recent projects» for e-mail resume** (`recentProjectsForEmail`): the project the person is actually using ranks first — correct.
- The delivered-lock trigger fires on `UPDATE OF answers`/`status` only; a heartbeat touches neither.
- No schema change: the column and its index already exist.

## Behaviour by case
| Case | Result |
|---|---|
| Tab visible + active > 30 min without saving | heartbeat keeps `updated_at` ≤ ~2 min old → the worker never selects it; the tab never fires its own idle path |
| Tab visible, no interaction 30 min | no heartbeat → tab idle path (as now) and/or worker at `updated_at + 30 min`; one e-mail per period |
| Tab hidden (other tab/window) | no heartbeat (hidden = not interacting with Discovery); inactivity clock keeps running as today |
| Browser closed / computer asleep | no heartbeat → worker sweeps at last-activity + 30 min (at most ~2 min earlier than the true last interaction because of the 2-min beat) — same `project_id`, no loss of progress |
| Two tabs of the same project | each beats; the 60 s server guard collapses them to ≤ 1 write/min |
| Beat racing a save / the sweep | beat is a single conditional UPDATE; the sweep re-reads `updated_at` under the per-recipient advisory lock (existing), so a beat landing before the lock suppresses the e-mail, one landing after leaves the already-created delivery as the (idempotent) single e-mail of that period |

## Frequency / cost
≤ 1 request per 2 min per active tab (≤ 30/h; limit `fa4_session_writes` is 900 per 10 min). One indexed single-row UPDATE; skipped by the 60 s guard when recent.

## Files
Backend: `backend/src/fa4/repository.ts` (`touchProjectActivity`), `backend/src/fa4/routes.ts` (route). Frontend: `frontend/src/fa4/api.ts`, `Fa4App.tsx`. Tests: backend integration (touch semantics, guard, status, sweep interplay) and frontend unit/e2e.

## Idempotency
Repeating a beat within 60 s changes nothing; response is constant.

## L1
No migration, no `shared/fa-public-engine`, no new infrastructure, no contract change (a new endpoint under the existing `/api/fa4/session/*`, same auth and rate-limit). **No L1 alert.** For the convergence note: `updated_at` of `fa4_project` is Discovery-owned; the Precision mapper reads answers, not `updated_at` (to be confirmed on convergence).

## Risks
- Sweep at up to ~2 min earlier than 30 min after the real last interaction (beat granularity) — accepted; reducing the interval costs requests.
- `pointermove` counts as activity: an unattended tab with a pointer resting does not emit events, but a bumped table/mouse would; accepted (that is activity).
- Clock: server time only (`$now`), no client time is sent.
