import { createHmac, timingSafeEqual } from "node:crypto";
import { Db } from "../db/database";
import { generateAccessToken, hashAccessToken } from "../fa/services/tokens";
import { IdentityClaims } from "./oidc";
import { AdminRole } from "./rbac";

/**
 * Admin/Supervisor sessions: an opaque random token in an HttpOnly, SameSite=Strict cookie scoped
 * to the Admin API; only its sha256 is stored. Sessions expire absolutely and after inactivity,
 * end immediately when the admin user is deactivated, loses login or changes role, and are never
 * interchangeable with respondent (customer) tokens — different cookie, table and hash domain.
 */

export const ADMIN_SESSION_COOKIE = "beeside_admin_session";
export const ADMIN_LOGIN_COOKIE = "beeside_admin_login";

export interface AdminSessionConfig {
  /** HMAC secret for the short-lived login-state cookie (≥ 32 characters, from the secrets store). */
  sessionSecret: string;
  sessionTtlMinutes: number;
  idleTimeoutMinutes: number;
  /** Secure cookies everywhere except an explicit local development override. */
  cookieSecure: boolean;
  /** Public origin of the Control Center (used for the Origin check and redirects). */
  appOrigin: string;
}

export interface AdminPrincipal {
  adminUserId: string;
  role: AdminRole;
  email: string;
  sessionId: string;
}

const sessionTokenHash = (token: string) => hashAccessToken(`admin-session:${token}`);

// ---------------------------------------------------------------- login state (signed cookie)
export interface LoginState {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  exp: number;
}

function hmac(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function sealLoginState(secret: string, payload: LoginState): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(secret, body)}`;
}

export function openLoginState(secret: string, value: string | undefined, now: Date): LoginState | null {
  if (!value) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;
  const expected = Buffer.from(hmac(secret, body));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LoginState;
    if (typeof payload.exp !== "number" || payload.exp <= now.getTime()) return null;
    if (typeof payload.state !== "string" || typeof payload.nonce !== "string" || typeof payload.verifier !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

/** Only same-app relative paths under /admin are accepted as post-login destinations. */
export function safeReturnTo(value: unknown): string {
  return typeof value === "string" && /^\/admin(\/[A-Za-z0-9/_\-.?=&%]*)?$/.test(value) && !value.includes("//") && !value.includes("..") ? value : "/admin";
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function cookieHeader(name: string, value: string, options: { secure: boolean; maxAgeSeconds: number; path: string }): string {
  const attributes = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path}`, "HttpOnly", "SameSite=Strict", `Max-Age=${options.maxAgeSeconds}`];
  if (options.secure) attributes.push("Secure");
  return attributes.join("; ");
}

// ---------------------------------------------------------------- sign-in → admin user
export type LoginDecision = { ok: true; adminUserId: string; role: AdminRole } | { ok: false; reason: string; adminUserId: string | null };

/**
 * Maps a verified identity to a provisioned, active, login-enabled admin user. The first login
 * binds the provider subject; any later login must present the same issuer + subject, so a
 * re-assigned mailbox cannot inherit Control Center access.
 */
export async function authorizeAdminLogin(db: Db, claims: IdentityClaims, now: Date): Promise<LoginDecision> {
  const { rows } = await db.query<{ admin_user_id: string; role: AdminRole; active: boolean; login_enabled: boolean; auth_issuer: string | null; auth_subject: string | null }>(
    "SELECT admin_user_id, role, active, login_enabled, auth_issuer, auth_subject FROM admin_user WHERE auth_identity = $1",
    [claims.email],
  );
  const user = rows[0];
  if (!user) return { ok: false, reason: "not_provisioned", adminUserId: null };
  if (!user.login_enabled) return { ok: false, reason: "login_not_enabled", adminUserId: user.admin_user_id };
  if (!user.active) return { ok: false, reason: "inactive", adminUserId: user.admin_user_id };
  if (user.auth_subject === null) {
    const bound = await db.query(
      "UPDATE admin_user SET auth_issuer = $2, auth_subject = $3, last_login_at = $4, updated_at = $4 WHERE admin_user_id = $1 AND auth_subject IS NULL",
      [user.admin_user_id, claims.issuer, claims.subject, now],
    );
    if ((bound.rowCount ?? 0) !== 1) return { ok: false, reason: "binding_conflict", adminUserId: user.admin_user_id };
  } else if (user.auth_issuer !== claims.issuer || user.auth_subject !== claims.subject) {
    return { ok: false, reason: "subject_mismatch", adminUserId: user.admin_user_id };
  } else {
    await db.query("UPDATE admin_user SET last_login_at = $2, updated_at = $2 WHERE admin_user_id = $1", [user.admin_user_id, now]);
  }
  return { ok: true, adminUserId: user.admin_user_id, role: user.role };
}

export async function createAdminSession(
  db: Db,
  input: { adminUserId: string; role: AdminRole; issuer: string; now: Date; config: AdminSessionConfig },
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = generateAccessToken();
  const expiresAt = new Date(input.now.getTime() + input.config.sessionTtlMinutes * 60_000);
  const { rows } = await db.query<{ session_id: string }>(
    `INSERT INTO admin_session (admin_user_id, token_hash, role_at_login, auth_issuer, created_at, last_seen_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $5, $6) RETURNING session_id`,
    [input.adminUserId, sessionTokenHash(token), input.role, input.issuer, input.now, expiresAt],
  );
  return { token, sessionId: rows[0]?.session_id as string, expiresAt };
}

/** Resolves a session cookie to a principal, revoking it when it is no longer valid. */
export async function resolveAdminSession(db: Db, rawToken: string | undefined, now: Date, config: AdminSessionConfig): Promise<AdminPrincipal | null> {
  if (!rawToken || !/^[A-Za-z0-9_-]{40,64}$/.test(rawToken)) return null;
  const { rows } = await db.query<{
    session_id: string;
    admin_user_id: string;
    role_at_login: AdminRole;
    last_seen_at: Date;
    expires_at: Date;
    revoked_at: Date | null;
    role: AdminRole;
    active: boolean;
    login_enabled: boolean;
    auth_identity: string;
  }>(
    `SELECT s.session_id, s.admin_user_id, s.role_at_login, s.last_seen_at, s.expires_at, s.revoked_at,
            u.role, u.active, u.login_enabled, u.auth_identity
       FROM admin_session s JOIN admin_user u ON u.admin_user_id = s.admin_user_id
      WHERE s.token_hash = $1`,
    [sessionTokenHash(rawToken)],
  );
  const s = rows[0];
  if (!s || s.revoked_at) return null;
  let invalid: string | null = null;
  if (s.expires_at.getTime() <= now.getTime()) invalid = "expired";
  else if (s.last_seen_at.getTime() + config.idleTimeoutMinutes * 60_000 <= now.getTime()) invalid = "idle_timeout";
  else if (!s.active || !s.login_enabled) invalid = "user_disabled";
  else if (s.role !== s.role_at_login) invalid = "role_changed";
  if (invalid) {
    await db.query("UPDATE admin_session SET revoked_at = $2, revoke_reason = $3 WHERE session_id = $1 AND revoked_at IS NULL", [s.session_id, now, invalid]);
    return null;
  }
  if (now.getTime() - s.last_seen_at.getTime() > 60_000) {
    await db.query("UPDATE admin_session SET last_seen_at = $2 WHERE session_id = $1 AND revoked_at IS NULL AND last_seen_at < $2", [s.session_id, now]);
  }
  return { adminUserId: s.admin_user_id, role: s.role, email: s.auth_identity, sessionId: s.session_id };
}

export async function revokeAdminSession(db: Db, sessionId: string, reason: string, now: Date): Promise<void> {
  await db.query("UPDATE admin_session SET revoked_at = $2, revoke_reason = $3 WHERE session_id = $1 AND revoked_at IS NULL", [sessionId, now, reason]);
}

export async function revokeAllAdminSessions(db: Db, adminUserId: string, reason: string, now: Date): Promise<number> {
  const { rowCount } = await db.query(
    "UPDATE admin_session SET revoked_at = $2, revoke_reason = $3 WHERE admin_user_id = $1 AND revoked_at IS NULL",
    [adminUserId, now, reason],
  );
  return rowCount ?? 0;
}
