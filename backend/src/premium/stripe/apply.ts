import { Db } from "../../db/database";
import { isUuid } from "../../fa/services/analytics";
import { BundleStore } from "../../fa/services/bundle-store";
import { FaError } from "../../fa/services/errors";
import { Logger } from "../../security/redact";
import { PremiumPolicy, addDays } from "../premium-policy";
import { processSubscriptionEvent } from "../subscription-events";
import { StripeCheckoutSession, paymentIntentId } from "./client";

/**
 * Applying what Stripe reported to Core. The ONLY way Premium gets activated from a payment is
 * `applyPaidCheckoutSession`, called from a signature-verified webhook or from reconciliation — never from a browser
 * redirect. Both paths use the same idempotency key (derived from the Checkout Session id), so one payment can never
 * produce two activations however many times, and through whichever channel, it is reported.
 */
export type ApplyOutcome =
  | "ACTIVATED"
  | "ALREADY_APPLIED"
  | "NOT_APPLICABLE_DUPLICATE_PAYMENT"
  | "NOT_APPLICABLE_NOT_ELIGIBLE"
  | "REJECTED_MAPPING"
  | "UNMATCHED_SESSION";

export interface ApplyContext {
  bundles: BundleStore;
  policy: PremiumPolicy;
  now: Date;
  log: Logger;
  /** webhook | reconciliation: recorded as the subscription_event source. */
  via: "stripe_webhook" | "stripe_reconciliation";
}

export interface ApplyResult {
  outcome: ApplyOutcome;
  projectId: string | null;
}

export function activationKey(sessionId: string): string {
  return `stripe:session:${sessionId}:paid`;
}

/** Records an operational alert once per (kind, stripe_ref). Ids and codes only — no personal or payment data. */
export async function recordAlert(tx: Db, log: Logger, alert: { kind: string; projectId: string | null; stripeRef: string | null; detail?: Record<string, string | number | boolean | null> }): Promise<void> {
  const inserted = await tx.query(
    `INSERT INTO billing_alert (kind, project_id, stripe_ref, detail) VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (kind, stripe_ref) WHERE stripe_ref IS NOT NULL DO NOTHING`,
    [alert.kind, alert.projectId, alert.stripeRef, JSON.stringify(alert.detail ?? {})],
  );
  if ((inserted.rowCount ?? 0) > 0) log("error", `billing alert: ${alert.kind}`, { kind: alert.kind, project_id: alert.projectId, stripe_ref: alert.stripeRef });
}

interface CheckoutRow {
  checkout_id: string;
  project_id: string;
  status: "open" | "completed" | "expired" | "failed";
  outcome: string | null;
}

/** The explicit session -> project mapping: client_reference_id AND metadata.project_id must both name the same project. Never an e-mail address. */
export function mappedProjectId(session: StripeCheckoutSession): string | null {
  const ref = session.client_reference_id;
  const meta = session.metadata?.project_id;
  if (typeof ref !== "string" || typeof meta !== "string" || ref !== meta || !isUuid(ref)) return null;
  return ref;
}

export async function applyPaidCheckoutSession(tx: Db, session: StripeCheckoutSession, ctx: ApplyContext): Promise<ApplyResult> {
  const mapped = mappedProjectId(session);
  const { rows } = await tx.query<CheckoutRow>("SELECT checkout_id, project_id, status, outcome FROM premium_checkout WHERE stripe_session_id = $1 FOR UPDATE", [session.id]);
  const checkout = rows[0];
  if (!checkout) {
    await recordAlert(tx, ctx.log, { kind: "payment_unmatched_session", projectId: null, stripeRef: session.id });
    return { outcome: "UNMATCHED_SESSION", projectId: null };
  }
  if (!mapped || mapped !== checkout.project_id) {
    await recordAlert(tx, ctx.log, { kind: "payment_mapping_rejected", projectId: checkout.project_id, stripeRef: session.id });
    return { outcome: "REJECTED_MAPPING", projectId: checkout.project_id };
  }
  const projectId = checkout.project_id;
  if (checkout.status === "completed") return { outcome: "ALREADY_APPLIED", projectId };

  // Same lock order as processSubscriptionEvent: project row first. Activation always wins races with the retention job.
  await tx.query("SELECT project_id FROM project WHERE project_id = $1 FOR UPDATE", [projectId]);

  const key = activationKey(session.id);
  const seen = await tx.query("SELECT 1 FROM subscription_event WHERE idempotency_key = $1", [key]);
  const intent = paymentIntentId(session);
  const complete = async (outcome: string) => {
    await tx.query(
      `UPDATE premium_checkout SET status = 'completed', outcome = $2, completed_at = $3, paid_amount_total = $4,
              stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, $5), updated_at = $3
        WHERE checkout_id = $1`,
      [checkout.checkout_id, outcome, ctx.now, typeof session.amount_total === "number" ? session.amount_total : null, intent],
    );
  };
  if ((seen.rowCount ?? 0) > 0) {
    await complete("ACTIVATED");
    return { outcome: "ALREADY_APPLIED", projectId };
  }

  // An earlier paid period that already ran out must not turn a legitimate renewal into a "duplicate".
  const latest = (
    await tx.query<{ subscription_id: string; status: string; current_period_end: Date }>(
      "SELECT subscription_id, status, current_period_end FROM subscription WHERE project_id = $1 ORDER BY created_at DESC, current_period_start DESC LIMIT 1 FOR UPDATE",
      [projectId],
    )
  ).rows[0];
  if (latest && latest.status !== "PREMIUM_INACTIVE" && latest.current_period_end.getTime() <= ctx.now.getTime()) {
    await processSubscriptionEvent(tx, ctx.bundles, {
      projectId,
      eventType: "subscription_period_ended",
      occurredAt: latest.current_period_end,
      source: ctx.via,
      idempotencyKey: `period-end:${latest.subscription_id}`,
    });
  } else if (latest && latest.status !== "PREMIUM_INACTIVE") {
    // D-3: a second payment while Premium is still current never creates a second activation. Recorded + alerted, no refund/revocation here.
    await complete("NOT_APPLICABLE_DUPLICATE_PAYMENT");
    await recordAlert(tx, ctx.log, { kind: "duplicate_payment", projectId, stripeRef: session.id, detail: { payment_intent: intent } });
    return { outcome: "NOT_APPLICABLE_DUPLICATE_PAYMENT", projectId };
  }

  const ever = (await tx.query<{ premium_ever_activated: boolean }>("SELECT premium_ever_activated FROM project WHERE project_id = $1", [projectId])).rows[0]?.premium_ever_activated === true;
  try {
    await tx.transaction((inner) =>
      processSubscriptionEvent(inner, ctx.bundles, {
        projectId,
        eventType: ever ? "premium_reactivated" : "premium_activated",
        occurredAt: ctx.now,
        source: ctx.via,
        providerReference: session.id,
        idempotencyKey: key,
        periodStart: ctx.now,
        periodEnd: addDays(ctx.now, ctx.policy.accessPeriodDays),
      }),
    );
  } catch (error) {
    if (error instanceof FaError && error.code === "NOT_APPLICABLE") {
      // Money was received but this project cannot enter Premium (not a locked First Assessment, or a concurrent entry).
      await complete("NOT_APPLICABLE_NOT_ELIGIBLE");
      await recordAlert(tx, ctx.log, { kind: "payment_not_eligible", projectId, stripeRef: session.id, detail: { payment_intent: intent } });
      return { outcome: "NOT_APPLICABLE_NOT_ELIGIBLE", projectId };
    }
    throw error;
  }
  await complete("ACTIVATED");
  return { outcome: "ACTIVATED", projectId };
}

/** open -> expired / failed. Never downgrades a completed checkout, never reopens a terminal one. Returns the project when a row changed. */
export async function markCheckoutTerminal(tx: Db, sessionId: string, to: "expired" | "failed", now: Date): Promise<{ projectId: string | null; changed: boolean }> {
  const { rows } = await tx.query<CheckoutRow>("SELECT checkout_id, project_id, status, outcome FROM premium_checkout WHERE stripe_session_id = $1 FOR UPDATE", [sessionId]);
  const row = rows[0];
  if (!row) return { projectId: null, changed: false };
  if (row.status !== "open") return { projectId: row.project_id, changed: false };
  await tx.query("UPDATE premium_checkout SET status = $2, updated_at = $3 WHERE checkout_id = $1", [row.checkout_id, to, now]);
  return { projectId: row.project_id, changed: true };
}
