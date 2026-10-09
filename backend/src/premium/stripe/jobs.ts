import { Db } from "../../db/database";
import { BundleStore } from "../../fa/services/bundle-store";
import { Logger, describeError, jsonLogger } from "../../security/redact";
import { PremiumPolicy } from "../premium-policy";
import { sweepPrecisionAccess } from "../precision-access";
import { StripeClient } from "./client";
import { reconcileStripe } from "./reconcile";

/** Scheduled Core jobs for Premium/Stripe: the access sweep (Core only) and Stripe reconciliation. Both are idempotent. */
export interface BillingJobDeps {
  db: Db;
  bundles: BundleStore;
  policy: PremiumPolicy;
  /** Absent when Stripe is not configured: only the Core sweep runs. */
  client?: StripeClient;
  now?: () => Date;
  log?: Logger;
}

export async function runBillingJobs(deps: BillingJobDeps): Promise<Record<string, unknown>> {
  const now = (deps.now ?? (() => new Date()))();
  const log = deps.log ?? jsonLogger;
  const result: Record<string, unknown> = {};
  // Reconcile first: a late payment must be applied before the sweep decides a period has run out.
  if (deps.client) {
    try {
      result.reconcile = await reconcileStripe({ db: deps.db, bundles: deps.bundles, client: deps.client, policy: deps.policy, now: () => now, log });
    } catch (error) {
      result.reconcile = { error: "reconciliation_failed" };
      log("error", "stripe reconciliation failed", { error: describeError(error) });
    }
  }
  result.sweep = await sweepPrecisionAccess(deps.db, deps.bundles, { now, policy: deps.policy });
  return result;
}
