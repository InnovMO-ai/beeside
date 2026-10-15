import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { adminUser } from "./ops";
import { project } from "./project";

/**
 * Privacy erasure (V1.0 Fase 0). The executor, the guards and the registry rows live in migration 0040 (custom SQL); these are the tables.
 *   privacy_policy         — the approved terms under which an erasure may run. There is NO default row: no approved policy, no erasure.
 *   privacy_erasure_registry — every table classified (erase / keep / anonymise / global); the inventory test fails on an unclassified table.
 *   privacy_erasure_run    — append-only evidence of each execution (ids and counts only, never content).
 */
export const privacyPolicy = pgTable(
  "privacy_policy",
  {
    policyId: uuid("policy_id").primaryKey().default(sql`gen_random_uuid()`),
    version: integer("version").notNull().unique().generatedAlwaysAsIdentity(),
    status: text("status").notNull().default("approved"),
    /** Days a project stays `blocked` (access revoked, data intact) before it may be erased. A legal/business input, not a default. */
    minDaysAfterBlock: integer("min_days_after_block").notNull(),
    /** Whether the evidence of the terms accepted survives an erasure. */
    retainLegalAcceptance: boolean("retain_legal_acceptance").notNull(),
    approvedBy: uuid("approved_by").notNull().references(() => adminUser.adminUserId),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("privacy_policy_one_approved").on(sql`(true)`).where(sql`${t.status} = 'approved'`),
    check("privacy_policy_status", sql`${t.status} IN ('approved', 'retired')`),
    check("privacy_policy_min_days", sql`${t.minDaysAfterBlock} BETWEEN 0 AND 3650`),
    check("privacy_policy_retired_consistent", sql`(${t.status} = 'retired') = (${t.retiredAt} IS NOT NULL)`),
  ],
);

export const privacyErasureRegistry = pgTable(
  "privacy_erasure_registry",
  {
    tableName: text("table_name").primaryKey(),
    dataClass: text("data_class").notNull(),
    action: text("action").notNull(),
    eraseOrder: integer("erase_order"),
    /** SQL predicate over the table with $1 = project id; NULL means `project_id = $1`. Trusted migration data, never user input. */
    projectPredicate: text("project_predicate"),
    reason: text("reason"),
  },
  (t) => [
    uniqueIndex("privacy_registry_order_unique").on(t.eraseOrder).where(sql`${t.eraseOrder} IS NOT NULL`),
    check("privacy_registry_action", sql`${t.action} IN ('erase', 'erase_if_policy', 'anonymize', 'keep', 'global', 'other_mechanism')`),
    check("privacy_registry_order", sql`(${t.action} IN ('erase', 'erase_if_policy')) = (${t.eraseOrder} IS NOT NULL)`),
    check("privacy_registry_reason", sql`${t.action} IN ('erase') OR ${t.reason} IS NOT NULL`),
  ],
);

export const privacyErasureRun = pgTable(
  "privacy_erasure_run",
  {
    runId: uuid("run_id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    policyId: uuid("policy_id").references(() => privacyPolicy.policyId),
    actor: text("actor").notNull(),
    outcome: text("outcome").notNull(),
    refusalReason: text("refusal_reason"),
    deletedRows: jsonb("deleted_rows").notNull().default(sql`'{}'::jsonb`),
    personAnonymized: boolean("person_anonymized").notNull().default(false),
    companyAnonymized: boolean("company_anonymized").notNull().default(false),
    externalFollowups: jsonb("external_followups").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("privacy_erasure_run_completed_once").on(t.projectId).where(sql`${t.outcome} = 'completed'`),
    index("privacy_erasure_run_project_idx").on(t.projectId, t.createdAt),
    check("privacy_run_outcome", sql`${t.outcome} IN ('completed', 'refused')`),
    check("privacy_run_refusal", sql`(${t.outcome} = 'refused') = (${t.refusalReason} IS NOT NULL)`),
  ],
);
