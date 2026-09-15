import { bigint, check, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { outboxEvent } from "./ops";
import { project } from "./project";

// Analytics, Integrations & Security Hardening (Build Plan v1.1 Phases 12–13).

// Post-Snapshot feedback (frozen question, 1 Not useful → 5 Very useful, optional comment). One
// answer per project, accepted only once the Snapshot exists. The optional comment is client
// content: it never enters analytics events and it is deleted by the temporary-retention purge.
export const snapshotFeedback = pgTable(
  "snapshot_feedback",
  {
    feedbackId: uuid("feedback_id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    questionVersion: text("question_version").notNull(),
    usefulness: smallint("usefulness").notNull(),
    comment: text("comment"),
    channel: text("channel").notNull(),
    interfaceLanguage: text("interface_language").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("snapshot_feedback_project_unique").on(t.projectId),
    index("snapshot_feedback_submitted_idx").on(t.submittedAt),
    check("snapshot_feedback_usefulness", sql`${t.usefulness} BETWEEN 1 AND 5`),
    check("snapshot_feedback_comment_length", sql`${t.comment} IS NULL OR char_length(${t.comment}) BETWEEN 1 AND 2000`),
    check("snapshot_feedback_channel", sql`${t.channel} IN ('session', 'private_link')`),
    check("snapshot_feedback_language", sql`${t.interfaceLanguage} IN ('en', 'es')`),
    check("snapshot_feedback_question_version", sql`${t.questionVersion} ~ '^[a-z0-9][a-z0-9.-]{2,40}$'`),
  ],
);

// Segmentation dimensions for analytics: enumerated option values and ISO country codes only —
// never names, emails, company data or open text. Refreshed from the effective structured answers
// at every confirmed step and at completion; kept (like journey events) when a free assessment's
// client data is purged, so aggregate analytics stay complete without keeping personal data.
export const analyticsProjectProfile = pgTable(
  "analytics_project_profile",
  {
    projectId: uuid("project_id").primaryKey().references(() => project.projectId),
    questionBankVersion: text("question_bank_version").notNull(),
    primaryGoal: text("primary_goal"),
    projectStage: text("project_stage"),
    entryMode: text("entry_mode"),
    destinationStatus: text("destination_status"),
    businessType: text("business_type"),
    targetMarkets: text("target_markets").array().notNull().default(sql`'{}'::text[]`),
    expectedCapabilities: text("expected_capabilities").array().notNull().default(sql`'{}'::text[]`),
    operationComponents: text("operation_components").array().notNull().default(sql`'{}'::text[]`),
    signalAreas: jsonb("signal_areas").notNull().default(sql`'{}'::jsonb`),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("analytics_project_profile_completed_idx").on(t.completedAt),
    check("analytics_project_profile_entry_mode", sql`${t.entryMode} IS NULL OR ${t.entryMode} IN ('new_market', 'already_operating')`),
    check(
      "analytics_project_profile_enumerations",
      sql`(${t.primaryGoal} IS NULL OR ${t.primaryGoal} ~ '^[a-z0-9_]{1,64}$')
        AND (${t.projectStage} IS NULL OR ${t.projectStage} ~ '^[a-z0-9_]{1,64}$')
        AND (${t.destinationStatus} IS NULL OR ${t.destinationStatus} ~ '^[a-z0-9_]{1,64}$')
        AND (${t.businessType} IS NULL OR ${t.businessType} ~ '^[a-z0-9_]{1,64}$')`,
    ),
  ],
);

// Outbound integration delivery (one row per outbox event × destination). PostgreSQL stays the
// system of record: rows carry ids only, the destination adapter reads what its mapping needs at
// delivery time, and nothing a destination returns can write canonical entities.
export const integrationDelivery = pgTable(
  "integration_delivery",
  {
    deliveryId: uuid("delivery_id").primaryKey().default(sql`gen_random_uuid()`),
    outboxEventId: bigint("outbox_event_id", { mode: "number" })
      .notNull()
      .references(() => outboxEvent.outboxEventId),
    eventId: uuid("event_id").notNull(),
    destination: text("destination").notNull(),
    eventType: text("event_type").notNull(),
    projectId: uuid("project_id").references(() => project.projectId),
    status: text("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(8),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    lastError: text("last_error"),
    adapterName: text("adapter_name"),
    externalReference: text("external_reference"),
    skipReason: text("skip_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("integration_delivery_event_destination_unique").on(t.eventId, t.destination),
    index("integration_delivery_due_idx").on(t.status, t.nextAttemptAt),
    index("integration_delivery_project_idx").on(t.projectId, t.createdAt),
    check("integration_delivery_status", sql`${t.status} IN ('PENDING', 'SENDING', 'DELIVERED', 'FAILED', 'DEAD', 'SKIPPED')`),
    check("integration_delivery_destination", sql`${t.destination} IN ('smartsuite', 'operation_hub')`),
    check("integration_delivery_attempts", sql`${t.attempts} >= 0 AND ${t.maxAttempts} BETWEEN 1 AND 20 AND ${t.attempts} <= ${t.maxAttempts}`),
  ],
);

// The id a destination assigned to this project's record (e.g. a SmartSuite record id). External
// ids only; kept after a purge so the destination copy can be deleted too.
export const integrationExternalRef = pgTable(
  "integration_external_ref",
  {
    destination: text("destination").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.projectId),
    externalId: text("external_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.destination, t.projectId] }),
    check("integration_external_ref_destination", sql`${t.destination} IN ('smartsuite', 'operation_hub')`),
    check("integration_external_ref_external_id", sql`char_length(${t.externalId}) BETWEEN 1 AND 200`),
  ],
);

// Fixed-window request counters shared by every API instance. Keys are HMACs of the client
// address, email or token under a server-side secret: no raw IP, email or token is stored.
export const rateLimitCounter = pgTable(
  "rate_limit_counter",
  {
    bucketKey: text("bucket_key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    policy: text("policy").notNull(),
    hits: integer("hits").notNull().default(0),
    maxHits: integer("max_hits").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.bucketKey, t.windowStart] }),
    index("rate_limit_counter_expires_idx").on(t.expiresAt),
    index("rate_limit_counter_policy_idx").on(t.policy, t.windowStart),
    check("rate_limit_counter_key_format", sql`${t.bucketKey} ~ '^[a-z][a-z0-9_]{2,40}:[0-9a-f]{64}$'`),
    check("rate_limit_counter_policy_format", sql`${t.policy} ~ '^[a-z][a-z0-9_]{2,40}$'`),
    check("rate_limit_counter_hits", sql`${t.hits} >= 0 AND ${t.maxHits} >= 1`),
  ],
);
