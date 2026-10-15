/**
 * KSeed boundary — Precision is KNOWLEDGE-FIRST, NOT SEARCH-FIRST.
 *  - approved knowledge answers; when it cannot, Precision says so, keeps the diagnosis going, registers a normalised demand (no client text),
 *    and routes to a specialist;
 *  - knowledge orients, it does not replace professional work (no definitive conclusions on location, tax, legal, labor, logistics, markets, investment);
 *  - recurrence never publishes anything to the Knowledge Layer;
 *  - nothing inside Precision can reach the open web.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { emptyFrame, type Frame, type NeedItem } from "../../understanding/types";
import { BOUNDARY_KINDS, professionalAsk } from "../boundary";
import { InMemoryDemandRepository, assertNormalized, classifyInfoType, classifySubtopic, demandId, describeDemand, type KnowledgeDemand } from "../demand";
import { createDemandPort } from "../demand-port";
import { InMemoryKnowledgeRepository } from "../memory-repo";
import { ingestDocument } from "../ingest";
import { createOrientationPort } from "../orientation-port";
import { seedInitialSources } from "../registry";

const NOW = "2026-10-15T10:00:00.000Z";
const FX = (n: string): Buffer => readFileSync(join(__dirname, "fixtures", n));

function frame(opts: { categories?: string[] } = {}): Frame {
  const f = emptyFrame("es");
  f.countries.push({ code: "MX", role: "operation", provenance: "client_stated", at: NOW } as never);
  f.needs = (opts.categories ?? []).map((c, i) => ({ id: `n${i}`, text: c, conceptIds: [], resolution: "resolved", categoryKey: c, serviceKeys: [`svc_${c}`], status: "confirmed", origin: "narrative", at: NOW }) as NeedItem);
  return f;
}

describe("professional boundary", () => {
  const asks: [string, string][] = [
    ["¿Cuál es la mejor opción de puerto para mi operación, Manzanillo?", "best_option"],
    ["¿Dónde me conviene instalar la planta?", "best_option"],
    ["Which is the best port for us?", "best_option"],
    ["¿Cuánto ISR voy a pagar si facturo desde México?", "tax_conclusion"],
    ["¿Puedo deducir los gastos de la matriz?", "tax_conclusion"],
    ["¿Es legal contratar sin entidad local?", "legal_opinion"],
    ["¿Cómo debo contratar a mis 40 trabajadores?", "labor_advice"],
    ["¿Puedo despedir a un empleado en el periodo de prueba?", "labor_advice"],
    ["¿Cuál es la mejor ruta para consolidar mis embarques?", "logistics_optimization"],
    ["¿En qué país me conviene entrar primero?", "market_entry_comparison"],
    ["¿Vale la pena invertir en México ahora?", "investment_recommendation"],
  ];
  it.each(asks)("%s -> %s", (q, kind) => expect(professionalAsk(q)).toBe(kind));
  it("a request for context or information is not a professional-judgment ask", () => {
    for (const q of ["¿Qué dice IMCO sobre infraestructura en Jalisco?", "¿Qué es el IMMEX?", "¿Cómo funciona el proceso con beeside?", "What does the report say about wages?", "¿Qué documentos suelen pedirse para abrir una cuenta?"]) expect(professionalAsk(q)).toBeNull();
  });
  it("every boundary kind is reachable", () => {
    expect(new Set(asks.map((a) => a[1]))).toEqual(new Set(BOUNDARY_KINDS));
  });
});

describe("knowledge demand — normalised, no client text", () => {
  it("describes an unmet question with controlled vocabulary only", () => {
    const d = describeDemand(frame({ categories: ["logistics"] }), "¿Cuál es la mejor opción de puerto para mi operación, Manzanillo o Lázaro Cárdenas?", { coverage: "none", reason: "no_hits" })!;
    expect(d).toMatchObject({ country: "MX", topic: "transportation_logistics", subtopic: "ports_and_borders", categoryKey: "logistics", serviceKey: "svc_logistics", coverage: "absent", disposition: "specialist_service", reason: "professional_judgment", boundary: "best_option" });
    expect(() => assertNormalized(d)).not.toThrow();
  });
  it("a plain knowledge gap becomes a candidate knowledge item, not a service", () => {
    const d = describeDemand(frame({ categories: ["international_trade_customs"] }), "¿Qué requisitos tiene el IMMEX para una importación temporal?", { coverage: "none", reason: "no_hits" })!;
    expect(d).toMatchObject({ topic: "customs", subtopic: "duty_regimes", infoType: "regulatory_requirement", disposition: "candidate_knowledge", reason: "no_hits", boundary: null, coverage: "absent" });
  });
  it("partial knowledge is recorded as partial and keeps the granularity reason", () => {
    const d = describeDemand(frame(), "¿Cómo está el mercado laboral en San Pedro Garza García?", { coverage: "partial", reason: "granularity" })!;
    expect(d).toMatchObject({ coverage: "partial", reason: "granularity", topic: "labor_market" });
  });
  it("a question nobody can classify is still counted, as unclassified (a vocabulary gap signal)", () => {
    const d = describeDemand(frame(), "¿Y si llueve?", { coverage: "none", reason: "no_hits" })!;
    expect(d).toMatchObject({ topic: "unclassified", subtopic: "general", reason: "unclassified" });
  });
  it("provider/site requests are specialist work", () => {
    const d = describeDemand(frame(), "¿Dónde encontrar una nave industrial disponible en Querétaro?", { coverage: "none", reason: "no_hits" })!;
    expect(d.infoType).toBe("local_provider_or_site");
    expect(d.disposition).toBe("specialist_service");
  });
  it("knowledge fully covering the question registers nothing", () => {
    expect(describeDemand(frame(), "¿Qué es el IMMEX?", { coverage: "full", reason: "no_hits" })).toBeNull();
  });
  it("the record never carries names, e-mails, numbers or any of the question's words", () => {
    const q = "Soy Juan Pérez de Acme SA, mi correo es juan.perez@acme.com y mi RFC es PEPJ800101ABC; ¿cuánto ISR voy a pagar por 1,250,000 pesos de nómina en Monterrey?";
    const d = describeDemand(frame({ categories: ["tax_accounting_audit"] }), q, { coverage: "none", reason: "no_hits" })!;
    const json = JSON.stringify(d).toLowerCase();
    for (const leak of ["juan", "pérez", "perez", "acme", "@", "pepj", "1,250", "monterrey", "nómina", "nomina"]) expect(json).not.toContain(leak);
    expect(() => assertNormalized(d)).not.toThrow();
  });
  it("assertNormalized rejects anything that is not controlled vocabulary", () => {
    const base = describeDemand(frame(), "¿Cuánto cuesta el IVA?", { coverage: "none", reason: "no_hits" })!;
    for (const bad of [{ subtopic: "mi nombre es Juan" }, { country: "Mexico" }, { topic: "juan@x.com" }, { categoryKey: "Con Espacios" }, { infoType: "libre" }, { boundary: "whatever" }] as Partial<KnowledgeDemand>[]) {
      expect(() => assertNormalized({ ...base, ...bad } as KnowledgeDemand)).toThrow(/not normalised/);
    }
  });
  it("accepts catalog service keys (capability ids) and nothing free-form", () => {
    const base = describeDemand(frame(), "¿Cuánto cuesta el IVA?", { coverage: "none", reason: "no_hits" })!;
    expect(() => assertNormalized({ ...base, serviceKey: "CAP_HIVE_IL_3PL" })).not.toThrow();
    expect(() => assertNormalized({ ...base, serviceKey: "CAP HIVE con espacios" })).toThrow(/serviceKey/);
  });
  it("classifiers are deterministic", () => {
    expect(classifySubtopic("tengo dudas del IVA", "taxes")).toBe("vat");
    expect(classifyInfoType("¿cuánto tarda el trámite?")).toBe("timeline");
    expect(demandId(describeDemand(frame(), "¿Cuánto cuesta el IVA?", { coverage: "none", reason: "no_hits" })!)).toBe(demandId(describeDemand(frame(), "cuanto cuesta el iva en mexico", { coverage: "none", reason: "no_hits" })!));
  });
});

describe("recurrence informs people; it never publishes", () => {
  it("counts occurrences and distinct projects, idempotent per turn, status untouched", async () => {
    const repo = new InMemoryDemandRepository();
    const d = describeDemand(frame(), "¿Qué requisitos tiene el IMMEX?", { coverage: "none", reason: "no_hits" })!;
    await repo.register(d, { projectId: "p1", turnKey: "t1" }, NOW);
    await repo.register(d, { projectId: "p1", turnKey: "t1" }, NOW); // retry of the same turn
    await repo.register(d, { projectId: "p1", turnKey: "t2" }, NOW);
    const r = await repo.register(d, { projectId: "p2", turnKey: "t1" }, "2026-10-16T10:00:00.000Z");
    expect(r).toMatchObject({ occurrences: 3, projects: 2, status: "open", lastSeenAt: "2026-10-16T10:00:00.000Z" });
    // a hundred more occurrences do not move the workflow
    for (let i = 0; i < 100; i++) await repo.register(d, { projectId: `q${i}`, turnKey: "t" }, NOW);
    expect((await repo.get(r.id))!.status).toBe("open");
  });
  it("only an explicit decision changes the status", async () => {
    const repo = new InMemoryDemandRepository();
    const d = describeDemand(frame(), "¿Qué requisitos tiene el IMMEX?", { coverage: "none", reason: "no_hits" })!;
    const { id } = await repo.register(d, { projectId: "p1", turnKey: "t1" }, NOW);
    expect((await repo.decide(id, "accepted_for_curation", "Prioridad V1", NOW)).status).toBe("accepted_for_curation");
    await repo.register(d, { projectId: "p9", turnKey: "t1" }, NOW);
    expect((await repo.get(id))!.status).toBe("accepted_for_curation");
  });
  it("the registry cannot store a record that is not normalised", async () => {
    const repo = new InMemoryDemandRepository();
    const d = describeDemand(frame(), "¿Qué requisitos tiene el IMMEX?", { coverage: "none", reason: "no_hits" })!;
    await expect(repo.register({ ...d, subtopic: "texto libre del cliente" }, { projectId: "p", turnKey: "t" }, NOW)).rejects.toThrow(/not normalised/);
  });
  it("the demand port is best-effort: a failing store never breaks the turn", async () => {
    const errs: unknown[] = [];
    const port = createDemandPort({ ...new InMemoryDemandRepository(), register: async () => { throw new Error("db down"); } } as never, { onError: (e) => errs.push(e) });
    const d = await port.register({ projectId: "p", turnKey: "t", frame: frame(), question: "¿Qué requisitos tiene el IMMEX?", outcome: { coverage: "none", reason: "no_hits" } });
    expect(d?.topic).toBe("customs");
    expect(errs).toHaveLength(1);
  });
});

describe("orientation port — knowledge-first answers", () => {
  async function world() {
    const repo = new InMemoryKnowledgeRepository();
    await seedInitialSources(repo);
    await ingestDocument(repo, { sourceId: "imco-ice", edition: "2025", locator: "https://imco.org.mx/indices/ice-fixture", now: NOW, title: "ICE (fixture)", filename: "ice.pdf", data: FX("ice-sintetico.pdf") });
    return repo;
  }
  it("answers from approved knowledge only, with the source named", async () => {
    const port = createOrientationPort(await world());
    const o = await port.answer(frame(), "¿Cómo está el mercado laboral y la informalidad?", "es");
    expect(o?.text).toMatch(/IMCO/);
    expect(o?.sourceRefs.length).toBeGreaterThan(0);
    expect(o?.coverage).toBe("full");
  });
  it("a determination request gets general context AND the boundary, never a verdict", async () => {
    const port = createOrientationPort(await world());
    const o = await port.answer(frame(), "¿Cuál es la mejor opción de estado para mi operación según el mercado laboral?", "es");
    expect(o).toMatchObject({ coverage: "partial", reason: "professional_judgment", boundary: "best_option" });
    expect(o!.text).toMatch(/no una (obligación ni una )?recomendación|no es una recomendación/i);
  });
  it("nothing approved applies -> null (the engine states the limit); a determination with no context still carries the boundary", async () => {
    const port = createOrientationPort(await world());
    expect(await port.answer(frame(), "¿Qué requisitos tiene el IMMEX?", "es")).toBeNull();
    const b = await port.answer(frame(), "¿Cuánto ISR voy a pagar este año?", "es");
    expect(b).toMatchObject({ text: "", coverage: "none", boundary: "tax_conclusion" });
  });
  it("a question about an unclassifiable topic is not answered with unrelated project context", async () => {
    const port = createOrientationPort(await world());
    expect(await port.answer(frame(), "¿Y si llueve ese día?", "es")).toBeNull();
  });
  it("is unavailable without a jurisdiction (no sources are guessed)", async () => {
    const port = createOrientationPort(await world());
    expect(await port.available(emptyFrame("es"))).toBe(false);
  });
});

// ------------------------------------------------------------------ the architecture guard: no live web inside Precision
const SRC = join(__dirname, "..", "..");
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "__tests__" || n === "__integration__" || n === "node_modules" ? [] : sourceFiles(p);
    return /\.ts$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}

describe("no live web inside Precision (frozen KSeed boundary)", () => {
  const files = sourceFiles(SRC);
  const rel = (f: string): string => relative(SRC, f);

  it("no Precision module imports a network client or calls fetch/WebSearch", () => {
    const offenders: string[] = [];
    // The only sanctioned model/provider transports are listed explicitly; none of them is a knowledge or search path.
    const ALLOW = new Set(["knowledge/agent.ts", "adapters/clickup-fake-server.ts"]); // the agent is the sanctioned fetch PORT (not wired to conversations); the fake server only LISTENS (test double)
    const BAD = [/from\s+["'](?:node:)?https?["']/, /require\(["'](?:node:)?https?["']\)/, /from\s+["'](?:axios|undici|node-fetch|got|superagent|cross-fetch|puppeteer|playwright|cheerio|jsdom)["']/, /\bglobalThis\.fetch\b/, /(?<![\w.])fetch\s*\(/, /\bWebSearch\b|\bweb_search\b|\bgoogle\.com\/search\b|\bserpapi\b|\btavily\b|\bbing\.com\/search\b/i];
    for (const f of files) {
      if (ALLOW.has(rel(f))) continue;
      const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const re of BAD) if (re.test(src)) offenders.push(`${rel(f)} ~ ${re}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the Knowledge Agent (the only fetch port) is never reachable from a client conversation", () => {
    const importers = files.filter((f) => /knowledge\/agent["']|from\s+["']\.\/agent["']|from\s+["'].*\/agent["']/.test(readFileSync(f, "utf8")) && /knowledge\//.test(readFileSync(f, "utf8").match(/from\s+["'][^"']*agent["']/)?.[0] ?? "agent"));
    const bad = importers.map(rel).filter((p) => p !== "knowledge/agent.ts" && p !== "knowledge/pg-repo.ts");
    // pg-repo only implements the candidate STORE (types); wiring/engine/orientation/conversation must not touch the agent
    expect(bad).toEqual([]);
    for (const p of ["api/wiring.ts", "understanding/engine.ts", "knowledge/orientation-port.ts", "knowledge/orient.ts", "knowledge/retrieve.ts"]) expect(readFileSync(join(SRC, p), "utf8")).not.toMatch(/SourceFetcher|runAgentCycle|knowledge\/agent|from\s+["']\.\/agent["']/);
  });

  it("the orientation path reads the internal repository only", () => {
    const port = readFileSync(join(SRC, "knowledge", "orientation-port.ts"), "utf8");
    expect(port).toMatch(/KnowledgeRepository/);
    expect(port).not.toMatch(/\bfetch\b|node:https?|https?:\/\//);
  });
});
