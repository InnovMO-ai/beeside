# Precision Center V2.0 - Product QA on the live stack (F5 Track A)

Date of the runs: 2026-10-09 to 2026-10-10. Author: QA-LIVE.
Commit under test: `4be394fbbd69bc6f2f0ad2eea1b34c1b1a8c1b19` (branch `feature/precision-v2-f5`). **The changes made by this QA pass are NOT committed**; they are in the working tree for the lead to commit (file list in section 8). Every result below was produced by a command run in this pass against the working tree, unless a line says otherwise.

**Embassy Ready is not declared.** The Design Proof v3.3 is not accessible to this team (WI-1 is OPEN), so the visual comparison against it was not done. Everything else below is a product-quality result against a simulated environment (section 3).

## 1. Result at a glance

| Gate | Result | Evidence |
|---|---|---|
| G1. No CRITICAL or MAJOR defect open | PASS (after fixes) | Two MAJOR defects found and fixed (D-1, D-2), plus one MAJOR content defect fixed earlier by COPY. None open. Section 5 |
| G2. No broken action (every button, link and card does what it says) | PASS | Journey A-J typed literally, 4 viewports x 2 languages; keyboard-only path; double click; leave and return. Section 4 |
| G3. Copy gate (tuteo, canonical names, no exclamations, no internal terms, no superseded copy) | PASS with open content items | Static sweep and route tests green; live grep of every API body and every screen for forbidden terms; bundle grep. Open: CI-5, CI-9 to CI-13 (PO decisions, section 6) |
| G4. Comparison with the Design Proof v3.3 | **OPEN, NOT DONE** | WI-1: the proof is not accessible. Not claimed |
| G5. Desktop and mobile journeys (light and dark) | PASS | `acceptance.live.spec.ts`, 17 passed, 3 skipped by design (print on one project) |
| G6. Process questions P-01 and P-02 | PASS | `process-surfaces.live.spec.ts` (60 questions on 3 surfaces x 2 languages), `process.live.spec.ts`, `acceptance.live.spec.ts`. D-5 and D-6 found and fixed |
| G7. Synthetic end-to-end through the real entry point | PASS | `real-stack.live.spec.ts` against the production backend build and production static server: 24 of 24 test/project combinations passed (one first-run failure was the rate limiter, section 4.4) |
| G8. Error experience (18 cases, E1-E18) | PASS | `errors.live.spec.ts`, desktop-light and mobile-dark, all green; screenshots looked at |
| G9. Security sweep | PASS | `security.live.spec.ts` (9 tests x 4 viewports), `injection.live.spec.ts` (12), real-stack rate limits, `access.int` (18) |
| G10. Accessibility | PASS | `a11y.live.spec.ts`: axe on about 20 screens and states x 2 languages x 4 viewports, touch targets, keyboard-only, reduced motion |
| G11. Performance (our code and database only) | PASS, with the provider part NOT measured | `docs/f5/qa/performance-2026-10-09.md`, re-run on 2026-10-10 |
| G12. Concurrency (one business effect each) | PASS | `concurrency.live.spec.ts`, 7 tests, repeated 5 times with no failure |
| G13. No real data, no real provider, no real money | PASS | Synthetic project only; scripted model; simulated Operation Hub; fixture entitlement. Section 3 |
| G14. No unverified country or legal claim | PASS | Static sweep rule R10 plus live scan; "I can't confirm that" plus a pending item otherwise |
| G15. No visible internal terminology | PASS | `scanForbidden` over every API body and page text in every live spec; bundle grep clean |
| G16. No legacy (FA 3.0 push, beta, payment gating) reliance | PASS | Product-code grep (`security.live`, strict, no exceptions since D-9); entitlement read only through the port |
| G17. Real model quality and real Operation Hub | **OPEN** | Not testable here. Section 7 |

## 2. Method and exact commands

All commands were run from `/home/claude/work/beeside` with `export NO_PROXY= no_proxy= npm_config_noproxy=` first. PostgreSQL 16 on localhost (role `beeside`). Chromium from `/opt/pw-browsers`.

| What | Command | Result (this pass) |
|---|---|---|
| Real stack | `scripts/precision-live-stack.sh up --reset --stage=start` (backend `dist/index.js` on :18080, production static server on :14180, database `beeside_qa`). Rebuilt after the last backend change | up; stopped at the end with `down` |
| Backend types | `cd backend && npx tsc --noEmit` | exit 0 |
| Backend unit | `cd backend && npx jest` | 52 suites passed; 1565 tests passed, 8 skipped (pre-existing skips) |
| Backend integration | `/tmp/qa/run-int-all.sh`: one suite per fresh, migrated database (`jest -c jest.integration.config.js --runInBand <suite>`) | 22 suites run. 17 passed, 4 failed, 1 fully skipped. See below |
| SQL guard tests | `psql -v ON_ERROR_STOP=1 -f backend/db/tests/precision/run_precision_tests.sql` on a fresh migrated database | exit 0, 208 PASS lines, ROLLBACK, no failure |
| Frontend types / lint / unit / build | `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build` | clean / clean / 23 files, 143 tests passed / built |
| Mock Playwright suite | `npx playwright test -c playwright.precision.config.ts` | 249 passed, 6 skipped by design, **1 failed** (see below) |
| Live Playwright suite (real backend, real database, production build of the frontend, 4 projects: desktop and mobile, light and dark) | `npx playwright test -c playwright.precision-live.config.ts` | **182 passed, 110 skipped by design, 0 failed** (11.6 min) |
| Real stack spec | `PRECISION_REAL_STACK=1 PRECISION_LIVE_REUSE=1 npx playwright test -c playwright.precision-live.config.ts real-stack` | 18 passed, 1 failed (rate limiter, below); then mobile-dark alone 5 passed plus its rate-limit test 1 passed |
| Performance | `PRECISION_PERF=1 PRECISION_LIVE_REUSE=1 npx playwright test -c playwright.precision-live.config.ts perf --project=desktop-light` | 5 passed; numbers in the performance document |

Skips by design in the live suite (110): error-experience tests run only on desktop-light and mobile-dark (40), the real-stack and performance specs need their environment flag (24 and 20), concurrency checks are API level and run on one project (21), keyboard-only is a desktop test (2), the print test runs on one project (3).

Integration suites (each on its own fresh database): registry-publish 8, admin 3, analytics-feedback 5, config-versioning 3, e2e-journey 5, fa4 19, integrations-security 6, oh-delivery 23, premium 5, stripe 20, access 18, journey 15, reliability 13, crp-lifecycle 15, crp-send 19, route-rehearsal 6, seed 5: all passed. `fa4-verify` is skipped as a whole (24 tests, needs its own environment). Four suites fail and are **not Precision**: `fa-core` (expects rules snapshot `st-1.0.0`, gets `st-1.1.0`), `fa-lifecycle` (a continue link answers 404), `operations` (e-mail count 3 against 4), `rules-snapshot` (expects `re-1.0.0`). They are unrelated to Precision (confirmed earlier in this pass); they belong to the FA core and are listed here so nobody reads them as new.

Two honest runtime notes. (a) In the integration batch `fa4.int` reported a suite-level failure with zero tests while other work was running on the machine; it was re-run on its own on a fresh database and passed 19 of 19. (b) In the mock Playwright suite one test (`errors.spec.ts` "session lost in the middle", mobile-dark) hit the 90 s timeout once; run again alone, 8 of 8 passed (2 repeats x 4 viewports). I treat it as a one-off hang under load, not as proven flaky or proven healthy.

Journey tests type the answers literally as the Product Owner would (`docs/f5/demo-route.md`, steps A-J), look at the screen after each step (screenshots below), and assert on the real API traffic.

## 3. Simulation boundary

What is real in these runs: the production frontend build (live mode, no mock code in the customer path), the production static server with its security headers and Content-Security-Policy, the real Express backend (the QA server for the spec suite; the production `dist/index.js` for the real-stack spec), real PostgreSQL with the real migrations and guard SQL, the real manifests, readiness and conversation engines, the real delivery service (idempotency, retries, read-back).

What is simulated, and therefore not verified: the model (a scripted provider, about 0 ms, understands a fixed vocabulary), Operation Hub (an in-process simulator), the entitlement (fixture ACTIVE, with FULL, READ_ONLY and REVOKED variants driven through the real provider port), the First Assessment context (fixture), the identity link (a one-time link minted by the seed). The company in the screens is the synthetic "Northwind Foods Ltd". No real person, company, credential or payment was used. Stripe is Track B; its status is in `docs/f5/stripe-track-status.md` (IN BUILD, sandbox not verified) and the Precision side of it is covered by `access.int` and the entitlement cases of the error suite.

## 4. What was verified, by area

### 4.1 Product acceptance journey (steps A-J)
`acceptance.live.spec.ts`: Cover, Center, Precision Understanding (inherited-value cards, typed answers, AI notice exactly once), My Service Map draft then confirm dialog then confirmed, Center with categories, Logistics with P-01 and P-02 asked in the middle of the questions, quick replies, "I don't know yet", CRP review with the full name spelled out once, Request changes dialog, Confirm CRP, Preview, Send (double click: one delivery), Sent, back to Center. A second test covers what happens outside the route: correcting an answer, "I don't know yet", skip, free text, another category, Add a Service, and leaving the route and coming back. A print test renders My Service Map, CRP and Preview to PDF and checks the text. 4 viewports x 2 languages, all passed.

### 4.2 Process questions P-01 and P-02
60 questions (3 surfaces x 2 languages x 10) leave the project untouched and resume the pending question. Plausible phrasings about skipping, pausing and confidentiality are answered as process questions and write nothing (regression kept). Defects D-5 and D-6 came from this step.

### 4.3 Error experience
18 cases through the real backend with faults injected per project at the provider seams (never a product branch): AI unavailable, staged waiting and a long wait ("your answer is saved"), reload during processing, offline during use and at load, First Assessment context down, read-only and revoked access, Send rejected, Send timeout with read-back, corrupt answer, stale preview, duplicate click, first-send-required rule, link missing or used, session revoked and expired. Each case asserts: no lost work, no duplicate effect, no technical text on screen, a clear way to recover. Screenshots of the refreshed run were looked at for desktop-light and mobile-dark (E1, E3, E4, E9, E10, E13, E15, E16).

### 4.4 Security
Token lifecycle (one use, expiry, revocation takes effect immediately), nothing to enumerate (a used, made-up and absent code answer the same way), cross-project access answers 404 and changes nothing, hostile and oversized bodies give structured answers without stack traces or driver text, origin guard on state-changing requests, internal status route absent without the key (404 with and without a wrong key; 200 with the key and free of secrets), security headers and zero CSP violations in the browser, no tokens or keys in the server logs or the static server log, product-code grep for demo or presentation switches (strict, no exception), bundle grep of the live build (no key patterns, no internal key value, no mock or Northwind, no source maps). Rate limits on the real stack: RATE_LIMITED with a friendly message and a wait time. Markup and prompt injection inside answers (EN and ES): shown as text, never executed, nothing confirmed, sent or written outside the question being asked.

Note on the limiter: the rate-limit counters are stored in PostgreSQL (`rate_limit_counter`, defect D-14 of the earlier part of this pass, in HEAD) and therefore survive a restart of the stack. After the real-stack rate-limit test the exchange limit (30 per 10 minutes per address) blocks further code exchanges on the real stack for up to 10 minutes. This is the reason for the one 429 in the real-stack run; I cleared the counters of the QA database and re-ran. It is correct behaviour; it matters only to whoever runs the suite twice in a row.

### 4.5 Accessibility
`a11y.live.spec.ts`: axe (WCAG A and AA rules; zero serious or critical findings required; colour contrast is part of it in the dark projects) on Cover, Center in each state, Understanding, My Service Map (draft, confirm dialog, confirmed), category, CRP (review, dialogs, confirmed), Preview, Sent, Help, Add a Service and the access and error pages; touch targets of at least 44 px on every mobile screen; status chips always carry an icon and a word, never colour alone; no horizontal overflow; reduced motion honoured (no animation or transition above 20 ms); keyboard-only path from the skip link through Cover, Center and Understanding to a confirmation and the composer, with a visible focus indicator on every stop and no keyboard trap. The keyboard test was first written wrongly (it matched the page heading as the "Start" button and treated the end-of-page wrap as a missing focus ring); both were test mistakes, fixed in the test, not in the product; the test now passes 3 of 3 on both desktop projects.

### 4.6 Performance
See `docs/f5/qa/performance-2026-10-09.md` (re-run). Our code and database: desktop cold load p50 411 ms (14 requests, 327 KB), 51 conversation turns p50 32 ms and p95 53 ms, CRP, Preview and Send API calls 9 to 21 ms p50. Mobile throttled (1.6 Mbit/s, 150 ms RTT, CPU x4) cold load p50 2213 ms, bandwidth bound. **Not measured: real model latency and real Operation Hub latency**, which dominate a free-text turn and a Send in production.

### 4.7 Concurrency
`concurrency.live.spec.ts` (real database): the same turn key 8 times at once is stored once; 6 different answers at once on one category give no server error and no duplicated row; 12 simultaneous CRP confirms (6 with one key, 6 with different keys) give one confirmed version; 10 simultaneous Sends of one preview give one delivered key, one delivered row and one call to the platform; one inherited-value card token used 6 times at once is accepted once and refused 5 times with a plain, retry-free message (HTTP 400, not 5xx); My Service Map confirmed 6 times from 2 sessions gives one confirmation and no duplicated category; a double click on a confirmation card in the browser gives one confirmation and no alert. Repeated 5 times: 35 of 35 passed.

## 5. Defects found in this pass

Severity scale: BLOCKER, MAJOR, MINOR, CONTENT, EXTERNAL DEPENDENCY. "Fixed" means fixed in the working tree and verified by the commands in section 2.

| Id | Sev | Defect | Resolution |
|---|---|---|---|
| D-1 | MAJOR | Seeded stages `map_confirmed` and `logistics_ready` had no `map_needs` facts and no `destination_codes` in the confirmed snapshot. The live map was empty and the Center said the map had unconfirmed changes, sending the presenter to "Review My Service Map". | Fixed: seed records the needs and the destination in the snapshot (`seed/demo-project.ts`); the destination comparison in `service-map.ts` runs only when the snapshot has the field. Verified on the real stack: no unconfirmed changes. |
| D-2 | MAJOR | Preview showed every block twice (flat lines and the structured view) and the project facts three times. | Fixed in `Preview.tsx`, `ServiceMap.tsx`, `Crp.tsx` (compact mode hides the duplicate summary); new line "Nothing to add here." / "No hay nada que agregar aquí." for an empty block. |
| D-3 | MINOR | CRP requirement rows: the value column was misaligned. | Fixed in `precision.css`. |
| D-4 | MINOR | Center showed "N critical items open, N pending items" on categories not started. | Fixed in `Center.tsx`. |
| D-5 | MAJOR | A bare "skip" or "omitir" typed as an answer was recorded as the value (for example the operating entity "skip"). | Fixed in `conversation/answer-state.ts`: a bare skip is an UNKNOWN signal (pending item); a sentence that merely contains "skip" is not read as a skip. 7 tests added (EN and ES). |
| D-6 | MINOR | "I don't understand" and "what do you mean" looped on "I need to clarify that answer". | Fixed in `process-knowledge/router.ts`: routed to the "why this question" topic. 8 tests added. |
| D-7 | MINOR | Mobile document view: the sticky header wrapped to two rows and the action bar stacked three buttons. | Fixed in `precision.css` (single-row header, chevron-only back link with the text kept for screen readers, quiet back button hidden in the bar). Screenshots looked at. |
| D-8 | MINOR | Print: dark backgrounds, grid fragmentation made text overlap across pages, the "not sent" box was clipped. | Fixed in the print block of `precision.css`; the PDFs of Preview, CRP and My Service Map were rendered and looked at. |
| D-9 | CONTENT / MINOR | CI-7: the word "Embassy" in `category-labels.json`; plus the lane fixture branch (`DEMO_SCRIPT_FIXTURE`) and a "demo" environment variable name in product wiring. | Fixed: wording changed; branch removed; switch renamed `PRECISION_FIXTURE_PROJECT`; the security spec no longer tolerates any exception. |
| D-14 | MAJOR | Rate-limit counters were not shared across instances or restarts (details in the earlier part of this pass; the performance document records the PostgreSQL store). | Fixed earlier in this pass (PostgreSQL store, `rate_limit_counter`); the change is in HEAD, not in the working tree. Its behaviour was re-verified by the real-stack rate-limit test in this pass. |

Defects found by my own tests that turned out to be test mistakes (not product defects, fixed in the tests): keyboard-only spec (section 4.5); the concurrency spec's use of the simulator's global stored counter (it counts all projects, so it is no longer asserted; the per-project counters are).

No BLOCKER was found. No MAJOR is open.

## 6. Open items (not defects of the build; decisions or supply from the Product Owner)

| Id | Type | Item |
|---|---|---|
| WI-1 | EXTERNAL DEPENDENCY | Design Proof v3.3 is not accessible. The visual comparison (G4) is NOT DONE. Screens were checked for internal consistency, accessibility and brand tokens only. |
| CI-12 | CONTENT / EXTERNAL DEPENDENCY | Approved copy "We will let you know as soon as you can enter" (Center and Sent) promises a notification, and no notification channel exists in this release candidate. Confirm the promise or approve a wording without it. The real access path to Operation Hub is also not verified (simulator). |
| CI-5 | CONTENT | "Strategic Advisory" stays in English in the Spanish interface. Confirm or give the Spanish name. |
| CI-8 | CONTENT | "Is my information confidential?" has no approved answer; the product says it cannot confirm it and keeps a pending item. A legal or privacy statement is needed before launch. |
| CI-9 | CONTENT | After Understanding is complete, a process question receives "I have what I need to put together your My Service Map..." even when nothing is left to skip. One line of context is proposed. |
| CI-10 | CONTENT | The pending question and the inherited-value card are repeated after a process answer. Check against the Design Proof (see WI-1). |
| CI-11 | CONTENT | The CRP eyebrow and title both spell out "Category Requirement Pack (CRP)". The eyebrow is enforced by a test; decide whether the title should say "CRP" only. |
| CI-13 | CONTENT | After "Request changes" the category stays "For your review"; `demo-route.md` says "In progress". Align the document or the label. |
| P-1 | DECISION | Customer-facing support channel for "Contact beeside" (the destination and a response expectation are not defined in the sources). |
| P-2 | DECISION | Pack status: Process Knowledge topics are served as "draft"; the new `pause_and_resume` topic and reworded sentences need approval before "approved" (see the copy review). |

CI-4 ("Add a Service" in Spanish) is not a defect: it is a canonical name that is never translated. CI-1, CI-2, CI-7 are closed (see `copy-issues.md`).

## 7. Remaining risks

1. **Scripted model limits.** The scripted provider understands a fixed vocabulary. Free text such as "Yes, some of the products are food..." is not understood; multi-field extraction can overwrite the destination from the objective text; text that is not recognised as a question can become the objective; in Spanish Add a Service the confirm card can echo the client's own text (harmless, it needs a confirmation). None of these says anything about the real model. **The quality of a real model, and the zero-data-retention gate for it, are not covered by this QA.**
2. **Provider latency** (real model, real Operation Hub and its rate limits) is not measured. The app shows honest staged waiting copy and an "answer is saved" state after 15 s, covered by the error suite.
3. **`GET /center`** evaluates each category separately (about 6 to 7 queries per category). 15 ms at 4 categories; expect roughly 4x the queries with the full 17. MINOR debt, not fixed.
4. **Single-use card token** answers a second use with HTTP 400 and the plain message "We could not read that request. Check it and try again." The browser prevents it (double click gives no alert), but another client could show it. A 409 with a "that was already confirmed" message would be kinder. MINOR, not changed.
5. **Four integration suites** of the FA core fail (section 2). They are outside Precision and not touched.
6. **Manifest hash**: label changes of the copy pass changed the content hash of eight bundled manifests. If any was published to a shared environment it must be republished.
7. **Print**: verified in Chromium's PDF output only.

## 8. Files changed by this QA pass (uncommitted)

Backend: `backend/src/precision/conversation/answer-state.ts`, `conversation/process-knowledge/router.ts`, `conversation/__tests__/turn-engine.test.ts`, `conversation/__tests__/process-knowledge.test.ts`, `domain/seed/demo-project.ts`, `domain/seed/index.ts`, `domain/service-map.ts`, `domain/deps.ts`, `api/wiring.ts`, `manifest/data/category-labels.json`.
Frontend: `frontend/src/precision/precision.css`, `i18n/en.ts`, `i18n/es.ts`, `screens/Center.tsx`, `screens/Crp.tsx`, `screens/Preview.tsx`, `screens/ServiceMap.tsx`.
Tests (new): `frontend/e2e/precision-live/acceptance.live.spec.ts`, `process-surfaces.live.spec.ts`, `injection.live.spec.ts`, `a11y.live.spec.ts`, `concurrency.live.spec.ts`. Tests (changed): `real-stack.live.spec.ts` (browser journey per language), `security.live.spec.ts` (strict grep).
Scripts and docs: `scripts/precision-live-stack.sh` (untracked, uses `PRECISION_FIXTURE_PROJECT`), `docs/f5/qa/product-qa-2026-10-09.md` (this file), `docs/f5/qa/performance-2026-10-09.md`, `docs/f5/qa/copy-issues.md`.
No test was weakened to obtain a green result; the only assertions loosened are the two test mistakes named in section 5.

## 9. Screenshots (all looked at; synthetic data)

Root `/tmp/precision-live-shots/<viewport>-<theme>-<locale>/` (viewport desktop or mobile, theme light or dark, locale en or es). Journey: `acc-01-cover.png` to `acc-17-category-after-send.png` and `acc-20` to `acc-25` (outside the route). Earlier journey set: `01-cover.png` to `20-help.png`, `A1` to `C8`, `P1`. Errors: `E1-ai-unavailable.png` to `E18-session-expired.png`. Real stack: `real-<locale>/` and `real-stack-understanding.png`. Print: `desktop-light-en/print-service-map.pdf`, `print-crp.pdf`, `print-preview.pdf`. Full-page captures show the sticky bars and the sidebar in the middle of the page; that is a capture artefact, not a layout defect. These files are in `/tmp` and are not part of the repository.
