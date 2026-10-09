/**
 * Stripe SANDBOX verification — to be run by the Product Owner with HIS Stripe TEST keys. Written in F5 Track B; it has
 * NOT been run against Stripe (no credentials were available when it was written). Until it passes, the honest label of
 * the Stripe track stays "IN BUILD — adapter complete, contract-tested against a fake; SANDBOX not verified".
 *
 * What it verifies, end to end against the real Stripe test environment:
 *   1. the key is a TEST key and the configured price is an active one-time price;
 *   2. a Hosted Checkout Session is created through the real adapter for an existing eligible project;
 *   3. (you pay with a Stripe test card) the signed webhook forwarded by the Stripe CLI activates Premium exactly once;
 *   4. the same payment seen again through reconciliation (second channel) creates no second activation;
 *   5. optional --duplicate-payment: a second paid session for the same project -> NOT_APPLICABLE_DUPLICATE_PAYMENT, one subscription;
 *   6. optional --refund-check: a refund you issue in the Dashboard/CLI is recorded + alerted and access is unchanged.
 *
 * Usage (backend/):
 *   export DATABASE_URL=postgres://...            # a SANDBOX database that already has all migrations applied
 *   export APP_BASE_URL=http://localhost:5173     # any http(s) URL; used for return links
 *   export STRIPE_SECRET_KEY=sk_test_...          # TEST key only: sk_live_ / rk_live_ are refused
 *   export STRIPE_PRICE_ID=price_...              # a one-time price
 *   export STRIPE_WEBHOOK_SECRET=whsec_...        # from `stripe listen --print-secret`
 *   export STRIPE_SUCCESS_URL=$APP_BASE_URL/premium/return STRIPE_CANCEL_URL=$APP_BASE_URL/premium
 *   export VERIFY_PROJECT_ID=<uuid of a COMPLETED_LOCKED project that never entered Premium, in that database>
 *   # in another terminal:  stripe listen --forward-to localhost:4242/api/billing/stripe/webhook
 *   npx tsx scripts/stripe-sandbox-verify.ts --i-understand-this-writes-test-data [--duplicate-payment] [--refund-check]
 */
import { Pool } from "pg";
import { createApp, baseDepsFromEnv } from "../src/index";
import { createPoolDb } from "../src/db/database";
import { BundleStore } from "../src/fa/services/bundle-store";
import { premiumPolicyFromEnv } from "../src/premium/premium-policy";
import { requestPremiumActivation } from "../src/premium/premium-service";
import { StripeCheckout } from "../src/premium/stripe/checkout-adapter";
import { StripeClient } from "../src/premium/stripe/client";
import { isLiveKey, stripeConfigFromEnv, stripeLivemodeExpected } from "../src/premium/stripe/config";
import { getPaymentConfirmationState } from "../src/premium/stripe/payment-state";
import { reconcileStripe } from "../src/premium/stripe/reconcile";
import { jsonLogger } from "../src/security/redact";

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok, ...(detail ? { detail } : {}) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(label: string, probe: () => Promise<T | null>, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`waiting for ${label} `);
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) {
      console.log("done");
      return value;
    }
    process.stdout.write(".");
    await sleep(2000);
  }
  console.log("timed out");
  return null;
}

async function main(): Promise<void> {
  const env = process.env;
  const key = env.STRIPE_SECRET_KEY ?? "";
  if (isLiveKey(key) || key.startsWith("sk_live_") || key.startsWith("rk_live_")) throw new Error("refusing to run: a LIVE Stripe key was supplied. Use a TEST key (sk_test_...).");
  if (!/^(sk|rk)_test_/.test(key)) throw new Error("refusing to run: STRIPE_SECRET_KEY must be a Stripe TEST key (sk_test_... or rk_test_...).");
  if (!process.argv.includes("--i-understand-this-writes-test-data")) throw new Error("refusing to run: pass --i-understand-this-writes-test-data (this writes to DATABASE_URL: use a sandbox database).");
  if (env.NODE_ENV === "production") throw new Error("refusing to run with NODE_ENV=production");
  for (const name of ["DATABASE_URL", "APP_BASE_URL", "VERIFY_PROJECT_ID"]) if (!env[name]) throw new Error(`${name} is required`);
  const projectId = env.VERIFY_PROJECT_ID as string;
  const port = Number(env.VERIFY_PORT ?? 4242);
  const waitMs = Number(env.VERIFY_WAIT_SECONDS ?? 600) * 1000;
  const duplicate = process.argv.includes("--duplicate-payment");
  const refund = process.argv.includes("--refund-check");

  const config = stripeConfigFromEnv({ ...env, STRIPE_API_BASE_URL: undefined });
  if (stripeLivemodeExpected(config)) throw new Error("refusing to run: configuration resolved to live mode");
  const policy = premiumPolicyFromEnv(env);
  const client = new StripeClient(config);

  // 1. Preflight against the real Stripe test API.
  const price = await client.retrievePrice(config.priceId);
  check("price is active, one-time, test mode", price.active === true && price.type === "one_time" && price.livemode === false, `${price.currency ?? "?"} ${price.unit_amount ?? "?"}`);
  if (config.productId) check("price belongs to STRIPE_PRODUCT_ID", (typeof price.product === "string" ? price.product : price.product?.id) === config.productId);

  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const db = createPoolDb(pool);
  const bundles = new BundleStore(db);
  const base = baseDepsFromEnv(env);
  const faDeps = { ...base, premium: { checkout: new StripeCheckout(client, jsonLogger) } };
  const webhook = { db, bundles, webhookSecrets: config.webhookSecrets, livemode: false, policy, log: jsonLogger };
  const server = createApp({ fa: faDeps, stripe: webhook }).listen(port);
  console.log(`\nwebhook listening on http://localhost:${port}/api/billing/stripe/webhook`);
  console.log(`In another terminal run:  stripe listen --forward-to localhost:${port}/api/billing/stripe/webhook\n`);

  try {
    const count = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: string }>(sql, params)).rows[0]?.n ?? 0);

    // 2. Create the Checkout Session through the real adapter.
    const person = (await db.query<{ created_by_person_id: string; interface_language: string }>(
      "SELECT p.created_by_person_id, pe.interface_language FROM project p JOIN person pe ON pe.person_id = p.created_by_person_id WHERE p.project_id = $1", [projectId])).rows[0];
    if (!person) throw new Error("VERIFY_PROJECT_ID not found in DATABASE_URL");
    const started = await requestPremiumActivation(faDeps, projectId, person.created_by_person_id, { acceptTerms: true, interfaceLanguage: person.interface_language });
    check("checkout session created (redirect outcome)", started.outcome.kind === "redirect");
    if (started.outcome.kind !== "redirect") throw new Error("project is not eligible for a new Premium activation (needs COMPLETED_LOCKED and no previous Premium)");
    const session = (await db.query<{ stripe_session_id: string }>("SELECT stripe_session_id FROM premium_checkout WHERE project_id = $1 AND status = 'open'", [projectId])).rows[0];
    check("exactly one open session recorded for the project", Boolean(session) && (await count("SELECT count(*) AS n FROM premium_checkout WHERE project_id = $1 AND status = 'open'", [projectId])) === 1);
    check("Premium is NOT active before payment (redirect alone grants nothing)", (await getPaymentConfirmationState(db, projectId, new Date())).state === "confirming");
    console.log(`\nOpen this URL and pay with the Stripe TEST card 4242 4242 4242 4242 (any future date, any CVC):\n\n  ${started.outcome.url}\n`);

    // 3. Wait for the signed webhook to activate Premium.
    const activated = await waitFor("the webhook to activate Premium", async () => ((await count("SELECT count(*) AS n FROM subscription WHERE project_id = $1 AND status = 'PREMIUM_ACTIVE'", [projectId])) > 0 ? true : null), waitMs);
    check("webhook activated Premium", activated === true);
    if (activated) {
      check("exactly one subscription and one activation event", (await count("SELECT count(*) AS n FROM subscription WHERE project_id = $1", [projectId])) === 1 && (await count("SELECT count(*) AS n FROM subscription_event WHERE project_id = $1", [projectId])) === 1);
      const inbound = (await db.query<{ type: string; outcome: string }>("SELECT type, outcome FROM billing_inbound_event WHERE stripe_session_id = $1 ORDER BY received_at", [session?.stripe_session_id])).rows;
      check("signed events stored with outcomes", inbound.some((e) => e.outcome === "ACTIVATED"), inbound.map((e) => `${e.type}:${e.outcome}`).join(", "));
      check("entitlement is FULL and the confirmation state is 'active'", (await count("SELECT count(*) AS n FROM entitlement WHERE project_id = $1 AND precision_access_mode = 'FULL'", [projectId])) === 1 && (await getPaymentConfirmationState(db, projectId, new Date())).state === "active");

      // 4. Second channel: reconciliation must find nothing left to do.
      const rec = await reconcileStripe({ db, bundles, client, policy, log: jsonLogger });
      check("reconciliation after the webhook creates no second activation", rec.activated === 0 && (await count("SELECT count(*) AS n FROM subscription WHERE project_id = $1", [projectId])) === 1, JSON.stringify(rec));
      console.log("Optional: `stripe events resend <evt_id>` for any event above; the subscription count must stay 1.");

      // 5. Duplicate payment (optional).
      if (duplicate) {
        const second = await client.createCheckoutSession({ projectId, locale: "en", idempotencyKey: `sandbox-verify:${Date.now()}` });
        await db.query(
          `INSERT INTO premium_checkout (project_id, stripe_session_id, status, idempotency_key, checkout_url, interface_language, expires_at) VALUES ($1, $2, 'open', $3, $4, 'en', $5)`,
          [projectId, second.id, `sandbox-verify:${second.id}`, second.url, second.expires_at ? new Date(second.expires_at * 1000) : null],
        );
        console.log(`\nDuplicate-payment check: pay this SECOND session with the test card too:\n\n  ${second.url}\n`);
        const outcome = await waitFor("the duplicate payment to be processed", async () => (await db.query<{ outcome: string }>("SELECT outcome FROM premium_checkout WHERE stripe_session_id = $1 AND status = 'completed'", [second.id])).rows[0]?.outcome ?? null, waitMs);
        check("duplicate payment -> NOT_APPLICABLE_DUPLICATE_PAYMENT", outcome === "NOT_APPLICABLE_DUPLICATE_PAYMENT", String(outcome));
        check("still exactly one subscription; an operational alert exists", (await count("SELECT count(*) AS n FROM subscription WHERE project_id = $1", [projectId])) === 1 && (await count("SELECT count(*) AS n FROM billing_alert WHERE project_id = $1 AND kind = 'duplicate_payment'", [projectId])) === 1);
      }

      // 6. Refund (optional): record + alert, access unchanged.
      if (refund) {
        console.log("\nRefund check: refund the payment in the Stripe Dashboard (test mode) or `stripe refunds create --payment-intent <pi_...>`.");
        const alert = await waitFor("the refund event", async () => ((await count("SELECT count(*) AS n FROM billing_alert WHERE project_id = $1 AND kind = 'charge_refunded'", [projectId])) > 0 ? true : null), waitMs);
        check("refund recorded + alerted", alert === true);
        check("access unchanged after the refund (no automatic revocation in v1)", (await count("SELECT count(*) AS n FROM entitlement WHERE project_id = $1 AND precision_access_mode = 'FULL'", [projectId])) === 1);
      }
    }
  } finally {
    server.close();
    await pool.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length === 0) console.log("All executed checks passed. Record this run (date, Stripe account mode=test, which optional checks ran) in docs/f5/stripe-track-status.md to move the label to SANDBOX.");
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`stripe sandbox verification stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
});
