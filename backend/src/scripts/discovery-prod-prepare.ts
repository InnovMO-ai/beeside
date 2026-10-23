/* eslint-disable no-console */
import { Pool } from "pg";
import { bindDomainRoles } from "../db/domain-isolation";

/**
 * PRODUCTION preparation step that runs right after the migrations, as the migration/owner role (job `discovery-prepare`). Idempotent.
 *
 * Two database models exist, and the job never guesses between them:
 *  - SHARED CANONICAL DATABASE (migrations 0050/0051 applied: `db_domain_registry` + group `beeside_discovery_rw`). The runtime login belongs ONLY to
 *    `beeside_discovery_rw`, which holds exactly what the registry lists (Discovery's 14 tables + the rate-limit counters). The job refreshes that group,
 *    moves the login out of the Precision group, closes Precision's write access to Discovery's tables, and VERIFIES the isolation contract (see
 *    `db/domain-isolation.ts`); it fails if the login could reach anything that belongs to Precision.
 *  - LEGACY DEDICATED DATABASE (only Discovery's own 24 migrations): the login joins `beeside_runtime_role`, as before. Allowed only with the explicit
 *    ALLOW_LEGACY_RUNTIME_GROUP=1, because that group reaches every table of a shared database.
 * Input: MIGRATION_DATABASE_URL (owner credential); RUNTIME_LOGIN_ROLE (default discovery_runtime); PRECISION_RUNTIME_LOGIN (optional, verified when given).
 * No secret is printed.
 */
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;

export interface PrepareReport { login: string; checks: Array<{ check: string; ok: boolean }> }

/** LEGACY dedicated-database model (Discovery's own migrations only). Kept for the existing database until it joins the shared lineage. */
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

/** Which model this database is in: the domain registry and the Discovery group exist only after the shared-lineage migrations 0050/0051. */
export async function databaseModel(pool: Pool): Promise<"shared" | "legacy"> {
  const r = await pool.query("SELECT to_regclass('public.db_domain_registry') IS NOT NULL AS reg, EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'beeside_discovery_rw') AS grp");
  return r.rows[0]!.reg && r.rows[0]!.grp ? "shared" : "legacy";
}

/** SHARED canonical database model: own group only, Precision closed on Discovery's tables, contract verified. */
export async function prepareDomainLogin(pool: Pool, login: string, precisionLogin?: string): Promise<PrepareReport> {
  const checks = await bindDomainRoles(pool, { discoveryLogin: login, ...(precisionLogin ? { precisionLogin } : {}) });
  return { login, checks };
}

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
  const login = process.env.RUNTIME_LOGIN_ROLE ?? "discovery_runtime";
  const precisionLogin = process.env.PRECISION_RUNTIME_LOGIN || undefined;
  const pool = new Pool({ connectionString: url });
  try {
    const model = await databaseModel(pool);
    if (model === "legacy" && process.env.ALLOW_LEGACY_RUNTIME_GROUP !== "1") {
      throw new Error("this database does not have the data-domain roles (migrations 0050/0051): the legacy runtime group reaches every table of a shared database. Migrate with the shared lineage first, or set ALLOW_LEGACY_RUNTIME_GROUP=1 for the dedicated Discovery-only database");
    }
    const report = model === "shared" ? await prepareDomainLogin(pool, login, precisionLogin) : await prepareRuntimeLogin(pool, login);
    for (const c of report.checks) console.log(JSON.stringify({ severity: c.ok ? "INFO" : "ERROR", message: `${c.ok ? "ok" : "FAILED"}: ${c.check}` }));
    if (report.checks.some((c) => !c.ok)) throw new Error(model === "shared" ? "the data-domain isolation contract does not hold" : "the runtime login violates the least-privilege contract");
    console.log(JSON.stringify({ severity: "INFO", message: "discovery runtime login prepared", login, model }));
  } finally { await pool.end(); }
}
if (require.main === module) main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
