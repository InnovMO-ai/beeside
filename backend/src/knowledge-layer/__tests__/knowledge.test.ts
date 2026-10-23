import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INITIAL_SOURCES, RegistryError, registerSource, seedInitialSources, validateSource } from "../registry";
import { InMemoryKnowledgeRepository } from "../memory-repo";
import { ingestDocument } from "../ingest";
import { citation, retrieve, wordingClass } from "../retrieve";
import { describeComparison, orient } from "../orient";
import { buildRefsFor, resolveRef } from "../refs";
import { InMemoryCandidateStore, applyCandidate, decideCandidate, isDue, reviewPath, runAgentCycle, type SourceFetcher } from "../agent";
import { InMemoryCountryResources, isOpenable, offerResource, resolveResources } from "../country-resources";
import { findPlaces, findStates } from "../geo";
import type { KnowledgeSource } from "../types";

const FX = (n: string): Buffer => readFileSync(join(__dirname, "fixtures", n));
const NOW = "2026-10-14T12:00:00.000Z";
const IMCO_URL = "https://imco.org.mx/indices/ice-fixture";

async function world() {
  const repo = new InMemoryKnowledgeRepository();
  await seedInitialSources(repo);
  const base = { sourceId: "imco-ice", edition: "2025", locator: IMCO_URL, now: NOW, publishedAt: "2025-09-01" };
  await ingestDocument(repo, { ...base, title: "Índice de Competitividad Estatal (fixture)", filename: "ice.pdf", data: FX("ice-sintetico.pdf") });
  await ingestDocument(repo, { ...base, title: "ICE datos estatales (fixture)", filename: "ice.csv", data: FX("ice-datos-estatales.csv") });
  await ingestDocument(repo, { sourceId: "imss", title: "Cuotas (fixture oficial)", edition: "2026", locator: "https://www.imss.gob.mx/fixture", filename: "c.txt", data: FX("cuotas-oficial.txt"), now: NOW });
  return repo;
}

describe("Source Registry", () => {
  it("accepts the initial sources and respects the hierarchy", () => {
    for (const s of INITIAL_SOURCES) expect(validateSource(s)).toEqual([]);
  });
  it("analytical sources can never ground obligations", async () => {
    const bad: KnowledgeSource = { ...INITIAL_SOURCES[0]!, id: "bad-imco", roles: ["obligation"] };
    expect(validateSource(bad).join()).toMatch(/obligations/);
    await expect(registerSource(new InMemoryKnowledgeRepository(), bad)).rejects.toBeInstanceOf(RegistryError);
  });
  it("high-risk sources require review", () => {
    expect(validateSource({ ...INITIAL_SOURCES[1]!, reviewRequired: false }).join()).toMatch(/review/);
  });
  it("rejects documents from unregistered sources and from hosts outside the approved domains", async () => {
    const repo = await world();
    await expect(ingestDocument(repo, { sourceId: "nope", title: "x", edition: "1", locator: "x", filename: "a.txt", data: Buffer.from("x"), now: NOW })).rejects.toBeInstanceOf(RegistryError);
    await expect(ingestDocument(repo, { sourceId: "imco-ice", title: "y", edition: "1", locator: "https://evil.example.com/a", filename: "a.txt", data: Buffer.from("hola mundo"), now: NOW })).rejects.toBeInstanceOf(RegistryError);
  });
});

describe("IMCO ingestion proof (A–G) through the permanent pattern, with a synthetic fixture", () => {
  it("A. labor-market passage is retrievable", async () => {
    const hits = await retrieve(await world(), { text: "mercado laboral informalidad salarios", topics: ["labor_market"], jurisdiction: "MX" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.passage.text.toLowerCase()).toMatch(/laboral/);
  });
  it("B. infrastructure passage is retrievable", async () => {
    const hits = await retrieve(await world(), { text: "infraestructura portuaria carretera", topics: ["infrastructure"], jurisdiction: "MX" });
    expect(hits[0]!.passage.text).toMatch(/portuaria|infraestructura/i);
  });
  it("C. economic / investment context is retrievable", async () => {
    const hits = await retrieve(await world(), { text: "inversión extranjera directa exportaciones", topics: ["foreign_investment"], jurisdiction: "MX" });
    expect(hits[0]!.passage.text).toMatch(/inversi/i);
  });
  it("D. state-level data comes back structured and comparable", async () => {
    const repo = await world();
    const o = await orient(repo, { text: "mercado laboral infraestructura", jurisdiction: "MX", topics: ["labor_market", "infrastructure"], states: ["Nuevo León", "Querétaro"] });
    expect(o.comparison?.rows.length).toBeGreaterThan(0);
    const row = o.comparison!.rows.find((r) => r.criterion === "Mercado de trabajo")!;
    expect(row.entries.map((e) => e.unit).sort()).toEqual(["Nuevo León", "Querétaro"]);
    expect(row.leader).toBe("Nuevo León");
    expect(o.recommends).toBe(false);
    const text = describeComparison(o.comparison!, "es");
    expect(text).toMatch(/no una recomendación/);
  });
  it("E. provenance is returned with every hit", async () => {
    const hits = await retrieve(await world(), { text: "mercado laboral", topics: ["labor_market"], jurisdiction: "MX" });
    const p = hits[0]!.provenance;
    expect(p.institution).toMatch(/IMCO/);
    expect(p.documentTitle).toMatch(/fixture/);
    expect(p.edition).toBe("2025");
    expect(p.version).toBe(1);
    expect(p.publishedAt).toBe("2025-09-01");
    expect(p.retrievedAt).toBe(NOW);
    expect(p.locator).toBe(IMCO_URL);
    expect(p.location).toMatch(/p\. 1|fila/);
    expect(citation(p)).toMatch(/IMCO.*2025/);
  });
  it("F. rejects municipality-level inference: a state-level source cannot speak about a city", async () => {
    const o = await orient(await world(), { text: "talento mercado laboral", jurisdiction: "MX", topics: ["labor_market", "education_talent"], states: ["Nuevo León"], finerThanState: true });
    expect(o.limits).toHaveLength(1);
    expect(o.limits[0]!.availableLevel).toBe("state");
    // the layer never saw the place: the wording keeps a slot the consumer fills with the place the client named
    expect(o.limits[0]!.message.es).toMatch(/no te daré una lectura de \{place\} en sí/);
    expect(o.limits[0]!.message.es).toMatch(/Nuevo León/);
    expect(o.sherpaFlag?.reason).toMatch(/municipal/);
    expect(o.hits.every((h) => h.passage.granularity !== "municipality")).toBe(true);
  });
  it("G. distinguishes analytical context from regulatory/legal authority", async () => {
    const repo = await world();
    const imco = await retrieve(repo, { text: "mercado laboral", topics: ["labor_market"], jurisdiction: "MX", authorities: ["trusted_institutional"] });
    expect(imco.length).toBeGreaterThan(0);
    for (const h of imco) { expect(h.mayGroundObligation).toBe(false); expect(wordingClass(h)).toBe("context"); }
    const official = await retrieve(repo, { text: "cuotas obrero-patronales inscribir trabajadores", topics: ["social_security"], jurisdiction: "MX", authorities: ["official_primary"] });
    expect(official[0]!.mayGroundObligation).toBe(true);
    expect(wordingClass(official[0]!)).toBe("obligation");
  });
  it("also ingests DOCX through the same path", async () => {
    const repo = new InMemoryKnowledgeRepository();
    await seedInitialSources(repo);
    const r = await ingestDocument(repo, { sourceId: "imco-ice", title: "Docx", edition: "x", locator: IMCO_URL, filename: "a.docx", data: FX("ice-sintetico.docx"), now: NOW });
    expect(r.status).toBe("ingested");
    const hits = await retrieve(repo, { text: "participación laboral", jurisdiction: "MX" });
    expect(hits[0]!.provenance.location).toMatch(/§ Mercado de trabajo/);
  });
});

describe("Versioning and supersession", () => {
  it("a new edition is a new version that supersedes the old; never a silent overwrite", async () => {
    const repo = await world();
    const same = await ingestDocument(repo, { sourceId: "imco-ice", title: "Índice de Competitividad Estatal (fixture)", edition: "2025", locator: IMCO_URL, filename: "ice.pdf", data: FX("ice-sintetico.pdf"), now: NOW });
    expect(same.status).toBe("unchanged");
    const v2 = await ingestDocument(repo, { sourceId: "imco-ice", title: "Índice de Competitividad Estatal (fixture)", edition: "2027", locator: IMCO_URL, filename: "ice.txt", data: FX("ice-sintetico-v2.txt"), now: "2027-10-01T00:00:00.000Z" });
    expect(v2.status).toBe("ingested");
    if (v2.status !== "ingested") throw new Error();
    expect(v2.document.version).toBe(2);
    const old = await repo.getDocument(v2.supersededId!);
    expect(old?.status).toBe("superseded");
    expect(old?.supersededById).toBe(v2.document.id);
    const current = await retrieve(repo, { text: "participación laboral formal", topics: ["labor_market"], jurisdiction: "MX", authorities: ["trusted_institutional"] });
    expect(current.every((h) => h.provenance.documentStatus === "active")).toBe(true);
    expect(current[0]!.provenance.edition).toBe("2027");
    const all = await retrieve(repo, { text: "participación laboral formal", topics: ["labor_market"], jurisdiction: "MX", includeSuperseded: true, limit: 20 });
    expect(all.some((h) => h.provenance.documentStatus === "superseded")).toBe(true);
  });
});

describe("Granularity helpers", () => {
  it("tells states from places", () => {
    expect(findStates("Nuevo León y Querétaro")).toEqual(expect.arrayContaining(["Nuevo León", "Querétaro"]));
    expect(findPlaces("Nuevo León")).toEqual([]);
    expect(findPlaces("Monterrey o Saltillo").map((p) => p.name)).toEqual(["Monterrey", "Saltillo"]);
    expect(findPlaces("municipio de Apodaca").map((p) => p.name)).toContain("Apodaca");
    expect(findStates("Baja California Sur")).toEqual(["Baja California Sur"]);
    expect(findStates("Ciudad de México")).toEqual(["Ciudad de México"]);
  });
});

describe("Findings references", () => {
  it("refsFor feeds findings with traceable references, official first", async () => {
    const repo = await world();
    const refs = await buildRefsFor(repo, "MX");
    const r = refs("employment_benefits");
    expect(r.length).toBeGreaterThan(0);
    const first = await resolveRef(repo, r[0]!);
    expect(first?.source.authority).toBe("official_primary");
  });
});

describe("Knowledge Agent", () => {
  const fetcher = (urls: { url: string; data: Buffer; title: string }[]): SourceFetcher => ({
    fetch: async () => urls.map((u) => ({ url: u.url, title: u.title, edition: "2026-Q4", filename: "a.txt", data: u.data })),
  });
  it("applies review by risk and only acts on registered sources and approved hosts", async () => {
    const repo = new InMemoryKnowledgeRepository();
    await seedInitialSources(repo);
    const store = new InMemoryCandidateStore();
    const rep = await runAgentCycle(repo, store, fetcher([
      { url: "https://www.sat.gob.mx/nuevo", title: "Criterio X", data: Buffer.from("Texto de prueba sobre impuesto sobre la renta.") },
      { url: "https://evil.example.com/x", title: "Z", data: Buffer.from("no") },
    ]), NOW);
    expect(rep.skipped.some((s) => s.reason.startsWith("host_not_approved"))).toBe(true);
    const pending = await store.list("pending_review");
    expect(pending.length).toBeGreaterThan(0);
    expect(pending[0]!.reviewReason).toBe("high_risk_source");
    expect(await repo.listDocuments()).toHaveLength(0); // nothing goes live without review
    const id = pending[0]!.id;
    await expect(applyCandidate(repo, store, id, NOW)).rejects.toThrow(/not approved/);
    await decideCandidate(store, id, "approved");
    const res = await applyCandidate(repo, store, id, NOW);
    expect(res.status).toBe("ingested");
    expect((await repo.listDocuments()).length).toBe(1);
  });
  it("cadence and review policy", () => {
    const imco = INITIAL_SOURCES[0]!;
    expect(isDue(imco, null, NOW)).toBe(true);
    expect(isDue(imco, "2026-01-01T00:00:00Z", NOW)).toBe(false);
    expect(reviewPath(imco).review).toBe(true);
    expect(reviewPath({ ...imco, authority: "secondary", risk: "low", reviewRequired: false }).review).toBe(false);
    expect(isDue({ ...imco, active: false }, null, NOW)).toBe(false);
  });
});

describe("Country Resource Library", () => {
  const mk = (over: object = {}) => ({ id: "r1", countryCode: "MX", title: "Doing Business in Mexico", language: "en", version: "2026", destination: { kind: "url" as const, ref: "https://example.org/dbm.pdf" }, active: true, updatedAt: "2026-09-01", ...over });
  it("validates, resolves the newest active version in the client language, and offers contextually and once", async () => {
    const repo = new InMemoryCountryResources();
    await expect(repo.upsert(mk({ destination: { kind: "url", ref: "http://x" } }))).rejects.toThrow(/https/);
    await repo.upsert(mk());
    await repo.upsert(mk({ id: "r2", version: "2027", updatedAt: "2027-01-01", destination: { kind: "url", ref: "https://example.org/dbm27.pdf" } }));
    await repo.upsert(mk({ id: "r3", language: "es", title: "Hacer negocios en México", topic: "taxes" }));
    await repo.upsert(mk({ id: "r4", active: false, title: "Old" }));
    const rs = await resolveRef0(repo);
    expect(rs.map((r) => r.id)).toEqual(["r3", "r2"]);
    expect(rs.some((r) => r.id === "r1")).toBe(false);
    const off = offerResource(rs, { topics: ["taxes"], alreadyOffered: [], language: "es" })!;
    expect(off.text.es).toMatch(/No es necesario leerlo/);
    expect(offerResource(rs, { topics: ["taxes"], alreadyOffered: ["r3", "r2"], language: "es" })).toBeNull();
    expect(offerResource([rs[0]!], { topics: ["customs"], alreadyOffered: [], language: "es" })).toBeNull(); // topic-bound resource, topic not touched
  });
});
describe("Country Resource Library — V1 rule: every customer-visible resource resolves to an https URL", () => {
  const base = { countryCode: "MX", title: "Hacer negocios en México", language: "es", version: "2026", updatedAt: "2026-09-01" };
  it("an active document without a URL is refused; as an inactive draft it is kept but never resolved, offered or opened", async () => {
    const repo = new InMemoryCountryResources();
    await expect(repo.upsert({ id: "d1", ...base, destination: { kind: "document", ref: "docs/hacer-negocios-mx" }, active: true })).rejects.toThrow(/https URL/);
    await repo.upsert({ id: "d1", ...base, destination: { kind: "document", ref: "docs/hacer-negocios-mx" }, active: false });
    expect((await repo.list()).map((r) => r.id)).toEqual(["d1"]);
    expect(await resolveResources(repo, { countryCode: "MX", language: "es" })).toEqual([]);
    expect(isOpenable({ destination: { kind: "document", ref: "docs/x" } })).toBe(false);
    expect(isOpenable({ destination: { kind: "url", ref: "http://insecure.example.test" } })).toBe(false);
    expect(isOpenable({ destination: { kind: "url", ref: "https://beeside.example/hacer-negocios-en-mexico.pdf" } })).toBe(true);
  });
  it("country -> resource -> version -> configurable URL: a new edition (new URL) supersedes the previous one without touching code", async () => {
    const repo = new InMemoryCountryResources();
    await repo.upsert({ id: "v1", ...base, destination: { kind: "url", ref: "https://beeside.example/dbm-2026.pdf" }, active: true });
    await repo.upsert({ id: "v2", ...base, version: "2027", updatedAt: "2027-01-10", destination: { kind: "url", ref: "https://beeside.example/dbm-2027.pdf" }, active: true });
    const r = await resolveResources(repo, { countryCode: "MX", language: "es" });
    expect(r.map((x) => [x.id, x.destination.ref])).toEqual([["v2", "https://beeside.example/dbm-2027.pdf"]]);
  });
});
async function resolveRef0(repo: InMemoryCountryResources) { return resolveResources(repo, { countryCode: "mx", language: "es", topic: "taxes" }); }
