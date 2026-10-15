# Discovery Public v1.0 — Production deployment & configuration plan (controlled launch)

Status: **code preparation DONE (2026-10-15, PR #6); nothing deployed, no production GCP resource created or modified.** §3 lists what was implemented; the deployment itself waits for the inputs in §7. Operational procedures: `deploy/production/RUNBOOK.md`.
Target: `https://beeside.you/discovery` (public path) · `https://beeside.you/ops-control` (internal administration). Phase 1 = real production, closed/controlled access; opening commercially later = changing the access gate, not the hostname or the build.

## 1. What exists today (verified, read-only)

| Fact | Evidence |
|---|---|
| The only GCP project that hosts beeside is `beeside-dev-508220` (plus an unrelated "My First Project"). It holds the legacy dev services, the FA4 staging services and one shared Cloud SQL instance `beeside-dev-canonical-db` (Postgres 16, `db-g1-small`, **ZONAL**, backups + PITR on). **There is no production project, database, service, load balancer or domain mapping.** | `gcloud projects/run/sql list` |
| Staging = Cloud Run `fa4-staging-web` (static server + `/api` proxy, behind IAP) → private `fa4-staging-backend`, DB `fa4_staging`, `FA4_ENV=staging` (log e-mail transport, test legal). `FA4_ENV=staging` is **refused** on the public host by code. | `deploy-gcp.sh`, `index.ts` |
| The organization applies **Domain Restricted Sharing**: a Cloud Run service cannot simply be made public; the repo already contains a (retired) narrow tag-based exception for dev. | `infra/terraform/.../public-access-tag-policy.tf.retired` |
| The app is built for **root-path hosting**: Vite `base` is `/`, assets load from `/assets/*`, brand files from `/brand/*`, the API client calls the absolute `/api/fa4`, the Control Center `/api/admin`. Routes `/discovery` and `/ops-control` already exist as aliases of `/fa4` and `/admin`; e-mailed links use `FA4_PUBLIC_PATH`. | `vite.config.ts`, `api.ts`, `main.tsx` |
| Access gate that exists: Basic-auth + cookie gate in the static server (`STAGING_BASIC_AUTH`), plus IAP in front of staging. `ROBOTS_NOINDEX=true` adds `X-Robots-Tag` and a `robots.txt`. | `static-server.mjs` |
| The FA4 outbox worker is a long-running poller (`node dist/fa4/worker.js`, 5 s, lease-based, safe with several replicas). | `worker.ts` |
| The Control Center behind `/admin` is the **legacy First Assessment** admin (projects, Snapshot, Premium, lifecycle). **There is no Discovery/FA4 admin UI**; catalog draft/publish is repository-level (scripts). | `admin/*`, audit §17 |

## 2. Target architecture

```
Internet ─► beeside.you  (HTTPS, managed certificate)
              │  Global external HTTPS Load Balancer  (URL map by path)
              ├─ /discovery/*   ─► Cloud Run  discovery-web      (static server + API proxy, access gate, noindex)
              ├─ /ops-control/* ─► Cloud Run  discovery-web      (same image; the Control Center; admin gate)
              └─ default (/)    ─► the current beeside.you website (unchanged)  ← depends on how it is hosted (§7, input 1)
discovery-web ─► discovery-backend (Cloud Run, private, IAM-only invoker; X-Serverless-Authorization ID token)
discovery-backend ─► Cloud SQL (production instance, private IP / connector) · SMTP (contact@beeside.you)
discovery-worker (Cloud Run service, min 1 instance, CPU always on) ─► same DB + SMTP
migrate job (Cloud Run job, separate DB role)  ·  Cloud Scheduler: none needed (worker polls)
```

Everything lives in a **new production GCP project** (decision in §7, input 2). Dev data and the shared dev Cloud SQL instance are **not** reused for real prospects.

## 3. Work Code had to do BEFORE the first production deploy — IMPLEMENTED (C2 changed by decision: `/ops-control` is reserved and blocked, no admin prefix work)

| # | Change | Why |
|---|---|---|
| C1 | **Path-prefix hosting.** `VITE_BASE_PATH=/discovery/` for the production build: assets, brand files, API client base (`/discovery/api/fa4`), router paths and the e-mail logo URL (`${APP_BASE_URL}/discovery/brand/beeside-lockup.png`) all live under the prefix; static server serves the prefix, redirects `/discovery` → `/discovery/`, answers `/fa4` with a redirect to `/discovery` in production. | `beeside.you` already owns `/assets`, `/api` etc. for its website; a root-built app cannot share the hostname. This is the main code change. |
| C2 | **Admin path prefix** (only if input 3 says the existing Control Center must be live): same treatment for `/ops-control` (`/ops-control/api/admin`, OIDC callback `…/ops-control/api/admin/auth/callback`, cookie path, `returnTo`). | Same collision problem. Decision pending (input 3): the console serves the legacy product, not Discovery data. |
| C3 | **Access gate for the controlled phase**, runtime-configured (no rebuild to open): generalize the existing gate into `ACCESS_GATE_MODE=off|basic|…`, **exempting** `/health`, `robots.txt` and `/discovery/brand/*` (e-mail clients fetch the logo without cookies; a gated logo would break every e-mail header). `/ops-control` keeps its own, stricter gate. Opening commercially = `ACCESS_GATE_MODE=off` + `ROBOTS_NOINDEX=false` on the web service. | Requirement 5, 7, 9. |
| C4 | `deploy-production.sh` (+ cloudbuild) parameterized by project/region/instance, **separate from staging**, idempotent, never touching dev resources; `FA4_ENV` unset; migration job with the migration role; worker service; uptime check and alert policies as code. | Requirement 10. |
| C5 | Extend `fa4-launch-check.js` and add a **production preflight** (no secrets printed): every variable below SET/MISSING, path prefix honoured end-to-end, e-mail logo reachable without the gate, gate on, noindex on. | Fail-closed on day one. |
| C6 | e2e suite run against a `/discovery/` prefixed build (assets, API, resume/YEV links, e-mail logo path, redirects, gate, noindex, `/fa4` redirect, no link to `/ops-control` anywhere in Discovery). | Proof that nothing broke under the prefix. |

Estimated as one macroblock (C1, C3, C4–C6) plus C2 if required. These are code/script changes on PR #6 and can start immediately; **they deploy nothing**.

## 4. Production configuration (names only)

Backend / worker (`NODE_ENV=production`, `FA4_ENV` unset):
`FA4_API_ENABLED=true` · `APP_BASE_URL=https://beeside.you` · `FA4_PUBLIC_PATH=/discovery` · `DATABASE_URL` (runtime role, secret) · `SECURITY_HASH_SECRET` (≥ 32 chars, secret) · `TRUST_PROXY_HOPS` (explicit; value to be measured behind the LB) · `ALLOWED_ORIGINS=https://beeside.you` · `FA4_EMAIL_TRANSPORT=smtp` · `SMTP_HOST` / `SMTP_PORT=587` (STARTTLS) / `SMTP_USER` / `SMTP_PASSWORD` (secret) / `MAIL_FROM` / `MAIL_REPLY_TO` = `contact@beeside.you` · `FA4_PRIVACY_VERSION` (**external**, never invented) · `FA4_TERMS_VERSION` / URLs (defaults set) · `FA4_PREMIUM_COMMERCIAL_CONTENT_ALLOWED` (unset until Legal approves) · `FA4_PREMIUM_RESOURCE_URL_ES|EN` (optional) · `FA4_WORKER_POLL_MS`, rate-limit overrides (`FA4_RL_*`) only if needed. `MIGRATION_DATABASE_URL` is **not** given to runtime services (code refuses it).
Web: `API_UPSTREAM_URL`, `UPSTREAM_AUTH_AUDIENCE`, `ACCESS_GATE_*`, `ROBOTS_NOINDEX=true` (controlled phase), `NODE_ENV=production`; build args: `VITE_BASE_PATH=/discovery/`, `VITE_FA4_PREMIUM_PURCHASE_URL` (**external**; without it the CTA is not rendered), `VITE_FA4_LAUNCH=true` + Privacy URL.

Data and operations: new Cloud SQL instance (REGIONAL/HA, automated backups + PITR, deletion protection, private connectivity, maintenance window, retention set by Legal — not invented) · roles: migration owner vs `beeside_runtime_role` (no UPDATE/DELETE on append-only tables, already enforced by migrations) · migrations run by the job before each release (additive 0022/0023 on an empty production database: nothing to backfill) · catalog seeded by `seed-fa4-catalog.ts` · logs: structured, masked e-mail, no tokens/answers (Cloud Logging, retention policy) · monitoring: uptime check on `/health`, alerts on 5xx rate, outbox `DEAD`/backlog, worker silence, DB CPU/storage, job failure; Error Reporting is automatic for Cloud Run stderr but **no paging channel is configured yet** (input 8) · rollback: previous Cloud Run revision (safe only before the first sealed delivery; afterwards DB restore from PITR — documented, not hidden) · smoke plan: audit §10, run behind the gate by the team after deploy.

## 5. Controlled-access design (phase 1) and opening later

- Gate lives in the web service at runtime (C3). Options (input 5): **(a)** IAP in front of the LB for the team + invited Google accounts; **(b)** shared/per-prospect Basic-auth credentials in the static server (works for prospects without Google accounts; e-mail links open after the prompt); **(c)** both. Recommendation: (b) for prospects and presentations, plus an IAP/IP restriction on `/ops-control`.
- Backend is never public: IAM-only invoker; only the web/worker identities call it.
- Closed deployment is not indexable: `X-Robots-Tag: noindex, nofollow` + `robots.txt` disallow; `/ops-control` is never linked from Discovery (tested) and always noindex.
- Opening later = env change on the web service (gate off, noindex off) + Cloud Armor/rate limits reviewed. Same hostname, same build.
- Org policy (Domain Restricted Sharing): public traffic through the LB needs the Cloud Run invoker exception (as in the retired dev policy) or IAP; the platform owner must create it for the production project (input 6).

## 6. Sequence once inputs arrive

1. Code: C1/C3–C6 (+C2) merged on PR #6, full regression + prefixed-build e2e. 2. Staging redeploy from the same commit (technical pre-validation, unchanged role). 3. Platform: project, network, DB, secrets, LB + certificate + DNS cut-over plan, org-policy exception. 4. `deploy-production.sh` run once with gate **on** and noindex **on**. 5. Migrations job, catalog seed, worker up, SMTP test to an internal mailbox. 6. Team smoke (audit §10) + visual sign-off at `beeside.you/discovery`. 7. Controlled phase: internal tests, presentations, then selected prospects **only after Legal inputs 7–8 are cleared**. 8. Commercial opening: gate off.

## 7. External inputs required before executing

| # | Input | Owner | Why it blocks |
|---|---|---|---|
| 1 | **How `beeside.you` is hosted today and who controls its DNS/TLS** (CMS/site builder, registrar), and agreement on the edge: move DNS to a Google LB whose default backend is the current site, **or** a reverse proxy/rule on the existing host for `/discovery*` and `/ops-control*` | Platform/Marketing | Path routing on the shared hostname is impossible without it. |
| 2 | **Production GCP project** (name, billing, org placement) and region; confirmation that real prospect data must not live in `beeside-dev-508220` | Platform | There is no production project. |
| 3 | **What `/ops-control` must be on day one**: (a) the existing legacy Control Center (needs the production IdP/OIDC client and redirect URI, session secret, provisioned admin users) or (b) a reserved, blocked route until the Discovery Admin Console exists | Product | The current console administers the legacy product, not Discovery data. |
| 4 | **`FA4_PRIVACY_VERSION`** (the version/date identifier of the final Privacy document) | Legal | Production **refuses to start** without it, even for internal testing. |
| 5 | **Gate decision** for controlled access (IAP / Basic-auth per prospect / both), and the list of initial authorized people | Product + Platform | C3 design and who can log in. |
| 6 | **Org-policy approach** for Cloud Run public/LB invocation (Domain Restricted Sharing exception or IAP-only) | Platform/Security | Otherwise the LB cannot reach the service. |
| 7 | **LEGAL-1 final validation** (Terms/Privacy approved; retention periods; consent wording). Real prospect data must wait for it. | Legal | Privacy promise and retention. |
| 8 | **SMTP production credentials** for `contact@beeside.you` (Workspace app password/relay), SPF/DKIM/DMARC for `beeside.you`, and **who receives alerts** (channel/e-mail) | Platform | Deliverability to real prospects; monitoring has nobody to page. |
| 9 | **Premium purchase destination** (`VITE_FA4_PREMIUM_PURCHASE_URL`) and, if wanted, the Premium resource URLs | Product | Without it the Start Your Expansion CTA is not rendered. |
| 10 | **Product/Legal sign-off on the commercial comparison** and on the EN subtitle translation | Product/Legal | Content shown to prospects. |
| 11 | Database sizing/HA/retention choices (default proposal: REGIONAL HA, PITR 7 days, daily backups 14 days) | Platform | Cost/risk decision. |
