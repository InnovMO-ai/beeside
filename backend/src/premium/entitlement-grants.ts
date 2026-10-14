import { Db } from "../db/database";
import { FaError } from "../fa/services/errors";
import { addDays } from "./premium-policy";

/**
 * Non-paid sources of Premium access (Macroblock C). Premium is a valid beeside entitlement; money is only ONE source.
 * Everything here writes the ledgers (`entitlement_grant`, `promotion_campaign`) and then asks the database to re-derive
 * the entitlement projection with `entitlement_recompute()` — the same derivation the paid lifecycle (Stripe, dev
 * simulation, manual injection) uses. Precision reads the projection and cannot tell the sources apart.
 *
 * RULE vs EXCEPTION: a campaign is a rule (market, window, quota, days); redeeming it creates a grant that cites it.
 * An exception is a grant made directly to one project or company, with a mandatory reason and approver.
 * Nothing here deletes or rewrites history: extending = a new chained grant; ending early = a write-once termination.
 */

export type GrantSource = "complimentary" | "promotion" | "trial" | "manual" | "partner";
export type CampaignKind = "promotion" | "trial" | "partner";

export interface GrantRow {
  grant_id: string;
  project_id: string | null;
  company_id: string | null;
  source: GrantSource;
  starts_at: Date;
  ends_at: Date;
  campaign_id: string | null;
  reason: string;
  approved_by: string;
  created_by_actor: string;
  extends_grant_id: string | null;
  idempotency_key: string | null;
  terminated_at: Date | null;
}

export interface CampaignRow {
  campaign_id: string;
  code: string;
  kind: CampaignKind;
  market_scope: string[] | null;
  grant_days: number;
  starts_at: Date;
  ends_at: Date;
  max_redemptions: number | null;
  status: "draft" | "active" | "closed";
  approved_by: string | null;
}

/** Database integrity refusals (BV409) become a client-safe conflict; anything else is unexpected and bubbles up. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const e = error as { code?: string; message?: string };
    if (e.code === "BV409") throw new FaError("NOT_APPLICABLE", e.message ?? "refused by integrity rule");
    if (e.code === "23505") throw new FaError("NOT_APPLICABLE", "already exists");
    if (e.code === "23514" || e.code === "23503") throw new FaError("INVALID_INPUT", "the request violates a data rule");
    throw error;
  }
}

/** Re-derives the entitlement of the affected project(s) at the application's clock (the DB trigger already did so at its own). */
async function recomputeFor(db: Db, grant: Pick<GrantRow, "project_id" | "company_id">, now: Date): Promise<void> {
  if (grant.project_id) {
    await db.query("SELECT entitlement_recompute($1, $2)", [grant.project_id, now]);
    return;
  }
  const { rows } = await db.query<{ project_id: string }>(
    "SELECT project_id FROM project WHERE company_id = $1 AND assessment_state = 'COMPLETED_LOCKED'",
    [grant.company_id],
  );
  for (const r of rows) await db.query("SELECT entitlement_recompute($1, $2)", [r.project_id, now]);
}

export interface GrantInput {
  scope: { projectId: string } | { companyId: string };
  source: GrantSource;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  approvedBy: string;
  /** `admin:<id>` or `system:<job>`. */
  actor: string;
  marketScope?: string[];
  campaignId?: string;
  extendsGrantId?: string;
  idempotencyKey?: string;
  now: Date;
}

/** Issues a grant. A retry with the same idempotency key returns the existing grant (no second grant, no error). */
export async function issueGrant(db: Db, input: GrantInput): Promise<GrantRow> {
  if (!(input.endsAt.getTime() > input.startsAt.getTime())) throw new FaError("INVALID_INPUT", "the grant must end after it starts");
  const projectId = "projectId" in input.scope ? input.scope.projectId : null;
  const companyId = "companyId" in input.scope ? input.scope.companyId : null;
  return guarded(() =>
    db.transaction(async (tx) => {
      if (input.idempotencyKey) {
        const existing = await tx.query<GrantRow>("SELECT * FROM entitlement_grant WHERE idempotency_key = $1", [input.idempotencyKey]);
        if (existing.rows[0]) return existing.rows[0];
      }
      const { rows } = await tx.query<GrantRow>(
        `INSERT INTO entitlement_grant (project_id, company_id, source, starts_at, ends_at, market_scope, campaign_id, reason, approved_by,
                                        created_by_actor, extends_grant_id, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [projectId, companyId, input.source, input.startsAt, input.endsAt, input.marketScope ?? null, input.campaignId ?? null, input.reason,
          input.approvedBy, input.actor, input.extendsGrantId ?? null, input.idempotencyKey ?? null],
      );
      const grant = rows[0];
      if (!grant) throw new Error("grant insert returned no row");
      await recomputeFor(tx, grant, input.now);
      return grant;
    }),
  );
}

/** Write-once early end of a grant. The entitlement moves to READ_ONLY (or stays FULL if another source is still valid). */
export async function terminateGrant(db: Db, input: { grantId: string; terminatedBy: string; reason: string; now: Date }): Promise<GrantRow> {
  return guarded(() =>
    db.transaction(async (tx) => {
      const { rows } = await tx.query<GrantRow>(
        `UPDATE entitlement_grant SET terminated_at = $2, terminated_by = $3, termination_reason = $4 WHERE grant_id = $1 RETURNING *`,
        [input.grantId, input.now, input.terminatedBy, input.reason],
      );
      if (!rows[0]) throw new FaError("NOT_FOUND", "grant not found");
      await recomputeFor(tx, rows[0], input.now);
      return rows[0];
    }),
  );
}

export interface CampaignInput {
  code: string;
  name: string;
  kind: CampaignKind;
  marketScope?: string[];
  grantDays: number;
  startsAt: Date;
  endsAt: Date;
  maxRedemptions?: number;
  reason: string;
  createdBy: string;
}

export async function createCampaign(db: Db, input: CampaignInput): Promise<CampaignRow> {
  return guarded(async () => {
    const { rows } = await db.query<CampaignRow>(
      `INSERT INTO promotion_campaign (code, name, kind, market_scope, grant_days, starts_at, ends_at, max_redemptions, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [input.code, input.name, input.kind, input.marketScope ?? null, input.grantDays, input.startsAt, input.endsAt, input.maxRedemptions ?? null, input.reason, input.createdBy],
    );
    if (!rows[0]) throw new Error("campaign insert returned no row");
    return rows[0];
  });
}

/** draft -> active, with the approver recorded. Terms are frozen from here on. */
export async function activateCampaign(db: Db, campaignId: string, approvedBy: string): Promise<CampaignRow> {
  return guarded(async () => {
    const { rows } = await db.query<CampaignRow>(
      "UPDATE promotion_campaign SET status = 'active', approved_by = $2 WHERE campaign_id = $1 RETURNING *",
      [campaignId, approvedBy],
    );
    if (!rows[0]) throw new FaError("NOT_FOUND", "campaign not found");
    return rows[0];
  });
}

export async function closeCampaign(db: Db, campaignId: string, now: Date): Promise<CampaignRow> {
  return guarded(async () => {
    const { rows } = await db.query<CampaignRow>(
      "UPDATE promotion_campaign SET status = 'closed', closed_at = $2 WHERE campaign_id = $1 RETURNING *",
      [campaignId, now],
    );
    if (!rows[0]) throw new FaError("NOT_FOUND", "campaign not found");
    return rows[0];
  });
}

/**
 * Redeems a campaign for one project. The campaign (a rule) decides: it must be active and inside its window, the market
 * must be in scope when the campaign is market-restricted, and the quota and one-redemption-per-project are enforced by
 * the database. The grant is pre-approved by the campaign's approver. `market` comes from the caller (the FA result
 * mapper in the permanent bridge); this module never reads FA tables.
 */
export async function redeemCampaign(db: Db, input: { campaignId: string; projectId: string; market?: string; now: Date; actor: string }): Promise<GrantRow> {
  const { rows } = await db.query<CampaignRow>("SELECT * FROM promotion_campaign WHERE campaign_id = $1", [input.campaignId]);
  const c = rows[0];
  if (!c) throw new FaError("NOT_FOUND", "campaign not found");
  if (c.status !== "active" || !c.approved_by) throw new FaError("NOT_APPLICABLE", "the campaign is not active");
  if (input.now.getTime() < c.starts_at.getTime() || input.now.getTime() >= c.ends_at.getTime()) throw new FaError("NOT_APPLICABLE", "the campaign is outside its window");
  if (c.market_scope && (!input.market || !c.market_scope.includes(input.market.toUpperCase()))) {
    throw new FaError("NOT_APPLICABLE", "the project's market is not covered by the campaign");
  }
  return issueGrant(db, {
    scope: { projectId: input.projectId },
    source: c.kind,
    startsAt: input.now,
    endsAt: addDays(input.now, c.grant_days),
    reason: `campaign:${c.code}`,
    approvedBy: c.approved_by,
    actor: input.actor,
    marketScope: input.market ? [input.market.toUpperCase()] : undefined,
    campaignId: c.campaign_id,
    idempotencyKey: `campaign:${c.campaign_id}:project:${input.projectId}`,
    now: input.now,
  });
}

export interface SourceSyncStats {
  activated: number;
  ended: number;
}

const BATCH = 200;

/**
 * Clock-driven part of the grant sources (the database never wakes up on its own). Idempotent and restart-safe:
 *   - grants that have started (scheduled / chained extensions) for projects not yet FULL -> re-derive at `now`;
 *   - FULL projects whose dated end has passed -> re-derive at `now` (READ_ONLY, or FULL again if a chained grant begins).
 * Run it BEFORE `sweepPrecisionAccess`, which then settles the read-only window from configuration.
 */
export async function syncEntitlementSources(db: Db, input: { now: Date }): Promise<SourceSyncStats> {
  const { now } = input;
  const stats: SourceSyncStats = { activated: 0, ended: 0 };

  const toActivate = await db.query<{ project_id: string }>(
    `SELECT DISTINCT p.project_id
       FROM premium_access_source s
       JOIN project p ON (s.project_id = p.project_id OR s.company_id = p.company_id)
       LEFT JOIN entitlement e ON e.project_id = p.project_id
      WHERE s.clock_bound AND p.assessment_state = 'COMPLETED_LOCKED'
        AND s.starts_at <= $1 AND s.effective_end > $1
        AND (e.project_id IS NULL OR e.precision_access_mode <> 'FULL')
      LIMIT $2`,
    [now, BATCH],
  );
  for (const r of toActivate.rows) {
    await db.query("SELECT entitlement_recompute($1, $2)", [r.project_id, now]);
    stats.activated += 1;
  }

  const toEnd = await db.query<{ project_id: string }>(
    `SELECT e.project_id FROM entitlement e
      WHERE e.precision_access_mode = 'FULL' AND e.effective_until IS NOT NULL AND e.effective_until <= $1
        AND EXISTS (SELECT 1 FROM premium_access_source s
                     JOIN project p ON (s.project_id = p.project_id OR s.company_id = p.company_id)
                    WHERE p.project_id = e.project_id AND s.clock_bound)
      LIMIT $2`,
    [now, BATCH],
  );
  for (const r of toEnd.rows) {
    await db.query("SELECT entitlement_recompute($1, $2)", [r.project_id, now]);
    stats.ended += 1;
  }
  return stats;
}
