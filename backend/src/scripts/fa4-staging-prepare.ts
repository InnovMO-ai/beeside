/* eslint-disable no-console */
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { SEED_CATALOG } from "@beeside/fa-public-engine/seed";
import { createPoolDb } from "../db/database";
import { seedCatalogIfEmpty } from "../fa4/repository";

/**
 * INTERNAL STAGING preparation for FA Public v1.0 on a SHARED Cloud SQL instance (run as a one-shot Cloud Run job). Idempotent.
 *   1. creates the separate database (default `fa4_staging`) and a dedicated runtime LOGIN role — never touching other databases;
 *   2. applies the migrations to that database only;
 *   3. seeds the first PUBLISHED catalog version;
 *   4. gives the login role EXACTLY the table privileges of `beeside_runtime_role` (mirrored, not inherited): it cannot reach the legacy
 *      database through the group role, has no DELETE, and no UPDATE on the append-only tables.
 * Inputs: MIGRATION_DATABASE_URL (owner credentials of the shared instance), FA4_STAGING_RUNTIME_PASSWORD, optional FA4_STAGING_DB / FA4_STAGING_RUNTIME_USER.
 */
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;
// String replacement (not `new URL`): Cloud SQL socket URLs have an empty host (postgres://user:pw@/db?host=/cloudsql/…).
const withDatabase = (url: string, db: string) => {
  if (!/^postgres(?:ql)?:\/\/[^/]*\/[^?]*/.test(url)) throw new Error("unsupported database URL shape");
  return url.replace(/^(postgres(?:ql)?:\/\/[^/]*\/)[^?]*/, `$1${db}`);
};

async function main() {
  const owner = process.env.MIGRATION_DATABASE_URL;
  const password = process.env.FA4_STAGING_RUNTIME_PASSWORD;
  const db = process.env.FA4_STAGING_DB ?? "fa4_staging";
  const login = process.env.FA4_STAGING_RUNTIME_USER ?? "fa4_staging_runtime";
  if (!owner || !password) throw new Error("MIGRATION_DATABASE_URL and FA4_STAGING_RUNTIME_PASSWORD are required");
  if (!/^fa4_[a-z0-9_]+$/.test(db) || !/^fa4_[a-z0-9_]+$/.test(login)) throw new Error("database and role names must start with fa4_ (this job never touches other databases)");

  // 1 — database + login role (connected to the maintenance database `postgres`)
  const admin = new Pool({ connectionString: withDatabase(owner, "postgres") });
  try {
    if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [db])).rowCount) await admin.query(`CREATE DATABASE ${ident(db)}`);
    if ((await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [login])).rowCount) await admin.query(`ALTER ROLE ${ident(login)} LOGIN PASSWORD ${literal(password)}`);
    else await admin.query(`CREATE ROLE ${ident(login)} LOGIN PASSWORD ${literal(password)}`);
    await admin.query(`REVOKE ALL ON DATABASE ${ident(db)} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${ident(db)} TO ${ident(login)}`);
  } finally { await admin.end(); }

  // 2–4 — everything below happens inside the staging database only
  const url = withDatabase(owner, db);
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.resolve(__dirname, "../../db/migrations"), migrationsTable: "__drizzle_migrations", migrationsSchema: "drizzle" });
    const seeded = await seedCatalogIfEmpty(createPoolDb(pool), SEED_CATALOG);
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${ident(login)}`);
    await pool.query(`GRANT USAGE ON SCHEMA drizzle TO ${ident(login)}`);
    await pool.query(`GRANT SELECT ON drizzle.__drizzle_migrations TO ${ident(login)}`);
    await pool.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ident(login)}`);
    await pool.query(
      `DO $$ DECLARE r record; BEGIN
         FOR r IN SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'beeside_runtime_role' AND table_schema = 'public' LOOP
           EXECUTE format('GRANT %s ON public.%I TO %I', r.privilege_type, r.table_name, ${literal(login)});
         END LOOP; END $$`,
    );
    const priv = (await pool.query(
      `SELECT count(*) FILTER (WHERE privilege_type = 'DELETE' AND table_name LIKE 'fa4\\_%')::int AS deletes,
              count(*) FILTER (WHERE privilege_type = 'UPDATE' AND table_name IN ('fa4_result','fa4_catalog_version','fa4_catalog_change','fa4_legal_acceptance','fa4_privacy_erasure_log'))::int AS append_only_updates,
              count(*)::int AS grants
         FROM information_schema.role_table_grants WHERE grantee = $1 AND table_schema = 'public'`, [login])).rows[0];
    if (priv.deletes || priv.append_only_updates || !priv.grants) throw new Error(`unexpected runtime privileges: ${JSON.stringify(priv)}`);
    console.log(JSON.stringify({ severity: "INFO", message: "fa4 staging prepared", database: db, runtimeRole: login, catalogSeeded: seeded, grants: priv.grants }));
  } finally { await pool.end(); }
}
main().catch((e: unknown) => { console.error(JSON.stringify({ severity: "ERROR", message: "fa4 staging prepare failed", error: e instanceof Error ? e.message : String(e) })); process.exit(1); });
