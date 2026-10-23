import { Db } from "../db/database";
import { FaError } from "../fa/services/errors";

/**
 * Admin read models for the entitlement foundation (V1.0 Admin capability: see entitlement status, source, dates, approval,
 * reason and privacy state). Pure reads: every write goes through `premium/entitlement-grants.ts`, which carries the rules.
 * Free-text `reason` is operator-entered and is shown here to authorised Admin roles only; it is never put in audit details.
 */

export interface ProjectEntitlementView {
  projectId: string;
  /** Opaque id, needed to scope a company-level grant explicitly (never a name). */
  companyId: string;
  entitlement: {
    premium_access_active: boolean;
    precision_access_mode: string;
    effective_from: Date | null;
    effective_until: Date | null;
    premium_ended_at: Date | null;
    readonly_until: Date | null;
    revoked_at: Date | null;
  } | null;
  /** Every source that currently applies to this project (paid term, project grants, covering company grants). */
  sources: Array<{ source: string; source_ref: string | null; starts_at: Date; effective_end: Date; closed: boolean; open_ended: boolean; clock_bound: boolean }>;
  /** Grants that apply to the project, with the governance record (who approved, why, when). */
  grants: Array<Record<string, unknown>>;
  privacy: { state: string; reason_code: string | null; since: Date | null };
  /** The instant until which access is already covered (a paid term would start there: the stacking rule). */
  coveredUntil: Date;
}

export async function projectEntitlement(db: Db, projectId: string, now: Date): Promise<ProjectEntitlementView> {
  const project = await db.query<{ company_id: string }>("SELECT company_id FROM project WHERE project_id = $1", [projectId]);
  if (!project.rows[0]) throw new FaError("NOT_FOUND", "project not found");
  const entitlement = await db.query(
    `SELECT premium_access_active, precision_access_mode, effective_from, effective_until, premium_ended_at, readonly_until, revoked_at
       FROM entitlement WHERE project_id = $1`,
    [projectId],
  );
  const sources = await db.query("SELECT source, source_ref, starts_at, effective_end, closed, open_ended, clock_bound FROM entitlement_sources_for($1) ORDER BY starts_at", [projectId]);
  const grants = await db.query(
    `SELECT g.grant_id, g.source, g.project_id, g.company_id, g.company_scope, g.max_projects, g.starts_at, g.ends_at, g.reason,
            g.program_id, p.code AS program_code, g.approved_by, a.auth_identity AS approved_by_identity, g.created_by_actor, g.created_at,
            g.extends_grant_id, g.terminated_at, g.termination_reason
       FROM entitlement_grant g
       LEFT JOIN entitlement_program p ON p.program_id = g.program_id
       LEFT JOIN admin_user a ON a.admin_user_id = g.approved_by
      WHERE g.project_id = $1 OR (g.company_id IS NOT NULL AND entitlement_company_grant_covers(g.grant_id, $1))
      ORDER BY g.created_at`,
    [projectId],
  );
  const privacy = await db.query<{ state: string; reason_code: string | null; since: Date | null }>("SELECT state, reason_code, since FROM project_privacy_state WHERE project_id = $1", [projectId]);
  const covered = await db.query<{ t: Date }>("SELECT entitlement_covered_until($1, $2) AS t", [projectId, now]);
  return {
    projectId,
    companyId: project.rows[0].company_id,
    entitlement: (entitlement.rows[0] as ProjectEntitlementView["entitlement"]) ?? null,
    sources: sources.rows as ProjectEntitlementView["sources"],
    grants: grants.rows,
    privacy: privacy.rows[0] ?? { state: "open", reason_code: null, since: null },
    coveredUntil: covered.rows[0]?.t ?? now,
  };
}

export async function listSponsors(db: Db) {
  const { rows } = await db.query("SELECT sponsor_id, name, kind, country, status, created_at FROM sponsor ORDER BY name");
  return rows;
}

export async function listPrograms(db: Db) {
  const { rows } = await db.query(
    `SELECT p.program_id, p.code, p.name, p.kind, p.sponsor_id, s.name AS sponsor_name, p.agreement_ref, p.market_scope, p.grant_days, p.starts_at, p.ends_at,
            p.max_redemptions, p.eligibility, p.status, p.approved_by, p.created_at, p.closed_at,
            (SELECT count(*)::int FROM entitlement_grant g WHERE g.program_id = p.program_id) AS redemptions,
            (SELECT count(*)::int FROM entitlement_program_eligibility e WHERE e.program_id = p.program_id) AS eligible_companies
       FROM entitlement_program p LEFT JOIN sponsor s ON s.sponsor_id = p.sponsor_id
      ORDER BY p.created_at DESC`,
  );
  return rows;
}

export async function programDetail(db: Db, programId: string) {
  const program = (await listPrograms(db)).find((p) => (p as { program_id: string }).program_id === programId);
  if (!program) throw new FaError("NOT_FOUND", "program not found");
  const eligible = await db.query("SELECT company_id, created_at FROM entitlement_program_eligibility WHERE program_id = $1 ORDER BY created_at", [programId]);
  const grants = await db.query("SELECT grant_id, project_id, company_id, starts_at, ends_at, terminated_at FROM entitlement_grant WHERE program_id = $1 ORDER BY created_at", [programId]);
  return { program, eligibleCompanies: eligible.rows, grants: grants.rows };
}
