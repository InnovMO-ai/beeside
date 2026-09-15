import { Bundle, Locale } from "./types";

/** Interface copy from the versioned bundle; a missing key renders as the key (never invented text). */
export function uiText(bundle: Bundle, locale: Locale, screen: string, key: string, variables: Record<string, string> = {}): string {
  const text = bundle.ui[screen]?.copy[locale]?.[key] ?? bundle.ui[screen]?.copy.en?.[key] ?? key;
  return text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, name: string) => variables[name] ?? match);
}

export function makeT(bundle: Bundle, locale: Locale) {
  return (screen: string, key: string, variables?: Record<string, string>) => uiText(bundle, locale, screen, key, variables);
}

export type T = ReturnType<typeof makeT>;

export function formatDate(iso: string | null, locale: Locale): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(locale === "es" ? "es-MX" : "en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(iso));
}

export function isPersonalEmail(bundle: Bundle, email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1];
  return !!domain && bundle.identity.personal_email_domains.includes(domain);
}
