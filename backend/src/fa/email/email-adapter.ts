import { Locale, QuestionBankBundle } from "../engine/bundle-types";

/**
 * Transactional email sits behind this adapter (Handoff v1 §29). No commercial provider is
 * selected yet: development captures or logs the intended message and never sends real email.
 */
export interface EmailMessage {
  template: string;
  to: string;
  locale: Locale;
  subject: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  projectId: string | null;
}

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<{ providerReference: string | null }>;
}

/** Keeps messages in memory (tests and local end-to-end runs). */
export class CaptureEmailTransport implements EmailTransport {
  readonly name = "capture";
  readonly messages: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.messages.push(message);
    return { providerReference: null };
  }
}

function maskEmail(email: string): string {
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
  async send(message: EmailMessage) {
    const link = this.includeLinks ? ` link=${message.ctaUrl}` : "";
    this.log(`[email:${this.name}] template=${message.template} locale=${message.locale} to=${maskEmail(message.to)}${link}`);
    return { providerReference: null };
  }
}

export function fillTemplate(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, name: string) => variables[name] ?? match);
}

export function renderEmail(
  bundle: QuestionBankBundle,
  template: string,
  locale: Locale,
  variables: Record<string, string>,
): { subject: string; body: string; cta: string } {
  const copy = bundle.emails[template]?.copy[locale];
  if (!copy) throw new Error(`email template ${template} (${locale}) is not in the pinned question bank`);
  return {
    subject: fillTemplate(copy.subject, variables),
    body: fillTemplate(copy.body, variables),
    cta: fillTemplate(copy.cta, variables),
  };
}
