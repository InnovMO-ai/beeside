import { bigint, boolean, check, customType, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { project } from "./project";

/**
 * Precision V1.0 — Understanding Core persistence + the Knowledge Service + the Country Resource Library.
 *
 *  understanding_frame        — the project frame (what Precision understands), one row per project, optimistic version.
 *  understanding_frame_event   — append-only history (one row per accepted turn / edit), idempotent by (project, turn_key, kind).
 *  knowledge_*                 — Source Registry, versioned documents, retrievable passages (Spanish FTS index in the integrity migration).
 *  country_resource            — configurable guides per country (URL / document destination managed in Admin; nothing hardcoded).
 *
 * The knowledge tables are GLOBAL (not project data). The frame tables hold client content and are erased with the project.
 */
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const understandingFrame = pgTable(
  "understanding_frame",
  {
    projectId: uuid("project_id").primaryKey().references(() => project.projectId),
    /** Optimistic concurrency: every write states the version it read. */
    version: integer("version").notNull().default(1),
    locale: text("locale").notNull(),
    frame: jsonb("frame").notNull(),
    discoveryPinId: uuid("discovery_pin_id"),
    /** Set when the client closed the understanding (confirmed the Service Map); the frame then only changes by explicit client edits. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("understanding_frame_locale", sql`${t.locale} IN ('en','es')`),
    check("understanding_frame_object", sql`jsonb_typeof(${t.frame}) = 'object'`),
    check("understanding_frame_version", sql`${t.version} >= 1`),
  ],
);

export const understandingFrameEvent = pgTable(
  "understanding_frame_event",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    turnKey: text("turn_key").notNull(),
    kind: text("kind").notNull(),
    frameVersion: integer("frame_version").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("understanding_frame_event_key").on(t.projectId, t.turnKey, t.kind),
    index("understanding_frame_event_project_seq").on(t.projectId, t.seq),
    check("understanding_frame_event_kind", sql`${t.kind} IN ('seed','turn','edit','correction','freshness','close')`),
    check("understanding_frame_event_payload", sql`jsonb_typeof(${t.payload}) = 'object'`),
  ],
);

// ------------------------------------------------------------------ Knowledge (global)
export const knowledgeSource = pgTable(
  "knowledge_source",
  {
    id: text("id").primaryKey(),
    institution: text("institution").notNull(),
    domains: text("domains").array().notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    topics: text("topics").array().notNull(),
    authority: text("authority").notNull(),
    roles: text("roles").array().notNull(),
    isPrimary: boolean("is_primary").notNull(),
    cadence: text("cadence").notNull(),
    risk: text("risk").notNull(),
    reviewRequired: boolean("review_required").notNull(),
    granularity: text("granularity").notNull(),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("knowledge_source_id", sql`${t.id} ~ '^[a-z0-9][a-z0-9_.-]{1,62}$'`),
    check("knowledge_source_authority", sql`${t.authority} IN ('official_primary','trusted_institutional','beeside_curated','secondary')`),
    check("knowledge_source_cadence", sql`${t.cadence} IN ('continuous','monthly','quarterly','annual','biennial','ad_hoc')`),
    check("knowledge_source_risk", sql`${t.risk} IN ('high','medium','low')`),
    check("knowledge_source_granularity", sql`${t.granularity} IN ('country','state','municipality','city','sector','none')`),
    // The hierarchy is enforced in the database too: only official primary sources may ground obligations; high risk is always reviewed.
    check("knowledge_source_obligation_authority", sql`NOT ('obligation' = ANY(${t.roles})) OR ${t.authority} = 'official_primary'`),
    check("knowledge_source_high_risk_review", sql`${t.risk} <> 'high' OR ${t.reviewRequired}`),
    check("knowledge_source_domains", sql`cardinality(${t.domains}) >= 1`),
  ],
);

export const knowledgeDocument = pgTable(
  "knowledge_document",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull().references(() => knowledgeSource.id),
    title: text("title").notNull(),
    edition: text("edition").notNull(),
    version: integer("version").notNull(),
    publishedAt: text("published_at"),
    effectiveAt: text("effective_at"),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    topics: text("topics").array().notNull().default(sql`'{}'::text[]`),
    locator: text("locator").notNull(),
    contentHash: text("content_hash").notNull(),
    confidence: text("confidence").notNull(),
    status: text("status").notNull().default("active"),
    supersedesId: text("supersedes_id"),
    supersededById: text("superseded_by_id"),
    language: text("language").notNull().default("es"),
  },
  (t) => [
    uniqueIndex("knowledge_document_version").on(t.sourceId, t.title, t.version),
    index("knowledge_document_source_status").on(t.sourceId, t.status),
    foreignKey({ columns: [t.supersedesId], foreignColumns: [t.id], name: "knowledge_document_supersedes_fk" }),
    foreignKey({ columns: [t.supersededById], foreignColumns: [t.id], name: "knowledge_document_superseded_by_fk" }),
    check("knowledge_document_status", sql`${t.status} IN ('active','superseded','withdrawn')`),
    check("knowledge_document_confidence", sql`${t.confidence} IN ('high','medium','low')`),
    check("knowledge_document_hash", sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
    check("knowledge_document_superseded_consistent", sql`(${t.status} = 'superseded') = (${t.supersededById} IS NOT NULL)`),
  ],
);

export const knowledgePassage = pgTable(
  "knowledge_passage",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => knowledgeDocument.id),
    sourceId: text("source_id").notNull().references(() => knowledgeSource.id),
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull(),
    location: text("location").notNull(),
    topics: text("topics").array().notNull().default(sql`'{}'::text[]`),
    units: text("units").array().notNull().default(sql`'{}'::text[]`),
    granularity: text("granularity").notNull(),
    indicators: jsonb("indicators").notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [
    index("knowledge_passage_document").on(t.documentId, t.ordinal),
    check("knowledge_passage_granularity", sql`${t.granularity} IN ('country','state','municipality','city','sector','none')`),
    check("knowledge_passage_indicators", sql`jsonb_typeof(${t.indicators}) = 'array'`),
  ],
);

export const knowledgeCandidate = pgTable(
  "knowledge_candidate",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull().references(() => knowledgeSource.id),
    status: text("status").notNull(),
    candidate: jsonb("candidate").notNull(),
    /** Bytes of the fetched document, kept until the candidate is decided and applied. */
    data: bytea("data"),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    index("knowledge_candidate_status").on(t.status, t.detectedAt),
    check("knowledge_candidate_status", sql`${t.status} IN ('pending_review','approved','rejected','auto_applied','unchanged')`),
  ],
);

export const countryResource = pgTable(
  "country_resource",
  {
    id: text("id").primaryKey(),
    countryCode: text("country_code").notNull(),
    title: text("title").notNull(),
    language: text("language").notNull(),
    version: text("version").notNull(),
    destinationKind: text("destination_kind").notNull(),
    destinationRef: text("destination_ref").notNull(),
    active: boolean("active").notNull().default(true),
    effectiveAt: text("effective_at"),
    updatedAt: text("updated_at").notNull(),
    topic: text("topic"),
    section: text("section"),
  },
  (t) => [
    index("country_resource_country").on(t.countryCode, t.active),
    check("country_resource_country", sql`${t.countryCode} ~ '^[A-Z]{2}$'`),
    check("country_resource_language", sql`${t.language} ~ '^[a-z]{2}$'`),
    check("country_resource_kind", sql`${t.destinationKind} IN ('url','document')`),
    check("country_resource_https", sql`${t.destinationKind} <> 'url' OR ${t.destinationRef} ~ '^https://[^ ]+$'`),
  ],
);
