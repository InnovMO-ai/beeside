import { Answers, Locale, countryL10n } from "@beeside/fa-public-engine";
import { Db } from "../db/database";
import { EmailMessage, EmailTransport } from "../fa/email/email-adapter";
import { backoffSeconds, sanitizeDeliveryError } from "../operations/email-outbox";
import { recordEvent } from "./events";
import { issueToken } from "./repository";
import { renderFa4Email, sanitizeSubjectValue } from "./email-render";

/**
 * FA Public transactional email. EmailTransport (log | smtp) -> `fa4_email_delivery` outbox (lease, retry with backoff, dead state, idempotency,
 * per-recipient quota). The outbox row carries no secret: the RESUME link token is minted at delivery time and travels in the URL fragment
 * (never sent to a server, never in logs). No DB transaction is open while a message is being sent to the provider.
 *
 * Truthfulness: a queued delivery is NOT a sent email. The functions below report `sent` only after the provider accepted the message;
 * `pending` while it is still in flight; `failed` otherwise. Delivery is at-least-once: a crash between the provider's acceptance and the
 * `SENT` update lets the lease expire and the message is sent again (the delivery id travels as Message-ID / idempotency key).
 *
 * All FA4 operational mail is sent from and replies to contact@beeside.you (configured on the transport); it is never marketing.
 */
export type Fa4EmailTemplate = "fa4_resume_link" | "fa4_result_link" | "fa4_contact_request";

export interface Fa4EmailDeps {
  db: Db;
  email: EmailTransport;
  config: {
    appBaseUrl: string; publicPath?: string; resumeLinkDays: number; now: () => Date;
    /** Operational mailbox that receives "Hablar con beeside" messages (contact@beeside.you). */
    contactAddress?: string;
    /** Optional secondary CTA of the YEV email (FA4_PREMIUM_RESOURCE_URL_ES|EN). Absent = no secondary link. */
    premiumResourceUrl?: { es?: string; en?: string };
    /** Third condition of the YEV email's Premium block: the final commercial-content policy allows it (LEGAL-1, external). Fail-closed: absent = false. */
    premiumCommercialContentAllowed?: boolean;
    /** Validity of the YEV email's private link (one token serves both "View" and "Talk to beeside"). */
    yevLinkDays?: number;
  };
}

export interface Fa4EmailLimits { cooldownMinutes: number; recipientDailyQuota: number }

export type DeliveryState = "sent" | "pending" | "failed";
export const stateOfStatus = (status: string): DeliveryState => (status === "SENT" ? "sent" : status === "PENDING" || status === "SENDING" ? "pending" : "failed");

export interface EnqueueResult {
  /** True only when a NEW delivery row was created by this call. */
  queued: boolean;
  /** The delivery this request is about (the new one, or the one already in flight / delivered inside the cooldown). */
  deliveryId: string | null;
  /** Why nothing new was queued. */
  blocked?: "cooldown" | "quota" | "unknown_project";
}

/**
 * Enqueues one email for a project, atomically (a per-recipient advisory lock serializes concurrent requests):
 *  - cooldown: no second email of the same template for the project inside the window — the existing delivery is returned so the caller can
 *    report ITS state truthfully (a double click never creates a second email). A DEAD delivery does not block: the person may ask again;
 *  - per-recipient quota: at most `recipientDailyQuota` FA4 emails to one address per 24 h, whatever the project or who asked.
 */
export async function enqueueFa4Email(db: Db, projectId: string, template: Exclude<Fa4EmailTemplate, "fa4_contact_request">, now: Date, limits: Fa4EmailLimits, discriminator = ""): Promise<EnqueueResult> {
  return db.transaction(async (tx) => {
    const p = (await tx.query<{ email: string }>("SELECT email FROM fa4_project WHERE project_id = $1 AND status <> 'ANONYMIZED'", [projectId])).rows[0];
    if (!p) return { queued: false, deliveryId: null, blocked: "unknown_project" as const };
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`fa4_email:${p.email}`]);
    const cooled = await tx.query<{ delivery_id: string }>(
      "SELECT delivery_id FROM fa4_email_delivery WHERE project_id = $1 AND template = $2 AND status NOT IN ('CANCELLED','DEAD') AND created_at > $3 ORDER BY created_at DESC LIMIT 1",
      [projectId, template, new Date(now.getTime() - limits.cooldownMinutes * 60_000)],
    );
    if (cooled.rows[0]) return { queued: false, deliveryId: cooled.rows[0].delivery_id, blocked: "cooldown" as const };
    const quota = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM fa4_email_delivery d JOIN fa4_project pr ON pr.project_id = d.project_id
        WHERE pr.email = $1 AND d.template <> 'fa4_contact_request' AND d.status <> 'CANCELLED' AND d.created_at > $2`,
      [p.email, new Date(now.getTime() - 86_400_000)],
    );
    if ((quota.rows[0]?.n ?? 0) >= limits.recipientDailyQuota) return { queued: false, deliveryId: null, blocked: "quota" as const };
    const bucket = Math.floor(now.getTime() / (Math.max(1, limits.cooldownMinutes) * 60_000));
    const dead = (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM fa4_email_delivery WHERE project_id = $1 AND template = $2 AND status = 'DEAD' AND created_at > $3", [projectId, template, new Date(now.getTime() - 86_400_000)])).rows[0]?.n ?? 0;
    const { rows } = await tx.query<{ delivery_id: string }>(
      `INSERT INTO fa4_email_delivery (dedupe_key, project_id, template, next_attempt_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4, $4) ON CONFLICT (dedupe_key) DO NOTHING RETURNING delivery_id`,
      [`${template}:${projectId}:${discriminator}${bucket}${dead ? `:r${dead}` : ""}`, projectId, template, now],
    );
    if (rows[0]) return { queued: true, deliveryId: rows[0].delivery_id };
    // lost a race for the same bucket: report the delivery that won
    const winner = (await tx.query<{ delivery_id: string }>("SELECT delivery_id FROM fa4_email_delivery WHERE dedupe_key = $1", [`${template}:${projectId}:${discriminator}${bucket}${dead ? `:r${dead}` : ""}`])).rows[0];
    return { queued: false, deliveryId: winner?.delivery_id ?? null, blocked: "cooldown" as const };
  });
}

export interface ContactInput { name: string; company: string; email: string; message: string; shareProgress: boolean; clientRequestId: string; originStage?: "FA" | "YEV" }

/**
 * Stores a "Hablar con beeside" message and its delivery to the operational mailbox in ONE transaction. The client request id makes a
 * double click / retry of the same form idempotent (it returns the original delivery instead of creating a second message).
 */
export async function enqueueContact(db: Db, projectId: string | null, input: ContactInput, language: Locale, now: Date): Promise<{ contactId: string; deliveryId: string; created: boolean }> {
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`fa4_contact:${input.clientRequestId}`]);
    const inserted = await tx.query<{ contact_id: string }>(
      `INSERT INTO fa4_contact_request (project_id, name, company, email, message, share_progress, language, client_request_id, origin_stage, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (client_request_id) DO NOTHING RETURNING contact_id`,
      [projectId, input.name, input.company, input.email, input.message, input.shareProgress, language, input.clientRequestId, input.originStage ?? "FA", now],
    );
    const created = inserted.rows.length > 0;
    const contactId = inserted.rows[0]?.contact_id
      ?? (await tx.query<{ contact_id: string }>("SELECT contact_id FROM fa4_contact_request WHERE client_request_id = $1", [input.clientRequestId])).rows[0]!.contact_id;
    const delivery = await tx.query<{ delivery_id: string }>(
      `INSERT INTO fa4_email_delivery (dedupe_key, project_id, template, contact_request_id, next_attempt_at, created_at, updated_at)
       VALUES ($1,$2,'fa4_contact_request',$3,$4,$4,$4) ON CONFLICT (dedupe_key) DO NOTHING RETURNING delivery_id`,
      [`fa4_contact_request:${contactId}`, projectId, contactId, now],
    );
    const deliveryId = delivery.rows[0]?.delivery_id
      ?? (await tx.query<{ delivery_id: string }>("SELECT delivery_id FROM fa4_email_delivery WHERE dedupe_key = $1", [`fa4_contact_request:${contactId}`])).rows[0]!.delivery_id;
    return { contactId, deliveryId, created };
  });
}

/** The person pressed "try again" on a delivery that failed: schedule exactly ONE more attempt of the SAME delivery (same id, no duplicate email). */
export async function retryFa4Delivery(db: Db, deliveryId: string, now: Date): Promise<void> {
  await db.query(
    `UPDATE fa4_email_delivery SET status = 'FAILED', attempts = LEAST(attempts, max_attempts - 1), next_attempt_at = $2, lease_until = NULL, updated_at = $2
      WHERE delivery_id = $1 AND status IN ('FAILED','DEAD')`,
    [deliveryId, now],
  );
}

export async function deliveryStatus(db: Db, deliveryId: string): Promise<string | null> {
  return (await db.query<{ status: string }>("SELECT status FROM fa4_email_delivery WHERE delivery_id = $1", [deliveryId])).rows[0]?.status ?? null;
}

/** Latest delivery of a template for a project (what the UI polls while a send is pending). */
export async function latestDelivery(db: Db, projectId: string, template: Fa4EmailTemplate): Promise<{ deliveryId: string; status: string } | null> {
  const r = (await db.query<{ delivery_id: string; status: string }>("SELECT delivery_id, status FROM fa4_email_delivery WHERE project_id = $1 AND template = $2 AND status <> 'CANCELLED' ORDER BY created_at DESC LIMIT 1", [projectId, template])).rows[0];
  return r ? { deliveryId: r.delivery_id, status: r.status } : null;
}

/** Waits (bounded) until the delivery reaches a terminal state. Returns the state seen when the wait ends — `pending` if still in flight. */
export async function awaitDelivery(db: Db, deliveryId: string, waitMs: number, pollMs = 150): Promise<DeliveryState> {
  const deadline = Date.now() + Math.max(0, waitMs);
  for (;;) {
    const status = (await deliveryStatus(db, deliveryId)) ?? "DEAD";
    // FAILED is retried by the worker later, but THIS request must tell the truth now: the person's email has not been sent.
    if (status === "SENT" || status === "FAILED" || status === "DEAD" || status === "CANCELLED") return stateOfStatus(status);
    if (Date.now() >= deadline) return "pending";
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

interface Due { delivery_id: string; project_id: string | null; template: Fa4EmailTemplate; attempts: number; max_attempts: number; contact_request_id: string | null }

const EVENT_FOR: Record<Fa4EmailTemplate, { sent: "resume_email_sent" | "yev_email_sent" | "contact_email_sent"; failed: "resume_email_failed" | "yev_email_failed" | "contact_email_failed" }> = {
  fa4_resume_link: { sent: "resume_email_sent", failed: "resume_email_failed" },
  fa4_result_link: { sent: "yev_email_sent", failed: "yev_email_failed" },
  fa4_contact_request: { sent: "contact_email_sent", failed: "contact_email_failed" },
};

/** Claims and delivers due emails. Safe to run concurrently and after crashes (FOR UPDATE SKIP LOCKED + lease). */
export async function deliverDueFa4Emails(deps: Fa4EmailDeps, options: { limit?: number } = {}): Promise<{ sent: number; failed: number; dead: number }> {
  const now = deps.config.now();
  const claimed = await deps.db.query<Due>(
    `UPDATE fa4_email_delivery SET status = 'SENDING', attempts = attempts + 1, lease_until = $2, updated_at = $1
      WHERE delivery_id IN (
        SELECT delivery_id FROM fa4_email_delivery
         WHERE (status IN ('PENDING','FAILED') AND next_attempt_at <= $1) OR (status = 'SENDING' AND lease_until < $1)
         ORDER BY next_attempt_at LIMIT $3 FOR UPDATE SKIP LOCKED)
      RETURNING delivery_id, project_id, template, attempts, max_attempts, contact_request_id`,
    [now, new Date(now.getTime() + 5 * 60_000), options.limit ?? 20],
  );
  const stats = { sent: 0, failed: 0, dead: 0 };
  for (const d of claimed.rows) {
    const ev = EVENT_FOR[d.template];
    try {
      // the transaction that builds the message is CLOSED before the provider is contacted
      const message = await deps.db.transaction(async (tx) => prepare(tx, deps, d, now));
      if (!message) { await deps.db.query("UPDATE fa4_email_delivery SET status='CANCELLED', lease_until=NULL, updated_at=$2 WHERE delivery_id=$1", [d.delivery_id, now]); continue; }
      const res = await deps.email.send(message, { idempotencyKey: d.delivery_id });
      await deps.db.query("UPDATE fa4_email_delivery SET status='SENT', sent_at=$2, lease_until=NULL, provider_name=$3, provider_reference=$4, updated_at=$2 WHERE delivery_id=$1", [d.delivery_id, now, deps.email.name, res.providerReference]);
      await recordEvent(deps.db, { name: ev.sent, source: "server", projectId: d.project_id, props: { attempts: d.attempts } });
      stats.sent++;
    } catch (error) {
      const dead = d.attempts >= d.max_attempts;
      await deps.db.query(
        "UPDATE fa4_email_delivery SET status=$2, last_error=$3, lease_until=NULL, next_attempt_at=$4, updated_at=$5 WHERE delivery_id=$1",
        [d.delivery_id, dead ? "DEAD" : "FAILED", sanitizeDeliveryError(error), new Date(now.getTime() + backoffSeconds(d.attempts) * 1000), now],
      );
      await recordEvent(deps.db, { name: ev.failed, source: "server", projectId: d.project_id, props: { attempts: d.attempts, dead } });
      if (dead) stats.dead++; else stats.failed++;
    }
  }
  return stats;
}

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? "";
const truncateWords = (t: string, max = 160) => {
  const clean = t.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max); const i = cut.lastIndexOf(" ");
  return `${(i > 40 ? cut.slice(0, i) : cut).replace(/[\s,.;:]+$/, "")}…`;
};

/** Destination names in the email's language (open destination → none). */
function destinationNames(a: Partial<Answers> | undefined, locale: Locale): string {
  const list = (a?.destinations?.list ?? []).filter((d) => d.iso && d.iso !== "OPEN" && !a?.destinations?.open);
  return list.map((d) => countryL10n(d.iso)[locale]).join(", ");
}

/** "Premium block" gate: ALL THREE — real continuation (D-050/D-096), a URL for the language, and the commercial-content policy. A URL alone never enables it. */
export function premiumEnabled(projectHasPremiumContinuation: boolean, premiumUrl: string | undefined, commercialAllowed: boolean | undefined): boolean {
  return projectHasPremiumContinuation === true && !!premiumUrl && /^https:\/\//i.test(premiumUrl) && commercialAllowed === true;
}

async function prepare(tx: Db, deps: Fa4EmailDeps, d: Due, now: Date): Promise<EmailMessage | null> {
  const p = !d.project_id ? undefined : (await tx.query<{ email: string; locale: Locale; answers: Partial<Answers>; step_key: string }>(
    "SELECT email, locale, answers, step_key FROM fa4_project WHERE project_id = $1 AND status <> 'ANONYMIZED'", [d.project_id])).rows[0];
  const base = deps.config.appBaseUrl.replace(/\/$/, "");
  // Public path of Discovery in links: /discovery in production (FA4_PUBLIC_PATH), /fa4 by default; both are served by the app.
  const publicPath = /^\/[a-z0-9-]+$/.test(deps.config.publicPath ?? "") ? deps.config.publicPath! : "/fa4";
  // Official full lockup (wordmark + bee) rendered from the brand asset and served by the web app; without a usable https/localhost base the header falls back to the text wordmark.
  const logoUrl = /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$))/i.test(base) ? `${base}/brand/beeside-lockup.png` : "";

  if (d.template === "fa4_contact_request") {
    const c = (await tx.query<{ name: string; company: string; email: string; message: string; share_progress: boolean; language: Locale; origin_stage: "FA" | "YEV" }>(
      "SELECT name, company, email, message, share_progress, language, origin_stage FROM fa4_contact_request WHERE contact_id = $1", [d.contact_request_id])).rows[0];
    if (!c) return null;
    const dests = c.share_progress && p ? destinationNames(p.answers, c.language) : "";
    const r = renderFa4Email("talk", c.language, {
      topic: c.language === "es" ? "Hablar con beeside" : "Talk to beeside",
      message: c.message, name: c.name, company: c.company, email: c.email, destinations: dests,
      stage: c.origin_stage === "YEV" ? "YEV" : "Discovery",
      fa_language: c.language === "es" ? "Español" : "English",   // the language the person used in FA (internal context), shown in the email's own language
      project_id: d.project_id ?? "",
    }, { has_destinations: !!dests, has_project_id: !!d.project_id });
    return {
      template: d.template, to: deps.config.contactAddress ?? "contact@beeside.you", locale: c.language,
      subject: r.subject, html: r.html, text: r.text, body: r.text, ctaLabel: "", ctaUrl: "",
      replyTo: c.email, projectId: d.project_id,
    };
  }

  if (!p || !d.project_id) return null;
  const locale = p.locale;
  const name = firstName(p.answers.identity?.name ?? "");
  if (d.template === "fa4_resume_link") {
    const token = await issueToken(tx, d.project_id, "RESUME", new Date(now.getTime() + deps.config.resumeLinkDays * 86_400_000));
    const url = `${base}${publicPath}#r=${token}`;
    const r = renderFa4Email("resume", locale, { first_name: name, resume_url: url, logo_url: logoUrl }, { has_first_name: !!name, has_logo: !!logoUrl });
    return { template: d.template, to: p.email, locale, subject: r.subject, html: r.html, text: r.text, body: r.text, ctaLabel: "", ctaUrl: url, projectId: d.project_id };
  }

  // YEV email: ONE private access token serves both actions (View / Talk to beeside): opening one never invalidates the other while it is valid.
  const token = await issueToken(tx, d.project_id, "YEV_LINK", new Date(now.getTime() + (deps.config.yevLinkDays ?? 14) * 86_400_000));
  const yevUrl = `${base}${publicPath}#r=${token}&view=result`;
  const talkUrl = `${yevUrl}&contact=open&origin=yev_email`;
  const premiumUrl = deps.config.premiumResourceUrl?.[locale];
  const hasPremium = ((await tx.query<{ shown: boolean }>("SELECT (model->'premium'->>'shown')::boolean AS shown FROM fa4_result WHERE project_id = $1 AND NOT legacy_unsealed ORDER BY result_seq DESC LIMIT 1", [d.project_id])).rows[0]?.shown) === true;
  const destination = destinationNames(p.answers, locale);
  const objective = truncateWords(p.answers.context?.success ?? "");
  const enabled = premiumEnabled(hasPremium, premiumUrl, deps.config.premiumCommercialContentAllowed);
  const r = renderFa4Email("yev", locale, {
    first_name: name, yev_url: yevUrl, talk_to_beeside_url: talkUrl, premium_url: enabled ? premiumUrl : "https://beeside.you/",
    destination, declared_objective: objective, logo_url: logoUrl,
  }, { has_logo: !!logoUrl, has_first_name: !!name, has_destination: !!destination, has_objective: !!objective, show_focus_block: !!destination || !!objective, premium_enabled: enabled });
  return { template: d.template, to: p.email, locale, subject: r.subject, html: r.html, text: r.text, body: r.text, ctaLabel: "", ctaUrl: yevUrl, projectId: d.project_id };
}

export { sanitizeSubjectValue };
