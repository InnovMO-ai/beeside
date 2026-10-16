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
  it("detects a login that is too powerful", async () => {
    await admin.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='too_powerful') THEN CREATE ROLE too_powerful LOGIN CREATEROLE; END IF; END $$");
    const r = await prepareRuntimeLogin(admin, "too_powerful");
    expect(r.checks.find((c) => c.check.startsWith("not superuser"))!.ok).toBe(false);
  });
});
