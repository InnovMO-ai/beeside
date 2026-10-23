# DISCOVERY — SHARED PLATFORM SERVICES IMPACT SUMMARY

Branch `feat/fa4-launch-config` @ `789a8fb`. Documentation only: no code, contract, migration or capability is changed; nothing is removed; L1 untouched (L1 CONVERGENCE: PENDING). Directive: Administration, Analytics and Payments (Stripe) are candidate Shared Platform Services; Discovery builds no new cross-cutting capability in them without coordination. This summary does **not** block the deploy to Stabilization (see §F: no technical blocker found).

## A. Current dependencies (facts from code / config)
| Area | What Discovery has today | Where |
|---|---|---|
| **Administration** | **No admin UI and no admin role for Discovery.** The catalog is seed-managed (`SEED_CATALOG` → `seed-fa4-catalog.ts`; tables `fa4_catalog_version/entity/change`); operations are by migrations/jobs (`discovery-migrate`, `discovery-prod-prepare`, stabilization reset script) and GCP console. The legacy FA Admin API (`/api/admin`, OIDC) exists in the same image but mounts only with `ADMIN_API_ENABLED=true` + OIDC config; it is **not** configured for Discovery and the web tier forwards only `/api/fa4/*`. | `backend/src/index.ts` (`adminDepsFromEnv`), ADMIN-1 (D-141) |
| **Users / roles / permissions** | **No user accounts.** Identity = e-mail captured in the journey + single-use tab/resume tokens (`fa4_access_token`, hashed). Access to the *environment* is a shared Basic gate (`ACCESS_GATE_MODE=basic`, 3 credentials, Cloud Armor `discovery-edge`). Closed-test recipient allowlist (`FA4_CLOSED_TEST_EMAIL_DOMAINS/ADDRESSES`) is the only "who may receive" policy. DB: least-privilege runtime role (no DDL) vs migration role. | `routes.ts`, `static-server.mjs`, `index.ts` |
| **Analytics / events** | Own append-only `fa4_event` table; closed event contract (`CLIENT_EVENT_SCHEMAS` 7 client events + `SERVER_EVENT_NAMES` 19 server events incl. `premium_continuation_requested`, `resume_email_auto_queued`); `POST /api/fa4/events`; no IP/UA/e-mail/free text; dictionary `docs/fa4/EMAIL_AND_ANALYTICS.md` / `ANALYTICS_EVENTS.md`. No external analytics SDK, no dashboard. Legacy FA analytics module exists in the image, unused by Discovery. | `backend/src/fa4/events.ts`, `frontend/src/fa4/api.ts (track)` |
| **Payments / Premium** | **No payment in Discovery.** «Start Your Expansion» is rendered only if `VITE_FA4_PREMIUM_PURCHASE_URL` is an https URL (empty in production → CTA absent, fail-closed). `POST /session/continue` only inserts `fa4_continuation_request(project_id, result_id)` and emits `premium_continuation_requested`; `fa4_demand_signal.premium_state` stores the Premium state per signal. No Stripe code, SDK, keys or webhooks in the FA4 path (grep: only a test/brand mention). Legacy `premium/` module (`BillingRouter` with `BILLING_EVENTS_ENABLED`, `devSimulatedCheckout` behind `PREMIUM_DEV_SIMULATION` and `NODE_ENV!=production`) is present in the image and **not** enabled in production. | `repository.ts requestContinuation`, `brand.ts`, `PremiumContinuation.tsx`, `index.ts` |
| **Related integrations** | SMTP (Gmail, Secret Manager) via own outbox; Cloud Monitoring alert policies (no uptime check); Precision context mapper `fa4-precision-context/1` (no consumer on this line, B-5); legal URLs (beeside.you); Cloud SQL, Cloud Run, Cloud Armor. | DSC-34 inventory |

## B. Capabilities that must STAY in Discovery (product-specific)
- Journey, step order, validation, required-answer rules, help content (`help-v1`) and its mapping; session model (tab token, 30-min resume rule, idle continuation DSC-36 and the activity heartbeat).
- Question/answer model, catalog **content** and the deterministic resolution engine (`shared/fa-public-engine`), YEV generation and rendering, A+ sealed result, demand signals (what a project needs), Premium *offer rules* (when/what the CTA says; fail-closed without destination).
- Discovery e-mail **templates and triggers** (resume, YEV, idle continuation, contact), closed-test policy, privacy/legal evidence and erasure for Discovery data (`fa4_anonymize_project`, retention).
- Discovery-specific permissions: who may open which project (token ownership), recipient allowlist, delivered-result lock.
- Product event **vocabulary** (which Discovery events exist and their closed property contract).

## C. Candidates for Shared Platform Services
**Administration**
- Staff identity/SSO + roles (replaces Basic gate for reviewers; today ADMIN-1 is open).
- Catalog administration UI (publish/draft/versioning of `fa4_catalog_*`, today seed + job).
- Operator tools: project lookup/support, outbox dead-letter handling and resend, erasure requests, closed-test allowlist management, reviewer management.
- Feature/flag management (e.g. help flags E/F, closed-test mode) and audit trail of admin actions.

**Analytics**
- Event ingestion/storage/retention platform, identity stitching policy, dashboards/funnels (step_viewed → result → delivered → continuation), consent-aware collection, export to BI.
- Cross-product event taxonomy (Discovery ↔ Precision ↔ Operation Hub).

**Payments (Stripe)**
- Checkout/session creation, price/product catalog (Premium), customer ↔ project linkage, webhooks and payment state, invoices/receipts, refunds, tax, reconciliation, payment events to analytics.
- Discovery must **not** create Stripe inside itself.

## D. Integrations required in the future (what Discovery needs from each service)
| Service | Data | Events | Actions | Permissions | Payments |
|---|---|---|---|---|---|
| **Administration** | read Discovery project metadata (id, status, step, locale, timestamps, no free text unless authorised); catalog versions; outbox state | `admin_action_*` audit events consumed/emitted | publish catalog version; resend/cancel delivery; trigger erasure (`fa4_anonymize_project`); manage allowlist; toggle flags | staff roles (viewer / operator / catalog-publisher / privacy-officer) mapped to Discovery actions; least-privilege DB access (no direct table access from the platform) | n/a |
| **Analytics** | the closed `fa4_event` records (codes, counts, `visit_id`, `project_id`, `catalog_version`) | existing 7 client + 19 server events (plus new ones only via the contract owner) | read/export aggregates; funnel definitions | data-minimisation: no e-mail/IP/UA/free text; consent rules | n/a |
| **Payments** | `project_id`, `result_id`, selected Premium offer/bundle, destination country/capabilities (from the sealed result), buyer e-mail (already captured), locale | `premium_continuation_requested` (exists) → future `checkout_started`, `payment_succeeded/failed`, `subscription_*` | create checkout for «Start Your Expansion» and return the **purchase URL** Discovery already knows how to consume (`VITE_FA4_PREMIUM_PURCHASE_URL`-style fail-closed contract) ; confirm payment back to the project | who may pay for a project (token-bound to the project), webhook authentication | **Needs from the service (B-1):** (1) a purchase destination/URL or API to create one per `project_id`+`result_id`; (2) a signed webhook/event back to mark the continuation paid/active; (3) price/offer definition; (4) tax/invoice responsibility; (5) failure/cancel return URLs; (6) hand-off to Sherpa/Operation Hub after payment (B-2) |

## E. Current implementations: reuse / wrap / integrate / replace later
| Existing | Option | Note |
|---|---|---|
| `fa4_event` + `/events` + closed schemas | **Wrap** (forward to the shared analytics sink; keep the contract) or **reuse as the Discovery adapter** | contract stays owned by Discovery |
| Catalog seed + versioned `fa4_catalog_*` tables + `seed-fa4-catalog.ts` | **Integrate** (admin UI writes through the same versioning) | no schema change needed to start |
| `fa4_continuation_request` + `premium_continuation_requested` + fail-closed CTA | **Reuse as the hook** for the future Payments service; replace the "row only" behaviour later | exact insertion point for B-1/B-2 |
| `fa4_anonymize_project`, retention, erasure log | **Integrate** under Administration (privacy officer action) | |
| Outbox `fa4_email_delivery` (+ worker) | **Keep in Discovery**; expose state to Administration read-only | |
| Basic access gate / reviewer allowlist | **Replace later** with shared staff identity | |
| Legacy `admin/`, `premium/` (billing router, simulated checkout), `analytics/` modules in the image | **Do not enable for Discovery**; candidates to evaluate as seeds for the shared services or retire | `devSimulatedCheckout` stays unreachable in production |
| Cloud Monitoring alerts | **Integrate** (shared observability; add the pending uptime check) | |

## F. Risks / pending decisions
1. **Premium destination (B-1) and hand-off (B-2)** remain external; Discovery only needs the Payments contract above. No Stripe inside Discovery.
2. **Ownership of event taxonomy:** who owns names/properties once Analytics is shared (today Discovery's closed contract; changes need Product + Analytics owner).
3. **Identity of staff vs. Basic gate:** the shared Administration must provide SSO before the gate is retired; until then the gate is the only control.
4. **Data-access model:** shared services must go through APIs/events or least-privilege roles, not the Discovery runtime role (DSC-36 note: DB grants on convergence).
5. **Legacy modules in the image** (`admin`, `premium`, `analytics`, simulated checkout): present but unmounted by configuration; risk is accidental enabling by env — mitigated by the production env check (DSC-34 #18). Decide retire vs. adopt.
6. **PII/consent:** LEGAL-1 / `FA4_PRIVACY_VERSION` (B-3) condition what Analytics and Payments may receive.
7. **L1 convergence:** any shared-service integration on this branch must be coordinated with L1; none is started here.

**Technical blocker for deploying the current code to Stabilization: NONE found.** The current code does not depend on any shared service, mounts no admin/billing/simulated-payment surface in production, and keeps analytics and premium fail-closed.
