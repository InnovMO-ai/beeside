# FA Public v1.0 (module `fa4`)

Public, free, **deterministic** First Assessment: `user input → deterministic rules → conditional data → applicable topics (fronts) → capability routing → coverage logic → Your Expansion View`. No runtime AI; every customer-facing conclusion traces to *declared data → rule → result* (each resolved need carries a `trace`). It is **isolated from the legacy First Assessment** (no Snapshot, radar, scoring, Level 2, question bank or rules engine are reused).

Source of truth: the canonical beeside_FA4 documentation (`00_CONTROL`, `01_PRODUCT`, `02_PROVE/PROVE-04`, `03_DESIGN`) and the frozen Journeys A / B / C. Product decisions made while building are in `DECISION_LOG` D-122 … D-134.

## Where things live
| Layer | Path | Notes |
|---|---|---|
| Engine (pure TS, no I/O) | `shared/fa-public-engine` | domain · catalog model · front activation · coverage resolver (`coverage_basis`, I-26) · YEV builder · Demand Signals · conditional flow. CJS + ESM build; `/seed` and `/testing` sub-paths are server/test-only (the seed carries internal partner references and must never reach a browser bundle) |
| API | `backend/src/fa4` (`/api/fa4`) | Express routes over the shared `Db` abstraction; off unless `FA4_API_ENABLED=true`; reuses the existing rate limiter (`rate_limit_counter`), `EmailTransport`, token helpers and HTTP hardening |
| Persistence | `backend/db/schema/fa4.ts`, migrations `0015` (tables) + `0016` (integrity triggers) | PostgreSQL via Drizzle. Delivered results and catalog versions are append-only (D-117) |
| UI | `frontend/src/fa4` (route `/fa4`) | Vite + React 18. Loads its own stylesheet; the legacy `styles.css` is not loaded on `/fa4`. Components `YourExpansionView`, `BeesideValueSection`, `PremiumContinuation` are independent and composed by `ResultScreen` |
| Copy gate | `docs/fa4/COPY_INVENTORY.md`, `scripts/fa4-copy-inventory.js` | `NC('<id>', es, en)` marks NEEDS_CANONICAL_COPY; CI fails if the inventory drifts |

## Why `fa4_*` tables instead of `project` / `email_delivery`
`project` pins legacy question-bank / rules / snapshot-template versions through triggers and `email_delivery` only accepts legacy templates, so FA 4.0 owns `fa4_project` (its `project_id` is the continuity anchor for a later platform-wide unification). Reused as-is: `Db`, `RateLimiter` + `rate_limit_counter`, `EmailTransport` (+ idempotency key semantics), `generateAccessToken` / `hashAccessToken`, `securityHeaders` / `originGuard`, the worker process.

## Run it
```bash
npm ci
# PostgreSQL 16 (disposable!), then:
DATABASE_URL=postgres://… npm run db:migrate --workspace=backend
DATABASE_URL=postgres://… npm run fa4:seed-catalog --workspace=backend      # first PUBLISHED catalog version (idempotent)
FA4_API_ENABLED=true DATABASE_URL=… APP_BASE_URL=http://localhost:5173 DEV_LOG_EMAIL_LINKS=true npm run dev --workspace=backend
npm run dev --workspace=frontend                                            # open http://localhost:5173/fa4
```

## Verify
```bash
npm run typecheck && npm run lint && npm run build && npm test                # engine (jest) + backend (jest) + frontend (vitest)
TEST_DATABASE_URL=postgres://…/disposable npm run test:integration --workspace=backend     # real PostgreSQL, rolled back
# runtime-role / abuse / concurrency suite (committed data → its own database; a LOGIN role that is a member of beeside_runtime_role):
TEST_RUNTIME_ADMIN_DATABASE_URL=postgres://owner@…/fa4_rt TEST_RUNTIME_DATABASE_URL=postgres://beeside_runtime:…@…/fa4_rt npm run test:integration --workspace=backend
E2E_DATABASE_URL=postgres://…/empty_disposable E2E_RUNTIME_DATABASE_URL=postgres://beeside_runtime:…@…/empty_disposable npm run test:e2e --workspace=frontend       # real stack at 375 px and 1440 px
npm run fa4:copy-inventory:check
```

## Launch blockers (configuration points — not Build blockers)
`frontend/src/fa4/brand.ts`: BRAND-1 logo · BRAND-2 typography · BRAND-3 lifestyle image / Night Shift · CHK-1 Terms and Privacy URLs (`VITE_FA4_TERMS_URL_ES|EN`, `VITE_FA4_PRIVACY_URL_ES|EN`, new tab) · LEGAL-1 (no commercial-contact consent control is rendered).
Email delivery needs a real provider behind `EmailTransport` (development logs / captures). FA4 email wording (`backend/src/fa4/email.ts`) is NEEDS_CANONICAL_COPY.

## Security & privacy model (VERIFY fix pass)
- **Least privilege.** The application connects as a member of `beeside_runtime_role`: SELECT/INSERT/UPDATE only, **no DELETE anywhere**, and additionally no UPDATE on the append-only tables (`fa4_result`, `fa4_catalog_version`, `fa4_catalog_change`, `fa4_legal_acceptance`, `fa4_privacy_erasure_log`). Demand Signals are never deleted: still-demanded signals are UPSERTed under a stable semantic id (`ds:{project}:{destination}:{cap:…|need:…|text:…}`, owner/sourcing/triage preserved), vanished demand is *superseded* (`superseded_at`) and revived if it returns.
- **Catalog.** `fa4_catalog_entity.data` is the effective PUBLISHED record; drafts live in `draft_data/draft_status` and never alter it. Publishing takes a transaction-level advisory lock, reads the latest immutable version *after* the lock and applies only that capability onto it. `/api/fa4/catalog` returns only Front names and a flattened keyword index. Capability / coverage resolution runs server-side (`POST /api/fa4/session/resolution`, session-authenticated) and returns just the coarse facts for that project — the browser never receives the capability × country matrix, capability states, provider / Business Check status or sourcing data. `shared/fa-public-engine` is a dual package (`dist/esm` marked `type: module` with explicit extensions, `dist/cjs` marked `commonjs`); `module-boundary.test.ts` guards it.
- **Resume links.** Project-specific, single-use (atomic `UPDATE … RETURNING`), revoked when a replacement is issued. An email alone never opens a project: "resume by email" queues one project-specific link per project (max `FA4_RESUME_PROJECTS_PER_REQUEST`, default 3) to the stored address only, always answering `{ok:true}`. Limits (configurable, `FA4_RL_<NAME>="<limit>/<windowSeconds>"`): per origin, per email, per email+origin, plus `FA4_EMAIL_RECIPIENT_DAILY_QUOTA` (default 6 emails / address / 24 h) and the resend cooldown (`EMAIL_RESEND_COOLDOWN_MINUTES`).
- **Legal-acceptance evidence.** `fa4_legal_acceptance` (append-only; Terms and Privacy are separate rows: project, document, accepted_at, document version, document URL, language; no IP / other personal data). Values come from `FA4_TERMS_VERSION`, `FA4_TERMS_URL_ES|EN`, `FA4_PRIVACY_VERSION`, `FA4_PRIVACY_URL_ES|EN`; in production the API refuses to start without them (LEGAL-1 / CHK-1 remain launch blockers). Email and the two acknowledgements are pinned after creation.
- **Authorized purge / anonymization (M3).** `SELECT fa4_anonymize_project('<project uuid>', '<actor>', '<reason>')` — SECURITY DEFINER, `EXECUTE` is *not* granted to the runtime role (only the migration/owner role, i.e. a data-protection operator, can run it). It replaces personal data (email, answers, result model, signal payloads), revokes tokens, sets status `ANONYMIZED`, keeps the non-personal structure and the legal-acceptance evidence, and writes `fa4_privacy_erasure_log`. The append-only triggers allow exactly this path (a transaction-local setting honoured only for non-runtime roles). **Configuration point:** the retention period is a business/legal decision and is *not* defined here; no automatic purge is enabled. When a period is approved, schedule an operator-owned job that calls this function for projects older than the period.
