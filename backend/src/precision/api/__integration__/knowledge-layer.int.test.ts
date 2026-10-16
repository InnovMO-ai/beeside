/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Precision ↔ Knowledge Layer — permanent integration, through the real API on PostgreSQL.
 *
 * The Knowledge Layer is wrapped in a recorder: every piece of knowledge Precision uses must appear in a contract call. Content is
 * PUBLISHED through the layer's own path (ingestion / country-guide onboarding), never injected into Precision.
 *
 *   A. Portuguese reference company: IMCO published in the layer -> Precision request -> layer response -> conversational use (with source),
 *      and the conversation still completes to a confirmed Service Map.
 *   B. PARTIAL: approved context + the professional boundary; the unmet part is a normalised demand SIGNAL (no client text) to the layer.
 *   C. UNAVAILABLE: a destination with no knowledge (Chile) — limit stated, diagnosis continues, demand signalled for that country.
 *   D. "Doing Business in Mexico"-style guide: onboarded through the SAME publication path -> orientation answers from it, it is offered
 *      once as a country resource and opened through the layer. No Precision-only path.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPgKnowledgeLayer } from "../../../knowledge-layer";
import type { KnowledgeLayer } from "../../../knowledge-layer/contract";
import { ingestDocument } from "../../../knowledge-layer/ingest";
import { guideSourceId, onboardCountryGuide } from "../../../knowledge-layer/onboard-guide";
import { createPgCountryResources, createPgKnowledgeRepository } from "../../../knowledge-layer/pg-repo";
import { setupHarness, TEST_DATABASE_URL, type Harness } from "./harness";
import { confirmMap, internalTermsIn, key } from "./drive";
import type { FaClientSafeContext } from "../../ports/fa-context";
import type { Db } from "../../../db/database";

const d = TEST_DATABASE_URL ? describe : describe.skip;

const FX = (n: string): Buffer => readFileSync(join(__dirname, "..", "..", "..", "knowledge-layer", "__tests__", "fixtures", n));
const PT_CONTEXT: FaClientSafeContext = {
  project: { destinationCountry: "Mexico", sector: "Energía", expansionObjective: "Establecer operaciones en México para apoyar proyectos del sector energético", timeframe: "2027-01" },
  company: { displayName: "Empresa Portuguesa", operatingCountries: ["PT"] },
  needs: [{ capabilityId: "CAP_HIVE_FI_COMPANY_SETUP", label: "Constitución de la entidad", priority: "high" }],
  literals: {},
  locale: "es",
};
const NARRATIVE =
  "Somos una empresa portuguesa. Fuimos subcontratados por las empresas ganadoras de proyectos del sector energético en México y vamos a estar operando allá durante unos 2 a 3 años. Instalaremos parte del equipo de los proyectos. Necesitamos constituir una entidad local, apoyo legal, fiscal, laboral, contratar gente, algunos directamente y otros por medio de un tercero, seguridad social, contabilidad y cumplimiento fiscal. La casa matriz en Portugal va a financiar la operación en México y habrá operaciones intercompañía.";

interface Call { method: string; args: any[]; result: any }
/** Records every contract call (arguments and results) while delegating to the real layer. */
function recorded(real: KnowledgeLayer, calls: Call[]): KnowledgeLayer {
  const wrap = <K extends keyof KnowledgeLayer>(m: K): KnowledgeLayer[K] =>
    (async (...args: any[]) => { const result = await (real[m] as any)(...args); calls.push({ method: m, args, result }); return result; }) as KnowledgeLayer[K];
  return { coverage: wrap("coverage"), interpret: wrap("interpret"), request: wrap("request"), recordDemand: wrap("recordDemand"), resources: wrap("resources"), openResource: wrap("openResource") };
}

d("Precision ↔ Knowledge Layer (PostgreSQL)", () => {
  let h: Harness;
  const calls: Call[] = [];
  const of = (method: string): Call[] => calls.filter((c) => c.method === method);
  const fresh = (): void => { calls.length = 0; };
  beforeAll(async () => {
    h = await setupHarness({ engine: "core", knowledge: async (db: Db) => recorded(await createPgKnowledgeLayer(db, { seedSources: true }), calls) });
    await h.db.query("DELETE FROM knowledge_demand_event");
    await h.db.query("DELETE FROM knowledge_demand");
  });
  afterAll(async () => { await h.close(); });

  const lastAssistant = (body: any): any => [...body.turns].reverse().find((t: any) => t.role === "assistant" && t.kind !== "disclosure");
  const demandRows = async (): Promise<any[]> => (await h.db.query("SELECT * FROM knowledge_demand ORDER BY id")).rows;


  const ANSWERS: Record<string, string> = {
    "entity.form": "Todavía no lo hemos decidido, queremos que nos asesoren.", "entity.funding_structure": "Sería un préstamo, aunque no está definido del todo.",
    "workforce.headcount": "Unas 60 personas en total.", "workforce.split": "Unas 20 directas y 40 subcontratadas.", "workforce.benefits": "Además del mínimo de ley queremos seguro de gastos médicos y vales de despensa.",
    "scale.revenue": "Calculamos unos 3 millones de dólares al año.", "scale.volume": "Unas 150 facturas al mes.", "scale.suppliers": "Unos 25 proveedores locales.", "scale.inventory": "No, no manejaremos inventario.",
    "tax.intercompany": "Servicios de gestión de la matriz y venta de equipo a la filial.",
  };
  /** The Portuguese reference conversation, answered as understanding-core does, until the map is ready to confirm. */
  async function finishPortuguese(api: ReturnType<Harness["api"]>, projectId: string, offers: any[] = []): Promise<string> {
    let state = "in_progress";
    for (let i = 0; i < 40 && state !== "ready_to_confirm"; i++) {
      const row = (await h.db.query<{ structured: any }>("SELECT structured FROM precision_turn WHERE project_id = $1 AND role = 'assistant' AND surface = 'understanding' ORDER BY seq DESC LIMIT 1", [projectId])).rows[0];
      const act = row?.structured?.understanding?.action;
      const thread = (await api.get("/understanding")).body;
      const last = [...thread.turns].reverse().find((t: any) => t.role === "assistant" && t.kind !== "disclosure");
      let body: Record<string, unknown>;
      switch (act?.kind) {
        case "ask_probe": body = { text: ANSWERS[act.probeKey as string] ?? "Todavía no lo sé." }; break;
        case "ask_priority": body = { text: "Primero la entidad local y la contratación, porque queremos arrancar en enero. Lo fiscal puede esperar." }; break;
        case "offer_implied": body = { text: "", quickReply: last.quickReplies.find((q: any) => q.value === "yes") }; break;
        case "checkpoint": body = { text: "", quickReply: last.quickReplies.find((q: any) => q.value === "ok") ?? last.quickReplies[0] }; break;
        case "clarify_conflict": body = { text: "", quickReply: last.quickReplies.find((q: any) => q.value === "new") }; break;
        default: body = { text: "Es algo que necesitamos para operar." };
      }
      const r = await api.post("/understanding/turns", { turnKey: key("u"), ...body });
      if (r.status !== 200) throw new Error(`turn failed ${r.status} ${JSON.stringify(r.body)}`);
      offers.push(...(r.body.turns as any[]).filter((t) => t.resourceOffer));
      state = r.body.understandingState;
    }
    return state;
  }

  async function startedProject(context: FaClientSafeContext, opening: string) {
    const { projectId } = await h.newProject({ context });
    const api = h.api(await h.session(projectId), "es");
    await api.get("/understanding");
    expect((await api.post("/understanding/turns", { turnKey: key("open"), text: opening })).status).toBe(200);
    return { projectId, api };
  }
  /** Published knowledge is immutable by design; scratch content is removed from the TEST database only, guards lifted briefly. */
  async function unpublish(documentIds: string[], extra: () => Promise<void> = async () => undefined): Promise<void> {
    const tables = ["knowledge_passage", "knowledge_document"];
    for (const t of tables) await h.db.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
    try {
      for (const id of documentIds) { await h.db.query("DELETE FROM knowledge_passage WHERE document_id = $1", [id]); await h.db.query("DELETE FROM knowledge_document WHERE id = $1", [id]); }
      await extra();
    } finally { for (const t of tables) await h.db.query(`ALTER TABLE ${t} ENABLE TRIGGER USER`); }
  }



  it("A. Portuguese company: IMCO published in the layer reaches the conversation ONLY through the contract, with its source; the map still confirms", async () => {
    const repo = createPgKnowledgeRepository(h.db);
    const pub = await ingestDocument(repo, { sourceId: "imco-ice", title: `ICE (fixture KL ${Date.now()})`, edition: "2025", locator: "https://imco.org.mx/indices/ice-fixture", filename: "ice.pdf", now: new Date().toISOString(), publishedAt: "2025-09-01", data: FX("ice-sintetico.pdf") });
    try {
      expect(pub.status).toBe("ingested");
      const { projectId, api } = await startedProject(PT_CONTEXT, NARRATIVE);
      fresh();
      const r = await api.post("/understanding/turns", { turnKey: key("q"), text: "¿Qué dice el IMCO sobre la infraestructura de los estados?" });
      expect(r.status).toBe(200);
      const a = lastAssistant(r.body);

      // the request went through the contract: coverage probe, then a request for the project's jurisdiction
      expect(of("coverage").map((c) => c.args[0])).toContain("MX");
      const req = of("request")[0]!;
      expect(req.args[0]).toMatchObject({ jurisdiction: "MX", intent: "answer_question", language: "es" });
      expect(req.result.availability).toBe("sufficient");
      const unit = req.result.units[0];
      expect(unit.source).toMatchObject({ sourceId: "imco-ice", edition: "2025", version: 1, authority: "trusted_institutional", status: "active", jurisdiction: "MX" });

      // conversational use: the answer names the source the layer returned and is traceable to its unit ids
      expect(a.text).toMatch(/IMCO/);
      expect(a.text).toContain(unit.citation);
      expect(a.text).toMatch(/no una obligación/);
      const st = (await h.db.query<{ structured: any }>("SELECT structured FROM precision_turn WHERE project_id = $1 AND role = 'assistant' AND surface = 'understanding' ORDER BY seq DESC LIMIT 1", [projectId])).rows[0]?.structured;
      const returnedIds = new Set(req.result.units.map((u: any) => u.id));
      expect(st.sourceRefs.length).toBeGreaterThan(0);
      expect(st.sourceRefs.every((id: string) => returnedIds.has(id))).toBe(true);
      expect(of("recordDemand")).toHaveLength(0);                          // sufficient: nothing unmet, nothing signalled
      expect(internalTermsIn(a.text)).toEqual([]);

      // the Portuguese reference case still completes to a confirmed Service Map with the layer in the loop
      expect(await finishPortuguese(api, projectId)).toBe("ready_to_confirm");
      expect((await confirmMap(api)).status).toBe(200);
    } finally {
      if (pub.status === "ingested") await unpublish([pub.document.id]);
    }
  }, 180000);

  it("B. PARTIAL: context with its source plus the professional boundary; the unmet part is a normalised signal to the layer (no client text)", async () => {
    const repo = createPgKnowledgeRepository(h.db);
    const pub = await ingestDocument(repo, { sourceId: "imco-ice", title: `ICE (fixture KL partial ${Date.now()})`, edition: "2025", locator: "https://imco.org.mx/indices/ice-fixture", filename: "ice.pdf", now: new Date().toISOString(), data: FX("ice-sintetico.pdf") });
    try {
      const { api } = await startedProject(PT_CONTEXT, NARRATIVE);
      fresh();
      const question = "¿Cuál es la mejor opción de estado para mi operación según el mercado de trabajo?";
      const r = await api.post("/understanding/turns", { turnKey: key("q"), text: question });
      const a = lastAssistant(r.body);
      const res = of("request")[0]!.result;
      expect(res).toMatchObject({ availability: "partial", reason: "professional_judgment", recommends: false, boundary: { kind: "best_option" } });
      expect(res.units.length).toBeGreaterThan(0);
      expect(res.unresolved).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "professional_judgment" })]));
      expect(a.text).toMatch(/IMCO/);
      expect(a.text).toMatch(/especialista de beeside/);                    // the boundary metadata, worded by Precision
      expect(a.text).not.toMatch(/el mejor estado es/i);

      // the unmet part goes back to the layer as a normalised signal: controlled values only, never the question
      const sig = of("recordDemand")[0]!;
      expect(sig.args[0]).toMatchObject({ turnKey: expect.any(String) });
      expect(sig.args[1]).toMatchObject({ country: "MX", topic: "labor_market", outcome: { coverage: "partial", boundary: "best_option" } });
      expect(JSON.stringify(sig.args[1]).toLowerCase()).not.toMatch(/mercado de trabajo|mi operaci|estado para/);
      expect(sig.result).toMatchObject({ coverage: "partial", disposition: "specialist_service", boundary: { kind: "best_option" } });
      const row = (await demandRows()).find((x) => x.topic === "labor_market" && x.coverage === "partial");
      expect(row).toMatchObject({ country: "MX", disposition: "specialist_service", boundary: "best_option", status: "open" });
    } finally {
      if (pub.status === "ingested") await unpublish([pub.document.id]);
    }
  }, 120000);

  it("C. NO KNOWLEDGE (Chile): the layer says unavailable, the limit is stated, the diagnosis continues, the demand is signalled for that country", async () => {
    const { projectId, api } = await startedProject({ ...PT_CONTEXT, project: { ...PT_CONTEXT.project, destinationCountry: "Chile", expansionObjective: "Operar en Chile" } },
      "Somos una empresa logística portuguesa y queremos operar un centro logístico en Chile para mover mercancía hacia Sudamérica.");
    fresh();
    const docsBefore = Number((await h.db.query<{ n: number }>("SELECT count(*)::int AS n FROM knowledge_document")).rows[0]?.n);
    const r = await api.post("/understanding/turns", { turnKey: key("q"), text: "¿Cómo está el mercado de trabajo del país?" });
    const a = lastAssistant(r.body);
    expect(of("coverage").map((c) => [c.args[0], c.result.available])).toContainEqual(["CL", false]);
    expect(of("request")).toHaveLength(0);                               // nothing to ask for: Precision does not guess knowledge
    expect(a.text).toMatch(/todav[ií]a no lo tengo en la informaci[óo]n que beeside ha revisado y aprobado/i);
    expect((a.text.match(/\?/g) ?? []).length).toBe(1);                   // diagnosis goes on: one question, about the project
    expect(a.text).not.toMatch(/IMCO|SAT|IMSS|M[ée]xico/);
    const sig = of("recordDemand")[0]!;
    expect(sig.args[1]).toMatchObject({ country: "CL", outcome: { coverage: "none", reason: "no_sources" } });
    expect((await demandRows()).find((x) => x.country === "CL")).toMatchObject({ coverage: "absent", reason: "no_sources", status: "open" });
    expect(JSON.stringify(sig.args[1])).not.toContain(projectId.toLowerCase());   // the signal carries no project identity (the layer hashes the context reference)
    expect(Number((await h.db.query<{ n: number }>("SELECT count(*)::int AS n FROM knowledge_document")).rows[0]?.n)).toBe(docsBefore); // no web, no invention
  }, 120000);

  it("D. Doing Business in Mexico drop-in: onboarded through the layer's own path -> available to Precision through the same contract (answer, offer, open)", async () => {
    const knowledge = createPgKnowledgeRepository(h.db);
    const resources = createPgCountryResources(h.db);
    const out = await onboardCountryGuide(knowledge, resources, {
      countryCode: "MX", title: "Hacer negocios en México", language: "es", edition: "2026", url: "https://guides.beeside.example/doing-business-in-mexico-2026.pdf",
      file: { filename: "dbm.txt", data: FX("guia-pais-sintetica.txt") }, now: new Date().toISOString(), publishedAt: "2026-01-15",
    });
    try {
      expect(out.ingest.status).toBe("ingested");
      const { projectId, api } = await startedProject(PT_CONTEXT, NARRATIVE);
      fresh();
      const r = await api.post("/understanding/turns", { turnKey: key("q"), text: "¿Qué tipo de sociedades suelen considerar las empresas extranjeras?" });
      const a = lastAssistant(r.body);
      const res = of("request")[0]!.result;
      expect(res.availability).toBe("sufficient");
      expect(res.units[0].source).toMatchObject({ sourceId: guideSourceId("MX"), documentTitle: "Hacer negocios en México", edition: "2026", authority: "beeside_curated", status: "active" });
      expect(res.units[0].wording).toBe("context");
      expect(a.text).toMatch(/Hacer negocios en México/);

      // the guide is a country resource served by the layer: offered once while the conversation advances, opened through the layer
      const offers: any[] = (r.body.turns as any[]).filter((t) => t.resourceOffer);
      expect(await finishPortuguese(api, projectId, offers)).toBe("ready_to_confirm");
      expect(offers.map((t) => t.resourceOffer.id)).toEqual([out.resource.id]);   // once
      expect(of("resources").length).toBeGreaterThan(0);
      const opened = await api.get(`/resources/${out.resource.id}`);
      expect(opened.status).toBe(200);
      expect(opened.body).toMatchObject({ id: out.resource.id, kind: "url", ref: "https://guides.beeside.example/doing-business-in-mexico-2026.pdf", format: "pdf" });
      expect(of("openResource").map((c) => c.args[0])).toContain(out.resource.id);
    } finally {
      await unpublish(out.ingest.status === "ingested" ? [out.ingest.document.id] : [], async () => {
        await h.db.query("DELETE FROM country_resource WHERE id = $1", [out.resource.id]);
      });
    }
  }, 180000);
});
