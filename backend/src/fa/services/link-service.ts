import { Db } from "../../db/database";
import { QuestionBankBundle } from "../engine/bundle-types";
import { renderEmail } from "../email/email-adapter";
import { ExtensionDays, extendAccess, openAccessWindow } from "./access-lifecycle";
import { recordJourneyEvent } from "./analytics";
import { FaError } from "./errors";
import { insertCompany, startProject } from "./project-factory";
import { isValidEmail, normalizeEmail, normalizeWebsiteDomain } from "./normalize";
import {
  FaDeps,
  ProjectRow,
  emailSentRecently,
  findLatestProjectForPerson,
  findUsableToken,
  formatDate,
  issueToken,
  loadProject,
  localeOf,
  recordEmailEvent,
  revokeTokens,
} from "./repository";
import { looksLikeAccessToken } from "./tokens";

const DAY_MS = 24 * 60 * 60 * 1000;
export const EXTENSION_REASONS = {
  missing_information: "MISSING_INFORMATION",
  project_not_structured: "PROJECT_NOT_STRUCTURED",
  unsure_market_timing: "UNSURE_MARKET_TIMING",
  something_else: "SOMETHING_ELSE",
} as const;
export type ExtensionReason = keyof typeof EXTENSION_REASONS;

async function sendProjectEmail(
  tx: Db,
  deps: FaDeps,
  project: ProjectRow,
  bundle: QuestionBankBundle,
  template: "resume_link" | "existing_assessment_link",
  token: string,
  now: Date,
): Promise<void> {
  const locale = localeOf(project.preferred_interaction_language);
  const rendered = renderEmail(bundle, template, locale, {
    preferred_name: project.preferred_name ?? project.first_name,
    access_until: project.access_expires_at ? formatDate(project.access_expires_at, locale) : "",
    company_name: project.company_name,
  });
  const result = await deps.email.send({
    template,
    to: project.primary_email,
    locale,
    subject: rendered.subject,
    body: rendered.body,
    ctaLabel: rendered.cta,
    ctaUrl: `${deps.config.appBaseUrl.replace(/\/$/, "")}/resume/${token}`,
    projectId: project.project_id,
  });
  await recordEmailEvent(tx, project.project_id, template, project.primary_email, deps.email.name, result.providerReference, now);
}

/**
 * A private link stays openable while the saved work is retained (not merely while access is open),
 * so an expired or capped assessment shows its recover/closed state instead of a generic dead link.
 * Access itself is still enforced separately on continue/extend.
 */
function resumeLinkExpiry(project: ProjectRow, now: Date): Date {
  const fallback = new Date(now.getTime() + 15 * DAY_MS);
  if (project.assessment_state !== "IN_PROGRESS") return fallback;
  const until = project.retention_until ?? project.access_max_until;
  return until && until.getTime() > now.getTime() ? until : fallback;
}

/** Starts the access lifecycle on the first private link issued (day 0). */
async function ensureAccessWindow(tx: Db, project: ProjectRow, now: Date): Promise<boolean> {
  if (project.access_window_started_at || project.assessment_state !== "IN_PROGRESS") return false;
  const window = openAccessWindow(now);
  await tx.query(
    `UPDATE fa_project_lifecycle
        SET access_window_started_at = $2, access_expires_at = $3, access_max_until = $4, retention_until = $5, updated_at = $2
      WHERE project_id = $1`,
    [project.project_id, window.startedAt, window.expiresAt, window.maxUntil, window.retentionUntil],
  );
  return true;
}

/** Finish Later: confirms the save and emails a private resume link (5-minute resend cooldown). */
export async function finishLater(deps: FaDeps, projectId: string): Promise<{ accessUntil: string | null }> {
  const now = deps.config.now();
  return deps.db.transaction(async (tx) => {
    let project = await loadProject(tx, projectId, true);
    if (!project) throw new FaError("NOT_FOUND", "project not found");
    if (project.assessment_state !== "IN_PROGRESS") throw new FaError("LOCKED", "this First Assessment is complete");
    if (await ensureAccessWindow(tx, project, now)) project = (await loadProject(tx, projectId, true)) ?? project;
    const bundle = await deps.bundles.byVersion(project.question_bank_version);

    await recordJourneyEvent(tx, {
      eventType: "finish_later_clicked",
      projectId,
      questionBankVersion: project.question_bank_version,
      interfaceLanguage: project.interface_language,
    });
    if (!(await emailSentRecently(tx, projectId, "resume_link", deps.config.emailCooldownMinutes, now))) {
      await revokeTokens(tx, projectId, "RESUME", now);
      const token = await issueToken(tx, projectId, "RESUME", true, resumeLinkExpiry(project, now));
      await sendProjectEmail(tx, deps, project, bundle, "resume_link", token, now);
      await recordJourneyEvent(tx, { eventType: "resume_email_sent", projectId, questionBankVersion: project.question_bank_version });
    }
    return { accessUntil: project.access_expires_at?.toISOString() ?? null };
  });
}

/**
 * Sends a fresh private link for a person's most relevant project. Used for an existing email at
 * Identity and for "send me a new link". Callers always answer generically (no enumeration).
 */
export async function sendVerifiedLinkToPerson(deps: FaDeps, personId: string): Promise<void> {
  const now = deps.config.now();
  const latest = await findLatestProjectForPerson(deps.db, personId);
  if (!latest) return;
  await deps.db.transaction(async (tx) => {
    let project = await loadProject(tx, latest.project_id, true);
    if (!project) return;
    if (await emailSentRecently(tx, project.project_id, "existing_assessment_link", deps.config.emailCooldownMinutes, now)) return;
    if (await ensureAccessWindow(tx, project, now)) project = (await loadProject(tx, latest.project_id, true)) ?? project;
    const bundle = await deps.bundles.byVersion(project.question_bank_version);
    await revokeTokens(tx, project.project_id, "RESUME", now);
    const token = await issueToken(tx, project.project_id, "RESUME", true, resumeLinkExpiry(project, now));
    await sendProjectEmail(tx, deps, project, bundle, "existing_assessment_link", token, now);
    await recordJourneyEvent(tx, { eventType: "resume_link_requested", projectId: project.project_id, questionBankVersion: project.question_bank_version });
  });
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
  if (!project) throw new FaError("NOT_FOUND", "this link is no longer available");
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
    closed: (inProgress && !windowOpen && !recoverable) || project.assessment_state === "EXPIRED" || project.assessment_state === "DELETED",
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

/** Immediate +15/+30 extension (or recovery after expiry) with a structured reason; cap day 45. */
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
    const outcome = extendAccess({ expiresAt: project.access_expires_at, maxUntil: project.access_max_until }, days, now);
    if (!outcome.ok) throw new FaError("NOT_RECOVERABLE", "this First Assessment can no longer be extended", { reason: outcome.reason });

    await tx.query("UPDATE fa_project_lifecycle SET access_expires_at = $2, updated_at = $3 WHERE project_id = $1", [
      project.project_id,
      outcome.newExpiresAt,
      now,
    ]);
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
