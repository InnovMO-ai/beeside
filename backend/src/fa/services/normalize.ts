/**
 * Identity normalization and company-matching signals (Handoff v1 §4–§5).
 * Email: trim + lowercase identifies person_id. Company signals — name, website domain and the
 * corporate domain after '@' — are recognition signals only; companies are never auto-merged.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LEGAL_SUFFIXES = new Set([
  "sa", "sab", "de", "cv", "srl", "sapi", "sc", "inc", "incorporated", "llc", "ltd", "limited", "corp",
  "corporation", "co", "gmbh", "sl", "sas", "plc", "bv", "ag", "spa", "company",
]);

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

/** Domain after the last '@' — never the full address. */
export function emailDomain(normalizedEmail: string): string {
  return normalizedEmail.slice(normalizedEmail.lastIndexOf("@") + 1);
}

export function isPersonalEmailDomain(normalizedEmail: string, personalDomains: readonly string[]): boolean {
  return personalDomains.includes(emailDomain(normalizedEmail));
}

/** Corporate domain signal: NULL for personal-mail providers. */
export function corporateEmailDomain(normalizedEmail: string, personalDomains: readonly string[]): string | null {
  return isPersonalEmailDomain(normalizedEmail, personalDomains) ? null : emailDomain(normalizedEmail);
}

/** Host of a company website without scheme, path or leading "www."; NULL when not a valid host. */
export function normalizeWebsiteDomain(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

/** Casefolded, accent-free, punctuation-free company name without trailing legal-form tokens. */
export function normalizeCompanyName(name: string): string {
  const tokens = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\./g, "") // "S.A. de C.V." → "sa de cv"
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1] ?? "")) tokens.pop();
  return tokens.join(" ");
}
