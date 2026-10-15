import { Db } from "../db/database";
import { getFa4PrecisionContext } from "../fa4/precision";
import { getFa4PromotionSource } from "../fa4/promotion-source";
import { FaError } from "../fa/services/errors";
import { corporateEmailDomain, normalizeCompanyName, normalizeEmail } from "../fa/services/normalize";
import { GrantInput, GrantRow, issueGrant } from "../premium/entitlement-grants";

/**
 * THE PERMANENT DISCOVERY -> CORE CONTINUITY BRIDGE (frozen identity continuity contract, TX1).
 *
 *   Discovery completed (sealed result)        -> NOTHING happens in Core. Discovery may stay Discovery-only forever.
 *   valid entitlement activated (ANY source)   -> the SAME project_id is promoted into Core, in the SAME transaction as the entitlement.
 *   Precision                                  -> available because the Core entitlement says so (CoreEntitlementProvider); it reads the pinned Discovery result.
 *
 * `ensureCoreProjectFromDiscovery` is the one promotion function. Every entitlement producer calls it inside the transaction that creates its
 * entitlement (a governed grant today through `activateGrantForDiscoveryProject`; the verified payment provider tomorrow, before
 * `premium_activated`). There is no provider-specific path: the source is only a label kept on `project_origin`.
 *
 * Rules (all enforced here and, where it matters, by the database):
 *  - the promoted project keeps `fa4_project.project_id` (no second UUID); repeated or concurrent promotions create nothing new;
 *  - only a DELIVERED Discovery project whose sealed result maps to the canonical contract can be promoted (a result Precision could not read is refused);
 *  - the exact sealed result id and contract version are kept on `project_origin` (append-only); no Discovery content is copied into Core;
 *  - Person: normalised e-mail; an existing Person is reused only with evidence the requester controls the address, otherwise the promotion fails closed;
 *  - Company: STRONG match (verified person already ACTIVE in a company with the same normalised name) reuses it; PROBABLE (same name or corporate e-mail domain,
 *    no membership) creates a PROVISIONAL company plus a review record, never a merge; otherwise a new company. Resolution never blocks an entitlement;
 *  - a project_id that exists in Core without this origin is a hard error (never overwritten, never reinterpreted).
 */
export type IdentityEvidence = "email_link" | "payment" | "operator" | "new_person";

/** Personal mail providers: a company is never recognised from their domain. Operators can extend it per call; the default covers the common ones. */
export const DEFAULT_PERSONAL_EMAIL_DOMAINS: readonly string[] = [
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "yahoo.com.mx", "icloud.com", "me.com",
  "proton.me", "protonmail.com", "aol.com", "gmx.com", "hotmail.es", "outlook.es", "yahoo.es",
];

export interface PromotionInput {
  projectId: string;
  /** The entitlement source that makes this promotion valid (label only): complimentary | manual | partner | ... | paid:<provider>. */
  source: string;
  now: Date;
  /** Proof from the caller that the person behind the e-mail is who they say (a verified payment, or an operator's explicit confirmation). */
  verifiedBy?: "payment" | "operator";
  personalEmailDomains?: readonly string[];
}

export interface PromotionResult {
  projectId: string;
  /** false: the project already existed from this same origin (replay / duplicate event / concurrent winner): nothing was created. */
  created: boolean;
  companyId: string;
  personId: string;
  discoveryResultId: string;
  contractVersion: string;
}

const PROMOTION_FLAG = "app.project_origin";

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "—", last: "" };
  return { first: parts[0] as string, last: parts.slice(1).join(" ") };
}

async function existingPromotion(tx: Db, projectId: string): Promise<PromotionResult | null> {
  const row = (await tx.query<{ company_id: string; created_by_person_id: string; discovery_result_id: string | null; contract_version: string | null }>(
    `SELECT p.company_id, p.created_by_person_id, o.discovery_result_id, o.contract_version
       FROM project p LEFT JOIN project_origin o ON o.project_id = p.project_id WHERE p.project_id = $1`, [projectId])).rows[0];
  if (!row) return null;
  if (!row.discovery_result_id || !row.contract_version) {
    // The id is taken by something that is not a promoted Discovery project: never overwritten, never reinterpreted.
    throw new FaError("NOT_APPLICABLE", "this project id already exists in Core with a different origin", { reason: "PROJECT_ID_CONFLICT" });
  }
  return { projectId, created: false, companyId: row.company_id, personId: row.created_by_person_id, discoveryResultId: row.discovery_result_id, contractVersion: row.contract_version };
}

/** Runs inside the caller's transaction. Safe to call any number of times, from any number of concurrent producers. */
export async function ensureCoreProjectFromDiscovery(tx: Db, input: PromotionInput): Promise<PromotionResult> {
  // One writer per project id, held to the end of the surrounding transaction: concurrent promotions serialise and the loser finds the winner's rows.
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`beeside.project.promotion:${input.projectId}`]);
  const already = await existingPromotion(tx, input.projectId);
  if (already) return already;

  const source = await getFa4PromotionSource(tx, input.projectId);
  // The sealed result must be readable through the canonical contract before anything is created (Precision must be able to consume it).
  let contract;
  try {
    contract = await getFa4PrecisionContext(tx, input.projectId, source.resultId);
  } catch (e) {
    if (e instanceof FaError) throw new FaError("NOT_READY", "the sealed Discovery result cannot be read through the Precision contract", { reason: "CONTEXT_NOT_READABLE" });
    throw e;
  }
  const personalDomains = input.personalEmailDomains ?? DEFAULT_PERSONAL_EMAIL_DOMAINS;
  const email = normalizeEmail(source.email);

  // ---- Person --------------------------------------------------------------------------------------------------------
  const name = splitName(source.personName);
  const inserted = (await tx.query<{ person_id: string }>(
    `INSERT INTO person (first_name, last_name, primary_email, interface_language, preferred_interaction_language, preferred_deliverable_language)
     VALUES ($1, $2, $3, $4, $4, $4) ON CONFLICT (primary_email) DO NOTHING RETURNING person_id`,
    [name.first, name.last, email, source.locale])).rows[0];
  let personId: string;
  let evidence: IdentityEvidence;
  let personIsNew = false;
  if (inserted) {
    personId = inserted.person_id;
    evidence = "new_person";
    personIsNew = true;
  } else {
    // The address already identifies a Person. Reuse only with evidence the requester controls it; otherwise fail closed (no attach, no data written).
    evidence = input.verifiedBy ?? (source.emailLinkVerified ? "email_link" : ("" as IdentityEvidence));
    if (!evidence) throw new FaError("NOT_APPLICABLE", "the e-mail already identifies a person and its ownership is not verified", { reason: "PERSON_UNVERIFIED" });
    personId = (await tx.query<{ person_id: string }>("SELECT person_id FROM person WHERE primary_email = $1", [email])).rows[0]?.person_id as string;
  }

  // ---- Company -------------------------------------------------------------------------------------------------------
  const displayName = contract.declared.company.name.trim() || "—";
  const normalizedName = normalizeCompanyName(displayName);
  const domain = corporateEmailDomain(email, personalDomains);
  let companyId: string | null = null;
  let probable: Array<{ id: string; signal: "NORMALIZED_NAME" | "EMAIL_DOMAIN" | "NAME_AND_DOMAIN" }> = [];
  if (!personIsNew && normalizedName) {
    // STRONG: the (verified) person already belongs, actively, to a company with the same normalised name.
    companyId = (await tx.query<{ company_id: string }>(
      `SELECT c.company_id FROM company_person cp JOIN company c ON c.company_id = cp.company_id
        WHERE cp.person_id = $1 AND cp.status = 'ACTIVE' AND c.status <> 'MERGED' AND c.normalized_name = $2 ORDER BY cp.created_at LIMIT 1`,
      [personId, normalizedName])).rows[0]?.company_id ?? null;
  }
  if (!companyId) {
    const cands = (await tx.query<{ company_id: string; same_name: boolean; same_domain: boolean }>(
      `SELECT company_id, (normalized_name IS NOT NULL AND normalized_name = $1) AS same_name, ($2::text IS NOT NULL AND email_domain = $2) AS same_domain
         FROM company WHERE status <> 'MERGED' AND ((normalized_name IS NOT NULL AND normalized_name = $1) OR ($2::text IS NOT NULL AND email_domain = $2))
        ORDER BY created_at LIMIT 20`, [normalizedName || null, domain])).rows;
    probable = cands.map((c) => ({ id: c.company_id, signal: c.same_name && c.same_domain ? "NAME_AND_DOMAIN" as const : c.same_name ? "NORMALIZED_NAME" as const : "EMAIL_DOMAIN" as const }));
    const created = (await tx.query<{ company_id: string }>(
      `INSERT INTO company (name, normalized_name, email_domain, status) VALUES ($1, $2, $3, $4) RETURNING company_id`,
      [displayName, normalizedName || null, domain, probable.length > 0 ? "PROVISIONAL" : "ACTIVE"])).rows[0];
    companyId = created?.company_id as string;
    for (const c of probable) {
      await tx.query("INSERT INTO company_match_review (company_id, candidate_company_id, signal) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [companyId, c.id, c.signal]);
    }
  }
  await tx.query(
    `INSERT INTO company_person (company_id, person_id, status, role, source) VALUES ($1, $2, 'ACTIVE', 'OWNER', $3) ON CONFLICT (company_id, person_id) DO NOTHING`,
    [companyId, personId, `discovery_promotion:${input.source}`]);

  // ---- Project (SAME UUID) --------------------------------------------------------------------------------------------
  await tx.query("SELECT set_config($1, 'FA4_PROMOTION', true)", [PROMOTION_FLAG]);
  try {
    await tx.query(
      `INSERT INTO project (project_id, company_id, created_by_person_id, responsible_person_id, created_at, updated_at) VALUES ($1, $2, $3, $3, $4, $4)`,
      [input.projectId, companyId, personId, input.now]);
  } finally {
    await tx.query("SELECT set_config($1, '', true)", [PROMOTION_FLAG]);
  }
  // A delivered Discovery project IS a completed, locked first assessment (the precondition every entitlement source has).
  await tx.query("UPDATE project SET assessment_state = 'COMPLETED_LOCKED', updated_at = $2 WHERE project_id = $1", [input.projectId, input.now]);
  await tx.query(
    `INSERT INTO project_origin (project_id, origin, discovery_result_id, contract_version, promoted_by_source, identity_evidence, promoted_at)
     VALUES ($1, 'DISCOVERY_FA4', $2, $3, $4, $5, $6)`,
    [input.projectId, source.resultId, contract.contract.version, input.source, evidence, input.now]);
  // Downstream consumers (Operation Hub, welcome e-mail, analytics) learn about the promotion from the outbox, asynchronously and once.
  await tx.query("INSERT INTO outbox_event (project_id, event_type, payload, occurred_at) VALUES ($1, 'project.promoted_from_discovery', $2::jsonb, $3)", [
    input.projectId,
    JSON.stringify({ project_id: input.projectId, origin: "DISCOVERY_FA4", result_id: source.resultId, contract_version: contract.contract.version, source: input.source, company_provisional: probable.length > 0 }),
    input.now,
  ]);
  return { projectId: input.projectId, created: true, companyId: companyId as string, personId, discoveryResultId: source.resultId, contractVersion: contract.contract.version };
}

export interface GrantActivationInput extends Omit<GrantInput, "scope" | "now"> {
  projectId: string;
  now: Date;
  verifiedBy?: "operator";
  personalEmailDomains?: readonly string[];
}

/**
 * A governed non-paid entitlement (complimentary, promotion, trial, manual exception, partner, sponsored) for a DISCOVERY project: promotes the project
 * and issues the grant in ONE transaction. A replay with the same idempotency key returns the same grant and creates nothing. The grant keeps every rule
 * of `issueGrant` (authority, bounds, ledger, recompute); this function only guarantees that the project it points at exists, from the right origin.
 */
export async function activateGrantForDiscoveryProject(db: Db, input: GrantActivationInput): Promise<{ promotion: PromotionResult; grant: GrantRow }> {
  if (!input.idempotencyKey) throw new FaError("INVALID_INPUT", "an idempotency key is required to activate an entitlement for a Discovery project");
  return db.transaction(async (tx) => {
    const promotion = await ensureCoreProjectFromDiscovery(tx, {
      projectId: input.projectId, source: input.source, now: input.now, ...(input.verifiedBy ? { verifiedBy: input.verifiedBy } : {}),
      ...(input.personalEmailDomains ? { personalEmailDomains: input.personalEmailDomains } : {}),
    });
    const { projectId, verifiedBy, personalEmailDomains, ...rest } = input;
    void verifiedBy; void personalEmailDomains; // promotion-only options; the grant keeps its own governed inputs
    const grant = await issueGrant(tx, { ...rest, scope: { projectId }, now: input.now });
    // An idempotency key belongs to ONE project: a key reused for another project must never hand back someone else's grant.
    if (grant.project_id !== projectId) throw new FaError("INVALID_INPUT", "this idempotency key was already used for another project");
    return { promotion, grant };
  });
}
