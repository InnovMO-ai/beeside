import { randomUUID } from "node:crypto";
import type { Db } from "../../db/database";
import { activateGrantForDiscoveryProject } from "../../continuity/discovery-promotion";
import type { GrantRow, GrantSource } from "../../premium/entitlement-grants";

/**
 * A SIMULATED / manual entitlement source for acceptance (so Stripe never blocks). It goes through the same governed grant path an operator uses
 * for a complimentary, partner or manual-exception entitlement; the promotion is the production function, not a scaffold. The Stripe sandbox must
 * later prove "verified Stripe event -> the SAME promotion + entitlement boundary -> the SAME downstream behaviour".
 */
export async function testApprover(db: Db): Promise<string> {
  const id = (await db.query<{ admin_user_id: string }>(
    "INSERT INTO admin_user (role, auth_identity, active) VALUES ('ADMIN', $1, true) RETURNING admin_user_id", [`test-approver-${randomUUID()}`])).rows[0]!.admin_user_id;
  return id;
}

export async function activateSimulatedEntitlement(
  db: Db, projectId: string,
  opts: { approvedBy?: string; source?: GrantSource; days?: number; startsAt?: Date; key?: string; now?: Date; verifiedBy?: "operator" } = {},
): Promise<{ created: boolean; grant: GrantRow; approvedBy: string; key: string }> {
  const approvedBy = opts.approvedBy ?? (await testApprover(db));
  const now = opts.now ?? new Date();
  const startsAt = opts.startsAt ?? new Date(now.getTime() - 60_000);
  const key = opts.key ?? `sim:${projectId}:${randomUUID()}`;
  const r = await activateGrantForDiscoveryProject(db, {
    projectId, source: opts.source ?? "manual", startsAt, endsAt: new Date(startsAt.getTime() + (opts.days ?? 90) * 86_400_000),
    reason: "acceptance: simulated entitlement source", approvedBy, actor: `admin:${approvedBy}`, idempotencyKey: key, now,
    ...(opts.verifiedBy ? { verifiedBy: opts.verifiedBy } : {}),
  });
  return { created: r.promotion.created, grant: r.grant, approvedBy, key };
}
