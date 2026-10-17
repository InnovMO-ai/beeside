import { randomUUID } from "node:crypto";
import { Pool } from "pg";

/**
 * F1 + F2 against REAL PostgreSQL with the ACTUAL application logins (migrations 0052 and 0053).
 *   TEST_RUNTIME_ADMIN_DATABASE_URL  owner / migration role (the authorised operator)
 *   TEST_RUNTIME_DATABASE_URL        a LOGIN role of the Discovery application: in the shared canonical database it belongs ONLY to beeside_discovery_rw
 *                                    (in a legacy dedicated database: to beeside_runtime_role). Use a dedicated database: data is committed.
 */
const adminUrl = process.env.TEST_RUNTIME_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL;
const describeRt = adminUrl && runtimeUrl ? describe : describe.skip;

describeRt("privacy guards — the erasure bypass is closed to the application, the migrator can still erase, an erased project stays erased", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const rt = new Pool({ connectionString: runtimeUrl, max: 2 });
  const q = async (sql: string, v: unknown[] = []) => (await admin.query(sql, v)).rows;
  const version = `pg-${randomUUID().slice(0, 8)}`;

  async function delivered(): Promise<string> {
    const id = randomUUID();
    const c = await admin.connect();
    try {
      await c.query("BEGIN");
      await c.query("INSERT INTO fa4_project (project_id, email, locale, step_key, answers, status) VALUES ($1, $2, 'es', 'S1', '{\"secret\":\"canary\"}', 'DELIVERED')", [id, `pg.${id}@verify.example`]);
      await c.query("INSERT INTO fa4_result (project_id, catalog_version, model, rules_version, source_schema_version, source_snapshot, resolution_schema_version, resolution_snapshot) VALUES ($1, $2, '{\"canary\":true}', 'r1', 1, '{\"canary\":true}', 1, '{\"canary\":true}')", [id, version]);
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
    return id;
  }
  async function inProgress(): Promise<string> {
    const id = randomUUID();
    await q("INSERT INTO fa4_project (project_id, email, locale, step_key, answers, status) VALUES ($1, $2, 'es', 'S1', '{\"secret\":\"canary\"}', 'IN_PROGRESS')", [id, `pg.${id}@verify.example`]);
    return id;
  }
  const erase = (id: string) => q("SELECT fa4_anonymize_project($1::uuid, 'integration-test', 'privacy guards test')", [id]);
  async function asRuntime(sql: string, v: unknown[] = []): Promise<void> {
    const c = await rt.connect();
    try { await c.query("BEGIN"); await c.query(sql, v); await c.query("COMMIT"); } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  }

  beforeAll(async () => {
    await q("INSERT INTO fa4_catalog_version (version, content) VALUES ($1, '{}') ON CONFLICT DO NOTHING", [version]);
  });
  afterAll(async () => { await admin.end(); await rt.end(); });

  it("the Discovery application login cannot open the erasure bypass on a DELIVERED project (BV604) — whichever group it belongs to", async () => {
    const id = await delivered();
    const who = await (async () => { const c = await rt.connect(); try { return (await c.query("SELECT current_user AS u")).rows[0].u as string; } finally { c.release(); } })();
    const direct = (await q(`SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member WHERE u.rolname = $1`, [who])).map((r) => r.rolname as string);
    expect(direct.some((g) => g === "beeside_runtime_role" || g === "beeside_discovery_rw")).toBe(true); // it is an application login, not an operator
    const c = await rt.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('fa4.erasure', 'on', true)");
      await expect(c.query("UPDATE fa4_project SET answers = '{\"x\":1}' WHERE project_id = $1", [id])).rejects.toMatchObject({ code: "BV604" });
    } finally { await c.query("ROLLBACK"); c.release(); }
    expect((await q("SELECT answers FROM fa4_project WHERE project_id = $1", [id]))[0].answers).toEqual({ secret: "canary" });
  });

  it("the Discovery application login does not gain membership of the Precision group (isolation kept)", async () => {
    const shared = (await q("SELECT (to_regclass('public.db_domain_registry') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'beeside_discovery_rw')) AS s"))[0].s as boolean;
    if (!shared) return; // legacy dedicated database: the login is in beeside_runtime_role by design
    const c = await rt.connect();
    try { expect((await c.query("SELECT pg_has_role(current_user, 'beeside_runtime_role', 'member') AS m")).rows[0].m).toBe(false); } finally { c.release(); }
  });

  it("the authorised migrator can still anonymise a delivered project: personal data goes, structure and evidence stay", async () => {
    const id = await delivered();
    await erase(id);
    const p = (await q("SELECT status, answers, email FROM fa4_project WHERE project_id = $1", [id]))[0];
    expect(p.status).toBe("ANONYMIZED");
    expect(p.answers).toEqual({});
    expect(p.email).toBe(`anonymized+${id}@invalid.invalid`);
    expect((await q("SELECT model FROM fa4_result WHERE project_id = $1", [id]))[0].model).toEqual({ anonymized: true });
    expect((await q("SELECT count(*)::int AS n FROM fa4_privacy_erasure_log WHERE project_id = $1", [id]))[0].n).toBe(1);
    await erase(id); // idempotent, evidence appended
    expect((await q("SELECT count(*)::int AS n FROM fa4_privacy_erasure_log WHERE project_id = $1", [id]))[0].n).toBe(2);
  });

  it("an erased project stays erased: nothing (application, operator, sync) can put personal data back (BV607), while ordinary in-progress projects stay editable", async () => {
    const live = await inProgress();
    await asRuntime("UPDATE fa4_project SET step_key = 'S2', updated_at = now() WHERE project_id = $1", [live]);
    const id = await inProgress();
    await erase(id);
    await expect(asRuntime("UPDATE fa4_project SET answers = '{\"x\":1}', updated_at = now() WHERE project_id = $1", [id])).rejects.toMatchObject({ code: "BV607" });
    await expect(asRuntime("UPDATE fa4_project SET status = 'IN_PROGRESS' WHERE project_id = $1", [id])).rejects.toMatchObject({ code: "BV607" });
    await expect(admin.query("UPDATE fa4_project SET email = 'back@example.invalid' WHERE project_id = $1", [id])).rejects.toMatchObject({ code: "BV607" });
    await expect(admin.query("INSERT INTO fa4_contact_request (project_id, name, company, email, message, language, client_request_id) VALUES ($1, 'N', 'C', 'n@example.invalid', 'm', 'es', $2)", [id, `pg-${id}`])).rejects.toMatchObject({ code: "BV607" });
    await expect(admin.query("INSERT INTO fa4_project (project_id, email, locale, step_key, answers, status) VALUES (gen_random_uuid(), 'x@example.invalid', 'es', 'S1', '{}', 'ANONYMIZED')")).rejects.toMatchObject({ code: "BV607" });
    // the scrubbed form of the same rows is accepted (this is what a copy of an already-erased project looks like)
    const cid = randomUUID();
    await q("INSERT INTO fa4_contact_request (contact_id, project_id, name, company, email, message, language, client_request_id) VALUES ($1, $2, 'anonymized', 'anonymized', $3, 'anonymized', 'es', $4)", [cid, id, `anonymized+${cid}@invalid.invalid`, `pg-ok-${id}`]);
  });

  it("existing contracts keep their error codes: a result stays append-only (BV601) and a delivered project stays closed (BV604) even when erased", async () => {
    const id = await delivered();
    await erase(id);
    await expect(admin.query("UPDATE fa4_result SET model = '{}' WHERE project_id = $1", [id])).rejects.toMatchObject({ code: "BV601" });
    await expect(admin.query("UPDATE fa4_project SET answers = '{\"x\":1}' WHERE project_id = $1", [id])).rejects.toMatchObject({ code: "BV604" });
    await expect(admin.query("UPDATE fa4_privacy_erasure_log SET actor = 'x' WHERE project_id = $1", [id])).rejects.toMatchObject({ code: "BV601" });
  });
});
