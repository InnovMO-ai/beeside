import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { bindDomainRoles, verifyDomainIsolation, DISCOVERY_GROUP, PRECISION_GROUP } from "../db/domain-isolation";

/**
 * DATA-DOMAIN ISOLATION of the one canonical database (migrations 0050/0051). Runs against a real migrated database with the OWNER credential
 * (TEST_DATABASE_URL). Every test runs inside a transaction that is rolled back — roles, grants and tables included — so nothing is left behind.
 * Behaviour is exercised by really switching to the login (SET LOCAL ROLE) and attempting the statements an attacker or a bug would attempt.
 */
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("data-domain isolation (real migrated database, rolled back)", () => {
  const client = new Client({ connectionString: url });
  let discovery = "";
  let precision = "";

  beforeAll(async () => { await client.connect(); });
  afterAll(async () => { await client.end(); });
  beforeEach(async () => {
    const tag = randomUUID().slice(0, 8);
    discovery = `iso_disc_${tag}`;
    precision = `iso_prec_${tag}`;
    await client.query("BEGIN");
    await client.query(`CREATE ROLE ${discovery} LOGIN`);
    await client.query(`CREATE ROLE ${precision} LOGIN`);
    // the situation of the real database before the move: both logins sit in the single legacy runtime group
    await client.query(`GRANT ${PRECISION_GROUP} TO ${discovery}`);
    await client.query(`GRANT ${PRECISION_GROUP} TO ${precision}`);
    await client.query(`GRANT ${discovery} TO CURRENT_USER WITH SET TRUE`).catch(() => undefined);
    await client.query(`GRANT ${precision} TO CURRENT_USER WITH SET TRUE`).catch(() => undefined);
  });
  afterEach(async () => { await client.query("ROLLBACK"); });

  /** Runs one statement as the given login inside a savepoint, so a denial does not abort the surrounding transaction. */
  async function as(login: string, sql: string, params: unknown[] = []): Promise<{ ok: boolean; code?: string }> {
    await client.query("SAVEPOINT s");
    try {
      await client.query(`SET LOCAL ROLE ${login}`);
      await client.query(sql, params);
      await client.query("RESET ROLE");
      await client.query("RELEASE SAVEPOINT s");
      return { ok: true };
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT s");
      await client.query("RESET ROLE");
      return { ok: false, code: (e as { code?: string }).code };
    }
  }

  const registry = async (): Promise<Array<{ table_name: string; domain: string; discovery_privileges: string }>> =>
    (await client.query("SELECT table_name, domain, discovery_privileges FROM db_domain_registry ORDER BY table_name")).rows;

  it("registers every table exactly once and agrees with the privacy inventory (a new table cannot slip past either)", async () => {
    const tables = (await client.query("SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') ORDER BY 1")).rows.map((r) => r.relname as string);
    const reg = (await registry()).map((r) => r.table_name);
    expect(reg).toEqual(tables);
    const privacy = (await client.query("SELECT table_name FROM privacy_erasure_registry ORDER BY 1")).rows.map((r) => r.table_name as string);
    expect(privacy).toEqual(tables);
    const byDomain = (await registry()).reduce<Record<string, number>>((m, r) => ({ ...m, [r.domain]: (m[r.domain] ?? 0) + 1 }), {});
    expect(byDomain).toEqual({ DISCOVERY: 14, PLATFORM: 1, PRECISION: tables.length - 15 });
    // the registry only ever lists the privileges Discovery truly needs: no DELETE, and the sealed/append-only records are insert-only
    for (const r of await registry()) expect(r.discovery_privileges).not.toContain("D");
    const priv = Object.fromEntries((await registry()).map((r) => [r.table_name, r.discovery_privileges]));
    for (const t of ["fa4_result", "fa4_legal_acceptance", "fa4_event", "fa4_marketing_consent", "fa4_privacy_erasure_log"]) expect(priv[t]).toBe("SI");
    expect(priv["rate_limit_counter"]).toBe("SIU");
  });

  it("binding the logins produces a contract that holds on every check, and is idempotent", async () => {
    const first = await bindDomainRoles(client, { discoveryLogin: discovery, precisionLogin: precision });
    expect(first.filter((c) => !c.ok)).toEqual([]);
    expect(first.length).toBeGreaterThanOrEqual(17);
    const second = await bindDomainRoles(client, { discoveryLogin: discovery, precisionLogin: precision });
    expect(second.filter((c) => !c.ok)).toEqual([]);
  });

  it("the Discovery login reaches NOTHING that belongs to Precision: not one table, not even a SELECT, and 42501 (not a missing-table error) for each", async () => {
    await bindDomainRoles(client, { discoveryLogin: discovery, precisionLogin: precision });
    const precisionTables = (await registry()).filter((r) => r.domain === "PRECISION").map((r) => r.table_name);
    expect(precisionTables.length).toBeGreaterThan(80);
    const leaked: string[] = [];
    for (const t of precisionTables) {
      const r = await as(discovery, `SELECT 1 FROM public.${t} LIMIT 0`);
      if (r.ok || r.code !== "42501") leaked.push(`${t}:${r.code ?? "allowed"}`);
    }
    expect(leaked).toEqual([]);
    for (const sql of [
      "SELECT * FROM admin_user", "SELECT * FROM admin_session", "UPDATE entitlement SET premium_access_active = true",
      "INSERT INTO subscription (subscription_id) VALUES (gen_random_uuid())", "SELECT * FROM knowledge_document", "SELECT * FROM project", "SELECT * FROM db_domain_registry",
      "UPDATE db_domain_registry SET domain = 'DISCOVERY'", "INSERT INTO project_origin DEFAULT VALUES",
    ]) expect(await as(discovery, sql)).toEqual({ ok: false, code: "42501" });
  });

  it("the Discovery login cannot run the privacy executor or any other SECURITY DEFINER function, cannot delete, truncate or create objects", async () => {
    await bindDomainRoles(client, { discoveryLogin: discovery, precisionLogin: precision });
    expect(await as(discovery, "SELECT privacy_erase_project($1::uuid, 'x', false, now())", [randomUUID()])).toEqual({ ok: false, code: "42501" });
    expect(await as(discovery, "SELECT fa4_anonymize_project($1::uuid, 'x', 'x')", [randomUUID()])).toEqual({ ok: false, code: "42501" });
    for (const sql of ["DELETE FROM fa4_project", "TRUNCATE fa4_project", "DELETE FROM rate_limit_counter", "UPDATE fa4_result SET model = model",
      "DELETE FROM fa4_catalog_entity", "CREATE TABLE public.iso_probe (x int)", "CREATE SCHEMA iso_probe"]) {
      const r = await as(discovery, sql);
      expect({ sql, ...r }).toEqual({ sql, ok: false, code: "42501" });
    }
  });

  it("the Discovery login still does its own job: creates and updates its projects, appends sealed evidence, counts rate-limit hits", async () => {
    await bindDomainRoles(client, { discoveryLogin: discovery, precisionLogin: precision });
    const email = `iso.${randomUUID().slice(0, 8)}@beeside.you`;
    expect(await as(discovery, "INSERT INTO fa4_project (email, locale, answers, step_key) VALUES ($1, 'es', '{}'::jsonb, 'x')", [email])).toEqual({ ok: true });
    expect(await as(discovery, "UPDATE fa4_project SET step_key = 'y' WHERE email = $1", [email])).toEqual({ ok: true });
    expect(await as(discovery, "SELECT count(*) FROM fa4_catalog_version")).toEqual({ ok: true });
    expect(await as(discovery, `INSERT INTO rate_limit_counter (bucket_key, window_start, policy, hits, max_hits, expires_at) VALUES ($1, now(), 'iso_policy', 1, 10, now() + interval '1 hour')
                                ON CONFLICT (bucket_key, window_start) DO UPDATE SET hits = rate_limit_counter.hits + 1`, [`iso_policy:${randomUUID().replace(/-/g, "").repeat(2)}`])).toEqual({ ok: true });
    expect(await as(discovery, "SELECT count(*) FROM drizzle.__drizzle_migrations")).toEqual({ ok: true });
  });

  it("the Precision login keeps its domain but can no longer write Discovery's records; it can still read them and run the privacy executor", async () => {
    await bindDomainRoles(client, { discoveryLogin: discovery, precisionLogin: precision });
    expect(await as(precision, "SELECT count(*) FROM fa4_project")).toEqual({ ok: true });
    expect(await as(precision, "SELECT count(*) FROM fa4_result")).toEqual({ ok: true });
    expect(await as(precision, "SELECT count(*) FROM admin_user")).toEqual({ ok: true });
    for (const sql of ["INSERT INTO fa4_project (email, locale, answers, step_key) VALUES ('p@beeside.you', 'es', '{}'::jsonb, 'x')", "UPDATE fa4_project SET step_key = 'z'", "DELETE FROM fa4_event", "TRUNCATE fa4_result",
      "INSERT INTO db_domain_registry (table_name, domain) VALUES ('zz', 'PRECISION')", "UPDATE db_domain_registry SET domain = 'DISCOVERY'"]) {
      const r = await as(precision, sql);
      expect({ sql, ...r }).toEqual({ sql, ok: false, code: "42501" });
    }
    expect((await client.query("SELECT has_function_privilege($1, 'privacy_erase_project(uuid,text,boolean,timestamptz)', 'EXECUTE') AS e", [precision])).rows[0]!.e).toBe(true);
  });

  it("the contract step refuses while the Discovery login is still in the Precision group (nobody is cut off by the order of operations)", async () => {
    await client.query("SELECT db_domain_apply_grants()");
    await client.query("SAVEPOINT g");
    await expect(client.query("SELECT db_domain_close_precision_on_discovery($1)", [discovery])).rejects.toThrow(/not a member of beeside_discovery_rw/);
    await client.query("ROLLBACK TO SAVEPOINT g");
    await client.query(`GRANT ${DISCOVERY_GROUP} TO ${discovery}`);
    await client.query("SAVEPOINT g");
    await expect(client.query("SELECT db_domain_close_precision_on_discovery($1)", [discovery])).rejects.toThrow(/still a member of beeside_runtime_role/);
    await client.query("ROLLBACK TO SAVEPOINT g");
    // while the legacy membership exists, Discovery's own writes still work through the old group: the expand step changed nothing for it
    expect(await as(discovery, "INSERT INTO fa4_project (email, locale, answers, step_key) VALUES ('legacy@beeside.you', 'es', '{}'::jsonb, 'x')")).toEqual({ ok: true });
    await client.query("SAVEPOINT g");
    await expect(client.query("SELECT db_domain_close_precision_on_discovery('no_such_login')")).rejects.toThrow(/does not exist/);
    await client.query("ROLLBACK TO SAVEPOINT g");
  });

  it("a NEW table is closed to Discovery by default, and the grant step refuses until the table declares its domain", async () => {
    await bindDomainRoles(client, { discoveryLogin: discovery, precisionLogin: precision });
    await client.query("CREATE TABLE public.iso_new_table (id int)");
    await client.query("GRANT SELECT, INSERT, UPDATE ON public.iso_new_table TO beeside_runtime_role"); // what the legacy default privileges give any new table
    expect(await as(discovery, "SELECT 1 FROM iso_new_table")).toEqual({ ok: false, code: "42501" });
    const unreg = await verifyDomainIsolation(client, { discoveryLogin: discovery, precisionLogin: precision });
    expect(unreg.find((c) => c.check === "every public table has a data domain")).toEqual({ check: "every public table has a data domain", ok: false, detail: ["iso_new_table"] });
    await client.query("SAVEPOINT g");
    await expect(client.query("SELECT db_domain_apply_grants()")).rejects.toThrow(/tables without a data domain: iso_new_table/);
    await client.query("ROLLBACK TO SAVEPOINT g");
    await client.query("INSERT INTO db_domain_registry (table_name, domain) VALUES ('iso_new_table', 'PRECISION')");
    await client.query("SELECT db_domain_apply_grants()");
    expect(await as(discovery, "SELECT 1 FROM iso_new_table")).toEqual({ ok: false, code: "42501" });
    const reg = await verifyDomainIsolation(client, { discoveryLogin: discovery, precisionLogin: precision });
    expect(reg.filter((c) => !c.ok)).toEqual([]);
  });

  it("the verification DETECTS a broken contract (a leaked table grant, a column grant, the legacy group, a sealed-record update)", async () => {
    await bindDomainRoles(client, { discoveryLogin: discovery, precisionLogin: precision });
    const failing = async () => (await verifyDomainIsolation(client, { discoveryLogin: discovery, precisionLogin: precision })).filter((c) => !c.ok).map((c) => c.check);
    expect(await failing()).toEqual([]);
    await client.query(`GRANT SELECT ON admin_user TO ${discovery}`);
    expect(await failing()).toEqual(expect.arrayContaining([expect.stringContaining("equal db_domain_registry exactly"), expect.stringContaining("no privilege at all")]));
    await client.query(`REVOKE SELECT ON admin_user FROM ${discovery}`);
    await client.query(`GRANT SELECT (auth_identity) ON admin_user TO ${discovery}`);
    expect(await failing()).toEqual(expect.arrayContaining([expect.stringContaining("no privilege at all")]));
    await client.query(`REVOKE SELECT (auth_identity) ON admin_user FROM ${discovery}`);
    await client.query(`GRANT UPDATE ON fa4_result TO ${discovery}`);
    expect(await failing()).toEqual(expect.arrayContaining([expect.stringContaining("equal db_domain_registry exactly")]));
    await client.query(`REVOKE UPDATE ON fa4_result FROM ${discovery}`);
    await client.query(`GRANT ${PRECISION_GROUP} TO ${discovery}`);
    expect(await failing()).toEqual(expect.arrayContaining([expect.stringContaining("NOT a member of beeside_runtime_role")]));
    await client.query(`REVOKE ${PRECISION_GROUP} FROM ${discovery}`);
    await client.query(`GRANT EXECUTE ON FUNCTION privacy_erase_project(uuid,text,boolean,timestamptz) TO ${discovery}`);
    expect(await failing()).toEqual(expect.arrayContaining([expect.stringContaining("SECURITY DEFINER")]));
    await client.query(`REVOKE EXECUTE ON FUNCTION privacy_erase_project(uuid,text,boolean,timestamptz) FROM ${discovery}`);
    await client.query(`GRANT INSERT ON fa4_project TO ${precision}`);
    expect(await failing()).toEqual(expect.arrayContaining([expect.stringContaining("precision login: read-only on Discovery tables")]));
  });
});
