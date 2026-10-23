/**
 * Data-domain isolation of the ONE canonical database shared by Discovery and Precision Center.
 *
 * `verifyDomainIsolation` is a READ-ONLY contract check, used by the deployment `prepare` job and by the automated isolation tests: it measures what the
 * Discovery runtime login can actually do against the declarative `db_domain_registry` (migration 0051) and what the Precision runtime login can no longer do
 * to Discovery's sealed records. `bindDomainRoles` is the idempotent EXPAND→MOVE→CONTRACT sequence the `prepare` job runs with the migration credential.
 * Neither prints a secret; both only touch the roles they are given.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export interface DomainCheck {
  check: string;
  ok: boolean;
  /** Offending object names (never data) when the check fails. */
  detail?: string[];
}

export const DISCOVERY_GROUP = "beeside_discovery_rw";
export const PRECISION_GROUP = "beeside_runtime_role";
const RESERVED = new Set(["postgres", "beeside_app", PRECISION_GROUP, DISCOVERY_GROUP, "beeside_analytics_reader", "cloudsqlsuperuser", "cloudsqladmin"]);

export const ident = (s: string): string => `"${s.replace(/"/g, '""')}"`;

export function assertLoginName(name: string, what: string): void {
  if (!/^[a-z][a-z0-9_]{2,40}$/.test(name) || RESERVED.has(name) || name.startsWith("pg_")) throw new Error(`${what} is not an acceptable login role name`);
}

export async function verifyDomainIsolation(db: Queryable, opts: { discoveryLogin: string; precisionLogin?: string }): Promise<DomainCheck[]> {
  const out: DomainCheck[] = [];
  const add = (check: string, offenders: string[]): void => { out.push(offenders.length ? { check, ok: false, detail: offenders } : { check, ok: true }); };
  const names = async (sql: string, params: unknown[] = []): Promise<string[]> => (await db.query<{ n: string }>(sql, params)).rows.map((r) => r.n);
  const login = opts.discoveryLogin;

  // 1. the registry covers every table (a new table is closed to Discovery until it is registered)
  add("every public table has a data domain", await names(
    `SELECT c.relname AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relkind IN ('r','p') AND NOT EXISTS (SELECT 1 FROM db_domain_registry d WHERE d.table_name = c.relname) ORDER BY 1`));
  add("every registered table exists", await names("SELECT d.table_name AS n FROM db_domain_registry d WHERE to_regclass(format('public.%I', d.table_name)) IS NULL ORDER BY 1"));

  // 2. Discovery login: identity and membership
  const flags = (await db.query<{ rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolreplication: boolean; rolbypassrls: boolean }>(
    "SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = $1", [login])).rows[0];
  if (!flags) throw new Error(`discovery login ${login} does not exist`);
  add("discovery login: not superuser, cannot create roles or databases, no replication, no RLS bypass",
    Object.entries(flags).filter(([, v]) => v).map(([k]) => k));
  add("discovery login: not a Cloud SQL superuser", await names(
    "SELECT r.rolname AS n FROM pg_roles r WHERE r.rolname = 'cloudsqlsuperuser' AND pg_has_role($1, r.oid, 'MEMBER')", [login]));
  add(`discovery login is a member of ${DISCOVERY_GROUP}`, (await db.query("SELECT pg_has_role($1, $2, 'MEMBER') AS m", [login, DISCOVERY_GROUP])).rows[0]!["m"] ? [] : [DISCOVERY_GROUP]);
  add(`discovery login is NOT a member of ${PRECISION_GROUP}`, (await db.query("SELECT pg_has_role($1, $2, 'MEMBER') AS m", [login, PRECISION_GROUP])).rows[0]!["m"] ? [PRECISION_GROUP] : []);
  add("discovery login owns no object", await names("SELECT c.relname AS n FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = $1", [login]));

  // 3. Discovery login: table privileges equal the registry EXACTLY (and nothing at column level on tables it must not touch)
  const rows = (await db.query<{ table_name: string; domain: string; discovery_privileges: string; priv: string; extra: boolean; col: boolean }>(
    `SELECT d.table_name, d.domain, d.discovery_privileges,
            concat(CASE WHEN has_table_privilege($1, c.oid, 'SELECT') THEN 'S' END, CASE WHEN has_table_privilege($1, c.oid, 'INSERT') THEN 'I' END,
                   CASE WHEN has_table_privilege($1, c.oid, 'UPDATE') THEN 'U' END, CASE WHEN has_table_privilege($1, c.oid, 'DELETE') THEN 'D' END) AS priv,
            (has_table_privilege($1, c.oid, 'TRUNCATE') OR has_table_privilege($1, c.oid, 'REFERENCES') OR has_table_privilege($1, c.oid, 'TRIGGER')) AS extra,
            has_any_column_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES') AS col
       FROM db_domain_registry d JOIN pg_class c ON c.relname = d.table_name AND c.relnamespace = 'public'::regnamespace ORDER BY d.table_name`, [login])).rows;
  add("discovery login: table privileges equal db_domain_registry exactly",
    rows.filter((r) => r.priv !== r.discovery_privileges).map((r) => `${r.table_name} has '${r.priv}' expected '${r.discovery_privileges}'`));
  add("discovery login: no TRUNCATE, REFERENCES or TRIGGER anywhere", rows.filter((r) => r.extra).map((r) => r.table_name));
  add("discovery login: no privilege at all (not even a column) on PRECISION-domain tables", rows.filter((r) => r.domain === "PRECISION" && (r.col || r.priv !== "")).map((r) => r.table_name));
  add("discovery login: cannot DELETE anywhere", rows.filter((r) => r.priv.includes("D")).map((r) => r.table_name));

  // 4. functions, sequences, schemas
  add("discovery login: cannot EXECUTE any SECURITY DEFINER function (e.g. the privacy executor)", await names(
    "SELECT p.proname AS n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND has_function_privilege($1, p.oid, 'EXECUTE') ORDER BY 1", [login]));
  add("discovery login: sequences only for tables it may INSERT into", await names(
    `SELECT s.relname AS n FROM pg_class s WHERE s.relkind = 'S' AND s.relnamespace = 'public'::regnamespace AND CASE WHEN s.relkind = 'S' THEN has_sequence_privilege($1, s.oid, 'USAGE,UPDATE') ELSE false END
        AND NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_class t ON t.oid = d.refobjid JOIN db_domain_registry r ON r.table_name = t.relname
                         WHERE d.objid = s.oid AND d.deptype IN ('a','i') AND r.discovery_privileges LIKE '%I%') ORDER BY 1`, [login]));
  add("discovery login: cannot CREATE in schema public, cannot create schemas or write the migration registry", await names(
    `SELECT x AS n FROM (VALUES ('create in public', has_schema_privilege($1, 'public', 'CREATE')),
                                  ('create schema', has_database_privilege($1, current_database(), 'CREATE')),
                                  ('write drizzle registry', COALESCE(has_table_privilege($1, to_regclass('drizzle.__drizzle_migrations'), 'INSERT,UPDATE,DELETE'), false))) v(x, bad) WHERE bad`, [login]));

  // 5. Precision login (optional): read-only on Discovery's records, not in the Discovery group
  if (opts.precisionLogin) {
    const p = opts.precisionLogin;
    const exists = (await db.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [p])).rows.length > 0;
    if (!exists) throw new Error(`precision login ${p} does not exist`);
    add(`precision login is a member of ${PRECISION_GROUP}`, (await db.query("SELECT pg_has_role($1, $2, 'MEMBER') AS m", [p, PRECISION_GROUP])).rows[0]!["m"] ? [] : [PRECISION_GROUP]);
    add(`precision login is NOT a member of ${DISCOVERY_GROUP}`, (await db.query("SELECT pg_has_role($1, $2, 'MEMBER') AS m", [p, DISCOVERY_GROUP])).rows[0]!["m"] ? [DISCOVERY_GROUP] : []);
    add("precision login: read-only on Discovery tables (no INSERT/UPDATE/DELETE/TRUNCATE) and can still read them", await names(
      `SELECT d.table_name AS n FROM db_domain_registry d JOIN pg_class c ON c.relname = d.table_name AND c.relnamespace = 'public'::regnamespace
        WHERE d.domain = 'DISCOVERY' AND (has_table_privilege($1, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE') OR NOT has_table_privilege($1, c.oid, 'SELECT')) ORDER BY 1`, [p]));
  }
  return out;
}

async function isMember(db: Queryable, group: string, login: string): Promise<boolean> {
  return (await db.query("SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles u ON u.oid = m.member WHERE g.rolname = $1 AND u.rolname = $2", [group, login])).rows.length > 0;
}

/**
 * EXPAND → MOVE → CONTRACT, idempotent, run with the migration/owner credential after the migrations:
 *  1. refresh the Discovery group's privileges from the registry (refuses while a table is unregistered);
 *  2. move the Discovery login out of the Precision group and into its own, and the Precision login (if given) into the Precision group only;
 *  3. only then close the Precision group's write access to Discovery's tables (the database function refuses if step 2 did not hold);
 *  4. verify. Returns the checks; the caller decides what to do with a failure.
 */
export async function bindDomainRoles(db: Queryable, opts: { discoveryLogin: string; precisionLogin?: string }): Promise<DomainCheck[]> {
  assertLoginName(opts.discoveryLogin, "DISCOVERY_RUNTIME_LOGIN");
  if (opts.precisionLogin) assertLoginName(opts.precisionLogin, "PRECISION_RUNTIME_LOGIN");
  if (opts.precisionLogin === opts.discoveryLogin) throw new Error("the Discovery and Precision runtime logins must be different roles");
  const roleExists = async (r: string): Promise<boolean> => (await db.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [r])).rows.length > 0;
  for (const g of [DISCOVERY_GROUP, PRECISION_GROUP]) if (!(await roleExists(g))) throw new Error(`${g} does not exist: run the migrations first`);
  if (!(await db.query("SELECT to_regprocedure('db_domain_apply_grants()') AS f")).rows[0]!["f"]) throw new Error("db_domain_apply_grants() is missing: run the migrations first (0051)");
  if (!(await roleExists(opts.discoveryLogin))) throw new Error(`discovery login ${opts.discoveryLogin} does not exist (the platform creates it with the Cloud SQL user)`);
  if (opts.precisionLogin && !(await roleExists(opts.precisionLogin))) throw new Error(`precision login ${opts.precisionLogin} does not exist (run the runtime role preparation first)`);

  await db.query("SELECT db_domain_apply_grants()");

  const d = ident(opts.discoveryLogin);
  // Cloud SQL users created through the API arrive with cloudsqlsuperuser membership, CREATEROLE and CREATEDB; the runtime login must have none of that.
  if ((await db.query("SELECT 1 FROM pg_roles r WHERE r.rolname = 'cloudsqlsuperuser' AND pg_has_role($1, r.oid, 'MEMBER')", [opts.discoveryLogin])).rows.length) {
    await db.query(`REVOKE cloudsqlsuperuser FROM ${d}`);
  }
  // only when needed: a migration role without CREATEROLE (the canonical `beeside_migrate`) cannot ALTER another role, and has no reason to
  if ((await db.query("SELECT 1 FROM pg_roles WHERE rolname = $1 AND (rolcreaterole OR rolcreatedb)", [opts.discoveryLogin])).rows.length) {
    await db.query(`ALTER ROLE ${d} NOCREATEROLE NOCREATEDB`);
  }
  await db.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await db.query(`REVOKE CREATE ON SCHEMA public FROM ${d}`);
  if ((await db.query("SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles u ON u.oid = m.member WHERE g.rolname = $1 AND u.rolname = $2", [PRECISION_GROUP, opts.discoveryLogin])).rows.length) {
    await db.query(`REVOKE ${ident(PRECISION_GROUP)} FROM ${d}`);
  }
  // GRANT only when the membership is missing: in the canonical database the memberships are granted by the admin connection (the migration role holds
  // no membership row in the groups on purpose, see canonical-provision.ts) and GRANT without ADMIN OPTION would be refused even for a no-op.
  if (!(await isMember(db, DISCOVERY_GROUP, opts.discoveryLogin))) await db.query(`GRANT ${ident(DISCOVERY_GROUP)} TO ${d}`);

  if (opts.precisionLogin) {
    const p = ident(opts.precisionLogin);
    if ((await db.query("SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles u ON u.oid = m.member WHERE g.rolname = $1 AND u.rolname = $2", [DISCOVERY_GROUP, opts.precisionLogin])).rows.length) {
      await db.query(`REVOKE ${ident(DISCOVERY_GROUP)} FROM ${p}`);
    }
    if (!(await isMember(db, PRECISION_GROUP, opts.precisionLogin))) await db.query(`GRANT ${ident(PRECISION_GROUP)} TO ${p}`);
  }

  await db.query("SELECT db_domain_close_precision_on_discovery($1)", [opts.discoveryLogin]);
  return verifyDomainIsolation(db, opts);
}
