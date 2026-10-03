import {
  AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  categoryOriginEnum,
  categoryStatusEnum,
  configVersionStatusEnum,
  factAnswerStateEnum,
  factProvenanceStageEnum,
  factSourceEnum,
  paStatusEnum,
  precisionInstanceScopeEnum,
} from "./enums";
import { adminUser } from "./ops";
import { project } from "./project";

// Precision Assessment persistence (Macroblock 4). Canonical shapes per
// precision-block2-macroblock2-canonical-data-model-manifest-architecture-2026-10-02.md, through
// Freeze Patch #3 (§33), confirmed by the Product Owner (Master Contract Addendum 6). This file
// implements frozen architecture; it introduces no new business rule. Field lists mirror each
// section's literal schema sketch exactly; bookkeeping columns beyond that sketch (status,
// createdByAdminUserId, etc.) are this macroblock's own additive implementation of "reuse
// config_publish/project_pin_current_versions unchanged in shape" (§19) and are called out inline.

// =====================================================================================
// §4 — Precision Instance (base identity) + §4 subtypes (precision_assessment / category_assessment)
// =====================================================================================

// Base identity shared by PA and Category Assessment (§3/§4). `fact.scope_instance_id` is the one
// stable FK target for "an instance of either kind" — this is the entire reason the base table
// exists rather than two fully independent PA/Category tables (§4, Option C rejected).
export const precisionInstance = pgTable(
  "precision_instance",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    scope: precisionInstanceScopeEnum("scope").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastClientActivityAt: timestamp("last_client_activity_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("precision_instance_project_id_idx").on(t.projectId),
    // One PA per project (§3A/§4.2's "one Precision Assessment per service -> corrected to
    // category-level" decision, plus the brief's own "one-PA-per-project" integrity requirement):
    // enforced for free at the base table, no separate uniqueness mechanism on precision_assessment
    // itself needed, since every PA row is 1:1 with a scope='project' instance (§4).
    uniqueIndex("precision_instance_one_pa_per_project").on(t.projectId).where(sql`${t.scope} = 'project'`),
  ],
);

// PA-specific subtype (§4 Recommendation B). 1:1 with a precision_instance where scope='project'.
export const precisionAssessment = pgTable("precision_assessment", {
  instanceId: uuid("instance_id")
    .primaryKey()
    .references(() => precisionInstance.id),
  lifecycleStatus: paStatusEnum("lifecycle_status").notNull().default("not_started"),
  // Pinned at creation (PA's first write), never repointed by a later manifest publish (§19).
  manifestVersion: text("manifest_version")
    .notNull()
    .references((): AnyPgColumn => projectManifestVersion.version),
  // Single sanctioned pointer, atomically repointed together with the service_map_snapshot INSERT
  // by precision_assessment_confirm() (0017 integrity migration) — direct structural echo of
  // category_assessment.current_pack_id (§11) and of the existing reassign_project_responsibility()
  // pattern. True mutual reference with service_map_snapshot (which does NOT reference this table —
  // only precision_instance, §4) stays one-directional in practice; AnyPgColumn only to satisfy the
  // general forward-reference thunk typing used throughout this schema.
  serviceMapSnapshotId: uuid("service_map_snapshot_id").references((): AnyPgColumn => serviceMapSnapshot.id),
  // §3A: the client's originally-stated plan, as detected, preserved verbatim; never rewritten.
  splitRecommendation: jsonb("split_recommendation"),
  // §5: explicit column, distinct from the implicit pack.generated_at/service_map_snapshot.confirmed_at
  // event timestamps — maintained by the lifecycle guard trigger on every transition into 'confirmed'.
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Category-specific subtype (§4 Recommendation B). 1:1 with a precision_instance where scope='category'.
export const categoryAssessment = pgTable(
  "category_assessment",
  {
    instanceId: uuid("instance_id")
      .primaryKey()
      .references(() => precisionInstance.id),
    // Denormalized from precision_instance.project_id (routine physical-design choice, not a new
    // business rule): §6/§33 item 8 freezes UNIQUE(project_id, category_key) directly on this table,
    // and the frozen entity list never shows category_assessment joining through precision_instance
    // for that constraint. Kept consistent with the owning instance by the guard trigger (0017).
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    categoryKey: text("category_key").notNull(),
    lifecycleStatus: categoryStatusEnum("lifecycle_status").notNull().default("proposed"),
    // Pinned at creation: the category's currently-published manifest version at the moment this
    // row is inserted (PA detection, or Add Category using the then-current version, §19/§22) —
    // never repointed by a later publish of the same category_key.
    manifestVersion: text("manifest_version").notNull(),
    // Set exactly once, at row creation, immutable after (§7). No 'sherpa_recommended' value exists
    // anywhere in categoryOriginEnum — structural, not a convention (§7).
    categoryOrigin: categoryOriginEnum("category_origin").notNull(),
    // Single sanctioned pointer (§11), atomically repointed with the new `pack` INSERT by
    // category_assessment_complete() (0017 integrity migration). True mutual reference with `pack` —
    // AnyPgColumn needed on both sides, same pattern already used for adminUser/project (ops.ts/project.ts).
    currentPackId: uuid("current_pack_id").references((): AnyPgColumn => pack.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Permanent v1 rule (§6, frozen final by Patch #3 item 8) — no requirement_scope_key in v1.
    uniqueIndex("category_assessment_project_category_unique").on(t.projectId, t.categoryKey),
    index("category_assessment_project_id_idx").on(t.projectId),
    check("category_assessment_category_key_format", sql`${t.categoryKey} ~ '^[a-z][a-z0-9_]{1,63}$'`),
    // Composite FK to the exact pinned (category_key, version) row — never a bare version lookup
    // that could silently resolve against a different category's manifest.
    foreignKey({
      columns: [t.categoryKey, t.manifestVersion],
      foreignColumns: [categoryManifestVersion.categoryKey, categoryManifestVersion.version],
      name: "category_assessment_manifest_version_fk",
    }),
  ],
);

// =====================================================================================
// §8/§9 — Fact model (append-only; no separate Fact Override entity, §9 Option 2)
// =====================================================================================

export const fact = pgTable(
  "fact",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    // "Precision's only hard scoping column" (§3A) — kept even though scope_instance_id already
    // implies a project, so every query/index that only cares about project isolation never needs
    // to join through precision_instance first; also what the cross-project-leak guard (0017) checks
    // scope_instance_id's owning project against.
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    // NOT NULL always (Freeze Patch #3 item 5) — always a real precision_instance row: the project's
    // PA instance id for a shared/PA-level fact, or a specific category_assessment instance id for a
    // category-local fact. No "project-global, no instance" NULL state exists any more (§8).
    scopeInstanceId: uuid("scope_instance_id")
      .notNull()
      .references(() => precisionInstance.id),
    // Deliberately NOT a foreign key to field_key_registry (unlike FA's answer.field_key): Precision
    // field keys are defined by versioned, independently-publishable manifest content (§8/§13), not
    // by the static, sync-only canonical-fields registry (reference.ts) FA's question bank uses.
    // Coupling fact.field_key to that registry would silently force every Precision field through
    // FA's own sync pipeline — a real architecture decision this macroblock does not make unilaterally.
    // Resolved against the pinned manifest's field list at the application layer instead (consistent
    // with applicability_rule/requirement_level also being app-layer-deterministic, never DB-layer).
    fieldKey: text("field_key").notNull(),
    value: jsonb("value").notNull(),
    valueType: text("value_type").notNull(),
    answerState: factAnswerStateEnum("answer_state").notNull(),
    // 'precision_assessment' | 'category' — never 'fa' (§8: an FA-origin value is read live, never
    // copied merely because it was inherited) and never 'sherpa' (not in the enum).
    source: factSourceEnum("source").notNull(),
    provenanceStage: factProvenanceStageEnum("provenance_stage").notNull(),
    // Nullable; set only when provenance_stage = 'ai_extracted' — a stale AI confidence number must
    // never outlive the client's own confirm/correct act on the same field (§8), enforced below.
    confidence: real("confidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // No .references() here on purpose, same reason as answer.superseded_by (assessment.ts): Drizzle
    // cannot express DEFERRABLE INITIALLY DEFERRED. The real FK is added by hand in 0017.
    supersededBy: uuid("superseded_by"),
  },
  (t) => [
    // UNIQUE(scope_instance_id, field_key) WHERE superseded_by IS NULL — unchanged shape from the
    // frozen design; only scope_instance_id's own nullability changed (Patch #3 item 5).
    uniqueIndex("fact_current_value_idx").on(t.scopeInstanceId, t.fieldKey).where(sql`${t.supersededBy} IS NULL`),
    index("fact_history_idx").on(t.scopeInstanceId, t.fieldKey, t.createdAt.desc()),
    index("fact_superseded_by_idx").on(t.supersededBy),
    index("fact_project_id_idx").on(t.projectId, t.createdAt),
    check("fact_field_key_format", sql`${t.fieldKey} ~ '^precision\\.[a-z][a-z0-9_.]{2,80}$'`),
    check(
      "fact_confidence_only_when_ai_extracted",
      sql`${t.provenanceStage} = 'ai_extracted' OR ${t.confidence} IS NULL`,
    ),
    check("fact_confidence_range", sql`${t.confidence} IS NULL OR (${t.confidence} >= 0 AND ${t.confidence} <= 1)`),
  ],
);

// =====================================================================================
// §12/§13/§19 — Manifest version registries (two; country overlays embedded in the category one)
// =====================================================================================

// Category detection + project-level interpretation during PA (§12) — not a field-requirement list.
export const projectManifestVersion = pgTable(
  "project_manifest_version",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    version: text("version").notNull().unique(),
    // DRAFT -> PREVIEW -> PUBLISHED (reusing the existing config_version_status enum, §19 "reuse
    // config_publish ... unchanged in shape") — bookkeeping columns below are this macroblock's own
    // implementation of that reuse, additive to §12's literal content-field sketch, not a replacement
    // of it.
    status: configVersionStatusEnum("status").notNull().default("DRAFT"),
    isCurrent: boolean("is_current").notNull().default(false),
    // { candidate_categories: [...], project_split_signals: [...] } — §12.
    content: jsonb("content").notNull(),
    contentHash: text("content_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdByAdminUserId: uuid("created_by_admin_user_id")
      .notNull()
      .references(() => adminUser.adminUserId),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedByAdminUserId: uuid("published_by_admin_user_id").references(() => adminUser.adminUserId),
  },
  (t) => [
    // One canonical version active for all new PA instances at any time (§19).
    uniqueIndex("project_manifest_version_one_current").on(t.isCurrent).where(sql`${t.isCurrent} = true`),
    check("project_manifest_version_content_object", sql`jsonb_typeof(${t.content}) = 'object'`),
    check(
      "project_manifest_version_current_requires_published",
      sql`${t.isCurrent} = false OR ${t.status} = 'PUBLISHED'`,
    ),
    check(
      "project_manifest_version_published_complete",
      sql`(${t.status} = 'PUBLISHED') = (${t.publishedAt} IS NOT NULL AND ${t.publishedByAdminUserId} IS NOT NULL)`,
    ),
  ],
);

// Field-requirement list for one category, country overlays included — the sole, single-truth home
// for overlays (Freeze Patch #3 item 6: no separate country_overlay_version registry exists). Each
// category_key's version-registry is fully independent (publishing a new Logistics version never
// touches HR's current pointer, §19).
export const categoryManifestVersion = pgTable(
  "category_manifest_version",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    categoryKey: text("category_key").notNull(),
    version: text("version").notNull(),
    status: configVersionStatusEnum("status").notNull().default("DRAFT"),
    isCurrent: boolean("is_current").notNull().default(false),
    // { fields: [...], critical_decisions: [...], country_overlays: {...}, operational_pending_items:
    //   [...], visibility_rules: [...] } — §13. visibility_rule (§17) has no separate table: it is
    // versioned content on this row, exactly as §3's entity table describes ("versioned with its
    // owning manifest").
    content: jsonb("content").notNull(),
    contentHash: text("content_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdByAdminUserId: uuid("created_by_admin_user_id")
      .notNull()
      .references(() => adminUser.adminUserId),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedByAdminUserId: uuid("published_by_admin_user_id").references(() => adminUser.adminUserId),
  },
  (t) => [
    uniqueIndex("category_manifest_version_category_version_unique").on(t.categoryKey, t.version),
    // At most one current row per category_key (§19) — independent per-category pointers, not one
    // global pointer.
    uniqueIndex("category_manifest_version_one_current_per_category")
      .on(t.categoryKey)
      .where(sql`${t.isCurrent} = true`),
    index("category_manifest_version_category_key_idx").on(t.categoryKey),
    check("category_manifest_version_category_key_format", sql`${t.categoryKey} ~ '^[a-z][a-z0-9_]{1,63}$'`),
    check("category_manifest_version_content_object", sql`jsonb_typeof(${t.content}) = 'object'`),
    check(
      "category_manifest_version_current_requires_published",
      sql`${t.isCurrent} = false OR ${t.status} = 'PUBLISHED'`,
    ),
    check(
      "category_manifest_version_published_complete",
      sql`(${t.status} = 'PUBLISHED') = (${t.publishedAt} IS NOT NULL AND ${t.publishedByAdminUserId} IS NOT NULL)`,
    ),
  ],
);

// =====================================================================================
// §2/§3/§10/§11 — Immutable outputs: service_map_snapshot (project-scope) and pack (category-scope)
// =====================================================================================

// Immutable confirmed Precision Service Map, one per PA confirmation/reconfirmation (§2/§3). Never
// a `pack` row — separate, independently-named table (§1.12).
export const serviceMapSnapshot = pgTable(
  "service_map_snapshot",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    // The PA's own instance id (scope='project') — checked by the 0017 guard trigger, since a plain
    // FK cannot assert the referenced precision_instance row's `scope` value.
    precisionInstanceId: uuid("precision_instance_id")
      .notNull()
      .references(() => precisionInstance.id),
    // Plain incrementing integer per precision_instance_id (display + context_snapshot references),
    // mirroring pack.version (§11) — never queried to determine currency; precision_assessment.
    // service_map_snapshot_id always is.
    version: integer("version").notNull(),
    // The row's own creation time IS the confirmation event timestamp (§5) — no separate column.
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
    content: jsonb("content").notNull(),
  },
  (t) => [
    uniqueIndex("service_map_snapshot_instance_version_unique").on(t.precisionInstanceId, t.version),
    index("service_map_snapshot_instance_idx").on(t.precisionInstanceId, t.confirmedAt),
    check("service_map_snapshot_content_object", sql`jsonb_typeof(${t.content}) = 'object'`),
  ],
);

// Immutable Category Requirement Pack, category-scope only, one per category completion/recompletion
// (§2/§3/§11).
export const pack = pgTable(
  "pack",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    categoryAssessmentInstanceId: uuid("category_assessment_instance_id")
      .notNull()
      .references(() => categoryAssessment.instanceId),
    version: integer("version").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    // The Category Requirement Pack body itself, including the applicable operational_pending_items
    // subset, computed at generation time, never stored per-instance (§16).
    content: jsonb("content").notNull(),
    // Pointer-manifest only (§10 hybrid recommendation), never a value copy: { category_manifest_version,
    // destination_country, destination_country_source_ref, fact_ids: [...], fa_answer_refs: [...] }.
    contextSnapshot: jsonb("context_snapshot").notNull(),
  },
  (t) => [
    uniqueIndex("pack_instance_version_unique").on(t.categoryAssessmentInstanceId, t.version),
    index("pack_instance_idx").on(t.categoryAssessmentInstanceId, t.generatedAt),
    check("pack_content_object", sql`jsonb_typeof(${t.content}) = 'object'`),
    check("pack_context_snapshot_object", sql`jsonb_typeof(${t.contextSnapshot}) = 'object'`),
  ],
);
