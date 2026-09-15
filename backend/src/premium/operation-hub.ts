import { Db } from "../db/database";
import { FaError } from "../fa/services/errors";

/**
 * Operation Hub linkage contract (Technical Architecture v1.1 §11). PostgreSQL stays the only
 * system of record; an external workspace (e.g. ClickUp) is linked by project_id. Access follows
 * entitlement.premium_access_active — enabled while Premium is active, disabled (never deleted)
 * when access ends. No Operation Hub execution or sync is implemented in Phase 9.
 */
export interface OperationHubAccess {
  accessActive: boolean;
  links: Array<{ externalSystem: string; externalWorkspaceId: string | null; externalRecordId: string | null; linkedAt: string }>;
}

export async function operationHubAccess(db: Db, projectId: string): Promise<OperationHubAccess> {
  const entitlement = await db.query<{ premium_access_active: boolean }>("SELECT premium_access_active FROM entitlement WHERE project_id = $1", [projectId]);
  const links = await db.query<{ external_system: string; external_workspace_id: string | null; external_record_id: string | null; linked_at: Date }>(
    "SELECT external_system, external_workspace_id, external_record_id, linked_at FROM operation_hub_link WHERE project_id = $1 ORDER BY external_system",
    [projectId],
  );
  return {
    accessActive: entitlement.rows[0]?.premium_access_active === true,
    links: links.rows.map((l) => ({
      externalSystem: l.external_system,
      externalWorkspaceId: l.external_workspace_id,
      externalRecordId: l.external_record_id,
      linkedAt: l.linked_at.toISOString(),
    })),
  };
}

/** Records the link to an external workspace; only allowed while Premium access is active. */
export async function linkOperationHub(tx: Db, projectId: string, externalSystem: string, externalWorkspaceId: string | null): Promise<OperationHubAccess> {
  if (!/^[a-z0-9_]{2,40}$/.test(externalSystem)) throw new FaError("INVALID_INPUT", "external_system must be a short technical identifier", { fields: ["external_system"] });
  const entitlement = await tx.query<{ premium_access_active: boolean }>("SELECT premium_access_active FROM entitlement WHERE project_id = $1 FOR SHARE", [projectId]);
  if (entitlement.rows[0]?.premium_access_active !== true) throw new FaError("NOT_APPLICABLE", "Operation Hub is available only while Premium access is active");
  await tx.query(
    `INSERT INTO operation_hub_link (project_id, external_system, external_workspace_id) VALUES ($1, $2, $3)
     ON CONFLICT (project_id, external_system) DO NOTHING`,
    [projectId, externalSystem, externalWorkspaceId],
  );
  return operationHubAccess(tx, projectId);
}
