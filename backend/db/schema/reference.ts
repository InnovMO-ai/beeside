import { sql } from "drizzle-orm";
import {
  AnyPgColumn,
  boolean,
  check,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  char,
} from "drizzle-orm/pg-core";
import { configChangeKindEnum, configVersionStatusEnum } from "./enums";
// Circular import (ops.ts -> project.ts -> reference.ts -> ops.ts) is safe: every use is inside a
// `() => ...` thunk, same pattern as project.ts.
import { adminUser } from "./ops";

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

// The three version registries share one shape (Technical Architecture v1.1 §5). Every row moves
// Draft → Preview → Publish exclusively through the config_* SQL functions
// (0004 custom migration); a guard trigger rejects any other write path, freezes the bundle from
// PREVIEW on, and makes PUBLISHED rows immutable except for the is_current pointer.
function versionRegistryColumns(self: () => AnyPgColumn) {
  return {
    version: text("version").primaryKey(),
    status: configVersionStatusEnum("status").notNull().default("DRAFT"),
    config: jsonb("config").notNull(),
    // sha256 of the frozen bundle, set at PREVIEW; reviews are bound to it.
    contentHash: text("content_hash"),
    changeKind: configChangeKindEnum("change_kind"),
    // The published version this candidate was compared against at PREVIEW (NULL = first version).
    baseVersion: text("base_version").references(self),
    isCurrent: boolean("is_current").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdByAdminUserId: uuid("created_by_admin_user_id")
      .notNull()
      .references(() => adminUser.adminUserId),
    previewedAt: timestamp("previewed_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedByAdminUserId: uuid("published_by_admin_user_id").references(() => adminUser.adminUserId),
  };
}

type RegistryColumns = ReturnType<typeof versionRegistryColumns>;
type RegistryTable = { [K in keyof RegistryColumns]: AnyPgColumn };

function versionRegistryConstraints(name: string) {
  return (t: RegistryTable) => [
    uniqueIndex(`${name}_one_current`).on(t.isCurrent).where(sql`${t.isCurrent} = true`),
    check(`${name}_current_requires_published`, sql`${t.isCurrent} = false OR ${t.status} = 'PUBLISHED'`),
    check(
      `${name}_draft_clean`,
      sql`${t.status} <> 'DRAFT' OR (${t.contentHash} IS NULL AND ${t.changeKind} IS NULL AND ${t.previewedAt} IS NULL AND ${t.publishedAt} IS NULL AND ${t.publishedByAdminUserId} IS NULL)`,
    ),
    check(
      `${name}_frozen_complete`,
      sql`${t.status} = 'DRAFT' OR (${t.contentHash} IS NOT NULL AND ${t.changeKind} IS NOT NULL AND ${t.previewedAt} IS NOT NULL)`,
    ),
    check(
      `${name}_published_complete`,
      sql`(${t.status} = 'PUBLISHED') = (${t.publishedAt} IS NOT NULL AND ${t.publishedByAdminUserId} IS NOT NULL)`,
    ),
  ];
}

export const questionBankVersion = pgTable(
  "question_bank_version",
  versionRegistryColumns((): AnyPgColumn => questionBankVersion.version),
  versionRegistryConstraints("question_bank_version"),
);

export const rulesEngineVersion = pgTable(
  "rules_engine_version",
  versionRegistryColumns((): AnyPgColumn => rulesEngineVersion.version),
  versionRegistryConstraints("rules_engine_version"),
);

export const snapshotTemplateVersion = pgTable(
  "snapshot_template_version",
  versionRegistryColumns((): AnyPgColumn => snapshotTemplateVersion.version),
  versionRegistryConstraints("snapshot_template_version"),
);
