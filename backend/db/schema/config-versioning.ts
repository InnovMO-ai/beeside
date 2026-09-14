import { AnyPgColumn, boolean, check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  configChangeKindEnum,
  configRegistryEnum,
  configReviewDecisionEnum,
  configVersionEventTypeEnum,
  configVersionStatusEnum,
} from "./enums";
import { adminUser } from "./ops";
import { questionBankVersion, rulesEngineVersion, snapshotTemplateVersion } from "./reference";

// One real FK column per registry (named exactly like the registry table, as on `project`),
// exactly one of which is set, matching `registry`.
function registryTargetColumns() {
  return {
    registry: configRegistryEnum("registry").notNull(),
    questionBankVersion: text("question_bank_version").references(() => questionBankVersion.version),
    rulesEngineVersion: text("rules_engine_version").references(() => rulesEngineVersion.version),
    snapshotTemplateVersion: text("snapshot_template_version").references(() => snapshotTemplateVersion.version),
  };
}

type TargetTable = { [K in keyof ReturnType<typeof registryTargetColumns>]: AnyPgColumn };

function registryTargetCheck(name: string, t: TargetTable) {
  return check(
    `${name}_registry_target`,
    sql`(${t.registry} = 'QUESTION_BANK' AND ${t.questionBankVersion} IS NOT NULL AND ${t.rulesEngineVersion} IS NULL AND ${t.snapshotTemplateVersion} IS NULL)
     OR (${t.registry} = 'RULES_ENGINE' AND ${t.rulesEngineVersion} IS NOT NULL AND ${t.questionBankVersion} IS NULL AND ${t.snapshotTemplateVersion} IS NULL)
     OR (${t.registry} = 'SNAPSHOT_TEMPLATE' AND ${t.snapshotTemplateVersion} IS NOT NULL AND ${t.questionBankVersion} IS NULL AND ${t.rulesEngineVersion} IS NULL)`,
  );
}

// Review record bound to one frozen bundle (content_hash) and to the diff against the version
// that was current when it was previewed. Append-only. Publish requires the latest review for the
// exact content_hash to be APPROVED; LOGIC_SCHEMA changes additionally require diff_reviewed.
export const configVersionReview = pgTable(
  "config_version_review",
  {
    reviewId: uuid("review_id").primaryKey().default(sql`gen_random_uuid()`),
    ...registryTargetColumns(),
    contentHash: text("content_hash").notNull(),
    baseVersion: text("base_version"),
    baseContentHash: text("base_content_hash"),
    changeKind: configChangeKindEnum("change_kind").notNull(),
    diff: jsonb("diff").notNull(),
    diffReviewed: boolean("diff_reviewed").notNull().default(false),
    decision: configReviewDecisionEnum("decision").notNull(),
    notes: text("notes"),
    reviewerAdminUserId: uuid("reviewer_admin_user_id")
      .notNull()
      .references(() => adminUser.adminUserId),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    registryTargetCheck("config_version_review", t),
    check(
      "config_version_review_logic_requires_diff_review",
      sql`${t.decision} <> 'APPROVED' OR ${t.changeKind} <> 'LOGIC_SCHEMA' OR ${t.diffReviewed} = true`,
    ),
    index("config_version_review_registry_idx").on(t.registry, t.reviewedAt),
  ],
);

// Append-only audit trail of every lifecycle action, including current-pointer repoints (rollback).
export const configVersionEvent = pgTable(
  "config_version_event",
  {
    eventId: uuid("event_id").primaryKey().default(sql`gen_random_uuid()`),
    ...registryTargetColumns(),
    eventType: configVersionEventTypeEnum("event_type").notNull(),
    fromStatus: configVersionStatusEnum("from_status"),
    toStatus: configVersionStatusEnum("to_status"),
    contentHash: text("content_hash"),
    actorAdminUserId: uuid("actor_admin_user_id")
      .notNull()
      .references(() => adminUser.adminUserId),
    details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    registryTargetCheck("config_version_event", t),
    index("config_version_event_registry_idx").on(t.registry, t.occurredAt),
  ],
);
