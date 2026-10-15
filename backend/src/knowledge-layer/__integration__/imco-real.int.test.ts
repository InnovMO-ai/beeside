/**
 * REAL IMCO publications through the permanent Knowledge feed (no synthetic data): ICE 2025 (libro) and its Anexo Metodológico.
 * The files are not part of the repository; point IMCO_ICE_LIBRO and IMCO_ICE_ANEXO at them. Without them the suite is skipped.
 */
import { existsSync, readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { createSavepointDb, type Db } from "../../db/database";
import { databaseUrl, describeWithDb } from "../../__integration__/fa-harness";
import { seedInitialSources } from "../registry";
import { ingestDocument } from "../ingest";
import { citation, retrieve, wordingClass } from "../retrieve";
import { orient } from "../orient";
import { createPgKnowledgeRepository } from "../pg-repo";
import { MX_STATES } from "../geo";
import { createKnowledgeLayer } from "../service";
import { createPgCountryResources, createPgDemandRepository } from "../pg-repo";

const LIBRO = process.env.IMCO_ICE_LIBRO ?? "";
const ANEXO = process.env.IMCO_ICE_ANEXO ?? "";
const BOLETAS = process.env.IMCO_ICE_BOLETAS ?? "";
const have = existsSync(LIBRO) && existsSync(ANEXO);
const NOW = "2026-10-14T12:00:00.000Z";
const LOCATOR = "https://imco.org.mx/indices/indice-de-competitividad-estatal-2025/";

(have ? describeWithDb : describe.skip)("Real IMCO ICE 2025 -> Knowledge feed (PostgreSQL)", () => {
  let pool: Pool;
  let client: PoolClient;
  let db: Db;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 2 }); });
  afterAll(() => pool.end());

  async function ingestBoth() {
    const repo = createPgKnowledgeRepository(db);
    await seedInitialSources(repo);
    const libro = await ingestDocument(repo, { sourceId: "imco-ice", title: "Índice de Competitividad Estatal 2025", edition: "2025", locator: LOCATOR, filename: "ICE-2025-libro.pdf", data: readFileSync(LIBRO), now: NOW, publishedAt: "2025-06-09", topics: ["competitiveness_state", "labor_market", "infrastructure", "economy_innovation", "rule_of_law", "government", "education_talent"] });
    const anexo = await ingestDocument(repo, { sourceId: "imco-ice", title: "Anexo Metodológico ICE 2025", edition: "2025", locator: `${LOCATOR}anexo`, filename: "ICE-2025-Anexo-Metodologico.pdf", data: readFileSync(ANEXO), now: NOW, publishedAt: "2025-06-09", topics: ["competitiveness_state"] });
    return { repo, libro, anexo };
  }
  beforeEach(async () => { client = await pool.connect(); await client.query("BEGIN"); db = createSavepointDb(client); });
  afterEach(async () => { await client.query("ROLLBACK"); client.release(); });

  it("ingests both publications into the same feed, versioned, with provenance and state-level indicators for all 32 entities", async () => {
    const { repo, libro, anexo } = await ingestBoth();
    expect(libro.status).toBe("ingested");
    expect(anexo.status).toBe("ingested");
    if (libro.status !== "ingested" || anexo.status !== "ingested") throw new Error("not ingested");
    expect(libro.document).toMatchObject({ version: 1, status: "active", jurisdiction: "MX", sourceId: "imco-ice" });
    expect(libro.passages).toBeGreaterThan(1500);
    expect(anexo.passages).toBeGreaterThan(10);

    // every state has its sheet: 53 published indicators each (Tlaxcala's debt-cost cell is published as "-" and is NOT invented)
    const rows = await db.query<{ unit: string; n: string }>(
      `SELECT ind->>'unit' AS unit, count(*)::text AS n FROM knowledge_passage p, jsonb_array_elements(p.indicators) ind WHERE p.document_id = $1 AND ind->>'unitKind' = 'state' GROUP BY 1`, [libro.document.id],
    );
    expect(rows.rows.map((r) => r.unit).sort()).toEqual([...MX_STATES].sort());
    for (const r of rows.rows) expect(Number(r.n)).toBe(r.unit === "Tlaxcala" ? 52 : 53);

    // re-ingesting the same bytes is a no-op; a corrected republication creates a NEW version and supersedes the old one
    const again = await ingestDocument(repo, { sourceId: "imco-ice", title: "Anexo Metodológico ICE 2025", edition: "2025", locator: `${LOCATOR}anexo`, filename: "ICE-2025-Anexo-Metodologico.pdf", data: readFileSync(ANEXO), now: NOW });
    expect(again.status).toBe("unchanged");
    const republished = await ingestDocument(repo, { sourceId: "imco-ice", title: "Anexo Metodológico ICE 2025", edition: "2025 (corrección)", locator: `${LOCATOR}anexo`, filename: "ICE-2025-Anexo-Metodologico.pdf", data: Buffer.concat([readFileSync(ANEXO), Buffer.from("\n% republished\n")]), now: NOW });
    expect(republished.status).toBe("ingested");
    if (republished.status === "ingested") { expect(republished.document.version).toBe(2); expect(republished.supersededId).toBe(anexo.document.id); }
    const active = await retrieve(repo, { text: "variables ancla inversión talento", jurisdiction: "MX", topics: ["competitiveness_state"], limit: 20 });
    expect(active.length).toBeGreaterThan(0);
    expect(active.every((h) => h.provenance.documentStatus === "active")).toBe(true);
    const withOld = await retrieve(repo, { text: "variables ancla inversión talento", jurisdiction: "MX", includeSuperseded: true, limit: 40 });
    expect(withOld.some((h) => h.provenance.documentStatus === "superseded")).toBe(true);
  }, 120000);

  it("retrieves labor, infrastructure and economic/investment context by state, citing the publication and page, as analytical context only", async () => {
    const { repo } = await ingestBoth();
    for (const [topic, text, expect_] of [
      ["labor_market", "informalidad laboral mercado de trabajo Querétaro", /Informalidad|Mercado de trabajo|Tasa de participación/i],
      ["infrastructure", "acceso a internet telefonía móvil infraestructura Nuevo León", /Acceso a internet|Telefonía|Infraestructura/i],
      ["foreign_investment", "inversión extranjera directa Coahuila", /Inversión extranjera directa/i],
    ] as const) {
      const state = text.split(" ").slice(-1)[0] === "León" ? "Nuevo León" : /Coahuila/.test(text) ? "Coahuila" : "Querétaro";
      const hits = await retrieve(repo, { text, topics: [topic], jurisdiction: "MX", units: [state], limit: 8 });
      expect(hits.length).toBeGreaterThan(0);
      const stateHits = hits.filter((h) => h.passage.indicators.some((i) => i.unit === state));
      expect(stateHits.length).toBeGreaterThan(0);
      expect(stateHits.some((h) => expect_.test(h.passage.text))).toBe(true);
      for (const h of hits) {
        expect(h.provenance.institution).toMatch(/IMCO/);
        expect(h.provenance.authority).toBe("trusted_institutional");
        expect(h.mayGroundObligation).toBe(false);
        expect(wordingClass(h)).toBe("context");
        expect(citation(h.provenance)).toMatch(/Índice de Competitividad Estatal \(2025\).*p\. \d+/);
      }
    }
  }, 120000);

  it("a known published cell is carried exactly (value and position), and a two-state comparison follows the published position", async () => {
    const { repo } = await ingestBoth();
    const hits = await retrieve(repo, { text: "Campeche informalidad laboral", topics: ["informality"], jurisdiction: "MX", units: ["Campeche"], limit: 10 });
    const cell = hits.flatMap((h) => h.passage.indicators).find((i) => i.unit === "Campeche" && /^Informalidad laboral$/.test(i.name));
    expect(cell).toMatchObject({ value: 60, rank: 21, unitKind: "state" });

    const o = await orient(repo, { text: "Estoy entre Nuevo León y Querétaro", jurisdiction: "MX", topics: ["labor_market", "infrastructure"], candidates: ["Nuevo León", "Querétaro"] });
    expect(o.recommends).toBe(false);
    expect(o.comparison?.rows.length).toBeGreaterThan(3);
    for (const r of o.comparison!.rows) {
      const ranked = r.entries.filter((e) => e.rank !== undefined);
      if (ranked.length === r.entries.length) expect(r.leader).toBe([...ranked].sort((a, b) => a.rank! - b.rank!)[0]!.unit);
      for (const e of r.entries) expect(citation(e.hit.provenance)).toMatch(/IMCO/);
    }
  }, 120000);

  // the permanent flow: real IMCO source -> Knowledge Layer ingestion/publication -> consumer request -> layer response (never the store)
  it("through the CONTRACT: real IMCO published in the layer answers a Precision-style request with full provenance; PARTIAL and NO-knowledge states are explicit", async () => {
    const { repo, libro, anexo } = await ingestBoth();
    if (libro.status !== "ingested" || anexo.status !== "ingested") throw new Error("not ingested");
    const kl = createKnowledgeLayer({ knowledge: repo, demand: createPgDemandRepository(db), resources: createPgCountryResources(db), now: () => new Date(NOW) });

    // SUFFICIENT: labor market, with IMCO's edition/version/publication date/authority class/risk/confidence and a checkable citation
    const labor = await kl.request({ jurisdiction: "MX", intent: "answer_question", question: "¿Qué dice IMCO sobre el mercado de trabajo y la informalidad laboral?", language: "es" });
    expect(labor.availability).toBe("sufficient");
    expect(labor.units.length).toBeGreaterThan(0);
    for (const u of labor.units) {
      expect(u.source).toMatchObject({ sourceId: "imco-ice", edition: "2025", version: 1, jurisdiction: "MX", publishedAt: "2025-06-09", authority: "trusted_institutional", status: "active" });
      expect([libro.document.id, anexo.document.id]).toContain(u.source.documentId);
      expect(u.source.risk).toBeDefined();
      expect(u.source.confidence).toBeDefined();
      expect(u.wording).toBe("context");
      expect(u.citation).toMatch(/(Índice de Competitividad Estatal|Anexo Metodológico ICE) \(2025\).*p\. \d+/);
    }

    // SUFFICIENT with a comparison: two candidate states, ranked by the published position, never a recommendation
    const cmp = await kl.request({ jurisdiction: "MX", intent: "project_context", topics: ["labor_market", "infrastructure"], context: { candidates: ["Nuevo León", "Querétaro"] }, language: "es" });
    expect(cmp.recommends).toBe(false);
    expect(cmp.comparison?.rows.length).toBeGreaterThan(3);
    expect(cmp.comparison?.summary.es).toMatch(/no una recomendación/);

    // PARTIAL: a municipality is outside the state-level source -> the limit is declared, state context is labelled, specialist flagged
    const city = await kl.request({ jurisdiction: "MX", intent: "answer_question", question: "¿Cómo está el mercado laboral en Apodaca?", language: "es" });
    expect(city).toMatchObject({ availability: "partial", reason: "granularity" });
    expect(city.limits[0]).toMatchObject({ kind: "granularity", place: "Apodaca" });
    expect(city.units.every((u) => u.granularity !== "municipality")).toBe(true);

    // PARTIAL: a determination -> context plus the professional boundary
    const best = await kl.request({ jurisdiction: "MX", intent: "answer_question", question: "¿Cuál es la mejor opción de estado para mi operación según el mercado de trabajo?", language: "es" });
    expect(best).toMatchObject({ availability: "partial", reason: "professional_judgment", boundary: { kind: "best_option" }, recommends: false });
    expect(best.units.length).toBeGreaterThan(0);

    // intent-based sufficiency on real data: the broad labour-market picture is answered by IMCO; mandatory employee benefits are NOT (IMCO says nothing about them)
    const broad = await kl.request({ jurisdiction: "MX", intent: "answer_question", question: "Cuéntame sobre el mercado laboral en Nuevo León", language: "es" });
    expect(broad.availability).toBe("sufficient");
    const benefits = await kl.request({ jurisdiction: "MX", intent: "answer_question", question: "¿Cuáles son las prestaciones obligatorias de los empleados en México?", language: "es" });
    expect(benefits.availability).not.toBe("sufficient");
    expect(benefits.units.every((u) => u.support === "contextual")).toBe(true);
    expect(benefits.unresolved).toEqual(expect.arrayContaining([{ kind: "topic_not_covered", topic: "wages" }]));

    // a tax DETERMINATION is never answered by IMCO: whatever context exists is worded as context, never as an obligation, and the specialist area is named
    const tax = await kl.request({ jurisdiction: "MX", intent: "answer_question", question: "¿Cuánto ISR voy a pagar este año?", language: "es" });
    expect(tax.availability).not.toBe("sufficient");
    expect(tax.boundary).toMatchObject({ kind: "tax_conclusion", specialistCategoryKey: "tax_accounting_audit" });
    expect(tax.units.every((u) => u.wording === "context" && u.source.authority === "trusted_institutional")).toBe(true);

    // UNAVAILABLE: a country without approved sources has nothing — nothing is borrowed from another country
    expect(await kl.request({ jurisdiction: "CL", intent: "answer_question", question: "¿Cómo está el mercado laboral?", language: "es" })).toMatchObject({ availability: "unavailable", reason: "no_sources", units: [] });

    // the unmet part comes back as a normalised demand signal, aggregated by the layer
    const receipt = await kl.recordDemand({ projectId: "p-real", turnKey: "t-real" }, { country: "MX", topic: tax.interpretation.topic, subtopic: tax.interpretation.subtopic, infoType: tax.interpretation.infoType, categoryKey: "tax_accounting_audit", serviceKey: null, outcome: { coverage: "none", reason: "no_hits", boundary: "tax_conclusion" } });
    expect(receipt).toMatchObject({ disposition: "specialist_service", reason: "professional_judgment", boundary: { kind: "tax_conclusion" } });
  }, 120000);

  it("granularity and authority guards hold on the real data: state level only, never a legal or tax authority", async () => {
    const { repo } = await ingestBoth();
    const city = await orient(repo, { text: "El parque industrial estaría en Apodaca", jurisdiction: "MX", topics: ["labor_market", "infrastructure"] });
    expect(city.limits[0]).toMatchObject({ place: "Apodaca", state: "Nuevo León", availableLevel: "state" });
    expect(city.sherpaFlag).toBeDefined();
    expect(city.hits.every((h) => h.passage.granularity !== "municipality")).toBe(true);

    // nothing in this feed can ground an obligation
    const obligations = await retrieve(repo, { text: "cuotas obrero-patronales IMSS obligaciones fiscales", topics: ["social_security", "taxes"], jurisdiction: "MX", authorities: ["official_primary"] });
    expect(obligations).toEqual([]);
    const all = await retrieve(repo, { text: "cuotas obrero-patronales", jurisdiction: "MX", limit: 20 });
    expect(all.every((h) => !h.mayGroundObligation)).toBe(true);
  }, 120000);

  // the per-state bulletins ("Boletas") publish the same sheets as the book: they are a cross-check, not a second source of facts
  (existsSync(BOLETAS) ? it : it.skip)("the Boletas carry exactly the state sheets of the book (independent corroboration; not ingested twice)", async () => {
    const { extractPdf } = await import("../extract");
    const rowsOf = (file: string): string[] =>
      extractPdf(readFileSync(file)).filter((x) => x.row).map((x) => [x.row!.Estado, x.row!.Subíndice, x.row!.Indicador, x.row!.Valor, x.row!.Posición ?? ""].join("|")).sort();
    const [b, l] = [rowsOf(BOLETAS), rowsOf(LIBRO)];
    expect(b.length).toBe(1695); // 32 states x 53 indicators, minus the one cell published as "-"
    expect(b).toEqual(l);
  }, 240000);
});
