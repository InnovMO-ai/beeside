import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { ident, DISCOVERY_GROUP, PRECISION_GROUP } from "./domain-isolation";

/**
 * Provisioning plan for the ONE canonical database (`beeside`) shared by Discovery and Precision Center, on the same Cloud SQL instance as the legacy
 * `discovery` database. PURE planning + verification logic (no I/O of its own beyond the `Queryable` it is given): the CLI in
 * `scripts/canonical-db-provision.ts` runs it, the unit and integration tests exercise it against a simulated cluster.
 *
 * Roles are CLUSTER-GLOBAL in PostgreSQL, so the plan is built so that nothing it creates or changes can cut off the legacy `discovery` database:
 *  - three NEW logins (migrator, Discovery runtime, Precision runtime): the legacy `discovery_migrate` / `discovery_runtime` keep working untouched (rollback path);
 *  - the two NOLOGIN groups are only created when missing (never altered);
 *  - the migrator is NOCREATEROLE and NOT a Cloud SQL superuser: it owns `beeside` and everything in it, nothing else. It also holds NO membership row (not even an
 *    ADMIN-only one) in `beeside_runtime_role`: migrations 0016/0023/0040 treat "the executing role has a pg_auth_members row in beeside_runtime_role" as "this is the
 *    application", which would switch the privacy-erasure and anonymisation bypass OFF. Group memberships are therefore granted by the ADMIN connection, not the migrator;
 *  - two phases: PRE (groups, migrator, Discovery login, database, CONNECT) before the migrations; POST (Precision login, memberships) after them. The Precision login must
 *    not exist while 0014 runs, because 0014 grants `beeside_runtime_role` to a role named `beeside_runtime` and the migrator has no ADMIN on the group by design;
 *  - PUBLIC loses CONNECT on `beeside`; only the three logins get it. The legacy logins therefore cannot enter `beeside`.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export const ANALYTICS_READER = "beeside_analytics_reader";
export const LOGIN_RE = /^[a-z][a-z0-9_]{2,40}$/;
const FORBIDDEN = new Set(["postgres", "beeside_app", PRECISION_GROUP, DISCOVERY_GROUP, ANALYTICS_READER, "cloudsqlsuperuser", "cloudsqladmin", "discovery_migrate", "discovery_runtime", "public"]);
export const PASSWORD_MIN = 24;

export interface ProvisionConfig {
  database: string;
  sourceDatabase: string;
  migrator: string;
  discoveryLogin: string;
  precisionLogin: string;
  /** Legacy logins that must NOT be able to connect to the new database. */
  legacyLogins: string[];
}

export function defaultConfig(env: NodeJS.ProcessEnv = process.env): ProvisionConfig {
  const cfg: ProvisionConfig = {
    database: env.CANONICAL_DB ?? "beeside",
    sourceDatabase: env.SOURCE_DB ?? "discovery",
    migrator: env.MIGRATOR_LOGIN ?? "beeside_migrate",
    discoveryLogin: env.DISCOVERY_RUNTIME_LOGIN ?? "beeside_discovery_runtime",
    precisionLogin: env.PRECISION_RUNTIME_LOGIN ?? "beeside_runtime",
    legacyLogins: (env.LEGACY_LOGINS ?? "discovery_runtime,discovery_migrate").split(",").map((s) => s.trim()).filter(Boolean),
  };
  validateConfig(cfg);
  return cfg;
}

export function validateConfig(c: ProvisionConfig): void {
  for (const [what, v] of [["CANONICAL_DB", c.database], ["SOURCE_DB", c.sourceDatabase]] as const) {
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(v)) throw new Error(`${what} is not an acceptable database name`);
  }
  if (c.database === c.sourceDatabase) throw new Error("the canonical database must differ from the legacy one");
  if (["postgres", "template0", "template1"].includes(c.database)) throw new Error("CANONICAL_DB must not be a system database");
  const logins: Array<[string, string]> = [["MIGRATOR_LOGIN", c.migrator], ["DISCOVERY_RUNTIME_LOGIN", c.discoveryLogin], ["PRECISION_RUNTIME_LOGIN", c.precisionLogin]];
  for (const [what, v] of logins) {
    if (!LOGIN_RE.test(v) || FORBIDDEN.has(v) || v.startsWith("pg_")) throw new Error(`${what} is not an acceptable login role name`);
  }
  if (new Set(logins.map(([, v]) => v)).size !== 3) throw new Error("the migrator, Discovery runtime and Precision runtime logins must be three different roles");
}

export interface ProvisionState {
  admin: { name: string; superuser: boolean; createrole: boolean; createdb: boolean };
  /** role name -> does the admin connection hold ADMIN OPTION on it (or is superuser) */
  adminOn: Record<string, boolean>;
  rolesExisting: string[];
  databaseExists: boolean;
  sourceDatabase: { exists: boolean; encoding?: string; collate?: string; ctype?: string; provider?: string };
}

export async function gatherState(db: Queryable, cfg: ProvisionConfig): Promise<ProvisionState> {
  const me = (await db.query<{ n: string; s: boolean; cr: boolean; cd: boolean }>("SELECT r.rolname AS n, r.rolsuper AS s, r.rolcreaterole AS cr, r.rolcreatedb AS cd FROM pg_roles r WHERE r.rolname = current_user")).rows[0]!;
  const interesting = [PRECISION_GROUP, DISCOVERY_GROUP, ANALYTICS_READER, cfg.migrator, cfg.discoveryLogin, cfg.precisionLogin];
  const existing = (await db.query<{ n: string }>("SELECT rolname AS n FROM pg_roles WHERE rolname = ANY($1::text[])", [interesting])).rows.map((r) => r.n);
  const adminOn: Record<string, boolean> = {};
  for (const g of [PRECISION_GROUP, DISCOVERY_GROUP]) {
    if (!existing.includes(g)) { adminOn[g] = true; continue; }
    const r = (await db.query<{ a: boolean }>(
      `SELECT (r.rolsuper OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = g.oid AND m.admin_option AND pg_has_role(current_user, m.member, 'USAGE'))) AS a
         FROM pg_roles r, pg_roles g WHERE r.rolname = current_user AND g.rolname = $1`, [g])).rows[0];
    adminOn[g] = !!r?.a;
  }
  const dbExists = (await db.query("SELECT 1 FROM pg_database WHERE datname = $1", [cfg.database])).rows.length > 0;
  const src = (await db.query<{ enc: string; col: string; ct: string; prov: string }>(
    "SELECT pg_encoding_to_char(encoding) AS enc, datcollate AS col, datctype AS ct, datlocprovider::text AS prov FROM pg_database WHERE datname = $1", [cfg.sourceDatabase])).rows[0];
  return {
    admin: { name: me.n, superuser: me.s, createrole: me.cr, createdb: me.cd },
    adminOn, rolesExisting: existing, databaseExists: dbExists,
    sourceDatabase: src ? { exists: true, encoding: src.enc, collate: src.col, ctype: src.ct, provider: src.prov } : { exists: false },
  };
}

export type StepVia = "admin" | "legacy";
export type Phase = "pre" | "post";
export interface Step { id: string; description: string; via: StepVia; sql: string; secret?: boolean; /** run as this role (SET ROLE … / RESET ROLE): PostgreSQL only lets the OWNER revoke what the owner granted (a REVOKE by a non-owner admin is a silent no-op) */ asRole?: string }
export interface Plan { phase: Phase; steps: Step[]; blockers: string[]; notes: string[] }

const PW = (name: string): string => `{{PW:${name}}}`;
const attrs = (extra = ""): string => `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS${extra}`;

/** Builds the ordered, idempotent plan for one phase. Passwords appear only as `{{PW:name}}` tokens; `renderStep` substitutes them at execution time. */
export function buildPlan(cfg: ProvisionConfig, st: ProvisionState, phase: Phase = "pre"): Plan {
  validateConfig(cfg);
  const steps: Step[] = [];
  const blockers: string[] = [];
  const notes: string[] = [];
  const has = (r: string): boolean => st.rolesExisting.includes(r);
  const q = ident;
  const login = (label: string, name: string, pw: string): Step => ({
    id: `login:${name}`, description: `${has(name) ? "reset the attributes and password of" : "create"} the ${label} login ${name} (no superuser, no CREATEROLE, no CREATEDB)`,
    via: "admin", secret: true,
    // a managed (non-superuser) admin may not even "change" SUPERUSER / REPLICATION / BYPASSRLS (ALTER … NOSUPERUSER is refused): an existing login only gets the attributes it may touch;
    // `verify` measures the rest
    sql: has(name) ? `ALTER ROLE ${q(name)} LOGIN NOCREATEDB NOCREATEROLE PASSWORD ${PW(pw)}` : `CREATE ROLE ${q(name)} ${attrs(` PASSWORD ${PW(pw)}`)}`,
  });

  if (!st.admin.superuser && !(st.admin.createrole && st.admin.createdb)) blockers.push(`the admin connection (${st.admin.name}) needs CREATEROLE and CREATEDB (Cloud SQL: the postgres user)`);

  if (phase === "pre") {
    if (!st.sourceDatabase.exists) blockers.push(`the source database ${cfg.sourceDatabase} was not found (needed to copy encoding and collation)`);
    // 1. NOLOGIN groups: create only when missing, never alter
    for (const g of [PRECISION_GROUP, DISCOVERY_GROUP, ANALYTICS_READER]) {
      if (!has(g)) steps.push({ id: `group:${g}`, description: `create the NOLOGIN group ${g} (it does not exist yet)`, via: "admin", sql: `CREATE ROLE ${q(g)} NOLOGIN` });
      else notes.push(`${g} already exists: left untouched`);
    }
    // 2. migrator + Discovery runtime (SQL-created: NOT Cloud SQL superusers)
    steps.push(login("migration", cfg.migrator, "migrate"), login("Discovery runtime", cfg.discoveryLogin, "discovery_runtime"));
    // 3. database. Its privileges can only be changed by its OWNER (a REVOKE by the admin is a silent no-op), so the admin temporarily joins the migrator and acts AS it.
    if (st.databaseExists) notes.push(`database ${cfg.database} already exists: not recreated`);
    steps.push(joinOwner(cfg, st));
    if (!st.databaseExists && st.sourceDatabase.exists) {
      const s = st.sourceDatabase;
      steps.push({ id: "db:create", description: `create ${cfg.database} owned by ${cfg.migrator}, same encoding and collation as ${cfg.sourceDatabase} (${s.encoding}, ${s.collate})`, via: "admin",
        sql: `CREATE DATABASE ${q(cfg.database)} OWNER ${q(cfg.migrator)} TEMPLATE template0 ENCODING '${esc(s.encoding!)}' LC_COLLATE '${esc(s.collate!)}' LC_CTYPE '${esc(s.ctype!)}'` });
    }
    // 4. connect privileges: PUBLIC out, the logins in
    steps.push({ id: "db:revoke-public", description: `revoke the default PUBLIC privileges (CONNECT, TEMPORARY) on ${cfg.database}, as its owner`, via: "admin", asRole: cfg.migrator, sql: `REVOKE ALL ON DATABASE ${q(cfg.database)} FROM PUBLIC` });
    for (const l of [cfg.migrator, cfg.discoveryLogin]) steps.push({ id: `db:connect:${l}`, description: `grant CONNECT on ${cfg.database} to ${l}`, via: "admin", asRole: cfg.migrator, sql: `GRANT CONNECT ON DATABASE ${q(cfg.database)} TO ${q(l)}` });
    for (const l of cfg.legacyLogins) steps.push({ id: `db:no-connect:${l}`, description: `make sure the legacy login ${l} has no direct CONNECT on ${cfg.database}`, via: "admin", asRole: cfg.migrator, sql: `REVOKE ALL ON DATABASE ${q(cfg.database)} FROM ${q(l)}` });
    steps.push(leaveOwner(cfg, st));
  } else {
    // POST (after the migrations): the Precision login and the memberships. Granted by the ADMIN connection (or, for the legacy Precision group, by its creator).
    if (!st.databaseExists) blockers.push(`database ${cfg.database} does not exist: run the PRE phase and the migrations first`);
    steps.push(login("Precision runtime", cfg.precisionLogin, "runtime"));
    steps.push(joinOwner(cfg, st));
    steps.push({ id: `db:connect:${cfg.precisionLogin}`, description: `grant CONNECT on ${cfg.database} to ${cfg.precisionLogin}, as its owner`, via: "admin", asRole: cfg.migrator, sql: `GRANT CONNECT ON DATABASE ${q(cfg.database)} TO ${q(cfg.precisionLogin)}` });
    steps.push(leaveOwner(cfg, st));
    steps.push({ id: `member:${DISCOVERY_GROUP}`, description: `${cfg.discoveryLogin} joins ${DISCOVERY_GROUP} (and nothing else)`, via: st.adminOn[DISCOVERY_GROUP] ? "admin" : "legacy", sql: `GRANT ${q(DISCOVERY_GROUP)} TO ${q(cfg.discoveryLogin)}` });
    const viaP: StepVia = st.adminOn[PRECISION_GROUP] ? "admin" : "legacy";
    steps.push({ id: `member:${PRECISION_GROUP}`, description: `${cfg.precisionLogin} joins ${PRECISION_GROUP} (and nothing else)`, via: viaP, sql: `GRANT ${q(PRECISION_GROUP)} TO ${q(cfg.precisionLogin)}` });
    if (viaP === "legacy") notes.push(`${st.admin.name} holds no ADMIN OPTION on ${PRECISION_GROUP}: LEGACY_GROUP_ADMIN_URL (the role that created it, in production discovery_migrate) is required for this one grant`);
  }
  return { phase, steps, blockers, notes };
}

const joinOwner = (cfg: ProvisionConfig, st: ProvisionState): Step => ({ id: "owner:join", description: `temporary: ${st.admin.name} joins ${cfg.migrator} (needed to own-create the database and to change its privileges as owner)`, via: "admin", sql: `GRANT ${ident(cfg.migrator)} TO ${ident(st.admin.name)} WITH SET TRUE, INHERIT FALSE` });
const leaveOwner = (cfg: ProvisionConfig, st: ProvisionState): Step => ({ id: "owner:leave", description: `revoke the temporary membership of ${st.admin.name} in ${cfg.migrator}`, via: "admin", sql: `REVOKE ${ident(cfg.migrator)} FROM ${ident(st.admin.name)}` });

function esc(s: string): string {
  if (!/^[A-Za-z0-9_.@ -]+$/.test(s)) throw new Error("unexpected characters in a database setting");
  return s;
}

export const literal = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/**
 * PostgreSQL SCRAM-SHA-256 verifier. Sending the verifier instead of the clear password means a failed statement written to the server log
 * (log_min_error_statement defaults to ERROR) never contains the password itself.
 */
export function scramSha256(password: string, salt: Buffer = randomBytes(16), iterations = 4096): string {
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const hmac = (k: Buffer, m: string): Buffer => createHmac("sha256", k).update(m).digest();
  const stored = createHash("sha256").update(hmac(salted, "Client Key")).digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${stored.toString("base64")}:${hmac(salted, "Server Key").toString("base64")}`;
}

export function renderStep(step: Step, passwords: Record<string, string>): string {
  return step.sql.replace(/\{\{PW:([a-z_]+)\}\}/g, (_m, name: string) => {
    const p = passwords[name];
    if (!p || p.length < PASSWORD_MIN) throw new Error(`password "${name}" is missing or shorter than ${PASSWORD_MIN} characters`);
    return literal(scramSha256(p));
  });
}

export interface ProvisionCheck { check: string; ok: boolean; severity: "ERROR" | "WARN"; detail?: string[] }

/** READ-ONLY verification of the provisioned state (run by `verify` and after `apply`). `phase` "post" additionally checks the Precision login and the memberships. */
export async function verifyProvision(db: Queryable, cfg: ProvisionConfig, phase: Phase = "pre"): Promise<ProvisionCheck[]> {
  validateConfig(cfg);
  const out: ProvisionCheck[] = [];
  const add = (check: string, bad: string[], severity: "ERROR" | "WARN" = "ERROR"): void => { out.push(bad.length ? { check, ok: false, severity, detail: bad } : { check, ok: true, severity }); };
  const q = async (sql: string, p: unknown[] = []): Promise<string[]> => (await db.query<{ n: string }>(sql, p)).rows.map((r) => r.n);
  const logins = phase === "post" ? [cfg.migrator, cfg.discoveryLogin, cfg.precisionLogin] : [cfg.migrator, cfg.discoveryLogin];

  const db0 = (await db.query<{ owner: string }>("SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1", [cfg.database])).rows[0];
  add(`database ${cfg.database} exists and is owned by ${cfg.migrator}`, !db0 ? ["missing"] : db0.owner === cfg.migrator ? [] : [`owner is ${db0.owner}`]);
  if (!db0) return out;
  const src = (await db.query<{ same: boolean }>(
    `SELECT (n.datcollate = s.datcollate AND n.datctype = s.datctype AND n.encoding = s.encoding) AS same FROM pg_database n, pg_database s WHERE n.datname = $1 AND s.datname = $2`, [cfg.database, cfg.sourceDatabase])).rows[0];
  if (src) add(`database ${cfg.database} has the same encoding and collation as ${cfg.sourceDatabase}`, src.same ? [] : ["differs"]);

  for (const g of [PRECISION_GROUP, DISCOVERY_GROUP]) {
    add(`${g} exists and cannot log in`, await q("SELECT x AS n FROM (SELECT $1::text AS x) v WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1 AND NOT rolcanlogin)", [g]));
  }
  // privacy invariant (migrations 0016/0023/0040): the migration/owner role must have NO membership row in the application group, not even ADMIN-only
  add(`${cfg.migrator} has no membership row in ${PRECISION_GROUP} or ${DISCOVERY_GROUP} (privacy-erasure bypass depends on it)`, await q(
    "SELECT g.rolname AS n FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles u ON u.oid = m.member WHERE u.rolname = $1 AND g.rolname = ANY($2::text[])", [cfg.migrator, [PRECISION_GROUP, DISCOVERY_GROUP]]));
  for (const l of logins) {
    add(`${l}: can log in; not superuser, CREATEROLE, CREATEDB, replication or RLS-bypass; not a Cloud SQL superuser`, await q(
      `SELECT x AS n FROM (SELECT unnest(ARRAY[ CASE WHEN NOT r.rolcanlogin THEN 'cannot-login' END, CASE WHEN r.rolsuper THEN 'superuser' END, CASE WHEN r.rolcreaterole THEN 'createrole' END,
              CASE WHEN r.rolcreatedb THEN 'createdb' END, CASE WHEN r.rolreplication THEN 'replication' END, CASE WHEN r.rolbypassrls THEN 'bypassrls' END,
              CASE WHEN EXISTS (SELECT 1 FROM pg_roles s WHERE s.rolname = 'cloudsqlsuperuser' AND pg_has_role(r.oid, s.oid, 'MEMBER')) THEN 'cloudsqlsuperuser' END ]) x FROM pg_roles r WHERE r.rolname = $1) t WHERE x IS NOT NULL`, [l]));
    add(`${l} has CONNECT on ${cfg.database}`, (await db.query("SELECT has_database_privilege($1, $2, 'CONNECT') AS c", [l, cfg.database])).rows[0]!["c"] ? [] : [l]);
  }
  add(`PUBLIC has no privilege on ${cfg.database}`, (await db.query<{ n: string }>(
    `SELECT a.privilege_type AS n FROM pg_database d, aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a WHERE d.datname = $1 AND a.grantee = 0`, [cfg.database])).rows.map((r) => r.n));
  add(`legacy logins cannot connect to ${cfg.database}`, await q(
    "SELECT r.rolname AS n FROM pg_roles r WHERE r.rolname = ANY($1::text[]) AND has_database_privilege(r.oid, $2, 'CONNECT') AND NOT r.rolsuper", [cfg.legacyLogins, cfg.database]));
  if (phase === "post") {
    const member = async (u: string, g: string): Promise<boolean> => (await db.query("SELECT 1 FROM pg_auth_members m JOIN pg_roles gr ON gr.oid = m.roleid JOIN pg_roles ur ON ur.oid = m.member WHERE gr.rolname = $1 AND ur.rolname = $2", [g, u])).rows.length > 0;
    add(`${cfg.discoveryLogin} is a member of ${DISCOVERY_GROUP} only`, [
      ...(await member(cfg.discoveryLogin, DISCOVERY_GROUP) ? [] : [`missing ${DISCOVERY_GROUP}`]), ...(await member(cfg.discoveryLogin, PRECISION_GROUP) ? [`has ${PRECISION_GROUP}`] : [])]);
    add(`${cfg.precisionLogin} is a member of ${PRECISION_GROUP} only`, [
      ...(await member(cfg.precisionLogin, PRECISION_GROUP) ? [] : [`missing ${PRECISION_GROUP}`]), ...(await member(cfg.precisionLogin, DISCOVERY_GROUP) ? [`has ${DISCOVERY_GROUP}`] : [])]);
  }
  // WARN: the new logins reach the legacy database through PUBLIC CONNECT (its default) + the cluster-global Precision group
  add(`the new runtime logins cannot connect to the legacy database ${cfg.sourceDatabase} (it still grants CONNECT to PUBLIC)`, await q(
    "SELECT r.rolname AS n FROM pg_roles r WHERE r.rolname = ANY($1::text[]) AND has_database_privilege(r.oid, $2, 'CONNECT')", [logins.filter((l) => l !== cfg.migrator), cfg.sourceDatabase]), "WARN");
  return out;
}

/** Optional, separately gated and reversible hardening of the legacy database: only its own logins may connect. Runs through the connection of the legacy database's OWNER (an admin's REVOKE of an owner-granted privilege is a silent no-op). */
export function legacyHardeningSteps(cfg: ProvisionConfig, keep: string[]): Step[] {
  const steps: Step[] = [{ id: "legacy:revoke-public", description: `revoke CONNECT on ${cfg.sourceDatabase} from PUBLIC (rollback: GRANT CONNECT ON DATABASE ${cfg.sourceDatabase} TO PUBLIC)`, via: "legacy", sql: `REVOKE CONNECT ON DATABASE ${ident(cfg.sourceDatabase)} FROM PUBLIC` }];
  for (const l of keep) steps.push({ id: `legacy:connect:${l}`, description: `keep CONNECT on ${cfg.sourceDatabase} for ${l}`, via: "legacy", sql: `GRANT CONNECT ON DATABASE ${ident(cfg.sourceDatabase)} TO ${ident(l)}` });
  return steps;
}
