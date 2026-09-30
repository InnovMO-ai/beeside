# beeside First Assessment

Governing baseline: Functional Freeze v1, Design Freeze v1, the Journey, the approved Snapshot, the Master Build Guide and its Clarifications, Content & Editorial Principles v1, Brand Identity Reference v1, and **Technical Freeze v1.1 FINAL** (`technical-architecture-v1.1-final.md` + `technical-freeze-v1.1-final-candidate.md` in the project). Build sequence: `build-plan-v1.1-final.md`.

## Real current state (corrected — see note below)

`main` is at commit `b845fb1` and contains **Phases 1 through 15, implemented and closed**:

| Phase(s) | Content |
|---|---|
| 1 | Foundation & environments (repo, CI/CD skeleton, GCP scaffolding) |
| 2 | Drizzle schema, migrations, integrity triggers, actor-audited responsibility reassignment — applied and validated (**GO**) against the real `beeside-dev-508220` dev database on 2026-09-14 |
| 3 | Versioned configuration (Draft → Preview → Publish) and version pinning (`question_bank_version` / `rules_engine_version` / `snapshot_template_version`) |
| 4–6 | First Assessment core: identity, save/resume, journey engine (one-question-per-screen, pre–Level 2) |
| 7–8 | Deterministic rules engine, Expansion Snapshot, Internal Assessment |
| 9 | Premium transition, Precision handoff, subscription boundary |
| 10–11 | Admin Control Center, transactional email, access lifecycle and retention |
| 12–13 | Analytics, post-Snapshot feedback, outbound integrations (SmartSuite adapter, inert without credentials), security hardening, deployment-pipeline code (images, migration-as-a-job, runtime DB privilege separation) |
| 14–15 | End-to-end QA, accessibility fixes, production/pilot readiness documentation |

This is treated as a **frozen baseline**: Phases 1–15 are reused as-is and are not reconstructed. The only active development is additive work against the Level 2 Design Specification (below), on a separate branch, which redefines specific layers of the First Assessment journey without touching this baseline's data model, lifecycle, security, admin, analytics, or integrations.

**Correction note:** earlier versions of this README stated the repository was "Phase 1 only." That was inaccurate — it undercounted the actual implemented and committed work described above. This section replaces that claim.

Deployment reality, precisely (do not over-read this): the **dev database schema** has been applied and validated (Phase 2, GO, 2026-09-14). The **application itself** (Cloud Run services, staging, production) has not been deployed anywhere — the deployment pipeline (images, migration job, privilege-separated runtime DB user) exists as reviewed, working code from Phase 13, but the infrastructure pieces listed in `docs/deployment/README.md` (a runtime login role, a Cloud Run migration job, the worker service, API routing) are still not provisioned in any environment. Nothing here has been modified by the Level 2 MVP work.

## Level 2 MVP (in progress, branch `feature/level2-mvp-fa`, not merged to `main`)

Additive work implementing the "beeside First Assessment — Level 2 MVP" Design Specification on top of the `b845fb1` baseline: grouped compositions (0–7) replacing one-question-per-screen, progressive disclosure, a deterministic StructuredEcho parser (no AI/LLM dependency), the Needs Explorer (client-facing taxonomy mapped to the existing 10-row `capability_taxonomy_category`), priority ranking and dependency mapping, Provider Profile + Resources (including restricted-counterparty capture), a Review step, and — planned but not yet built in this pass — the Assemble transition, Virtual Snapshot, a separate PDF Snapshot, and full frontend wiring.

As of this commit: the data-model and engine layer is implemented and unit-tested (new canonical fields, two new `QuestionType`s — `tag_list` and `needs_map` — with full validators, the deterministic parser, the Needs Explorer taxonomy file, the `fa-qb-2.0.0` grouped bundle). The frontend (grouped-composition renderer, Needs Explorer / priority-ranker / dependency-map UI, StructuredEcho chip) and the Snapshot/PDF/Assemble pieces are not yet built. See the implementation report delivered alongside this change for the exact scope, what was tested, and one open product decision flagged for confirmation rather than guessed.

## Layout

```
backend/                 Node.js + TypeScript API service — First Assessment, rules engine, snapshot, admin, premium/precision handoff
frontend/                React + TypeScript client app — First Assessment journey, admin, premium screens
shared/canonical-fields/ Shared field-key/enum registry — the mechanism that prevents schema drift
infra/terraform/         Infrastructure as code: modules/ (reusable) + envs/{dev,staging,production}/
.github/workflows/       CI (build/lint/test/secrets-scan) + per-environment deploy workflows
scripts/                 secrets-scan.sh (CI + local), syntax-check.js (sandbox-only verification helper)
docs/deployment/         What is built vs. what infrastructure is still required to actually deploy (see above)
```

## Cloud provider: Google Cloud Platform (GCP)

Confirmed by Mike. The public beeside marketing site stays on Wix (not part of this repository or this cloud account). Corporate email is Google Workspace/Gmail — separate from, and not reused as, the application's own transactional email sender.

- Region: `northamerica-south1` (Querétaro, Mexico).
- Dev GCP project: `beeside-dev-508220`. Dev database schema applied and validated (see above).
- GitHub repository: `InnovMO-ai/beeside`.
- Staging and production projects are not created; production stays an empty project shell until much closer to launch, per approved scope.

## What's still needed before dev (application, not just schema) can go live

Per `docs/deployment/README.md` (Phase 13 deliverable):

- A runtime database login role for the application, distinct from the migration user (`beeside_app`) — either a password role granted `beeside_runtime_role`, or IAM database authentication for the Cloud Run service account.
- A Cloud Run job for migrations (`MIGRATION_JOB_NAME`) and a Cloud Run service (or scheduled job) for the background worker.
- The API-routing decision referenced in `docs/deployment/README.md`.

## Still needed later (not blocking, do not set up yet)

- SSO/identity provider account (Phase 10 built the Admin Control Center against it) — Google Workspace SSO is a natural fit given Mike's existing Workspace account.
- Transactional email provider account and a sending domain with DNS access (Phase 11) — a separate decision from Google Workspace/Gmail.
- SmartSuite API credentials, workspace access, and its current schema (Phase 12) — the adapter, its configurable field mapping, idempotency and retry/dead-letter are built and inert: with no credentials the destination stays disabled, and development captures what would be sent.
- Bot-challenge provider account (Phase 13) — Google reCAPTCHA is a natural GCP-native option; the verifier interface exists and no provider is selected, so no challenge is shown or verified.
- The current published Privacy Policy's exact deletion-scope wording (Phase 11).
- Confirmation of any preferred vendors where Technical Freeze v1.1 FINAL §P named a class of solution rather than a specific product.
- Initial ADMIN role holder(s) for the Control Center (Phase 10).
- A pilot-cohort plan (Phase 15).
- Staging and production GCP projects/resources — created only once their own phase needs them, per Mike's approved scope.

**Not needed at all yet, per Technical Freeze v1.1 FINAL:** a payment provider and ClickUp workspace access are explicitly deferred. The Operation Hub / ClickUp linkage is strictly outbound and has no workspace contract yet: PostgreSQL stays the system of record, and an external workspace can never write a Person, Company, Project, First Assessment answer, finding, Snapshot or entitlement.

## Local development

Requires Node.js 20+. In an environment with npm registry access:

```
npm install
npm run build
npm run lint
npm run test
```

Note: `npm install`/`npm ci` over a cloud-synced folder (e.g. iCloud Drive) is unreliable — large `node_modules` trees can hit spurious rename/rmdir errors from the sync engine mid-install. Prefer a local, non-synced clone (or a `node_modules`-excluded sync rule) for actually running the toolchain.

### QA'ing a feature branch's frontend against Cloud Run dev's backend

`deploy-dev.yml` only deploys to Cloud Run dev after CI passes **on `main`** (see CI/CD below), so a feature branch's frontend changes are never visible on the deployed dev frontend until it's merged. Merging just to QA a Snapshot/UI change is not the answer — instead, run the frontend locally, straight off the branch, against the real Cloud Run dev backend.

The backend's origin guard (`backend/src/security/http-hardening.ts`) rejects any state-changing request whose `Origin` header isn't in that environment's `ALLOWED_ORIGINS` allow-list — by design, and this path does not change that guard, that allow-list, or any Cloud Run security policy. A local dev server's real browser Origin is `http://localhost:<port>`, which is correctly never on that list, so pointing the local frontend straight at the Cloud Run dev backend gets a 200 on GETs but a `403 ORIGIN_REJECTED` on anything state-changing.

Two dev-only, opt-in environment variables on the Vite dev server close that gap, on the proxy side only, without touching the backend at all:

- `VITE_DEV_API_TARGET` — the Cloud Run dev backend URL to proxy `/api` to (already supported).
- `VITE_DEV_API_ORIGIN` — when set, the local dev proxy rewrites the outgoing `Origin` header (on requests to that target only) to this value, which must be the dev frontend origin already present in the backend's own `ALLOWED_ORIGINS`. A real browser can never set its own `Origin` header, so this only ever takes effect inside this local, explicitly-configured proxy — nothing here is reachable from `vite build` or the deployed app.

Neither variable is required for normal local development: leave both unset and `npm run dev` proxies to a locally-running backend on `:8080` exactly as before.

To QA the current branch's frontend against Cloud Run dev:

```
VITE_DEV_API_TARGET=https://beeside-dev-backend-api-640247497574.northamerica-south1.run.app VITE_DEV_API_ORIGIN=https://beeside-dev-frontend-app-640247497574.northamerica-south1.run.app npm run dev --workspace=frontend
```

(equivalently: `cd frontend && VITE_DEV_API_TARGET=... VITE_DEV_API_ORIGIN=... npm run dev` — the root has no bare `dev` script under this repo's npm workspaces, so `--workspace=frontend` or running from inside `frontend/` is required.)

then open the local dev server URL Vite prints (typically `http://localhost:5173`) — every request goes to the real Cloud Run dev backend and its real dev data, while the frontend code is whatever is checked out locally, no merge required.

## Infrastructure (GCP)

Requires Terraform >= 1.7 with the `hashicorp/google` provider. For dev, `project_id` and `region` default to Mike's confirmed values in `infra/terraform/envs/dev/main.tf`. Staging and production still carry `REPLACE-WITH-*` placeholders, since those projects don't exist yet. Modules: `network` (VPC), `database` (Cloud SQL for PostgreSQL), `secrets` (Secret Manager), `queue` (Pub/Sub — defined, not yet recommended to apply), `observability` (Cloud Logging), `artifact-registry`, `cloud-run`.

## CI/CD

`.github/workflows/ci.yml` builds, lints, tests every workspace, builds both container images, audits shipped dependencies, and runs a secrets scan on every PR and push to `main`. `deploy-dev.yml` triggers after CI passes on `main`; `deploy-staging.yml` and `deploy-production.yml` are manually dispatched promotions. All three authenticate to GCP via Workload Identity Federation, run database migrations as their own Cloud Run job (migration DB user, never the runtime one), and only then deploy to Cloud Run — gated behind each GitHub Environment's `GCP_PROJECT_ID` and, for dev, `DEPLOY_DEV_ENABLED=true`. See `docs/deployment/README.md` for exactly what infrastructure is still missing before any of this can actually run end to end.
