# Discovery Public v1.0 — Final Release Audit (Code)

Audited build: PR #6 `feat/fa4-launch-config`, base HEAD `07c6368` plus the audit commit that carries this file. Production was not touched; PR #6 was not merged.

## 1. Staging

**NOT REDEPLOYED — execution blocker.** `gcloud` answers `Reauthentication failed. cannot prompt during non-interactive execution` (active account `mo@beeside.you`). Required, interactive, by a human:

```bash
gcloud auth login
```
then, from the repo root at the commit to verify:
```bash
bash staging/fa4-internal/deploy-gcp.sh
```
(tag = short commit SHA; the Cloud Build file now also passes `VITE_FA4_ALLOW_PURCHASE_FALLBACK=true` so the staging build keeps the no-payment confirmation; pass `_PURCHASE_URL` to test a real destination). Last deployed staging build is still backend `fa4-staging-backend-00018-zzp` / web `fa4-staging-web-00009-4s7` (commit `afe8786`, **pre-Public-v1.0**). Revision names and the deployed SHA of the current build cannot be reported until that is done. **No staging verification is claimed.** Everything below marked LOCAL was run against the production-built stack (PostgreSQL → Express `dist` → static server → Chromium) on this machine. `e2e/release-smoke.spec.ts` can be pointed at staging (`baseURL`, `E2E_BASIC_AUTH`) once deployed.

## 2–3. Smoke and visual verification (LOCAL, not staging)

| Check | Result |
|---|---|
| Cover, ES + EN journeys to the YEV at 320/360/375/390 | pass (`small-viewports.spec.ts`) |
| Save/resume, email-result, YEV link, contact | pass (existing e2e + `fa4-rc` integration) |
| Preview editable («Corregir algo»), regenerate | pass (`release-smoke`) |
| Email-result delivers once, locks editing (API 409) | pass |
| Start Your Expansion: confirm → delivered, locked, survives reload, no «Corregir algo» | pass |
| Next-step title: one country / several / open | pass (e2e + unit). **Open/undefined destination never reaches Premium** (`premium.shown = false`, D-050): the generic title is implemented and unit-tested but not reachable with the frozen engine, except mixed «one defined + open» → «tus mercados objetivo» |
| No-premium scenario (no CTA, email option stays) | pass |
| Naming (no First Assessment / FA / FA4 in UI and emails) | pass (e2e text scan ES+EN, email render test) |
| Terms / Privacy / Help hrefs | pass: `https://beeside.you/termsandconditions`, `https://www.beeside.you/privacy`, `https://www.beeside.you/helpcenter`, new tab + `noopener` |
| Canvas `#F6F2EF`, white card/comparison, brand lines, privacy copy | pass (asserted) |
| Hero 375/768/1024/1200/1440/1680/1920: decoded, covers box, natural aspect (no distortion) | pass; screenshots in `docs/fa4/visual/discovery-v1/` |
| axe (WCAG 2.1/2.2 AA **with colour contrast**) cover/question/YEV/confirmation, 320/375/768/1440, ES+EN | pass (`a11y-audit.spec.ts`, 8 tests) |
| Keyboard: Tab order reaches Continuar, focus indicator on every stop, tap targets ≥ 44 px | pass |
| Visual compare to frozen Design by eye | done only at 375 and 1440 on screenshots; **not** against staging |

## 4. Premium purchase destination — **RELEASE BLOCKER (EXTERNAL / PRODUCT INPUT)**

Verified: key `VITE_FA4_PREMIUM_PURCHASE_URL`; https only (`http://`, `javascript:`, `//host`, empty are rejected — 5 unit cases); no URL hardcoded (source scan: no stripe/pay hosts); nothing appended to the URL (no project, email or result data); failed delivery never navigates; configured URL → `window.location.assign`.
**Defects found and fixed in this audit (Code-controlled):**
1. The container build could not receive the variable (`frontend/Dockerfile` only exposed three VITE args). Added `VITE_FA4_PREMIUM_PURCHASE_URL` and `VITE_FA4_ALLOW_PURCHASE_FALLBACK` build args.
2. A public build without a destination silently fell back to the Sherpa / «Todavía no hay ningún pago» confirmation. Now **fail-closed**: in a production build without the destination and without the explicit staging opt-in the CTA is not rendered. Unit-tested.
Open: no approved destination exists → blocker. How the payment system correlates `project_id/result_id` (no params are sent) is for whoever supplies the destination.

## 5. Commercial comparison — **RELEASE BLOCKER (pending Product/Legal)**

A. Visible claims (EN reference / ES as shown), `UI.cmp*` in `frontend/src/fa4/copy/ui.ts`:
- Title «Funding a fragmented process, or buying coordinated capability».
- Option A **beeside Premium — Coordinated system — 8 of 8 capabilities**; B Hire one local person — «One skillset, one point of view» — **0 of 8**; C Office + one person — «Fixed overhead added» — **0 of 8**; D Office + person + travel — «Highest cost, still fragmented» — **0 of 8**.
- Eight dimensions: Multi-service activation, Specialist access, Project visibility, Coordination, Curated ecosystem, Continuity, **24/7 digital platform access**, Centralized documentation.
- Relative «Complexity» bars (0.18 / 0.45 / 0.70 / 0.97) and the note: dimensions of coordinated capability only, not a judgment of people/offices nor a cost figure, no amounts shown, illustrative, not a guaranteed-price claim.
B. Source: **only** the Design artifact `Claude outputs/DISCOVERY_V1_VISUAL_DELTA.patch` (EN = «approved reference copy», ES = Design's translation proposal). No Product handoff, evidence or Legal review that substantiates the claims exists in the project folder (searched).
C. Code invented nothing: the patch was applied unchanged and these strings were not edited afterwards.
D. Pending Product/Legal validation; no sign-off is documented → blocker. Notable exposure: absolute «0 of 8» for every alternative, and «24/7 digital platform access» (a platform capability that Product/Legal should confirm exists for the offered service at launch).

## 6. Privacy promise — verified, no blocker today

Wording (ES/EN) is applied in the UI and the YEV email. Evidence: the FA4 backend makes **no outbound HTTP call** (no fetch/axios/webhook); its only egress is e-mail to the person and to `contact@beeside.you` (beeside's own mailbox; «Hablar con beeside» sends progress only when the person ticks it); demand signals live in the database and are never returned by the API (tested) and never exported; `/api/admin`, `/api/billing`, `/api/fa` do not read any `fa4_*` table (grep). So Discovery cannot share project data with providers. **Forward obligation:** Premium/Precision must add an explicit authorization step before any provider sharing; it does not exist and was not invented. The SMTP relay (Gmail) is the mail processor, not a provider in the product sense.

## 7. Legal configuration

| Item | Status |
|---|---|
| Terms URL `https://beeside.you/termsandconditions` | SET (default, overridable) |
| Terms version `1.0-2026-08-27` | SET (default) |
| Privacy URL `https://www.beeside.you/privacy` | SET (default) |
| Help Center URL `https://www.beeside.you/helpcenter` | SET (default) |
| `FA4_PRIVACY_VERSION` | **MISSING — EXTERNAL BLOCKER** (not invented; verified: with a complete SMTP config and no version, production startup refuses: «FA4_API_ENABLED requires FA4_PRIVACY_VERSION in production») |
| LEGAL-1 final legal validation | **EXTERNAL BLOCKER** |

Production-config validation run (fake values, no network): log transport refused; SMTP without password refused; `FA4_ENV=staging` on the public host refused; http `APP_BASE_URL` flagged; complete config starts.

## 8. Production infrastructure (no access to the production project from here)

| Item | Status |
|---|---|
| Production database | EXTERNAL — not verifiable (no access); migration path tested on clean DBs |
| SMTP | EXTERNAL for production; staging verified earlier with the existing secret (values never printed) |
| Email worker / outbox | READY in code (`dist/fa4/worker.js`, lease/retry/dead); deployment MISSING/EXTERNAL (`FA4_WORKER_CONFIRMED`) |
| `APP_BASE_URL` (https; also hosts `/brand/beeside-lockup.png`) | EXTERNAL — must be set to the public host |
| Secrets | EXTERNAL — Secret Manager names exist for staging; production not verifiable |
| DB migrations job | READY (`src/scripts/migrate.ts`, separate role; runtime refuses `MIGRATION_DATABASE_URL`) |
| Environment variables | READY in code (validated, fail-closed); values EXTERNAL |
| Cloud Run configuration | EXTERNAL (staging script exists; production service not defined here) |
| Rate limiting | READY (DB-backed limiter, per-route limits, env overrides `FA4_RL_*`); `TRUST_PROXY_HOPS` must be set explicitly in production (enforced) |
| Logging | READY: masked e-mail, redacted paths/errors, no tokens/answers/bodies (links use URL fragments, never sent to the server) |
| Error visibility | MISSING: logs only; **no error monitoring/alerting configured** |
| Backup / restore | EXTERNAL — Cloud SQL backups/PITR not verifiable here; rollback after the first delivery is a restore, not a revision rollback |

## 9. Database / migration audit

Migration 0022: adds nullable envelope columns, `legacy_unsealed boolean DEFAULT true NOT NULL` then `SET DEFAULT false` (existing rows flagged legacy via fast default — no UPDATE on the append-only table, **no backfill from mutable answers**), partial unique index (one sealed result per project), sealed-envelope CHECK, and a status correction (DELIVERED without a sealed result → IN_PROGRESS). Migration 0023: delivered-answers lock (BV604), deferred consistency triggers (BV605, BV606), updated `fa4_anonymize_project` (scrubs `model`, `source_snapshot`, `resolution_snapshot`). Verified by integration tests under real commits and the runtime role: clean migration, legacy rows ineligible (Precision NOT_FOUND, continuation BV606, not «the delivered result», project stays editable), immutability (runtime has no grant; owner hits BV601), erasure scan of every `fa4_*` table. One observation: a legacy row whose project already had a continuation request keeps that historical pointer (data, not rewritten).
**Production assumption («no pre-v1.0 FA data») is NOT verified** — no access to the target environment from this session; classify as EXTERNAL until someone runs `SELECT count(*) FROM fa4_result` (and `fa4_project`) on the target. If rows exist the migration is still safe (they become flagged legacy).
Rollback limits (accurate): a Cloud Run revision rollback is safe only before the first sealed delivery; afterwards only a database restore reverses the schema, because previous code cannot interpret sealed rows.

## 10–11. A+ / Precision / delivery invariants (re-run, all green)

`fa4-v1-delivery` (15), `fa4-verify` (29), `fa4.int` (17), `fa4-rc` (27) each on a fresh database; engine `precision` + `rules-golden` tests (104). Covered: snapshots immutable; catalog + rules versions pinned; `project_id + result_id` pair; mapper reads only the sealed row and is deterministic after the live project, the catalog and the rules change; declared vs derived provenance; coverage-matrix drift test; erasure; preview ≠ delivery (not Precision-eligible); both delivery paths (email-result, Start Your Expansion) idempotent under 10 concurrent clicks, editing and regeneration closed at API and DB. FA4 imports from legacy FA only four helper modules: `fa/services/tokens`, `fa/services/errors`, `fa/email/email-adapter`, `operations/email-outbox` (backoff + error sanitiser) — no legacy contract (Snapshot v1, `getFirstAssessmentPrecisionContext`) is used. **No regression found.**

## 12–13. Naming and e-mail audit

Naming: nothing visible remains. Intentionally unchanged: staff-facing «Idioma de FA / FA language» line of the internal contact email, comments, API error strings, routes, tables, env.
E-mail (render tests + `fa4-rc`): Discovery naming; exactly one `<img>` = the official full lockup served from `${APP_BASE_URL}/brand/beeside-lockup.png` (e2e proves the production static server returns a real PNG), tagline line, no repeated lower wordmark in the YEV; approved privacy sentence; every link https (or the contact mailto); no unresolved markers; no CTA button; token behaviour (shared `YEV_LINK`, scanner-safe resume confirm, revocation), Reply-To = contact@beeside.you, SMTP STARTTLS, commercial block 3-condition gate — all unchanged and still green. **Not verified:** real mail clients (Outlook, Apple Mail, Gmail app) — no evidence exists, compatibility is not claimed. **Staging caveat:** staging sits behind IAP, so the hosted logo would not load for a recipient there; the public host serves it openly.

## 14–15. Accessibility and security

Accessibility: see §2–3 (320 overflow root-caused and fixed earlier; control border token `#8A8696` = 3.54:1 white / 3.18:1 canvas). Security: `npm audit --omit=dev` → 0 vulnerabilities; tracked-file secret-pattern scan → none; SMTP password only from Secret Manager, never logged; DB least privilege + append-only protections + erasure-by-owner-function are covered by `fa4-verify` / `fa4-rc-runtime` (passing); rate limits and email-abuse controls covered by existing tests; no control was lowered.

## 16. Legacy suites — evidence

Reproduced on **`origin/main` (`bc3f527`, merge of PR #5) in a clean worktree: the same 5 suites fail identically**, so none was introduced by PR #6.

| Suite | Belongs to | Failure | Imported by Discovery? | Release impact |
|---|---|---|---|---|
| `fa-core` | legacy First Assessment (`/api/fa`) | expects `snapshotTemplateVersion` `st-1.0.0`, code emits `st-1.1.0` (stale test) | no (legacy Snapshot/Precision handoff) | NO IMPACT ON DISCOVERY V1.0 |
| `rules-snapshot` | legacy FA rules + Snapshot | same `st-1.0.0` vs `st-1.1.0` | no | NO IMPACT ON DISCOVERY V1.0 |
| `premium` | legacy Premium transition / Precision handoff of the **legacy** FA | same version string in the handoff assertion | no — Discovery's Premium continuation is `fa4_continuation_request` + `getFa4PrecisionContext` | NO IMPACT ON DISCOVERY V1.0 |
| `fa-lifecycle` | legacy FA save/resume (`/api/fa/links/*`) | `links/continue` 404 after extension | no (FA4 has its own resume/tokens; shares only token helpers, which pass) | NO IMPACT ON DISCOVERY V1.0 |
| `operations` | legacy outbox/reminders/retention | one extra e-mail in the 15-day calendar | partly: FA4 reuses `backoffSeconds` + `sanitizeDeliveryError` — both exercised and passing in FA4 suites | NO IMPACT ON DISCOVERY V1.0 |

Caveat for the release owner: the legacy FA routes are mounted in the same backend process (`/api/fa`) and run only if `FA_API_ENABLED=true`; if that product is live in the target environment its own defects remain (not a Discovery blocker, but not «fixed» either). Discovery enables only `FA4_API_ENABLED`.

## 17. Administration minimum

| Capability | Status |
|---|---|
| Catalog versioning (immutable published versions) | READY (`fa4_catalog_version`, pinned in every result) |
| Draft / publish | READY at repository level (`saveCapabilityDraft`, `publishCapability`, tested); no HTTP/UI |
| Change history | READY (`fa4_catalog_change`) |
| Capabilities + country coverage | READY as catalog data (seed script `seed-fa4-catalog.ts`) |
| Configurable links | READY: Terms/Privacy/Help/Premium-resource/purchase URL via env |
| Safe disabled state for undefined links | READY: Premium resource hidden; purchase CTA fail-closed |
| Environment-level configuration | READY, validated at startup |
| Admin console/UI for catalog, signals, erasure | POST-LAUNCH |

## 18. Post-launch update model (documentation only)

After Discovery Public v1.0: **v1.0.x** = patches/fixes; **v1.1** = backward-compatible functional improvements; **v2.0** = major product or contract changes. **No country-specific code forks:** every country deployment runs the same codebase; differences live in configuration, catalog, language, coverage and local rules/modules.

## 19. Go / No-Go matrix

| Item | State | Note |
|---|---|---|
| Product | READY | frozen; no reopen |
| Design | READY | frozen delta applied; staging render vs frozen Design not yet compared |
| Code | READY | no open Code-controlled blocker after the two audit fixes (§4) |
| Data integrity | READY | clean-DB migrations + invariants; target-environment data unverified (see Production infra) |
| A+ history | READY | |
| Precision handoff | READY | contract only; Precision itself out of scope |
| Delivery semantics | READY | |
| Naming | READY | |
| Emails | READY (code) | real-client rendering not verified |
| Accessibility | READY | axe + contrast + keyboard on the core journey |
| Security | READY | |
| Privacy | READY | promise holds today; Premium must add authorization later |
| Legal | EXTERNAL | LEGAL-1 + `FA4_PRIVACY_VERSION` |
| Premium purchase URL | BLOCKED (external input) | CTA is fail-closed without it |
| Commercial comparison | BLOCKED (Product/Legal) | no documented sign-off |
| Admin minimum | READY | broader Admin UI POST-LAUNCH |
| Production infra | EXTERNAL | DB, SMTP, worker, `APP_BASE_URL`, secrets, Cloud Run, backups not verifiable here |
| Staging | BLOCKED | current build not deployed: `gcloud auth login` required |
| Rollback | READY (documented) | restore-based after first delivery |
| Monitoring | POST-LAUNCH | none configured; logs only |
| Smoke test | BLOCKED | LOCAL pass; staging/production smoke not run |
