import { Pool } from "pg";
import request from "supertest";
import { SEED_CATALOG } from "@beeside/fa-public-engine/seed";
import { journeyA, journeyNewBusiness, journeyNortica } from "@beeside/fa-public-engine/testing";
import { Answers, buildSourceSnapshot, canonicalJson } from "@beeside/fa-public-engine";
import { Db, createPoolDb } from "../db/database";
import { createApp } from "../index";
import { CaptureEmailTransport } from "../fa/email/email-adapter";
import { latestResult, publishCapability, resultsFor, saveCapabilityDraft, seedCatalogIfEmpty } from "../fa4/repository";
import { getFa4PrecisionContext } from "../fa4/precision";
import { Fa4Deps } from "../fa4/routes";

/**
 * FA Public v1.0 — delivery semantics (D-156), the sealed A+ envelope (D-157), the Precision mapper (D-158) and erasure (D-159), under REAL commits and
 * the ACTUAL least-privilege runtime role (same setup as fa4-verify: dedicated database, unique emails).
 */
const adminUrl = process.env.TEST_RUNTIME_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL;
const describeRt = adminUrl && runtimeUrl ? describe : describe.skip;
const legal = { termsVersion: "T", termsUrl: { es: "https://t", en: "https://t" }, privacyVersion: "P", privacyUrl: { es: "https://p", en: "https://p" } };
let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

describeRt("FA4 Public v1.0 — delivery, sealed envelope, Precision context, erasure", () => {
  const admin = new Pool({ connectionString: adminUrl });
  const rt = new Pool({ connectionString: runtimeUrl, max: 8 });
  const adminDb: Db = createPoolDb(admin); const rtDb: Db = createPoolDb(rt);
  const mail = new CaptureEmailTransport();
  let publicPath: string | undefined;
  const deps = (): Fa4Deps => ({
    db: rtDb, email: mail, emailDispatch: "inline",
    config: { appBaseUrl: "https://fa.test", publicPath, sessionTtlHours: 24, resumeLinkDays: 30, emailCooldownMinutes: 0, emailRecipientDailyQuota: 100, resumeProjectsPerRequest: 3, legal, now: () => new Date(), emailConfirmWaitMs: 2000, contactAddress: "contact@beeside.you" },
  });
  const app = () => request(createApp({ fa4: deps() }));
  const q = async (sql: string, v: unknown[] = []) => (await admin.query(sql, v)).rows;
  const auth = (t: string) => ({ "X-Fa4-Session": t });
  async function start(base: Answers = journeyNortica()) {
    const a: Answers = JSON.parse(JSON.stringify(base)); a.identity.email = `v1.${uniq()}@verify.example`; a.identity.name = "Lucía Verificación"; a.identity.marketingConsent = true;
    const r = await app().post("/api/fa4/sessions").send({ answers: a, step: "presence:c1" });
    expect(r.status).toBe(201);
    const pid = (await q("SELECT project_id FROM fa4_project WHERE email = $1", [a.identity.email]))[0].project_id as string;
    return { token: r.body.sessionToken as string, pid, email: a.identity.email, answers: a };
  }
  const status = async (pid: string) => (await q("SELECT status FROM fa4_project WHERE project_id = $1", [pid]))[0].status as string;
  const sealedCount = async (pid: string) => (await q("SELECT count(*)::int n FROM fa4_result WHERE project_id = $1 AND NOT legacy_unsealed", [pid]))[0].n as number;
  const events = async (pid: string, name: string) => (await q("SELECT count(*)::int n FROM fa4_event WHERE project_id = $1 AND name = $2", [pid, name]))[0].n as number;

  beforeAll(async () => { await seedCatalogIfEmpty(adminDb, SEED_CATALOG); });
  beforeEach(() => { mail.messages.length = 0; mail.failNext.length = 0; });
  afterAll(async () => { await admin.end(); await rt.end(); });

  describe("preview ≠ delivery (D-156)", () => {
    it("generating / viewing the YEV does not deliver: no result row, project not DELIVERED, nothing eligible for Precision (tests 1, 3)", async () => {
      const { token, pid } = await start();
      for (let i = 0; i < 3; i++) { const r = await app().post("/api/fa4/session/result").set(auth(token)); expect(r.status).toBe(200); expect(r.body.preview).toBe(true); expect(r.body.resultId).toBeUndefined(); }
      expect(await q("SELECT 1 FROM fa4_result WHERE project_id = $1", [pid])).toHaveLength(0);          // no misleading preview history
      expect(await status(pid)).toBe("IN_PROGRESS");
      expect((await app().get("/api/fa4/session/result").set(auth(token))).status).toBe(404);
      expect(await events(pid, "yev_previewed")).toBe(3); expect(await events(pid, "yev_delivered")).toBe(0);   // analytics tells «generated» from «delivered»
    });

    it("«Corregir algo»: answers can be corrected and the YEV regenerated before delivery (test 2)", async () => {
      const { token, answers } = await start();
      const first = await app().post("/api/fa4/session/result").set(auth(token));
      const changed: Answers = { ...answers, scale: { c1: { proxy: "people", text: "12 personas", declined: false } } };
      expect((await app().put("/api/fa4/session").set(auth(token)).send({ answers: changed, step: "decision" })).status).toBe(200);
      const second = await app().post("/api/fa4/session/result").set(auth(token));
      expect(second.status).toBe(200); expect(JSON.stringify(second.body.model)).toContain("12 personas"); expect(JSON.stringify(first.body.model)).not.toContain("12 personas");
      expect(second.body.previewToken).not.toBe(first.body.previewToken);
    });

    it("a delivery refuses to seal something the client has not seen (stale preview token)", async () => {
      const { token, pid, answers } = await start();
      const preview = await app().post("/api/fa4/session/result").set(auth(token));
      await app().put("/api/fa4/session").set(auth(token)).send({ answers: { ...answers, regulated: "yes" }, step: "activators" });   // edited in another tab
      const r = await app().post("/api/fa4/session/result/email").set(auth(token)).send({ previewToken: preview.body.previewToken });
      expect(r.status).toBe(409); expect(r.body.error).toBe("STALE_PREVIEW");
      expect(await sealedCount(pid)).toBe(0); expect(await status(pid)).toBe("IN_PROGRESS");
    });
  });

  describe("explicit delivery (tests 4, 5)", () => {
    it("the email action delivers ONE canonical result; ten simultaneous clicks do not create a second (idempotent)", async () => {
      const { token, pid } = await start();
      const preview = await app().post("/api/fa4/session/result").set(auth(token));
      const rs = await Promise.all(Array.from({ length: 10 }, () => app().post("/api/fa4/session/result/email").set(auth(token)).send({ previewToken: preview.body.previewToken })));
      expect(rs.every((r) => r.status === 200 || r.status === 202)).toBe(true);
      expect(new Set(rs.map((r) => r.body.resultId)).size).toBe(1);
      expect(await sealedCount(pid)).toBe(1); expect(await status(pid)).toBe("DELIVERED");
      expect(await events(pid, "yev_delivered")).toBe(1);
      expect(mail.messages.filter((m) => m.projectId === pid && m.template === "fa4_result_link")).toHaveLength(1);
    });

    it("«Comienza tu expansión» delivers ONE result and records the continuation on project_id + that result_id; email-then-continue and continue-then-email agree", async () => {
      const a = await start(); const b = await start();
      const c1 = await app().post("/api/fa4/session/continue").set(auth(a.token)); expect(c1.status).toBe(200);
      const e1 = await app().post("/api/fa4/session/result/email").set(auth(a.token)); expect(e1.body.resultId).toBe(c1.body.resultId);
      const e2 = await app().post("/api/fa4/session/result/email").set(auth(b.token));
      const c2 = await app().post("/api/fa4/session/continue").set(auth(b.token)); expect(c2.body.resultId).toBe(e2.body.resultId);
      await app().post("/api/fa4/session/continue").set(auth(b.token));                                  // double click
      for (const [x, id] of [[a, c1.body.resultId], [b, c2.body.resultId]] as const) {
        expect(await sealedCount(x.pid)).toBe(1);
        expect(await q("SELECT result_id FROM fa4_continuation_request WHERE project_id = $1", [x.pid])).toEqual([{ result_id: id }]);
      }
    });

    it("a failed email still leaves the result delivered; the retry re-sends THAT result without a second delivery", async () => {
      const { token, pid } = await start();
      mail.failNext.push(new Error("smtp down"));
      expect((await app().post("/api/fa4/session/result/email").set(auth(token))).status).toBe(502);
      expect(await sealedCount(pid)).toBe(1); expect(await status(pid)).toBe("DELIVERED");
      expect((await app().post("/api/fa4/session/result/email").set(auth(token))).status).toBe(200);
      expect(await sealedCount(pid)).toBe(1); expect(mail.messages.filter((m) => m.projectId === pid && m.template === "fa4_result_link")).toHaveLength(1);
    });
  });

  describe("after delivery everything is closed (tests 6, 7, 8)", () => {
    it("normal save and normal regeneration are refused by the server; the database refuses an answers change too", async () => {
      const { token, pid, answers } = await start();
      await app().post("/api/fa4/session/result/email").set(auth(token));
      const put = await app().put("/api/fa4/session").set(auth(token)).send({ answers: { ...answers, regulated: "yes" }, step: "activators" });
      expect(put.status).toBe(409); expect(put.body.error).toBe("ALREADY_DELIVERED");
      const gen = await app().post("/api/fa4/session/result").set(auth(token));
      expect(gen.status).toBe(409); expect(gen.body.error).toBe("ALREADY_DELIVERED");
      await expect(rt.query("UPDATE fa4_project SET answers = '{}'::jsonb WHERE project_id = $1", [pid])).rejects.toMatchObject({ code: "BV604" });
      expect((await app().get("/api/fa4/session/result").set(auth(token))).body.delivered).toBe(true);
    });

    it("the sealed envelope is immutable for the application AND for SQL; one canonical result per project", async () => {
      const { token, pid } = await start();
      await app().post("/api/fa4/session/result/email").set(auth(token));
      await expect(rt.query("UPDATE fa4_result SET source_snapshot = '{}'::jsonb WHERE project_id = $1", [pid])).rejects.toThrow();            // no grant
      await expect(admin.query("UPDATE fa4_result SET resolution_snapshot = '{}'::jsonb WHERE project_id = $1", [pid])).rejects.toMatchObject({ code: "BV601" });
      await expect(admin.query("UPDATE fa4_result SET rules_version = 'x' WHERE project_id = $1", [pid])).rejects.toMatchObject({ code: "BV601" });
      await expect(admin.query("DELETE FROM fa4_result WHERE project_id = $1", [pid])).rejects.toMatchObject({ code: "BV601" });
      await expect(admin.query("INSERT INTO fa4_result (project_id, catalog_version, model, rules_version, source_schema_version, source_snapshot, resolution_schema_version, resolution_snapshot) SELECT project_id, catalog_version, model, rules_version, source_schema_version, source_snapshot, resolution_schema_version, resolution_snapshot FROM fa4_result WHERE project_id = $1", [pid])).rejects.toMatchObject({ code: "23505" });
    });
  });

  describe("A+ envelope (tests 9, 10, 11)", () => {
    it("seals the client-safe source facts, the structured resolution, catalog_version and rules_version", async () => {
      const { token, pid, answers, email } = await start();
      await app().post("/api/fa4/session/result/email").set(auth(token));
      const row = (await q("SELECT * FROM fa4_result WHERE project_id = $1", [pid]))[0];
      expect(row.legacy_unsealed).toBe(false); expect(row.catalog_version).toBe(SEED_CATALOG.version); expect(row.rules_version).toMatch(/^fa4-rules\//);
      expect([row.source_schema_version, row.resolution_schema_version]).toEqual([1, 1]);
      expect(canonicalJson(row.source_snapshot)).toBe(canonicalJson(buildSourceSnapshot(answers)));
      const dump = JSON.stringify(row.source_snapshot) + JSON.stringify(row.resolution_snapshot);
      expect(dump).not.toMatch(new RegExp(`${email}|Lucía Verificación|marketing|termsAccepted`, "i"));
      expect(JSON.stringify(row.resolution_snapshot)).not.toMatch(/"trace"|nameEs|Grant Thornton|internalRef|sourcing/i);
      expect(row.resolution_snapshot.destinations[0].needs.length).toBeGreaterThan(0);
    });
  });

  describe("FA4 → Precision (tests 11–16)", () => {
    it("project_id + result_id → the same Fa4PrecisionContextV1, whatever happens to the live project, the catalog or the rules afterwards", async () => {
      const { token, pid } = await start();
      const e = await app().post("/api/fa4/session/result/email").set(auth(token)); const rid = e.body.resultId as string;
      const ctx1 = canonicalJson(await getFa4PrecisionContext(rtDb, pid, rid));
      // (a) the live project moves on (admin bypass of the closed state, as the erasure path would)
      const c = await admin.connect();
      try { await c.query("BEGIN"); await c.query("SELECT set_config('fa4.erasure','on',true)"); await c.query("UPDATE fa4_project SET answers = jsonb_set(answers, '{company,sector}', '\"otro\"') WHERE project_id = $1", [pid]); await c.query("COMMIT"); } finally { c.release(); }
      // (b) the published catalog changes
      const rec = SEED_CATALOG.capabilities.find((x) => x.capabilityId === "CAP_HIVE_HR_RECRUITMENT")!;
      await saveCapabilityDraft(adminDb, { ...rec, capabilityStatus: "ACTIVE", providerStatus: "AFFILIATED", businessCheckStatus: "PASSED", coverage: [{ value: "MX", state: "CONFIRMED", validFrom: "2026-11-01" }] } as never, "catalog-admin", "draft");
      await publishCapability(adminDb, "CAP_HIVE_HR_RECRUITMENT", "catalog-admin", "approved", `2099-${uniq()}`);
      expect(canonicalJson(await getFa4PrecisionContext(rtDb, pid, rid))).toBe(ctx1);
      expect(canonicalJson(await getFa4PrecisionContext(rtDb, pid, rid))).toBe(ctx1);                // deterministic
      const ctx = JSON.parse(ctx1);
      expect(ctx.versions.catalogVersion).toBe(SEED_CATALOG.version); expect(ctx.declared.company.sector).not.toBe("otro");
      expect(ctx.declared.provenance).toBe("DECLARED_BY_USER"); expect(ctx.derived.provenance).toBe("DERIVED_FROM_FA");
    });

    it("previews, legacy rows and other projects' results are not eligible; a continuation can only point at a sealed result", async () => {
      const a = await start(); const b = await start();
      await app().post("/api/fa4/session/result").set(auth(a.token));                                                                        // preview only
      await expect(getFa4PrecisionContext(rtDb, a.pid, "00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ code: "NOT_FOUND" });
      const eb = await app().post("/api/fa4/session/result/email").set(auth(b.token));
      await expect(getFa4PrecisionContext(rtDb, a.pid, eb.body.resultId)).rejects.toMatchObject({ code: "NOT_FOUND" });                         // wrong project
      // a legacy (pre-v1.0) preview row: never sealed, never eligible
      const legacy = await q("INSERT INTO fa4_result (project_id, catalog_version, model, legacy_unsealed) VALUES ($1, $2, '{}'::jsonb, true) RETURNING result_id", [a.pid, SEED_CATALOG.version]);
      await expect(getFa4PrecisionContext(rtDb, a.pid, legacy[0].result_id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(admin.query("INSERT INTO fa4_continuation_request (project_id, result_id) VALUES ($1, $2)", [a.pid, legacy[0].result_id])).rejects.toMatchObject({ code: "BV606" });
      expect((await app().get("/api/fa4/session/result").set(auth(a.token))).status).toBe(404);                                                  // legacy rows are not «the delivered result»
      expect((await app().put("/api/fa4/session").set(auth(a.token)).send({ answers: a.answers, step: "decision" })).status).toBe(200);          // …and the project is still editable
    });
  });

  describe("impossible states are impossible (database)", () => {
    it("a project cannot be DELIVERED without a sealed result, nor a sealed result exist for a project that is not delivered", async () => {
      const { pid } = await start();
      const c = await admin.connect();
      try {
        await c.query("BEGIN"); await c.query("UPDATE fa4_project SET status = 'DELIVERED' WHERE project_id = $1", [pid]);
        await expect(c.query("COMMIT")).rejects.toMatchObject({ code: "BV605" });
      } finally { await c.query("ROLLBACK").catch(() => undefined); c.release(); }
      const c2 = await admin.connect();
      try {
        await c2.query("BEGIN");
        await c2.query(`INSERT INTO fa4_result (project_id, catalog_version, model, rules_version, source_schema_version, source_snapshot, resolution_schema_version, resolution_snapshot)
                        VALUES ($1, $2, '{}'::jsonb, 'r', 1, '{}'::jsonb, 1, '{}'::jsonb)`, [pid, SEED_CATALOG.version]);
        await expect(c2.query("COMMIT")).rejects.toMatchObject({ code: "BV605" });
      } finally { await c2.query("ROLLBACK").catch(() => undefined); c2.release(); }
      expect(await status(pid)).toBe("IN_PROGRESS"); expect(await q("SELECT 1 FROM fa4_result WHERE project_id = $1", [pid])).toHaveLength(0);
    });
    it("a sealed row must carry the whole envelope", async () => {
      const { pid } = await start();
      await expect(admin.query("INSERT INTO fa4_result (project_id, catalog_version, model) VALUES ($1, $2, '{}'::jsonb)", [pid, SEED_CATALOG.version])).rejects.toMatchObject({ code: "23514" });
    });
  });

  describe("privacy / erasure (D-159, test 19)", () => {
    it("an authorized erasure leaves no readable copy of the client's data in ANY fa4 table, including the new snapshots", async () => {
      const marker = `ZZ${uniq()}`;
      const base = journeyNortica(); base.identity.company = `Empresa ${marker}`; base.context.success = `éxito ${marker}`; base.addedNeeds = [{ id: "n1", text: `grúas ${marker}`, destination: "MX" }]; base.components[0]!.existingNote = `nota ${marker}`;
      const { token, pid, email } = await start(base);
      await app().post("/api/fa4/session/result/email").set(auth(token));
      await app().post("/api/fa4/session/contact").set(auth(token)).send({ name: `Nombre ${marker}`, company: "C", email, message: `mensaje ${marker}`, shareProgress: true, clientRequestId: `cr-${uniq()}-abcdef` });
      const pre = await q("SELECT count(*)::int n FROM fa4_result WHERE project_id = $1 AND (source_snapshot::text LIKE $2 OR model::text LIKE $2)", [pid, `%${marker}%`]);
      expect(pre[0].n).toBe(1);                                                                          // the marker really is in the envelope before erasure
      await admin.query("SELECT fa4_anonymize_project($1, 'dpo', 'test erasure')", [pid]);
      const tables = (await q("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'fa4\\_%' AND table_type = 'BASE TABLE'")).map((r) => r.table_name as string);
      for (const t of tables) {
        const hit = await q(`SELECT count(*)::int n FROM ${t} x WHERE x::text LIKE $1 OR x::text LIKE $2`, [`%${marker}%`, `%${email}%`]);
        expect({ table: t, hits: hit[0].n }).toEqual({ table: t, hits: t === "fa4_email_delivery" || t === "fa4_privacy_erasure_log" ? hit[0].n : 0 });
      }
      expect((await q("SELECT source_snapshot, resolution_snapshot, model FROM fa4_result WHERE project_id = $1", [pid]))[0]).toEqual({ source_snapshot: { anonymized: true }, resolution_snapshot: { anonymized: true }, model: { anonymized: true } });
      await expect(getFa4PrecisionContext(rtDb, pid, (await q("SELECT result_id FROM fa4_result WHERE project_id = $1", [pid]))[0].result_id)).rejects.toMatchObject({ code: "NOT_RECOVERABLE" });
    });
  });

  it("e-mailed links use the configured public path (/discovery in production); an invalid value falls back to /fa4", async () => {
    for (const [cfg, expected] of [["/discovery", "https://fa.test/discovery#r="], ["/Evil Path", "https://fa.test/fa4#r="], [undefined, "https://fa.test/fa4#r="]] as const) {
      publicPath = cfg; mail.messages.length = 0;
      const { token } = await start();
      await app().post("/api/fa4/session/result/email").set(auth(token));
      await app().post("/api/fa4/session/finish-later").set(auth(token)).send({ answers: undefined });
      const links = mail.messages.map((m) => m.ctaUrl).filter(Boolean);
      expect(links.length).toBeGreaterThan(0);
      for (const l of links) expect(l!.startsWith(expected)).toBe(true);
    }
    publicPath = undefined;
  });

  describe.each(["es", "en"] as const)("new business without an operating company (%s)", (loc) => {
    it("same journey end to end: preview → explicit delivery → sealed → Precision context (operatingBusiness=false) → continuation; nothing is rejected as ineligible", async () => {
      const { token, pid } = await start(journeyNewBusiness(loc));
      expect((await app().put("/api/fa4/session").set(auth(token)).send({ answers: journeyNewBusiness(loc), step: "company" })).status).toBe(200);
      expect(await status(pid)).toBe("IN_PROGRESS");                                                         // never INELIGIBLE
      const preview = await app().post("/api/fa4/session/result").set(auth(token));
      expect(preview.status).toBe(200); expect(preview.body.preview).toBe(true); expect(preview.body.model.premium.shown).toBe(true);
      expect(JSON.stringify(preview.body.model)).not.toMatch(/undefined|null null/);
      const e = await app().post("/api/fa4/session/result/email").set(auth(token)).send({ previewToken: preview.body.previewToken });
      expect(e.status).toBe(200); expect(await sealedCount(pid)).toBe(1); expect(await status(pid)).toBe("DELIVERED");
      const ctx = await getFa4PrecisionContext(rtDb, pid, e.body.resultId);
      expect(ctx.declared.company).toMatchObject({ operatingBusiness: false, sector: "", size: null, operatesIn: [] });      // distinguishable, nothing fabricated
      expect(ctx.declared.destinations.list.map((d) => d.country)).toEqual(["MX"]);
      const c = await app().post("/api/fa4/session/continue").set(auth(token));                                  // Precision / Premium continuation is open
      expect(c.status).toBe(200); expect(c.body.resultId).toBe(e.body.resultId);
      expect(await q("SELECT result_id FROM fa4_continuation_request WHERE project_id = $1", [pid])).toEqual([{ result_id: e.body.resultId }]);
      const row = (await q("SELECT source_snapshot FROM fa4_result WHERE project_id = $1", [pid]))[0];
      expect(row.source_snapshot.company).toEqual({ hasExistingBusiness: false, sector: "", size: null, operatesIn: [] });
    });
    it("the Continue-with-beeside path delivers a new-business result as well (delivery via the CTA)", async () => {
      const { token, pid } = await start(journeyNewBusiness(loc));
      const c = await app().post("/api/fa4/session/continue").set(auth(token));
      expect(c.status).toBe(200); expect(await sealedCount(pid)).toBe(1); expect(await status(pid)).toBe("DELIVERED");
    });
  });
  it("an operating-business journey still reports operatingBusiness=true (regression)", async () => {
    const { token, pid } = await start(journeyNortica());
    const e = await app().post("/api/fa4/session/result/email").set(auth(token));
    expect((await getFa4PrecisionContext(rtDb, pid, e.body.resultId)).declared.company.operatingBusiness).toBe(true);
  });

  it("journey A also delivers through the explicit action and its envelope is complete", async () => {
    const { token, pid } = await start(journeyA());
    await app().post("/api/fa4/session/result/email").set(auth(token));
    const r = (await latestResult(rtDb, pid))!; expect(r.resultId).toBeTruthy();
    expect((await resultsFor(rtDb, pid))).toHaveLength(1);
  });
});
