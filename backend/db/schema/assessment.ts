import { index, jsonb, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { boolean } from "drizzle-orm/pg-core";
import { findingStatusEnum, priorityAlignmentStatusEnum, signalStrengthEnum } from "./enums";
import { project } from "./project";
import { fieldKeyRegistry, rulesMatrixCategory, capabilityTaxonomyCategory } from "./reference";

export const answer = pgTable(
  "answer",
  {
    answerId: uuid("answer_id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    fieldKey: text("field_key").notNull().references(() => fieldKeyRegistry.fieldKey),
    value: jsonb("value").notNull(),
    valueType: text("value_type").notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
    questionBankVersion: text("question_bank_version").notNull(),
    // No .references() here on purpose: drizzle-orm's schema DSL cannot express
    // DEFERRABLE / INITIALLY DEFERRED foreign keys (confirmed unsupported as of
    // drizzle-orm 0.45.x / drizzle-kit 0.31.x). The real FK, with the required
    // DEFERRABLE INITIALLY DEFERRED, is added by hand in 0001_integrity_triggers.sql.
    supersededBy: uuid("superseded_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("answer_current_value_idx").on(t.projectId, t.fieldKey).where(sql`${t.supersededBy} IS NULL`),
    index("answer_history_idx").on(t.projectId, t.fieldKey, t.answeredAt.desc()),
    index("answer_superseded_by_idx").on(t.supersededBy),
  ],
);

export const finding = pgTable(
  "finding",
  {
    findingId: uuid("finding_id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    areaId: smallint("area_id").notNull().references(() => rulesMatrixCategory.categoryId),
    status: findingStatusEnum("status").notNull(),
    signalStrength: signalStrengthEnum("signal_strength").notNull().default("NO_SIGNAL"),
    internalSignal: text("internal_signal"),
    // Client-facing one-line reason in the deliverable language; NULL only for NOT_APPLICABLE (0008).
    reasonClient: text("reason_client"),
    evidenceFieldKeys: text("evidence_field_keys").array().notNull().default(sql`'{}'::text[]`),
    // Phase 7 explainability (Master Build Guide §9 finding record).
    ruleTriggered: text("rule_triggered").notNull(),
    reasonInternal: text("reason_internal").notNull(),
    // [{field_key, answer_id, value}] — the exact answer rows the status was computed from.
    evidence: jsonb("evidence").notNull().default(sql`'[]'::jsonb`),
    // [{signal, strength, boosted}] — every internal service/capability signal for this area.
    signals: jsonb("signals").notNull().default(sql`'[]'::jsonb`),
    sourceType: text("source_type").notNull().default("DERIVED_BY_RULE"),
    panelRank: smallint("panel_rank"),
    includedInSnapshot: boolean("included_in_snapshot").notNull().default(false),
    rulesEngineVersion: text("rules_engine_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("finding_project_area_unique").on(t.projectId, t.areaId)],
);

export const priorityAlignment = pgTable("priority_alignment", {
  projectId: uuid("project_id").primaryKey().references(() => project.projectId),
  alignment: priorityAlignmentStatusEnum("alignment").notNull(),
  tensionAreaId: smallint("tension_area_id").references(() => rulesMatrixCategory.categoryId),
  tensionReason: text("tension_reason"),
  // Which Rules Matrix v1 §18 tests matched (shared_commitment / shared_timing_driver / go_to_market_dependency).
  testsMatched: text("tests_matched").array().notNull().default(sql`'{}'::text[]`),
  ruleTriggered: text("rule_triggered"),
  rulesEngineVersion: text("rules_engine_version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const capabilityRank = pgTable(
  "capability_rank",
  {
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    categoryId: smallint("category_id").notNull().references(() => capabilityTaxonomyCategory.categoryId),
    rank: smallint("rank").notNull(),
    includedInSnapshot: boolean("included_in_snapshot").notNull().default(false),
    // Rules Matrix areas whose relevance trigger made this category qualify (never their status).
    sourceAreaIds: smallint("source_area_ids").array().notNull().default(sql`'{}'::smallint[]`),
    rankingFactors: jsonb("ranking_factors").notNull().default(sql`'{}'::jsonb`),
    rulesEngineVersion: text("rules_engine_version").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.categoryId] }),
    index("capability_rank_project_rank_idx").on(t.projectId, t.rank),
  ],
);

export const snapshot = pgTable("snapshot", {
  snapshotId: uuid("snapshot_id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid("project_id").notNull().unique().references(() => project.projectId),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  rulesEngineVersion: text("rules_engine_version").notNull(),
  snapshotTemplateVersion: text("snapshot_template_version").notNull(),
  content: jsonb("content").notNull(),
});

export const internalAssessment = pgTable("internal_assessment", {
  internalAssessmentId: uuid("internal_assessment_id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid("project_id").notNull().unique().references(() => project.projectId),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  rulesEngineVersion: text("rules_engine_version").notNull(),
  snapshotTemplateVersion: text("snapshot_template_version").notNull(),
  content: jsonb("content").notNull(),
});

export const precisionHandoffPackage = pgTable("precision_handoff_package", {
  packageId: uuid("package_id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid("project_id").notNull().unique().references(() => project.projectId),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  content: jsonb("content").notNull(),
});
