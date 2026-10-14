import type { Db } from "../db/database";
import { emitV1EventSafe } from "../analytics/v1-events";
import { FaError } from "../fa/services/errors";

/**
 * Privacy erasure (V1.0 Fase 0) — the application side of migration 0033.
 *
 * The rules live in the database (`privacy_erase_project`): an approved policy, a `blocked` project past the policy's window, no paid
 * subscription still running, one transaction under the project lock, and an append-only run record. This module only asks, shapes the
 * answer and emits the (closed-contract) analytics event. It never decides what may be erased and holds no table list of its own:
 * the single source of truth is `privacy_erasure_registry`.
 *
 * NOT scheduled. Erasure is an explicit SUPER_ADMIN action with a dry run first. Scheduling it would put the legal retention
 * period on a timer; that period has not been decided, and the executor refuses without an approved policy anyway.
 */

export interface PrivacyPolicy {
  policy_id: string;
  version: number;
  min_days_after_block: number;
  retain_legal_acceptance: boolean;
  approved_by: string;
  approved_at: Date;
}

export type RefusalReason = "no_approved_policy" | "not_blocked" | "retention_window_open" | "subscription_running" | "already_erased";

export interface ErasurePlan {
  eligible: boolean;
  reason?: RefusalReason;
  policy_version?: number;
  /** Rows per table the execution would delete (same predicate the executor uses). */
  would_delete?: Record<string, number>;
  /** Tables the approved policy keeps although the registry allows erasing them. */
  retained_by_policy?: Record<string, number>;
  /** Copies held by external destinations (Operation Hub / ClickUp): they are asked to erase theirs, a person confirms it. */
  external_followups?: { external_references: number };
}

export interface ErasureResult {
  eligible: true;
  executed: true;
  policy_version: number;
  deleted_rows: Record<string, number>;
  retained_by_policy: Record<string, number>;
  person_anonymized: boolean;
  company_anonymized: boolean;
  external_followups: { external_references: number };
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const e = error as { code?: string; message?: string };
    if (e.code === "BV409") throw new FaError("NOT_APPLICABLE", e.message ?? "refused by integrity rule");
    if (e.code === "BV404") throw new FaError("NOT_FOUND", "project not found");
    if (e.code === "BV603") throw new FaError("INVALID_INPUT", e.message ?? "invalid privacy request");
    throw error;
  }
}

export async function currentPolicy(db: Db): Promise<PrivacyPolicy | null> {
  const { rows } = await db.query<PrivacyPolicy>(
    "SELECT policy_id, version, min_days_after_block, retain_legal_acceptance, approved_by, approved_at FROM privacy_policy WHERE status = 'approved'",
  );
  return rows[0] ?? null;
}

/**
 * Approves a new policy (SUPER_ADMIN; the database re-checks the role). The previous one is retired in the same transaction; terms never
 * change in place, so every run points at the exact terms it ran under.
 */
export async function approvePolicy(db: Db, input: { minDaysAfterBlock: number; retainLegalAcceptance: boolean; approvedBy: string; now: Date }): Promise<PrivacyPolicy> {
  if (!Number.isInteger(input.minDaysAfterBlock) || input.minDaysAfterBlock < 0 || input.minDaysAfterBlock > 3650) {
    throw new FaError("INVALID_INPUT", "minDaysAfterBlock must be a whole number between 0 and 3650", { fields: ["minDaysAfterBlock"] });
  }
  return guarded(() =>
    db.transaction(async (tx) => {
      await tx.query("UPDATE privacy_policy SET status = 'retired', retired_at = $1 WHERE status = 'approved'", [input.now]);
      const { rows } = await tx.query<PrivacyPolicy>(
        `INSERT INTO privacy_policy (min_days_after_block, retain_legal_acceptance, approved_by, approved_at) VALUES ($1, $2, $3, $4)
         RETURNING policy_id, version, min_days_after_block, retain_legal_acceptance, approved_by, approved_at`,
        [input.minDaysAfterBlock, input.retainLegalAcceptance, input.approvedBy, input.now],
      );
      return rows[0] as PrivacyPolicy;
    }),
  );
}

/** Dry run: nothing is written, nothing is locked beyond the statement. */
export async function planErasure(db: Db, projectId: string, actor: string, now: Date): Promise<ErasurePlan> {
  return guarded(async () => {
    const { rows } = await db.query<{ plan: ErasurePlan }>("SELECT privacy_erase_project($1, $2, false, $3) AS plan", [projectId, actor, now]);
    return rows[0]?.plan as ErasurePlan;
  });
}

/**
 * Executes the erasure. A refusal is returned as data (and recorded as a `refused` run); only an eligible project is erased. Idempotent:
 * a second call answers `already_erased`.
 */
export async function executeErasure(db: Db, projectId: string, actor: string, now: Date): Promise<ErasurePlan | ErasureResult> {
  const result = await guarded(() =>
    db.transaction(async (tx) => {
      const { rows } = await tx.query<{ result: ErasurePlan | ErasureResult }>("SELECT privacy_erase_project($1, $2, true, $3) AS result", [projectId, actor, now]);
      return rows[0]?.result as ErasurePlan | ErasureResult;
    }),
  );
  if ("executed" in result && result.executed) {
    await emitV1EventSafe(db, "privacy_block_applied", { projectId, properties: { privacy_event: "anonymized", reason_code: "erasure_request" } });
  }
  return result;
}

export async function erasureRuns(db: Db, projectId: string): Promise<Array<Record<string, unknown>>> {
  const { rows } = await db.query(
    `SELECT r.run_id, r.actor, r.outcome, r.refusal_reason, r.deleted_rows, r.person_anonymized, r.company_anonymized, r.external_followups, r.created_at, p.version AS policy_version
       FROM privacy_erasure_run r LEFT JOIN privacy_policy p ON p.policy_id = r.policy_id WHERE r.project_id = $1 ORDER BY r.created_at, r.run_id`,
    [projectId],
  );
  return rows;
}
