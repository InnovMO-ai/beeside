import { Locale, QuestionBankBundle } from "../engine/bundle-types";

/**
 * Transactional email sits behind this adapter (Handoff v1 §29). No commercial provider is
 * selected yet: development captures or logs the intended message and never sends real email.
 * Messages reach a transport only from the outbox delivery worker — never inside a business
 * transaction — and every send carries the delivery id as its idempotency key, so a provider
 * adapter can de-duplicate a retried attempt.
 */
export interface EmailMessage {
  template: string;
  to: string;
  locale: Locale;
  subject: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  /** Optional secondary call to action (never the primary one). */
  secondaryCtaLabel?: string;
  secondaryCtaUrl?: string;
  projectId: string | null;
}

export interface EmailSendOptions {
  /** Stable per logical email (the outbox delivery id). */
  idempotencyKey: string;
}

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage, options?: EmailSendOptions): Promise<{ providerReference: string | null }>;
}

/** Keeps messages in memory (tests and local end-to-end runs). */
export class CaptureEmailTransport implements EmailTransport {
  readonly name = "capture";
  readonly messages: EmailMessage[] = [];
  readonly idempotencyKeys: string[] = [];
  /** Test hook: when set, the next send calls fail with this error (then the hook is consumed per call). */
  failNext: Array<Error> = [];
  async send(message: EmailMessage, options?: EmailSendOptions) {
    const failure = this.failNext.shift();
    if (failure) throw failure;
    this.messages.push(message);
    if (options) this.idempotencyKeys.push(options.idempotencyKey);
    return { providerReference: null };
  }
}

export function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 1)}***@${domain}`;
}

/**
 * Logs metadata only. Resume links are secrets: they are printed solely when explicitly allowed
 * for a local development machine (DEV_LOG_EMAIL_LINKS=true), never by default.
 */
export class LogEmailTransport implements EmailTransport {
  readonly name = "log";
  constructor(private readonly includeLinks = false, private readonly log: (line: string) => void = console.log) {}
  async send(message: EmailMessage, options?: EmailSendOptions) {
    const link = this.includeLinks ? ` link=${message.ctaUrl}` : "";
    const key = options ? ` delivery=${options.idempotencyKey}` : "";
    this.log(`[email:${this.name}] template=${message.template} locale=${message.locale} to=${maskEmail(message.to)}${key}${link}`);
    return { providerReference: null };
  }
}

export function fillTemplate(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, name: string) => variables[name] ?? match);
}

export type EmailCopy = { subject: string; body: string; cta: string; secondary_cta?: string };

export function renderEmail(
  bundle: Pick<QuestionBankBundle, "emails">,
  template: string,
  locale: Locale,
  variables: Record<string, string>,
): { subject: string; body: string; cta: string; secondaryCta: string | null } {
  const copy = bundle.emails[template]?.copy[locale] as EmailCopy | undefined;
  if (!copy) throw new Error(`email template ${template} (${locale}) is not in the configuration bundle`);
  return {
    subject: fillTemplate(copy.subject, variables),
    body: fillTemplate(copy.body, variables),
    cta: fillTemplate(copy.cta, variables),
    secondaryCta: copy.secondary_cta ? fillTemplate(copy.secondary_cta, variables) : null,
  };
}
