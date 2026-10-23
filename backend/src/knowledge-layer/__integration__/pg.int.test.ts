import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { createSavepointDb, type Db } from "../../db/database";
import { databaseUrl, describeWithDb } from "../../__integration__/fa-harness";
import { applyCandidate, decideCandidate, runAgentCycle, type SourceFetcher } from "../agent";
import { seedInitialSources } from "../registry";
import { ingestDocument } from "../ingest";
import { retrieve, wordingClass } from "../retrieve";
import { orient } from "../orient";
import { buildRefsFor, resolveRef } from "../refs";
import { createPgCandidateStore, createPgCountryResources, createPgKnowledgeRepository } from "../pg-repo";
import { resolveResources } from "../country-resources";

const FX = (n: string): Buffer => readFileSync(join(__dirname, "..", "__tests__", "fixtures", n));
const NOW = "2026-10-14T12:00:00.000Z";

describeWithDb("Knowledge Service + frame store (PostgreSQL)", () => {
  let pool: Pool;
  let client: PoolClient;
  let db: Db;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 2 }); });
  afterAll(() => pool.end());
  beforeEach(async () => { client = await pool.connect(); await client.query("BEGIN"); db = createSavepointDb(client); });
  afterEach(async () => { await client.query("ROLLBACK"); client.release(); });

  async function world() {
    const repo = createPgKnowledgeRepository(db);
    await seedInitialSources(repo);
    const base = { sourceId: "imco-ice", edition: "2025", locator: "https://imco.org.mx/indices/ice-fixture", now: NOW, publishedAt: "2025-09-01" };
    await ingestDocument(repo, { ...base, title: "ICE (fixture)", filename: "ice.pdf", data: FX("ice-sintetico.pdf") });
    await ingestDocument(repo, { ...base, title: "ICE datos (fixture)", filename: "ice.csv", data: FX("ice-datos-estatales.csv") });
    await ingestDocument(repo, { sourceId: "imss", title: "Cuotas (fixture)", edition: "2026", locator: "https://www.imss.gob.mx/f", filename: "c.txt", data: FX("cuotas-oficial.txt"), now: NOW });
    return repo;
  }

  it("A–G on PostgreSQL: retrieval, provenance, state data, granularity guard, authority", async () => {
    const repo = await world();
    const labor = await retrieve(repo, { text: "mercado laboral informalidad salarios", topics: ["labor_market"], jurisdiction: "MX", authorities: ["trusted_institutional"] });
    expect(labor[0]!.provenance.institution).toMatch(/IMCO/);
    expect(labor[0]!.provenance.edition).toBe("2025");
    expect(labor[0]!.mayGroundObligation).toBe(false);
    const accents = await retrieve(repo, { text: "participacion laboral", jurisdiction: "MX" });
    expect(accents.length).toBeGreaterThan(0);
    const o = await orient(repo, { text: "Entre Nuevo León y Querétaro", jurisdiction: "MX", topics: ["labor_market", "infrastructure"], states: ["Nuevo León", "Querétaro"] });
    expect(o.comparison?.rows.find((r) => r.criterion === "Mercado de trabajo")?.leader).toBe("Nuevo León");
    const g = await orient(repo, { text: "mercado laboral", jurisdiction: "MX", topics: ["labor_market"], states: ["Nuevo León"], finerThanState: true });
    expect(g.limits[0]?.availableLevel).toBe("state");
    expect(g.sherpaFlag).toBeDefined();
    const official = await retrieve(repo, { text: "cuotas obrero-patronales trabajadores", topics: ["social_security"], jurisdiction: "MX", authorities: ["official_primary"] });
    expect(wordingClass(official[0]!)).toBe("obligation");
    const refs = await buildRefsFor(repo, "MX");
    const first = await resolveRef(repo, refs("employment_benefits")[0]!);
    expect(first?.source.authority).toBe("official_primary");
  });

  it("a new edition supersedes in the database; the old one is not returned by default", async () => {
    const repo = await world();
    const v2 = await ingestDocument(repo, { sourceId: "imco-ice", title: "ICE (fixture)", edition: "2027", locator: "https://imco.org.mx/ice27", filename: "ice.txt", data: FX("ice-sintetico-v2.txt"), now: "2027-10-01T00:00:00.000Z" });
    expect(v2.status).toBe("ingested");
    const docs = await repo.listDocuments({ sourceId: "imco-ice" });
    expect(docs.filter((d) => d.title === "ICE (fixture)").map((d) => `${d.version}:${d.status}`).sort()).toEqual(["1:superseded", "2:active"]);
    const cur = await retrieve(repo, { text: "participación laboral formal", topics: ["labor_market"], jurisdiction: "MX", authorities: ["trusted_institutional"] });
    expect(cur.every((h) => h.provenance.documentStatus === "active")).toBe(true);
    const unchanged = await ingestDocument(repo, { sourceId: "imco-ice", title: "ICE (fixture)", edition: "2027", locator: "https://imco.org.mx/ice27", filename: "ice.txt", data: FX("ice-sintetico-v2.txt"), now: NOW });
    expect(unchanged.status).toBe("unchanged");
  });

  it("edition series in PostgreSQL: a new edition under another title supersedes; an older one arriving late is historical; nothing is overwritten", async () => {
    const repo = createPgKnowledgeRepository(db);
    await seedInitialSources(repo);
    const csv = (v: string, y: string): Buffer => Buffer.from(`Estado,Indicador,Valor,Lugar,Año\nNuevo León,Mercado de trabajo,${v},3,${y}\nQuerétaro,Mercado de trabajo,64.9,6,${y}`);
    const mk = (title: string, edition: string, data: Buffer) => ingestDocument(repo, { sourceId: "imco-ice", title, edition, locator: `https://imco.org.mx/ice-${edition}`, filename: "ice.csv", data, now: NOW });
    const e26 = await mk("ICE 2026", "2026", csv("66.0", "2026"));
    const e25 = await mk("ICE 2025", "2025", csv("68.2", "2025"));
    if (e26.status !== "ingested" || e25.status !== "ingested") throw new Error("setup");
    expect(e25.historical).toBe(true);
    const docs = await repo.listDocuments({ sourceId: "imco-ice" });
    expect(docs.map((d) => `${d.edition}:${d.status}`).sort()).toEqual(["2025:superseded", "2026:active"]);
    expect((await repo.getDocument(e25.document.id))?.supersededById).toBe(e26.document.id);
    const e24 = await mk("ICE 2024", "2024", csv("60.0", "2024"));
    if (e24.status !== "ingested") throw new Error("setup");
    expect((await repo.getDocument(e24.document.id))?.supersededById).toBe(e25.document.id); // chain: 2024 → 2025 → 2026
    expect((await repo.getDocument(e26.document.id))?.supersedesId).toBe(e25.document.id);
    const cur = await retrieve(repo, { text: "mercado de trabajo", topics: ["labor_market"], jurisdiction: "MX" });
    expect(cur.length).toBeGreaterThan(0);
    expect(cur.every((h) => h.provenance.edition === "2026")).toBe(true);
    const e27 = await mk("ICE 2027", "2027", csv("70.0", "2027"));
    if (e27.status !== "ingested") throw new Error("setup");
    expect(e27.supersededId).toBe(e26.document.id);
    expect(await repo.listPassages(e25.document.id)).not.toHaveLength(0);
    await expect(db.query("UPDATE knowledge_document SET content_hash = 'x' WHERE id = $1", [e25.document.id])).rejects.toThrow();
  });

  it("the agent keeps high-risk candidates out until a person approves them", async () => {
    const repo = createPgKnowledgeRepository(db);
    await seedInitialSources(repo);
    const store = createPgCandidateStore(db);
    const fetcher: SourceFetcher = { fetch: async (src) => src.id !== "sat" ? [] : [{ url: "https://www.sat.gob.mx/x", title: "Criterio", edition: "2026-Q4", filename: "a.txt", data: Buffer.from("Texto de prueba sobre el impuesto sobre la renta.") }] };
    const rep = await runAgentCycle(repo, store, fetcher, NOW, { imco: NOW });
    const pend = await store.list("pending_review");
    expect(pend.length).toBe(1);
    expect(rep.candidates.length).toBeGreaterThanOrEqual(1);
    expect(await repo.listDocuments({ sourceId: "sat" })).toHaveLength(0);
    await decideCandidate(store, pend[0]!.id, "approved");
    const res = await applyCandidate(repo, store, pend[0]!.id, NOW);
    expect(res.status).toBe("ingested");
    expect((await store.get(pend[0]!.id))?.candidate.status).toBe("auto_applied");
  });

  it("country resources: configured destinations are validated and resolved", async () => {
    const repo = createPgCountryResources(db);
    await repo.upsert({ id: "dbm-en", countryCode: "MX", title: "Doing Business in Mexico", language: "en", version: "2026", destination: { kind: "url", ref: "https://example.org/dbm.pdf" }, active: true, updatedAt: "2026-09-01" });
    await repo.upsert({ id: "dbm-es", countryCode: "MX", title: "Hacer negocios en México", language: "es", version: "2026", destination: { kind: "url", ref: "https://guides.example.test/hacer-negocios-mx-2026" }, active: true, updatedAt: "2026-09-01", topic: "taxes" });
    await expect(repo.upsert({ id: "bad", countryCode: "MX", title: "x", language: "es", version: "1", destination: { kind: "url", ref: "http://insecure" }, active: true, updatedAt: "2026-09-01" })).rejects.toThrow();
    const rs = await resolveResources(repo, { countryCode: "MX", language: "es", topic: "taxes" });
    expect(rs.map((r) => r.id)).toEqual(["dbm-es", "dbm-en"]);
  });
});
