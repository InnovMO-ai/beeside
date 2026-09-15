import { Db } from "../db/database";
import { deliverDueIntegrations, relayOutboxEvents } from "../integrations/relay";
import { LifecycleMilestones, lifecyclePolicyOf, recoveryDue, reminderDue } from "../fa/services/access-lifecycle";
import { recordJourneyEvent } from "../fa/services/analytics";
import { FaDeps } from "../fa/services/repository";
import { recordAudit } from "./audit";
import { DeliveryStats, deliverDueEmails, enqueueEmail, sanitizeDeliveryError } from "./email-outbox";

/**
 * Scheduled lifecycle jobs (Build Plan v1.1 Phase 11). Every job is:
 *   idempotent      — each effect is guarded by a write-once column, a dedupe key or a state check;
 *   restart-safe    — work is committed per item; a crashed run is marked ABANDONED after its
 *                     heartbeat goes stale and the next run simply continues;
 *   duplicate-safe  — at most one RUNNING row per job (unique index) plus row locks with SKIP LOCKED;
 *   auditable       — job_run rows with stats, email_event/journey events, retention_purge_record
 *                     and SYSTEM audit events for purges;
 *   testable        — every job takes `now` from the injected clock.
 * No job depends on anyone having the Admin Control Center open.
 */

export const JOB_NAMES = ["email_outbox", "access_lifecycle", "temporary_retention", "integration_outbox", "security_housekeeping"] as const;
export type JobName = (typeof JOB_NAMES)[number];
export type JobTrigger = "worker" | "cli" | "admin" | "test";

export function isJobName(value: unknown): value is JobName {
  return typeof value === "string" && (JOB_NAMES as readonly string[]).includes(value);
}

const STALE_AFTER_SECONDS = 15 * 60;
const MAX_ITEMS = 500;

export type JobResult =
  | { status: "SUCCEEDED"; runId: string; stats: Record<string, unknown> }
  | { status: "FAILED"; runId: string; error: string }
  | { status: "SKIPPED"; reason: "already_running" };

type Handler = (deps: FaDeps, ctx: { now: Date; runId: string; heartbeat: () => Promise<void> }) => Promise<Record<string, unknown>>;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}

export async function runJob(
  deps: FaDeps,
  name: JobName,
  options: { trigger: JobTrigger; adminUserId?: string | null; now?: Date } ,
): Promise<JobResult> {
  const now = options.now ?? deps.config.now();
  await deps.db.query(
    `UPDATE job_run SET status = 'ABANDONED', finished_at = $2, error = 'heartbeat expired; the next run continues the work'
      WHERE job_name = $1 AND status = 'RUNNING' AND heartbeat_at < $2::timestamptz - make_interval(secs => $3)`,
    [name, now, STALE_AFTER_SECONDS],
  );
  let runId: string;
  try {
    const { rows } = await deps.db.query<{ run_id: string }>(
      `INSERT INTO job_run (job_name, trigger, triggered_by_admin_user_id, started_at, heartbeat_at) VALUES ($1, $2, $3, $4, $4) RETURNING run_id`,
      [name, options.trigger, options.trigger === "admin" ? (options.adminUserId ?? null) : null, now],
    );
    runId = rows[0]?.run_id as string;
  } catch (error) {
    if (isUniqueViolation(error)) return { status: "SKIPPED", reason: "already_running" };
    throw error;
  }

  const heartbeat = async () => {
    await deps.db.query("UPDATE job_run SET heartbeat_at = GREATEST(heartbeat_at, $2) WHERE run_id = $1 AND status = 'RUNNING'", [runId, deps.config.now()]);
  };
  try {
    const stats = await HANDLERS[name](deps, { now, runId, heartbeat });
    await deps.db.query("UPDATE job_run SET status = 'SUCCEEDED', finished_at = $2, stats = $3::jsonb WHERE run_id = $1", [runId, deps.config.now(), JSON.stringify(stats)]);
    return { status: "SUCCEEDED", runId, stats };
  } catch (error) {
    const message = sanitizeDeliveryError(error);
    await deps.db.query("UPDATE job_run SET status = 'FAILED', finished_at = $2, error = $3 WHERE run_id = $1", [runId, deps.config.now(), message]);
    return { status: "FAILED", runId, error: message };
  }
}

/** Delivers and retries the email outbox until nothing is due (bounded rounds). */
const emailOutbox: Handler = async (deps, { now, heartbeat }) => {
  const totals: DeliveryStats = { claimed: 0, sent: 0, failed: 0, dead: 0, cancelled: 0 };
  for (let round = 0; round < 40; round++) {
    const stats = await deliverDueEmails(deps, { limit: 25, now });
    for (const key of Object.keys(totals) as Array<keyof DeliveryStats>) totals[key] += stats[key];
    await heartbeat();
    if (stats.claimed < 25) break;
  }
  return { ...totals };
};

interface LifecycleRow {
  project_id: string;
  created_by_person_id: string;
  question_bank_version: string;
  access_window_started_at: Date | null;
  access_expires_at: Date | null;
  access_max_until: Date | null;
  reminder_day10_sent_at: Date | null;
  recovery_email_sent_at: Date | null;
  access_expiry_recorded_for: Date | null;
}

/**
 * Access lifecycle: records each access expiry once (assessment_expired), sends the single reminder
 * and the single exceptional recovery email of the project's pinned calendar. Nothing else is ever
 * sent automatically after the recovery email.
 */
const accessLifecycle: Handler = async (deps, { now, heartbeat }) => {
  const stats = { evaluated: 0, expiries_recorded: 0, reminders: 0, recoveries: 0 };
  const { rows: candidates } = await deps.db.query<{ project_id: string }>(
    `SELECT l.project_id FROM fa_project_lifecycle l JOIN project p ON p.project_id = l.project_id
      WHERE p.assessment_state = 'IN_PROGRESS' AND l.access_window_started_at IS NOT NULL
        AND (l.recovery_email_sent_at IS NULL
             OR (l.access_expires_at <= $1 AND l.access_expiry_recorded_for IS DISTINCT FROM l.access_expires_at))
      ORDER BY l.access_expires_at LIMIT $2`,
    [now, MAX_ITEMS],
  );
  for (const candidate of candidates) {
    await deps.db.transaction(async (tx) => {
      const { rows } = await tx.query<LifecycleRow>(
        `SELECT l.project_id, p.created_by_person_id, p.question_bank_version, l.access_window_started_at, l.access_expires_at,
                l.access_max_until, l.reminder_day10_sent_at, l.recovery_email_sent_at, l.access_expiry_recorded_for
           FROM fa_project_lifecycle l JOIN project p ON p.project_id = l.project_id
          WHERE l.project_id = $1 AND p.assessment_state = 'IN_PROGRESS'
          FOR UPDATE OF l, p SKIP LOCKED`,
        [candidate.project_id],
      );
      const row = rows[0];
      if (!row) return;
      stats.evaluated += 1;
      const { policy } = lifecyclePolicyOf(await deps.bundles.byVersion(row.question_bank_version));
      const milestones: LifecycleMilestones = {
        accessWindowStartedAt: row.access_window_started_at,
        accessExpiresAt: row.access_expires_at,
        accessMaxUntil: row.access_max_until,
        reminderSentAt: row.reminder_day10_sent_at,
        recoverySentAt: row.recovery_email_sent_at,
      };

      if (row.access_expires_at && row.access_expires_at.getTime() <= now.getTime() && row.access_expiry_recorded_for?.getTime() !== row.access_expires_at.getTime()) {
        await tx.query("UPDATE fa_project_lifecycle SET access_expiry_recorded_for = $2, updated_at = $3 WHERE project_id = $1", [row.project_id, row.access_expires_at, now]);
        await recordJourneyEvent(tx, {
          eventType: "assessment_expired",
          projectId: row.project_id,
          questionBankVersion: row.question_bank_version,
          properties: { recoverable: !!row.access_max_until && row.access_max_until.getTime() > now.getTime() },
        });
        stats.expiries_recorded += 1;
      }
      const windowKey = row.access_window_started_at?.getTime() ?? 0;
      if (reminderDue(milestones, policy, now)) {
        await tx.query("UPDATE fa_project_lifecycle SET reminder_day10_sent_at = $2, updated_at = $2 WHERE project_id = $1", [row.project_id, now]);
        await enqueueEmail(tx, {
          dedupeKey: `access_reminder:${row.project_id}:${windowKey}`,
          projectId: row.project_id,
          personId: row.created_by_person_id,
          template: "access_reminder_day10",
          enqueuedBy: "job.access_lifecycle",
          now,
        });
        stats.reminders += 1;
      } else if (recoveryDue(milestones, policy, now)) {
        await tx.query("UPDATE fa_project_lifecycle SET recovery_email_sent_at = $2, updated_at = $2 WHERE project_id = $1", [row.project_id, now]);
        await enqueueEmail(tx, {
          dedupeKey: `access_recovery:${row.project_id}:${windowKey}`,
          projectId: row.project_id,
          personId: row.created_by_person_id,
          template: "access_recovery_day21",
          enqueuedBy: "job.access_lifecycle",
          now,
        });
        stats.recoveries += 1;
      }
    });
    if (stats.evaluated % 50 === 0) await heartbeat();
  }
  return stats;
};

/**
 * Temporary retention: every free First Assessment whose retention has elapsed is transitioned to
 * EXPIRED and purged to a DELETED tombstone in one transaction each. The purge re-checks under the
 * row lock, so a Premium activation (or a pending Premium request) always wins.
 */
const temporaryRetention: Handler = async (deps, { now, runId, heartbeat }) => {
  const stats: { candidates: number; purged: number; skipped: Record<string, number> } = { candidates: 0, purged: 0, skipped: {} };
  const candidates = await deps.db.transaction(async (tx: Db) => {
    const { rows } = await tx.query<{ project_id: string }>("SELECT project_id FROM fa_temporary_retention_candidates($1) LIMIT $2", [now, MAX_ITEMS]);
    return rows.map((r) => r.project_id);
  });
  stats.candidates = candidates.length;
  for (const projectId of candidates) {
    await deps.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ result: { purged: boolean; reason?: string; previous_state?: string; deleted_rows?: Record<string, number>; person_anonymized?: boolean; company_anonymized?: boolean } }>(
        "SELECT fa_purge_temporary_project($1, $2, $3) AS result",
        [projectId, now, runId],
      );
      const result = rows[0]?.result;
      if (!result?.purged) {
        const reason = result?.reason ?? "unknown";
        stats.skipped[reason] = (stats.skipped[reason] ?? 0) + 1;
        return;
      }
      stats.purged += 1;
      await recordAudit(tx, {
        actor: { type: "SYSTEM" },
        action: "retention.project_purged",
        outcome: "ALLOWED",
        targetType: "project",
        targetId: projectId,
        projectId,
        details: {
          job_run_id: runId,
          previous_state: result.previous_state ?? null,
          deleted_rows: result.deleted_rows ?? {},
          person_anonymized: result.person_anonymized ?? false,
          company_anonymized: result.company_anonymized ?? false,
        },
        now,
      });
    });
    if (stats.purged % 25 === 0) await heartbeat();
  }
  return stats;
};

/**
 * Integration outbox: fans committed outbox events out to one delivery per routed destination and
 * then delivers what is due. Deliveries for a destination that is not enabled simply wait, so no
 * event is lost while a destination is still being configured.
 */
const integrationOutbox: Handler = async (deps, { now, heartbeat }) => {
  const relayed = await relayOutboxEvents(deps.db, now);
  const totals = { events_relayed: relayed.events, deliveries_created: relayed.deliveries, claimed: 0, delivered: 0, skipped: 0, failed: 0, dead: 0 };
  for (let round = 0; round < 40; round++) {
    const stats = await deliverDueIntegrations(deps.db, deps.integrations, now, 25);
    totals.claimed += stats.claimed;
    totals.delivered += stats.delivered;
    totals.skipped += stats.skipped;
    totals.failed += stats.failed;
    totals.dead += stats.dead;
    await heartbeat();
    if (stats.claimed < 25) break;
  }
  return totals;
};

/** Housekeeping of security counters: rate-limit windows are kept only while they are useful. */
const securityHousekeeping: Handler = async (deps, { now }) => {
  const removed = await deps.db.query("DELETE FROM rate_limit_counter WHERE expires_at <= $1", [now]);
  return { rate_limit_windows_removed: removed.rowCount ?? 0 };
};

const HANDLERS: Record<JobName, Handler> = {
  email_outbox: emailOutbox,
  access_lifecycle: accessLifecycle,
  temporary_retention: temporaryRetention,
  integration_outbox: integrationOutbox,
  security_housekeeping: securityHousekeeping,
};
