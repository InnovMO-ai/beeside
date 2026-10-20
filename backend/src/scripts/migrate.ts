/* eslint-disable no-console */
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { inspectMigrationState, readJournal } from "./migration-state";
import { checkMigrationTarget, readTargetPolicy } from "./migration-target";

/**
 * Migration entry point for the deployment pipeline (Phase 13). It runs as its own job, with the
 * migration database user (MIGRATION_DATABASE_URL) — never with the runtime user, which has no
 * schema privileges. `--check` only verifies the state (read-only). It applies exactly the migrations committed in this build, with the same
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
    // Refuse before changing anything when this database applied a different numbering of the same migrations (the migrator would skip or misorder them).
    const state = await inspectMigrationState(pool, folder);
    console.log(JSON.stringify({ severity: "INFO", message: "migration state", expected: state.expected, applied: state.applied, pending: state.pending, safe: state.safe }));
    if (!state.safe) throw new Error(`unsafe migration state, nothing was applied: ${state.problems.join("; ")}`);
    // Refuse before changing anything when this database must not receive this build's newer migrations (e.g. the legacy `discovery` database).
    const database = (await pool.query<{ db: string }>("SELECT current_database() AS db")).rows[0]!.db;
    const target = checkMigrationTarget(readTargetPolicy(folder), database, readJournal(folder).map((e) => e.tag), state.pending, process.env.NODE_ENV === "production");
    console.log(JSON.stringify({ severity: target.ok ? "INFO" : "ERROR", message: "migration target", database, ceiling: target.ceiling === undefined ? "undeclared" : (target.ceiling ?? "none"), ok: target.ok }));
    if (!target.ok) throw new Error(`migration target refused, nothing was applied: ${target.problems.join("; ")}`);
    if (process.argv.includes("--check")) return; // read-only verification (deploy gate / operator check)
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
