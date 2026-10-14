/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Category inheritance through the real API on PostgreSQL. The Portuguese reference company is scoped in Understanding, the map is
 * confirmed, and every category conversation continues the project: it opens from what is known, carries the client's facts with
 * provenance, never asks again what the project established, deepens what is open, and follows the project when it changes.
 */
import { createPgFrameStore } from "../../understanding/pg-store";
import { loadFactMap } from "../../domain/facts";
import { INHERITED_LEDGER_KEY, parseLedger, syncProjectInheritance } from "../../domain/category-inheritance";
import { setupHarness, TEST_DATABASE_URL, type Harness } from "./harness";
import { confirmMap, internalTermsIn, key } from "./drive";
import type { FaClientSafeContext } from "../../ports/fa-context";

const d = TEST_DATABASE_URL ? describe : describe.skip;

const NARRATIVE =
  "Somos una empresa portuguesa. Fuimos subcontratados por las empresas ganadoras de proyectos del sector energético en México y vamos a estar operando allá durante unos 2 a 3 años. Instalaremos parte del equipo de los proyectos. Necesitamos constituir una entidad local, apoyo legal, fiscal, laboral, contratar gente, algunos directamente y otros por medio de un tercero, seguridad social, contabilidad y cumplimiento fiscal. La casa matriz en Portugal va a financiar la operación en México y habrá operaciones intercompañía.";
const PT_CONTEXT: FaClientSafeContext = {
  project: { destinationCountry: "Mexico", sector: "Energía", expansionObjective: "Establecer operaciones en México para apoyar proyectos del sector energético", timeframe: "2027-01" },
  company: { displayName: "Empresa Portuguesa", operatingCountries: ["PT"] },
  needs: [{ capabilityId: "CAP_HIVE_FI_COMPANY_SETUP", label: "Constitución de la entidad", priority: "high" }],
  literals: {},
  locale: "es",
};
const ANSWERS: Record<string, string> = {
  "entity.form": "Todavía no lo hemos decidido, queremos que nos asesoren.",
  "entity.funding_structure": "Sería un préstamo, aunque no está definido del todo.",
  "workforce.headcount": "Unas 60 personas en total.",
  "workforce.split": "Unas 20 directas y 40 subcontratadas.",
  "workforce.benefits": "Además del mínimo de ley queremos seguro de gastos médicos y vales de despensa.",
  "scale.revenue": "Calculamos unos 3 millones de dólares al año.",
  "scale.volume": "Unas 150 facturas al mes.",
  "scale.suppliers": "Unos 25 proveedores locales.",
  "scale.inventory": "No, no manejaremos inventario.",
  "tax.intercompany": "Servicios de gestión de la matriz y venta de equipo a la filial.",
};
const PRIORITY = "Primero la entidad local y la contratación, porque queremos arrancar en enero. Lo fiscal puede esperar.";

d("Category inheritance — the category deepens the project, it does not restart it", () => {
  let h: Harness;
  beforeAll(async () => { h = await setupHarness({ engine: "core" }); });
  afterAll(async () => { await h.close(); });

  async function pending(projectId: string): Promise<{ kind: string; probeKey?: string } | null> {
    const r = await h.db.query<{ structured: any }>("SELECT structured FROM precision_turn WHERE project_id = $1 AND role = 'assistant' AND surface = 'understanding' ORDER BY seq DESC LIMIT 1", [projectId]);
    return r.rows[0]?.structured?.understanding?.action ?? null;
  }

  async function portugueseProject(): Promise<{ projectId: string; api: ReturnType<Harness["api"]> }> {
    const { projectId } = await h.newProject({ context: PT_CONTEXT });
    const api = h.api(await h.session(projectId), "es");
    await api.get("/understanding");
    let r = await api.post("/understanding/turns", { turnKey: key("open"), text: NARRATIVE });
    for (let i = 0; i < 40 && r.body.understandingState !== "ready_to_confirm"; i++) {
      const a = await pending(projectId);
      const last = [...r.body.turns].reverse().find((t: any) => t.role === "assistant");
      let body: Record<string, unknown>;
      switch (a?.kind) {
        case "ask_probe": body = { text: ANSWERS[a.probeKey as string] ?? "Todavía no lo sé." }; break;
        case "ask_priority": body = { text: PRIORITY }; break;
        case "offer_implied": body = { text: "", quickReply: last.quickReplies.find((q: any) => q.value === "yes") }; break;
        case "checkpoint": body = { text: "", quickReply: last.quickReplies.find((q: any) => q.value === "ok") ?? last.quickReplies[0] }; break;
        case "clarify_conflict": body = { text: "", quickReply: last.quickReplies.find((q: any) => q.value === "new") }; break;
        default: body = { text: "Es algo que necesitamos para operar." };
      }
      r = await api.post("/understanding/turns", { turnKey: key("u"), ...body });
    }
    expect(r.body.understandingState).toBe("ready_to_confirm");
    expect((await confirmMap(api)).status).toBe(200);
    return { projectId, api };
  }

  const categoryIdOf = async (projectId: string, categoryKey: string): Promise<string> =>
    (await h.db.query<{ instance_id: string }>("SELECT instance_id FROM category_assessment WHERE project_id = $1 AND category_key = $2", [projectId, categoryKey])).rows[0]!.instance_id;

  it("the categories hold the project's facts, with provenance, before the client opens them; the thread continues the project", async () => {
    const { projectId, api } = await portugueseProject();

    const taxId = await categoryIdOf(projectId, "tax_accounting_audit");
    const taxFacts = await loadFactMap(h.db, taxId);
    expect(taxFacts.tax_has_intercompany_transactions).toMatchObject({ value: true, answerState: "ANSWERED", provenance: "client_answered" });
    expect(taxFacts.tax_intercompany_transactions?.value).toEqual(expect.arrayContaining([{ transaction_type: "services", counterparty_country: ["PT"] }, { transaction_type: "goods", counterparty_country: ["PT"] }]));
    const ledger = parseLedger(taxFacts[INHERITED_LEDGER_KEY]?.value);
    expect(Object.keys(ledger.fields)).toEqual(expect.arrayContaining(["tax_has_intercompany_transactions", "tax_intercompany_transactions"]));

    const hrId = await categoryIdOf(projectId, "people_payroll_employment");
    const hr = await loadFactMap(h.db, hrId);
    expect(hr.hr_employee_population_breakdown?.value).toEqual([{ headcount: 20, country: ["MX"] }, { headcount: 40, country: ["MX"] }]);
    expect(hr.hr_employment_model).toBeUndefined(); // third party vs EOR vs contractors: the category deepens it

    const legalId = await categoryIdOf(projectId, "corporate_legal_admin");
    const legal = await loadFactMap(h.db, legalId);
    expect(legal.legal_entity_stage).toMatchObject({ value: "evaluating_options", answerState: "ANSWERED" });

    // the thread opens as a continuation of the project
    const th = (await api.get(`/categories/${taxId}`)).body.thread;
    const opening = th.turns.map((t: any) => t.text).join(" ");
    expect(opening).toMatch(/Parto de lo que ya me contaste de tu proyecto \(.*operaciones con la matriz: /);
    expect(opening).not.toMatch(/cesitamos|…\)/); // clean lines, never a slice of the client's narrative
    const hrOpening = (await api.get(`/categories/${await categoryIdOf(projectId, "people_payroll_employment")}`)).body.thread.turns.map((t: any) => t.text).join(" ");
    expect(hrOpening).toMatch(/personas en el país: 20 directas y 40 por un tercero|personas en el país: 60 personas/);
    expect(opening).not.toMatch(/operaciones entre la entidad|hay operaciones intercompa/i);
    expect((await api.get(`/categories/${taxId}`)).body.progress.progressPct).toBeGreaterThan(0);
    expect(internalTermsIn(h.seen)).toEqual([]);
  }, 180000);

  it("no category conversation asks what the project already established; every question deepens", async () => {
    const { projectId, api } = await portugueseProject();
    const known = new Set(["tax_has_intercompany_transactions", "tax_intercompany_transactions", "legal_entity_stage", "customs_related_party_transactions"]);
    const asked: Array<{ category: string; field: string | null; text: string }> = [];
    for (const categoryKey of ["tax_accounting_audit", "corporate_legal_admin", "people_payroll_employment", "international_trade_customs"]) {
      const id = await categoryIdOf(projectId, categoryKey);
      const th = (await api.get(`/categories/${id}`)).body.thread;
      let last = [...th.turns].reverse().find((t: any) => t.role === "assistant");
      for (let i = 0; i < 4 && last; i++) {
        const field = (await h.db.query<{ structured: any }>("SELECT structured FROM precision_turn WHERE project_id = $1 AND role = 'assistant' AND scope_instance_id = $2 ORDER BY seq DESC LIMIT 1", [projectId, id])).rows[0]?.structured?.state?.fieldKey ?? null;
        asked.push({ category: categoryKey, field, text: last.text });
        const r = await api.post(`/categories/${id}/turns`, { turnKey: key("c"), text: "No lo sé todavía." });
        if (r.status !== 200) break;
        last = [...r.body.turns].reverse().find((t: any) => t.role === "assistant");
      }
    }
    expect(asked.length).toBeGreaterThan(4);
    for (const q of asked) if (q.field) expect(known.has(q.field)).toBe(false);
    // one question per turn is never the headcount total or "are there intercompany transactions"
    const texts = asked.map((q) => q.text.toLowerCase()).join(" | ");
    expect(texts).not.toMatch(/cuántas personas en total|habrá operaciones entre/);
  }, 240000);

  it("follows the project: a change in the frame updates what the category inherited; the client's own category answer is never overwritten", async () => {
    const { projectId } = await portugueseProject();
    const hrId = await categoryIdOf(projectId, "people_payroll_employment");
    const frames = createPgFrameStore(h.db);
    const stored = (await frames.load(projectId))!;

    // the client answers the group's role in the category: from now on that item is theirs
    const before = await loadFactMap(h.db, hrId);
    const mine = JSON.parse(JSON.stringify(before.hr_employee_population_breakdown!.value)) as Array<Record<string, unknown>>;
    mine[0]!.role_type = "Ingenieros de campo";
    await h.db.query("SELECT fact_record($1, $2, $3, $4::jsonb, 'repeatable_group', 'ANSWERED'::fact_answer_state, 'category'::fact_source, 'client_answered'::fact_provenance_stage, NULL, NULL, NULL)", [projectId, hrId, "precision.hr_employee_population_breakdown", JSON.stringify(mine)]);

    // the project changes: 80 people instead of 60 (material change in the frame)
    const f = JSON.parse(JSON.stringify(stored.frame));
    f.items["workforce.split"].value = { ...f.items["workforce.split"].value, direct: 30, outsourced: 50 };
    await frames.commit(projectId, f, stored.version, { turnKey: key("chg"), kind: "correction", payload: { op: "test" } });
    await syncProjectInheritance({ db: h.db, registry: h.runtime.deps.registry } as never, projectId);

    const after = await loadFactMap(h.db, hrId);
    // theirs stays; the disagreement is recorded for the specialist instead of silently resolved
    expect(after.hr_employee_population_breakdown?.value).toEqual(mine);
    const ledger = parseLedger(after[INHERITED_LEDGER_KEY]?.value);
    expect(ledger.conflicts.hr_employee_population_breakdown).toMatchObject({ frame: [{ headcount: 30 }, { headcount: 50 }] });

    // what the category inherited and the client did not touch follows the project
    const taxId = await categoryIdOf(projectId, "tax_accounting_audit");
    const f2 = JSON.parse(JSON.stringify((await frames.load(projectId))!.frame));
    f2.items["tax.intercompany"].value = { kinds: ["servicios entre empresas del grupo"] };
    f2.items["tax.intercompany"].display = "servicios entre empresas del grupo";
    await frames.commit(projectId, f2, (await frames.load(projectId))!.version, { turnKey: key("chg"), kind: "correction", payload: { op: "test" } });
    await syncProjectInheritance({ db: h.db, registry: h.runtime.deps.registry } as never, projectId);
    const tax = await loadFactMap(h.db, taxId);
    expect(tax.tax_intercompany_transactions?.value).toEqual([{ transaction_type: "services", counterparty_country: ["PT"] }]);
    // idempotent
    const wrote = await syncProjectInheritance({ db: h.db, registry: h.runtime.deps.registry } as never, projectId);
    expect(wrote).toBe(0);
  }, 180000);
});
