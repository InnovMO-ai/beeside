/**
 * The Knowledge Layer contract, exercised through `createKnowledgeLayer` only — exactly what any consumer (Precision today) can rely on:
 * availability states (sufficient / partial / unavailable), units with full provenance, professional-boundary metadata, normalised
 * demand signals with no client text, country resources opened only through the layer.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeLayer } from "../contract";
import { InMemoryCountryResources } from "../country-resources";
import { InMemoryDemandRepository } from "../demand";
import { ingestDocument } from "../ingest";
import { InMemoryKnowledgeRepository } from "../memory-repo";
import { seedInitialSources } from "../registry";
import { createKnowledgeLayer } from "../service";

const NOW = "2026-10-15T10:00:00.000Z";
const FX = (n: string): Buffer => readFileSync(join(__dirname, "fixtures", n));

async function layer(opts: { ice?: boolean; onError?: (e: unknown) => void } = {}) {
  const knowledge = new InMemoryKnowledgeRepository();
  const demand = new InMemoryDemandRepository();
  const resources = new InMemoryCountryResources();
  await seedInitialSources(knowledge);
  if (opts.ice !== false) await ingestDocument(knowledge, { sourceId: "imco-ice", edition: "2025", locator: "https://imco.org.mx/indices/ice-fixture", now: NOW, title: "ICE (fixture)", filename: "ice.pdf", data: FX("ice-sintetico.pdf"), publishedAt: "2025-09-01" });
  const kl: KnowledgeLayer = createKnowledgeLayer({ knowledge, demand, resources, now: () => new Date(NOW), ...(opts.onError ? { onError: opts.onError } : {}) });
  return { kl, knowledge, demand, resources };
}
const ask = (kl: KnowledgeLayer, question: string, jurisdiction: string | null = "MX") => kl.request({ jurisdiction, intent: "answer_question", question, language: "es" });

describe("availability states", () => {
  it("SUFFICIENT: approved knowledge answers; every unit carries source, edition/version, jurisdiction, dates, authority class, risk, confidence and status", async () => {
    const { kl } = await layer();
    const r = await ask(kl, "¿Cómo está el mercado laboral y la informalidad?");
    expect(r.availability).toBe("sufficient");
    expect(r.reason).toBeUndefined();
    expect(r.recommends).toBe(false);
    expect(r.boundary).toBeNull();
    const u = r.units[0]!;
    expect(u.source).toMatchObject({
      sourceId: "imco-ice", institution: expect.stringMatching(/IMCO|Instituto/), documentTitle: "ICE (fixture)", edition: "2025", version: 1, jurisdiction: "MX",
      publishedAt: "2025-09-01", retrievedAt: NOW, locator: "https://imco.org.mx/indices/ice-fixture", authority: "trusted_institutional", risk: expect.stringMatching(/low|medium|high/), confidence: expect.stringMatching(/high|medium|low/), status: "active",
    });
    expect(u.source.roles).not.toContain("obligation");
    expect(u.wording).toBe("context");                      // an analytical institution never states a requirement
    expect(u.citation).toMatch(/ICE \(fixture\) \(2025\), /);
    expect(r.interpretation.topics.length).toBeGreaterThan(0);
  });

  it("PARTIAL (granularity): the state-level source speaks, the municipality is declared unknown, and the specialist is flagged", async () => {
    const { kl } = await layer();
    const r = await ask(kl, "¿Cómo está el mercado laboral en San Pedro Garza García?");
    expect(r.availability).toBe("partial");
    expect(r.reason).toBe("granularity");
    expect(r.units.length).toBeGreaterThan(0);
    expect(r.limits[0]).toMatchObject({ kind: "granularity", place: expect.stringMatching(/San Pedro/) });
    expect(r.unresolved).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "granularity" })]));
    expect(r.specialistNote).toBeTruthy();
    expect(r.units.every((u) => u.granularity !== "municipality")).toBe(true);
  });

  it("PARTIAL (professional boundary): context is given AND the boundary metadata names the specialist area; never a verdict", async () => {
    const { kl } = await layer();
    const r = await ask(kl, "¿Cuál es la mejor opción de estado para mi operación según el mercado laboral?");
    expect(r.availability).toBe("partial");
    expect(r.reason).toBe("professional_judgment");
    expect(r.units.length).toBeGreaterThan(0);
    expect(r.boundary).toMatchObject({ kind: "best_option", area: { es: expect.any(String), en: expect.any(String) }, specialistCategoryKey: null });
    expect(r.unresolved).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "professional_judgment" })]));
    expect(r.recommends).toBe(false);
  });

  it("UNAVAILABLE (no sources for the jurisdiction): nothing is guessed, no web", async () => {
    const { kl } = await layer();
    const r = await ask(kl, "¿Cómo está el mercado laboral?", "CL");
    expect(r).toMatchObject({ availability: "unavailable", reason: "no_sources", units: [] });
    expect((await kl.coverage("CL")).available).toBe(false);
    expect((await kl.coverage("MX")).available).toBe(true);
    expect(await ask(kl, "¿Cómo está el mercado laboral?", null)).toMatchObject({ availability: "unavailable", reason: "no_sources" });
  });

  it("a specific ask met only by neighbouring knowledge is PARTIAL: the neighbour is context, and what is unanswered is reported", async () => {
    const { kl } = await layer();
    const r = await ask(kl, "¿Qué requisitos tiene el IMMEX para una importación temporal?");
    expect(r).toMatchObject({ availability: "partial", reason: "no_hits" });
    expect(r.units.every((u) => !u.topics.includes("customs") && u.support === "contextual")).toBe(true);
    expect(r.unresolved).toEqual(expect.arrayContaining([{ kind: "topic_not_covered", topic: "customs" }]));
  });

  it("UNAVAILABLE (sources exist, nothing approved applies to the question)", async () => {
    const { kl } = await layer();
    expect(await ask(kl, "¿Cuánto cuesta el IVA?")).toMatchObject({ availability: "unavailable", reason: "no_hits", units: [], interpretation: { topic: "taxes" } });
    expect(await ask(kl, "¿Y si llueve ese día?")).toMatchObject({ availability: "unavailable", reason: "no_hits", interpretation: { topic: "unclassified" } });
  });

  it("UNAVAILABLE keeps the professional boundary: a determination with no context still names its specialist area", async () => {
    const { kl } = await layer();
    const r = await ask(kl, "¿Cuánto ISR voy a pagar este año?");
    expect(r).toMatchObject({ availability: "unavailable", reason: "professional_judgment", boundary: { kind: "tax_conclusion", specialistCategoryKey: "tax_accounting_audit" } });
  });

  it("project context (no question) uses the topics the consumer names", async () => {
    const { kl } = await layer();
    const r = await kl.request({ jurisdiction: "MX", intent: "project_context", topics: ["labor_market", "infrastructure"], language: "es" });
    expect(r.availability).toBe("sufficient");
    expect(r.units.every((u) => u.topics.some((t) => ["labor_market", "infrastructure"].includes(t)))).toBe(true);
  });

  it("a superseded edition is never returned; the newer edition is, with its version", async () => {
    const { kl, knowledge } = await layer();
    await ingestDocument(knowledge, { sourceId: "imco-ice", edition: "2026", locator: "https://imco.org.mx/indices/ice-2026", now: "2026-10-16T10:00:00.000Z", title: "ICE (fixture) 2026", filename: "ice2.pdf", data: Buffer.concat([FX("ice-sintetico.pdf"), Buffer.from("\n% edicion 2026\n")]) });
    const r = await ask(kl, "¿Cómo está el mercado laboral y la informalidad?");
    expect(r.units.length).toBeGreaterThan(0);
    expect(r.units.every((u) => u.source.status === "active")).toBe(true);
  });
});

describe("sufficiency is judged against the information intent (neighbouring knowledge is context, never the answer)", () => {
  const txt = (body: string): Buffer => Buffer.from(body, "utf8");
  async function withDoc(body: string, sourceId = "imco-ice") {
    const w = await layer({ ice: false });
    await ingestDocument(w.knowledge, { sourceId, edition: "2025", locator: sourceId === "imss" ? "https://www.imss.gob.mx/doc-fixture" : "https://imco.org.mx/indices/doc-fixture", now: NOW, title: "Doc (fixture)", filename: "doc.txt", data: txt(body), publishedAt: "2025-09-01" });
    return w;
  }
  const LABOR_PICTURE = "La informalidad laboral es alta en varias entidades: una parte importante de la población ocupada no cuenta con seguridad social. La participación laboral y el mercado de trabajo varían entre estados.";

  it("BROAD ask: the labour-market picture is answered collectively by its family (informality is a component) -> sufficient", async () => {
    const { kl } = await withDoc("La informalidad laboral es alta en varias entidades: una parte importante de la población ocupada trabaja sin seguridad social.");
    const r = await ask(kl, "Cuéntame sobre el mercado laboral");
    expect(r.interpretation.topic).toBe("labor_market");
    expect(r.availability).toBe("sufficient");
    expect(r.units.length).toBeGreaterThan(0);
    expect(r.units.every((u) => u.support === "direct")).toBe(true);
    expect(r.unresolved).toEqual([]);
  });

  it("SPECIFIC ask (mandatory employee benefits): general labour-market/informality knowledge does NOT make it sufficient -> partial, and it is only context", async () => {
    const { kl } = await withDoc(LABOR_PICTURE);
    const r = await ask(kl, "¿Cuáles son las prestaciones obligatorias de los empleados en México?");
    expect(r.interpretation).toMatchObject({ topic: "wages", subtopic: "mandatory_benefits" });
    expect(r.availability).toBe("partial");
    expect(r.reason).toBe("no_hits");
    expect(r.units.length).toBeGreaterThan(0);
    expect(r.units.every((u) => u.support === "contextual")).toBe(true);
    expect(r.unresolved).toEqual(expect.arrayContaining([{ kind: "topic_not_covered", topic: "wages" }]));
  });

  it("a RULE ask is never answered by analytical or curated context, however closely it talks about the topic (authority fit)", async () => {
    const { kl } = await withDoc(`Prestaciones obligatorias: el aguinaldo equivale a quince días de salario y la prima vacacional es de al menos el veinticinco por ciento.`);
    const r = await ask(kl, "¿Cuáles son las prestaciones obligatorias de los empleados en México?");
    expect(r.interpretation.infoType).toBe("regulatory_requirement");
    expect(r.availability).toBe("partial");
    expect(r.units.every((u) => u.support === "contextual" && u.wording === "context")).toBe(true);
  });

  it("SPECIFIC rule ask answered by an official source that speaks to the subtopic -> sufficient, that unit is direct and first", async () => {
    const { kl } = await withDoc(`${LABOR_PICTURE}\n\nPrestaciones obligatorias: el aguinaldo equivale a quince días de salario y la prima vacacional es de al menos el veinticinco por ciento. Los salarios deben pagarse en moneda de curso legal.`, "imss");
    const r = await ask(kl, "¿Cuáles son las prestaciones obligatorias de los empleados en México?");
    expect(r.availability).toBe("sufficient");
    expect(r.units[0]!.support).toBe("direct");
    expect(r.units[0]!.text).toMatch(/aguinaldo/);
  });

  it("SPECIFIC ask met only by a sibling topic in the same family (customs asked, exports known) -> partial, never sufficient", async () => {
    const { kl } = await withDoc("Las exportaciones manufactureras explican parte de la diferencia entre estados y el comercio exterior se concentra en pocas entidades.");
    const r = await ask(kl, "¿Qué requisitos tiene el IMMEX para una importación temporal?");
    expect(r.interpretation).toMatchObject({ topic: "customs", subtopic: "duty_regimes" });
    expect(r.availability).toBe("partial");
    expect(r.units.every((u) => u.support === "contextual")).toBe(true);
  });

  it("nothing in the asked theme at all -> unavailable (a neighbour from another theme is noise, not partial knowledge)", async () => {
    const { kl } = await withDoc("Las exportaciones manufactureras explican parte de la diferencia entre estados.");
    expect(await ask(kl, "¿Cuántos días de vacaciones corresponden por ley?")).toMatchObject({ availability: "unavailable" });
  });

  it("a second theme in the question must be covered on its own", async () => {
    const { kl } = await withDoc(LABOR_PICTURE);
    const r = await ask(kl, "Cuéntame sobre el mercado laboral y la infraestructura");
    expect(r.availability).toBe("partial");
    expect(r.unresolved).toEqual(expect.arrayContaining([{ kind: "topic_not_covered", topic: "infrastructure" }]));
  });

  it("every topic belongs to a family (the taxonomy is exhaustive)", async () => {
    const { TOPIC_FAMILY } = await import("../sufficiency");
    const { TOPICS } = await import("../types");
    for (const t of TOPICS) expect(TOPIC_FAMILY[t]).toBeDefined();
  });
});

describe("interpretation", () => {
  it("reads a question in the layer's vocabularies, including the professional boundary, without storing it", async () => {
    const { kl, demand } = await layer();
    const i = await kl.interpret("¿Puedo deducir los gastos de la matriz del ISR?");
    expect(i).toMatchObject({ topic: "taxes", boundary: { kind: "tax_conclusion" } });
    expect(await demand.list({})).toEqual([]);
  });
});

describe("demand signals", () => {
  const signal = { country: "MX", topic: "customs", subtopic: "duty_regimes", infoType: "regulatory_requirement", categoryKey: "international_trade_customs", serviceKey: "CAP_X", outcome: { coverage: "none", reason: "no_hits" } } as const;

  it("the layer aggregates normalised signals; a covered question registers nothing", async () => {
    const { kl, demand } = await layer();
    const a = await kl.recordDemand({ projectId: "p1", turnKey: "t1" }, signal);
    expect(a).toMatchObject({ topic: "customs", subtopic: "duty_regimes", coverage: "absent", disposition: "candidate_knowledge", reason: "no_hits", boundary: null });
    await kl.recordDemand({ projectId: "p2", turnKey: "t1" }, signal);
    const rows = await demand.list({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ occurrences: 2, projects: 2, status: "open" });
    expect(await kl.recordDemand({ projectId: "p3", turnKey: "t1" }, { ...signal, outcome: { coverage: "full", reason: "no_hits" } })).toBeNull();
  });

  it("a professional-boundary signal is specialist work and carries the boundary back as metadata", async () => {
    const { kl } = await layer();
    const r = await kl.recordDemand({ projectId: "p1", turnKey: "t1" }, { ...signal, topic: "taxes", subtopic: "income_tax", infoType: "tax_treatment", outcome: { coverage: "none", reason: "no_hits", boundary: "tax_conclusion" } });
    expect(r).toMatchObject({ disposition: "specialist_service", reason: "professional_judgment", boundary: { kind: "tax_conclusion" } });
  });

  it("is best-effort: a failing store never throws into the consumer's turn, and a free-form signal is refused", async () => {
    const errs: unknown[] = [];
    const { kl, demand } = await layer({ onError: (e) => errs.push(e) });
    await expect(kl.recordDemand({ projectId: "p", turnKey: "t" }, { ...signal, subtopic: "texto libre del cliente" } as never)).resolves.toBeDefined();
    expect(errs).toHaveLength(1);
    expect(await demand.list({})).toEqual([]);
  });
});

describe("country resources", () => {
  it("are listed without their destination and opened only while active and https", async () => {
    const { kl, resources } = await layer();
    await resources.upsert({ id: "dbm", countryCode: "MX", title: "beeside Doing Business México", language: "es", version: "2026", destination: { kind: "url", ref: "https://cdn.example.test/d/8f3a1c?sig=1" }, active: true, updatedAt: "2026-09-01", resourceType: "pdf" });
    await resources.upsert({ id: "old", countryCode: "MX", title: "Old", language: "en", version: "2025", destination: { kind: "url", ref: "https://guides.example.test/old.pdf" }, active: false, updatedAt: "2025-09-01" });
    const list = await kl.resources({ country: "MX", language: "es" });
    expect(list).toEqual([{ id: "dbm", country: "MX", title: "beeside Doing Business México", language: "es", version: "2026" }]);
    expect(JSON.stringify(list)).not.toMatch(/https?:/);
    expect(await kl.openResource("dbm")).toEqual({ id: "dbm", title: "beeside Doing Business México", url: "https://cdn.example.test/d/8f3a1c?sig=1", type: "pdf" });
    expect(await kl.openResource("old")).toBeNull();
    expect(await kl.openResource("missing")).toBeNull();
  });
});
