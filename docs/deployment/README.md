# Deployment requirements (prepared in Phase 13, applied later)

Nothing in this document has been applied. The code and configuration are ready; the items below
need infrastructure or secrets that are deliberately **not** provisioned by this build. Development,
staging and production are untouched by these notes.

## 1. Database privilege separation (migration user ≠ runtime user)

Migration `0014` creates the NOLOGIN group role `beeside_runtime_role` with exactly the privileges
the application needs: `USAGE` on `public`, `SELECT/INSERT/UPDATE` on the application tables, `DELETE`
only where the temporary-retention purge and housekeeping need it, `SELECT` on
`drizzle.__drizzle_migrations`, and no DDL, ownership, role management or migration-registry writes.
The migration user (today `beeside_app`) keeps ownership of every object.

What is still missing per environment:

1. A login role for the application, created **outside** migrations. Two options:
   - **Password role created through SQL** (keeps it out of `cloudsqlsuperuser`, which every user
     created with `gcloud sql users create` joins automatically):
     ```sql
     CREATE ROLE beeside_runtime LOGIN PASSWORD '<from Secret Manager>';
     GRANT beeside_runtime_role TO beeside_runtime;
     ```
     plus a Secret Manager secret (e.g. `beeside-<env>-db-runtime-password`) and a Cloud Run
     `DATABASE_URL` built from it.
   - **IAM database authentication** (no password at all): create the Cloud Run service account as a
     Cloud SQL IAM user, `GRANT beeside_runtime_role TO "<sa>@<project>.iam";` and connect with the
     Cloud SQL connector using automatic IAM authentication.
2. The runtime service must **not** receive `MIGRATION_DATABASE_URL` (startup validation refuses it
   in production), and the migration job must not receive the runtime credential.
3. `DB_PRIVILEGE_CHECK` stays on: in production the API refuses to serve if its database user is a
   superuser, a `cloudsqlsuperuser` member, can create roles/databases/objects, owns tables or can
   write the migration registry.

Terraform is intentionally unchanged: creating the login user is the only infrastructure step, and it
must be reviewed together with the identity/secret decisions that are still open.

## 2. Deployment pipeline

Fixed in this block (code and configuration only, nothing deployed):

- `backend/Dockerfile` and `frontend/Dockerfile` build from the **repository root** so the npm
  workspaces and `@beeside/canonical-fields` resolve; the backend image ships `db/migrations`, runs
  as `node`, and installs production dependencies only. `.dockerignore` keeps `node_modules`, build
  output, `infra/` and any `.env` out of the build context.
- The frontend image no longer installs `serve` at runtime: `frontend/server/static-server.mjs`
  serves the build with CSP, `X-Frame-Options`, `Referrer-Policy: no-referrer`, immutable asset
  caching and `no-store` for the app shell, an SPA fallback for `/resume` and `/admin`, and an
  optional `/api` proxy (`API_UPSTREAM_URL`) so the browser sees one origin.
- Workflows build both images with the repository as context and only after the images build in CI.
- A migration step runs **before** the backend is deployed, as a Cloud Run job executing
  `node dist/scripts/migrate.js` from the backend image with `MIGRATION_DATABASE_URL`.
- `/health/ready` reports ready only when the database is reachable and every migration shipped in
  the image is applied.
- **dev**: the Cloud Run job itself now exists as Terraform (`infra/terraform/modules/migration-job`,
  instantiated from `infra/terraform/envs/dev/main.tf`). It runs under its own minimal service
  account (`roles/cloudsql.client` on the project — the only scope Cloud SQL's IAM model offers for
  that role — plus `roles/secretmanager.secretAccessor` on exactly one secret), never the backend
  service's identity. `MIGRATION_DATABASE_URL` is supplied as a Cloud-Run-native secret-backed env
  var from a new secret, `modules/database`'s `migration_database_url` — the **same migration user
  this document already names above (`beeside_app`, which "keeps ownership of every object")**, just
  pre-composed into the one connection-string shape `migrate.ts` expects. No new database principal
  was introduced and nothing about the open runtime-user decision below was resolved or assumed — the
  job simply uses the migration privilege level that already exists today. `vars.MIGRATION_JOB_NAME`
  in GitHub Actions must be set to the exact value of this module's `job_name` output —
  `beeside-dev-migrate` for dev.
- `infra/terraform/modules/cloud-run` now also ignores drift on each service's `env` block (it
  already ignored `image` for the same reason): CI/manual `gcloud run deploy`/`services update` calls
  set values Terraform does not declare, and without this a `terraform apply` unrelated to those
  values would plan to strip them back to just `NODE_ENV`.
- **Public access for `beeside-dev-backend-api` and `beeside-dev-frontend-app`, under Domain
  Restricted Sharing.** This project enforces the org policy `constraints/iam.allowedPolicyMemberDomains`
  (Domain Restricted Sharing). Two approaches were tried and rejected before landing on the current
  one:
  - Granting `roles/run.invoker` to `allUsers`, via a project-level tag-scoped conditional exception
    to Domain Restricted Sharing (`infra/terraform/envs/dev/public-access-tag-policy.tf`, now
    **retired** — renamed to `.tf.retired` so Terraform never loads it, kept only for history). This
    failed outright, with or without an added propagation delay: `Error 400: "One or more users
    named in the policy do not belong to a permitted customer, perhaps due to an organization
    policy."` Google's own guidance confirms the `allUsers` route is not the supported path under
    Domain Restricted Sharing, so this was never a timing problem.
  - Cloud Run's `run.googleapis.com/invoker-iam-disabled` **annotation** — Google's documented
    mechanism for exactly this scenario, and the one that needs no org-policy exception at all (it
    bypasses IAM policy evaluation for invocation entirely, so Domain Restricted Sharing is never
    touched). This was rejected outright by the Cloud Run **v2** API itself: `"system annotations are
    not supported in Cloud Run API v2"` — that mechanism only ever worked against the v1 API.
  - **Current state**: the v2-native replacement is a typed `invoker_iam_disabled` field on
    `google_cloud_run_v2_service` — but as of this writing it does not exist in any released
    `hashicorp/google` provider version (an open upstream feature request, no merged fix; checked up
    through recent 7.x releases). Until the provider supports it, both services have the invoker IAM
    check disabled directly via `gcloud run deploy ... --no-invoker-iam-check` in `deploy-dev.yml`
    (also available as `gcloud run services update <service> --no-invoker-iam-check` for a one-time
    change outside a deploy). This is Cloud Run's own supported mechanism, GA, not a workaround
    layered on top of it — Terraform simply can't express it yet. **Domain Restricted Sharing is
    unmodified**: no org-policy exception, no `allUsers` grant, nothing project-level. `allow_unauthenticated`
    in `infra/terraform/modules/cloud-run` remains a documentation-only variable (the module takes no
    action on it) until `hashicorp/google` ships the native field, at which point this control moves
    back into Terraform and this bullet gets removed.

Still missing (infrastructure, not code):

- The dev migration job above still runs as `beeside_app`, not a dedicated least-privilege migration
  role — because `beeside_app` already **is** the documented migration user today, this is not a new
  gap, but it is also not the end state: once `beeside_runtime` (below) exists and starts owning
  runtime traffic, migration `0014`'s `beeside_runtime_role` grants become meaningful and the two
  connections (migration vs. runtime) are genuinely separated in practice, not just in code intent.
- staging/production: the same `modules/migration-job` module can be instantiated from
  `infra/terraform/envs/staging` and `envs/production` the same way dev does — not done here, out of
  this change's scope (dev only).
- A Cloud Run **service** (or scheduled job) for the background worker `node dist/worker.js`.
- The routing decision for one browser origin: either a load balancer in front of both services, or
  the frontend service's `API_UPSTREAM_URL` proxy. `TRUST_PROXY_HOPS` must be set to match
  (`1` behind the Cloud Run front end, `2` when the frontend proxies to the backend) — production
  startup refuses to run without it while a public API is enabled.
- Cloud Run environment for the backend: `NODE_ENV`, `APP_BASE_URL`, `DATABASE_URL` (runtime user),
  `SECURITY_HASH_SECRET`, `TRUST_PROXY_HOPS`, `ALLOWED_ORIGINS`, and the feature switches
  (`FA_API_ENABLED`, `ADMIN_API_ENABLED`, `BILLING_EVENTS_ENABLED`, `INTEGRATION_*_MODE`), none of
  which is enabled by this build.
- `vars.DEPLOY_DEV_ENABLED` (dev) is required in addition to the GCP variables, so merging to `main`
  cannot deploy by accident while the pipeline is being prepared.

## 3. Integrations

- SmartSuite: `INTEGRATION_SMARTSUITE_MODE=live` needs `SMARTSUITE_API_TOKEN`,
  `SMARTSUITE_ACCOUNT_ID` and `SMARTSUITE_MAPPING_JSON` (application id, the events to send, and the
  beeside source key → SmartSuite field id mapping). The mapping is validated at startup against the
  allow-listed source keys; no mapping or credential is invented in code, and the live client has not
  been verified against a real workspace.
- Operation Hub / ClickUp: outbound only. `INTEGRATION_OPERATION_HUB_MODE=live` is refused at
  startup until a workspace contract exists; `capture` (development) records the commands.

## 4. Secrets that are still undecided

Identity provider (Admin sign-in), email provider, payment provider, the Privacy Policy URL and the
SmartSuite workspace credentials remain open decisions and are not chosen here.
