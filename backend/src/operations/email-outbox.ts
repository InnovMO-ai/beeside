import { Db } from "../db/database";
import type { Locale, QuestionBankBundle } from "../fa/engine/bundle-types";
import { EmailMessage, renderEmail } from "../fa/email/email-adapter";
import { daysLeft, lifecyclePolicyOf } from "../fa/services/access-lifecycle";
import { recordJourneyEvent } from "../fa/services/analytics";
import { FaDeps, ProjectRow, formatDate, issueTokenRecord, loadProject, localeOf } from "../fa/services/repository";
import { PREVIEW_ROOM_URL } from "../premium/content";

/**
 * Transactional email outbox (Operations & Lifecycle Control). Business transactions only ENQUEUE
 * an `email_delivery` row (idempotent by dedupe key); the delivery worker renders, issues the private
 * link, sends through the provider-agnostic transport and records the outcome — each step in its own
 * short transaction, never holding a business transaction open across a network call. Retries are
 * bounded with exponential backoff; a delivery that is no longer relevant (the assessment completed,
 * expired or was purged) is cancelled at send time instead of being sent late.
 */

const DAY_MS = 86_400_000;
export const DEFAULT_SNAPSHOT_LINK_DAYS = 60;
const LEASE_SECONDS = 300;
const BACKOFF_SECONDS = [60, 300, 1800, 7200, 43_200];

type TemplateSource = "question_bank" | "snapshot_template";

interface TemplateDefinition {
  source: TemplateSource;
  linkKind: "RESUME" | null;
  /** Which respondent language the email uses. */
  language: "interaction" | "deliverable";
  /** Journey event recorded when the email is actually sent (technical fact only). */
  sentEvent: string;
  /** Lifecycle emails render from the current bundle when the pinned one predates the lifecycle section. */
  lifecycle: boolean;
  /** Secondary CTA target (never the primary one). */
  secondaryCta?: "preview_room";
  /** Null when still relevant; otherwise the cancellation reason. */
  relevance: (project: ProjectRow, now: Date) => string | null;
}

const inProgress = (p: ProjectRow) => (p.assessment_state === "IN_PROGRESS" ? null : `assessment_${p.assessment_state.toLowerCase()}`);
const accessOpen = (p: ProjectRow, now: Date) =>
  inProgress(p) ?? (p.access_expires_at && p.access_expires_at.getTime() <= now.getTime() ? "access_expired" : null);

export const EMAIL_TEMPLATES = {
  resume_link: { source: "question_bank", linkKind: "RESUME", language: "interaction", sentEvent: "resume_email_sent", lifecycle: false, relevance: (p) => inProgress(p) },
  existing_assessment_link: {
    source: "question_bank",
    linkKind: "RESUME",
    language: "interaction",
    sentEvent: "private_link_email_sent",
    lifecycle: false,
    relevance: (p) => (p.assessment_state === "DELETED" || p.assessment_state === "EXPIRED" ? `assessment_${p.assessment_state.toLowerCase()}` : null),
  },
  access_reminder_day10: { source: "question_bank", linkKind: "RESUME", language: "interaction", sentEvent: "access_reminder_sent", lifecycle: true, relevance: accessOpen },
  access_recovery_day21: {
    source: "question_bank",
    linkKind: "RESUME",
    language: "interaction",
    sentEvent: "access_recovery_email_sent",
    lifecycle: true,
    relevance: (p, now) =>
      inProgress(p) ??
      (!p.access_expires_at || p.access_expires_at.getTime() > now.getTime()
        ? "access_open"
        : !p.access_max_until || p.access_max_until.getTime() <= now.getTime()
          ? "no_longer_recoverable"
          : null),
  },
  access_followup_missing_information: { source: "question_bank", linkKind: "RESUME", language: "interaction", sentEvent: "access_followup_email_sent", lifecycle: true, secondaryCta: "preview_room", relevance: accessOpen },
  access_followup_project_not_structured: { source: "question_bank", linkKind: "RESUME", language: "interaction", sentEvent: "access_followup_email_sent", lifecycle: true, secondaryCta: "preview_room", relevance: accessOpen },
  access_followup_unsure_market_timing: { source: "question_bank", linkKind: "RESUME", language: "interaction", sentEvent: "access_followup_email_sent", lifecycle: true, secondaryCta: "preview_room", relevance: accessOpen },
  access_followup_something_else: { source: "question_bank", linkKind: "RESUME", language: "interaction", sentEvent: "access_followup_email_sent", lifecycle: true, relevance: accessOpen },
  snapshot_ready: {
    source: "snapshot_template",
    linkKind: "RESUME",
    language: "deliverable",
    sentEvent: "snapshot_email_sent",
    lifecycle: false,
    relevance: (p) => (p.assessment_state === "COMPLETED_LOCKED" ? null : `assessment_${p.assessment_state.toLowerCase()}`),
  },
} satisfies Record<string, TemplateDefinition>;

export type EmailTemplate = keyof typeof EMAIL_TEMPLATES;

export function isEmailTemplate(value: unknown): value is EmailTemplate {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(EMAIL_TEMPLATES, value);
}

export interface EnqueueEmailInput {
  dedupeKey: string;
  projectId: string;
  personId: string;
  template: EmailTemplate;
  enqueuedBy: string;
  now: Date;
  /** Earliest send time (e.g. the contextual follow-up the day after an extension). */
  sendAfter?: Date;
  /** Technical, non-personal context only. */
  context?: Record<string, string | number | boolean>;
}

/** Enqueues inside the caller's transaction. Returns the delivery id, or null when already enqueued. */
export async function enqueueEmail(tx: Db, input: EnqueueEmailInput): Promise<string | null> {
  const def: TemplateDefinition = EMAIL_TEMPLATES[input.template];
  const { rows } = await tx.query<{ delivery_id: string }>(
    `INSERT INTO email_delivery (dedupe_key, project_id, person_id, template, template_source, link_kind, context, enqueued_by,
                                 next_attempt_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $10)
     ON CONFLICT (dedupe_key) DO NOTHING RETURNING delivery_id`,
    [
      input.dedupeKey,
      input.projectId,
      input.personId,
      input.template,
      def.source,
      def.linkKind,
      JSON.stringify(input.context ?? {}),
      input.enqueuedBy,
      input.sendAfter ?? input.now,
      input.now,
    ],
  );
  return rows[0]?.delivery_id ?? null;
}

/** Resend cooldown: any non-cancelled request of this template for the project within the window. */
export async function emailRequestedRecently(db: Db, projectId: string, template: EmailTemplate, cooldownMinutes: number, now: Date): Promise<boolean> {
  const { rows } = await db.query<{ recent: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM email_delivery WHERE project_id = $1 AND template = $2 AND status <> 'CANCELLED'
                      AND created_at > $3::timestamptz - make_interval(mins => $4)) AS recent`,
    [projectId, template, now, cooldownMinutes],
  );
  return rows[0]?.recent === true;
}

export interface DeliveryRow {
  delivery_id: string;
  project_id: string | null;
  person_id: string;
  template: string;
  link_kind: string | null;
  context: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export interface DeliveryStats {
  claimed: number;
  sent: number;
  failed: number;
  dead: number;
  cancelled: number;
}

/** Removes anything that looks like an email address from provider errors before storing them. */
export function sanitizeDeliveryError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/[^\s@<>"']+@[^\s@<>"']+/g, "[address]").slice(0, 300) || "send failed";
}

export function backoffSeconds(attempt: number): number {
  return BACKOFF_SECONDS[Math.min(Math.max(attempt, 1), BACKOFF_SECONDS.length) - 1] ?? BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1] ?? 43_200;
}

type Prepared = { kind: "send"; message: EmailMessage; tokenId: string | null; journeyEvent: string } | { kind: "cancel"; reason: string };

async function questionBankFor(deps: FaDeps, project: ProjectRow, template: EmailTemplate): Promise<QuestionBankBundle | null> {
  const def: TemplateDefinition = EMAIL_TEMPLATES[template];
  const pinned = await deps.bundles.byVersion(project.question_bank_version);
  const pinnedUsable = pinned.emails[template] && (!def.lifecycle || lifecyclePolicyOf(pinned).source === "bundle");
  if (pinnedUsable) return pinned;
  // fa-qb-1.0.0 predates the lifecycle emails with an exact expiry date: use the current published copy.
  const current = (await deps.bundles.current()).bundle;
  return current.emails[template] ? current : pinned.emails[template] ? pinned : null;
}

/** Private-link validity, separate from access and retention. */
async function linkExpiry(tx: Db, deps: FaDeps, project: ProjectRow, now: Date): Promise<Date> {
  if (project.assessment_state === "COMPLETED_LOCKED") {
    const pin = await tx.query<{ snapshot_template_version: string }>("SELECT snapshot_template_version FROM project WHERE project_id = $1", [project.project_id]);
    const template = await deps.bundles.templateByVersion(pin.rows[0]?.snapshot_template_version ?? "");
    const days = snapshotLinkDays(template);
    return new Date(now.getTime() + days * DAY_MS);
  }
  // An in-progress assessment's link stays openable while its saved work is retained, so an expired
  // or capped assessment shows its recover/closed state instead of a dead link.
  if (project.retention_until && project.retention_until.getTime() > now.getTime()) return project.retention_until;
  return new Date(now.getTime() + 15 * DAY_MS);
}

export function snapshotLinkDays(template: { links?: { snapshot_link_days?: unknown } }): number {
  const days = template.links?.snapshot_link_days;
  return typeof days === "number" && Number.isInteger(days) && days > 0 && days <= 3650 ? days : DEFAULT_SNAPSHOT_LINK_DAYS;
}

async function prepare(tx: Db, deps: FaDeps, delivery: DeliveryRow, now: Date): Promise<Prepared> {
  if (!isEmailTemplate(delivery.template)) return { kind: "cancel", reason: "unknown_template" };
  const template = delivery.template;
  const def: TemplateDefinition = EMAIL_TEMPLATES[template];
  if (!delivery.project_id) return { kind: "cancel", reason: "no_project" };
  const project = await loadProject(tx, delivery.project_id);
  if (!project) return { kind: "cancel", reason: "project_not_found" };
  if (project.created_by_person_id !== delivery.person_id) return { kind: "cancel", reason: "recipient_changed" };
  const irrelevant = def.relevance(project, now);
  if (irrelevant) return { kind: "cancel", reason: irrelevant };

  const locale: Locale = localeOf(def.language === "deliverable" ? project.preferred_deliverable_language : project.preferred_interaction_language);
  const variables: Record<string, string> = {
    preferred_name: project.preferred_name ?? project.first_name,
    company_name: project.company_name,
    access_until: project.access_expires_at ? formatDate(project.access_expires_at, locale) : "",
    days_left: project.access_expires_at ? String(daysLeft(project.access_expires_at, now)) : "",
    recoverable_until: project.access_max_until ? formatDate(project.access_max_until, locale) : "",
  };

  let rendered: { subject: string; body: string; cta: string; secondaryCta: string | null };
  let previewRoomUrl = PREVIEW_ROOM_URL;
  if (def.source === "snapshot_template") {
    const pin = await tx.query<{ snapshot_template_version: string }>("SELECT snapshot_template_version FROM project WHERE project_id = $1", [project.project_id]);
    const bundle = await deps.bundles.templateByVersion(pin.rows[0]?.snapshot_template_version ?? "");
    if (!bundle.emails[template]) return { kind: "cancel", reason: "template_not_configured" };
    rendered = renderEmail(bundle, template, locale, variables);
  } else {
    const bundle = await questionBankFor(deps, project, template);
    if (!bundle) return { kind: "cancel", reason: "template_not_configured" };
    rendered = renderEmail(bundle, template, locale, variables);
    const configured = (bundle.links as { preview_room_url?: unknown }).preview_room_url;
    if (typeof configured === "string" && configured.startsWith("https://")) previewRoomUrl = configured;
  }

  let tokenId: string | null = null;
  let ctaUrl = deps.config.appBaseUrl.replace(/\/$/, "");
  if (def.linkKind === "RESUME") {
    const issued = await issueTokenRecord(tx, project.project_id, "RESUME", true, await linkExpiry(tx, deps, project, now));
    tokenId = issued.tokenId;
    ctaUrl = `${ctaUrl}/resume/${issued.token}`;
  }
  const message: EmailMessage = {
    template,
    to: project.primary_email,
    locale,
    subject: rendered.subject,
    body: rendered.body,
    ctaLabel: rendered.cta,
    ctaUrl,
    projectId: project.project_id,
    ...(def.secondaryCta && rendered.secondaryCta ? { secondaryCtaLabel: rendered.secondaryCta, secondaryCtaUrl: previewRoomUrl } : {}),
  };
  return { kind: "send", message, tokenId, journeyEvent: def.sentEvent };
}

async function closeWithoutSending(db: Db, delivery: DeliveryRow, reason: string, now: Date): Promise<void> {
  await db.query(
    `UPDATE email_delivery SET status = 'CANCELLED', cancel_reason = $2, lease_until = NULL, finished_at = $3, updated_at = $3
      WHERE delivery_id = $1 AND status = 'SENDING'`,
    [delivery.delivery_id, reason, now],
  );
}

/**
 * Claims and delivers due emails. Safe to run concurrently and after crashes: rows are claimed with
 * FOR UPDATE SKIP LOCKED under a lease, and an expired lease is taken over (counting an attempt).
 */
export async function deliverDueEmails(deps: FaDeps, options: { limit?: number; now?: Date } = {}): Promise<DeliveryStats> {
  const now = options.now ?? deps.config.now();
  const stats: DeliveryStats = { claimed: 0, sent: 0, failed: 0, dead: 0, cancelled: 0 };

  const claimed = await deps.db.transaction(async (tx) => {
    const exhausted = await tx.query(
      `UPDATE email_delivery SET status = 'DEAD', lease_until = NULL, finished_at = $1, updated_at = $1,
              last_error = COALESCE(last_error, 'delivery lease expired after the final attempt')
        WHERE status = 'SENDING' AND lease_until <= $1 AND attempts >= max_attempts`,
      [now],
    );
    stats.dead += exhausted.rowCount ?? 0;
    const { rows } = await tx.query<DeliveryRow>(
      `WITH due AS (
         SELECT delivery_id FROM email_delivery
          WHERE ((status IN ('PENDING', 'FAILED') AND next_attempt_at <= $1) OR (status = 'SENDING' AND lease_until <= $1))
            AND attempts < max_attempts
          ORDER BY next_attempt_at, created_at
          LIMIT $2
          FOR UPDATE SKIP LOCKED)
       UPDATE email_delivery d
          SET status = 'SENDING', attempts = d.attempts + 1, lease_until = $1::timestamptz + make_interval(secs => $3), updated_at = $1
         FROM due WHERE d.delivery_id = due.delivery_id
       RETURNING d.delivery_id, d.project_id, d.person_id, d.template, d.link_kind, d.context, d.attempts, d.max_attempts`,
      [now, options.limit ?? 25, LEASE_SECONDS],
    );
    return rows;
  });
  stats.claimed = claimed.length;

  for (const delivery of claimed) {
    let prepared: Prepared;
    try {
      prepared = await deps.db.transaction((tx) => prepare(tx, deps, delivery, now));
    } catch (error) {
      prepared = { kind: "cancel", reason: `render_failed: ${sanitizeDeliveryError(error)}`.slice(0, 200) };
    }
    if (prepared.kind === "cancel") {
      await closeWithoutSending(deps.db, delivery, prepared.reason, now);
      stats.cancelled += 1;
      continue;
    }

    try {
      const result = await deps.email.send(prepared.message, { idempotencyKey: delivery.delivery_id });
      await deps.db.transaction(async (tx) => {
        await tx.query(
          `UPDATE email_delivery SET status = 'SENT', sent_at = $2, finished_at = $2, lease_until = NULL, last_error = NULL,
                  provider_name = $3, provider_reference = $4, updated_at = $2
            WHERE delivery_id = $1`,
          [delivery.delivery_id, now, deps.email.name, result.providerReference],
        );
        // The newest private link replaces the earlier ones (rotation on reissue).
        if (prepared.tokenId && delivery.project_id) {
          await tx.query(
            `UPDATE project_access_token SET revoked_at = $3
              WHERE project_id = $1 AND kind = 'RESUME' AND revoked_at IS NULL AND token_id <> $2`,
            [delivery.project_id, prepared.tokenId, now],
          );
        }
        await tx.query(
          `INSERT INTO email_event (project_id, email_type, recipient, sent_at, status, provider_reference, delivery_id, attempt)
           VALUES ($1, $2, $3, $4, 'SENT', $5, $6, $7)`,
          [delivery.project_id, delivery.template, prepared.message.to, now, result.providerReference, delivery.delivery_id, delivery.attempts],
        );
        await recordJourneyEvent(tx, {
          eventType: prepared.journeyEvent,
          projectId: delivery.project_id,
          properties: { template: delivery.template, attempt: delivery.attempts },
        });
      });
      stats.sent += 1;
    } catch (error) {
      const message = sanitizeDeliveryError(error);
      const final = delivery.attempts >= delivery.max_attempts;
      await deps.db.transaction(async (tx) => {
        if (prepared.tokenId) {
          await tx.query("UPDATE project_access_token SET revoked_at = $2 WHERE token_id = $1 AND revoked_at IS NULL", [prepared.tokenId, now]);
        }
        await tx.query(
          `UPDATE email_delivery
              SET status = $2, last_error = $3, lease_until = NULL, updated_at = $4,
                  next_attempt_at = $4::timestamptz + make_interval(secs => $5),
                  finished_at = CASE WHEN $2 = 'DEAD' THEN $4::timestamptz ELSE NULL END
            WHERE delivery_id = $1`,
          [delivery.delivery_id, final ? "DEAD" : "FAILED", message, now, backoffSeconds(delivery.attempts)],
        );
        await tx.query(
          `INSERT INTO email_event (project_id, email_type, recipient, sent_at, status, provider_reference, delivery_id, attempt)
           VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)`,
          [delivery.project_id, delivery.template, prepared.message.to, now, final ? "DEAD" : "FAILED", delivery.delivery_id, delivery.attempts],
        );
      });
      if (final) stats.dead += 1;
      else stats.failed += 1;
    }
  }
  return stats;
}

/**
 * After a request that may have enqueued email: inline (tests and local runs) delivers before the
 * response; background delivers right after it; the worker retries whatever remains either way.
 */
export async function dispatchEmails(deps: FaDeps): Promise<void> {
  const mode = deps.emailDispatch ?? "background";
  if (mode === "none") return;
  if (mode === "inline") {
    await deliverDueEmails(deps, { limit: 25 }).catch(() => undefined);
    return;
  }
  setImmediate(() => {
    deliverDueEmails(deps, { limit: 25 }).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error(`[email-outbox] background delivery failed: ${sanitizeDeliveryError(error)}`);
    });
  });
}

/** ADMIN retry of a failed or dead delivery: a fresh attempt budget, due immediately. */
export async function retryDelivery(tx: Db, deliveryId: string, now: Date): Promise<boolean> {
  const { rowCount } = await tx.query(
    `UPDATE email_delivery SET status = 'PENDING', attempts = 0, next_attempt_at = $2, lease_until = NULL, finished_at = NULL, updated_at = $2
      WHERE delivery_id = $1 AND status IN ('FAILED', 'DEAD')`,
    [deliveryId, now],
  );
  return (rowCount ?? 0) > 0;
}

/** ADMIN cancellation of a delivery that has not been sent. */
export async function cancelDelivery(tx: Db, deliveryId: string, reason: string, now: Date): Promise<boolean> {
  const { rowCount } = await tx.query(
    `UPDATE email_delivery SET status = 'CANCELLED', cancel_reason = $2, lease_until = NULL, finished_at = $3, updated_at = $3
      WHERE delivery_id = $1 AND status IN ('PENDING', 'FAILED')`,
    [deliveryId, reason.slice(0, 200), now],
  );
  return (rowCount ?? 0) > 0;
}
