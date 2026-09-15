import { boolean, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { subscriptionEventTypeEnum, subscriptionStatusEnum } from "./enums";
import { person } from "./identity";
import { project } from "./project";

export const subscription = pgTable(
  "subscription",
  {
    subscriptionId: uuid("subscription_id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    status: subscriptionStatusEnum("status").notNull(),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    cancellationRequestedAt: timestamp("cancellation_requested_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("subscription_one_active_per_project").on(t.projectId).where(sql`${t.status} = 'PREMIUM_ACTIVE'`),
    // Phase 9: at most one subscription that still grants access (active or cancellation scheduled)
    // per project; a reactivation always starts from a PREMIUM_INACTIVE history.
    uniqueIndex("subscription_one_open_per_project").on(t.projectId).where(sql`${t.status} <> 'PREMIUM_INACTIVE'`),
    index("subscription_project_status_idx").on(t.projectId, t.status),
  ],
);

export const subscriptionEvent = pgTable(
  "subscription_event",
  {
    eventId: uuid("event_id").primaryKey().default(sql`gen_random_uuid()`),
    subscriptionId: uuid("subscription_id").references(() => subscription.subscriptionId),
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    eventType: subscriptionEventTypeEnum("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source"),
    providerReference: text("provider_reference"),
    // Phase 9: provider-agnostic idempotency — the same delivered event is processed once.
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    index("subscription_event_project_idx").on(t.projectId, t.occurredAt),
    index("subscription_event_subscription_idx").on(t.subscriptionId),
    uniqueIndex("subscription_event_idempotency_key_unique").on(t.idempotencyKey),
  ],
);

export const entitlement = pgTable("entitlement", {
  projectId: uuid("project_id").primaryKey().references(() => project.projectId),
  premiumAccessActive: boolean("premium_access_active").notNull().default(false),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  effectiveUntil: timestamp("effective_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const operationHubLink = pgTable(
  "operation_hub_link",
  {
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    externalSystem: text("external_system").notNull(),
    externalWorkspaceId: text("external_workspace_id"),
    externalRecordId: text("external_record_id"),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.externalSystem] })],
);

/**
 * Phase 9: the client's request to continue with Premium (Functional Specification v1 §16.6),
 * recorded before any payment provider exists. It is an intent plus the Terms acceptance — never
 * itself an activation: only a premium_activated / premium_reactivated subscription_event activates.
 */
export const premiumActivationRequest = pgTable(
  "premium_activation_request",
  {
    requestId: uuid("request_id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    personId: uuid("person_id").notNull().references(() => person.personId),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("REQUESTED"),
    termsUrl: text("terms_url").notNull(),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }).notNull(),
    interfaceLanguage: text("interface_language").notNull(),
    checkoutAdapter: text("checkout_adapter").notNull(),
    checkoutReference: text("checkout_reference"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    fulfilledByEventId: uuid("fulfilled_by_event_id").references(() => subscriptionEvent.eventId),
  },
  (t) => [
    index("premium_activation_request_project_idx").on(t.projectId, t.requestedAt),
    uniqueIndex("premium_activation_request_one_open").on(t.projectId).where(sql`${t.status} = 'REQUESTED'`),
  ],
);
