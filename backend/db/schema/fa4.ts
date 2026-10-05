import { bigserial, boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * FA Public v1.0 persistence (module `fa4`). Deliberately isolated from the legacy First Assessment tables:
 * `project` pins legacy question-bank / rules / snapshot-template versions through triggers, and `email_delivery` only
 * accepts legacy templates, so FA 4.0 keeps its own project row. `fa4_project.project_id` is the continuity anchor that a
 * later platform-wide project unification can link to without renumbering.
 *
 * Catalog (Category -> Service -> Capability) is stored as typed JSON per entity with publication status; only a
 * PUBLISHED, immutable catalog version affects customer-facing results (CATALOG_MODEL §5). Delivered results are
 * append-only and keep the catalog version used to generate them (D-117) — enforced by triggers in 0016.
 */

export const fa4CatalogEntity = pgTable(
  "fa4_catalog_entity",
  {
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    publicationStatus: text("publication_status").notNull(),
    /** The EFFECTIVE record. For a PUBLISHED entity it never changes until a new version is explicitly published. */
    data: jsonb("data").notNull(),
    /** A pending edit. Saving a draft never touches `data` / `publication_status` (draft/published isolation). */
    draftData: jsonb("draft_data"),
    draftStatus: text("draft_status"),
    validFrom: text("valid_from").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fa4_catalog_entity_pk").on(t.entityType, t.entityId),
    check("fa4_catalog_entity_type", sql`${t.entityType} IN ('FRONT','CATEGORY','SERVICE','CAPABILITY','COUNTRY')`),
    check("fa4_catalog_entity_status", sql`${t.publicationStatus} IN ('DRAFT','REVIEW','PUBLISHED','ARCHIVED')`),
    check("fa4_catalog_entity_draft_status", sql`${t.draftStatus} IS NULL OR ${t.draftStatus} IN ('DRAFT','REVIEW')`),
    check("fa4_catalog_entity_draft_consistency", sql`(${t.draftData} IS NULL) = (${t.draftStatus} IS NULL)`),
  ],
);

export const fa4CatalogChange = pgTable(
  "fa4_catalog_change",
  {
    changeId: bigserial("change_id", { mode: "number" }).primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    changedBy: text("changed_by").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
    previousStatus: text("previous_status"),
    newStatus: text("new_status").notNull(),
    reason: text("reason").notNull(),
    catalogVersion: text("catalog_version"),
  },
  (t) => [index("fa4_catalog_change_entity_idx").on(t.entityType, t.entityId, t.changeId)],
);

export const fa4CatalogVersion = pgTable("fa4_catalog_version", {
  version: text("version").primaryKey(),
  // Monotonic order of publication (timestamps are not enough: two versions can share a transaction time).
  versionSeq: bigserial("version_seq", { mode: "number" }).notNull().unique(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  content: jsonb("content").notNull(),
});

export const fa4Project = pgTable(
  "fa4_project",
  {
    projectId: uuid("project_id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull(),
    locale: text("locale").notNull(),
    stepKey: text("step_key").notNull(),
    answers: jsonb("answers").notNull(),
    status: text("status").notNull().default("IN_PROGRESS"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fa4_project_email_idx").on(t.email, t.updatedAt),
    check("fa4_project_status", sql`${t.status} IN ('IN_PROGRESS','DELIVERED','INELIGIBLE','ANONYMIZED')`),
    check("fa4_project_locale", sql`${t.locale} IN ('es','en')`),
  ],
);

export const fa4AccessToken = pgTable(
  "fa4_access_token",
  {
    tokenId: uuid("token_id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id").notNull().references(() => fa4Project.projectId),
    kind: text("kind").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    // RESUME links are single-use: the exchange atomically sets used_at (and revoked_at).
    usedAt: timestamp("used_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("fa4_access_token_hash_unique").on(t.tokenHash),
    index("fa4_access_token_project_idx").on(t.projectId, t.kind),
    check("fa4_access_token_kind", sql`${t.kind} IN ('SESSION','RESUME')`),
  ],
);

export const fa4Result = pgTable(
  "fa4_result",
  {
    resultId: uuid("result_id").primaryKey().default(sql`gen_random_uuid()`),
    // Monotonic order of delivery: timestamps are not enough (several results can share one transaction time).
    resultSeq: bigserial("result_seq", { mode: "number" }).notNull(),
    projectId: uuid("project_id").notNull().references(() => fa4Project.projectId),
    catalogVersion: text("catalog_version").notNull().references(() => fa4CatalogVersion.version),
    model: jsonb("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fa4_result_project_idx").on(t.projectId, t.resultSeq), uniqueIndex("fa4_result_seq_unique").on(t.resultSeq)],
);

export const fa4DemandSignal = pgTable(
  "fa4_demand_signal",
  {
    signalId: text("signal_id").primaryKey(),
    projectId: uuid("project_id").notNull().references(() => fa4Project.projectId),
    destination: text("destination").notNull(),
    capabilityId: text("capability_id"),
    reason: text("reason").notNull(),
    signalClass: text("class").notNull(),
    sourcingStatus: text("sourcing_status"),
    triageStatus: text("triage_status"),
    owner: text("owner"),
    premiumState: text("premium_state").notNull(),
    catalogVersion: text("catalog_version").notNull().references(() => fa4CatalogVersion.version),
    payload: jsonb("payload").notNull(),
    // A signal whose demand disappears is superseded (UPDATE), never deleted: the runtime role has no DELETE (least privilege).
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("fa4_demand_signal_premium_state", sql`${t.premiumState} IN ('NONE','OFFERED','ACTIVE')`),
    check("fa4_demand_signal_sourcing_status", sql`${t.sourcingStatus} IS NULL OR ${t.sourcingStatus} IN ('OPEN','RESEARCHING','SHORTLISTED','BUSINESS_CHECK','COVERED','DISMISSED')`),
    check("fa4_demand_signal_triage_status", sql`${t.triageStatus} IS NULL OR ${t.triageStatus} IN ('PENDING','INVESTIGATE','NO_ACTION')`),
    index("fa4_demand_signal_project_idx").on(t.projectId),
    index("fa4_demand_signal_capability_idx").on(t.destination, t.capabilityId),
    check("fa4_demand_signal_class", sql`${t.signalClass} IN ('ACTIONABLE','INFORMATIONAL')`),
    check("fa4_demand_signal_reason", sql`${t.reason} IN ('SOURCEABLE','REVIEW','DEVELOPING','NO_ACTIVE_COVERAGE','UNMAPPED_NEED','NOT_OFFERED')`),
  ],
);

export const fa4EmailDelivery = pgTable(
  "fa4_email_delivery",
  {
    deliveryId: uuid("delivery_id").primaryKey().default(sql`gen_random_uuid()`),
    dedupeKey: text("dedupe_key").notNull(),
    projectId: uuid("project_id").notNull().references(() => fa4Project.projectId),
    template: text("template").notNull(),
    status: text("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    lastError: text("last_error"),
    providerName: text("provider_name"),
    providerReference: text("provider_reference"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fa4_email_delivery_dedupe_unique").on(t.dedupeKey),
    index("fa4_email_delivery_due_idx").on(t.status, t.nextAttemptAt),
    index("fa4_email_delivery_project_idx").on(t.projectId, t.template, t.createdAt),
    check("fa4_email_delivery_status", sql`${t.status} IN ('PENDING','SENDING','SENT','FAILED','DEAD','CANCELLED')`),
    check("fa4_email_delivery_template", sql`${t.template} IN ('fa4_resume_link','fa4_result_link')`),
  ],
);

export const fa4ContinuationRequest = pgTable(
  "fa4_continuation_request",
  {
    requestId: uuid("request_id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id").notNull().references(() => fa4Project.projectId),
    resultId: uuid("result_id").notNull().references(() => fa4Result.resultId),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fa4_continuation_request_project_idx").on(t.projectId), uniqueIndex("fa4_continuation_request_unique").on(t.projectId, t.resultId)],
);

/**
 * Immutable legal-acceptance evidence (Terms and Privacy are separate acceptances, D-085). Written once when the project is created;
 * changing normal FA answers can never rewrite it. No IP address or other personal data is collected here. LEGAL-1 / CHK-1 (final
 * documents, versions and URLs) remain launch blockers: `document_version` / `document_url` come from configuration.
 */
export const fa4LegalAcceptance = pgTable(
  "fa4_legal_acceptance",
  {
    acceptanceId: uuid("acceptance_id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id").notNull().references(() => fa4Project.projectId),
    document: text("document").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    documentVersion: text("document_version").notNull(),
    documentUrl: text("document_url").notNull(),
    language: text("language").notNull(),
  },
  (t) => [
    uniqueIndex("fa4_legal_acceptance_unique").on(t.projectId, t.document),
    check("fa4_legal_acceptance_document", sql`${t.document} IN ('TERMS','PRIVACY')`),
    check("fa4_legal_acceptance_language", sql`${t.language} IN ('es','en')`),
  ],
);

/** Audit trail of authorized privacy erasures (no personal data). */
export const fa4PrivacyErasureLog = pgTable(
  "fa4_privacy_erasure_log",
  {
    erasureId: uuid("erasure_id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id").notNull().references(() => fa4Project.projectId),
    mode: text("mode").notNull(),
    actor: text("actor").notNull(),
    reason: text("reason").notNull(),
    performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("fa4_privacy_erasure_mode", sql`${t.mode} IN ('ANONYMIZE')`)],
);

/**
 * OPTIONAL commercial-communications consent, kept apart from the legal acceptances (Terms / Privacy never imply it). Append-only history:
 * the first row is the decision taken at project creation (consented true OR false), later rows record every change.
 * `wording_ref` identifies the exact checkbox wording shown; no IP or other personal data is stored.
 */
export const fa4MarketingConsent = pgTable(
  "fa4_marketing_consent",
  {
    consentId: uuid("consent_id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id").notNull().references(() => fa4Project.projectId),
    consented: boolean("consented").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    language: text("language").notNull(),
    wordingRef: text("wording_ref").notNull(),
  },
  (t) => [
    index("fa4_marketing_consent_project_idx").on(t.projectId, t.decidedAt),
    check("fa4_marketing_consent_language", sql`${t.language} IN ('es','en')`),
  ],
);
