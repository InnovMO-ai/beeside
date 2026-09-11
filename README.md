# beeside First Assessment

Governing baseline: Functional Freeze v1, Design Freeze v1, the Journey, the approved Snapshot, the Master Build Guide and its Clarifications, Content & Editorial Principles v1, Brand Identity Reference v1, and **Technical Freeze v1.1 FINAL** (`technical-architecture-v1.1-final.md` + `technical-freeze-v1.1-final-candidate.md` in the project). Build sequence: `build-plan-v1.1-final.md`.

This repository is currently at **Phase 1 — Foundation & environments** only. Nothing beyond the Phase 1 skeleton described below has been built. No frozen functional, design, technical, journey, Snapshot, brand, or editorial requirement has been modified, simplified, reinterpreted, or substituted.

## Layout

```
backend/                 Node.js + TypeScript API service (health-check only in Phase 1)
frontend/                React + TypeScript client app (placeholder shell only in Phase 1)
shared/canonical-fields/ Shared field-key/enum registry — the mechanism that prevents schema drift
infra/terraform/         Infrastructure as code: modules/ (reusable) + envs/{dev,staging,production}/
.github/workflows/       CI (build/lint/test/secrets-scan) + per-environment deploy workflows
scripts/                 secrets-scan.sh (CI + local), syntax-check.js (sandbox-only verification helper)
```

## Cloud provider: Google Cloud Platform (GCP)

Confirmed by Mike. The public beeside marketing site stays on Wix (not part of this repository or this cloud account). Corporate email is Google Workspace/Gmail — separate from, and not reused as, the application's own transactional email sender (see Phase 5 in the Build Plan). See the GCP infrastructure proposal (`gcp-infrastructure-proposal-phase1.md` in the project) for the full plain-language service list, cost estimate, and exactly what to create/approve.

**Confirmed so far:**
- Region: `northamerica-south1` (Querétaro, Mexico) — checked directly against Google's documentation; every Phase 1 service (Cloud SQL, Cloud Run, Artifact Registry, Secret Manager, Cloud Storage, VPC) is available there.
- Scope: **dev only, for now.** Staging is created once Phase 1's own acceptance tests need it (proving a backup exists in a production-like setting). Production stays an empty project shell until much closer to launch.
- Dev GCP project: `beeside-dev-508220`.
- GitHub repository: `InnovMO-ai/beeside`.
- Both are already filled into `infra/terraform/envs/dev/main.tf` (and, for the parts that are just facts rather than live resources — the GitHub repository name — into the staging/production files too, so there's no drift later). **Nothing has been applied to any live GCP project yet** — this is still code only, pending the remaining setup steps and Mike's explicit go-ahead to run `terraform apply`.

## What's left before dev can go live

- A Cloud Storage bucket named exactly `beeside-terraform-state-dev-508220`, created inside the `beeside-dev-508220` project, in `northamerica-south1` — this is where Terraform keeps track of what it has created. (Full step-by-step given separately in chat.)
- The code in this repository pushed into the (now-created) `InnovMO-ai/beeside` GitHub repository.
- Mike's explicit go-ahead to run `terraform init` / `terraform apply` for dev once the above two exist.

## Still needed later (not blocking dev, do not set up yet)

- SSO/identity provider account (Phase 10) — Google Workspace SSO is a natural fit given Mike's existing Workspace account.
- Transactional email provider account and a sending domain with DNS access (Phase 5) — a separate decision from Google Workspace/Gmail.
- SmartSuite API credentials, workspace access, and its current schema (Phase 12).
- Bot-challenge provider account (Phase 13) — Google reCAPTCHA is a natural GCP-native option.
- The current published Privacy Policy's exact deletion-scope wording (Phase 11).
- Confirmation of any preferred vendors where Technical Freeze v1.1 FINAL §P named a class of solution rather than a specific product.
- Initial ADMIN role holder(s) for the Control Center (Phase 10).
- A pilot-cohort plan (Phase 15).
- Staging and production GCP projects/resources — created only once their own phase needs them, per Mike's approved scope.

**Not needed at all yet, per Technical Freeze v1.1 FINAL:** a payment provider and ClickUp workspace access are explicitly deferred and do not block Phase 1 through Phase 15's start.

## Local development

Requires Node.js 20+. In an environment with npm registry access:

```
npm install
npm run build
npm run lint
npm run test
```

## Infrastructure (GCP)

Requires Terraform >= 1.7 with the `hashicorp/google` provider. For dev, `project_id` and `region` now default to Mike's confirmed values directly in `infra/terraform/envs/dev/main.tf` — no `terraform.tfvars` needed unless overriding them. Staging and production still carry `REPLACE-WITH-*` placeholders for their project IDs, since those projects don't exist yet. Even for dev, `terraform init`/`plan`/`apply` cannot run until the state bucket exists and Mike gives the explicit go-ahead — see "What's left before dev can go live" above. Modules: `network` (VPC), `database` (Cloud SQL for PostgreSQL — the one canonical database), `secrets` (Secret Manager), `queue` (Pub/Sub — defined but not recommended to apply yet, see the GCP proposal), `observability` (Cloud Logging), `artifact-registry` (Docker image storage), `cloud-run` (serverless compute, instantiated once for the backend API and once for the frontend app).

## CI/CD

`.github/workflows/ci.yml` builds, lints, tests every workspace, and runs a secrets scan on every PR and push to `main` — cloud-agnostic, no changes needed for GCP. `deploy-dev.yml` auto-triggers after CI passes on `main`; `deploy-staging.yml` and `deploy-production.yml` are manually dispatched promotions requiring a verified ref from the environment before it. All three deploy workflows authenticate to GCP via Workload Identity Federation (no long-lived key ever stored in GitHub) and push images to Artifact Registry / deploy to Cloud Run — but every real step is gated behind that GitHub Environment's `GCP_PROJECT_ID` variable being set, so until GCP is actually provisioned, each workflow safely prints an explanatory message instead of failing.
