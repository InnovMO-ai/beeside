/**
 * `precision_config` resolution. A missing key, an inactive row, a malformed value or a database hiccup all resolve to
 * the defined fallback (the link or contact is simply hidden): configuration never produces a customer-facing error.
 */
import type { Db } from "../../db/database";
import type { Locale } from "../api/dto";

export const CONFIG_KEYS = {
  operationHubUrl: "operation_hub_url",
  helpCenterUrl: "help_center_url",
  termsUrl: "terms_url",
  privacyUrl: "privacy_url",
  resumeGapMinutes: "analytics.resume_gap_minutes",
  staleAfterDays: "return.stale_after_days",
  supportContactUrl: "support_contact_url",
  supportEmail: "support_email",
} as const;

export const DEFAULT_RESUME_GAP_MINUTES = 30;

export type ConfigReader = Pick<Db, "query">;

/** Raw value for (key, locale): the locale-specific active row wins over the `*` row. */
export async function configValue(db: ConfigReader, key: string, locale: Locale): Promise<unknown> {
  try {
    const { rows } = await db.query<{ value: unknown }>(
      "SELECT value FROM precision_config WHERE key = $1 AND is_active AND locale IN ($2, '*') ORDER BY (locale = $2) DESC LIMIT 1",
      [key, locale],
    );
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

function unwrap(v: unknown): unknown {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? ((v as Record<string, unknown>).url ?? (v as Record<string, unknown>).value ?? null) : v;
}

/** A URL setting: https absolute or a site-relative path. Anything else is treated as not configured. */
export async function configUrl(db: ConfigReader, key: string, locale: Locale): Promise<string | null> {
  const v = unwrap(await configValue(db, key, locale));
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length === 0 || t.length > 500) return null;
  return /^https:\/\/[^\s]+$/i.test(t) || /^\/[^\s/][^\s]*$/.test(t) ? t : null;
}

export async function configEmail(db: ConfigReader, key: string, locale: Locale): Promise<string | null> {
  const v = unwrap(await configValue(db, key, locale));
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) && v.length <= 200 ? v.trim() : null;
}

export async function configNumber(db: ConfigReader, key: string, locale: Locale, fallback: number): Promise<number> {
  const v = unwrap(await configValue(db, key, locale));
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export async function supportContact(db: ConfigReader, locale: Locale): Promise<{ contactUrl: string | null; email: string | null } | null> {
  const [contactUrl, email] = await Promise.all([configUrl(db, CONFIG_KEYS.supportContactUrl, locale), configEmail(db, CONFIG_KEYS.supportEmail, locale)]);
  return contactUrl || email ? { contactUrl, email } : null;
}
