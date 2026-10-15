/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Knowledge-first, not search-first — through the real API on PostgreSQL.
 * When approved knowledge cannot answer a client question, Precision recognises the limit, keeps the diagnosis going, registers a
 * normalised demand (no client text) and flags a specialist. It never improvises and never reaches the web. Recurrence is counted but
 * never publishes anything. Professional determinations get context and a boundary, never a verdict.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPgDemandRepository, createPgKnowledgeRepository } from "../../knowledge/pg-repo";
import { ingestDocument } from "../../knowledge/ingest";
import { createPgFrameStore } from "../../understanding/pg-store";
import { setupHarness, TEST_DATABASE_URL, type Harness } from "./harness";
import { internalTermsIn, key } from "./drive";
import type { FaClientSafeContext } from "../../ports/fa-context";

const d = TEST_DATABASE_URL ? describe : describe.skip;

const CONTEXT: FaClientSafeContext = {
  project: { destinationCountry: "Mexico", sector: "Logística", expansionObjective: "Operar un centro logístico en México", timeframe: "2027-03" },
  company: { displayName: "Empresa Logística", operatingCountries: ["PT"] },
  needs: [{ capabilityId: "CAP_HIVE_IL_3PL", label: "Logística de terceros", priority: "high" }],
  literals: {},
  locale: "es",
};
const OPENING = "Somos una empresa logística portuguesa y queremos operar un centro logístico en México para mover mercancía desde el Pacífico durante los próximos años.";
const PORT_QUESTION = "¿Cuál es la mejor opción de puerto para mi operación, Manzanillo o Lázaro Cárdenas?";
const PORT_QUESTION_2 = "¿Qué puerto me conviene más para mi operación, Manzanillo?";

d("Knowledge-first, not search-first (PostgreSQL)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setupHarness({ engine: "core" });
    // the registry is global: start from an empty one so the suite is repeatable
    await h.db.query("DELETE FROM knowledge_demand_event");
    await h.db.query("DELETE FROM knowledge_demand");
  });
  afterAll(async () => { await h.close(); });

  async function startedProject(): Promise<{ projectId: string; api: ReturnType<Harness["api"]> }> {
    const { projectId } = await h.newProject({ context: CONTEXT });
    const api = h.api(await h.session(projectId), "es");
    await api.get("/understanding");
    const r = await api.post("/understanding/turns", { turnKey: key("open"), text: OPENING });
    expect(r.status).toBe(200);
    return { projectId, api };
  }
  const lastAssistant = (body: any): any => [...body.turns].reverse().find((t: any) => t.role === "assistant" && t.kind !== "disclosure");
  const docCount = async (): Promise<number> => Number((await h.db.query<{ n: number }>("SELECT count(*)::int AS n FROM knowledge_document")).rows[0]?.n ?? 0);
  const demandRows = async (): Promise<any[]> => (await h.db.query("SELECT d.*, (SELECT count(*) FROM knowledge_demand_event e WHERE e.demand_id = d.id)::int AS occurrences FROM knowledge_demand d ORDER BY id")).rows;

  it("no approved knowledge: states the limit, keeps asking about the project, registers a normalised demand and flags a specialist", async () => {
    const { projectId, api } = await startedProject();
    const docsBefore = await docCount();
    const r = await api.post("/understanding/turns", { turnKey: key("q"), text: PORT_QUESTION });
    expect(r.status).toBe(200);
    const a = lastAssistant(r.body);

    // 1. the limit is recognised, without inventing and without a verdict; the specialist is a beeside specialist (no internal terms)
    expect(a.text).toMatch(/especialista de beeside/);
    expect(a.text).toMatch(/^Definir la elección de la mejor opción/);
    expect(a.text).not.toMatch(/Manzanillo es|L[áa]zaro C[áa]rdenas es|la mejor opci[óo]n es/i);
    expect(internalTermsIn(a.text)).toEqual([]);
    // 2. the diagnosis goes on: exactly one question, about the project
    expect((a.text.match(/\?/g) ?? []).length).toBe(1);
    expect(a.text.trim().endsWith("?")).toBe(true);
    // 3. the demand is registered, normalised
    const rows = await demandRows();
    const row = rows.find((x) => x.subtopic === "ports_and_borders");
    expect(row).toMatchObject({ country: "MX", topic: "transportation_logistics", subtopic: "ports_and_borders", coverage: "absent", disposition: "specialist_service", boundary: "best_option", reason: "professional_judgment", status: "open", occurrences: 1 });
    // 4. no client text anywhere in the registry (rows and events)
    const dump = JSON.stringify([rows, (await h.db.query("SELECT * FROM knowledge_demand_event")).rows]).toLowerCase();
    for (const leak of ["manzanillo", "cárdenas", "cardenas", "mi operación", projectId.toLowerCase()]) expect(dump).not.toContain(leak);
    // 5. the specialist hears about it through the project's own notes (normalised, not the client's words)
    const frame = (await createPgFrameStore(h.db).load(projectId))!.frame;
    expect(frame.notes.some((n) => /fuera de la base de conocimiento aprobada \(transportation_logistics\/ports_and_borders/.test(n.text))).toBe(true);
    expect(JSON.stringify(frame.notes)).not.toMatch(/Manzanillo/i);
    // 6. nothing was published to the Knowledge Layer
    expect(await docCount()).toBe(docsBefore);
  });

  it("recurrence is counted (occurrences, distinct projects) and never publishes or changes the status; a person decides", async () => {
    const { api } = await startedProject();
    const before = (await demandRows()).find((x) => x.subtopic === "ports_and_borders");
    const docsBefore = await docCount();
    const turn = { turnKey: key("q"), text: PORT_QUESTION_2 };
    expect((await api.post("/understanding/turns", turn)).status).toBe(200);
    expect((await api.post("/understanding/turns", turn)).status).toBe(200); // retry of the same turn: counted once
    const after = (await demandRows()).find((x) => x.subtopic === "ports_and_borders");
    expect(after.id).toBe(before.id);
    expect(after.occurrences).toBe(before.occurrences + 1);
    const repo = createPgDemandRepository(h.db);
    const stored = (await repo.get(after.id))!;
    expect(stored.projects).toBeGreaterThanOrEqual(2);
    expect(stored.status).toBe("open");
    expect(await docCount()).toBe(docsBefore);
    // only an explicit decision moves it, and later occurrences leave it alone
    expect((await repo.decide(after.id, "kept_as_service", "Se queda como servicio de logística", new Date().toISOString())).status).toBe("kept_as_service");
    const { api: api3 } = await startedProject();
    await api3.post("/understanding/turns", { turnKey: key("q"), text: PORT_QUESTION });
    expect((await repo.get(after.id))!.status).toBe("kept_as_service");
  });

  it("the database refuses anything that is not controlled vocabulary", async () => {
    const base = ["x1", "MX", "taxes", "vat", null, null, "tax_treatment", "absent", "candidate_knowledge", "no_hits", null, new Date().toISOString()];
    const insert = (over: Record<number, unknown>): Promise<unknown> => {
      const v = base.map((x, i) => (i in over ? over[i] : x));
      return h.db.query("INSERT INTO knowledge_demand (id, country, topic, subtopic, category_key, service_key, info_type, coverage, disposition, reason, boundary, first_seen_at, last_seen_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)", v);
    };
    await expect(insert({ 3: "mi nombre es Juan Pérez" })).rejects.toThrow(/knowledge_demand_slugs/);
    await expect(insert({ 1: "Mexico" })).rejects.toThrow(/knowledge_demand_country/);
    await expect(insert({ 6: "texto libre" })).rejects.toThrow(/knowledge_demand_info_type/);
    await expect(insert({ 10: "otra cosa" })).rejects.toThrow(/knowledge_demand_boundary/);
  });

  it("partial knowledge: approved context is given with its source, then the boundary — never a verdict", async () => {
    const repo = createPgKnowledgeRepository(h.db);
    const res = await ingestDocument(repo, {
      sourceId: "imco-ice", title: `ICE (fixture knowledge-first ${Date.now()})`, edition: "2025", locator: "https://imco.org.mx/indices/ice-fixture", filename: "ice.pdf", now: new Date().toISOString(),
      data: readFileSync(join(__dirname, "..", "..", "knowledge", "__tests__", "fixtures", "ice-sintetico.pdf")),
    });
    try {
      const { projectId, api } = await startedProject();
      const r = await api.post("/understanding/turns", { turnKey: key("q"), text: "¿Cuál es la mejor opción para mi operación según el mercado de trabajo?" });
      expect(r.status).toBe(200);
      const a = lastAssistant(r.body);
      expect(a.text).toMatch(/IMCO/);
      expect(a.text).toMatch(/especialista de beeside/);
      expect(a.text).toMatch(/no te dar[ée] una conclusi[óo]n/);
      expect(a.text).not.toMatch(/el mejor estado es/i);
      expect(a.text.trim().endsWith("?")).toBe(true);
      const st = (await h.db.query<{ structured: any }>("SELECT structured FROM precision_turn WHERE project_id = $1 AND role = 'assistant' AND surface = 'understanding' ORDER BY seq DESC LIMIT 1", [projectId])).rows[0]?.structured;
      expect(st?.sourceRefs?.length ?? 0).toBeGreaterThan(0); // the answer is traceable to the approved passage
      expect(internalTermsIn(a.text)).toEqual([]);
      const row = (await demandRows()).find((x) => x.topic === "labor_market" && x.coverage === "partial");
      expect(row).toMatchObject({ disposition: "specialist_service", boundary: "best_option" });
    } finally {
      if (res.status === "ingested") {
        // published knowledge is immutable by design; this scratch fixture is removed from the TEST database only, with the guards lifted briefly
        for (const t of ["knowledge_passage", "knowledge_document"]) await h.db.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
        try {
          await h.db.query("DELETE FROM knowledge_passage WHERE document_id = $1", [res.document.id]);
          await h.db.query("DELETE FROM knowledge_document WHERE id = $1", [res.document.id]);
        } finally {
          for (const t of ["knowledge_passage", "knowledge_document"]) await h.db.query(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
        }
      }
    }
  });
  it("Mexico-first, not Mexico-only: a destination without prepared knowledge keeps the diagnosis going, states the limit, registers the demand for THAT country and never reaches the web", async () => {
    const { projectId } = await h.newProject({ context: { ...CONTEXT, project: { ...CONTEXT.project, destinationCountry: "Chile", expansionObjective: "Operar un centro logístico en Chile" } } });
    const api = h.api(await h.session(projectId), "es");
    await api.get("/understanding");
    expect((await api.post("/understanding/turns", { turnKey: key("open"), text: "Somos una empresa logística portuguesa y queremos operar un centro logístico en Chile para mover mercancía hacia Sudamérica." })).status).toBe(200);
    const docsBefore = await docCount();
    const r = await api.post("/understanding/turns", { turnKey: key("q"), text: "¿Cómo está el mercado de trabajo del país?" });
    expect(r.status).toBe(200);
    const a = lastAssistant(r.body);
    expect(a.text).toMatch(/todav[ií]a no lo tengo en la informaci[óo]n que beeside ha revisado y aprobado/i);   // the limit is recognised, nothing is invented
    expect((a.text.match(/\?/g) ?? []).length).toBe(1);                // the diagnosis goes on
    expect(a.text.trim().endsWith("?")).toBe(true);
    expect(internalTermsIn(a.text)).toEqual([]);
    expect(a.text).not.toMatch(/IMCO|SAT|IMSS|M[ée]xico/);             // no knowledge from another country is borrowed
    const frame = (await createPgFrameStore(h.db).load(projectId))!.frame;
    expect(frame.notes.some((n) => /fuera de la base de conocimiento aprobada/.test(n.text))).toBe(true); // the specialist hears about it
    const row = (await demandRows()).find((x) => x.country === "CL");
    expect(row).toMatchObject({ country: "CL", coverage: "absent", reason: "no_sources", disposition: "candidate_knowledge", status: "open" });
    const dump = JSON.stringify([await demandRows(), (await h.db.query("SELECT * FROM knowledge_demand_event")).rows]).toLowerCase();
    for (const leak of ["mercado de trabajo", projectId.toLowerCase()]) expect(dump).not.toContain(leak);
    expect(await docCount()).toBe(docsBefore);                          // nothing published, nothing invented
  });
});
