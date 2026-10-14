import { Db } from "../db/database";
import { FaError } from "../fa/services/errors";
import { addDays } from "./premium-policy";

/**
 * Non-paid sources of Premium access. Premium is a valid beeside entitlement; money is one source. Everything here writes the
 * ledgers (`entitlement_grant`, `entitlement_program`, `sponsor`, `project_privacy_event`) and then asks the database to re-derive
 * the entitlement projection with `entitlement_recompute()` — the same derivation the paid lifecycle (Stripe, dev simulation,
 * manual injection) uses. Precision reads the projection and cannot tell the sources apart.
 *
 * PROJECT FIRST: a grant targets one project. A company-level grant needs an explicit scope and may carry a cap; nothing is
 * inferred as "every project of this company, forever".
 * RULE vs EXCEPTION: a program is a rule (kind, market, window, cap, days, optional eligibility list, and for `sponsored` the
 * sponsor who pays); redeeming it creates a grant that cites it. An exception is a grant made directly, with reason + approver.
 * GOVERNANCE (V1.0): an individual project exception may be approved by an ADMIN (within a configurable length); anything broad
 * (a program, a sponsor, a company-level grant) needs a SUPER_ADMIN — enforced again by the database.
 * Nothing here deletes or rewrites history: extending = a new chained grant; ending early = a write-once termination.
 */

export type GrantSource = "complimentary" | "promotion" | "trial" | "manual" | "partner" | "sponsored";
export type ProgramKind = "promotion" | "trial" | "partner" | "sponsored";
export type CompanyScope = "current_projects" | "projects_created_in_period";
export type SponsorKind = "government" | "agency" | "chamber" | "accelerator" | "corporate" | "other";
export type PrivacyEventName = "access_blocked" | "access_restored" | "anonymized";
export type PrivacyReason = "erasure_request" | "legal_order" | "contract_closure" | "security_action" | "other";

export interface GrantRow {
  grant_id: string;
  project_id: string | null;
  company_id: string | null;
  company_scope: CompanyScope | null;
  max_projects: number | null;
  source: GrantSource;
  starts_at: Date;
  ends_at: Date;
  program_id: string | null;
  reason: string;
  approved_by: string;
  created_by_actor: string;
  extends_grant_id: string | null;
  idempotency_key: string | null;
  terminated_at: Date | null;
}

export interface ProgramRow {
  program_id: string;
  code: string;
  kind: ProgramKind;
  sponsor_id: string | null;
  market_scope: string[] | null;
  grant_days: number;
  starts_at: Date;
  ends_at: Date;
  max_redemptions: number | null;
  eligibility: "open" | "listed";
  status: "draft" | "active" | "closed";
  approved_by: string | null;
}

export interface SponsorRow {
  sponsor_id: string;
  name: string;
  kind: SponsorKind;
  country: string | null;
  status: "active" | "inactive";
}

/** Configurable authority limits (V1.0 keeps governance practical: role + reason + trace, no approval matrix). */
export interface GrantPolicy {
  /** Longest single grant an ADMIN may approve on their own; longer needs a SUPER_ADMIN. */
  adminMaxGrantDays: number;
}
export const DEFAULT_GRANT_POLICY: GrantPolicy = { adminMaxGrantDays: 366 };

const DAY_MS = 86_400_000;

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

export type GrantScope =
  | { projectId: string }
  | { companyId: string; companyScope: CompanyScope; maxProjects?: number };

export interface GrantInput {
  scope: GrantScope;
  source: GrantSource;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  approvedBy: string;
  /** `admin:<id>` or `system:<job>`. */
  actor: string;
  marketScope?: string[];
  programId?: string;
  extendsGrantId?: string;
  idempotencyKey?: string;
  now: Date;
  policy?: GrantPolicy;
}

/** Issues a grant. A retry with the same idempotency key returns the existing grant (no second grant, no error). */
export async function issueGrant(db: Db, input: GrantInput): Promise<GrantRow> {
  if (!(input.endsAt.getTime() > input.startsAt.getTime())) throw new FaError("INVALID_INPUT", "the grant must end after it starts");
  const policy = input.policy ?? DEFAULT_GRANT_POLICY;
  const projectId = "projectId" in input.scope ? input.scope.projectId : null;
  const company = "companyId" in input.scope ? input.scope : null;
  return guarded(() =>
    db.transaction(async (tx) => {
      if (input.idempotencyKey) {
        const existing = await tx.query<GrantRow>("SELECT * FROM entitlement_grant WHERE idempotency_key = $1", [input.idempotencyKey]);
        if (existing.rows[0]) return existing.rows[0];
      }
      // Authority: a plain ADMIN approves only individual, program-less exceptions of bounded length. (The database enforces the
      // role rule for broad grants regardless of what this service does.)
      const days = (input.endsAt.getTime() - input.startsAt.getTime()) / DAY_MS;
      if (days > policy.adminMaxGrantDays) {
        const role = await tx.query<{ role: string }>("SELECT role::text AS role FROM admin_user WHERE admin_user_id = $1 AND active", [input.approvedBy]);
        if (role.rows[0]?.role !== "SUPER_ADMIN") throw new FaError("INVALID_INPUT", "a grant of this length needs an elevated approver");
      }
      const { rows } = await tx.query<GrantRow>(
        `INSERT INTO entitlement_grant (project_id, company_id, company_scope, max_projects, source, starts_at, ends_at, market_scope, program_id,
                                        reason, approved_by, created_by_actor, extends_grant_id, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
        [projectId, company?.companyId ?? null, company?.companyScope ?? null, company?.maxProjects ?? null, input.source, input.startsAt, input.endsAt,
          input.marketScope ?? null, input.programId ?? null, input.reason, input.approvedBy, input.actor, input.extendsGrantId ?? null, input.idempotencyKey ?? null],
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

// ---------------------------------------------------------------------------------------------------------------------
// Sponsors and programs
// ---------------------------------------------------------------------------------------------------------------------

export async function createSponsor(db: Db, input: { name: string; kind: SponsorKind; country?: string; createdBy: string }): Promise<SponsorRow> {
  return guarded(async () => {
    const { rows } = await db.query<SponsorRow>(
      "INSERT INTO sponsor (name, kind, country, created_by) VALUES ($1, $2, $3, $4) RETURNING sponsor_id, name, kind, country, status",
      [input.name, input.kind, input.country ?? null, input.createdBy],
    );
    if (!rows[0]) throw new Error("sponsor insert returned no row");
    return rows[0];
  });
}

export interface ProgramInput {
  code: string;
  name: string;
  kind: ProgramKind;
  sponsorId?: string;
  agreementRef?: string;
  marketScope?: string[];
  grantDays: number;
  startsAt: Date;
  endsAt: Date;
  maxRedemptions?: number;
  eligibility?: "open" | "listed";
  reason: string;
  createdBy: string;
}

export async function createProgram(db: Db, input: ProgramInput): Promise<ProgramRow> {
  return guarded(async () => {
    const { rows } = await db.query<ProgramRow>(
      `INSERT INTO entitlement_program (code, name, kind, sponsor_id, agreement_ref, market_scope, grant_days, starts_at, ends_at, max_redemptions, eligibility, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [input.code, input.name, input.kind, input.sponsorId ?? null, input.agreementRef ?? null, input.marketScope ?? null, input.grantDays, input.startsAt,
        input.endsAt, input.maxRedemptions ?? null, input.eligibility ?? "open", input.reason, input.createdBy],
    );
    if (!rows[0]) throw new Error("program insert returned no row");
    return rows[0];
  });
}

/** Names a company the (listed) program may serve. Append-only; needs an elevated admin. */
export async function addEligibleCompany(db: Db, input: { programId: string; companyId: string; createdBy: string }): Promise<void> {
  await guarded(() => db.query("INSERT INTO entitlement_program_eligibility (program_id, company_id, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [input.programId, input.companyId, input.createdBy]));
}

/** draft -> active, with the (elevated) approver recorded. Terms are frozen from here on. */
export async function activateProgram(db: Db, programId: string, approvedBy: string): Promise<ProgramRow> {
  return guarded(async () => {
    const { rows } = await db.query<ProgramRow>("UPDATE entitlement_program SET status = 'active', approved_by = $2 WHERE program_id = $1 RETURNING *", [programId, approvedBy]);
    if (!rows[0]) throw new FaError("NOT_FOUND", "program not found");
    return rows[0];
  });
}

export async function closeProgram(db: Db, programId: string, now: Date): Promise<ProgramRow> {
  return guarded(async () => {
    const { rows } = await db.query<ProgramRow>("UPDATE entitlement_program SET status = 'closed', closed_at = $2 WHERE program_id = $1 RETURNING *", [programId, now]);
    if (!rows[0]) throw new FaError("NOT_FOUND", "program not found");
    return rows[0];
  });
}

/**
 * Redeems a program for one project. The program (a rule) decides: it must be active and inside its window, the market must be
 * in scope when the program is market-restricted, and the cap, one-redemption-per-project and the eligibility list are enforced
 * by the database. The grant is pre-approved by the program's (elevated) approver. `market` comes from the caller (the FA result
 * mapper in the permanent bridge); this module never reads FA tables.
 */
export async function redeemProgram(db: Db, input: { programId: string; projectId: string; market?: string; now: Date; actor: string }): Promise<GrantRow> {
  const { rows } = await db.query<ProgramRow>("SELECT * FROM entitlement_program WHERE program_id = $1", [input.programId]);
  const p = rows[0];
  if (!p) throw new FaError("NOT_FOUND", "program not found");
  if (p.status !== "active" || !p.approved_by) throw new FaError("NOT_APPLICABLE", "the program is not active");
  if (input.now.getTime() < p.starts_at.getTime() || input.now.getTime() >= p.ends_at.getTime()) throw new FaError("NOT_APPLICABLE", "the program is outside its window");
  if (p.market_scope && (!input.market || !p.market_scope.includes(input.market.toUpperCase()))) {
    throw new FaError("NOT_APPLICABLE", "the project's market is not covered by the program");
  }
  return issueGrant(db, {
    scope: { projectId: input.projectId },
    source: p.kind,
    startsAt: input.now,
    endsAt: addDays(input.now, p.grant_days),
    reason: `program:${p.code}`,
    approvedBy: p.approved_by,
    actor: input.actor,
    marketScope: input.market ? [input.market.toUpperCase()] : undefined,
    programId: p.program_id,
    idempotencyKey: `program:${p.program_id}:project:${input.projectId}`,
    now: input.now,
    // The program itself was approved by an elevated admin; the redemption is not a new authority decision.
    policy: { adminMaxGrantDays: Number.MAX_SAFE_INTEGER },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Stacking rule, source sync (clock) and privacy
// ---------------------------------------------------------------------------------------------------------------------

/** Where the access the project holds runs out (= `now` when it holds none). A paid term starts here. */
export async function entitlementCoveredUntil(db: Pick<Db, "query">, projectId: string, now: Date): Promise<Date> {
  const { rows } = await db.query<{ t: Date }>("SELECT entitlement_covered_until($1, $2) AS t", [projectId, now]);
  return rows[0]?.t ?? now;
}

export interface SourceSyncStats {
  activated: number;
  ended: number;
}

const BATCH = 200;

/**
 * Clock-driven part of the grant sources (the database never wakes up on its own). Idempotent and restart-safe:
 *   - projects with a grant that has started (scheduled / chained extension / agreement window) and are not yet FULL -> re-derive at `now`;
 *   - FULL projects whose dated end has passed -> re-derive at `now` (READ_ONLY, or FULL again if a chained grant begins).
 * Run it BEFORE `sweepPrecisionAccess`, which then settles the read-only window from configuration.
 */
export async function syncEntitlementSources(db: Db, input: { now: Date }): Promise<SourceSyncStats> {
  const { now } = input;
  const stats: SourceSyncStats = { activated: 0, ended: 0 };

  const toActivate = await db.query<{ project_id: string }>(
    `SELECT p.project_id
       FROM project p
       LEFT JOIN entitlement e ON e.project_id = p.project_id
      WHERE p.assessment_state = 'COMPLETED_LOCKED'
        AND (e.project_id IS NULL OR e.precision_access_mode <> 'FULL')
        AND EXISTS (SELECT 1 FROM entitlement_grant g
                     WHERE (g.project_id = p.project_id OR g.company_id = p.company_id)
                       AND g.starts_at <= $1 AND LEAST(g.ends_at, COALESCE(g.terminated_at, g.ends_at)) > $1)
        AND EXISTS (SELECT 1 FROM entitlement_sources_for(p.project_id) s
                     WHERE s.clock_bound AND NOT s.closed AND s.starts_at <= $1 AND s.effective_end > $1)
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
        AND EXISTS (SELECT 1 FROM entitlement_sources_for(e.project_id) s WHERE s.clock_bound)
      LIMIT $2`,
    [now, BATCH],
  );
  for (const r of toEnd.rows) {
    await db.query("SELECT entitlement_recompute($1, $2)", [r.project_id, now]);
    stats.ended += 1;
  }
  return stats;
}

/**
 * Privacy / data-lifecycle boundary. A valid privacy or legal requirement overrides any commercial term: once a project is
 * `blocked` or `anonymized`, Precision answers REVOKED whatever the entitlement says (see `deriveAccess`). This module only
 * records the decision; the legal rules and the anonymization itself belong to Privacy/Admin. No free text is stored.
 */
export async function recordPrivacyEvent(db: Db, input: { projectId: string; event: PrivacyEventName; reasonCode: PrivacyReason; actor: string }): Promise<void> {
  await guarded(() =>
    db.query("INSERT INTO project_privacy_event (project_id, event, reason_code, actor) VALUES ($1, $2, $3, $4)", [input.projectId, input.event, input.reasonCode, input.actor]),
  );
}
