import { Db } from "../../db/database";
import { BundleStore } from "../../fa/services/bundle-store";
import { Logger, describeError, jsonLogger } from "../../security/redact";
import { PremiumPolicy } from "../premium-policy";
import { ApplyContext, applyPaidCheckoutSession, markCheckoutTerminal } from "./apply";
import { applySubscriptionState, linkSubscriptionCheckout } from "./apply-subscription";
import { StripeCheckoutSession, StripeClient } from "./client";

/**
 * Reconciliation: asks Stripe (server to server, with the secret key — never the browser) what happened to recent
 * Checkout Sessions, and applies what a missed or delayed webhook left undone, through the SAME idempotent path the
 * webhook uses (so running it any number of times, or racing a late webhook, can never activate twice).
 *   1. recent sessions (default last 72 h): paid -> activation path; expired -> mark expired;
 *   2. our own open sessions the list did not cover: retrieved one by one; stale ones (past their expiry) are closed.
 */
export interface ReconcileDeps {
  db: Db;
  bundles: BundleStore;
  client: StripeClient;
  policy: PremiumPolicy;
  now?: () => Date;
  log?: Logger;
}

export interface ReconcileOptions {
  lookbackHours?: number;
  /** Safety cap on list pages (100 sessions each). */
  maxPages?: number;
  /** Safety cap on individually retrieved open sessions. */
  maxOpenRetrievals?: number;
  /** Safety cap on subscriptions compared with Stripe in one run. */
  maxSubscriptions?: number;
}

export interface ReconcileStats {
  listed: number;
  activated: number;
  alreadyApplied: number;
  notApplicable: number;
  expired: number;
  failures: number;
  /** Recurring: subscriptions compared with Stripe, and how many changed Core (activation, renewal, cancellation, end). */
  subscriptionsChecked: number;
  subscriptionsApplied: number;
}

const STALE_GRACE_MS = 10 * 60_000;

export async function reconcileStripe(deps: ReconcileDeps, options: ReconcileOptions = {}): Promise<ReconcileStats> {
  const now = (deps.now ?? (() => new Date()))();
  const log = deps.log ?? jsonLogger;
  const stats: ReconcileStats = { listed: 0, activated: 0, alreadyApplied: 0, notApplicable: 0, expired: 0, failures: 0, subscriptionsChecked: 0, subscriptionsApplied: 0 };
  const seen = new Set<string>();
  const ctx: ApplyContext = { bundles: deps.bundles, policy: deps.policy, now, log, via: "stripe_reconciliation" };

  const handle = async (session: StripeCheckoutSession): Promise<void> => {
    if (seen.has(session.id)) return;
    seen.add(session.id);
    // Sessions of other products in the same Stripe account carry no project mapping: not ours.
    if (!session.client_reference_id && !session.metadata?.project_id) return;
    try {
      await deps.db.transaction(async (tx) => {
        if (session.mode === "subscription" && session.status === "complete") {
          // Recurring: a completed session proves only that the subscription exists; money is reconciled per subscription below.
          await linkSubscriptionCheckout(tx, session, ctx);
        } else if (session.payment_status === "paid" && session.mode !== "subscription") {
          const result = await applyPaidCheckoutSession(tx, session, ctx);
          if (result.outcome === "ACTIVATED") stats.activated += 1;
          else if (result.outcome === "ALREADY_APPLIED") stats.alreadyApplied += 1;
          else stats.notApplicable += 1;
        } else if (session.status === "expired") {
          const { changed } = await markCheckoutTerminal(tx, session.id, "expired", now);
          if (changed) stats.expired += 1;
        } else if (session.status === "open") {
          // Still payable on Stripe's side. If it is past its expiry we know of, close it locally so a new attempt can start.
          const row = (await tx.query<{ expires_at: Date | null }>("SELECT expires_at FROM premium_checkout WHERE stripe_session_id = $1 AND status = 'open'", [session.id])).rows[0];
          if (row?.expires_at && row.expires_at.getTime() + STALE_GRACE_MS <= now.getTime()) {
            const { changed } = await markCheckoutTerminal(tx, session.id, "expired", now);
            if (changed) stats.expired += 1;
          }
        }
      });
    } catch (error) {
      stats.failures += 1;
      log("error", "stripe reconciliation could not apply a session", { error: describeError(error) });
    }
  };

  const createdGte = Math.floor(now.getTime() / 1000) - (options.lookbackHours ?? 72) * 3600;
  let startingAfter: string | undefined;
  for (let page = 0; page < (options.maxPages ?? 10); page++) {
    const list = await deps.client.listCheckoutSessions({ createdGte, ...(startingAfter ? { startingAfter } : {}) });
    stats.listed += list.data.length;
    for (const session of list.data) await handle(session);
    const last = list.data[list.data.length - 1];
    if (!list.has_more || !last) break;
    startingAfter = last.id;
  }

  const open = await deps.db.query<{ stripe_session_id: string }>(
    "SELECT stripe_session_id FROM premium_checkout WHERE status = 'open' ORDER BY created_at LIMIT $1",
    [options.maxOpenRetrievals ?? 50],
  );
  for (const row of open.rows) {
    if (seen.has(row.stripe_session_id)) continue;
    try {
      await handle(await deps.client.retrieveCheckoutSession(row.stripe_session_id));
    } catch (error) {
      stats.failures += 1;
      log("error", "stripe reconciliation could not retrieve a session", { error: describeError(error) });
    }
  }

  // Recurring billing: bring every subscription Core knows about in line with what Stripe says right now (fresh read, so a stale or
  // out-of-order webhook can never leave a cancellation or a renewal wrong for longer than one reconciliation cycle).
  const subs = await deps.db.query<{ stripe_subscription_id: string }>(
    `SELECT DISTINCT ON (c.stripe_subscription_id) c.stripe_subscription_id
       FROM premium_checkout c
      WHERE c.billing_mode = 'subscription' AND c.stripe_subscription_id IS NOT NULL AND c.created_at > $2::timestamptz - interval '400 days'
        AND (NOT EXISTS (SELECT 1 FROM subscription_event e WHERE e.idempotency_key = 'stripe:sub:' || c.stripe_subscription_id || ':activated')
             OR EXISTS (SELECT 1 FROM subscription s WHERE s.project_id = c.project_id AND s.status <> 'PREMIUM_INACTIVE'))
      ORDER BY c.stripe_subscription_id, c.created_at DESC
      LIMIT $1`,
    [options.maxSubscriptions ?? 200, now],
  );
  for (const row of subs.rows) {
    try {
      const sub = await deps.client.retrieveSubscription(row.stripe_subscription_id);
      stats.subscriptionsChecked += 1;
      const result = await deps.db.transaction((tx) => applySubscriptionState(tx, sub, ctx));
      if (["ACTIVATED", "RENEWED", "CANCELLATION_REQUESTED", "CANCELLATION_WITHDRAWN", "PERIOD_ENDED"].includes(result.outcome)) stats.subscriptionsApplied += 1;
    } catch (error) {
      stats.failures += 1;
      log("error", "stripe reconciliation could not sync a subscription", { error: describeError(error) });
    }
  }
  return stats;
}
