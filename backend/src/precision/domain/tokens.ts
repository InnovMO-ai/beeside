/**
 * Access tokens (`precision_access_token`). Two kinds, both opaque 256-bit values stored only as sha256:
 *  - `link`: one-time, sent to the client; the link alone never grants access, it is exchanged for a session;
 *  - `session`: Bearer credential of the API; entitlement is evaluated on every request, not at issue time.
 * The raw value exists only in the response to its creator. It is never logged and never stored.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../../db/database";

export const DEFAULT_LINK_TTL_MS = 7 * 24 * 3600 * 1000;
export const DEFAULT_SESSION_TTL_MS = 8 * 3600 * 1000;

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface IssuedToken { token: string; expiresAt: Date }

async function insertToken(db: Db, projectId: string, kind: "link" | "session", ttlMs: number, now: Date): Promise<IssuedToken> {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + ttlMs);
  await db.query("INSERT INTO precision_access_token (token_hash, project_id, kind, expires_at, created_at) VALUES ($1, $2, $3, $4, $5)", [hashToken(token), projectId, kind, expiresAt, now]);
  return { token, expiresAt };
}

/** Mints a one-time link token for a project (operations / seed). The returned value is shown once. */
export async function createLinkToken(db: Db, projectId: string, ttlMs: number = DEFAULT_LINK_TTL_MS, now: Date = new Date()): Promise<IssuedToken> {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("createLinkToken: ttlMs must be positive");
  return insertToken(db, projectId, "link", ttlMs, now);
}

/**
 * Exchanges a link token for a session token. Atomic and single-use: one UPDATE consumes the link only when it is
 * unconsumed, unrevoked and unexpired, so two concurrent exchanges can never both succeed. Returns null for every
 * failure (unknown, used, expired, revoked) without saying which.
 */
export async function exchangeLinkToken(db: Db, code: string, now: Date, sessionTtlMs: number = DEFAULT_SESSION_TTL_MS): Promise<(IssuedToken & { projectId: string }) | null> {
  if (typeof code !== "string" || code.length < 16 || code.length > 200 || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ project_id: string }>(
      `UPDATE precision_access_token SET consumed_at = $2
        WHERE token_hash = $1 AND kind = 'link' AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > $2
        RETURNING project_id`,
      [hashToken(code), now],
    );
    const row = rows[0];
    if (!row) return null;
    const session = await insertToken(tx, row.project_id, "session", sessionTtlMs, now);
    return { ...session, projectId: row.project_id };
  });
}

/** Resolves a Bearer session token to its project, or null (unknown, wrong kind, revoked, expired). */
export async function authenticateSession(db: Db, token: string, now: Date): Promise<{ projectId: string; expiresAt: Date } | null> {
  if (typeof token !== "string" || token.length < 16 || token.length > 200 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const { rows } = await db.query<{ project_id: string; expires_at: Date }>(
    "SELECT project_id, expires_at FROM precision_access_token WHERE token_hash = $1 AND kind = 'session' AND revoked_at IS NULL AND expires_at > $2",
    [hashToken(token), now],
  );
  const row = rows[0];
  return row ? { projectId: row.project_id, expiresAt: row.expires_at } : null;
}

/** Revokes every open token of a project (links and sessions). Returns how many were revoked. */
export async function revokeProjectTokens(db: Db, projectId: string, now: Date = new Date()): Promise<number> {
  const { rowCount } = await db.query("UPDATE precision_access_token SET revoked_at = $2 WHERE project_id = $1 AND revoked_at IS NULL", [projectId, now]);
  return rowCount ?? 0;
}

/** Mints a session directly (tests and operations tooling); the customer path is always the link exchange. */
export async function issueSessionToken(db: Db, projectId: string, now: Date = new Date(), ttlMs: number = DEFAULT_SESSION_TTL_MS): Promise<IssuedToken> {
  return insertToken(db, projectId, "session", ttlMs, now);
}
