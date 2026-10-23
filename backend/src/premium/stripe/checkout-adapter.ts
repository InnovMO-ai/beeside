import { Db } from "../../db/database";
import { FaError } from "../../fa/services/errors";
import { Logger, jsonLogger } from "../../security/redact";
import { CheckoutAdapter, CheckoutOutcome, CheckoutRequest } from "../checkout";
import { StripeApiError, StripeClient } from "./client";

/**
 * Stripe Hosted Checkout as a CheckoutAdapter (one-time payment, or recurring when STRIPE_BILLING_MODE=subscription). It only creates and remembers the payment attempt:
 * returning `redirect` means "send the client to the hosted payment page" — never "Premium is active". Activation
 * happens only when a verified webhook (or reconciliation) reports the payment.
 *
 * One open session per project: while a session is open and not about to expire, begin()/resume() return that same
 * session's URL. The attempt idempotency key is `checkout:<activation request>:<attempt number>`.
 */
const REUSE_MARGIN_MS = 5 * 60_000;
/** Stripe needs a trial end comfortably in the future (its documented minimum is 48 h for Checkout; verified in the sandbox script). */
const MIN_TRIAL_MS = 49 * 3_600_000;

interface OpenRow {
  stripe_session_id: string;
  checkout_url: string | null;
  expires_at: Date | null;
  checkout_id: string;
}

export class StripeCheckout implements CheckoutAdapter {
  readonly name = "stripe_hosted_checkout";
  constructor(
    private readonly client: StripeClient,
    private readonly log: Logger = jsonLogger,
  ) {}

  async begin(tx: Db, request: CheckoutRequest) {
    return this.ensureSession(tx, request);
  }

  async resume(tx: Db, request: CheckoutRequest) {
    return this.ensureSession(tx, request);
  }

  private async ensureSession(tx: Db, request: CheckoutRequest): Promise<{ outcome: CheckoutOutcome; reference: string | null }> {
    // Serialize attempts for the project (callers already hold this lock; harmless to take it again).
    await tx.query("SELECT project_id FROM project WHERE project_id = $1 FOR UPDATE", [request.projectId]);
    const open = (
      await tx.query<OpenRow>("SELECT stripe_session_id, checkout_url, expires_at, checkout_id FROM premium_checkout WHERE project_id = $1 AND status = 'open'", [request.projectId])
    ).rows[0];
    if (open) {
      const stillUsable = open.checkout_url !== null && open.expires_at !== null && open.expires_at.getTime() - REUSE_MARGIN_MS > request.now.getTime();
      if (stillUsable) return { outcome: { kind: "redirect", url: open.checkout_url as string }, reference: open.stripe_session_id };
      // Stale: Stripe will not take a payment on it any more. Reconciliation still promotes it to completed if a payment surfaces late.
      await tx.query("UPDATE premium_checkout SET status = 'expired', updated_at = $2 WHERE checkout_id = $1", [open.checkout_id, request.now]);
    }

    const language = (await tx.query<{ interface_language: string }>("SELECT interface_language FROM premium_activation_request WHERE request_id = $1", [request.requestId])).rows[0]?.interface_language;
    const locale = language === "es" ? "es" : "en";
    const attempt = Number((await tx.query<{ n: string }>("SELECT count(*)::text AS n FROM premium_checkout WHERE request_id = $1", [request.requestId])).rows[0]?.n ?? 0) + 1;
    const idempotencyKey = `checkout:${request.requestId}:${attempt}`;

    const subscriptionMode = this.client.billingMode === "subscription";
    // THE STACKING RULE at the provider boundary: the first charge happens when the access the project already holds runs out
    // (free days, sponsored period, ...), so the client never pays for a day that is already covered. When less than the provider's
    // minimum remains, charging now is harmless: the subscription event shifts the paid term to start where the held access ends.
    let trialEnd: number | undefined;
    if (subscriptionMode) {
      const covered = (await tx.query<{ t: Date }>("SELECT entitlement_covered_until($1, $2) AS t", [request.projectId, request.now])).rows[0]?.t;
      if (covered && covered.getTime() - request.now.getTime() >= MIN_TRIAL_MS) trialEnd = Math.floor(covered.getTime() / 1000);
    }

    let session;
    try {
      session = await this.client.createCheckoutSession({ projectId: request.projectId, locale, idempotencyKey, ...(trialEnd ? { trialEnd } : {}) });
    } catch (error) {
      // Customer-facing surfaces never see Stripe errors: a neutral, retryable message. The cause is logged as codes only.
      const detail = error instanceof StripeApiError ? { status: error.status, type: error.type, code: error.code } : { status: -1, type: null, code: null };
      this.log("error", "stripe checkout session could not be created", detail);
      throw new FaError("NOT_READY", "Premium activation is temporarily unavailable. Please try again in a few minutes.");
    }
    if (!session.id || !session.url || session.mode !== (subscriptionMode ? "subscription" : "payment")) {
      this.log("error", "stripe checkout session response was not usable", {});
      throw new FaError("NOT_READY", "Premium activation is temporarily unavailable. Please try again in a few minutes.");
    }
    await tx.query(
      `INSERT INTO premium_checkout (project_id, request_id, stripe_session_id, status, idempotency_key, checkout_url, interface_language, amount_total, currency, expires_at, billing_mode, created_at, updated_at)
       VALUES ($1, $2, $3, 'open', $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
      [
        request.projectId,
        request.requestId,
        session.id,
        idempotencyKey,
        session.url,
        locale,
        typeof session.amount_total === "number" ? session.amount_total : null,
        typeof session.currency === "string" ? session.currency.toLowerCase() : null,
        typeof session.expires_at === "number" ? new Date(session.expires_at * 1000) : null,
        subscriptionMode ? "subscription" : "payment",
        request.now,
      ],
    );
    return { outcome: { kind: "redirect", url: session.url }, reference: session.id };
  }
}
