# F5 Track B — Stripe adapter: status and evidence

**Status label: IN BUILD — adapter complete, contract-tested against a fake; SANDBOX not verified.**

Label scale (honest definition): NOT STARTED | IN BUILD | SANDBOX (verified end to end against a real Stripe *test* account) | VERIFIED (sandbox + reviewed by the Product Owner) | PRODUCTION READY (live account, live webhook, runbook rehearsed). Nothing in this track has touched real Stripe. No credentials were available and none were used or stored.

Branch `feature/f5-stripe` (worktree `wt-stripe`), built on the integration branch at `cc86719`.

## Architecture (fixed; implemented as decided)

```
Stripe -> Stripe adapter (backend/src/premium/stripe/*) -> Core payment/entitlement -> Precision (EntitlementProvider port)
```

- Precision never reads Stripe and never trusts a browser redirect. `CoreEntitlementProvider` reads `entitlement` + `subscription` only.
- Only `applyPaidCheckoutSession` can turn a payment into Premium. It is reached from a signature-verified webhook or from reconciliation, and both use the same idempotency key `stripe:session:<cs_id>:paid` through the existing `processSubscriptionEvent`.
- D-4: one-time payment, Hosted Checkout, `mode=payment`. The Premium period is **Core configuration** (`PREMIUM_ACCESS_PERIOD_DAYS`, default 365) and is snapshotted in `subscription.current_period_start/end`. The read-only window after Premium is **Core configuration** (`PRECISION_READONLY_GRACE_DAYS`, default 90), snapshotted in `entitlement.grace_days_applied`. Neither number appears in adapter or sweep logic. **Both defaults are placeholders awaiting a Product Owner decision.**
- D-3: second/erroneous payment while Premium is current -> `NOT_APPLICABLE_DUPLICATE_PAYMENT`, HTTP 200, `billing_alert`, no second activation. Refund / dispute / dispute-closed -> recorded + alert, **no** automatic revocation.

## What exists

| Area | Files |
|---|---|
| Stripe REST client (no SDK; fetch; injectable fetch + config; retries with idempotency key; errors carry status/type/code only) | `backend/src/premium/stripe/client.ts`, `config.ts` |
| Checkout adapter (`CheckoutAdapter`; one open session per project; resume of the same session; neutral 503 on Stripe failure) | `.../stripe/checkout-adapter.ts`, `premium/checkout.ts` (optional `resume`), `premium/premium-service.ts` |
| Webhook (raw body, `Stripe-Signature` t/v1, 300 s, constant time, several v1/secrets) | `.../stripe/signature.ts`, `webhook.ts`; mounted at `POST /api/billing/stripe/webhook` in `src/index.ts` |
| Apply / duplicate / alerts | `.../stripe/apply.ts` |
| Reconciliation + scheduled jobs | `.../stripe/reconcile.ts`, `jobs.ts`, `src/scripts/run-billing-jobs.ts` (`npm run billing:jobs`), `src/worker.ts` (every 10 min) |
| Core policy, Precision access state, sweep | `premium/premium-policy.ts`, `premium/precision-access.ts` |
| `CoreEntitlementProvider` (port `EntitlementProvider`; `describe()` = REAL / NOT_VERIFIED) | `backend/src/precision/adapters/core-entitlement.ts` |
| "Payment pending confirmation" read model | `.../stripe/payment-state.ts`; `GET /api/fa/session/premium/payment-state` (Bearer session token, same auth as `/api/fa/session/*`) -> `{ "state": "confirming" \| "active" \| "not_started" \| "failed_retry" }`, `Cache-Control: no-store` |
| Legacy FA-3.0 push retired | `premium/subscription-events.ts` no longer builds the package or emits `precision.handoff_package_generated`; `premium/precision-handoff.ts` marked SUPERSEDED (file kept so pre-F5 stored packages stay readable; nothing new writes `precision_handoff_package`) |
| Migrations | `0021_stripe_billing.sql` (drizzle-generated: `premium_checkout`, `billing_inbound_event`, `billing_alert`, entitlement columns), `0022_stripe_billing_integrity.sql` (custom: backfill, CHECKs, sync-trigger update, guards; revert SQL in its header) |
| Sandbox verification script (NOT RUN) | `backend/scripts/stripe-sandbox-verify.ts` (`npm run stripe:sandbox-verify`) |
| Tests | see below |

### Data model added (all additive)

- `premium_checkout`: one row per Checkout Session; `stripe_session_id` UNIQUE; **partial unique index = one `open` session per project**; status `open|completed|expired|failed` (forward-only trigger; `expired -> completed` is the only back-step, so a late payment is never lost); amount/currency snapshot as Stripe returned; idempotency key `checkout:<request>:<attempt>` UNIQUE.
- `billing_inbound_event`: every verified event once (`stripe_event_id` UNIQUE), `received_at`, `processed_at`, `outcome`, minimal non-personal `summary` (ids, status words, amounts, payload sha256 — never the payload), `attempts`.
- `billing_alert`: operational alerts, unique per `(kind, stripe_ref)`; read with `SELECT * FROM billing_alert WHERE acknowledged_at IS NULL`; each new alert also logs one `ERROR` line `billing alert: <kind>`.
- `entitlement` (+5 columns): `precision_access_mode` FULL|READ_ONLY|REVOKED, `premium_ended_at`, `readonly_until`, `grace_days_applied`, `revoked_at`. CHECKs: `premium_access_active <=> mode = 'FULL'`, shape per mode; guard: never deleted, mode moves FULL -> READ_ONLY -> REVOKED or back to FULL only, settled window immutable.
- The subscription -> entitlement sync trigger (0010) was replaced so the same statement that grants Premium sets FULL and clears every end-of-Premium field (automatic return to FULL on a new confirmed payment for the same `project_id`, whichever path created the subscription) and the statement that ends Premium sets READ_ONLY.

### Webhook outcome codes (`billing_inbound_event.outcome`)

`ACTIVATED`, `ALREADY_APPLIED`, `NOT_APPLICABLE_DUPLICATE_PAYMENT`, `NOT_APPLICABLE_NOT_ELIGIBLE` (money received, project cannot enter Premium: 200 + alert, no retry storm), `REJECTED_MAPPING` (client_reference_id and metadata.project_id must both be present and equal the project of our own checkout row), `UNMATCHED_SESSION` (no checkout row of ours: nothing activated, alert), `AWAITING_PAYMENT_CONFIRMATION` (unpaid/async), `CHECKOUT_EXPIRED`, `CHECKOUT_FAILED` (+alert), `NO_CHANGE`, `RECORDED_ALERTED` (refund/dispute), `STORED_UNHANDLED_TYPE`, `IGNORED_LIVEMODE_MISMATCH`, `IGNORED_UNKNOWN_SESSION`, `IGNORED_MALFORMED`. Wrong signature/timestamp/non-event body: HTTP 400 `{"error":"invalid_request"}`, nothing stored. Unexpected failure: 500 (Stripe retries); the stored row shows received-but-unprocessed.

### Configuration (environment; nothing hard-coded, nothing logged)

| Variable | Purpose |
|---|---|
| `STRIPE_CHECKOUT_ENABLED=true` | turns the adapter + webhook on (requires `FA_API_ENABLED` for checkout); mutually exclusive with `PREMIUM_DEV_SIMULATION` |
| `STRIPE_SECRET_KEY` | `sk_test_`/`rk_test_`; a live key is refused unless `NODE_ENV=production` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...`; comma-separated list allowed for rotation |
| `STRIPE_PRICE_ID` | one-time price (`price_...`); `STRIPE_PRODUCT_ID` optional (checked by the sandbox script) |
| `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL` | hosted-page return URLs (no session id, no authority in them) |
| `STRIPE_API_BASE_URL` | tests only; refused in production |
| `STRIPE_API_VERSION` | pinned `Stripe-Version` (default `2024-06-20`) |
| `PREMIUM_ACCESS_PERIOD_DAYS` (default 365), `PRECISION_READONLY_GRACE_DAYS` (default 90) | Core policy |
| `PRECISION_ENTITLEMENT_PROVIDER=core` | lead's registry; construct with `new CoreEntitlementProvider(db, { policy: premiumPolicyFromEnv(env) })` |

## Commands run and results (all on this branch, PostgreSQL 16 on localhost, db `beeside_stripe`)

Migrations: applied 0000-0022 in order with `psql -v ON_ERROR_STOP=1 -1 -f`; also applied 0000-0022 on a fresh scratch database with `npx drizzle-kit migrate` (23 migrations recorded) and `npx drizzle-kit check` ("Everything's fine"); backfill of pre-existing `entitlement` rows verified on a database that had rows at 0020 (active -> FULL, ended -> READ_ONLY).

| Command (from `backend/`) | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | no errors |
| `npx eslint "src/premium/**/*.ts" src/index.ts src/worker.ts src/precision/adapters/core-entitlement*.ts` | clean |
| `npx jest --runInBand` (unit, no DB) | **29 suites, 410 tests passed** (new: signature 6, config 4, client 7, webhook refusals 5, precision-access 6, core-entitlement 5) |
| `TEST_DATABASE_URL=postgres://beeside:beeside@localhost:5432/beeside_stripe npx jest --runInBand -c jest.integration.config.js src/__integration__/stripe.int` | **20 tests passed** (new file) |
| same, whole integration suite | 84 passed, 4 failed, 24 skipped. The 4 failures (`operations`, `fa-core`, `fa-lifecycle`, `rules-snapshot`) **fail identically on the untouched integration commit `cc86719`** (snapshot template `st-1.1.0` vs `st-1.0.0`, link-continue 404): pre-existing, not caused by this track. `premium`, `e2e-journey`, `admin` (the three suites I had to update for the legacy retirement) pass. |
| `psql "$TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f db/tests/precision/run_precision_tests.sql` | 140 PASS, 0 FAIL (new `60_stripe_core.sql`: 45 assertions S01-S19) |
| `db/tests/run_premium_tests.sql`, `db/tests/run_tests.sql` | 30 PASS and 34 PASS, 0 FAIL (existing suites still green after the trigger replacement) |
| `STRIPE_SECRET_KEY=sk_live_x npx tsx scripts/stripe-sandbox-verify.ts` (and `rk_live_`, no ack flag, missing env) | refuses, exit 2 (only the refusal paths were executed) |

`stripe.int.test.ts` covers: payment -> exactly one activation (period = configured days, no legacy package/event); redirect-only -> NOT activated (`confirming`); resume of the same session / stale session replaced / partial unique index; Stripe outage -> neutral 503, nothing half-recorded; duplicate id, replay, second-channel (`async_payment_succeeded` after `completed`) -> one activation; D-3 duplicate payment; wrong secret / stale / replay beyond tolerance -> 400 and nothing stored; out-of-order (success before `completed`, stale unpaid `completed`, late `expired`/`failed`); delayed payment method + async failure -> `failed_retry` and retry; refund / dispute created / dispute closed -> recorded, access unchanged; unknown type, unmatched session, mapping mismatch / half mapping, livemode mismatch; not-eligible project; reconciliation (missed webhook, repeat run, late webhook after it, sessions beyond the list window, expiry closure); late payment after local expiry; sweep FULL -> READ_ONLY -> REVOKED with a configurable window, idempotent, nothing deleted, then automatic return to FULL on a new payment; renewal before the sweep; no secret / signature / personal payload data in logs or audit rows.

## SIMULATED / NOT VERIFIED (read this before trusting anything above)

- **Stripe itself is a local fake** (`backend/src/__tests__/helpers/fake-stripe.ts`). The tests prove the adapter honours *my reading* of Stripe's contract (form encoding, `Idempotency-Key`, session fields, list pagination with `created[gte]`/`starting_after`, signature construction). They do not prove Stripe behaves like the fake. Points where my reading may be wrong and only the sandbox can confirm: `locale` values, session `url`/`expires_at` semantics, `payment_intent` presence on completed sessions, `payment_intent_data[metadata]` propagation to the charge, dispute event shape (`payment_intent` on the dispute object), `Stripe-Version` default, which events a real account delivers for the chosen payment methods.
- The webhook signature scheme is implemented from Stripe's documented `t=…,v1=…` HMAC-SHA256 construction and cross-checked against an independent `node:crypto` computation, **not** against a signature produced by Stripe or the Stripe CLI.
- `stripe-sandbox-verify.ts` is written and compiles (`tsc`), refusal paths executed; **the Stripe-facing steps have never run**.
- Concurrency is by design (project row lock, `premium_checkout ... FOR UPDATE`, event row `FOR UPDATE`, unique idempotency keys) and exercised on one connection; **not** load/parallel-tested with a real pool.
- `CoreEntitlementProvider.describe()` reports `REAL / NOT_VERIFIED` and must stay so until the sandbox script passes.

## Remaining gaps and risks

1. **Sandbox verification** (needs PO credentials; see below). Until it passes the label cannot move.
2. **Operational alert delivery** is a table + one ERROR log line per alert. No pager/e-mail/Slack hook exists in the repo; someone must watch `billing_alert` / the log until the lead picks a channel.
3. **Front end** (not touched): the return page must call `GET /api/fa/session/premium/payment-state` with the session Bearer token and poll while `confirming`; `STRIPE_SUCCESS_URL` must point at it. Private-link (token) clients have no equivalent read route yet (`/api/fa/links/...` variant) — add if the return page can be opened without a session.
4. **Policy defaults** (365-day period, 90-day read-only window) are placeholders, not decisions.
5. **Price/amount authority**: amount and currency are whatever the configured Stripe price says; the adapter records them but does not compare with a Core-side expected price.
6. **`precision_state` kept**: activation still flips `project.precision_state` to `STARTED` once (Core milestone, previously written by the same block as the legacy package). If the lead wants that flag retired too, it is one block in `processSubscriptionEvent`. `SubscriptionEventResult` no longer has `handoffGenerated` / `handoffPackageId` (nothing consumed them).
7. **Legacy leftovers**: `precision-handoff.ts` and the `precision_handoff_package` table remain (read-only legacy); `integrations/operation-hub.ts` still knows the `precision.handoff_package_generated` command but nothing emits it any more.
8. **Subscription end by clock**: the sweep now ends any subscription whose `current_period_end` passed (previously only a provider event did). Right for one-time payments; also applies to manually confirmed / dev-simulated subscriptions.
9. Refund/dispute handling is intentionally minimal (D-3): a refunded customer keeps access until a human acts on the alert.
10. The reconciliation job trusts Stripe's `payment_status` from the (signed) event / API response; it does not re-retrieve the session before activating from a webhook. Cheap to add if the PO wants belt and braces.

## What the Product Owner must provide / decide

- A Stripe **test** account: `sk_test_…` (or restricted key with Checkout Sessions read/write + Prices read), the one-time **price id**, and `stripe listen` (Stripe CLI) on a machine that can reach a sandbox database; then run `npm run stripe:sandbox-verify -- --i-understand-this-writes-test-data --duplicate-payment --refund-check` and keep the output.
- Decide: Premium access period (days), read-only window (days), price/currency, whether delayed payment methods (OXXO, SPEI, bank debit) are enabled in the Stripe account (they drive the `async_payment_*` paths), and where alerts go.
- Later, for PRODUCTION READY: live key + live webhook endpoint registered in the Stripe Dashboard, `NODE_ENV=production`, secrets in the secrets store, and a rehearsal of the runbook (missed webhook -> `billing:jobs`; duplicate payment alert -> manual refund in Stripe).

## Verification record (fill in when the sandbox script is run)

| Date | Who | Stripe mode | Checks that passed | Notes |
|---|---|---|---|---|
| — not run — | — | — | — | — |
