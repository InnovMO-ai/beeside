# beeside First Assessment — operational runbook

Written in Phase 14/15 from the code as it stands. Everything here is reproducible; where a step
depends on infrastructure or a decision that does not exist yet, it says so instead of guessing.

**Nothing in this runbook has been executed against staging or production.**

---

## 1. Services and what they run

| Unit | Command | Notes |
| --- | --- | --- |
| API | `node dist/index.js` | Backend image. Serves `/health`, `/health/ready`, and only the APIs explicitly enabled. |
| Worker | `node dist/worker.js` | Same image. Runs the scheduled jobs; holds no HTTP surface. |
| Migrations | `node dist/scripts/migrate.js` | Same image, own job, **migration database user only**. |
| Frontend | `node static-server.mjs` | Frontend image: built app + security headers + SPA fallback (+ optional `/api` proxy). |

Scheduled jobs and their default cadence (`WORKER_<JOB>_SECONDS` overrides each one):

| Job | Default | Purpose |
| --- | --- | --- |
| `email_outbox` | 30 s | Delivers and retries queued email. |
| `access_lifecycle` | 15 min | Day-10 reminder, access expiry record, day-21 recovery email. |
| `temporary_retention` | 60 min | Purges free assessments whose retention has elapsed. |
| `integration_outbox` | 60 s | Fans outbox events out to destinations and delivers them. |
| `security_housekeeping` | 60 min | Drops expired rate-limit windows. |

Manual run (audited, ADMIN only, never on a whim):
`npm run jobs:run --workspace=backend -- <job>` — `temporary_retention` additionally requires
`--confirm-retention-purge`.

---

## 2. Configuration and secrets matrix

Startup validation refuses an invalid or unsafe combination before the first request
(`validateRuntimeConfig`), and production additionally refuses development conveniences.

| Variable | API | Worker | Migrations | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | yes | yes | — | Secret Manager | **Runtime** database user. |
| `MIGRATION_DATABASE_URL` | **never** | **never** | yes | Secret Manager | Production refuses it on runtime services. |
| `APP_BASE_URL` | yes | yes | — | env var | Public app origin; https in production. |
| `ALLOWED_ORIGINS` | yes | — | — | env var | Extra origins allowed to send state-changing requests. |
| `TRUST_PROXY_HOPS` | yes | — | — | env var | **Deployment decision** (see §7). Required in production. |
| `SECURITY_HASH_SECRET` | yes | — | — | Secret Manager | ≥32 chars; keys the rate-limit HMAC. |
| `FA_API_ENABLED` | yes | — | — | env var | Off by default; the public API only exists when true. |
| `ADMIN_API_ENABLED` + `ADMIN_OIDC_*`, `ADMIN_APP_ORIGIN`, `ADMIN_SESSION_SECRET`, `ADMIN_ALLOWED_EMAIL_DOMAINS` | yes | — | — | Secret Manager | All required together; **identity provider not selected yet**. |
| `ADMIN_COOKIE_SECURE` | yes | — | — | env var | `false` is refused in production. |
| `BILLING_EVENTS_ENABLED`, `BILLING_WEBHOOK_SECRET` | yes | — | — | Secret Manager | Secret ≥32 chars; **no payment provider selected**. |
| `INTEGRATION_SMARTSUITE_MODE`, `SMARTSUITE_API_TOKEN`, `SMARTSUITE_ACCOUNT_ID`, `SMARTSUITE_MAPPING_JSON`, `SMARTSUITE_API_BASE_URL` | yes | yes | — | Secret Manager | `disabled` unless credentials **and** mapping exist; `capture` refused in production. |
| `INTEGRATION_OPERATION_HUB_MODE` | yes | yes | — | env var | `live` refused: no workspace contract yet. |
| `EMAIL_RESEND_COOLDOWN_MINUTES` | yes | yes | — | env var | Defaults to 5. |
| `DEV_LOG_EMAIL_LINKS`, `PREMIUM_DEV_SIMULATION`, `RATE_LIMITING_ENABLED=false` | local only | local only | — | — | All refused in production. |
| `DB_PRIVILEGE_CHECK` | yes | — | — | env var | Leave on: production refuses to serve with an over-privileged database user. |
| `API_UPSTREAM_URL` | — | — | — | frontend env | Only if the frontend proxies `/api` instead of a load balancer. |

---

## 3. Deploying an environment

Order is always **build → migrate → deploy**, and it is what the workflows do.

1. CI must be green (build, lint, tests, both images, dependency audit, secrets scan).
2. Images build from the repository root and are pushed to Artifact Registry.
3. The migration Cloud Run job runs `node dist/scripts/migrate.js` with `MIGRATION_DATABASE_URL`.
   It applies only the migrations shipped in that image, with the Drizzle registry and hashes.
4. API, frontend and worker revisions are deployed from the same image tag.
5. Verify:
   - `GET /health` → `{"status":"ok"}`;
   - `GET /health/ready` → `{"status":"ready"}` (503 `schema_behind` means step 3 did not run);
   - the frontend serves the app shell and its security headers;
   - Cloud Logging shows no `severity: ERROR` from the new revision.

Dev additionally requires `vars.DEPLOY_DEV_ENABLED=true`; staging and production are manual
promotions of a ref already verified in the previous environment.

---

## 4. Rollback

Migrations in this build are **additive** (new tables, guards, grants): an older image runs against
a newer schema without corruption, so rollback is an image rollback, never a schema rollback.

1. Identify the previous good revision:
   `gcloud run revisions list --service <service> --region <region>`.
2. Send all traffic back to it:
   `gcloud run services update-traffic <service> --to-revisions <revision>=100 --region <region>`.
3. Do the same for the frontend, and redeploy the worker from the same previous image tag.
4. Re-verify `/health/ready` and the Control Center's Operations view (jobs still succeeding).
5. Record what happened in the audit trail: the incident, the revision, and the reason.

**Do not** attempt to "undo" a migration to roll back. If a migration itself is the problem, restore
from backup (§5) and fix forward; the purge is the only destructive operation in the system and it is
gated by its own authorization flag, job confirmation and audit record.

---

## 5. Backup and restore

- Automated daily backups and point-in-time recovery are on for every Cloud SQL instance
  (`backup_configuration` in the database module); dev keeps 7 retained backups.
- Before every schema change this build takes an explicit on-demand backup first:
  `gcloud sql backups create --instance <instance> --description <block>-pre-migrate-<timestamp>`
  and verifies it reports `SUCCESSFUL` before migrating.
- List backups: `gcloud sql backups list --instance <instance>`.
- Restore into a **new** instance (never in place, so the incident instance stays available for
  inspection): `gcloud sql backups restore <backup-id> --restore-instance <new-instance> --backup-instance <instance>`.
- Point-in-time recovery: `gcloud sql instances clone <instance> <clone> --point-in-time <RFC3339>`.
- **Validation is still pending**: a restore has never been exercised end to end. Before the pilot,
  restore the latest dev backup into a throwaway instance, run the SQL integrity suites against it,
  and record the wall-clock time (RPO ≤ 24 h and RTO ≤ 8 h are the targets in the architecture).

---

## 6. Observability

- Every service logs one JSON line per event with `severity`, and every string is redacted
  (emails, tokens, private links, connection passwords) before printing.
- Every API response carries `X-Request-Id`; unhandled errors log that id and return it, never a stack.
- Admin and system actions are in `admin_audit_event` (append-only), visible in the Control Center.
- Operational health is in the Control Center's Analytics → Operational metrics: email deliveries by
  status, job runs (last run, last success, failures, abandoned), integration deliveries by
  destination, rate-limit refusals in the last 24 h, and retention (purged, due, held by a pending
  Premium request).
- Signals worth alerting on once monitoring exists: any `email_delivery` in `DEAD`, any
  `integration_delivery` in `DEAD`, a job with no success in twice its interval, `/health/ready`
  failing, and a sustained rise in rate-limit refusals.

---

## 7. Deployment decisions that are still open

- **`TRUST_PROXY_HOPS`**: depends on the topology that has not been chosen. One Cloud Run front end
  in front of the API → `1`. Frontend service proxying `/api` to the API (`API_UPSTREAM_URL`) → `2`.
  A load balancer in front of both → `1` at the API with the LB configured to preserve the client IP.
  Production refuses to start without an explicit value; do not guess it.
- **Runtime database login user** (§2 `DATABASE_URL`): created per environment outside migrations —
  see `docs/deployment/README.md`.
- Migration job, worker service and scheduler provisioning.
- Identity provider (Control Center sign-in), email provider, payment provider.
- Production Admin users, domain/DNS/certificates, monitoring and alerting.
