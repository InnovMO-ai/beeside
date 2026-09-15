import { Db } from "../../db/database";
import { EmailTemplate, emailRequestedRecently, enqueueEmail } from "../../operations/email-outbox";
import { ExtensionDays, addDays, extendAccess, isExtensionDays, lifecyclePolicyOf, openAccessWindow } from "./access-lifecycle";
import { recordJourneyEvent } from "./analytics";
import { FaError } from "./errors";
import { insertCompany, startProject } from "./project-factory";
import { isValidEmail, normalizeEmail, normalizeWebsiteDomain } from "./normalize";
import { FaDeps, ProjectRow, findLatestProjectForPerson, findUsableToken, issueToken, loadProject } from "./repository";
import { looksLikeAccessToken } from "./tokens";

export const EXTENSION_REASONS = {
  missing_information: "MISSING_INFORMATION",
  project_not_structured: "PROJECT_NOT_STRUCTURED",
  unsure_market_timing: "UNSURE_MARKET_TIMING",
  something_else: "SOMETHING_ELSE",
} as const;
export type ExtensionReason = keyof typeof EXTENSION_REASONS;

/** Contextual help sent the day after an extension or recovery (Handoff v1 §19). */
const FOLLOWUP_TEMPLATES: Record<ExtensionReason, EmailTemplate> = {
  missing_information: "access_followup_missing_information",
  project_not_structured: "access_followup_project_not_structured",
  unsure_market_timing: "access_followup_unsure_market_timing",
  something_else: "access_followup_something_else",
};

/**
 * Starts the access lifecycle on the first private link emitted (day 0) with the calendar of the
 * project's pinned configuration, and re-anchors temporary retention to that moment. Opening or
 * reopening a link never calls this again.
 */
async function ensureAccessWindow(tx: Db, deps: FaDeps, project: ProjectRow, now: Date): Promise<boolean> {
  if (project.access_window_started_at || project.assessment_state !== "IN_PROGRESS") return false;
  const { policy } = lifecyclePolicyOf(await deps.bundles.byVersion(project.question_bank_version));
  const window = openAccessWindow(now, policy);
  await tx.query(
    `UPDATE fa_project_lifecycle
        SET access_window_started_at = $2, access_expires_at = $3, access_max_until = $4,
            retention_until = GREATEST(retention_until, $5), retention_basis = 'ACCESS_WINDOW', updated_at = $2
      WHERE project_id = $1`,
    [project.project_id, window.startedAt, window.expiresAt, window.maxUntil, window.retentionUntil],
  );
  return true;
}

/** Finish Later: confirms the save and enqueues a private resume link (resend cooldown applies). */
export async function finishLater(deps: FaDeps, projectId: string): Promise<{ accessUntil: string | null }> {
  const now = deps.config.now();
  return deps.db.transaction(async (tx) => {
    let project = await loadProject(tx, projectId, true);
    if (!project) throw new FaError("NOT_FOUND", "project not found");
    if (project.assessment_state !== "IN_PROGRESS") throw new FaError("LOCKED", "this First Assessment is complete");
    if (await ensureAccessWindow(tx, deps, project, now)) project = (await loadProject(tx, projectId, true)) ?? project;

    await recordJourneyEvent(tx, {
      eventType: "finish_later_clicked",
      projectId,
      questionBankVersion: project.question_bank_version,
      interfaceLanguage: project.interface_language,
    });
    if (!(await emailRequestedRecently(tx, projectId, "resume_link", deps.config.emailCooldownMinutes, now))) {
      await enqueueEmail(tx, {
        dedupeKey: `resume_link:${projectId}:${now.getTime()}`,
        projectId,
        personId: project.created_by_person_id,
        template: "resume_link",
        enqueuedBy: "fa.finish_later",
        now,
      });
    }
    return { accessUntil: project.access_expires_at?.toISOString() ?? null };
  });
}

/** Enqueues a fresh private link for one project (cooldown applies). Returns whether it was enqueued. */
async function enqueuePrivateLink(tx: Db, deps: FaDeps, projectId: string, enqueuedBy: string, now: Date): Promise<boolean> {
  let project = await loadProject(tx, projectId, true);
  if (!project || project.assessment_state === "DELETED" || project.assessment_state === "EXPIRED") return false;
  if (await emailRequestedRecently(tx, project.project_id, "existing_assessment_link", deps.config.emailCooldownMinutes, now)) return false;
  if (await ensureAccessWindow(tx, deps, project, now)) project = (await loadProject(tx, projectId, true)) ?? project;
  await enqueueEmail(tx, {
    dedupeKey: `existing_assessment_link:${project.project_id}:${now.getTime()}`,
    projectId: project.project_id,
    personId: project.created_by_person_id,
    template: "existing_assessment_link",
    enqueuedBy,
    now,
  });
  await recordJourneyEvent(tx, { eventType: "resume_link_requested", projectId: project.project_id, questionBankVersion: project.question_bank_version });
  return true;
}

/**
 * Sends a fresh private link for a person's most relevant project. Used for an existing email at
 * Identity and for "send me a new link". Callers always answer generically (no enumeration).
 */
export async function sendVerifiedLinkToPerson(deps: FaDeps, personId: string): Promise<void> {
  const now = deps.config.now();
  const latest = await findLatestProjectForPerson(deps.db, personId);
  if (!latest) return;
  await deps.db.transaction((tx) => enqueuePrivateLink(tx, deps, latest.project_id, "fa.link_request", now));
}

/** ADMIN operation: re-send the respondent's own private link to their own address. */
export async function resendPrivateLinkForProject(deps: FaDeps, tx: Db, projectId: string, now: Date): Promise<boolean> {
  return enqueuePrivateLink(tx, deps, projectId, "admin.resend_private_link", now);
}

export async function requestLinkByEmail(deps: FaDeps, rawEmail: unknown): Promise<void> {
  if (typeof rawEmail !== "string") return;
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) return;
  const { rows } = await deps.db.query<{ person_id: string }>("SELECT person_id FROM person WHERE primary_email = $1", [email]);
  const personId = rows[0]?.person_id;
  if (personId) await sendVerifiedLinkToPerson(deps, personId);
}

export async function projectFromLink(deps: FaDeps, rawToken: unknown): Promise<{ project: ProjectRow; now: Date }> {
  const now = deps.config.now();
  const token = looksLikeAccessToken(rawToken) ? await findUsableToken(deps.db, rawToken, "RESUME", now) : null;
  const project = token ? await loadProject(deps.db, token.project_id) : null;
  if (!project || project.assessment_state === "DELETED") throw new FaError("NOT_FOUND", "this link is no longer available");
  return { project, now };
}

export interface LinkChoices {
  companyName: string;
  interfaceLanguage: string;
  canContinue: boolean;
  canRecover: boolean;
  closed: boolean;
  completed: boolean;
  anotherProjectInMind: boolean;
  accessUntil: string | null;
  /** Technical Architecture v1.1 §7: a completed project is routed by its Premium history. */
  premium: { everActivated: boolean; accessActive: boolean };
}

/** What the holder of a verified private link may do next. */
export async function openLink(deps: FaDeps, rawToken: unknown): Promise<LinkChoices> {
  const { project, now } = await projectFromLink(deps, rawToken);
  const inProgress = project.assessment_state === "IN_PROGRESS";
  const windowOpen = !project.access_expires_at || project.access_expires_at.getTime() > now.getTime();
  const recoverable = inProgress && !windowOpen && !!project.access_max_until && project.access_max_until.getTime() > now.getTime();
  const another = await deps.db.query<{ yes: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM answer WHERE project_id = $1 AND field_key = 'fa.project.another_project_in_mind'
                      AND superseded_by IS NULL AND value = '"yes"'::jsonb) AS yes`,
    [project.project_id],
  );
  return {
    companyName: project.company_name,
    interfaceLanguage: project.interface_language,
    canContinue: inProgress && windowOpen,
    canRecover: recoverable,
    closed: (inProgress && !windowOpen && !recoverable) || project.assessment_state === "EXPIRED",
    completed: project.assessment_state === "COMPLETED_LOCKED",
    anotherProjectInMind: another.rows[0]?.yes === true,
    accessUntil: project.access_expires_at?.toISOString() ?? null,
    premium: {
      everActivated: project.premium_ever_activated,
      accessActive: (await deps.db.query<{ active: boolean }>("SELECT premium_access_active AS active FROM entitlement WHERE project_id = $1", [project.project_id])).rows[0]?.active === true,
    },
  };
}

/** Resume: same project, same project_id, new working session. Opening does not extend access. */
export async function continueFromLink(deps: FaDeps, rawToken: unknown): Promise<{ sessionToken: string }> {
  const { project, now } = await projectFromLink(deps, rawToken);
  if (project.assessment_state !== "IN_PROGRESS") throw new FaError("LOCKED", "this First Assessment is complete");
  if (project.access_expires_at && project.access_expires_at.getTime() <= now.getTime()) {
    throw new FaError("ACCESS_EXPIRED", "this First Assessment is no longer active");
  }
  return deps.db.transaction(async (tx) => {
    const sessionToken = await issueToken(tx, project.project_id, "SESSION", true, new Date(now.getTime() + deps.config.sessionTtlHours * 3_600_000));
    await recordJourneyEvent(tx, {
      eventType: "assessment_resumed",
      projectId: project.project_id,
      questionBankVersion: project.question_bank_version,
      interfaceLanguage: project.interface_language,
      stepId: project.last_completed_step,
    });
    return { sessionToken };
  });
}

/**
 * Immediate +15/+30 extension (or recovery after expiry) with a structured reason, capped at the
 * maximum access day. Never conditioned on anything commercial. The day after, one contextual
 * help email for that reason may follow (continue the assessment first; Premium only secondary).
 */
export async function extendFromLink(
  deps: FaDeps,
  rawToken: unknown,
  days: ExtensionDays,
  reason: ExtensionReason,
): Promise<{ accessUntil: string }> {
  const { project: linked, now } = await projectFromLink(deps, rawToken);
  return deps.db.transaction(async (tx) => {
    const project = await loadProject(tx, linked.project_id, true);
    if (!project) throw new FaError("NOT_FOUND", "this link is no longer available");
    if (project.assessment_state !== "IN_PROGRESS") throw new FaError("LOCKED", "this First Assessment is complete");
    if (!project.access_expires_at || !project.access_max_until) throw new FaError("INVALID_INPUT", "no access window to extend");
    const { policy } = lifecyclePolicyOf(await deps.bundles.byVersion(project.question_bank_version));
    if (!isExtensionDays(days, policy)) throw new FaError("INVALID_INPUT", "this extension is not available", { fields: ["days"] });
    const outcome = extendAccess({ expiresAt: project.access_expires_at, maxUntil: project.access_max_until }, days, now);
    if (!outcome.ok) throw new FaError("NOT_RECOVERABLE", "this First Assessment can no longer be extended", { reason: outcome.reason });

    await tx.query("UPDATE fa_project_lifecycle SET access_expires_at = $2, updated_at = $3 WHERE project_id = $1", [
      project.project_id,
      outcome.newExpiresAt,
      now,
    ]);
    await tx.query("UPDATE project SET extension_requested = true, updated_at = $2 WHERE project_id = $1 AND NOT extension_requested", [project.project_id, now]);
    await tx.query(
      `INSERT INTO fa_access_extension (project_id, requested_days, reason, previous_expires_at, new_expires_at, was_expired, requested_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [project.project_id, days, EXTENSION_REASONS[reason], project.access_expires_at, outcome.newExpiresAt, outcome.wasExpired, now],
    );
    await recordJourneyEvent(tx, {
      eventType: outcome.wasExpired ? "access_recovered" : "access_extended",
      projectId: project.project_id,
      questionBankVersion: project.question_bank_version,
      properties: { days, reason },
    });
    await enqueueEmail(tx, {
      dedupeKey: `access_followup:${project.project_id}:${reason}`,
      projectId: project.project_id,
      personId: project.created_by_person_id,
      template: FOLLOWUP_TEMPLATES[reason],
      enqueuedBy: outcome.wasExpired ? "fa.access_recovered" : "fa.access_extended",
      sendAfter: addDays(now, 1),
      context: { reason },
      now,
    });
    return { accessUntil: outcome.newExpiresAt.toISOString() };
  });
}

/** Verified link → new project for the same person, for the same company or a new one. */
export async function newProjectFromLink(
  deps: FaDeps,
  rawToken: unknown,
  args: { sameCompany: boolean; companyName: string | null; companyWebsite: string | null; acceptLegal: boolean },
): Promise<{ sessionToken: string }> {
  const { project: source, now } = await projectFromLink(deps, rawToken);
  const invalid: string[] = [];
  if (!args.acceptLegal) invalid.push("acceptLegal");
  if (!args.sameCompany && (!args.companyName || args.companyName.trim() === "" || args.companyName.length > 200)) invalid.push("companyName");
  if (!args.sameCompany && args.companyWebsite && !normalizeWebsiteDomain(args.companyWebsite)) invalid.push("companyWebsite");
  if (invalid.length > 0) throw new FaError("INVALID_INPUT", "new project details are incomplete", { fields: invalid });

  const { bundle } = await deps.bundles.current();
  return deps.db.transaction(async (tx) => {
    const companyId = args.sameCompany
      ? source.company_id
      : await insertCompany(tx, {
          name: args.companyName ?? "",
          website: args.companyWebsite,
          normalizedEmail: source.primary_email,
          personalDomains: bundle.identity.personal_email_domains,
        });
    const { projectId, questionBankVersion } = await startProject(tx, deps, {
      personId: source.created_by_person_id,
      companyId,
      interfaceLanguage: source.interface_language,
      now,
    });
    const sessionToken = await issueToken(tx, projectId, "SESSION", true, new Date(now.getTime() + deps.config.sessionTtlHours * 3_600_000));
    await recordJourneyEvent(tx, {
      eventType: "another_project_started",
      projectId,
      questionBankVersion,
      interfaceLanguage: source.interface_language,
      properties: { same_company: args.sameCompany },
    });
    return { sessionToken };
  });
}
