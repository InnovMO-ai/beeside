/* eslint-disable no-console */
import { Pool } from "pg";

/**
 * PRODUCTION preparation step that runs right after the migrations, as the migration/owner role (job `discovery-prepare`). Idempotent.
 *  1. makes the runtime LOGIN role (`RUNTIME_LOGIN_ROLE`, default discovery_runtime) a member of `beeside_runtime_role`, whose table privileges the migrations define
 *     (the production database is dedicated, so membership — not a mirrored copy — is the right mechanism);
 *  2. VERIFIES the least-privilege contract and fails the job if it does not hold: the runtime login can read/write what Discovery needs, cannot DELETE, cannot UPDATE the
 *     append-only tables, cannot create objects, is not a superuser and cannot create roles.
 * Input: MIGRATION_DATABASE_URL (owner credential). No secret is printed.
 */
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;

export interface PrepareReport { login: string; checks: Array<{ check: string; ok: boolean }> }

export async function prepareRuntimeLogin(pool: Pool, login: string): Promise<PrepareReport> {
  const role = await pool.query("SELECT rolname FROM pg_roles WHERE rolname = $1", [login]);
  if (!role.rowCount) throw new Error(`runtime login role ${login} does not exist (the platform creates it with the Cloud SQL user)`);
  const group = await pool.query("SELECT 1 FROM pg_roles WHERE rolname = 'beeside_runtime_role'");
  if (!group.rowCount) throw new Error("beeside_runtime_role does not exist: run the migrations first");
  await pool.query(`GRANT beeside_runtime_role TO ${ident(login)}`);
  // Cloud SQL users created through the API arrive with cloudsqlsuperuser membership, CREATEROLE and CREATEDB, and PUBLIC may create objects in `public`:
  // the runtime login must have none of that.
  await pool.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cloudsqlsuperuser') AND pg_has_role(${literal(login)}, 'cloudsqlsuperuser', 'MEMBER') THEN EXECUTE 'REVOKE cloudsqlsuperuser FROM ' || quote_ident(${literal(login)}); END IF; END $$`);
  // (NOSUPERUSER / NOREPLICATION / NOBYPASSRLS may only be changed by a true superuser, which Cloud SQL never gives us: they are verified below instead)
  await pool.query(`ALTER ROLE ${ident(login)} NOCREATEROLE NOCREATEDB`);
  await pool.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await pool.query(`REVOKE CREATE ON SCHEMA public FROM ${ident(login)}`);
  const priv = async (table: string, p: string) => (await pool.query("SELECT has_table_privilege($1, $2, $3) AS ok", [login, `public.${table}`, p])).rows[0]!.ok as boolean;
  const flags = (await pool.query("SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = $1", [login])).rows[0] as { rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolreplication: boolean; rolbypassrls: boolean };
  const checks = [
    { check: "can SELECT fa4_project", ok: await priv("fa4_project", "SELECT") },
    { check: "can INSERT fa4_project", ok: await priv("fa4_project", "INSERT") },
    { check: "can UPDATE fa4_project", ok: await priv("fa4_project", "UPDATE") },
    { check: "can INSERT fa4_result (sealing)", ok: await priv("fa4_result", "INSERT") },
    { check: "cannot UPDATE fa4_result (append-only)", ok: !(await priv("fa4_result", "UPDATE")) },
    { check: "cannot DELETE fa4_result", ok: !(await priv("fa4_result", "DELETE")) },
    { check: "cannot DELETE fa4_project", ok: !(await priv("fa4_project", "DELETE")) },
    { check: "cannot UPDATE fa4_privacy_erasure_log (append-only)", ok: !(await priv("fa4_privacy_erasure_log", "UPDATE")) },
    { check: "cannot UPDATE fa4_legal_acceptance (append-only)", ok: !(await priv("fa4_legal_acceptance", "UPDATE")) },
    { check: "cannot CREATE in schema public", ok: !(await pool.query("SELECT has_schema_privilege($1, 'public', 'CREATE') AS ok", [login])).rows[0]!.ok },
    { check: "not superuser / cannot create roles or databases / no replication / no RLS bypass", ok: !flags.rolsuper && !flags.rolcreaterole && !flags.rolcreatedb && !flags.rolreplication && !flags.rolbypassrls },
  ];
  return { login, checks };
}

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
  const login = process.env.RUNTIME_LOGIN_ROLE ?? "discovery_runtime";
  const pool = new Pool({ connectionString: url });
  try {
    const report = await prepareRuntimeLogin(pool, login);
    for (const c of report.checks) console.log(JSON.stringify({ severity: c.ok ? "INFO" : "ERROR", message: `${c.ok ? "ok" : "FAILED"}: ${c.check}` }));
    if (report.checks.some((c) => !c.ok)) throw new Error("the runtime login violates the least-privilege contract");
    console.log(JSON.stringify({ severity: "INFO", message: "discovery runtime login prepared", login }));
  } finally { await pool.end(); }
}
if (require.main === module) main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
