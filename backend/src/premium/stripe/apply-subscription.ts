import { Db } from "../../db/database";
import { isUuid, recordJourneyEvent } from "../../fa/services/analytics";
import { FaError } from "../../fa/services/errors";
import { processSubscriptionEvent } from "../subscription-events";
import { ApplyContext, recordAlert } from "./apply";
import { StripeInvoice, StripeSubscription, subscriptionId as subscriptionIdOf } from "./client";

/**
 * Recurring billing: what Stripe reported about a SUBSCRIPTION, applied to Core through the same provider-agnostic events as every
 * other source (premium_activated / premium_reactivated / subscription_renewed / cancellation_requested / cancellation_withdrawn /
 * subscription_period_ended). Stripe never decides access: it tells Core that money was collected for a term; Core records the term.
 *
 * Mapping to a project is explicit, never by e-mail: the project id travels in the subscription's own metadata (set at Checkout), and
 * must belong to a Core `premium_checkout` row created for that project in subscription mode. A Stripe subscription id, once linked, can
 * only ever belong to that one project.
 *
 * Idempotency is by (Stripe subscription, event meaning), not by delivery: the webhook and reconciliation converge on the same keys,
 * so a payment, a renewal or a cancellation is applied exactly once however many times and through whichever channel it is reported.
 */
export type SubscriptionOutcome =
  | "ACTIVATED"
  | "RENEWED"
  | "ALREADY_APPLIED"
  | "NO_PAYMENT_DUE"
  | "NO_PAID_PERIOD"
  | "NO_CHANGE"
  | "CANCELLATION_REQUESTED"
  | "CANCELLATION_WITHDRAWN"
  | "PERIOD_ENDED"
  | "PAST_DUE_RECORDED"
  | "PAYMENT_FAILURE_RECORDED"
  | "CHECKOUT_LINKED"
  | "NOT_APPLICABLE_DUPLICATE_PAYMENT"
  | "NOT_APPLICABLE_NOT_ELIGIBLE"
  | "REJECTED_MAPPING"
  | "IGNORED_NOT_OURS"
  | "UNMATCHED_SESSION";

export interface SubscriptionApplyResult {
  outcome: SubscriptionOutcome;
  projectId: string | null;
}

const epoch = (d: Date): number => Math.floor(d.getTime() / 1000);
const fromEpoch = (s: number): Date => new Date(s * 1000);

export const activatedKey = (subId: string): string => `stripe:sub:${subId}:activated`;
export const renewedKey = (subId: string, periodEnd: Date): string => `stripe:sub:${subId}:renewed:${epoch(periodEnd)}`;

interface LatestRow {
  subscription_id: string;
  status: "PREMIUM_ACTIVE" | "CANCELLATION_SCHEDULED" | "PREMIUM_INACTIVE";
  current_period_end: Date;
  auto_renews: boolean;
}

async function latestRow(tx: Db, projectId: string): Promise<LatestRow | undefined> {
  return (
    await tx.query<LatestRow>(
      "SELECT subscription_id, status, current_period_end, auto_renews FROM subscription WHERE project_id = $1 ORDER BY created_at DESC, current_period_start DESC LIMIT 1 FOR UPDATE",
      [projectId],
    )
  ).rows[0];
}

/**
 * Resolves and validates the project of a Stripe subscription. Returns null (after alerting) when the mapping cannot be trusted.
 * Links the Stripe subscription id to the project's latest subscription-mode checkout the first time it is seen.
 */
type Resolved = { kind: "ok"; projectId: string } | { kind: "not_ours" } | { kind: "rejected" };

async function resolveProject(tx: Db, subId: string, metadataProject: unknown, ctx: ApplyContext, stripeRef: string): Promise<Resolved> {
  const linked = (await tx.query<{ project_id: string }>("SELECT project_id FROM premium_checkout WHERE stripe_subscription_id = $1 LIMIT 1", [subId])).rows[0]?.project_id ?? null;
  if (linked) {
    if (isUuid(metadataProject) && metadataProject !== linked) {
      await recordAlert(tx, ctx.log, { kind: "payment_mapping_rejected", projectId: linked, stripeRef });
      return { kind: "rejected" };
    }
    return { kind: "ok", projectId: linked };
  }
  // Another product of the same Stripe account carries no project mapping: not ours, and not worth an alert.
  if (!isUuid(metadataProject)) return { kind: "not_ours" };
  const checkout = (
    await tx.query<{ checkout_id: string }>(
      "SELECT checkout_id FROM premium_checkout WHERE project_id = $1 AND billing_mode = 'subscription' AND stripe_subscription_id IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
      [metadataProject],
    )
  ).rows[0];
  if (!checkout) {
    await recordAlert(tx, ctx.log, { kind: "payment_mapping_rejected", projectId: null, stripeRef, detail: { reason: "no_subscription_checkout" } });
    return { kind: "rejected" };
  }
  await tx.query("UPDATE premium_checkout SET stripe_subscription_id = $2, updated_at = $3 WHERE checkout_id = $1", [checkout.checkout_id, subId, ctx.now]);
  return { kind: "ok", projectId: metadataProject };
}

/** checkout.session.completed in subscription mode: the subscription exists, but nothing has been COLLECTED yet. Links, never activates. */
export async function linkSubscriptionCheckout(
  tx: Db,
  session: { id: string; client_reference_id?: string | null; metadata?: Record<string, string> | null; subscription?: string | { id?: string } | null },
  ctx: ApplyContext,
): Promise<SubscriptionApplyResult> {
  const subId = subscriptionIdOf(session);
  const checkout = (await tx.query<{ checkout_id: string; project_id: string; status: string; billing_mode: string }>(
    "SELECT checkout_id, project_id, status, billing_mode FROM premium_checkout WHERE stripe_session_id = $1 FOR UPDATE",
    [session.id],
  )).rows[0];
  if (!checkout) {
    await recordAlert(tx, ctx.log, { kind: "payment_unmatched_session", projectId: null, stripeRef: session.id });
    return { outcome: "UNMATCHED_SESSION", projectId: null };
  }
  const ref = session.client_reference_id;
  if (checkout.billing_mode !== "subscription" || !subId || ref !== checkout.project_id || session.metadata?.project_id !== checkout.project_id) {
    await recordAlert(tx, ctx.log, { kind: "payment_mapping_rejected", projectId: checkout.project_id, stripeRef: session.id });
    return { outcome: "REJECTED_MAPPING", projectId: checkout.project_id };
  }
  const other = (await tx.query<{ project_id: string }>("SELECT project_id FROM premium_checkout WHERE stripe_subscription_id = $1 AND checkout_id <> $2 LIMIT 1", [subId, checkout.checkout_id])).rows[0];
  if (other) {
    await recordAlert(tx, ctx.log, { kind: "payment_mapping_rejected", projectId: checkout.project_id, stripeRef: session.id, detail: { reason: "subscription_already_linked" } });
    return { outcome: "REJECTED_MAPPING", projectId: checkout.project_id };
  }
  // The session is done (the hosted page is closed) but Core has confirmed no payment: status stays distinguishable through `outcome`.
  await tx.query(
    `UPDATE premium_checkout SET stripe_subscription_id = $2, status = 'completed', completed_at = COALESCE(completed_at, $3),
            outcome = COALESCE(outcome, 'SUBSCRIPTION_LINKED'), updated_at = $3
      WHERE checkout_id = $1 AND status IN ('open', 'completed')`,
    [checkout.checkout_id, subId, ctx.now],
  );
  return { outcome: "CHECKOUT_LINKED", projectId: checkout.project_id };
}

interface PaidThrough {
  projectId: string;
  subId: string;
  periodStart: Date;
  periodEnd: Date;
  amountPaid: number | null;
  stripeRef: string;
}

/**
 * Money was collected for a term of this Stripe subscription that ends at `periodEnd`. First time: activation (or reactivation);
 * afterwards: a renewal that moves the paid-through date forward. Shared by invoice.paid and by reconciliation.
 */
async function applyPaidThrough(tx: Db, p: PaidThrough, ctx: ApplyContext): Promise<SubscriptionApplyResult> {
  // Same lock order as processSubscriptionEvent: the project row first. Activation always wins races with the retention job.
  await tx.query("SELECT project_id FROM project WHERE project_id = $1 FOR UPDATE", [p.projectId]);
  const activated = ((await tx.query("SELECT 1 FROM subscription_event WHERE idempotency_key = $1", [activatedKey(p.subId)])).rowCount ?? 0) > 0;
  let latest = await latestRow(tx, p.projectId);
  const base = { projectId: p.projectId, occurredAt: ctx.now, source: ctx.via, providerReference: p.subId };

  const markCheckout = async (outcome: string) => {
    await tx.query(
      `UPDATE premium_checkout SET stripe_subscription_id = COALESCE(stripe_subscription_id, $2), status = 'completed', completed_at = COALESCE(completed_at, $3),
              outcome = $4, paid_amount_total = COALESCE($5, paid_amount_total), updated_at = $3
        WHERE checkout_id = (SELECT checkout_id FROM premium_checkout WHERE project_id = $1 AND billing_mode = 'subscription' AND (stripe_subscription_id = $2 OR stripe_subscription_id IS NULL)
                              ORDER BY created_at DESC LIMIT 1)`,
      [p.projectId, p.subId, ctx.now, outcome, p.amountPaid],
    );
  };

  if (activated) {
    // A renewal of a subscription Core already runs.
    if (latest && latest.status !== "PREMIUM_INACTIVE") {
      const before = latest.current_period_end.getTime();
      // Nothing new was collected (a replay, or an older invoice delivered late): no event, no noise.
      if (p.periodEnd.getTime() <= before) return { outcome: "ALREADY_APPLIED", projectId: p.projectId };
      const result = await processSubscriptionEvent(tx, ctx.bundles, { ...base, eventType: "subscription_renewed", idempotencyKey: renewedKey(p.subId, p.periodEnd), periodStart: p.periodStart, periodEnd: p.periodEnd });
      return { outcome: result.duplicate || p.periodEnd.getTime() <= before ? "ALREADY_APPLIED" : "RENEWED", projectId: p.projectId };
    }
    // The paid-through safety margin elapsed (or the term was ended) before this renewal reached Core: a new Core term on the same project.
    const result = await processSubscriptionEvent(tx, ctx.bundles, {
      ...base, eventType: "premium_reactivated", idempotencyKey: `stripe:sub:${p.subId}:reactivated:${epoch(p.periodEnd)}`, periodStart: p.periodStart, periodEnd: p.periodEnd, autoRenews: true,
    }).catch((error: unknown) => {
      if (error instanceof FaError && error.code === "NOT_APPLICABLE") return null;
      throw error;
    });
    if (!result) return { outcome: "NOT_APPLICABLE_NOT_ELIGIBLE", projectId: p.projectId };
    await markCheckout("ACTIVATED");
    return { outcome: result.duplicate ? "ALREADY_APPLIED" : "ACTIVATED", projectId: p.projectId };
  }

  // First collected term of this Stripe subscription.
  if (latest && latest.status !== "PREMIUM_INACTIVE") {
    if (!latest.auto_renews && latest.current_period_end.getTime() <= ctx.now.getTime()) {
      // An earlier one-time term that already ran out must not turn a legitimate subscription into a "duplicate".
      await processSubscriptionEvent(tx, ctx.bundles, { ...base, eventType: "subscription_period_ended", occurredAt: latest.current_period_end, idempotencyKey: `period-end:${latest.subscription_id}` });
      latest = await latestRow(tx, p.projectId);
    } else {
      // A second paid subscription while Premium is still current never creates a second term. Recorded and alerted; no refund/revocation here.
      await markCheckout("NOT_APPLICABLE_DUPLICATE_PAYMENT");
      await recordAlert(tx, ctx.log, { kind: "duplicate_payment", projectId: p.projectId, stripeRef: p.stripeRef, detail: { subscription: p.subId } });
      return { outcome: "NOT_APPLICABLE_DUPLICATE_PAYMENT", projectId: p.projectId };
    }
  }
  const ever = (await tx.query<{ premium_ever_activated: boolean }>("SELECT premium_ever_activated FROM project WHERE project_id = $1", [p.projectId])).rows[0]?.premium_ever_activated === true;
  try {
    const result = await tx.transaction((inner) =>
      processSubscriptionEvent(inner, ctx.bundles, {
        ...base, eventType: ever ? "premium_reactivated" : "premium_activated", idempotencyKey: activatedKey(p.subId), periodStart: p.periodStart, periodEnd: p.periodEnd, autoRenews: true,
      }),
    );
    await markCheckout("ACTIVATED");
    return { outcome: result.duplicate ? "ALREADY_APPLIED" : "ACTIVATED", projectId: p.projectId };
  } catch (error) {
    if (error instanceof FaError && error.code === "NOT_APPLICABLE") {
      // Money was collected but this project cannot enter Premium (not a locked First Assessment, or a concurrent entry).
      await markCheckout("NOT_APPLICABLE_NOT_ELIGIBLE");
      await recordAlert(tx, ctx.log, { kind: "payment_not_eligible", projectId: p.projectId, stripeRef: p.stripeRef, detail: { subscription: p.subId } });
      return { outcome: "NOT_APPLICABLE_NOT_ELIGIBLE", projectId: p.projectId };
    }
    throw error;
  }
}

/** The collected term of an invoice: the latest period end across its lines. */
export function invoicePeriod(invoice: StripeInvoice): { start: Date; end: Date } | null {
  let best: { start: number; end: number } | null = null;
  for (const line of invoice.lines?.data ?? []) {
    const s = line.period?.start;
    const e = line.period?.end;
    if (typeof s === "number" && typeof e === "number" && e > s && (!best || e > best.end)) best = { start: s, end: e };
  }
  return best ? { start: fromEpoch(best.start), end: fromEpoch(best.end) } : null;
}

/** invoice.paid for a subscription: an actual collection (amount_paid > 0) for a term. A $0 invoice (trial) collects nothing. */
export async function applyInvoicePaid(tx: Db, invoice: StripeInvoice, ctx: ApplyContext): Promise<SubscriptionApplyResult> {
  const subId = subscriptionIdOf(invoice);
  if (!subId) return { outcome: "NO_PAYMENT_DUE", projectId: null };
  const resolved = await resolveProject(tx, subId, invoice.subscription_details?.metadata?.project_id, ctx, invoice.id);
  if (resolved.kind !== "ok") return { outcome: resolved.kind === "not_ours" ? "IGNORED_NOT_OURS" : "REJECTED_MAPPING", projectId: null };
  const projectId = resolved.projectId;
  const amount = typeof invoice.amount_paid === "number" ? invoice.amount_paid : 0;
  if (amount <= 0) return { outcome: "NO_PAYMENT_DUE", projectId };
  const period = invoicePeriod(invoice);
  if (!period) {
    await recordAlert(tx, ctx.log, { kind: "payment_mapping_rejected", projectId, stripeRef: invoice.id, detail: { reason: "invoice_without_period" } });
    return { outcome: "REJECTED_MAPPING", projectId };
  }
  return applyPaidThrough(tx, { projectId, subId, periodStart: period.start, periodEnd: period.end, amountPaid: amount, stripeRef: invoice.id }, ctx);
}

/** invoice.payment_failed: recorded and alerted. Access is NOT touched: the provider's collection retries run first (dunning). */
export async function applyPaymentFailed(tx: Db, invoice: StripeInvoice, ctx: ApplyContext): Promise<SubscriptionApplyResult> {
  const subId = subscriptionIdOf(invoice);
  if (!subId) return { outcome: "IGNORED_NOT_OURS", projectId: null };
  const resolved = await resolveProject(tx, subId, invoice.subscription_details?.metadata?.project_id, ctx, invoice.id);
  if (resolved.kind !== "ok") return { outcome: resolved.kind === "not_ours" ? "IGNORED_NOT_OURS" : "REJECTED_MAPPING", projectId: null };
  const projectId = resolved.projectId;
  await recordAlert(tx, ctx.log, { kind: "subscription_payment_failed", projectId, stripeRef: invoice.id, detail: { subscription: subId } });
  await recordJourneyEvent(tx, { eventType: "payment_failed", projectId, properties: { source: "stripe" } });
  return { outcome: "PAYMENT_FAILURE_RECORDED", projectId };
}

/**
 * The state of a Stripe subscription (customer.subscription.updated / .deleted / reconciliation) brought to Core: cancellation requested or
 * withdrawn, the paid-through date, the end of the subscription. `forceEnded` is customer.subscription.deleted.
 */
export async function applySubscriptionState(tx: Db, sub: StripeSubscription, ctx: ApplyContext, options: { forceEnded?: boolean } = {}): Promise<SubscriptionApplyResult> {
  const resolved = await resolveProject(tx, sub.id, sub.metadata?.project_id, ctx, sub.id);
  if (resolved.kind !== "ok") return { outcome: resolved.kind === "not_ours" ? "IGNORED_NOT_OURS" : "REJECTED_MAPPING", projectId: null };
  const projectId = resolved.projectId;
  await tx.query("SELECT project_id FROM project WHERE project_id = $1 FOR UPDATE", [projectId]);
  const activated = ((await tx.query("SELECT 1 FROM subscription_event WHERE idempotency_key = $1", [activatedKey(sub.id)])).rowCount ?? 0) > 0;
  const latest = await latestRow(tx, projectId);
  const base = { projectId, occurredAt: ctx.now, source: ctx.via, providerReference: sub.id };
  const run = async (eventType: "cancellation_requested" | "cancellation_withdrawn" | "subscription_period_ended" | "subscription_renewed", key: string, extra: { occurredAt?: Date; periodEnd?: Date } = {}) => {
    try {
      const result = await processSubscriptionEvent(tx, ctx.bundles, { ...base, ...extra, eventType, idempotencyKey: key });
      return result.duplicate ? "NO_CHANGE" : null;
    } catch (error) {
      if (error instanceof FaError && error.code === "NOT_APPLICABLE") return "NO_CHANGE";
      throw error;
    }
  };

  // Past the point of no return in Stripe's collection (or deleted): the subscription is over.
  const ended = options.forceEnded === true || sub.status === "canceled" || sub.status === "unpaid" || sub.status === "incomplete_expired";
  if (ended) {
    if (!activated || !latest) return { outcome: "NO_PAID_PERIOD", projectId };
    if (latest.status === "PREMIUM_INACTIVE") return { outcome: "NO_CHANGE", projectId }; // already ended: a replay
    const at = typeof sub.ended_at === "number" ? fromEpoch(sub.ended_at) : ctx.now;
    const skipped = await run("subscription_period_ended", `stripe:sub:${sub.id}:ended`, { occurredAt: at });
    return { outcome: skipped ?? "PERIOD_ENDED", projectId };
  }

  // The first collected term that the invoice channel missed (e.g. the first charge after a trial): Stripe itself says the subscription is
  // active, which means its latest invoice is settled. Same activation, same keys.
  if (!activated && sub.status === "active" && typeof sub.current_period_end === "number") {
    return applyPaidThrough(
      tx,
      { projectId, subId: sub.id, periodStart: fromEpoch(sub.current_period_start ?? sub.current_period_end), periodEnd: fromEpoch(sub.current_period_end), amountPaid: null, stripeRef: sub.id },
      ctx,
    );
  }
  if (!activated || !latest || latest.status === "PREMIUM_INACTIVE") {
    // Trialing (the first charge has not happened) or nothing collected yet: nothing for Core to change.
    return { outcome: "NO_PAID_PERIOD", projectId };
  }
  if (sub.status === "past_due") {
    await recordAlert(tx, ctx.log, { kind: "subscription_past_due", projectId, stripeRef: sub.id });
    return { outcome: "PAST_DUE_RECORDED", projectId };
  }

  // A renewal the invoice channel missed: only when Stripe itself says the subscription is active (the latest invoice is paid).
  let renewed = false;
  if (sub.status === "active" && typeof sub.current_period_end === "number" && sub.current_period_end > epoch(latest.current_period_end)) {
    const paid = await applyPaidThrough(tx, { projectId, subId: sub.id, periodStart: fromEpoch(sub.current_period_start ?? sub.current_period_end), periodEnd: fromEpoch(sub.current_period_end), amountPaid: null, stripeRef: sub.id }, ctx);
    if (paid.outcome !== "RENEWED" && paid.outcome !== "ALREADY_APPLIED") return paid;
    renewed = paid.outcome === "RENEWED";
  }
  const current = (await latestRow(tx, projectId)) as LatestRow;
  if (sub.cancel_at_period_end === true && current.status === "PREMIUM_ACTIVE") {
    const skipped = await run("cancellation_requested", `stripe:sub:${sub.id}:cancel:${sub.canceled_at ?? "scheduled"}`);
    return { outcome: skipped === "NO_CHANGE" && renewed ? "RENEWED" : (skipped ?? "CANCELLATION_REQUESTED"), projectId };
  }
  if (sub.cancel_at_period_end === false && current.status === "CANCELLATION_SCHEDULED") {
    const skipped = await run("cancellation_withdrawn", `stripe:sub:${sub.id}:withdrawn:${epoch(ctx.now)}`);
    return { outcome: skipped === "NO_CHANGE" && renewed ? "RENEWED" : (skipped ?? "CANCELLATION_WITHDRAWN"), projectId };
  }
  return { outcome: renewed ? "RENEWED" : "NO_CHANGE", projectId };
}
