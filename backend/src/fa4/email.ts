import { Locale, NC } from "@beeside/fa-public-engine";
import { Db } from "../db/database";
import { EmailMessage, EmailTransport } from "../fa/email/email-adapter";
import { backoffSeconds, sanitizeDeliveryError } from "../operations/email-outbox";
import { issueToken } from "./repository";

/**
 * FA Public v1.0 transactional email. Uses the existing provider-agnostic EmailTransport (no provider is selected: development logs
 * or captures). The outbox row carries no secret: the RESUME link token is minted at delivery time and travels in the URL fragment
 * (never sent to a server, never in logs), exactly like the legacy resume link. The legacy `email_delivery` table cannot serve FA 4.0
 * (it requires a legacy person/project and legacy templates), hence `fa4_email_delivery` with the same lease / backoff semantics.
 *
 * The wording below is NEEDS_CANONICAL_COPY: there is no approved FA 4.0 email copy yet.
 */
export type Fa4EmailTemplate = "fa4_resume_link" | "fa4_result_link";

const COPY: Record<Fa4EmailTemplate, { subject: ReturnType<typeof NC>; body: ReturnType<typeof NC>; cta: ReturnType<typeof NC> }> = {
  fa4_resume_link: {
    subject: NC("email.resume.subject", "Retoma tu First Assessment", "Pick up your First Assessment"),
    body: NC("email.resume.body", "Usa este enlace para continuar donde lo dejaste.", "Use this link to continue where you left off."),
    cta: NC("email.resume.cta", "Continuar", "Continue"),
  },
  fa4_result_link: {
    subject: NC("email.result.subject", "Tu Your Expansion View", "Your Expansion View"),
    body: NC("email.result.body", "Aquí está el resultado de tu proyecto.", "Here is the result for your project."),
    cta: NC("email.result.cta", "Ver mi resultado", "See my result"),
  },
};

export interface Fa4EmailDeps {
  db: Db;
  email: EmailTransport;
  config: { appBaseUrl: string; resumeLinkDays: number; now: () => Date };
}

export async function enqueueFa4Email(db: Db, projectId: string, template: Fa4EmailTemplate, dedupeKey: string, now: Date): Promise<string | null> {
  const { rows } = await db.query<{ delivery_id: string }>(
    `INSERT INTO fa4_email_delivery (dedupe_key, project_id, template, next_attempt_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $4, $4) ON CONFLICT (dedupe_key) DO NOTHING RETURNING delivery_id`,
    [dedupeKey, projectId, template, now],
  );
  return rows[0]?.delivery_id ?? null;
}

/** Resend cooldown: any non-cancelled delivery of this template for the project inside the window. */
export async function fa4EmailRequestedRecently(db: Db, projectId: string, template: Fa4EmailTemplate, minutes: number, now: Date): Promise<boolean> {
  const { rows } = await db.query<{ recent: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM fa4_email_delivery WHERE project_id = $1 AND template = $2 AND status <> 'CANCELLED' AND created_at > $3) AS recent`,
    [projectId, template, new Date(now.getTime() - minutes * 60_000)],
  );
  return rows[0]?.recent === true;
}

interface Due { delivery_id: string; project_id: string; template: Fa4EmailTemplate; attempts: number; max_attempts: number }

/** Claims and delivers due emails. Safe to run concurrently and after crashes (FOR UPDATE SKIP LOCKED + lease). */
export async function deliverDueFa4Emails(deps: Fa4EmailDeps, options: { limit?: number } = {}): Promise<{ sent: number; failed: number; dead: number }> {
  const now = deps.config.now();
  const claimed = await deps.db.query<Due>(
    `UPDATE fa4_email_delivery SET status = 'SENDING', attempts = attempts + 1, lease_until = $2, updated_at = $1
      WHERE delivery_id IN (
        SELECT delivery_id FROM fa4_email_delivery
         WHERE (status IN ('PENDING','FAILED') AND next_attempt_at <= $1) OR (status = 'SENDING' AND lease_until < $1)
         ORDER BY next_attempt_at LIMIT $3 FOR UPDATE SKIP LOCKED)
      RETURNING delivery_id, project_id, template, attempts, max_attempts`,
    [now, new Date(now.getTime() + 5 * 60_000), options.limit ?? 20],
  );
  const stats = { sent: 0, failed: 0, dead: 0 };
  for (const d of claimed.rows) {
    try {
      const message = await deps.db.transaction(async (tx) => prepare(tx, deps, d, now));
      if (!message) { await deps.db.query("UPDATE fa4_email_delivery SET status='CANCELLED', lease_until=NULL, updated_at=$2 WHERE delivery_id=$1", [d.delivery_id, now]); continue; }
      const res = await deps.email.send(message, { idempotencyKey: d.delivery_id });
      await deps.db.query("UPDATE fa4_email_delivery SET status='SENT', sent_at=$2, lease_until=NULL, provider_name=$3, provider_reference=$4, updated_at=$2 WHERE delivery_id=$1", [d.delivery_id, now, deps.email.name, res.providerReference]);
      stats.sent++;
    } catch (error) {
      const dead = d.attempts >= d.max_attempts;
      await deps.db.query(
        "UPDATE fa4_email_delivery SET status=$2, last_error=$3, lease_until=NULL, next_attempt_at=$4, updated_at=$5 WHERE delivery_id=$1",
        [d.delivery_id, dead ? "DEAD" : "FAILED", sanitizeDeliveryError(error), new Date(now.getTime() + backoffSeconds(d.attempts) * 1000), now],
      );
      if (dead) stats.dead++; else stats.failed++;
    }
  }
  return stats;
}

async function prepare(tx: Db, deps: Fa4EmailDeps, d: Due, now: Date): Promise<EmailMessage | null> {
  const p = (await tx.query<{ email: string; locale: Locale }>("SELECT email, locale FROM fa4_project WHERE project_id = $1", [d.project_id])).rows[0];
  if (!p) return null;
  const token = await issueToken(tx, d.project_id, "RESUME", new Date(now.getTime() + deps.config.resumeLinkDays * 86_400_000));
  const base = deps.config.appBaseUrl.replace(/\/$/, "");
  const view = d.template === "fa4_result_link" ? "&view=result" : "";
  const c = COPY[d.template];
  return {
    template: d.template,
    to: p.email,
    locale: p.locale,
    subject: c.subject[p.locale],
    body: c.body[p.locale],
    ctaLabel: c.cta[p.locale],
    ctaUrl: `${base}/fa4#r=${token}${view}`,
    projectId: d.project_id,
  };
}
