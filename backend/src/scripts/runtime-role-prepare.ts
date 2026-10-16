/* eslint-disable no-console */
import { Pool } from "pg";

/**
 * Creates (or refreshes) the application's RUNTIME login role OUTSIDE the migrations, as a one-shot job run with the migration credential.
 * Idempotent. The role is a plain LOGIN member of `beeside_runtime_role` (migration 0014): no superuser, no DDL, no ownership, and no write
 * on the migration registry. It never prints the password and it only ever touches this one role in the database named by the URL.
 * Inputs: MIGRATION_DATABASE_URL (owner credential), RUNTIME_DB_PASSWORD (from Secret Manager), optional RUNTIME_DB_USER (default `beeside_runtime`).
 */
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;
const RESERVED = new Set(["postgres", "beeside_app", "beeside_runtime_role", "beeside_analytics_reader", "cloudsqlsuperuser", "cloudsqladmin"]);

async function main(): Promise<void> {
  const owner = process.env.MIGRATION_DATABASE_URL;
  const password = process.env.RUNTIME_DB_PASSWORD;
  const login = process.env.RUNTIME_DB_USER ?? "beeside_runtime";
  if (!owner || !password) throw new Error("MIGRATION_DATABASE_URL and RUNTIME_DB_PASSWORD are required");
  if (!/^[a-z][a-z0-9_]{2,40}$/.test(login) || RESERVED.has(login) || login.startsWith("pg_")) throw new Error("RUNTIME_DB_USER is not an acceptable runtime role name");
  if (password.length < 24) throw new Error("RUNTIME_DB_PASSWORD is too short");

  const pool = new Pool({ connectionString: owner, max: 1 });
  try {
    const exists = (await pool.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [login])).rowCount;
    const attrs = `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal(password)}`;
    await pool.query(exists ? `ALTER ROLE ${ident(login)} ${attrs}` : `CREATE ROLE ${ident(login)} ${attrs}`);
    if (!(await pool.query("SELECT 1 FROM pg_roles WHERE rolname = 'beeside_runtime_role'")).rowCount) throw new Error("beeside_runtime_role is missing: run the migrations first");
    await pool.query(`GRANT beeside_runtime_role TO ${ident(login)}`);
    const dbName = (await pool.query<{ d: string }>("SELECT current_database() AS d")).rows[0]!.d;
    await pool.query(`GRANT CONNECT ON DATABASE ${ident(dbName)} TO ${ident(login)}`);

    // verification: the role must be exactly what the application's privilege check demands
    const v = (await pool.query<{ superuser: boolean; member: boolean; owns: number; registry_write: boolean }>(
      `SELECT r.rolsuper AS superuser,
              pg_has_role($1, 'beeside_runtime_role', 'MEMBER') AS member,
              (SELECT count(*)::int FROM pg_class c WHERE c.relowner = r.oid) AS owns,
              has_table_privilege($1, 'drizzle.__drizzle_migrations', 'INSERT') AS registry_write
         FROM pg_roles r WHERE r.rolname = $1`, [login])).rows[0]!;
    if (v.superuser || !v.member || v.owns > 0 || v.registry_write) throw new Error(`runtime role verification failed: ${JSON.stringify(v)}`);
    console.log(JSON.stringify({ severity: "INFO", message: "runtime role ready", database: dbName, runtimeRole: login, created: !exists, member: v.member, superuser: v.superuser, owns: v.owns, registryWrite: v.registry_write }));
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => { console.error(JSON.stringify({ severity: "ERROR", message: "runtime role preparation failed", error: e instanceof Error ? e.message : String(e) })); process.exit(1); });
