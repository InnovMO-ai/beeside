/**
 * THE KL PRIVACY BOUNDARY (frozen, kl.v1) — proven on the wire.
 *
 * Every call Precision makes to the Knowledge Layer is recorded and inspected. What may cross: reusable structured dimensions, an
 * optional normalised query made of vocabulary terms, and an opaque keyed project reference. What may NEVER cross: the client's words,
 * names, project figures, documents, project free text, places the client named below the state, or the real project id.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { createKnowledgeLayer } from "../../../knowledge-layer";
import type { KnowledgeLayer } from "../../../knowledge-layer/contract";
import { InMemoryCountryResources } from "../../../knowledge-layer/country-resources";
import { InMemoryDemandRepository, subtopicTerms } from "../../../knowledge-layer/demand";
import { MX_STATES } from "../../../knowledge-layer/geo";
import { ingestDocument } from "../../../knowledge-layer/ingest";
import { InMemoryKnowledgeRepository } from "../../../knowledge-layer/memory-repo";
import { seedInitialSources } from "../../../knowledge-layer/registry";
import { topicTerms } from "../../../knowledge-layer/topics";
import { TOPICS } from "../../../knowledge-layer/types";
import { fold } from "../../../knowledge-layer/text";
import { emptyFrame, type Frame, type NeedItem } from "../../understanding/types";
import { createDemandPort, createOrientationPort } from "../adapters";
import { createDemandRefs } from "../demand-refs";

const NOW = "2026-10-15T10:00:00.000Z";
const SECRET = "privacy-test-secret-privacy-test-secret-0123456789";
const FX = (n: string): Buffer => readFileSync(join(__dirname, "..", "..", "..", "knowledge-layer", "__tests__", "fixtures", n));

type Call = { method: string; args: unknown[] };
function recording(kl: KnowledgeLayer): { kl: KnowledgeLayer; calls: Call[] } {
  const calls: Call[] = [];
  const wrapped = new Proxy(kl, {
    get(target, prop: string) {
      const fn = (target as never as Record<string, (...a: unknown[]) => unknown>)[prop];
      if (typeof fn !== "function") return fn;
      return (...args: unknown[]) => { calls.push({ method: prop, args: JSON.parse(JSON.stringify(args)) }); return fn.apply(target, args); };
    },
  });
  return { kl: wrapped, calls };
}
async function world() {
  const knowledge = new InMemoryKnowledgeRepository();
  const demand = new InMemoryDemandRepository();
  await seedInitialSources(knowledge);
  await ingestDocument(knowledge, { sourceId: "imco-ice", edition: "2025", locator: "https://imco.org.mx/indices/ice-fixture", now: NOW, title: "ICE (fixture)", filename: "ice.pdf", data: FX("ice-sintetico.pdf") });
  const real = createKnowledgeLayer({ knowledge, demand, resources: new InMemoryCountryResources(), now: () => new Date(NOW) });
  const { kl, calls } = recording(real);
  return { kl, calls, demand };
}
function frame(over: { candidates?: string[]; categories?: string[] } = {}): Frame {
  const f = emptyFrame("es");
  f.countries.push({ code: "MX", role: "operation", provenance: "client_stated", at: NOW } as never);
  f.countries.push({ code: "PT", role: "origin", provenance: "client_stated", at: NOW } as never);
  f.needs = (over.categories ?? []).map((c, i) => ({ id: `n${i}`, text: c, conceptIds: [], resolution: "resolved", categoryKey: c, serviceKeys: [`svc_${c}`], status: "confirmed", origin: "narrative", at: NOW }) as NeedItem);
  if (over.candidates) (f.items as Record<string, unknown>)["location.candidates"] = { status: "known", value: over.candidates, display: over.candidates.join(", ") };
  return f;
}

const PROJECT_ID = "9b2c1f4e-7a63-4d0b-8f55-1c2d3e4f5a6b";
const SECRETS_IN_QUESTION = ["Juan", "Pérez", "Acme", "juan.perez@acme.com", "1,250,000", "Calle Falsa 123", "Apodaca", "terreno", "Hacienda Los Pinos"];
const NASTY = "Soy Juan Pérez de Acme SA (juan.perez@acme.com). Tenemos un terreno en Calle Falsa 123, Apodaca, junto a la Hacienda Los Pinos, y 1,250,000 pesos de nómina; ¿cuál es el mejor puerto y cuánto ISR voy a pagar por mi nómina?";

const allowedRequestKeys = new Set(["jurisdiction", "originCountry", "industry", "stage", "intent", "topics", "topic", "subtopic", "infoType", "regions", "finerThanState", "category", "service", "query", "language", "limit"]);
const vocabularyTerms = (): Set<string> => {
  const out = new Set<string>();
  for (const t of TOPICS) for (const k of topicTerms(t)) for (const w of fold(k).split(/\s+/)) out.add(w);
  for (const id of ["income_tax", "vat", "transfer_pricing", "withholding", "tax_registration", "tax_incentives", "entity_types", "incorporation_steps", "foreign_ownership", "hiring_model", "talent_availability", "salary_benchmarks", "mandatory_benefits", "imss_registration", "infonavit_afore", "tariff_classification", "duty_regimes", "customs_brokerage", "trade_agreements", "export_procedures", "ports_and_borders", "freight_costs", "warehousing", "industrial_parks", "utilities", "power_supply", "work_visas", "permits_licenses", "investment_incentives", "state_comparison", "talent_pipeline", "security_environment"]) for (const k of subtopicTerms(id)) for (const w of fold(k).split(/\s+/)) out.add(w);
  return out;
};

describe("no literal client text, name, figure, document, project id or sub-state place crosses to the Knowledge Layer", () => {
  it("a question full of identifying detail produces a request of structured dimensions only", async () => {
    const { kl, calls } = await world();
    const answer = await createOrientationPort(kl).answer(frame({ candidates: ["Nuevo León", "mi terreno en Calle Falsa 123"] }), NASTY, "es");
    const requests = calls.filter((c) => c.method === "request");
    expect(requests).toHaveLength(1);
    const req = requests[0]!.args[0] as Record<string, unknown>;
    // 1. closed set of fields (no 'question', no 'context', no 'candidates', no project id)
    for (const k of Object.keys(req)) expect(allowedRequestKeys.has(k)).toBe(true);
    expect(req).not.toHaveProperty("question");
    expect(req).not.toHaveProperty("context");
    // 2. nothing the client wrote anywhere in the traffic
    const wire = JSON.stringify(calls);
    for (const leak of SECRETS_IN_QUESTION) expect(wire.toLowerCase()).not.toContain(leak.toLowerCase());
    expect(wire).not.toContain(PROJECT_ID);
    // 3. regions are controlled gazetteer names; the free-text "candidate" never travels
    expect((req["regions"] as string[]).every((r) => (MX_STATES as readonly string[]).includes(r))).toBe(true);
    expect(req["regions"]).toEqual(expect.arrayContaining(["Nuevo León"]));
    expect(JSON.stringify(req["regions"])).not.toMatch(/terreno|Falsa/);
    // 4. the normalised query is made of vocabulary terms only
    const vocab = vocabularyTerms();
    const words = String(req["query"]).split(/\s+/).map(fold).filter(Boolean);
    expect(words.length).toBeGreaterThan(0);
    for (const w of words) expect(vocab.has(w)).toBe(true);
    // 5. origin is a country code; the sub-state place is a boolean
    expect(req["originCountry"]).toBe("PT");
    expect(req["finerThanState"]).toBe(true);
    // 6. the answer composed HERE still names the place the client wrote, where the words live
    expect(answer?.text ?? "").not.toContain("{place}");
    expect(answer?.boundary?.kind).toBeTruthy();
  });

  it("the places the client named come back into the conversation text (filled locally) without ever being sent", async () => {
    const { kl, calls } = await world();
    const o = await createOrientationPort(kl).answer(frame(), "¿Cómo está el mercado laboral en San Pedro Garza García?", "es");
    expect(o).toMatchObject({ coverage: "partial", reason: "granularity" });
    expect(o!.text).toMatch(/no te daré una lectura de San Pedro Garza García en sí/);
    expect(o!.sherpaNote).toMatch(/San Pedro Garza García/);
    expect(JSON.stringify(calls)).not.toMatch(/San Pedro/i);
  });

  it("project context requests (the project's own criteria) carry topics and states, not project facts", async () => {
    const { kl, calls } = await world();
    await createOrientationPort(kl).answer(frame({ candidates: ["Nuevo León", "Querétaro"] }), "criterios", "es");
    const req = calls.find((c) => c.method === "request")!.args[0] as Record<string, unknown>;
    expect(req).toMatchObject({ intent: "project_context", stage: "understanding", jurisdiction: "MX" });
    expect(Object.keys(req).every((k) => allowedRequestKeys.has(k))).toBe(true);
  });

  it("the Knowledge Layer is never asked to read a question: there is no interpret call and no text argument anywhere", async () => {
    const { kl, calls } = await world();
    await createOrientationPort(kl).answer(frame(), NASTY, "es");
    await createDemandPort(kl, { refs: createDemandRefs(SECRET) }).register({ projectId: PROJECT_ID, turnKey: "t1", frame: frame({ categories: ["logistics"] }), question: NASTY, outcome: { coverage: "none", reason: "no_hits" } });
    expect(calls.map((c) => c.method).sort()).toEqual(["recordDemand", "request"]);
    expect(calls.some((c) => c.method === "interpret")).toBe(false);
  });
});

describe("knowledge demand carries an opaque, keyed, irreversible project reference — never the project id", () => {
  it("the signal holds only controlled dimensions and two 32-hex references", async () => {
    const { kl, calls, demand } = await world();
    await createDemandPort(kl, { refs: createDemandRefs(SECRET) }).register({ projectId: PROJECT_ID, turnKey: "turn-42", frame: frame({ categories: ["logistics"] }), question: NASTY, outcome: { coverage: "none", reason: "no_hits" } });
    const [refs, signal] = calls.find((c) => c.method === "recordDemand")!.args as [Record<string, string>, Record<string, unknown>];
    expect(Object.keys(refs).sort()).toEqual(["eventRef", "projectRef"]);
    expect(refs["projectRef"]).toMatch(/^[0-9a-f]{32}$/);
    expect(refs["eventRef"]).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(calls)).not.toContain(PROJECT_ID);
    expect(JSON.stringify(calls)).not.toContain("turn-42");
    for (const leak of SECRETS_IN_QUESTION) expect(JSON.stringify(calls).toLowerCase()).not.toContain(leak.toLowerCase());
    expect(Object.keys(signal).sort()).toEqual(["categoryKey", "country", "infoType", "outcome", "serviceKey", "subtopic", "topic"]);
    // and what the registry stored contains neither
    expect(JSON.stringify(await demand.list({}))).not.toContain(PROJECT_ID);
  });

  it("the same project always maps to the same reference (distinct-project counting works); different projects and different keys do not collide", () => {
    const refs = createDemandRefs(SECRET);
    expect(refs(PROJECT_ID, "t1").projectRef).toBe(refs(PROJECT_ID, "t2").projectRef);
    expect(refs(PROJECT_ID, "t1").eventRef).not.toBe(refs(PROJECT_ID, "t2").eventRef);
    expect(refs(PROJECT_ID, "t1").projectRef).toBe(refs(PROJECT_ID, "t1").projectRef);
    expect(refs("another-project", "t1").projectRef).not.toBe(refs(PROJECT_ID, "t1").projectRef);
    expect(createDemandRefs("a-completely-different-secret-0123456789abcdef")(PROJECT_ID, "t1").projectRef).not.toBe(refs(PROJECT_ID, "t1").projectRef);
  });

  it("it is irreversible without the key: no plain or salted-unkeyed hash of the project id reproduces it", () => {
    const ref = createDemandRefs(SECRET)(PROJECT_ID, "t1").projectRef;
    for (const alg of ["md5", "sha1", "sha256", "sha512"]) {
      for (const input of [PROJECT_ID, `p:${PROJECT_ID}`, `project\u0000${PROJECT_ID}`, PROJECT_ID.toUpperCase(), PROJECT_ID.replace(/-/g, "")]) {
        expect(createHash(alg).update(input).digest("hex").slice(0, 32)).not.toBe(ref);
      }
    }
  });

  it("refuses to be keyed with a weak secret (no unkeyed reference can exist)", () => {
    expect(() => createDemandRefs("short")).toThrow(/at least 32/);
    expect(() => createDemandRefs("")).toThrow();
  });

  it("recurrence by distinct project still works end to end: two projects, one demand, two projects counted; a retried turn counts once", async () => {
    const { kl, demand } = await world();
    const port = createDemandPort(kl, { refs: createDemandRefs(SECRET) });
    const q = "¿Qué requisitos tiene el IMMEX para una importación temporal?";
    const base = { frame: frame(), question: q, outcome: { coverage: "none" as const, reason: "no_hits" as const } };
    await port.register({ projectId: PROJECT_ID, turnKey: "t1", ...base });
    await port.register({ projectId: PROJECT_ID, turnKey: "t1", ...base }); // retry
    await port.register({ projectId: "second-project-id", turnKey: "t1", ...base });
    const [row] = await demand.list({});
    expect(row).toMatchObject({ topic: "customs", occurrences: 2, projects: 2, status: "open" });
  });
});

describe("the adapter source itself", () => {
  const src = readFileSync(join(__dirname, "..", "adapters.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("never calls interpret, never passes the question or the project id to the layer", () => {
    expect(src).not.toMatch(/\.interpret\(/);
    expect(src).not.toMatch(/\bquestion\s*:/); // no `question:` field in a layer request
    expect(src).not.toMatch(/projectId\s*:/);
    expect(src).not.toMatch(/context\s*:\s*\{\s*candidates/);
  });
  it("opens no network: no fetch, no HTTP client, no web search", () => {
    expect(src).not.toMatch(/\bfetch\b|node:https?|axios|WebSearch|web_search/);
  });
});
