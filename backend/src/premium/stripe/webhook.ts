import { createHash } from "node:crypto";
import express, { Request, Response, Router } from "express";
import { Db } from "../../db/database";
import { isUuid } from "../../fa/services/analytics";
import { BundleStore } from "../../fa/services/bundle-store";
import { Logger, describeError, jsonLogger } from "../../security/redact";
import { PremiumPolicy } from "../premium-policy";
import { ApplyContext, applyPaidCheckoutSession, mappedProjectId, markCheckoutTerminal, recordAlert } from "./apply";
import { applyInvoicePaid, applyPaymentFailed, applySubscriptionState, linkSubscriptionCheckout } from "./apply-subscription";
import { StripeCheckoutSession, StripeInvoice, StripeSubscription } from "./client";
import { STRIPE_SIGNATURE_HEADER, verifyStripeSignature } from "./signature";

/**
 * Stripe webhook endpoint. Order of operations is deliberate:
 *   1. verify Stripe-Signature against the RAW body (400, no detail, when it does not verify);
 *   2. store the event once (stripe_event_id UNIQUE) — idempotency and audit;
 *   3. process it in its own transaction, mark it processed with an outcome code.
 * A duplicate delivery of a processed event is acknowledged without re-applying anything. An unexpected failure
 * (database down) returns 500 so Stripe retries; the stored row shows the event was received but not processed.
 */
export interface StripeWebhookDeps {
  db: Db;
  bundles: BundleStore;
  webhookSecrets: string[];
  /** Whether the configured Stripe key is a live key: events from the other mode are stored and ignored. */
  livemode: boolean;
  policy: PremiumPolicy;
  now?: () => Date;
  log?: Logger;
}

export const STRIPE_WEBHOOK_MAX_BYTES = 512 * 1024;

interface StripeEvent {
  id: string;
  type: string;
  created?: number;
  livemode: boolean;
  data: { object: Record<string, unknown> };
}

function parseEvent(raw: Buffer): StripeEvent | null {
  try {
    const parsed = JSON.parse(raw.toString("utf8")) as Partial<StripeEvent>;
    if (typeof parsed.id !== "string" || !/^evt_[A-Za-z0-9_]{1,200}$/.test(parsed.id)) return null;
    if (typeof parsed.type !== "string" || !/^[a-z0-9_.]{1,120}$/.test(parsed.type)) return null;
    const object = parsed.data?.object;
    if (typeof object !== "object" || object === null) return null;
    return { id: parsed.id, type: parsed.type, ...(typeof parsed.created === "number" ? { created: parsed.created } : {}), livemode: parsed.livemode === true, data: { object: object as Record<string, unknown> } };
  } catch {
    return null;
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Ids, status words and amounts only — the stored audit summary never holds names, e-mail addresses or card data. */
function summaryOf(event: StripeEvent, rawHash: string): Record<string, string | number | boolean | null> {
  const o = event.data.object;
  return {
    object: str(o.object),
    object_id: str(o.id),
    payment_status: str(o.payment_status),
    status: str(o.status),
    amount_total: typeof o.amount_total === "number" ? o.amount_total : typeof o.amount === "number" ? o.amount : null,
    currency: str(o.currency),
    payload_sha256: rawHash,
  };
}

const REFUND_DISPUTE_TYPES = new Set(["charge.refunded", "charge.dispute.created", "charge.dispute.closed"]);

async function projectForPaymentIntent(tx: Db, intent: string | null): Promise<string | null> {
  if (!intent) return null;
  const { rows } = await tx.query<{ project_id: string }>("SELECT project_id FROM premium_checkout WHERE stripe_payment_intent_id = $1 LIMIT 1", [intent]);
  return rows[0]?.project_id ?? null;
}

interface Handled {
  outcome: string;
  projectId: string | null;
  sessionId: string | null;
}

async function dispatch(tx: Db, event: StripeEvent, ctx: ApplyContext): Promise<Handled> {
  const object = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = object as unknown as StripeCheckoutSession;
      if (session.object !== "checkout.session" || typeof session.id !== "string") return { outcome: "IGNORED_MALFORMED", projectId: null, sessionId: null };
      if (session.mode === "subscription") {
        // Recurring: the session only proves the subscription EXISTS. Nothing is collected (trial) or confirmed here; access follows invoice.paid.
        const linked = await linkSubscriptionCheckout(tx, session, ctx);
        return { outcome: linked.outcome, projectId: linked.projectId, sessionId: session.id };
      }
      if (session.mode !== undefined && session.mode !== "payment") return { outcome: "IGNORED_NOT_PREMIUM_PAYMENT", projectId: null, sessionId: session.id };
      if (session.payment_status !== "paid") {
        // Delayed payment method: the money is not confirmed yet. async_payment_succeeded / _failed will follow.
        return { outcome: "AWAITING_PAYMENT_CONFIRMATION", projectId: mappedProjectId(session), sessionId: session.id };
      }
      const result = await applyPaidCheckoutSession(tx, session, ctx);
      return { outcome: result.outcome, projectId: result.projectId, sessionId: session.id };
    }
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      const sessionId = str(object.id);
      if (!sessionId) return { outcome: "IGNORED_MALFORMED", projectId: null, sessionId: null };
      const to = event.type === "checkout.session.expired" ? "expired" : "failed";
      const { projectId, changed } = await markCheckoutTerminal(tx, sessionId, to, ctx.now);
      if (!projectId) return { outcome: "IGNORED_UNKNOWN_SESSION", projectId: null, sessionId };
      if (to === "failed" && changed) await recordAlert(tx, ctx.log, { kind: "payment_async_failed", projectId, stripeRef: sessionId });
      return { outcome: changed ? (to === "expired" ? "CHECKOUT_EXPIRED" : "CHECKOUT_FAILED") : "NO_CHANGE", projectId, sessionId };
    }
    case "invoice.paid": {
      const invoice = object as unknown as StripeInvoice;
      if (invoice.object !== "invoice" || typeof invoice.id !== "string") return { outcome: "IGNORED_MALFORMED", projectId: null, sessionId: null };
      const result = await applyInvoicePaid(tx, invoice, ctx);
      return { outcome: result.outcome, projectId: result.projectId, sessionId: null };
    }
    case "invoice.payment_failed": {
      const invoice = object as unknown as StripeInvoice;
      if (invoice.object !== "invoice" || typeof invoice.id !== "string") return { outcome: "IGNORED_MALFORMED", projectId: null, sessionId: null };
      const result = await applyPaymentFailed(tx, invoice, ctx);
      return { outcome: result.outcome, projectId: result.projectId, sessionId: null };
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = object as unknown as StripeSubscription;
      if (sub.object !== "subscription" || typeof sub.id !== "string") return { outcome: "IGNORED_MALFORMED", projectId: null, sessionId: null };
      const result = await applySubscriptionState(tx, sub, ctx, { forceEnded: event.type === "customer.subscription.deleted" });
      return { outcome: result.outcome, projectId: result.projectId, sessionId: null };
    }
    default: {
      if (!REFUND_DISPUTE_TYPES.has(event.type)) return { outcome: "STORED_UNHANDLED_TYPE", projectId: null, sessionId: null };
      // Refunds and disputes: RECORD + ALERT only. v1 never revokes access automatically.
      const intent = str(object.payment_intent);
      const metaProject = (object.metadata as Record<string, unknown> | undefined)?.project_id;
      const projectId = (await projectForPaymentIntent(tx, intent)) ?? (isUuid(metaProject) ? (metaProject as string) : null);
      const known = projectId ? (await tx.query("SELECT 1 FROM project WHERE project_id = $1", [projectId])).rowCount : 0;
      await recordAlert(tx, ctx.log, {
        kind: event.type.replace(/\./g, "_"),
        projectId: known ? projectId : null,
        stripeRef: event.id,
        detail: { payment_intent: intent, amount: typeof object.amount === "number" ? object.amount : null, currency: str(object.currency) },
      });
      return { outcome: "RECORDED_ALERTED", projectId: known ? projectId : null, sessionId: null };
    }
  }
}

export interface WebhookResponse {
  status: number;
  body: Record<string, unknown>;
}

/** Framework-independent core: raw body + header in, status + body out. */
export async function handleStripeWebhook(deps: StripeWebhookDeps, rawBody: Buffer, signatureHeader: string | undefined): Promise<WebhookResponse> {
  const now = (deps.now ?? (() => new Date()))();
  const log = deps.log ?? jsonLogger;
  if (!verifyStripeSignature(deps.webhookSecrets, rawBody, signatureHeader, now)) return { status: 400, body: { error: "invalid_request" } };
  const event = parseEvent(rawBody);
  if (!event) return { status: 400, body: { error: "invalid_request" } };

  const rawHash = createHash("sha256").update(rawBody).digest("hex");
  try {
    // 1. Store once. A redelivery only bumps the attempt counter.
    const stored = await deps.db.transaction(async (tx) => {
      const inserted = await tx.query<{ inbound_id: string }>(
        `INSERT INTO billing_inbound_event (stripe_event_id, type, livemode, stripe_created_at, received_at, summary)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT (stripe_event_id) DO NOTHING RETURNING inbound_id`,
        [event.id, event.type, event.livemode, typeof event.created === "number" ? new Date(event.created * 1000) : null, now, JSON.stringify(summaryOf(event, rawHash))],
      );
      if (inserted.rows[0]) return { inboundId: inserted.rows[0].inbound_id, fresh: true };
      const existing = await tx.query<{ inbound_id: string }>("UPDATE billing_inbound_event SET attempts = attempts + 1 WHERE stripe_event_id = $1 RETURNING inbound_id", [event.id]);
      return { inboundId: existing.rows[0]?.inbound_id as string, fresh: false };
    });

    // 2. Process under a row lock: concurrent deliveries of the same event serialize here.
    return await deps.db.transaction(async (tx) => {
      const row = (await tx.query<{ processed_at: Date | null; outcome: string | null }>("SELECT processed_at, outcome FROM billing_inbound_event WHERE inbound_id = $1 FOR UPDATE", [stored.inboundId])).rows[0];
      if (row?.processed_at) return { status: 200, body: { received: true, duplicate: true } };

      let handled: Handled;
      if (event.livemode !== deps.livemode) {
        handled = { outcome: "IGNORED_LIVEMODE_MISMATCH", projectId: null, sessionId: null };
      } else {
        handled = await dispatch(tx, event, { bundles: deps.bundles, policy: deps.policy, now, log, via: "stripe_webhook" });
      }
      await tx.query(
        "UPDATE billing_inbound_event SET processed_at = $2, outcome = $3, project_id = $4, stripe_session_id = $5 WHERE inbound_id = $1",
        [stored.inboundId, now, handled.outcome, handled.projectId, handled.sessionId],
      );
      log("info", "stripe webhook processed", { event_type: event.type, outcome: handled.outcome });
      return { status: 200, body: { received: true } };
    });
  } catch (error) {
    // Never echo the cause to the caller; Stripe retries a non-2xx.
    log("error", "stripe webhook failed", { event_type: event.type, error: describeError(error) });
    return { status: 500, body: { error: "internal" } };
  }
}

/** Mounted at /api/billing/stripe: POST /webhook. */
export function createStripeWebhookRouter(deps: StripeWebhookDeps): Router {
  const router = Router();
  router.post("/webhook", express.raw({ type: "application/json", limit: STRIPE_WEBHOOK_MAX_BYTES }), (req: Request, res: Response) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    void handleStripeWebhook(deps, raw, req.header(STRIPE_SIGNATURE_HEADER)).then(
      (result) => res.status(result.status).json(result.body),
      () => res.status(500).json({ error: "internal" }),
    );
  });
  return router;
}
