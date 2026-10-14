import { Db } from "../db/database";
import { BundleStore } from "../fa/services/bundle-store";
import { FaError } from "../fa/services/errors";
import { processSubscriptionEvent } from "./subscription-events";
import { PremiumPolicy, addDays } from "./premium-policy";

/**
 * Precision access state (Core-owned, contract §G). Three modes:
 *   FULL      — Premium is active.
 *   READ_ONLY — Premium ended; Precision data stays readable for a configurable window.
 *   REVOKED   — the window ended; Precision is closed. Nothing is ever deleted.
 * The database moves a project to FULL (new confirmed payment) and to READ_ONLY (end of Premium) in the same
 * statement that changes the subscription (migration 0022). The sweep below ends periods that ran out, settles
 * the read-only window from the configured policy and closes windows that ran out. Stripe is not involved.
 */
export type PrecisionAccessMode = "FULL" | "READ_ONLY" | "REVOKED";

export interface AccessRow {
  premium_access_active: boolean;
  precision_access_mode: PrecisionAccessMode;
  premium_ended_at: Date | null;
  readonly_until: Date | null;
  /** Latest subscription (null when none): lets the derivation close access at the period end even if the sweep is late. */
  subscription_status: "PREMIUM_ACTIVE" | "CANCELLATION_SCHEDULED" | "PREMIUM_INACTIVE" | null;
  subscription_period_end: Date | null;
  /** Recurring subscription: the provider renews it, so the clock waits `renewalSafetyDays` past the paid-through date (same margin as the sweep). */
  subscription_auto_renews?: boolean | null;
  /**
   * Dated end of FULL access when the entitlement is not open-ended (a grant, or a paid period already scheduled to end).
   * NULL = open-ended. Optional so callers that only know paid rows keep working. This is what lets any non-paid source
   * close at its date even if the source sync has not run yet — same "the clock closes writes" rule as paid.
   */
  effective_until?: Date | null;
  /**
   * Privacy / data-lifecycle state (separate from commerce). `blocked` or `anonymized` beats ANY entitlement: a valid legal or
   * privacy requirement overrides "paid until date X". Absent/`open` = no privacy restriction.
   */
  privacy_state?: "open" | "blocked" | "anonymized" | null;
}

export interface DerivedAccess {
  mode: PrecisionAccessMode;
  readonlyUntil: Date | null;
}

/**
 * What a project can do at `now`. Pure. It never grants more than the stored state and never less than the clock
 * implies: a period that ran out is READ_ONLY even if the sweep has not run yet, and an elapsed window is REVOKED.
 */
export function deriveAccess(row: AccessRow | null, now: Date, policy: Pick<PremiumPolicy, "readonlyGraceDays"> & Partial<Pick<PremiumPolicy, "renewalSafetyDays">>): DerivedAccess {
  if (!row) return { mode: "REVOKED", readonlyUntil: null };
  if (row.privacy_state === "blocked" || row.privacy_state === "anonymized") return { mode: "REVOKED", readonlyUntil: null };
  let mode = row.precision_access_mode;
  let endedAt = row.premium_ended_at;
  let readonlyUntil = row.readonly_until;
  if (mode === "FULL") {
    const open = row.subscription_status === "PREMIUM_ACTIVE" || row.subscription_status === "CANCELLATION_SCHEDULED";
    // A recurring subscription that has not been cancelled keeps FULL for the safety margin past the paid-through date (late renewal /
    // collection retries); the sweep ends it after the same margin. A scheduled cancellation ends exactly at the period end.
    const margin = row.subscription_auto_renews === true && row.subscription_status === "PREMIUM_ACTIVE" ? (policy.renewalSafetyDays ?? 0) * 86_400_000 : 0;
    const paidEnd = row.subscription_period_end ? row.subscription_period_end.getTime() + margin : null;
    if (open && paidEnd !== null && paidEnd <= now.getTime()) {
      mode = "READ_ONLY";
      endedAt = row.subscription_period_end;
      readonlyUntil = null;
    } else if (row.effective_until && row.effective_until.getTime() <= now.getTime() && !(open && paidEnd !== null && paidEnd > now.getTime())) {
      // A dated source (grant) ran out and no paid period is still running.
      mode = "READ_ONLY";
      endedAt = row.effective_until;
      readonlyUntil = null;
    } else {
      return { mode: "FULL", readonlyUntil: null };
    }
  }
  if (mode === "READ_ONLY") {
    if (!readonlyUntil && endedAt) readonlyUntil = addDays(endedAt, policy.readonlyGraceDays);
    if (readonlyUntil && readonlyUntil.getTime() <= now.getTime()) return { mode: "REVOKED", readonlyUntil };
    return { mode: "READ_ONLY", readonlyUntil };
  }
  return { mode: "REVOKED", readonlyUntil };
}

export async function loadAccessRow(db: Db, projectId: string): Promise<AccessRow | null> {
  const { rows } = await db.query<AccessRow>(
    `SELECT e.premium_access_active, e.precision_access_mode, e.premium_ended_at, e.readonly_until, e.effective_until,
            s.status AS subscription_status, s.current_period_end AS subscription_period_end, s.auto_renews AS subscription_auto_renews, ps.state AS privacy_state
       FROM entitlement e
       LEFT JOIN project_privacy_state ps ON ps.project_id = e.project_id
       LEFT JOIN LATERAL (SELECT status, current_period_end, auto_renews FROM subscription WHERE project_id = e.project_id
                           ORDER BY created_at DESC, current_period_start DESC LIMIT 1) s ON true
      WHERE e.project_id = $1`,
    [projectId],
  );
  return rows[0] ?? null;
}

export interface SweepStats {
  periodsEnded: number;
  windowsSettled: number;
  revoked: number;
}

const BATCH = 200;

/**
 * Idempotent, restart-safe, never deletes data. Safe to run concurrently: each step locks the rows it changes.
 *   1. subscriptions whose period ran out -> `subscription_period_ended` through the normal event path (FULL -> READ_ONLY);
 *   2. READ_ONLY rows without a window -> readonly_until = premium_ended_at + configured days (snapshotted in grace_days_applied);
 *   3. READ_ONLY rows whose window ran out -> REVOKED.
 */
export async function sweepPrecisionAccess(db: Db, bundles: BundleStore, input: { now: Date; policy: PremiumPolicy }): Promise<SweepStats> {
  const { now, policy } = input;
  const stats: SweepStats = { periodsEnded: 0, windowsSettled: 0, revoked: 0 };

  const due = await db.query<{ subscription_id: string; project_id: string; current_period_end: Date }>(
    `SELECT subscription_id, project_id, current_period_end FROM subscription
      WHERE status IN ('PREMIUM_ACTIVE', 'CANCELLATION_SCHEDULED')
        -- A recurring subscription is renewed (or ended) by its provider: wait a safety margin past the paid-through date so a late
        -- renewal never flickers access. A scheduled cancellation ends exactly at the period end, as before.
        AND current_period_end + CASE WHEN auto_renews AND status = 'PREMIUM_ACTIVE' THEN make_interval(days => $3) ELSE interval '0' END <= $1
      ORDER BY current_period_end LIMIT $2`,
    [now, BATCH, policy.renewalSafetyDays ?? 14],
  );
  for (const sub of due.rows) {
    try {
      await db.transaction((tx) =>
        processSubscriptionEvent(tx, bundles, {
          projectId: sub.project_id,
          eventType: "subscription_period_ended",
          // The end of Premium is the end of the paid period, not the (possibly late) sweep time.
          occurredAt: sub.current_period_end,
          source: "core_sweep",
          providerReference: null,
          idempotencyKey: `period-end:${sub.subscription_id}`,
        }),
      );
      stats.periodsEnded += 1;
    } catch (error) {
      // Already ended by a provider event or a concurrent sweep: nothing to do.
      if (!(error instanceof FaError && error.code === "NOT_APPLICABLE")) throw error;
    }
  }

  const settled = await db.query(
    `UPDATE entitlement SET grace_days_applied = $2, readonly_until = premium_ended_at + make_interval(days => $2), updated_at = $1
      WHERE precision_access_mode = 'READ_ONLY' AND readonly_until IS NULL`,
    [now, policy.readonlyGraceDays],
  );
  stats.windowsSettled = settled.rowCount ?? 0;

  const revoked = await db.query(
    `UPDATE entitlement SET precision_access_mode = 'REVOKED', revoked_at = $1, updated_at = $1
      WHERE precision_access_mode = 'READ_ONLY' AND readonly_until IS NOT NULL AND readonly_until <= $1`,
    [now],
  );
  stats.revoked = revoked.rowCount ?? 0;
  return stats;
}
