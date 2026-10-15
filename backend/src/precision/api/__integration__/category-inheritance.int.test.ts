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
    // "Lo que ya sé de esta parte de tu proyecto": 3-4 short client-language lines, correctable, no technical state
    const knows = (await api.get(`/categories/${taxId}`)).body.knows;
    expect(knows.heading).toBe("Lo que ya sé de esta parte de tu proyecto");
    expect(knows.lines.length).toBeGreaterThanOrEqual(3);
    expect(knows.lines.length).toBeLessThanOrEqual(4);
    expect(JSON.stringify(knows)).toMatch(/Portugal/);
    expect(JSON.stringify(knows)).not.toMatch(/tax_|material:|_status|%/);
    expect(knows.lines.every((l: any) => /^Corrijo lo de «/.test(l.correctPrompt))).toBe(true);
    expect(internalTermsIn(h.seen)).toEqual([]);
  }, 180000);

  it("no category conversation asks what the project already established; every question deepens", async () => {
    const { projectId, api } = await portugueseProject();
    const known = new Set(["tax_has_intercompany_transactions", "tax_intercompany_transactions", "legal_entity_stage", "customs_related_party_transactions"]);
    const asked: Array<{ category: string; field: string | null; sub: string | null; text: string }> = [];
    for (const categoryKey of ["tax_accounting_audit", "corporate_legal_admin", "people_payroll_employment", "international_trade_customs"]) {
      const id = await categoryIdOf(projectId, categoryKey);
      const th = (await api.get(`/categories/${id}`)).body.thread;
      let last = [...th.turns].reverse().find((t: any) => t.role === "assistant");
      for (let i = 0; i < 4 && last; i++) {
        const st = (await h.db.query<{ structured: any }>("SELECT structured FROM precision_turn WHERE project_id = $1 AND role = 'assistant' AND scope_instance_id = $2 ORDER BY seq DESC LIMIT 1", [projectId, id])).rows[0]?.structured?.state;
        const field = st?.fieldKey ?? null;
        asked.push({ category: categoryKey, field, sub: st?.subKey ?? null, text: last.text });
        const r = await api.post(`/categories/${id}/turns`, { turnKey: key("c"), text: "No lo sé todavía." });
        if (r.status !== 200) break;
        last = [...r.body.turns].reverse().find((t: any) => t.role === "assistant");
      }
    }
    expect(asked.length).toBeGreaterThan(4);
    // an inherited group may be DEEPENED (a missing detail of an item the project already listed), never asked again as a whole
    for (const q of asked) if (q.field && !q.sub) expect(known.has(q.field)).toBe(false);
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
    // the parent loan of the project is an intra-group financing transaction too
    expect(tax.tax_intercompany_transactions?.value).toEqual([{ transaction_type: "services", counterparty_country: ["PT"] }, { transaction_type: "financing", counterparty_country: ["PT"] }]);
    // idempotent
    const wrote = await syncProjectInheritance({ db: h.db, registry: h.runtime.deps.registry } as never, projectId);
    expect(wrote).toBe(0);
  }, 180000);

  it("end to end: the Portuguese company reaches Preview and Operation Hub with the depth of a strong first meeting, without repeating itself", async () => {
    const { projectId, api } = await portugueseProject();
    const id = await categoryIdOf(projectId, "tax_accounting_audit");
    const opening = (await api.get(`/categories/${id}`)).body;
    expect(opening.progress.ready).toBe(false);

    // the category deepens: it only asks what is missing (registration, fiscal year, framework, group reporting, transfer-pricing status)
    const asked: string[] = [];
    const BY_FIELD: Record<string, Record<string, unknown>> = {
      tax_registration_status: { quickReply: { value: "not_started", intent: "answer" } },
      tax_fiscal_year_end: { text: "2026-12-31" },
      tax_accounting_framework: { quickReply: { value: "ifrs", intent: "answer" } },
      tax_parent_reporting_required: { quickReply: { value: "true", intent: "answer" } },
      tax_parent_reporting_framework: { quickReply: { value: "ifrs", intent: "answer" } },
      tax_transfer_pricing_documentation_status: { quickReply: { value: "not_started", intent: "answer" } },
      tax_advisory_questions: { text: "Cómo estructurar el financiamiento desde Portugal y qué documentar entre empresas del grupo." },
    };
    let last: any = opening;
    for (let i = 0; i < 20 && !last.progress.ready; i++) {
      const field = (await h.db.query<{ structured: any }>("SELECT structured FROM precision_turn WHERE project_id = $1 AND role = 'assistant' AND scope_instance_id = $2 ORDER BY seq DESC LIMIT 1", [projectId, id])).rows[0]?.structured?.state?.fieldKey as string | undefined;
      asked.push(String(field));
      const body = (field && BY_FIELD[field]) ?? { text: "Todavía no lo sé." };
      const r = await api.post(`/categories/${id}/turns`, { turnKey: key("t"), text: "", ...body });
      expect(r.status).toBe(200);
      last = r.body;
    }
    expect(last.progress.ready).toBe(true);
    expect(asked).not.toEqual(expect.arrayContaining(["tax_has_intercompany_transactions", "tax_intercompany_transactions", "tax_services_in_scope"]));
    expect(asked[0]).toBe("tax_registration_status"); // the first thing the category needs is what the project could not know
    // READINESS = MATERIAL SUFFICIENCY: the Portuguese context (parent, intra-group services, goods and a parent loan) made the
    // transfer-pricing documentation status and the agreement / value facts material, so Fiscal was not "ready" before they were explored
    expect(asked).toEqual(expect.arrayContaining(["tax_transfer_pricing_documentation_status", "tax_intercompany_transactions"]));
    expect(asked.indexOf("tax_transfer_pricing_documentation_status")).toBeGreaterThan(-1);
    expect(asked.length).toBeLessThanOrEqual(10);

    // CRP -> Preview -> send
    expect((await api.post(`/categories/${id}/crp/confirm`, {})).status).toBe(200);
    const preview = (await api.get(`/categories/${id}/preview`)).body;
    expect(preview.canSend).toBe(true);
    const previewText = JSON.stringify(preview.blocks);
    expect(previewText).toMatch(/entidad/i);
    expect(previewText).not.toMatch(/new:|_generic|fa4_|n:disc|fr:|¿/);
    const sent = await api.post(`/categories/${id}/send`, { previewChecksum: preview.previewChecksum });
    expect(sent.status).toBe(200);
    expect(sent.body.state).toBe("sent");

    // what the (simulated) platform actually received: richer than what Discovery alone could say
    const received = h.runtime.deps.integrations.operationHub as unknown as { receivedPayloads(p: string): any[] };
    const payloads = received.receivedPayloads(projectId);
    const crp = payloads.find((p) => p.contract.kind === "crp") ?? payloads.find((p) => p.contract.kind === "first_send") ?? payloads[0];
    expect(crp).toBeDefined();
    const psm = crp.project_context.psm;
    expect(psm.understanding.version).toBe(1);
    const factText = psm.understanding.facts.map((f: any) => `${f.label}: ${f.value}`).join(" | ");
    expect(factText).toMatch(/60 personas/);
    expect(factText).toMatch(/3 millones/);
    expect(psm.understanding.findings.length).toBeGreaterThan(2);
    expect(psm.understanding.findings.map((f: any) => f.title).join(" ")).toMatch(/subcontratado|intercompa|matriz/i);
    // the client's priority and reasons travel with the map, in the client's words
    const entity = psm.categories.flatMap((c: any) => c.items).find((i: any) => /entidad/i.test(i.label));
    expect(entity).toMatchObject({ priority: "high" });
    expect(entity.why).toBeTruthy();
    // the category record carries what was inherited AND what was deepened; the services and intercompany transactions were not re-asked
    const structured = JSON.stringify(crp.artifact.structured);
    expect(structured).toMatch(/transfer_pricing|precios de transferencia|Precios de transferencia/i);
    expect(structured).toMatch(/Portugal/); // the counterparty country comes from the project, not from a new question
    // corporate, legal, tax, labor, accounting and intercompany are all represented, and the specialist findings travel with them
    const labels = psm.categories.map((c: any) => `${c.category_label}`).join(" | ");
    expect(labels).toMatch(/Corporativo|legal/i);
    expect(labels).toMatch(/Personas|nómina|empleo/i);
    expect(labels).toMatch(/Impuestos|fiscal/i);
    const allItems = psm.categories.flatMap((c: any) => c.items.map((i: any) => i.label.toLowerCase())).join(" | ");
    expect(allItems).toMatch(/contabilidad/);
    expect(allItems).toMatch(/intercompa|precios de transferencia/);
    expect(allItems).toMatch(/seguridad social|laboral|contratar/);
    const findings = psm.understanding.findings.map((f: any) => `${f.title} ${f.detail}`).join(" ").toLowerCase();
    expect(findings).toMatch(/subcontrat|tercero/);
    expect(findings).toMatch(/prestaciones|laboral|directa/);
    expect(findings).toMatch(/intercompa|matriz/);
    // Discovery alone gave ONE need; the platform now holds the whole project
    expect(psm.categories.flatMap((c: any) => c.items).length).toBeGreaterThan(5);
    // no conversational residue and no internal identifiers
    expect(JSON.stringify(crp)).not.toMatch(/n:disc|"fr:|new:|_generic|fa4_|¿/);
    // backward compatible: a consumer that ignores the additive block still reads a complete, valid payload
    const { understanding: _ignored, ...legacyPsm } = psm;
    void _ignored;
    expect(legacyPsm.objectives.length).toBeGreaterThan(0);
    expect(legacyPsm.categories.length).toBeGreaterThan(2);
    expect(internalTermsIn(h.seen)).toEqual([]);
  }, 240000);
});
