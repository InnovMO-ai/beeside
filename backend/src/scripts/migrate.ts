/* eslint-disable no-console */
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/**
 * Migration entry point for the deployment pipeline (Phase 13). It runs as its own job, with the
 * migration database user (MIGRATION_DATABASE_URL) — never with the runtime user, which has no
 * schema privileges. It applies exactly the migrations committed in this build, with the same
 * registry table and hashes as `drizzle-kit migrate`; it never generates or pushes a schema.
 */
async function main() {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL (or DATABASE_URL) is required");
  if (process.env.MIGRATION_DATABASE_URL === undefined && process.env.NODE_ENV === "production") {
    throw new Error("production migrations run with MIGRATION_DATABASE_URL (the migration user), not the runtime credential");
  }
  const folder = path.resolve(__dirname, "../../db/migrations");
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(drizzle(pool), { migrationsFolder: folder, migrationsTable: "__drizzle_migrations", migrationsSchema: "drizzle" });
    const applied = await pool.query("SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations");
    console.log(JSON.stringify({ severity: "INFO", message: "migrations applied", applied: applied.rows[0]?.applied ?? null }));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ severity: "ERROR", message: "migration failed", error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
