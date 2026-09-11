import { bigint, boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { adminRoleEnum } from "./enums";
import { project } from "./project";

export const adminUser = pgTable("admin_user", {
  adminUserId: uuid("admin_user_id").primaryKey().default(sql`gen_random_uuid()`),
  role: adminRoleEnum("role").notNull(),
  authIdentity: text("auth_identity").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const outboxEvent = pgTable(
  "outbox_event",
  {
    outboxEventId: bigint("outbox_event_id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    eventId: uuid("event_id").notNull().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id").references(() => project.projectId),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    relayedAt: timestamp("relayed_at", { withTimezone: true }),
  },
  (t) => [
    index("outbox_event_occurred_at_idx").on(t.occurredAt),
    index("outbox_event_pending_idx").on(t.relayedAt).where(sql`${t.relayedAt} IS NULL`),
  ],
);

export const emailEvent = pgTable(
  "email_event",
  {
    emailEventId: uuid("email_event_id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id").references(() => project.projectId),
    emailType: text("email_type").notNull(),
    recipient: text("recipient").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull(),
    providerReference: text("provider_reference"),
  },
  (t) => [index("email_event_cooldown_idx").on(t.projectId, t.emailType, t.sentAt)],
);
