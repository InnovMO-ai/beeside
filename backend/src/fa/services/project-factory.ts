import { Db } from "../../db/database";
import { corporateEmailDomain, normalizeCompanyName, normalizeWebsiteDomain } from "./normalize";
import { FaDeps } from "./repository";

/**
 * Creates a company row with its recognition signals. Companies are never matched or merged
 * automatically: an existing company is reused only through an explicit, verified choice
 * ("start a new project for the same company").
 */
export async function insertCompany(
  tx: Db,
  args: { name: string; website: string | null; normalizedEmail: string; personalDomains: readonly string[] },
): Promise<string> {
  const website = args.website?.trim() || null;
  const { rows } = await tx.query<{ company_id: string }>(
    `INSERT INTO company (name, website, normalized_domain, normalized_name, email_domain)
     VALUES ($1, $2, $3, $4, $5) RETURNING company_id`,
    [
      args.name.trim(),
      website,
      normalizeWebsiteDomain(website),
      normalizeCompanyName(args.name),
      corporateEmailDomain(args.normalizedEmail, args.personalDomains),
    ],
  );
  const id = rows[0]?.company_id;
  if (!id) throw new Error("company insert returned no id");
  return id;
}

/**
 * assessment_started: creates the project (versions pinned by the database trigger), records the
 * required legal acceptance and moves DRAFT → IN_PROGRESS, all in the caller's transaction.
 * created_by_person_id and responsible_person_id both start as the respondent.
 */
export async function startProject(
  tx: Db,
  deps: FaDeps,
  args: { personId: string; companyId: string; interfaceLanguage: string; now: Date },
): Promise<{ projectId: string; questionBankVersion: string }> {
  const { rows } = await tx.query<{ project_id: string; question_bank_version: string }>(
    `INSERT INTO project (company_id, created_by_person_id, responsible_person_id)
     VALUES ($1, $2, $2) RETURNING project_id, question_bank_version`,
    [args.companyId, args.personId],
  );
  const created = rows[0];
  if (!created) throw new Error("project insert returned no row");
  const bundle = await deps.bundles.byVersion(created.question_bank_version);

  for (const [document, url] of [
    ["PRIVACY_POLICY", bundle.links.privacy_policy_url],
    ["TERMS", bundle.links.terms_url],
  ] as const) {
    await tx.query(
      `INSERT INTO legal_acceptance (person_id, project_id, document, document_url, interface_language, accepted_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [args.personId, created.project_id, document, url, args.interfaceLanguage, args.now],
    );
  }
  await tx.query("UPDATE project SET assessment_state = 'IN_PROGRESS', updated_at = $2 WHERE project_id = $1", [
    created.project_id,
    args.now,
  ]);
  await tx.query(
    `INSERT INTO fa_project_lifecycle (project_id, identity_completed_at, last_activity_at, updated_at)
     VALUES ($1, $2, $2, $2)`,
    [created.project_id, args.now],
  );
  return { projectId: created.project_id, questionBankVersion: created.question_bank_version };
}
