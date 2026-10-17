import { Pool } from "pg";
import { SEED_CATALOG } from "@beeside/fa-public-engine/seed";
import { createPoolDb } from "../db/database";
import { seedCatalogIfEmpty } from "../fa4/repository";
import { planStabilizationReset, resetStabilizationData } from "../scripts/discovery-stabilization-reset";

const adminUrl = process.env.TEST_RUNTIME_ADMIN_DATABASE_URL;
const d = adminUrl ? describe : describe.skip;
d("stabilization reset (real migrated database)", () => {
  const admin = new Pool({ connectionString: adminUrl });
  afterAll(async () => { await admin.end(); });
  const seed = async (privacyVersion: string) => {
    const p = await admin.query("INSERT INTO fa4_project (email, locale, answers, step_key) VALUES ($1, 'es', '{}'::jsonb, 'x') RETURNING project_id", [`r.${Date.now()}@beeside.you`]);
    await admin.query("INSERT INTO fa4_legal_acceptance (project_id, document, document_version, document_url, language) VALUES ($1,'PRIVACY',$2,'https://p','es')", [p.rows[0].project_id, privacyVersion]);
    return p.rows[0].project_id as string;
  };
  it("refuses without the explicit confirmation", async () => { await expect(resetStabilizationData(admin, undefined)).rejects.toThrow(/RESET_CONFIRM/); await expect(resetStabilizationData(admin, "yes")).rejects.toThrow(/RESET_CONFIRM/); });
  it("refuses when real (non-test) consent exists, and deletes nothing", async () => {
    const pid = await seed("REAL-VERSION-1");
    await expect(resetStabilizationData(admin, "DELETE-ALL-STABILIZATION-DATA")).rejects.toThrow(/real version/);
    expect((await admin.query("SELECT count(*)::int n FROM fa4_project WHERE project_id = $1", [pid])).rows[0].n).toBe(1);
    await admin.query("SELECT set_config('fa4.erasure','on',true)"); // (anonymisation path would be the right tool for real data)
  });
});
d("stabilization reset — happy path (own database state)", () => {
  const admin = new Pool({ connectionString: adminUrl });
  afterAll(async () => { await admin.end(); });
  it("removes only stabilization data, keeps the catalog and leaves the append-only guards ENABLED", async () => {
    await seedCatalogIfEmpty(createPoolDb(admin), SEED_CATALOG);
    // start from a clean slate for this test: remove any real-version row left by the previous describe
    const c = await admin.connect();
    try { await c.query("BEGIN"); await c.query("ALTER TABLE fa4_legal_acceptance DISABLE TRIGGER USER"); await c.query("DELETE FROM fa4_legal_acceptance WHERE document_version = 'REAL-VERSION-1'"); await c.query("ALTER TABLE fa4_legal_acceptance ENABLE TRIGGER USER"); await c.query("COMMIT"); } finally { c.release(); }
    const p = await admin.query("INSERT INTO fa4_project (email, locale, answers, step_key) VALUES ('t@beeside.you','es','{}'::jsonb,'x') RETURNING project_id");
    await admin.query("INSERT INTO fa4_legal_acceptance (project_id, document, document_version, document_url, language) VALUES ($1,'PRIVACY','CLOSED-TEST-NOT-LEGAL','https://p','es')", [p.rows[0].project_id]);
    const r = await resetStabilizationData(admin, "DELETE-ALL-STABILIZATION-DATA");
    expect(r.deleted.fa4_project).toBeGreaterThanOrEqual(1); expect(r.catalogEntities).toBeGreaterThan(0);
    for (const t of ["fa4_project", "fa4_result", "fa4_legal_acceptance", "fa4_event", "fa4_email_delivery"]) expect((await admin.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n).toBe(0);
    const pid = (await admin.query("INSERT INTO fa4_project (email, locale, answers, step_key) VALUES ('u@beeside.you','es','{}'::jsonb,'x') RETURNING project_id")).rows[0].project_id;
    await admin.query("INSERT INTO fa4_legal_acceptance (project_id, document, document_version, document_url, language) VALUES ($1,'PRIVACY','CLOSED-TEST-NOT-LEGAL','https://p','es')", [pid]);
    await expect(admin.query("UPDATE fa4_legal_acceptance SET document_version = 'x' WHERE project_id = $1", [pid])).rejects.toMatchObject({ code: "BV601" });   // the append-only guard survived the reset
  });
});

d("stabilization reset — never cascades into another domain (own database state)", () => {
  const admin = new Pool({ connectionString: adminUrl });
  afterAll(async () => { await admin.query("DROP TABLE IF EXISTS zz_reset_dependent").catch(() => undefined); await admin.end(); });
  const clean = async (): Promise<void> => {
    // start from a database holding only closed-test data: remove any real-version row left by the other describes
    const c = await admin.connect();
    try { await c.query("BEGIN"); await c.query("ALTER TABLE fa4_legal_acceptance DISABLE TRIGGER USER"); await c.query("DELETE FROM fa4_legal_acceptance WHERE document_version <> 'CLOSED-TEST-NOT-LEGAL'"); await c.query("ALTER TABLE fa4_legal_acceptance ENABLE TRIGGER USER"); await c.query("COMMIT"); } finally { c.release(); }
    await seedCatalogIfEmpty(createPoolDb(admin), SEED_CATALOG);
  };
  it("the PLAN is read-only: it reports counts, the dependents outside the Discovery set and the refusals, and deletes nothing", async () => {
    await clean();
    const pid = (await admin.query("INSERT INTO fa4_project (email, locale, answers, step_key) VALUES ('plan@beeside.you','es','{}'::jsonb,'x') RETURNING project_id")).rows[0].project_id as string;
    const before = (await admin.query("SELECT count(*)::int n FROM fa4_project")).rows[0].n;
    const plan = await planStabilizationReset(admin);
    expect(plan.counts.fa4_project).toBe(before);
    expect(plan.deleteOrder.indexOf("fa4_project")).toBe(plan.deleteOrder.length - 1);          // the parent goes last
    expect(plan.catalogEntities).toBeGreaterThan(0);
    expect((await admin.query("SELECT count(*)::int n FROM fa4_project WHERE project_id = $1", [pid])).rows[0].n).toBe(1);
    if (process.env.TEST_SHARED_DOMAIN_SCHEMA === "1") expect(plan.dependents.map((x) => x.table)).toContain("project_origin");   // the real Discovery->Precision lineage table
  });
  it("REFUSES, deleting nothing, while a table of another domain holds rows that reference Discovery records; the dependent is never touched", async () => {
    await clean();
    await admin.query("DROP TABLE IF EXISTS zz_reset_dependent");
    await admin.query("CREATE TABLE zz_reset_dependent (rid uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES fa4_project(project_id) ON DELETE CASCADE)");
    const pid = (await admin.query("INSERT INTO fa4_project (email, locale, answers, step_key) VALUES ('dep@beeside.you','es','{}'::jsonb,'x') RETURNING project_id")).rows[0].project_id as string;
    await admin.query("INSERT INTO zz_reset_dependent (project_id) VALUES ($1)", [pid]);
    const plan = await planStabilizationReset(admin);
    expect(plan.dependents).toContainEqual({ table: "zz_reset_dependent", rows: 1 });
    expect(plan.refusals.join(" ")).toMatch(/zz_reset_dependent holds 1 row/);
    await expect(resetStabilizationData(admin, "DELETE-ALL-STABILIZATION-DATA")).rejects.toThrow(/lineage/);
    expect((await admin.query("SELECT count(*)::int n FROM zz_reset_dependent")).rows[0].n).toBe(1);        // even with ON DELETE CASCADE declared, nothing was deleted
    expect((await admin.query("SELECT count(*)::int n FROM fa4_project WHERE project_id = $1", [pid])).rows[0].n).toBe(1);
  });
  it("proceeds when the dependent is empty and leaves that table (and its structure) untouched", async () => {
    await clean();
    await admin.query("DELETE FROM zz_reset_dependent");
    const r = await resetStabilizationData(admin, "DELETE-ALL-STABILIZATION-DATA");
    expect(r.deleted.fa4_project).toBeGreaterThanOrEqual(1);
    expect((await admin.query("SELECT count(*)::int n FROM fa4_project")).rows[0].n).toBe(0);
    expect((await admin.query("SELECT to_regclass('zz_reset_dependent') IS NOT NULL AS present")).rows[0].present).toBe(true);
    expect((await admin.query("SELECT count(*)::int n FROM fa4_catalog_entity")).rows[0].n).toBe(r.catalogEntities);
  });
});
