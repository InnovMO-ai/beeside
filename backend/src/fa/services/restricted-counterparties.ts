import type { CounterpartyListValue } from "../engine/counterparty-types";
import { AuditActor, recordAudit } from "../../operations/audit";
import { Db } from "../../db/database";

const FIELD_KEY = "fa.provider.restricted_counterparties";

/**
 * The one sanctioned, audited read path for `fa.provider.restricted_counterparties` outside of the
 * client's own First Assessment session (owner decision, 2026-09-17 — see that field's description
 * in canonical-fields/src/fields.ts for the full policy this implements).
 *
 * Every call is an Operation Hub/admin read: it is recorded as an `admin_audit_event`
 * (`project.restricted_counterparties.viewed`) unconditionally, before the value is returned — not
 * only on success — so the audit trail reflects every access attempt, matching the append-only,
 * never-silently-skipped pattern the rest of `operations/audit.ts` already uses. Callers are
 * responsible for their own authorization check (Supervisor/Admin via rbac.ts, or a conditionally
 * authorized Strategic Advisor grant) *before* calling this — this function does not itself decide
 * who may call it, it only guarantees the read is never silent.
 *
 * This function is NOT used anywhere in the provider-matching, RFI, or FA → Precision paths — those
 * must never see this data at all (see first-assessment-context.ts's `precisionExcluded` filter).
 * It exists only for the narrow, legitimate internal cases the policy allows: a Supervisor/Admin
 * reviewing a project, or an assigned Sherpa/authorized Strategic Advisor doing so under an
 * authorized project permission grant.
 */
export async function getRestrictedCounterpartiesForAdmin(
  db: Db,
  projectId: string,
  actor: AuditActor,
  now: Date,
): Promise<CounterpartyListValue> {
  const { rows } = await db.query<{ value: CounterpartyListValue }>(
    "SELECT value FROM answer WHERE project_id = $1 AND field_key = $2 AND superseded_by IS NULL",
    [projectId, FIELD_KEY],
  );
  const value = rows[0]?.value ?? [];

  await recordAudit(db, {
    actor,
    action: "project.restricted_counterparties.viewed",
    outcome: "ALLOWED",
    targetType: "project",
    targetId: projectId,
    projectId,
    details: { count: value.length },
    now,
  });

  return value;
}
