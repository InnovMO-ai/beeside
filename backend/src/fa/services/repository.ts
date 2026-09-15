import { Db } from "../../db/database";
import { QuestionBankBundle } from "../engine/bundle-types";
import { EmailTransport } from "../email/email-adapter";
import type { CheckoutAdapter } from "../../premium/checkout";
import { BundleStore } from "./bundle-store";
import { generateAccessToken, hashAccessToken } from "./tokens";

export interface FaConfig {
  /** Public origin of the First Assessment web app (never hard-coded; injected per environment). */
  appBaseUrl: string;
  sessionTtlHours: number;
  emailCooldownMinutes: number;
  now: () => Date;
}

export interface FaDeps {
  db: Db;
  email: EmailTransport;
  bundles: BundleStore;
  config: FaConfig;
  /** Phase 9 checkout boundary; manual confirmation (no payment provider) when absent. */
  premium?: { checkout: CheckoutAdapter };
  /**
   * When enqueued email is delivered after a request: `inline` (tests, local), `background`
   * (default, right after the response) or `none` (only the worker delivers).
   */
  emailDispatch?: "inline" | "background" | "none";
}

export type AssessmentState = "DRAFT" | "IN_PROGRESS" | "COMPLETED_LOCKED" | "EXPIRED" | "DELETED";

export interface ProjectRow {
  project_id: string;
  company_id: string;
  created_by_person_id: string;
  assessment_state: AssessmentState;
  question_bank_version: string;
  last_completed_step: string | null;
  premium_ever_activated: boolean;
  access_window_started_at: Date | null;
  access_expires_at: Date | null;
  access_max_until: Date | null;
  retention_until: Date | null;
  completed_at: Date | null;
  primary_email: string;
  first_name: string;
  preferred_name: string | null;
  interface_language: string;
  preferred_interaction_language: string;
  preferred_deliverable_language: string;
  company_name: string;
  company_website: string | null;
}

const PROJECT_SELECT = `
  SELECT p.project_id, p.company_id, p.created_by_person_id, p.assessment_state, p.question_bank_version,
         p.last_completed_step, p.premium_ever_activated,
         l.access_window_started_at, l.access_expires_at, l.access_max_until, l.retention_until, l.completed_at,
         pe.primary_email, pe.first_name, pe.preferred_name, pe.interface_language,
         pe.preferred_interaction_language, pe.preferred_deliverable_language,
         c.name AS company_name, c.website AS company_website
    FROM project p
    JOIN fa_project_lifecycle l ON l.project_id = p.project_id
    JOIN person pe ON pe.person_id = p.created_by_person_id
    JOIN company c ON c.company_id = p.company_id`;

export async function loadProject(db: Db, projectId: string, forUpdate = false): Promise<ProjectRow | null> {
  const { rows } = await db.query<ProjectRow>(
    `${PROJECT_SELECT} WHERE p.project_id = $1${forUpdate ? " FOR UPDATE OF p, l" : ""}`,
    [projectId],
  );
  return rows[0] ?? null;
}

/** Most relevant project of a person for a verified link: an open assessment first, else the latest. */
export async function findLatestProjectForPerson(db: Db, personId: string): Promise<ProjectRow | null> {
  const { rows } = await db.query<ProjectRow>(
    `${PROJECT_SELECT} WHERE p.created_by_person_id = $1
      ORDER BY (p.assessment_state = 'IN_PROGRESS') DESC, p.created_at DESC LIMIT 1`,
    [personId],
  );
  return rows[0] ?? null;
}

/**
 * Current stored values by field_key: non-superseded answer rows plus the person-bound preference
 * fields (canonical in `person`, never duplicated as answers).
 */
export async function loadStoredAnswers(db: Db, project: ProjectRow): Promise<Map<string, unknown>> {
  const { rows } = await db.query<{ field_key: string; value: unknown }>(
    "SELECT field_key, value FROM answer WHERE project_id = $1 AND superseded_by IS NULL",
    [project.project_id],
  );
  const answers = new Map<string, unknown>(rows.map((r) => [r.field_key, r.value]));
  if (project.preferred_name) answers.set("fa.preferences.preferred_name", project.preferred_name);
  answers.set("fa.preferences.interaction_language", project.preferred_interaction_language);
  answers.set("fa.preferences.deliverable_language", project.preferred_deliverable_language);
  return answers;
}

export type TokenKind = "SESSION" | "RESUME";

export interface TokenRow {
  token_id: string;
  project_id: string;
  kind: TokenKind;
  email_verified: boolean;
  expires_at: Date;
  revoked_at: Date | null;
}

export async function issueToken(
  db: Db,
  projectId: string,
  kind: TokenKind,
  emailVerified: boolean,
  expiresAt: Date,
): Promise<string> {
  return (await issueTokenRecord(db, projectId, kind, emailVerified, expiresAt)).token;
}

/** Issues a token and returns both the raw token (for the link) and its row id (for rotation). */
export async function issueTokenRecord(
  db: Db,
  projectId: string,
  kind: TokenKind,
  emailVerified: boolean,
  expiresAt: Date,
): Promise<{ token: string; tokenId: string }> {
  const token = generateAccessToken();
  const { rows } = await db.query<{ token_id: string }>(
    `INSERT INTO project_access_token (project_id, kind, token_hash, email_verified, expires_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING token_id`,
    [projectId, kind, hashAccessToken(token), emailVerified, expiresAt],
  );
  return { token, tokenId: rows[0]?.token_id as string };
}

export async function revokeTokens(db: Db, projectId: string, kind: TokenKind, now: Date): Promise<void> {
  await db.query(
    "UPDATE project_access_token SET revoked_at = $3 WHERE project_id = $1 AND kind = $2 AND revoked_at IS NULL",
    [projectId, kind, now],
  );
}

/** Returns a usable token (right kind, not revoked, not expired) and marks its use. */
export async function findUsableToken(db: Db, rawToken: string, kind: TokenKind, now: Date): Promise<TokenRow | null> {
  const { rows } = await db.query<TokenRow>(
    `SELECT token_id, project_id, kind, email_verified, expires_at, revoked_at
       FROM project_access_token WHERE token_hash = $1 AND kind = $2`,
    [hashAccessToken(rawToken), kind],
  );
  const token = rows[0];
  if (!token || token.revoked_at || token.expires_at.getTime() <= now.getTime()) return null;
  await db.query("UPDATE project_access_token SET last_used_at = $2 WHERE token_id = $1", [token.token_id, now]);
  return token;
}

export async function emailSentRecently(db: Db, projectId: string, template: string, cooldownMinutes: number, now: Date): Promise<boolean> {
  const { rows } = await db.query<{ recent: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM email_event WHERE project_id = $1 AND email_type = $2
                      AND sent_at > $3::timestamptz - make_interval(mins => $4)) AS recent`,
    [projectId, template, now, cooldownMinutes],
  );
  return rows[0]?.recent === true;
}

export async function recordEmailEvent(
  db: Db,
  projectId: string,
  template: string,
  recipient: string,
  status: string,
  providerReference: string | null,
  now: Date,
): Promise<void> {
  await db.query(
    `INSERT INTO email_event (project_id, email_type, recipient, sent_at, status, provider_reference)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [projectId, template, recipient, now, status, providerReference],
  );
}

export function formatDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === "es" ? "es-MX" : "en-US", { dateStyle: "long", timeZone: "UTC" }).format(date);
}

export function localeOf(value: string): "en" | "es" {
  return value === "es" ? "es" : "en";
}

export type { QuestionBankBundle };
