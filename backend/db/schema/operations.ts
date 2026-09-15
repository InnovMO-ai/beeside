import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { actorTypeEnum, adminRoleEnum, assessmentStateEnum } from "./enums";
import { person } from "./identity";
import { adminUser } from "./ops";
import { project } from "./project";

// Operations & Lifecycle Control (Build Plan v1.1 Phases 10–11).

// Authenticated Admin/Supervisor sessions, created only after a verified identity-provider login.
// The browser holds an opaque token in an HttpOnly cookie; only its sha256 is stored.
export const adminSession = pgTable(
  "admin_session",
  {
    sessionId: uuid("session_id").primaryKey().default(sql`gen_random_uuid()`),
    adminUserId: uuid("admin_user_id").notNull().references(() => adminUser.adminUserId),
    tokenHash: text("token_hash").notNull(),
    roleAtLogin: adminRoleEnum("role_at_login").notNull(),
    authIssuer: text("auth_issuer").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: text("revoke_reason"),
  },
  (t) => [
    uniqueIndex("admin_session_token_hash_unique").on(t.tokenHash),
    index("admin_session_admin_user_idx").on(t.adminUserId, t.createdAt),
    check("admin_session_expiry_after_creation", sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

// Append-only audit of every sensitive Admin/Supervisor action (including denied attempts and
// reads of client data) and of system lifecycle actions. Never stores secrets or answer content.
export const adminAuditEvent = pgTable(
  "admin_audit_event",
  {
    auditId: uuid("audit_id").primaryKey().default(sql`gen_random_uuid()`),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorAdminUserId: uuid("actor_admin_user_id").references(() => adminUser.adminUserId),
    action: text("action").notNull(),
    outcome: text("outcome").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    projectId: uuid("project_id").references(() => project.projectId),
    requestId: text("request_id"),
    details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    index("admin_audit_event_occurred_idx").on(t.occurredAt),
    index("admin_audit_event_actor_idx").on(t.actorAdminUserId, t.occurredAt),
    index("admin_audit_event_project_idx").on(t.projectId, t.occurredAt),
    check("admin_audit_event_outcome", sql`${t.outcome} IN ('ALLOWED', 'DENIED', 'FAILED')`),
    check("admin_audit_event_action_format", sql`${t.action} ~ '^[a-z][a-z0-9_.]{2,80}$'`),
    check(
      "admin_audit_event_actor_consistency",
      sql`(${t.actorType} = 'ADMIN_USER' AND ${t.actorAdminUserId} IS NOT NULL) OR (${t.actorType} = 'SYSTEM' AND ${t.actorAdminUserId} IS NULL)`,
    ),
  ],
);

// Transactional email outbox. A row is written in the same transaction as the business change that
// requires the email; delivery happens later, outside that transaction, with bounded retry. The
// recipient address is resolved from `person` at send time and never copied here.
export const emailDelivery = pgTable(
  "email_delivery",
  {
    deliveryId: uuid("delivery_id").primaryKey().default(sql`gen_random_uuid()`),
    dedupeKey: text("dedupe_key").notNull(),
    projectId: uuid("project_id").references(() => project.projectId),
    personId: uuid("person_id").notNull().references(() => person.personId),
    template: text("template").notNull(),
    templateSource: text("template_source").notNull(),
    linkKind: text("link_kind"),
    context: jsonb("context").notNull().default(sql`'{}'::jsonb`),
    enqueuedBy: text("enqueued_by").notNull(),
    status: text("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    lastError: text("last_error"),
    providerName: text("provider_name"),
    providerReference: text("provider_reference"),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("email_delivery_dedupe_key_unique").on(t.dedupeKey),
    index("email_delivery_due_idx").on(t.status, t.nextAttemptAt),
    index("email_delivery_project_idx").on(t.projectId, t.createdAt),
    check("email_delivery_status", sql`${t.status} IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'DEAD', 'CANCELLED')`),
    check("email_delivery_template_format", sql`${t.template} ~ '^[a-z][a-z0-9_]{2,63}$'`),
    check("email_delivery_template_source", sql`${t.templateSource} IN ('question_bank', 'snapshot_template')`),
    check("email_delivery_link_kind", sql`${t.linkKind} IS NULL OR ${t.linkKind} = 'RESUME'`),
    check("email_delivery_attempts", sql`${t.attempts} >= 0 AND ${t.maxAttempts} BETWEEN 1 AND 20 AND ${t.attempts} <= ${t.maxAttempts}`),
  ],
);

// One row per scheduled/manual job execution. At most one RUNNING row per job (a partial unique
// index), so duplicate runners skip instead of doing the same work twice.
export const jobRun = pgTable(
  "job_run",
  {
    runId: uuid("run_id").primaryKey().default(sql`gen_random_uuid()`),
    jobName: text("job_name").notNull(),
    trigger: text("trigger").notNull(),
    triggeredByAdminUserId: uuid("triggered_by_admin_user_id").references(() => adminUser.adminUserId),
    status: text("status").notNull().default("RUNNING"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    stats: jsonb("stats").notNull().default(sql`'{}'::jsonb`),
    error: text("error"),
  },
  (t) => [
    uniqueIndex("job_run_one_running_per_job").on(t.jobName).where(sql`${t.status} = 'RUNNING'`),
    index("job_run_job_started_idx").on(t.jobName, t.startedAt),
    check("job_run_status", sql`${t.status} IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'ABANDONED')`),
    check("job_run_trigger", sql`${t.trigger} IN ('worker', 'cli', 'admin', 'test')`),
    check("job_run_name_format", sql`${t.jobName} ~ '^[a-z][a-z0-9_]{2,40}$'`),
  ],
);

// Evidence of each temporary-retention purge. The project row itself survives as a DELETED
// tombstone; this record holds only counts and policy facts, never client data.
export const retentionPurgeRecord = pgTable(
  "retention_purge_record",
  {
    purgeId: uuid("purge_id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id").notNull().references(() => project.projectId),
    jobRunId: uuid("job_run_id").references(() => jobRun.runId),
    purgedAt: timestamp("purged_at", { withTimezone: true }).notNull(),
    previousState: assessmentStateEnum("previous_state").notNull(),
    retentionUntil: timestamp("retention_until", { withTimezone: true }).notNull(),
    retentionBasis: text("retention_basis").notNull(),
    purgeScope: text("purge_scope").notNull(),
    deletedRows: jsonb("deleted_rows").notNull(),
    personAnonymized: boolean("person_anonymized").notNull(),
    companyAnonymized: boolean("company_anonymized").notNull(),
  },
  (t) => [uniqueIndex("retention_purge_record_project_unique").on(t.projectId)],
);
