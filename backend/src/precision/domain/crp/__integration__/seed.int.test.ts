import { Pool } from "pg";
import { createPoolDb, type Db } from "../../../../db/database";
import { FixtureEntitlementProvider } from "../../../adapters/fixture-entitlement";
import { FixtureFaContextReader } from "../../../adapters/fixture-fa-context";
import { exchangeLinkToken, hashToken } from "../../tokens";
import { DEMO_COMPANY_NAME, DEMO_MAP_CATEGORIES, DEMO_FA_CONTEXT, DEMO_UNDERSTANDING_FACTS, loadDemoFixtures, seedDemoProject } from "../../seed";
import { databaseUrl, describeWithDb } from "./harness";
import { scanCustomerBody } from "./scan";

describeWithDb("demo seed (PostgreSQL)", () => {
  let pool: Pool;
  let db: Db;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 4 }); db = createPoolDb(pool); });
  afterAll(() => pool.end());

  const n = async (sql: string, args: unknown[]): Promise<number> => Number((await db.query<{ n: string }>(sql, args)).rows[0]!.n);
  const opts = { mintLink: false, bootstrapFaConfig: true } as const;

  it("is idempotent: running it again finds the same project and writes nothing new", async () => {
    const first = await seedDemoProject(db, { ...opts, reset: true, stage: "logistics_ready" });
    expect(first.created).toBe(true);
    expect(first.categories.map((c) => c.categoryKey).sort()).toEqual(DEMO_MAP_CATEGORIES.map((c) => c.categoryKey).sort());
    const counts = async (): Promise<number[]> => [
      await n("SELECT count(*) AS n FROM fact WHERE project_id = $1", [first.projectId]),
      await n("SELECT count(*) AS n FROM category_assessment WHERE project_id = $1", [first.projectId]),
      await n("SELECT count(*) AS n FROM precision_instance WHERE project_id = $1", [first.projectId]),
      await n("SELECT count(*) AS n FROM service_map_snapshot s JOIN precision_instance i ON i.id = s.precision_instance_id WHERE i.project_id = $1", [first.projectId]),
    ];
    const before = await counts();
    const again = await seedDemoProject(db, { ...opts, stage: "logistics_ready" });
    expect(again).toMatchObject({ projectId: first.projectId, companyId: first.companyId, created: false });
    expect(await counts()).toEqual(before);
    // a lower stage never undoes a higher one
    const lower = await seedDemoProject(db, { ...opts, stage: "start" });
    expect(lower.projectId).toBe(first.projectId);
    expect(lower.categories.length).toBe(4);
    expect(await counts()).toEqual(before);
  });

  it("two seeders at once create exactly one project", async () => {
    await seedDemoProject(db, { ...opts, reset: true, stage: "start" });
    const marker = await n("SELECT count(*) AS n FROM project p JOIN company c ON c.company_id = p.company_id WHERE c.name = $1", [DEMO_COMPANY_NAME]);
    const [a, b] = await Promise.all([seedDemoProject(db, { ...opts, stage: "map_confirmed" }), seedDemoProject(db, { ...opts, stage: "map_confirmed" })]);
    expect(a.projectId).toBe(b.projectId);
    expect(await n("SELECT count(*) AS n FROM project p JOIN company c ON c.company_id = p.company_id WHERE c.name = $1", [DEMO_COMPANY_NAME])).toBe(marker);
    expect(await n("SELECT count(*) AS n FROM category_assessment WHERE project_id = $1 AND lifecycle_status <> 'not_selected'", [a.projectId])).toBe(4);
  });

  it("reset starts a NEW project; the fixtures follow the newest one", async () => {
    const one = await seedDemoProject(db, { ...opts, reset: true, stage: "map_confirmed" });
    const two = await seedDemoProject(db, { ...opts, reset: true, stage: "map_confirmed" });
    expect(two.projectId).not.toBe(one.projectId);
    const fa = new FixtureFaContextReader();
    const ent = new FixtureEntitlementProvider();
    expect(await loadDemoFixtures(db, { faContext: fa, entitlement: ent })).toBe(two.projectId);
    expect((await fa.read(two.projectId))?.context.company.displayName).toBe(DEMO_COMPANY_NAME);
    expect(await ent.get(two.projectId)).toMatchObject({ premiumActive: true, accessMode: "FULL" });
    expect(await fa.read(one.projectId)).toBeNull();
  });

  it("mints a one-time link: stored only as a hash, usable once, never part of the result twice", async () => {
    const now = new Date();
    const seeded = await seedDemoProject(db, { reset: true, stage: "start", bootstrapFaConfig: true, now });
    expect(seeded.linkToken).toEqual(expect.any(String));
    const raw = seeded.linkToken!;
    expect(await n("SELECT count(*) AS n FROM precision_access_token WHERE project_id = $1 AND token_hash = $2", [seeded.projectId, hashToken(raw)])).toBe(1);
    expect(await n("SELECT count(*) AS n FROM precision_access_token WHERE token_hash = $1", [raw])).toBe(0);
    const session = await exchangeLinkToken(db, raw, now);
    expect(session?.projectId).toBe(seeded.projectId);
    expect(await exchangeLinkToken(db, raw, now)).toBeNull();
  });

  it("holds only the premium state the fixture is told to hold, and states no country-specific legal claim (R10)", async () => {
    // client-visible strings of the fixture pass the same customer-text scan as the product
    expect(scanCustomerBody(DEMO_MAP_CATEGORIES.map((c) => c.needs.map((x) => [x.label, x.why])))).toEqual([]);
    expect(scanCustomerBody(DEMO_FA_CONTEXT.needs.map((x) => x.label))).toEqual([]);
    const text = JSON.stringify([DEMO_FA_CONTEXT, DEMO_UNDERSTANDING_FACTS, DEMO_MAP_CATEGORIES]).toLowerCase();
    for (const claim of ["customs law", "tax law", "must register", "is required by law", "regulation requires", "tariff of", "permit is required", "legally required"]) expect(text).not.toContain(claim);
  });
});
