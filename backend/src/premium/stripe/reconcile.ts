import { Db } from "../../db/database";
import { BundleStore } from "../../fa/services/bundle-store";
import { Logger, describeError, jsonLogger } from "../../security/redact";
import { PremiumPolicy } from "../premium-policy";
import { ApplyContext, applyPaidCheckoutSession, markCheckoutTerminal } from "./apply";
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
}

export interface ReconcileStats {
  listed: number;
  activated: number;
  alreadyApplied: number;
  notApplicable: number;
  expired: number;
  failures: number;
}

const STALE_GRACE_MS = 10 * 60_000;

export async function reconcileStripe(deps: ReconcileDeps, options: ReconcileOptions = {}): Promise<ReconcileStats> {
  const now = (deps.now ?? (() => new Date()))();
  const log = deps.log ?? jsonLogger;
  const stats: ReconcileStats = { listed: 0, activated: 0, alreadyApplied: 0, notApplicable: 0, expired: 0, failures: 0 };
  const seen = new Set<string>();
  const ctx: ApplyContext = { bundles: deps.bundles, policy: deps.policy, now, log, via: "stripe_reconciliation" };

  const handle = async (session: StripeCheckoutSession): Promise<void> => {
    if (seen.has(session.id)) return;
    seen.add(session.id);
    // Sessions of other products in the same Stripe account carry no project mapping: not ours.
    if (!session.client_reference_id && !session.metadata?.project_id) return;
    try {
      await deps.db.transaction(async (tx) => {
        if (session.payment_status === "paid") {
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
  return stats;
}
