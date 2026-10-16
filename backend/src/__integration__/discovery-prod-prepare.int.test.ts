import { Pool } from "pg";
import { prepareRuntimeLogin } from "../scripts/discovery-prod-prepare";

const adminUrl = process.env.TEST_RUNTIME_ADMIN_DATABASE_URL;
const d = adminUrl ? describe : describe.skip;
d("production preparation: the runtime login contract (real migrated database)", () => {
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
