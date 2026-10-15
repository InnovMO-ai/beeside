/**
 * Precision consumes approved knowledge ONLY through the Knowledge Layer contract. These tests build the layer (in memory) and drive the
 * adapters the Understanding engine uses: sufficient / partial / unavailable, the professional boundary, the normalised demand signal
 * (category and service come from the PROJECT; the question never reaches the registry) and the optional country guide.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createKnowledgeLayer } from "../../../knowledge-layer";
import { InMemoryCountryResources } from "../../../knowledge-layer/country-resources";
import { InMemoryDemandRepository } from "../../../knowledge-layer/demand";
import { ingestDocument } from "../../../knowledge-layer/ingest";
import { InMemoryKnowledgeRepository } from "../../../knowledge-layer/memory-repo";
import { onboardCountryGuide } from "../../../knowledge-layer/onboard-guide";
import { seedInitialSources } from "../../../knowledge-layer/registry";
import { emptyFrame, type Frame, type NeedItem } from "../../understanding/types";
import { createDemandPort, createOrientationPort, createResourcesPort } from "../adapters";

const NOW = "2026-10-15T10:00:00.000Z";
const FX = (n: string): Buffer => readFileSync(join(__dirname, "..", "..", "..", "knowledge-layer", "__tests__", "fixtures", n));

function frame(opts: { categories?: string[]; country?: string; locale?: "es" | "en" } = {}): Frame {
  const f = emptyFrame(opts.locale ?? "es");
  f.countries.push({ code: opts.country ?? "MX", role: "operation", provenance: "client_stated", at: NOW } as never);
  f.needs = (opts.categories ?? []).map((c, i) => ({ id: `n${i}`, text: c, conceptIds: [], resolution: "resolved", categoryKey: c, serviceKeys: [`svc_${c}`], status: "confirmed", origin: "narrative", at: NOW }) as NeedItem);
  return f;
}

async function world(opts: { onError?: (e: unknown) => void } = {}) {
  const knowledge = new InMemoryKnowledgeRepository();
  const demand = new InMemoryDemandRepository();
  const resources = new InMemoryCountryResources();
  await seedInitialSources(knowledge);
  await ingestDocument(knowledge, { sourceId: "imco-ice", edition: "2025", locator: "https://imco.org.mx/indices/ice-fixture", now: NOW, title: "ICE (fixture)", filename: "ice.pdf", data: FX("ice-sintetico.pdf") });
  const kl = createKnowledgeLayer({ knowledge, demand, resources, now: () => new Date(NOW), ...(opts.onError ? { onError: opts.onError } : {}) });
  return { kl, knowledge, demand, resources };
}

describe("orientation adapter — the layer's availability states, worded for the conversation", () => {
  it("SUFFICIENT -> full: answers from approved knowledge only, with the source named, as context", async () => {
    const { kl } = await world();
    const o = await createOrientationPort(kl).answer(frame(), "¿Cómo está el mercado laboral y la informalidad?", "es");
    expect(o?.text).toMatch(/IMCO/);
    expect(o?.text).toMatch(/Fuente: .*ICE \(fixture\) \(2025\)/);
    expect(o?.text).toMatch(/no una obligación/);
    expect(o?.sourceRefs.length).toBeGreaterThan(0);
    expect(o?.coverage).toBe("full");
  });

  it("PARTIAL: a determination request gets general context AND the boundary (with its specialist area), never a verdict", async () => {
    const { kl } = await world();
    const o = await createOrientationPort(kl).answer(frame(), "¿Cuál es la mejor opción de estado para mi operación según el mercado laboral?", "es");
    expect(o).toMatchObject({ coverage: "partial", reason: "professional_judgment", boundary: { kind: "best_option", area: { es: expect.stringMatching(/mejor opción/) } } });
    expect(o!.text).toMatch(/no una (obligación ni una )?recomendación|no es una recomendación/i);
  });

  it("PARTIAL: a municipality is outside the state-level source — the limit comes first, the state context is labelled as such", async () => {
    const { kl } = await world();
    const o = await createOrientationPort(kl).answer(frame(), "¿Cómo está el mercado laboral en San Pedro Garza García?", "es");
    expect(o).toMatchObject({ coverage: "partial", reason: "granularity" });
    expect(o!.sherpaNote).toBeTruthy();
  });

  it("UNAVAILABLE: nothing approved applies -> null (the engine states the limit); a determination with no context still carries the boundary", async () => {
    const { kl } = await world();
    const port = createOrientationPort(kl);
    expect(await port.answer(frame(), "¿Qué requisitos tiene el IMMEX?", "es")).toBeNull();
    expect(await port.answer(frame(), "¿Cuánto ISR voy a pagar este año?", "es")).toMatchObject({ text: "", coverage: "none", boundary: { kind: "tax_conclusion" } });
    expect(await port.answer(frame(), "¿Y si llueve ese día?", "es")).toBeNull();
  });

  it("UNAVAILABLE: a country with no approved sources is not guessed (and has no jurisdiction -> no sources)", async () => {
    const { kl } = await world();
    const port = createOrientationPort(kl);
    expect(await port.available(frame())).toBe(true);
    expect(await port.available(frame({ country: "CL" }))).toBe(false);
    expect(await port.available(emptyFrame("es"))).toBe(false);
    expect(await port.answer(frame({ country: "CL" }), "¿Cómo está el mercado laboral?", "es")).toBeNull();
  });
});

describe("demand adapter — a normalised signal to the layer; the project supplies category and service, the question never reaches the registry", () => {
  it("files the unmet question under the PROJECT's own category/service", async () => {
    const { kl, demand } = await world();
    const port = createDemandPort(kl);
    const d = await port.register({ projectId: "p1", turnKey: "t1", frame: frame({ categories: ["logistics"] }), question: "¿Cuál es la mejor opción de puerto para mi operación, Manzanillo o Lázaro Cárdenas?", outcome: { coverage: "none", reason: "no_hits" } });
    expect(d).toMatchObject({ topic: "transportation_logistics", subtopic: "ports_and_borders", coverage: "absent", boundary: { kind: "best_option" } });
    const [row] = await demand.list({});
    expect(row).toMatchObject({ country: "MX", categoryKey: "logistics", serviceKey: "svc_logistics", disposition: "specialist_service", reason: "professional_judgment", boundary: "best_option" });
  });

  it("a topic default applies only when the project has the category; otherwise the specialist area of the boundary, else the topic's default", async () => {
    const { kl, demand } = await world();
    const port = createDemandPort(kl);
    await port.register({ projectId: "p1", turnKey: "t1", frame: frame({ categories: ["tax_accounting_audit"] }), question: "¿Cuánto ISR voy a pagar por mi nómina?", outcome: { coverage: "none", reason: "no_hits" } });
    await port.register({ projectId: "p1", turnKey: "t2", frame: frame(), question: "¿Qué requisitos tiene el IMMEX para una importación temporal?", outcome: { coverage: "none", reason: "no_hits" } });
    const rows = await demand.list({});
    expect(rows.find((r) => r.topic === "taxes")).toMatchObject({ categoryKey: "tax_accounting_audit", serviceKey: "svc_tax_accounting_audit" });
    expect(rows.find((r) => r.topic === "customs")).toMatchObject({ categoryKey: "international_trade_customs", serviceKey: null });
  });

  it("nothing is registered when knowledge covered the question; the registry never holds the question's words", async () => {
    const { kl, demand } = await world();
    const port = createDemandPort(kl);
    expect(await port.register({ projectId: "p", turnKey: "t", frame: frame(), question: "¿Qué es el IMMEX?", outcome: { coverage: "full", reason: "no_hits" } })).toBeNull();
    const q = "Soy Juan Pérez de Acme SA, mi correo es juan.perez@acme.com; ¿cuánto ISR voy a pagar por 1,250,000 pesos de nómina en Monterrey?";
    await port.register({ projectId: "p", turnKey: "t2", frame: frame({ categories: ["tax_accounting_audit"] }), question: q, outcome: { coverage: "none", reason: "no_hits" } });
    const json = JSON.stringify(await demand.list({})).toLowerCase();
    for (const leak of ["juan", "pérez", "perez", "acme", "@", "1,250", "monterrey", "nómina", "nomina"]) expect(json).not.toContain(leak);
  });

  it("is best-effort: a failing registry never breaks the turn", async () => {
    const errs: unknown[] = [];
    const { kl, demand } = await world({ onError: (e) => errs.push(e) });
    demand.register = async () => { throw new Error("db down"); };
    const d = await createDemandPort(kl).register({ projectId: "p", turnKey: "t", frame: frame(), question: "¿Qué requisitos tiene el IMMEX?", outcome: { coverage: "none", reason: "no_hits" } });
    expect(d?.topic).toBe("customs");
    expect(errs).toHaveLength(1);
  });
});

describe("resources adapter — a country guide published through the layer is offered once, optionally", () => {
  it("the 'Doing Business' path is the same path as every other content: onboard -> layer -> offered in the conversation", async () => {
    const { kl, knowledge, resources } = await world();
    await onboardCountryGuide(knowledge, resources, {
      countryCode: "MX", title: "Hacer negocios en México", language: "es", edition: "2026", url: "https://guides.beeside.example/doing-business-in-mexico-2026.pdf",
      file: { filename: "dbm.txt", data: FX("guia-pais-sintetica.txt") }, now: "2026-10-16T09:00:00.000Z", publishedAt: "2026-10-16",
    });
    // the guide's knowledge is available to Precision through the same orientation path
    const o = await createOrientationPort(kl).answer(frame(), "¿Qué es el IMMEX?", "es");
    expect(o?.coverage).toBe("full");
    expect(o?.text).toMatch(/Hacer negocios en México/);
    expect(o?.text).toMatch(/no una obligación/);
    // and offered as a guide, once, without its link
    const f = frame(); f.locale = "es";
    const port = createResourcesPort(kl);
    const offer = await port.offer(f, "es", "2026-10-17T00:00:00.000Z", "priority");
    expect(offer?.title).toBe("Hacer negocios en México");
    expect(offer?.text).not.toMatch(/https?:/);
    expect(offer?.text).toMatch(/No es necesario leerla/);
    f.asked[offer!.key] = 1;
    expect(await port.offer(f, "es", "2026-10-17T00:00:00.000Z", "priority")).toBeNull();
  });
});
