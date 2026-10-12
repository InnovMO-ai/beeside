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
  /** Contact beeside: one address for every customer-facing contact / support action. */
  contactEmail: "contact_beeside_email",
  /** Commercial Notices: reference document for a commercial-communications consent context. Not a navigation or footer link. */
  commercialNoticesUrl: "commercial_notices_url",
  /**
   * Direct Sherpa contact channel (deployment-level, optional). NO shipped default: until a real channel exists the key is
   * simply unset and Precision offers general Contact beeside instead. A per-project channel supplied by the hub wins over it.
   */
  sherpaContactEmail: "sherpa_contact_email",
} as const;

/**
 * PO-approved customer-facing values (12 Oct 2026). Resolution order for every one of them:
 *   1. `precision_config` row (locale-specific, then `*`)  — the Admin-editable layer;
 *   2. environment variable (deployment-level override);
 *   3. these shipped defaults.
 * No UI component or screen carries any of these literally: they reach the client only through the API.
 */
export const APPROVED_CUSTOMER_LINKS = {
  [CONFIG_KEYS.privacyUrl]: { env: "PRECISION_PRIVACY_URL", value: "https://www.beeside.you/privacy" },
  [CONFIG_KEYS.helpCenterUrl]: { env: "PRECISION_HELP_CENTER_URL", value: "https://www.beeside.you/helpcenter" },
  [CONFIG_KEYS.termsUrl]: { env: "PRECISION_TERMS_URL", value: "https://beeside.you/termsandconditions" },
  [CONFIG_KEYS.commercialNoticesUrl]: { env: "PRECISION_COMMERCIAL_NOTICES_URL", value: "https://beeside.you/Policiescommercialnotices" },
} as const;
export const APPROVED_CONTACT_EMAIL = { env: "PRECISION_CONTACT_EMAIL", value: "contact@beeside.you" } as const;

export const SHERPA_CONTACT_ENV = "PRECISION_SHERPA_CONTACT_EMAIL";

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

const httpsOrPath = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= 500 && (/^https:\/\/[^\s]+$/i.test(t) || /^\/[^\s/][^\s]*$/.test(t)) ? t : null;
};
const emailOrNull = (v: unknown): string | null => (typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) && v.length <= 200 ? v.trim() : null);

/** A customer link: configuration row, then environment, then the approved default. A malformed value at one level falls to the next. */
export async function customerLink(
  db: ConfigReader,
  key: keyof typeof APPROVED_CUSTOMER_LINKS,
  locale: Locale,
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const d = APPROVED_CUSTOMER_LINKS[key];
  return (await configUrl(db, key, locale)) ?? httpsOrPath(env[d.env]) ?? d.value;
}

/** The single Contact beeside address. */
export async function contactEmail(db: ConfigReader, locale: Locale, env: Record<string, string | undefined> = process.env): Promise<string> {
  return (await configEmail(db, CONFIG_KEYS.contactEmail, locale)) ?? emailOrNull(env[APPROVED_CONTACT_EMAIL.env]) ?? APPROVED_CONTACT_EMAIL.value;
}

/**
 * The direct Sherpa channel, or null when none is available. Order: the hub's per-project channel, then the
 * `sherpa_contact_email` configuration row, then the deployment environment. There is deliberately no shipped default:
 * a missing or malformed value means "no direct channel", never a guessed address.
 */
export async function sherpaContactChannel(
  db: ConfigReader,
  locale: Locale,
  fromHub?: string | null,
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  return emailOrNull(fromHub) ?? (await configEmail(db, CONFIG_KEYS.sherpaContactEmail, locale)) ?? emailOrNull(env[SHERPA_CONTACT_ENV]);
}
