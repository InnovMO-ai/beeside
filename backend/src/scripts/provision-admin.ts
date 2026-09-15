import { Pool } from "pg";
import { provisionAdminUser } from "../admin/admin-users";
import { createPoolDb } from "../db/database";
import { recordAudit } from "../operations/audit";

/**
 * Development-only provisioning of a person who may sign in to the Control Center:
 *   CONFIG_BOOTSTRAP_ENV=development npm run admin:provision --workspace=backend -- --development-only --email <work email> --role ADMIN|SUPERVISOR
 * Production users and roles are never created by a script; they are provisioned by an ADMIN in
 * the Control Center (or an approved process) once the organization's identity provider is chosen.
 */
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  if (process.env.CONFIG_BOOTSTRAP_ENV !== "development" || !process.argv.includes("--development-only") || process.env.NODE_ENV === "production") {
    throw new Error("refusing to run: set CONFIG_BOOTSTRAP_ENV=development and pass --development-only (never in production)");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const db = createPoolDb(pool);
    const now = new Date();
    const user = await db.transaction(async (tx) => {
      const created = await provisionAdminUser(tx, { email: arg("email"), role: arg("role") }, now);
      await recordAudit(tx, { actor: { type: "SYSTEM" }, action: "admin_user.provisioned", outcome: "ALLOWED", targetType: "admin_user", targetId: created.adminUserId, details: { role: created.role }, now });
      return created;
    });
    console.log(`provisioned ${user.role} ${user.adminUserId} (login enabled; identity binds on first sign-in)`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
