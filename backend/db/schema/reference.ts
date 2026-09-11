import { sql } from "drizzle-orm";
import { boolean, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, char } from "drizzle-orm/pg-core";

// 15-value Rules Matrix category catalog. First 14 are finding-capable; "Other" (15) is not.
export const rulesMatrixCategory = pgTable("rules_matrix_category", {
  categoryId: smallint("category_id").primaryKey(),
  name: text("name").notNull(),
  displayOrder: smallint("display_order").notNull(),
  isFindingArea: boolean("is_finding_area").notNull().default(true),
});

// 10-value Capability Taxonomy catalog. The category<->Rules Matrix area mapping lives in
// rules_engine_version.config (versioned), not here, since that mapping has changed before (CT-3).
export const capabilityTaxonomyCategory = pgTable("capability_taxonomy_category", {
  categoryId: smallint("category_id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  displayOrder: smallint("display_order").notNull(),
});

// ISO 3166-1 alpha-2 starter set. Content owner completes the full/curated list; schema does not block on it.
export const country = pgTable("country", {
  countryCode: char("country_code", { length: 2 }).primaryKey(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
});

// Synced from shared/canonical-fields (source of truth). Never hand-edited.
export const fieldKeyRegistry = pgTable("field_key_registry", {
  fieldKey: text("field_key").primaryKey(), // namespaced: 'fa.*' | 'precision.*'
  dataType: text("data_type").notNull(),
  source: text("source").notNull(),
  module: text("module").notNull(), // 'first_assessment' | 'precision'
  active: boolean("active").notNull().default(true),
  description: text("description"),
});

function versionRegistryColumns() {
  return {
    version: text("version").primaryKey(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    config: jsonb("config").notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
  };
}

export const questionBankVersion = pgTable(
  "question_bank_version",
  versionRegistryColumns(),
  (t) => [uniqueIndex("question_bank_version_one_current").on(t.isCurrent).where(sql`${t.isCurrent} = true`)],
);

export const rulesEngineVersion = pgTable(
  "rules_engine_version",
  versionRegistryColumns(),
  (t) => [uniqueIndex("rules_engine_version_one_current").on(t.isCurrent).where(sql`${t.isCurrent} = true`)],
);

export const snapshotTemplateVersion = pgTable(
  "snapshot_template_version",
  versionRegistryColumns(),
  (t) => [uniqueIndex("snapshot_template_version_one_current").on(t.isCurrent).where(sql`${t.isCurrent} = true`)],
);
