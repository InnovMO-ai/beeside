# Friends & Family pilot — readiness checklist

Two columns on purpose: what the build already does, and what someone must decide, buy or configure
before real people use it. Nothing in the second column can be resolved by writing more code.

---

## A. Code-complete (verified in this build)

| Area | Evidence |
| --- | --- |
| Full journey: entry → identity → four stages → Finish Later → private link → resume → completion → Snapshot → feedback → Premium → Precision handoff | End-to-end suite (`e2e-journey.int.test.ts`) plus a manual browser pass in Spanish |
| Returning respondent: same email never attaches a stranger; the verified link continues the same project and person | E2E suite + browser pass over the emailed fragment link |
| Multiple projects for one person/company, fully isolated (answers, findings, Snapshot, feedback, Premium) | E2E suite |
| Already-operating branch and its growth questions | E2E suite |
| English and Spanish across interface, Snapshot and every email | E2E suite |
| Access lifecycle 15/10/21/45/60, four extension reasons, contextual follow-up, recovery, retention purge, completed-without-link fallback | Operations suite (time-travel with an injected clock) |
| The access calendar is configuration: a published question bank with 21/16/27 changes behaviour with no migration and no code change | Operations suite |
| Rules/Snapshot: 14 areas, four statuses, CRITICAL safeguards, ≤5 panels, ≤6 capabilities, no padding, declared priority preserved, immutability after completion | Rules engine + Snapshot unit suites, Rules/Snapshot integration suite |
| Premium/Precision continuity: exactly one handoff on first activation, never regenerated on reactivation, `premium_ever_activated` protection | Premium suite + E2E suite |
| Security: RBAC, CSRF, origin allow-list, rate limiting, honeypot, body limits, fragment links, token rotation, webhook signature + timestamp, session expiry, log redaction, JSON errors, purge authorization, admin audit | Security/integration suites + SQL integrity suites |
| Runtime database least privilege | Whole endpoint suite passes as `beeside_runtime`; the role cannot change schema or migration registry |
| Integrations behind adapters: capture/no-op, idempotency, retries, dead-letter, disabled destinations, retention deletion event, no mutation of protected entities | Integrations suite + static boundary test |
| Deployment pipeline: images from repository root, migrations shipped and applied as their own job, readiness gate, rollback by revision | CI builds both images; `docs/operations/runbook.md` |

## B. External decisions and configuration required before the pilot

**Product/commercial decisions (still open on purpose)**

- First Assessment access window: 15 vs 21 days.
- Snapshot-link retention.
- Privacy Policy URL and version (today acceptance is stored with a NULL URL and the policy renders as plain text).
- Premium-pending retention timeout (a pending request currently postpones purge indefinitely; the count and age are reported in Analytics → Operational metrics).
- Payment provider, pricing and refunds.
- "Something to Reconcile" timing-driver mapping.
- Handoff-quality / decision-flexibility thresholds.

**Vendors and credentials**

- Identity provider for the Control Center (any standards-compliant OpenID Connect provider).
- Transactional email provider and sending domain (no provider is selected; email is currently logged, not sent).
- SmartSuite credentials **and** field mapping.
- ClickUp / Operation Hub workspace contract.
- Bot-challenge provider (optional; the verifier interface exists and is inert).

**Infrastructure and operations**

- Runtime database login user per environment, granted `beeside_runtime_role` (`docs/deployment/README.md`).
- Migration Cloud Run job, worker service and its scheduler.
- API routing decision and the matching `TRUST_PROXY_HOPS` (production refuses to start without it).
- Secrets in Secret Manager per the matrix in `docs/operations/runbook.md`.
- Production Admin users (none exist; the development bootstrap identity can never sign in).
- Domain, DNS and certificates for the public app and the Control Center.
- Monitoring and alerting on the signals listed in the runbook.
- **Backup/restore validation**: restore a dev backup into a throwaway instance and run the SQL suites against it.

## C. Feature switches at pilot time

Everything that touches real people is off by default and must be turned on deliberately:

| Switch | Pilot value | Consequence |
| --- | --- | --- |
| `FA_API_ENABLED` | `true` | Without it there is no public API at all. |
| `ADMIN_API_ENABLED` + OIDC settings | `true` once the provider exists | Control Center sign-in. |
| `BILLING_EVENTS_ENABLED` | `false` until a provider exists | Premium stays manual confirmation by an ADMIN. |
| `INTEGRATION_SMARTSUITE_MODE` | `disabled` until credentials + mapping | Events queue as deliveries and wait; nothing is lost. |
| `INTEGRATION_OPERATION_HUB_MODE` | `disabled` | `live` is refused; no workspace contract exists. |
| `PREMIUM_DEV_SIMULATION`, `DEV_LOG_EMAIL_LINKS` | never in production | Refused by startup validation. |
