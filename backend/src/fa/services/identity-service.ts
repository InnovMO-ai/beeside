import { recordJourneyEvent, isUuid } from "./analytics";
import { FaError } from "./errors";
import { sendVerifiedLinkToPerson } from "./link-service";
import { isPersonalEmailDomain, isValidEmail, normalizeEmail, normalizeWebsiteDomain } from "./normalize";
import { insertCompany, startProject } from "./project-factory";
import { FaDeps, issueToken } from "./repository";

export interface IdentityInput {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  website: string | null;
  interfaceLanguage: "en" | "es";
  acceptLegal: true;
  personalEmailAcknowledged: boolean;
  anonymousSessionId: string | null;
}

export type IdentityResult = { status: "started"; sessionToken: string } | { status: "verification_required" };

const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() !== "" && value.length <= max ? value.trim() : null);

export function parseIdentityInput(body: unknown): IdentityInput {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const invalid: string[] = [];
  const firstName = text(b.firstName, 100);
  const lastName = text(b.lastName, 100);
  const company = text(b.company, 200);
  const email = typeof b.email === "string" ? normalizeEmail(b.email) : "";
  const rawWebsite = typeof b.website === "string" ? b.website.trim() : "";
  if (!firstName) invalid.push("firstName");
  if (!lastName) invalid.push("lastName");
  if (!company) invalid.push("company");
  if (!isValidEmail(email)) invalid.push("email");
  if (rawWebsite && (rawWebsite.length > 300 || !normalizeWebsiteDomain(rawWebsite))) invalid.push("website");
  if (b.interfaceLanguage !== "en" && b.interfaceLanguage !== "es") invalid.push("interfaceLanguage");
  if (b.acceptLegal !== true) invalid.push("acceptLegal");
  if (invalid.length > 0 || !firstName || !lastName || !company) {
    throw new FaError("INVALID_INPUT", "identity details are incomplete", { fields: invalid });
  }
  return {
    firstName,
    lastName,
    company,
    email,
    website: rawWebsite || null,
    interfaceLanguage: b.interfaceLanguage as "en" | "es",
    acceptLegal: true,
    personalEmailAcknowledged: b.personalEmailAcknowledged === true,
    anonymousSessionId: isUuid(b.anonymousSessionId) ? b.anonymousSessionId : null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}

/**
 * Identity + Privacy/Terms (Handoff v1 §4–§6). A new email creates person → company → project in
 * one transaction and opens a working session. An email that already identifies a person never
 * attaches the unverified requester to that identity: a private link is sent to the address
 * instead, from which the owner can continue or start a new project.
 */
export async function submitIdentity(deps: FaDeps, input: IdentityInput): Promise<IdentityResult> {
  const now = deps.config.now();
  const { bundle } = await deps.bundles.current();

  const existing = await deps.db.query<{ person_id: string }>("SELECT person_id FROM person WHERE primary_email = $1", [input.email]);
  const existingPerson = existing.rows[0];
  if (existingPerson) {
    await sendVerifiedLinkToPerson(deps, existingPerson.person_id);
    await recordJourneyEvent(deps.db, {
      eventType: "existing_email_detected",
      anonymousSessionId: input.anonymousSessionId,
      interfaceLanguage: input.interfaceLanguage,
    });
    return { status: "verification_required" };
  }

  const personal = isPersonalEmailDomain(input.email, bundle.identity.personal_email_domains);
  try {
    return await deps.db.transaction(async (tx) => {
      const person = await tx.query<{ person_id: string }>(
        `INSERT INTO person (first_name, last_name, primary_email, interface_language,
           preferred_interaction_language, preferred_deliverable_language)
         VALUES ($1, $2, $3, $4, $4, $4) RETURNING person_id`,
        [input.firstName, input.lastName, input.email, input.interfaceLanguage],
      );
      const personId = person.rows[0]?.person_id;
      if (!personId) throw new Error("person insert returned no id");

      const companyId = await insertCompany(tx, {
        name: input.company,
        website: input.website,
        normalizedEmail: input.email,
        personalDomains: bundle.identity.personal_email_domains,
      });
      const { projectId, questionBankVersion } = await startProject(tx, deps, {
        personId,
        companyId,
        interfaceLanguage: input.interfaceLanguage,
        now,
      });

      if (personal && input.personalEmailAcknowledged) {
        await tx.query(
          `INSERT INTO answer (project_id, field_key, value, value_type, question_bank_version)
           VALUES ($1, 'fa.identity.personal_email_acknowledged', '"yes"'::jsonb, 'single_select', $2)`,
          [projectId, questionBankVersion],
        );
      }

      const sessionToken = await issueToken(
        tx,
        projectId,
        "SESSION",
        false,
        new Date(now.getTime() + deps.config.sessionTtlHours * 3_600_000),
      );
      await recordJourneyEvent(tx, {
        eventType: "identity_completed",
        projectId,
        anonymousSessionId: input.anonymousSessionId,
        questionBankVersion,
        interfaceLanguage: input.interfaceLanguage,
        properties: { personal_email: personal, website_provided: input.website !== null },
      });
      return { status: "started" as const, sessionToken };
    });
  } catch (error) {
    // A concurrent submission created the same person first: treat exactly like an existing email.
    if (isUniqueViolation(error)) {
      const again = await deps.db.query<{ person_id: string }>("SELECT person_id FROM person WHERE primary_email = $1", [input.email]);
      const personId = again.rows[0]?.person_id;
      if (personId) {
        await sendVerifiedLinkToPerson(deps, personId);
        return { status: "verification_required" };
      }
    }
    throw error;
  }
}
