import { Db } from "../db/database";
import { FaError } from "../fa/services/errors";
import { isValidEmail, normalizeEmail } from "../fa/services/normalize";
import { revokeAllAdminSessions } from "./admin-session";
import { AdminRole, isAdminRole } from "./rbac";

/**
 * Admin user management. People are provisioned explicitly (never self-registered and never
 * created from an identity-provider login). Technical identities (…@beeside.internal, such as the
 * development configuration bootstrap actor) can never be given sign-in. No production users are
 * created by any script or migration.
 */
export interface AdminUserView {
  adminUserId: string;
  email: string;
  role: AdminRole;
  active: boolean;
  loginEnabled: boolean;
  identityBound: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface AdminUserRow {
  admin_user_id: string;
  auth_identity: string;
  role: AdminRole;
  active: boolean;
  login_enabled: boolean;
  auth_subject: string | null;
  last_login_at: Date | null;
  created_at: Date;
}

const view = (r: AdminUserRow): AdminUserView => ({
  adminUserId: r.admin_user_id,
  email: r.auth_identity,
  role: r.role,
  active: r.active,
  loginEnabled: r.login_enabled,
  identityBound: r.auth_subject !== null,
  lastLoginAt: r.last_login_at?.toISOString() ?? null,
  createdAt: r.created_at.toISOString(),
});

export async function listAdminUsers(db: Db): Promise<AdminUserView[]> {
  const { rows } = await db.query<AdminUserRow>(
    "SELECT admin_user_id, auth_identity, role, active, login_enabled, auth_subject, last_login_at, created_at FROM admin_user ORDER BY login_enabled DESC, auth_identity",
  );
  return rows.map(view);
}

export async function provisionAdminUser(db: Db, input: { email: unknown; role: unknown }, now: Date): Promise<AdminUserView> {
  const email = typeof input.email === "string" ? normalizeEmail(input.email) : "";
  if (!isValidEmail(email)) throw new FaError("INVALID_INPUT", "a valid work email is required", { fields: ["email"] });
  if (email.endsWith("@beeside.internal")) throw new FaError("INVALID_INPUT", "technical identities cannot sign in", { fields: ["email"] });
  if (!isAdminRole(input.role)) throw new FaError("INVALID_INPUT", "role must be ADMIN or SUPERVISOR", { fields: ["role"] });
  const existing = await db.query<AdminUserRow>("SELECT admin_user_id, auth_identity, role, active, login_enabled, auth_subject, last_login_at, created_at FROM admin_user WHERE auth_identity = $1", [email]);
  if (existing.rows[0]) throw new FaError("NOT_APPLICABLE", "this person is already provisioned");
  const { rows } = await db.query<AdminUserRow>(
    `INSERT INTO admin_user (role, auth_identity, active, login_enabled, created_at, updated_at) VALUES ($1, $2, true, true, $3, $3)
     RETURNING admin_user_id, auth_identity, role, active, login_enabled, auth_subject, last_login_at, created_at`,
    [input.role, email, now],
  );
  return view(rows[0] as AdminUserRow);
}

/**
 * Changes a person's role or active flag. An admin cannot demote or deactivate themselves, and
 * the database refuses to leave no active login-enabled ADMIN. Any change ends the person's sessions.
 */
export async function updateAdminUser(
  db: Db,
  actorAdminUserId: string,
  targetId: string,
  input: { role?: unknown; active?: unknown },
  now: Date,
): Promise<{ user: AdminUserView; before: AdminUserView; sessionsRevoked: number }> {
  if (input.role !== undefined && !isAdminRole(input.role)) throw new FaError("INVALID_INPUT", "role must be ADMIN or SUPERVISOR", { fields: ["role"] });
  if (input.active !== undefined && typeof input.active !== "boolean") throw new FaError("INVALID_INPUT", "active must be true or false", { fields: ["active"] });
  if (targetId === actorAdminUserId) throw new FaError("NOT_APPLICABLE", "you cannot change your own role or access");
  const current = await db.query<AdminUserRow>(
    "SELECT admin_user_id, auth_identity, role, active, login_enabled, auth_subject, last_login_at, created_at FROM admin_user WHERE admin_user_id = $1 FOR UPDATE",
    [targetId],
  );
  const before = current.rows[0];
  if (!before || !before.login_enabled) throw new FaError("NOT_FOUND", "admin user not found");
  const role = (input.role as AdminRole | undefined) ?? before.role;
  const active = (input.active as boolean | undefined) ?? before.active;
  try {
    const { rows } = await db.query<AdminUserRow>(
      `UPDATE admin_user SET role = $2, active = $3, updated_at = $4 WHERE admin_user_id = $1
       RETURNING admin_user_id, auth_identity, role, active, login_enabled, auth_subject, last_login_at, created_at`,
      [targetId, role, active, now],
    );
    const changed = role !== before.role || active !== before.active;
    const sessionsRevoked = changed ? await revokeAllAdminSessions(db, targetId, "admin_user_changed", now) : 0;
    return { user: view(rows[0] as AdminUserRow), before: view(before), sessionsRevoked };
  } catch (error) {
    if ((error as { code?: string }).code === "BV409") throw new FaError("NOT_APPLICABLE", "the last active ADMIN cannot be demoted or deactivated");
    throw error;
  }
}
