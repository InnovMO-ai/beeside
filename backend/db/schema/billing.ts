import { bigint, boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { premiumActivationRequest } from "./subscription";
import { project } from "./project";

// F5 Track B — Stripe adapter persistence (Core-owned). Stripe is only a payment platform: these tables
// record what the adapter asked of it and what it reported. They never grant access by themselves —
// only a subscription_event processed from a verified webhook (or reconciliation) activates Premium.

// One Stripe Hosted Checkout Session per attempt. At most ONE open session per project (partial unique index).
export const premiumCheckout = pgTable(
  "premium_checkout",
  {
    checkoutId: uuid("checkout_id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    requestId: uuid("request_id").references(() => premiumActivationRequest.requestId),
    stripeSessionId: text("stripe_session_id").notNull(),
    status: text("status").notNull().default("open"),
    // Sent as the Idempotency-Key of the create call: one per checkout attempt.
    idempotencyKey: text("idempotency_key").notNull(),
    // The hosted-page URL is kept so a returning client resumes the same open session (never a second one).
    checkoutUrl: text("checkout_url"),
    interfaceLanguage: text("interface_language").notNull(),
    // Amount/currency exactly as Stripe returned them for the session (minor units, lower-case ISO 4217).
    amountTotal: bigint("amount_total", { mode: "number" }),
    currency: text("currency"),
    paidAmountTotal: bigint("paid_amount_total", { mode: "number" }),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    // payment = one-time Checkout (legacy path); subscription = recurring. For a subscription checkout the Stripe subscription id is
    // linked when the session completes and is how later invoices/updates are mapped back to the project (never by e-mail).
    billingMode: text("billing_mode").notNull().default("payment"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    // Result of applying a confirmed payment: ACTIVATED | NOT_APPLICABLE_DUPLICATE_PAYMENT | NOT_APPLICABLE_NOT_ELIGIBLE.
    outcome: text("outcome"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("premium_checkout_session_unique").on(t.stripeSessionId),
    uniqueIndex("premium_checkout_idempotency_key_unique").on(t.idempotencyKey),
    uniqueIndex("premium_checkout_one_open_per_project").on(t.projectId).where(sql`${t.status} = 'open'`),
    index("premium_checkout_project_idx").on(t.projectId, t.createdAt),
    index("premium_checkout_payment_intent_idx").on(t.stripePaymentIntentId),
    index("premium_checkout_subscription_idx").on(t.stripeSubscriptionId),
    check("premium_checkout_status", sql`${t.status} IN ('open', 'completed', 'expired', 'failed')`),
    check("premium_checkout_billing_mode", sql`${t.billingMode} IN ('payment', 'subscription')`),
    check("premium_checkout_language", sql`${t.interfaceLanguage} IN ('es', 'en')`),
    check("premium_checkout_currency", sql`${t.currency} IS NULL OR ${t.currency} ~ '^[a-z]{3}$'`),
    check("premium_checkout_amounts", sql`(${t.amountTotal} IS NULL OR ${t.amountTotal} >= 0) AND (${t.paidAmountTotal} IS NULL OR ${t.paidAmountTotal} >= 0)`),
    check("premium_checkout_completed_coherent", sql`(${t.status} = 'completed') = (${t.completedAt} IS NOT NULL)`),
  ],
);

// Every inbound Stripe webhook event, verified and stored once (idempotency + audit). Only a minimal,
// non-personal summary is kept — never the raw payload.
export const billingInboundEvent = pgTable(
  "billing_inbound_event",
  {
    inboundId: uuid("inbound_id").primaryKey().default(sql`gen_random_uuid()`),
    stripeEventId: text("stripe_event_id").notNull(),
    type: text("type").notNull(),
    livemode: boolean("livemode").notNull(),
    stripeCreatedAt: timestamp("stripe_created_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    outcome: text("outcome"),
    projectId: uuid("project_id").references(() => project.projectId),
    stripeSessionId: text("stripe_session_id"),
    // Ids, status words and amounts only. No names, e-mail addresses, card data or secrets.
    summary: jsonb("summary").notNull().default(sql`'{}'::jsonb`),
    attempts: integer("attempts").notNull().default(1),
  },
  (t) => [
    uniqueIndex("billing_inbound_event_stripe_event_unique").on(t.stripeEventId),
    index("billing_inbound_event_received_idx").on(t.receivedAt),
    index("billing_inbound_event_project_idx").on(t.projectId),
    check("billing_inbound_event_processed_coherent", sql`(${t.processedAt} IS NULL) = (${t.outcome} IS NULL)`),
  ],
);

// Operational alerts (refund, dispute, duplicate payment, unmatched payment...). A human decides: v1 never
// revokes access automatically. Holds ids and codes only.
export const billingAlert = pgTable(
  "billing_alert",
  {
    alertId: uuid("alert_id").primaryKey().default(sql`gen_random_uuid()`),
    kind: text("kind").notNull(),
    projectId: uuid("project_id").references(() => project.projectId),
    stripeRef: text("stripe_ref"),
    detail: jsonb("detail").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  },
  (t) => [
    index("billing_alert_open_idx").on(t.createdAt).where(sql`${t.acknowledgedAt} IS NULL`),
    index("billing_alert_project_idx").on(t.projectId),
    // Same alert condition for the same Stripe object is recorded once (webhook retries, reconciliation re-runs).
    uniqueIndex("billing_alert_kind_ref_unique").on(t.kind, t.stripeRef).where(sql`${t.stripeRef} IS NOT NULL`),
    check("billing_alert_kind_format", sql`${t.kind} ~ '^[a-z][a-z0-9_]{2,60}$'`),
  ],
);
