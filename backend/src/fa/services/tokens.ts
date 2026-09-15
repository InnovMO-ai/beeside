import { createHash, randomBytes } from "node:crypto";

/** 256-bit, URL-safe, non-guessable access token (session or resume link). */
export function generateAccessToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this hash is stored; the raw token never reaches the database or logs. */
export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function looksLikeAccessToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(value);
}
