import { Pool } from "pg";
import { databaseModel, prepareDomainLogin, prepareRuntimeLogin } from "../scripts/discovery-prod-prepare";

const adminUrl = process.env.TEST_RUNTIME_ADMIN_DATABASE_URL;
const sharedSchema = process.env.TEST_SHARED_DOMAIN_SCHEMA === "1";
// the LEGACY model (login in beeside_runtime_role, which writes Discovery's tables) is deliberately closed on the shared canonical schema: see the shared suite below
const d = adminUrl && !sharedSchema ? describe : describe.skip;
d("production preparation: the runtime login contract (legacy dedicated database)", () => {
  const admin = new Pool({ connectionString: adminUrl });
  afterAll(async () => { await admin.end(); });
  it("grants membership and verifies the least-privilege contract; refuses a login that does not exist", async () => {
    const r = await prepareRuntimeLogin(admin, "rt");
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    await expect(prepareRuntimeLogin(admin, "no_such_login")).rejects.toThrow(/does not exist/);
  });
  it("removes excess powers it can remove (CREATEROLE/CREATEDB/schema CREATE) and DETECTS powers it must not touch (a direct DELETE grant)", async () => {
    await admin.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='too_powerful') THEN CREATE ROLE too_powerful LOGIN CREATEROLE CREATEDB; END IF; END $$");
    const fixed = await prepareRuntimeLogin(admin, "too_powerful");
    expect(fixed.checks.filter((c) => !c.ok)).toEqual([]);                                   // CREATEROLE / CREATEDB were revoked by the preparation
    await admin.query("GRANT DELETE ON fa4_project TO too_powerful");
    const bad = await prepareRuntimeLogin(admin, "too_powerful");
    expect(bad.checks.find((c) => c.check === "cannot DELETE fa4_project")!.ok).toBe(false);
    await admin.query("REVOKE DELETE ON fa4_project FROM too_powerful");
  });
});

/**
 * SHARED canonical database model. Needs the shared-lineage schema (migrations 0050/0051): TEST_SHARED_DOMAIN_SCHEMA=1. Logins are cluster-wide roles, so each test
 * uses unique names and removes them at the end.
 */
const shared = adminUrl && sharedSchema ? describe : describe.skip;
shared("production preparation: the data-domain model (shared canonical database)", () => {
  const admin = new Pool({ connectionString: adminUrl });
  const tag = Math.random().toString(36).slice(2, 8);
  const disc = `dp_disc_${tag}`;
  const prec = `dp_prec_${tag}`;
  beforeAll(async () => {
    await admin.query(`CREATE ROLE ${disc} LOGIN`);
    await admin.query(`CREATE ROLE ${prec} LOGIN`);
    await admin.query(`GRANT beeside_runtime_role TO ${disc}`);   // how the login sits BEFORE the move (legacy group)
    await admin.query(`GRANT beeside_runtime_role TO ${prec}`);
  });
  afterAll(async () => {
    for (const r of [disc, prec]) { await admin.query(`DROP OWNED BY ${r}`).catch(() => undefined); await admin.query(`DROP ROLE IF EXISTS ${r}`).catch(() => undefined); }
    await admin.end();
  });
  const asLogin = async (login: string, sql: string): Promise<string> => {
    const c = await admin.connect();
    try { await c.query(`SET ROLE ${login}`); await c.query(sql); return "allowed"; } catch (e) { return (e as { code?: string }).code ?? "error"; } finally { await c.query("RESET ROLE").catch(() => undefined); c.release(); }
  };
  it("is recognised as the shared model", async () => { expect(await databaseModel(admin)).toBe("shared"); });
  it("moves the login to its own group, keeps working for Discovery's tables, and reaches nothing of Precision", async () => {
    const r = await prepareDomainLogin(admin, disc, prec);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(await asLogin(disc, "SELECT count(*) FROM fa4_project")).toBe("allowed");
    expect(await asLogin(disc, "SELECT count(*) FROM admin_user")).toBe("42501");
    expect(await asLogin(disc, "SELECT count(*) FROM entitlement")).toBe("42501");
    expect(await asLogin(prec, "INSERT INTO fa4_project (email, locale, answers, step_key) VALUES ('x@beeside.you','es','{}'::jsonb,'x')")).toBe("42501");
  });
  it("is idempotent and refuses a login that does not exist", async () => {
    expect((await prepareDomainLogin(admin, disc, prec)).checks.filter((c) => !c.ok)).toEqual([]);
    await expect(prepareDomainLogin(admin, "no_such_login")).rejects.toThrow(/does not exist/);
  });
});
