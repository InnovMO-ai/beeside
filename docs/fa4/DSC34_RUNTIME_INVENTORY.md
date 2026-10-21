# DSC-34 — Discovery v1.0 runtime inventory (real vs simulated)

Scope: what actually runs at `https://discovery.beeside.you` (`feat/fa4-launch-config @ ba20f85`, digests `discovery-web f90e3ec5…`, `discovery-backend/worker 07a81e02…`) and the code on this branch. Test doubles do NOT count. Evidence is a code path, a configuration value or a command run on 2026-10-21. Method: read-only (grep of non-test sources, the served bundle, GCP describe calls, public DNS/HTTP).
Classes: **REAL** · **SIMULATED** · **MOCK** · **PLACEHOLDER** · **PENDING INTEGRATION**. Any simulation/placeholder in the runtime the commercial version needs = **BLOCKER**.

## 1. Inventory

| # | Component | Class | Evidence (code / config) |
|---|---|---|---|
| 1 | Frontend (React/Vite SPA, Discovery-only static server) | **REAL** | `frontend/src/fa4/**`, `frontend/server/static-server.mjs`; Cloud Run `discovery-web` (ingress LB-only). The served bundle contains none of the fixture markers (`Nórtica`, `Eólica`, `lucia@nortica`, `example.test`, `TODO`, `Lorem`, `PLACEHOLDER`): 0 hits. No runtime file imports `@beeside/fa-public-engine/testing` (grep). |
| 2 | Backend API (`/api/fa4/*`) | **REAL** | `backend/src/fa4/routes.ts`; Cloud Run `discovery-backend`, `NODE_ENV=production`; private (IAM invoker = web service account). |
| 3 | Persistence | **REAL** | Cloud SQL `discovery-db`, Postgres 16, REGIONAL (HA), automated backups ON (14 retained), PITR ON, `RUNNABLE`; runtime role without DDL (prepare job verifies). Migrations 0000–0023 applied by `discovery-migrate` (job image `12f95ac`, no schema difference with the running code). |
| 4 | Service catalog data | **REAL** (seed-managed) | `shared/fa-public-engine/src/catalog/seed.ts` = «published catalog» from `CAPABILITY_REGISTRY_FOR_DESIGN.md v4 (2026-10-04)`; loaded by `backend/src/scripts/seed-fa4-catalog.ts`. Product registry data, not sample data. There is no admin UI to change it (ADMIN-1, D-141: does not block launch). |
| 5 | YEV generation (deterministic engine) | **REAL** | `shared/fa-public-engine/src/engine/{resolve,frontRules,yev}.ts`; preview computed server-side from the stored answers, sealed on delivery (`backend/src/fa4/service.ts`). No AI. |
| 6 | Resume / save for later | **REAL** | `POST /session/finish-later` + single-use link exchange `POST /links/continue` (`routes.ts`); tab session bound to a recent visit (DSC-01). |
| 7 | E-mail worker | **REAL** | `backend/src/fa4/worker.ts`; Cloud Run `discovery-worker` (min 1, CPU always on, health listener); outbox with leases/retries/DEAD. |
| 8 | E-mail delivery (SMTP) | **REAL** | `FA4_EMAIL_TRANSPORT=smtp`, `smtp.gmail.com:587` STARTTLS, app password in Secret Manager; real sends confirmed on 2026-10-16 (worker cycles `sent>0, failed=0`, no ERROR/5xx). Frozen templates `backend/src/fa4/email-templates`. |
| 9 | Security | **REAL** | Access gate `ACCESS_GATE_MODE=basic` (3 credentials), Cloud Armor `discovery-edge`, per-IP rate limits (10 projects / 10 min), payload limits, hash secret, `TRUST_PROXY_HOPS=4` measured, `noindex`, `/ops-control` reserved 404. |
| 10 | Privacy / permissions | **REAL** (mechanism) · **PLACEHOLDER** (legal evidence) | Erasure `fa4_anonymize_project` (migration), masked e-mails in logs, no tokens in logs. **But**: the consent evidence is recorded with the marker `CLOSED-TEST-NOT-LEGAL` because `FA4_PRIVACY_VERSION` is not set (LEGAL-1, external) → see B-3. |
| 11 | Contract towards Precision (`fa4-precision-context/1`) | **REAL** (mapper) · **PENDING INTEGRATION** (consumer) | `shared/fa-public-engine/src/precision/context.ts`, `getFa4PrecisionContext(project_id, result_id)`; contract tests green. No consumer exists on this deployed line (Precision ingestion lives on the L1 / integration line) → B-5 (Architecture). Not changed here. |
| 12 | Premium continuation («Start Your Expansion») | **PENDING INTEGRATION** | `frontend/src/fa4/brand.ts`: `VITE_FA4_PREMIUM_PURCHASE_URL` is empty in the production build → the CTA is **not rendered** (fail-closed, verified on the real URL: 0 buttons). When confirmed (staging only) `POST /session/continue` only inserts a row in `fa4_continuation_request` (`repository.ts: requestContinuation`): nothing notifies a Sherpa / Operation Hub / payment → B-1, B-2. |
| 13 | «Hablar con beeside» / help | **REAL** | `routes.ts: contact` → outbox → `contact@beeside.you` (SMTP); official links `https://beeside.you/termsandconditions`, `https://www.beeside.you/privacy`, `https://www.beeside.you/helpcenter` all answer 200 (2026-10-21). |
| 14 | Analytics / events | **REAL** | `POST /api/fa4/events` → `fa4_event` (closed property contract, `backend/src/fa4/events.ts`). |
| 15 | Alerts / observability | **REAL** (alerts) · **PENDING** (uptime) | 4 enabled alert policies with a notification channel (5xx, ERROR logs, outbox failing/DEAD, gate brute force). **No uptime check exists** (the runbook assumes one). |
| 16 | Brand lockups | **PLACEHOLDER (temporary, approved visually)** | `frontend/scripts/build-brand-lockups.mjs`: «TEMPORARY until Brand supplies a native vector (BRAND-1)». Rendered correctly and approved by the PO; replace when the vector arrives. Not a blocker. |
| 17 | Sample data / text | **none** | UI example strings (`sectorPh`, `rolePh`) are hints, not data. Fixtures live only under `shared/fa-public-engine/src/testing` (tests). |
| 18 | `devSimulatedCheckout` (legacy Premium module) | **SIMULATED — present, unreachable in production** | `backend/src/index.ts:106`: only with `PREMIUM_DEV_SIMULATION=true` **and** `NODE_ENV !== "production"`; production env has `NODE_ENV=production` and no such variable (checked on the running revision). Legacy code in the same image; not exposed (the web tier forwards only `/api/fa4/*`). Reported for completeness. |
| 19 | Reviewer e-mail allowlist | **PENDING INTEGRATION (configuration)** | `FA4_CLOSED_TEST_EMAIL_ADDRESSES` is supported but unset (the reviewers' addresses were not supplied). Stabilization only. |

## 2. Blockers for COMMERCIALLY READY (must be empty)

| ID | What | Class | Owner / needs |
|---|---|---|---|
| B-1 | «Start Your Expansion» purchase / payment destination is not supplied: the commercial CTA does not exist in the runtime. | PENDING INTEGRATION (external) | Product / Commercial / Payments (payments are outside this batch). |
| B-2 | Confirming the continuation only writes a database row: no notification or hand-off reaches a Sherpa / Operation Hub, yet the copy promises contact within 2 business days. | PENDING INTEGRATION | Product + Architecture (Operation Hub / Precision hand-off). |
| B-3 | `FA4_PRIVACY_VERSION` unset: legal evidence is the marker `CLOSED-TEST-NOT-LEGAL`; LEGAL-1 (marketing-consent legal basis) and retention policy pending. | PLACEHOLDER (external) | Legal. |
| B-4 | E-mail authentication: SPF is soft-fail (`~all`), DKIM `google._domainkey` present, **no DMARC record** (`_dmarc.beeside.you` empty). | PENDING INTEGRATION (DNS) | IT / Marketing (Wix DNS). |
| B-5 | Contract consumer: `fa4-precision-context/1` has no consumer on this line. | PENDING INTEGRATION | Architecture (L1 convergence). |

Non-blocking findings: no uptime check (15); temporary brand lockups (16); no catalog admin UI (4); the closed-test reviewers' addresses are not configured (19).

## 3. Result
No mock and no simulation reaches the production runtime (items 1–3, 5–9, 13–14 are REAL; the only simulated path, 18, is unreachable there). The commercial runtime is **not** blocker-free: B-1…B-5 are external or architectural and are not resolved by this batch.
