import { boolean, check, index, integer, jsonb, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { person } from "./identity";
import { project } from "./project";
import { questionBankVersion } from "./reference";

// First Assessment Core (Build Plan v1.1 Phases 4–6 + current Functional & Experience Handoff v1).

export const legalDocumentEnum = pgEnum("legal_document", ["PRIVACY_POLICY", "TERMS"]);

// SESSION = in-browser working session; RESUME = private link sent by email (proves email control).
export const faAccessTokenKindEnum = pgEnum("fa_access_token_kind", ["SESSION", "RESUME"]);

export const faExtensionReasonEnum = pgEnum("fa_extension_reason", [
  "MISSING_INFORMATION",
  "PROJECT_NOT_STRUCTURED",
  "UNSURE_MARKET_TIMING",
  "SOMETHING_ELSE",
]);

// Append-only record of the required Privacy Policy + Terms acceptance at Identity.
export const legalAcceptance = pgTable(
  "legal_acceptance",
  {
    acceptanceId: uuid("acceptance_id").primaryKey().default(sql`gen_random_uuid()`),
    personId: uuid("person_id").notNull().references(() => person.personId),
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    document: legalDocumentEnum("document").notNull(),
    // The URL presented at acceptance time (configurable setting; NULL only if not yet configured).
    documentUrl: text("document_url"),
    // Phase 11 evidence: the pinned question bank version whose links and consent copy were shown.
    questionBankVersion: text("question_bank_version").references(() => questionBankVersion.version),
    interfaceLanguage: text("interface_language").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("legal_acceptance_project_document_unique").on(t.projectId, t.document)],
);

// Only a sha256 hash of each token is stored; the raw token exists only in the client/email.
export const projectAccessToken = pgTable(
  "project_access_token",
  {
    tokenId: uuid("token_id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    kind: faAccessTokenKindEnum("kind").notNull(),
    tokenHash: text("token_hash").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("project_access_token_hash_unique").on(t.tokenHash),
    index("project_access_token_project_kind_idx").on(t.projectId, t.kind),
  ],
);

// Three separate lifecycles share this row (Phase 11):
//   * access — access_window_* start only when the first private link is emitted (15 days
//     provisional, +15/+30 extensions, capped at day 45); opening a link never changes them;
//   * private-link validity — lives on project_access_token.expires_at, not here;
//   * temporary data retention — retention_until is ALWAYS set: from the lifecycle origin (identity)
//     until a link is emitted, then from the access-window start; it only ever moves later, and
//     only applies while Premium was never activated.
export const faProjectLifecycle = pgTable(
  "fa_project_lifecycle",
  {
    projectId: uuid("project_id").primaryKey().references(() => project.projectId),
    identityCompletedAt: timestamp("identity_completed_at", { withTimezone: true }).notNull(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull(),
    lastAnsweredQuestionId: text("last_answered_question_id"),
    accessWindowStartedAt: timestamp("access_window_started_at", { withTimezone: true }),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
    accessMaxUntil: timestamp("access_max_until", { withTimezone: true }),
    retentionUntil: timestamp("retention_until", { withTimezone: true }),
    // LIFECYCLE_ORIGIN (no private link emitted yet) or ACCESS_WINDOW.
    retentionBasis: text("retention_basis"),
    // Written by the lifecycle job (write-once per milestone).
    reminderDay10SentAt: timestamp("reminder_day10_sent_at", { withTimezone: true }),
    recoveryEmailSentAt: timestamp("recovery_email_sent_at", { withTimezone: true }),
    // The access_expires_at value whose expiry was last recorded (one assessment_expired per expiry).
    accessExpiryRecordedFor: timestamp("access_expiry_recorded_for", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "fa_project_lifecycle_access_window_consistency",
      sql`(${t.accessWindowStartedAt} IS NULL AND ${t.accessExpiresAt} IS NULL AND ${t.accessMaxUntil} IS NULL)
       OR (${t.accessWindowStartedAt} IS NOT NULL AND ${t.accessExpiresAt} IS NOT NULL AND ${t.accessMaxUntil} IS NOT NULL
           AND ${t.accessExpiresAt} <= ${t.accessMaxUntil})`,
    ),
    index("fa_project_lifecycle_access_expires_idx").on(t.accessExpiresAt),
    index("fa_project_lifecycle_retention_until_idx").on(t.retentionUntil),
  ],
);

// Append-only log of immediate access extensions (+15 / +30 days) with the structured reason.
export const faAccessExtension = pgTable(
  "fa_access_extension",
  {
    extensionId: uuid("extension_id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    requestedDays: smallint("requested_days").notNull(),
    reason: faExtensionReasonEnum("reason").notNull(),
    previousExpiresAt: timestamp("previous_expires_at", { withTimezone: true }).notNull(),
    newExpiresAt: timestamp("new_expires_at", { withTimezone: true }).notNull(),
    wasExpired: boolean("was_expired").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("fa_access_extension_days", sql`${t.requestedDays} IN (15, 30)`),
    index("fa_access_extension_project_idx").on(t.projectId, t.requestedAt),
  ],
);

// Journey analytics — technical ids, field keys and enumerated context only. Never PII, never
// open-text content. Append-only.
export const faJourneyEvent = pgTable(
  "fa_journey_event",
  {
    eventId: uuid("event_id").primaryKey().default(sql`gen_random_uuid()`),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    clientOccurredAt: timestamp("client_occurred_at", { withTimezone: true }),
    anonymousSessionId: uuid("anonymous_session_id"),
    projectId: uuid("project_id").references(() => project.projectId),
    stepId: text("step_id"),
    questionId: text("question_id"),
    fieldKey: text("field_key"),
    questionBankVersion: text("question_bank_version"),
    interfaceLanguage: text("interface_language"),
    durationMs: integer("duration_ms"),
    valueState: text("value_state"),
    properties: jsonb("properties").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    check("fa_journey_event_type_format", sql`${t.eventType} ~ '^[a-z][a-z0-9_]{2,63}$'`),
    check("fa_journey_event_value_state", sql`${t.valueState} IS NULL OR ${t.valueState} IN ('answered', 'not_sure', 'cleared')`),
    check("fa_journey_event_duration", sql`${t.durationMs} IS NULL OR ${t.durationMs} >= 0`),
    index("fa_journey_event_project_idx").on(t.projectId, t.occurredAt),
    index("fa_journey_event_type_idx").on(t.eventType, t.occurredAt),
    index("fa_journey_event_anonymous_idx").on(t.anonymousSessionId),
  ],
);
