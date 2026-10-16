import { Pool } from "pg";
import { provisionAdminUser } from "../admin/admin-users";
import { createPoolDb } from "../db/database";
import { recordAudit } from "../operations/audit";

/**
 * One-time FIRST SUPER_ADMIN of the Control Center for an environment that has none yet (the private production candidate).
 * It is the approved path that `provision-admin.ts` (development only) refuses to be: it runs as a gated Cloud Run job.
 *
 *   ADMIN_BOOTSTRAP_EMAIL=<work email on an allowed domain>  ADMIN_ALLOWED_EMAIL_DOMAINS=beeside.you  DATABASE_URL=...  node dist/scripts/admin-bootstrap.js
 *
 * It creates NO credential: the person signs in with the organization's Google identity (OIDC); this only authorizes that identity.
 * Safeguards: refuses when any active, login-enabled SUPER_ADMIN already exists (so it can never be used to add a second one or to take over),
 * refuses an email outside the allowed domains, runs in one transaction with an audit record, and prints no secret.
 */
export function domainAllowed(email: string, allowed: string): boolean {
  const domains = allowed.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  const at = email.lastIndexOf("@");
  return at > 0 && domains.length > 0 && domains.includes(email.slice(at + 1).toLowerCase());
}

export async function bootstrapFirstAdmin(pool: Pool, emailInput: string, allowed: string, now: Date): Promise<string> {
  const email = emailInput.trim().toLowerCase();
  if (!email) throw new Error("ADMIN_BOOTSTRAP_EMAIL is required");
  if (!domainAllowed(email, allowed)) throw new Error("the email is not on an allowed domain (ADMIN_ALLOWED_EMAIL_DOMAINS)");
  const db = createPoolDb(pool);
  const outcome = await db.transaction(async (tx) => {
    await tx.query("LOCK TABLE admin_user IN SHARE ROW EXCLUSIVE MODE");
    const existing = await tx.query<{ n: string }>("SELECT count(*)::text AS n FROM admin_user WHERE role = 'SUPER_ADMIN' AND active = true AND login_enabled = true");
    if (Number(existing.rows[0]?.n ?? "0") > 0) return undefined;
    const created = await provisionAdminUser(tx, { email, role: "SUPER_ADMIN" }, now);
    await recordAudit(tx, { actor: { type: "SYSTEM" }, action: "admin_user.bootstrapped", outcome: "ALLOWED", targetType: "admin_user", targetId: created.adminUserId, details: { role: created.role }, now });
    return created.adminUserId;
  });
  if (!outcome) throw new Error("refusing: an active SUPER_ADMIN already exists; further people are provisioned in the Control Center");
  return outcome;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const id = await bootstrapFirstAdmin(pool, process.env.ADMIN_BOOTSTRAP_EMAIL ?? "", process.env.ADMIN_ALLOWED_EMAIL_DOMAINS ?? "", new Date());
    console.log(`bootstrapped SUPER_ADMIN ${id} (identity binds on first Google sign-in)`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
