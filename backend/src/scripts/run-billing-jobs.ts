import { Pool } from "pg";
import { createPoolDb } from "../db/database";
import { BundleStore } from "../fa/services/bundle-store";
import { premiumPolicyFromEnv } from "../premium/premium-policy";
import { StripeClient } from "../premium/stripe/client";
import { stripeConfigFromEnv } from "../premium/stripe/config";
import { runBillingJobs } from "../premium/stripe/jobs";

/**
 * One run of the Premium/Stripe jobs (Stripe reconciliation when STRIPE_CHECKOUT_ENABLED=true, then the Core access sweep).
 *   npm run billing:jobs --workspace=backend
 * Safe to run repeatedly and concurrently with webhooks.
 */
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const db = createPoolDb(pool);
    const client = process.env.STRIPE_CHECKOUT_ENABLED === "true" ? new StripeClient(stripeConfigFromEnv(process.env)) : undefined;
    const result = await runBillingJobs({ db, bundles: new BundleStore(db), policy: premiumPolicyFromEnv(process.env), ...(client ? { client } : {}) });
    console.log(`billing jobs: ${JSON.stringify(result)}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`billing jobs failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
