import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { createSavepointDb, type Db } from "../../../db/database";
import { AUTHORED_CATEGORY_KEYS, bundledCategoryManifest, bundledProjectManifest } from "../bundled";
import { evaluateCategory } from "../readiness";
import { publishBundledManifests, unauthoredCatalogCategories } from "../publish";
import { manifestVersionOf } from "../publish-hash";
import { createManifestRegistry, resolveManifestCategoryKey } from "../registry";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;

describeWithDb("manifest registry + publish (PostgreSQL, every test rolled back)", () => {
  const client = new Client({ connectionString: databaseUrl });
  let db: Db;
  let admin: string;
  beforeAll(() => client.connect());
  afterAll(() => client.end());
  beforeEach(async () => {
    await client.query("BEGIN");
    db = createSavepointDb(client);
    admin = (await client.query<{ id: string }>("INSERT INTO admin_user (role, auth_identity) VALUES ('ADMIN', $1) RETURNING admin_user_id AS id", [`eng-${randomUUID()}@beeside.internal`])).rows[0]!.id;
  });
  afterEach(() => client.query("ROLLBACK"));

  const count = async (table: string): Promise<number> => Number((await client.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n);

  it("publishes the project manifest, 7 authored + _generic category manifests and one generic-backed row per unauthored catalog category", async () => {
    const r = await publishBundledManifests(db, { actorAdminUserId: admin });
    const generic = unauthoredCatalogCategories();
    expect(generic).toHaveLength(12);
    expect(r.items).toHaveLength(1 + AUTHORED_CATEGORY_KEYS.length + 1 + generic.length);
    expect(r.created).toBe(r.items.length);
    expect(r.items.every((i) => i.isCurrent && i.action === "created")).toBe(true);
    expect(await count("project_manifest_version")).toBe(1);
    expect(await count("category_manifest_version")).toBe(r.items.length - 1);
    const { rows } = await client.query<{ n: string }>("SELECT count(*) AS n FROM category_manifest_version WHERE is_current AND status = 'PUBLISHED' AND content_hash IS NOT NULL AND published_by_admin_user_id = $1", [admin]);
    expect(Number(rows[0]!.n)).toBe(r.items.length - 1);
    // every catalog category and _generic has a current row to pin (category_assessment composite FK)
    const keys = bundledProjectManifest().candidate_categories.filter((c) => c.kind === "catalog").map((c) => c.category_key);
    for (const k of [...keys, "_generic"]) {
      const cur = await client.query("SELECT 1 FROM category_manifest_version WHERE category_key = $1 AND is_current", [k]);
      expect(cur.rowCount).toBe(1);
    }
  });

  it("is idempotent: a second run changes nothing", async () => {
    await publishBundledManifests(db, { actorAdminUserId: admin });
    const before = (await client.query("SELECT category_key, version, is_current, published_at FROM category_manifest_version ORDER BY category_key, version")).rows;
    const again = await publishBundledManifests(db, { actorAdminUserId: admin });
    expect(again.created).toBe(0);
    expect(again.unchanged).toBe(again.items.length);
    expect((await client.query("SELECT category_key, version, is_current, published_at FROM category_manifest_version ORDER BY category_key, version")).rows).toEqual(before);
  });

  it("never moves the current pointer for an existing version unless forced; new content becomes current", async () => {
    // a newer manual version of logistics is current
    await publishBundledManifests(db, { actorAdminUserId: admin });
    await client.query("INSERT INTO category_manifest_version (category_key, version, content, created_by_admin_user_id) VALUES ('logistics', 'manual-2', $1::jsonb, $2)", [JSON.stringify(bundledCategoryManifest("logistics")), admin]);
    await client.query("SELECT precision_category_manifest_publish('logistics', 'manual-2', $1)", [admin]);
    const again = await publishBundledManifests(db, { actorAdminUserId: admin });
    expect(again.items.find((i) => i.categoryKey === "logistics")).toMatchObject({ action: "unchanged", isCurrent: false });
    expect((await client.query("SELECT version FROM category_manifest_version WHERE category_key = 'logistics' AND is_current")).rows[0]).toEqual({ version: "manual-2" });
    const forced = await publishBundledManifests(db, { actorAdminUserId: admin, forceCurrent: true });
    expect(forced.items.find((i) => i.categoryKey === "logistics")?.action).toBe("made_current");
    expect((await client.query("SELECT version FROM category_manifest_version WHERE category_key = 'logistics' AND is_current")).rows[0]).toEqual({ version: manifestVersionOf(bundledCategoryManifest("logistics")!) });
    expect(await count("category_manifest_version")).toBeGreaterThan(20);
  });

  it("a build with content that differs from what is current publishes a new version and makes it current; the old one stays published", async () => {
    await client.query("INSERT INTO category_manifest_version (category_key, version, content, created_by_admin_user_id) VALUES ('logistics', 'older-1', $1::jsonb, $2)", [JSON.stringify({ ...bundledCategoryManifest("logistics"), manifest_version_label: "older" }), admin]);
    await client.query("SELECT precision_category_manifest_publish('logistics', 'older-1', $1)", [admin]);
    const r = await publishBundledManifests(db, { actorAdminUserId: admin });
    expect(r.items.find((i) => i.categoryKey === "logistics")).toMatchObject({ action: "created", isCurrent: true });
    const rows = (await client.query<{ version: string; is_current: boolean; status: string }>("SELECT version, is_current, status FROM category_manifest_version WHERE category_key = 'logistics' ORDER BY version")).rows;
    expect(rows.find((x) => x.version === "older-1")).toMatchObject({ is_current: false, status: "PUBLISHED" });
    expect(rows.filter((x) => x.is_current)).toHaveLength(1);
  });

  it("registry: current, pinned, generic fallback for new:* and unauthored categories; evaluates with the loaded manifest", async () => {
    await publishBundledManifests(db, { actorAdminUserId: admin });
    const reg = createManifestRegistry(db);

    const lg = await reg.getManifestForCategory("logistics");
    expect(lg).toMatchObject({ requestedKey: "logistics", manifestCategoryKey: "logistics", source: "database", isCurrent: true });
    expect(lg.version).toBe(manifestVersionOf(bundledCategoryManifest("logistics")!));
    const ev = evaluateCategory({ manifest: lg.manifest, facts: {}, countries: ["US"] });
    expect(ev.progressPct).toBe(0);
    expect(ev.nextFieldKey).toBe("logistics_operating_responsibility");

    const nw = await reg.getManifestForCategory("new:public_procurement");
    expect(nw).toMatchObject({ requestedKey: "new:public_procurement", manifestCategoryKey: "_generic" });
    expect(resolveManifestCategoryKey("new:public_procurement")).toBe("_generic");
    expect(nw.manifest.crp_kind).toBe("new_category_discovery");

    const un = await reg.getManifestForCategory("banking_finance_insurance");
    expect(un.manifestCategoryKey).toBe("banking_finance_insurance");
    expect(un.manifest.crp_kind).toBe("operational");
    expect(un.manifest.fields.map((f) => f.field_key)).toEqual(bundledCategoryManifest("_generic")!.fields.map((f) => f.field_key));

    // an unknown key with no row falls back to _generic
    const odd = await reg.getManifestForCategory("some_future_category");
    expect(odd).toMatchObject({ requestedKey: "some_future_category", manifestCategoryKey: "_generic" });

    // pinned
    const pinned = await reg.getManifestForCategory("logistics", lg.version);
    expect(pinned.version).toBe(lg.version);
    await expect(reg.getManifestForCategory("logistics", "no-such-version")).rejects.toThrow(/not published/);
    expect(await reg.getCategoryManifest("logistics", "no-such-version")).toBeNull();

    const pm = await reg.getProjectManifest();
    expect(pm?.version).toBe(manifestVersionOf(bundledProjectManifest()));
    expect(pm?.manifest.candidate_categories.length).toBe(19);
    expect((await reg.getProjectManifest(pm!.version))?.source).toBe("database");
    expect(await reg.getProjectManifest("nope")).toBeNull();
  });

  it("registry cache: pinned versions are cached for good, the current pointer for the TTL, invalidate() drops it", async () => {
    await publishBundledManifests(db, { actorAdminUserId: admin });
    let queries = 0;
    const counting: Pick<Db, "query"> = { query: (t, v) => { queries += 1; return db.query(t, v); } };
    let clock = 1_000;
    const reg = createManifestRegistry(counting, { currentTtlMs: 5_000, now: () => clock });

    await reg.getCategoryManifest("logistics");
    await reg.getCategoryManifest("logistics");
    expect(queries).toBe(1);
    clock += 4_000;
    await reg.getCategoryManifest("logistics");
    expect(queries).toBe(1);
    clock += 2_000;
    await reg.getCategoryManifest("logistics");
    expect(queries).toBe(2);
    reg.invalidate();
    await reg.getCategoryManifest("logistics");
    expect(queries).toBe(3);

    const v = (await reg.getCategoryManifest("logistics"))!.version;
    const before = queries;
    await reg.getCategoryManifest("logistics", v);
    clock += 10 * 60_000;
    await reg.getCategoryManifest("logistics", v);
    expect(queries).toBe(before + 1);

    // concurrent loads share one query
    const q0 = queries;
    await Promise.all([reg.getCategoryManifest("tax_accounting_audit", "x"), reg.getCategoryManifest("tax_accounting_audit", "x")]);
    expect(queries - q0).toBe(1);
  });

  it("without a published row the registry reports nothing, unless the bundled fallback is on (same deterministic version)", async () => {
    const empty = createManifestRegistry(db);
    expect(await empty.getCategoryManifest("logistics")).toBeNull();
    await expect(empty.getManifestForCategory("logistics")).rejects.toThrow(/no published manifest/);
    const withFallback = createManifestRegistry(db, { allowBundledFallback: true });
    const lg = await withFallback.getManifestForCategory("logistics");
    expect(lg.source).toBe("bundled");
    await publishBundledManifests(db, { actorAdminUserId: admin });
    expect((await createManifestRegistry(db).getManifestForCategory("logistics")).version).toBe(lg.version);
  });

  it("falls back to the development bootstrap administrator when no actor is given", async () => {
    const r = await publishBundledManifests(db);
    expect(r.created).toBeGreaterThan(0);
    const { rows } = await client.query<{ auth_identity: string }>("SELECT a.auth_identity FROM project_manifest_version p JOIN admin_user a ON a.admin_user_id = p.published_by_admin_user_id");
    expect(rows[0]?.auth_identity).toMatch(/bootstrap/);
  });
});
