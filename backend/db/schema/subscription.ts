import { boolean, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { subscriptionEventTypeEnum, subscriptionStatusEnum } from "./enums";
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
  },
  (t) => [
    index("subscription_event_project_idx").on(t.projectId, t.occurredAt),
    index("subscription_event_subscription_idx").on(t.subscriptionId),
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
