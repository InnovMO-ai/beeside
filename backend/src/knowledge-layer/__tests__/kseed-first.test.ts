/**
 * Knowledge Layer — professional boundary and Knowledge Demand registry (formerly the KSeed boundary tests).
 *  - knowledge orients, it does not replace professional work (no definitive conclusions on location, tax, legal, labor, logistics, markets, investment);
 *  - a demand is a normalised SIGNAL (controlled vocabulary only, no client text), aggregated here, never auto-published;
 *  - recurrence never publishes anything.
 * (Availability states and the Precision-side behaviour live in contract.test.ts and precision/knowledge-client/__tests__.)
 */
import { refsOf } from "./local-consumer";
import { BOUNDARY_KINDS, professionalAsk } from "../boundary";
import { InMemoryDemandRepository, assertNormalized, classifyInfoType, classifySubtopic, demandFromSignal, demandId, readQuestion, type DemandOutcome, type KnowledgeDemand } from "../demand";

const NOW = "2026-10-15T10:00:00.000Z";

/** What a consumer sends: the question is read for classification only; the signal that reaches the registry carries controlled values. */
function describeDemand(question: string, outcome: DemandOutcome, scope: { categoryKey?: string; serviceKey?: string } = {}): KnowledgeDemand | null {
  if (outcome.coverage === "full" && !outcome.boundary) return null;
  const r = readQuestion(question);
  const boundary = outcome.boundary ?? r.boundary ?? undefined;
  return demandFromSignal({ country: "MX", topic: r.topic, subtopic: r.subtopic, infoType: r.infoType, categoryKey: scope.categoryKey ?? null, serviceKey: scope.serviceKey ?? null, outcome: { ...outcome, ...(boundary ? { boundary } : {}) } });
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
    const d = describeDemand("¿Cuál es la mejor opción de puerto para mi operación, Manzanillo o Lázaro Cárdenas?", { coverage: "none", reason: "no_hits" })!;
    expect(d).toMatchObject({ country: "MX", topic: "transportation_logistics", subtopic: "ports_and_borders", coverage: "absent", disposition: "specialist_service", reason: "professional_judgment", boundary: "best_option" });
    expect(() => assertNormalized(d)).not.toThrow();
  });
  it("a plain knowledge gap becomes a candidate knowledge item, not a service", () => {
    const d = describeDemand("¿Qué requisitos tiene el IMMEX para una importación temporal?", { coverage: "none", reason: "no_hits" })!;
    expect(d).toMatchObject({ topic: "customs", subtopic: "duty_regimes", infoType: "regulatory_requirement", disposition: "candidate_knowledge", reason: "no_hits", boundary: null, coverage: "absent" });
  });
  it("partial knowledge is recorded as partial and keeps the granularity reason", () => {
    const d = describeDemand("¿Cómo está el mercado laboral en San Pedro Garza García?", { coverage: "partial", reason: "granularity" })!;
    expect(d).toMatchObject({ coverage: "partial", reason: "granularity", topic: "labor_market" });
  });
  it("a question nobody can classify is still counted, as unclassified (a vocabulary gap signal)", () => {
    const d = describeDemand("¿Y si llueve?", { coverage: "none", reason: "no_hits" })!;
    expect(d).toMatchObject({ topic: "unclassified", subtopic: "general", reason: "unclassified" });
  });
  it("provider/site requests are specialist work", () => {
    const d = describeDemand("¿Dónde encontrar una nave industrial disponible en Querétaro?", { coverage: "none", reason: "no_hits" })!;
    expect(d.infoType).toBe("local_provider_or_site");
    expect(d.disposition).toBe("specialist_service");
  });
  it("knowledge fully covering the question registers nothing", () => {
    expect(describeDemand("¿Qué es el IMMEX?", { coverage: "full", reason: "no_hits" })).toBeNull();
  });
  it("the record never carries names, e-mails, numbers or any of the question's words", () => {
    const q = "Soy Juan Pérez de Acme SA, mi correo es juan.perez@acme.com y mi RFC es PEPJ800101ABC; ¿cuánto ISR voy a pagar por 1,250,000 pesos de nómina en Monterrey?";
    const d = describeDemand(q, { coverage: "none", reason: "no_hits" }, { categoryKey: "tax_accounting_audit" })!;
    const json = JSON.stringify(d).toLowerCase();
    for (const leak of ["juan", "pérez", "perez", "acme", "@", "pepj", "1,250", "monterrey", "nómina", "nomina"]) expect(json).not.toContain(leak);
    expect(() => assertNormalized(d)).not.toThrow();
  });
  it("assertNormalized rejects anything that is not controlled vocabulary", () => {
    const base = describeDemand("¿Cuánto cuesta el IVA?", { coverage: "none", reason: "no_hits" })!;
    for (const bad of [{ subtopic: "mi nombre es Juan" }, { country: "Mexico" }, { topic: "juan@x.com" }, { categoryKey: "Con Espacios" }, { infoType: "libre" }, { boundary: "whatever" }] as Partial<KnowledgeDemand>[]) {
      expect(() => assertNormalized({ ...base, ...bad } as KnowledgeDemand)).toThrow(/not normalised/);
    }
  });
  it("accepts catalog service keys (capability ids) and nothing free-form", () => {
    const base = describeDemand("¿Cuánto cuesta el IVA?", { coverage: "none", reason: "no_hits" })!;
    expect(() => assertNormalized({ ...base, serviceKey: "CAP_HIVE_IL_3PL" })).not.toThrow();
    expect(() => assertNormalized({ ...base, serviceKey: "CAP HIVE con espacios" })).toThrow(/serviceKey/);
  });
  it("classifiers are deterministic", () => {
    expect(classifySubtopic("tengo dudas del IVA", "taxes")).toBe("vat");
    expect(classifyInfoType("¿cuánto tarda el trámite?")).toBe("timeline");
    expect(demandId(describeDemand("¿Cuánto cuesta el IVA?", { coverage: "none", reason: "no_hits" })!)).toBe(demandId(describeDemand("cuanto cuesta el iva en mexico", { coverage: "none", reason: "no_hits" })!));
  });
});

describe("recurrence informs people; it never publishes", () => {
  it("counts occurrences and distinct projects, idempotent per turn, status untouched", async () => {
    const repo = new InMemoryDemandRepository();
    const d = describeDemand("¿Qué requisitos tiene el IMMEX?", { coverage: "none", reason: "no_hits" })!;
    await repo.register(d, refsOf("p1", "t1"), NOW);
    await repo.register(d, refsOf("p1", "t1"), NOW); // retry of the same turn
    await repo.register(d, refsOf("p1", "t2"), NOW);
    const r = await repo.register(d, refsOf("p2", "t1"), "2026-10-16T10:00:00.000Z");
    expect(r).toMatchObject({ occurrences: 3, projects: 2, status: "open", lastSeenAt: "2026-10-16T10:00:00.000Z" });
    // a hundred more occurrences do not move the workflow
    for (let i = 0; i < 100; i++) await repo.register(d, refsOf(`q${i}`, "t"), NOW);
    expect((await repo.get(r.id))!.status).toBe("open");
  });
  it("only an explicit decision changes the status", async () => {
    const repo = new InMemoryDemandRepository();
    const d = describeDemand("¿Qué requisitos tiene el IMMEX?", { coverage: "none", reason: "no_hits" })!;
    const { id } = await repo.register(d, refsOf("p1", "t1"), NOW);
    expect((await repo.decide(id, "accepted_for_curation", "Prioridad V1", NOW)).status).toBe("accepted_for_curation");
    await repo.register(d, refsOf("p9", "t1"), NOW);
    expect((await repo.get(id))!.status).toBe("accepted_for_curation");
  });
  it("the registry refuses a raw project id or turn key: only opaque references are accepted", async () => {
    const repo = new InMemoryDemandRepository();
    const d = describeDemand("¿Qué requisitos tiene el IMMEX?", { coverage: "none", reason: "no_hits" })!;
    await expect(repo.register(d, { projectRef: "3f6c0d1e-9a52-4a1b-8d1e-0b6a2f6c9d11", eventRef: refsOf("p", "t").eventRef }, NOW)).rejects.toThrow(/opaque/);
    await expect(repo.register(d, { projectRef: refsOf("p", "t").projectRef, eventRef: "turn-7" }, NOW)).rejects.toThrow(/opaque/);
    expect(await repo.list({})).toEqual([]);
  });
  it("the registry cannot store a record that is not normalised", async () => {
    const repo = new InMemoryDemandRepository();
    const d = describeDemand("¿Qué requisitos tiene el IMMEX?", { coverage: "none", reason: "no_hits" })!;
    await expect(repo.register({ ...d, subtopic: "texto libre del cliente" }, refsOf("p", "t"), NOW)).rejects.toThrow(/not normalised/);
  });
});
