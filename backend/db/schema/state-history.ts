import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { assessmentStateEnum, subscriptionStatusEnum } from "./enums";
import { project } from "./project";
import { subscription } from "./subscription";

// Two independent, typed audit tables — mirrors the confirmed Phase 2 decision that
// assessment and subscription lifecycles must never share one generic table.
export const assessmentStateTransition = pgTable(
  "assessment_state_transition",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    fromState: assessmentStateEnum("from_state"),
    toState: assessmentStateEnum("to_state").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    trigger: text("trigger").notNull(),
  },
  (t) => [index("assessment_state_transition_project_idx").on(t.projectId, t.occurredAt)],
);

export const subscriptionStateTransition = pgTable(
  "subscription_state_transition",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    subscriptionId: uuid("subscription_id").references(() => subscription.subscriptionId),
    fromState: subscriptionStatusEnum("from_state"),
    toState: subscriptionStatusEnum("to_state").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    trigger: text("trigger").notNull(),
  },
  (t) => [index("subscription_state_transition_project_idx").on(t.projectId, t.occurredAt)],
);
