import nodemailer, { Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { EmailMessage, EmailSendOptions, EmailTransport } from "./email-adapter";

/**
 * Real SMTP delivery behind the same EmailTransport contract. It sends only when the SMTP server ACCEPTED the message for every recipient;
 * anything else (connection error, auth error, rejected recipient, timeout) throws, so the outbox records a failure and retries with backoff.
 * Credentials come from the environment (Secret Manager in deployment): they are never logged and never part of an error message.
 */
export interface SmtpConfig {
  host: string; port: number; secure: boolean; user: string; password: string;
  from: string; fromName: string; replyTo: string;
  connectionTimeoutMs?: number; sendTimeoutMs?: number;
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const oneLine = (v: string) => v.replace(/[\r\n]+/g, " ").trim();

export function renderBodies(m: EmailMessage): { text: string; html: string } {
  const hasCta = !!m.ctaUrl && !!m.ctaLabel;
  const text = [m.body, hasCta ? `${m.ctaLabel}: ${m.ctaUrl}` : "", m.secondaryCtaUrl && m.secondaryCtaLabel ? `${m.secondaryCtaLabel}: ${m.secondaryCtaUrl}` : ""].filter(Boolean).join("\n\n");
  const paragraphs = m.body.split(/\n{2,}/).map((p) => `<p style="margin:0 0 16px;line-height:1.5">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const button = hasCta ? `<p style="margin:24px 0"><a href="${esc(m.ctaUrl)}" style="background:#2E0879;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">${esc(m.ctaLabel)}</a></p>` : "";
  const secondary = m.secondaryCtaUrl && m.secondaryCtaLabel ? `<p style="margin:0 0 16px"><a href="${esc(m.secondaryCtaUrl)}" style="color:#2E0879">${esc(m.secondaryCtaLabel)}</a></p>` : "";
  return { text, html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#17181B;max-width:560px">${paragraphs}${button}${secondary}</div>` };
}

export class SmtpEmailTransport implements EmailTransport {
  readonly name = "smtp";
  private readonly transporter: Transporter;
  constructor(private readonly config: SmtpConfig, transporter?: Transporter) {
    this.transporter = transporter ?? nodemailer.createTransport({
      host: config.host, port: config.port, secure: config.secure,
      auth: { user: config.user, pass: config.password },
      connectionTimeout: config.connectionTimeoutMs ?? 10_000, greetingTimeout: 10_000, socketTimeout: config.sendTimeoutMs ?? 20_000,
      // a per-message connection keeps a failing/slow server from wedging later sends; volume here is tiny
      pool: false,
    } as SMTPTransport.Options);
  }

  async send(message: EmailMessage, options?: EmailSendOptions): Promise<{ providerReference: string | null }> {
    const { text, html } = renderBodies(message);
    const info = await this.transporter.sendMail({
      from: { name: this.config.fromName, address: this.config.from },
      replyTo: message.replyTo ?? this.config.replyTo,
      to: message.to,
      subject: oneLine(message.subject),
      text, html,
      // lets a downstream system recognise a retried delivery of the same logical email
      headers: options ? { "X-Beeside-Delivery": options.idempotencyKey } : undefined,
      messageId: options ? `<${options.idempotencyKey}@${this.config.from.split("@")[1] ?? "beeside.you"}>` : undefined,
    });
    if (info.rejected && info.rejected.length > 0) throw new Error("SMTP_RECIPIENT_REJECTED");
    if (!info.accepted || info.accepted.length === 0) throw new Error("SMTP_NOT_ACCEPTED");
    return { providerReference: typeof info.messageId === "string" ? info.messageId.slice(0, 200) : null };
  }
}

/** Reads the SMTP settings; returns the names of missing variables instead of the values. */
export function smtpConfigFromEnv(env: NodeJS.ProcessEnv): { config: SmtpConfig | null; missing: string[] } {
  const required = { SMTP_HOST: env.SMTP_HOST, SMTP_USER: env.SMTP_USER, SMTP_PASSWORD: env.SMTP_PASSWORD, MAIL_FROM: env.MAIL_FROM };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return { config: null, missing };
  const port = Number(env.SMTP_PORT ?? 587);
  return {
    missing,
    config: {
      host: env.SMTP_HOST!, port, secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465,
      user: env.SMTP_USER!, password: env.SMTP_PASSWORD!,
      from: env.MAIL_FROM!, fromName: env.MAIL_FROM_NAME ?? "beeside", replyTo: env.MAIL_REPLY_TO ?? env.MAIL_FROM!,
    },
  };
}
