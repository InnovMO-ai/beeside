import type { Db } from "../db/database";
import { FaError } from "../fa/services/errors";
import { APPROVED_CONTACT_EMAIL, APPROVED_CUSTOMER_LINKS, CONFIG_KEYS, SHERPA_CONTACT_ENV } from "../precision/domain/config";

/**
 * Admin-managed Precision links and routes (V1.0). The runtime resolves each of these as
 *   precision_config row (locale, then '*')  →  environment variable  →  shipped default.
 * This module is the Admin side: it shows what is effective and where it comes from, and writes a new VERSION of the row
 * (the previous active row is deactivated, never edited), so every change is reversible and nothing is lost.
 * It does not add a second resolution path: it only writes the rows `configValue` already reads.
 */

export type ConfigKind = "url" | "email";
export const MANAGED_LOCALES = ["*", "en", "es"] as const;
export type ManagedLocale = (typeof MANAGED_LOCALES)[number];

interface ManagedKey {
  key: string;
  kind: ConfigKind;
  label: string;
  description: string;
  env: string | null;
  shippedDefault: string | null;
}

const link = (key: keyof typeof APPROVED_CUSTOMER_LINKS, label: string, description: string): ManagedKey => ({
  key,
  kind: "url",
  label,
  description,
  env: APPROVED_CUSTOMER_LINKS[key].env,
  shippedDefault: APPROVED_CUSTOMER_LINKS[key].value,
});

export const MANAGED_KEYS: readonly ManagedKey[] = [
  link(CONFIG_KEYS.privacyUrl, "Privacy notice", "Link shown wherever Precision points the client to the privacy notice."),
  link(CONFIG_KEYS.helpCenterUrl, "Help center", "Link behind every Help action in Precision."),
  link(CONFIG_KEYS.termsUrl, "Terms and conditions", "Link behind the terms reference in consent and checkout moments."),
  link(CONFIG_KEYS.commercialNoticesUrl, "Commercial notices", "Reference document for commercial-communications consent. Not a navigation link."),
  {
    key: CONFIG_KEYS.operationHubUrl,
    kind: "url",
    label: "Operation Hub",
    description: "Where the client continues once the project is handed over. No shipped default: until set, the link is simply not shown.",
    env: null,
    shippedDefault: null,
  },
  {
    key: CONFIG_KEYS.contactEmail,
    kind: "email",
    label: "Contact beeside",
    description: "Single address behind every customer-facing contact / support action.",
    env: APPROVED_CONTACT_EMAIL.env,
    shippedDefault: APPROVED_CONTACT_EMAIL.value,
  },
  {
    key: CONFIG_KEYS.sherpaContactEmail,
    kind: "email",
    label: "Direct Sherpa contact",
    description: "Optional deployment-level Sherpa channel. No shipped default: until set, clients are offered general Contact beeside.",
    env: SHERPA_CONTACT_ENV,
    shippedDefault: null,
  },
];

const byKey = (key: string): ManagedKey => {
  const found = MANAGED_KEYS.find((k) => k.key === key);
  if (!found) throw new FaError("NOT_FOUND", "unknown configuration key");
  return found;
};

export function validateValue(kind: ConfigKind, raw: unknown): string {
  if (typeof raw !== "string") throw new FaError("INVALID_INPUT", "value must be text", { fields: ["value"] });
  const v = raw.trim();
  if (kind === "url") {
    if (v.length === 0 || v.length > 500 || !(/^https:\/\/[^\s]+$/i.test(v) || /^\/[^\s/][^\s]*$/.test(v))) {
      throw new FaError("INVALID_INPUT", "value must be an https address or a site-relative path", { fields: ["value"] });
    }
    return v;
  }
  if (v.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new FaError("INVALID_INPUT", "value must be an email address", { fields: ["value"] });
  return v;
}

function parseLocale(raw: unknown): ManagedLocale {
  if (typeof raw !== "string" || !(MANAGED_LOCALES as readonly string[]).includes(raw)) throw new FaError("INVALID_INPUT", "locale must be *, en or es", { fields: ["locale"] });
  return raw as ManagedLocale;
}

export interface ConfigEntry {
  key: string;
  kind: ConfigKind;
  label: string;
  description: string;
  /** What each audience actually gets, and which layer it comes from. */
  effective: Array<{ locale: "en" | "es"; value: string | null; source: "admin" | "environment" | "default" | "unset"; adminLocale?: ManagedLocale }>;
  /** Active Admin rows, one per locale that has one. */
  overrides: Array<{ locale: ManagedLocale; value: string; version: number; changedAt: string }>;
}

interface Row {
  key: string;
  locale: ManagedLocale;
  value: unknown;
  version: number;
  created_at: Date;
}

const plain = (v: unknown): string | null => {
  const u = v !== null && typeof v === "object" && !Array.isArray(v) ? ((v as Record<string, unknown>).url ?? (v as Record<string, unknown>).value ?? null) : v;
  return typeof u === "string" ? u : null;
};

export async function configOverview(db: Pick<Db, "query">, env: NodeJS.ProcessEnv): Promise<ConfigEntry[]> {
  const { rows } = await db.query<Row>(
    "SELECT key, locale, value, version, created_at FROM precision_config WHERE is_active AND key = ANY($1) ORDER BY key, locale",
    [MANAGED_KEYS.map((k) => k.key)],
  );
  return MANAGED_KEYS.map((m) => {
    const mine = rows.filter((r) => r.key === m.key);
    const overrides = mine.flatMap((r) => {
      const value = plain(r.value);
      return value === null ? [] : [{ locale: r.locale, value, version: r.version, changedAt: r.created_at.toISOString() }];
    });
    const effective = (["en", "es"] as const).map((locale) => {
      // Same order as the runtime: locale row, then '*' row.
      const row = overrides.find((o) => o.locale === locale) ?? overrides.find((o) => o.locale === "*");
      if (row) return { locale, value: row.value, source: "admin" as const, adminLocale: row.locale };
      const fromEnv = m.env ? env[m.env]?.trim() : undefined;
      if (fromEnv) return { locale, value: fromEnv, source: "environment" as const };
      if (m.shippedDefault) return { locale, value: m.shippedDefault, source: "default" as const };
      return { locale, value: null, source: "unset" as const };
    });
    return { key: m.key, kind: m.kind, label: m.label, description: m.description, effective, overrides };
  });
}

/** Writes a new version for (key, locale). Returns the new version number. The previous active row is kept, inactive. */
export async function setConfig(db: Db, input: { key: string; locale: unknown; value: unknown; reason: unknown; now: Date }): Promise<{ key: string; locale: ManagedLocale; version: number }> {
  const m = byKey(input.key);
  const locale = parseLocale(input.locale);
  const value = validateValue(m.kind, input.value);
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 300) : "";
  if (reason.length === 0) throw new FaError("INVALID_INPUT", "a reason is required", { fields: ["reason"] });
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`precision_config:${m.key}:${locale}`]);
    const prev = await tx.query<{ version: number }>("SELECT COALESCE(MAX(version), 0) AS version FROM precision_config WHERE key = $1 AND locale = $2", [m.key, locale]);
    const version = Number(prev.rows[0]?.version ?? 0) + 1;
    await tx.query("UPDATE precision_config SET is_active = false WHERE key = $1 AND locale = $2 AND is_active", [m.key, locale]);
    await tx.query(
      "INSERT INTO precision_config (key, locale, value, is_active, version, change_reason, created_at) VALUES ($1, $2, $3::jsonb, true, $4, $5, $6)",
      [m.key, locale, JSON.stringify({ value }), version, reason, input.now],
    );
    return { key: m.key, locale, version };
  });
}

/** Reset = deactivate the Admin row, so the layer below (environment / shipped default) applies again. History stays. */
export async function resetConfig(db: Db, input: { key: string; locale: unknown }): Promise<{ key: string; locale: ManagedLocale; reset: boolean }> {
  const m = byKey(input.key);
  const locale = parseLocale(input.locale);
  const { rowCount } = await db.query("UPDATE precision_config SET is_active = false WHERE key = $1 AND locale = $2 AND is_active", [m.key, locale]);
  return { key: m.key, locale, reset: (rowCount ?? 0) > 0 };
}
