/**
 * Log redaction (Phase 13). Anything that may reach a log line — error messages, request paths,
 * adapter responses — passes through here first: emails, bearer credentials, private-link tokens,
 * connection-string passwords and secret-looking parameters are replaced before printing.
 */

const RULES: Array<[RegExp, string]> = [
  [/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s]+@/gi, "$1****@"],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ****"],
  [/((?:secret|password|passwd|token|signature|api[_-]?key|authorization|code|state|nonce)["']?\s*[:=]\s*["']?)[^"'\s&,;}]+/gi, "$1****"],
  [/\/resume[/#][A-Za-z0-9_-]+/g, "/resume/****"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "****@****"],
  // Access tokens (256-bit base64url), HMAC/sha256 hex digests and similar opaque credentials.
  [/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])/g, "****"],
];

export function redact(text: string, maxLength = 500): string {
  let out = text;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out.length > maxLength ? `${out.slice(0, maxLength)}…` : out;
}

/** A short, redacted description of an error (never its stack or attached request data). */
export function describeError(error: unknown): string {
  if (error instanceof Error) return redact(`${error.name}: ${error.message}`, 300);
  return redact(String(error), 300);
}

export type LogLevel = "info" | "warn" | "error";
export type Logger = (level: LogLevel, message: string, fields?: Record<string, string | number | boolean | null>) => void;

/** One JSON line per event (Cloud Logging parses `severity`); every string is redacted. */
export const jsonLogger: Logger = (level, message, fields = {}) => {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) safe[key] = typeof value === "string" ? redact(value, 300) : value;
  const line = JSON.stringify({ severity: level.toUpperCase(), message: redact(message), ...safe });
  // eslint-disable-next-line no-console
  (level === "error" ? console.error : console.log)(line);
};
