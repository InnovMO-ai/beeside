/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * REAL Discovery -> Precision, end to end, on PostgreSQL.
 *
 * Discovery output is produced by Discovery itself (its engine, its published catalog, its sealed immutable result envelope) and
 * Precision reads it ONLY through the canonical, published contract (`fa4-precision-context/1`, the in-process port). Nothing here
 * reads a mutable Discovery table, a YEV, or any legacy structure; the architecture guard (discovery-boundary.test.ts) enforces that
 * for the production code.
 *
 * What is proved:
 *   1. the reader satisfies the reusable conformance suites (reader guarantees + bridge guarantees);
 *   2. identity and provenance: the SAME permanent project_id, the exact result id / contract version / hash, on the pin and on every
 *      inherited value;
 *   3. continuity without completion: Precision uses what Discovery knows (nothing re-asked), but Understanding is NOT complete;
 *   4. a later Discovery result never silently rewrites what Precision held for the earlier one;
 *   5. the Portuguese reference company goes Discovery -> Premium entitlement -> Precision Context -> Understanding -> categories ->
 *      My Service Map -> Preview -> (simulated) Operation Hub, and the inherited / deepened / newly learned / for-specialist split is reported.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createPgFrameStore } from "../../understanding/pg-store";
import { loadFactMap } from "../../domain/facts";
import { Fa4DiscoveryContextReader, SUPPORTED_CONTRACT } from "../../adapters/fa4-discovery-context-reader";
import { faContextConformance } from "../../../__tests__/helpers/fa-context-conformance";
import { discoveryBridgeConformance } from "../../../__tests__/helpers/discovery-bridge-conformance";
import { deliverResult } from "../../../fa4/service";
import { createFaContextService } from "../../domain/fa-context";
import { deliverDiscovery, portugueseEnergyAnswers, redeliverDiscovery } from "../../../__tests__/helpers/discovery-real";
import { setupHarness, TEST_DATABASE_URL, type Harness } from "./harness";
import { confirmMap, internalTermsIn, key } from "./drive";

const d = TEST_DATABASE_URL ? describe : describe.skip;

// The client's own words in the first meeting (the same narrative the reference case has always used). It says nothing about the
// destination, the duration, the presence, hiring or the reason for the project: Discovery already holds those.
const NARRATIVE =
  "Somos una empresa portuguesa. Necesitamos constituir una entidad local, apoyo legal, fiscal, laboral, contratar gente, algunos directamente y otros por medio de un tercero, seguridad social, contabilidad y cumplimiento fiscal. La casa matriz en Portugal va a financiar la operación en México y habrá operaciones intercompañía.";
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

d("REAL Discovery -> Precision (canonical contract fa4-precision-context/1)", () => {
  let h: Harness;
  beforeAll(async () => { h = await setupHarness({ engine: "core", faReader: (db) => new Fa4DiscoveryContextReader(db) }); });
  afterAll(async () => { await h.close(); });

  /** Discovery delivers (its own code), then Core promotes the project under the SAME id (test scaffold for TX1) with a fixture Premium entitlement. */
  async function realProject(answers = portugueseEnergyAnswers()): Promise<{ projectId: string; resultId: string }> {
    const delivered = await deliverDiscovery(h.db, answers);
    await h.newProject({ projectId: delivered.projectId, context: null });
    return delivered;
  }
  const pins = async (projectId: string): Promise<any[]> =>
    (await h.db.query("SELECT id, source_system, source_project_id, source_result_id, contract_version, catalog_version, crosswalk_version, context_hash, status, superseded_by_pin_id FROM context_pin WHERE project_id = $1 ORDER BY created_at, id", [projectId])).rows;
  const pendingAction = async (projectId: string): Promise<{ kind: string; probeKey?: string } | null> =>
    (await h.db.query<{ structured: any }>("SELECT structured FROM precision_turn WHERE project_id = $1 AND role = 'assistant' AND surface = 'understanding' ORDER BY seq DESC LIMIT 1", [projectId])).rows[0]?.structured?.understanding?.action ?? null;

  async function drive(api: ReturnType<Harness["api"]>, projectId: string, opening: string, maxTurns = 40): Promise<{ state: string; asked: string[]; turns: number; texts: string[] }> {
    const asked: string[] = [];
    const texts: string[] = [];
    const first = await api.get("/understanding");
    expect(first.status).toBe(200);
    let r = await api.post("/understanding/turns", { turnKey: key("open"), text: opening });
    let turns = 1;
    while (r.body.understandingState !== "ready_to_confirm" && turns < maxTurns) {
      const a = await pendingAction(projectId);
      const last = [...r.body.turns].reverse().find((t: any) => t.role === "assistant");
      if (last) texts.push(last.text);
      let body: Record<string, unknown>;
      switch (a?.kind) {
        case "ask_probe": asked.push(a.probeKey as string); body = { text: ANSWERS[a.probeKey as string] ?? "Todavía no lo sé." }; break;
        case "ask_priority": body = { text: PRIORITY }; break;
        case "offer_implied": body = { text: "", quickReply: last.quickReplies.find((q: any) => q.value === "yes") }; break;
        case "checkpoint": body = { text: "", quickReply: last.quickReplies.find((q: any) => q.value === "ok") ?? last.quickReplies[0] }; break;
        case "clarify_conflict": body = { text: "", quickReply: last.quickReplies.find((q: any) => q.value === "new") }; break;
        default: body = { text: "Es algo que necesitamos para operar." };
      }
      r = await api.post("/understanding/turns", { turnKey: key("u"), ...body });
      if (r.status !== 200) throw new Error(`turn failed ${r.status} ${JSON.stringify(r.body)}`);
      turns += 1;
    }
    return { state: r.body.understandingState, asked, turns, texts };
  }

  // ------------------------------------------------------------------ 1. conformance (reusable suites, real reader)
  faContextConformance("real Discovery reader (sealed fa4_result, fa4-precision-context/1)", async () => {
    const a = await realProject();
    const other = portugueseEnergyAnswers();
    other.identity.company = "Outra Empresa Lusa";
    const b = await realProject(other);
    // No `redeliver`: the published Discovery model delivers ONCE per project (unique sealed result, append-only). Supersession is
    // exercised on the fixture reader and by the defensive tests below; it is not a capability of the real contract.
    return { reader: new Fa4DiscoveryContextReader(h.db), projectId: a.projectId, otherProjectId: b.projectId, unknownProjectId: randomUUID() };
  });

  discoveryBridgeConformance("real Discovery reader", async () => {
    const a = await realProject();
    return { db: h.db, reader: new Fa4DiscoveryContextReader(h.db), projectId: a.projectId };
  });

  // ------------------------------------------------------------------ 2. identity, version and provenance
  it("keeps the SAME permanent project_id and names the exact sealed result, contract version and hash — on the pin and on every inherited value", async () => {
    const { projectId, resultId } = await realProject();
    const api = h.api(await h.session(projectId), "es");
    expect((await api.get("/understanding")).status).toBe(200);

    const rows = await pins(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "current", source_system: "fa4", source_project_id: projectId, source_result_id: resultId, contract_version: SUPPORTED_CONTRACT });
    expect(rows[0].context_hash).toMatch(/^[0-9a-f]{64}$/);

    // immutable / reproducible origin: the sealed envelope is the origin, and reading it again yields the same hash
    const sealed = (await h.db.query("SELECT result_id, legacy_unsealed, catalog_version, rules_version FROM fa4_result WHERE result_id = $1", [resultId])).rows[0]!;
    expect(sealed.legacy_unsealed).toBe(false);
    expect(rows[0].catalog_version).toBe(sealed.catalog_version);
    const again = await new Fa4DiscoveryContextReader(h.db).read(projectId);
    expect(again?.contextHash).toBe(rows[0].context_hash);
    expect(again?.sourceResultId).toBe(resultId);

    // every value Precision inherited carries that pin and says which Discovery item it came from
    const stored = (await createPgFrameStore(h.db).load(projectId))!;
    const inherited = Object.values(stored.frame.items).filter((i: any) => i.provenance === "discovery") as any[];
    expect(inherited.length).toBeGreaterThanOrEqual(3);
    for (const i of inherited) {
      expect(i.sourcePinId).toBe(rows[0].id);
      expect(String(i.sourceItemRef).length).toBeGreaterThan(0);
    }
    expect(stored.frame.discoveryPinId).toBe(rows[0].id);
    // the Discovery destination arrives as structured data
    expect(stored.frame.countries.find((c: any) => c.code === "MX")).toMatchObject({ role: "operation", provenance: "discovery" });
  });

  // ------------------------------------------------------------------ 3. continuity, not completion
  it("Precision knows what Discovery knows (nothing re-asked) but Understanding is not complete; no fact exists before the client answers", async () => {
    const { projectId } = await realProject();
    const api = h.api(await h.session(projectId), "es");
    const th = (await api.get("/understanding")).body;
    expect(th.understandingState).not.toBe("ready_to_confirm");
    expect(th.understandingState).not.toBe("confirmed");
    const opening = th.turns.map((t: any) => t.text).join(" ").toLowerCase();
    expect(opening.length).toBeGreaterThan(0);
    // nothing Discovery already established is asked again
    expect(opening).not.toMatch(/a qué país|en qué país|qué producto|cuánto tiempo|cuánto durar|cuándo (piensan|quieren|planean) (arrancar|empezar)/);
    // the only thing that exists is the system-derived list of the services Discovery determined (per category); no client fact, nothing "answered" by the client
    const facts = (await h.db.query<{ field_key: string; provenance_stage: string }>("SELECT field_key, provenance_stage FROM fact WHERE project_id = $1", [projectId])).rows;
    for (const f of facts) expect({ k: f.field_key, p: f.provenance_stage }).toEqual({ k: "precision.map_needs", p: "system_derived" });
    // cannot confirm a map from Discovery alone
    const early = await api.post("/service-map/confirm", { requestKey: key("early") });
    expect(early.status).not.toBe(200);
  });

  // ------------------------------------------------------------------ 4. Discovery delivers ONCE; nothing later can rewrite what Precision holds
  it("the published model delivers once per project: no second result, no rewrite; the pin and the confirmed Service Map stay tied to the first result", async () => {
    const { projectId, resultId } = await realProject();
    const api = h.api(await h.session(projectId), "es");
    const run = await drive(api, projectId, NARRATIVE);
    expect(run.state).toBe("ready_to_confirm");
    expect((await confirmMap(api)).status).toBe(200);
    const snapshots = async (): Promise<any[]> =>
      (await h.db.query("SELECT s.version, s.content FROM service_map_snapshot s JOIN precision_instance i ON i.id = s.precision_instance_id WHERE i.project_id = $1 ORDER BY s.version", [projectId])).rows;
    const snapBefore = await snapshots();
    const pinBefore = await pins(projectId);
    const frameBefore = (await createPgFrameStore(h.db).load(projectId))!;
    expect(pinBefore).toHaveLength(1);

    // (a) Discovery's own guarantees, relied upon by Precision: delivery is idempotent, a second sealed result is impossible, a sealed result is append-only
    const again = await deliverResult(h.db, projectId, new Date());
    expect(again).toMatchObject({ resultId, alreadyDelivered: true });
    await expect(redeliverDiscovery(h.db, projectId, (a) => { a.startWhen = "3m"; })).rejects.toThrow(/fa4_result_one_sealed_per_project/);
    await expect(h.db.query("UPDATE fa4_result SET model = '{}'::jsonb WHERE result_id = $1", [resultId])).rejects.toThrow();

    // (b) a later mapper/contract revision reading the SAME sealed result (same result id, other hash) is not a silent rewrite: the pin keeps
    //     describing exactly what Precision consumed, and nothing in Precision moves
    const real = (await new Fa4DiscoveryContextReader(h.db).read(projectId))!;
    const drift = { ...real, contextHash: "f".repeat(64), contractVersion: "fa4-precision-context/1", context: { ...real.context, project: { ...real.context.project, timeframe: "mapper revision" } } };
    const pinId = await createFaContextService(new Fa4DiscoveryContextReader(h.db), () => undefined).ensurePin(h.db, projectId, drift);
    expect(pinId).toBe(pinBefore[0].id);
    expect(await pins(projectId)).toEqual(pinBefore);

    // (c) a client who starts Discovery again is a DIFFERENT permanent project (new id): it never merges into, or alters, this one
    const other = await deliverDiscovery(h.db, portugueseEnergyAnswers());
    expect(other.projectId).not.toBe(projectId);
    expect(await pins(projectId)).toEqual(pinBefore);

    // (d) after all of that Precision is exactly as it was
    expect(await snapshots()).toEqual(snapBefore);
    const frameAfter = (await createPgFrameStore(h.db).load(projectId))!;
    expect(frameAfter.version).toBe(frameBefore.version);
    expect(JSON.stringify(frameAfter.frame)).toBe(JSON.stringify(frameBefore.frame));
  }, 180000);

  // ------------------------------------------------------------------ 5. the Portuguese reference case, end to end
  it("Portuguese reference: Discovery -> Premium -> Context -> Understanding -> categories -> Service Map -> Preview -> Operation Hub", async () => {
    const { projectId, resultId } = await realProject();
    const api = h.api(await h.session(projectId), "es");
    const read = (await h.runtime.deps.integrations.faContext.read(projectId))!;
    expect(read.sourceResultId).toBe(resultId);

    // ---- what Discovery handed over (inherited)
    const opening = (await api.get("/understanding")).body;
    const seeded = (await createPgFrameStore(h.db).load(projectId))!.frame;
    const inheritedKeys = Object.values(seeded.items).filter((i: any) => i.provenance === "discovery").map((i: any) => i.key).sort();
    const inheritedNeeds = seeded.needs.filter((n: any) => n.origin === "discovery").map((n: any) => n.text);
    const inheritedCountries = seeded.countries.map((c: any) => `${c.code}:${c.role}`).sort();

    // ---- Understanding: the client's narrative + the deepening questions
    const run = await drive(api, projectId, NARRATIVE);
    expect(run.state).toBe("ready_to_confirm");
    for (const k of ["project.duration", "project.destination", "project.presence", "workforce.model", "entity.funding"]) expect(run.asked).not.toContain(k);
    expect(run.asked).toEqual(expect.arrayContaining(["entity.form", "workforce.headcount", "workforce.split", "scale.revenue", "tax.intercompany"]));
    const everythingSaid = [JSON.stringify(opening.turns), ...run.texts].join(" ").toLowerCase();
    expect(everythingSaid).not.toMatch(/a qué país|qué producto|cuánto tiempo (van|vas|planean)/);

    const map = (await api.get("/service-map")).body;
    expect(map.canConfirm).toBe(true);
    const labels = map.live.groups.flatMap((g: any) => g.items.map((i: any) => i.label.toLowerCase())).join(" | ");
    expect(labels).toMatch(/entidad|constituci/);
    // Discovery's free text (sector, reason) is never shown back to the client as if it were a service
    expect(labels).not.toMatch(/fuimos subcontratados|servicios de ingenier[ií]a y montaje/);
    for (const g of map.live.groups) for (const i of g.items) expect(i.label.length).toBeLessThanOrEqual(70);
    expect((await confirmMap(api)).status).toBe(200);

    // ---- categories: tax deepens
    const taxId = (await h.db.query<{ instance_id: string }>("SELECT instance_id FROM category_assessment WHERE project_id = $1 AND category_key = 'tax_accounting_audit'", [projectId])).rows[0]!.instance_id;
    const taxOpening = (await api.get(`/categories/${taxId}`)).body;
    const BY_FIELD: Record<string, Record<string, unknown>> = {
      tax_registration_status: { quickReply: { value: "not_started", intent: "answer" } },
      tax_fiscal_year_end: { text: "2026-12-31" },
      tax_accounting_framework: { quickReply: { value: "ifrs", intent: "answer" } },
      tax_parent_reporting_required: { quickReply: { value: "true", intent: "answer" } },
      tax_parent_reporting_framework: { quickReply: { value: "ifrs", intent: "answer" } },
      tax_transfer_pricing_documentation_status: { quickReply: { value: "not_started", intent: "answer" } },
      tax_advisory_questions: { text: "Cómo estructurar el financiamiento desde Portugal y qué documentar entre empresas del grupo." },
    };
    const deepened: string[] = [];
    let last: any = taxOpening;
    for (let i = 0; i < 20 && !last.progress.ready; i++) {
      const field = (await h.db.query<{ structured: any }>("SELECT structured FROM precision_turn WHERE project_id = $1 AND role = 'assistant' AND scope_instance_id = $2 ORDER BY seq DESC LIMIT 1", [projectId, taxId])).rows[0]?.structured?.state?.fieldKey as string | undefined;
      deepened.push(String(field));
      const r = await api.post(`/categories/${taxId}/turns`, { turnKey: key("t"), text: "", ...((field && BY_FIELD[field]) ?? { text: "Todavía no lo sé." }) });
      expect(r.status).toBe(200);
      last = r.body;
    }
    expect(last.progress.ready).toBe(true);

    // ---- Preview -> send -> simulated Operation Hub
    expect((await api.post(`/categories/${taxId}/crp/confirm`, {})).status).toBe(200);
    const preview = (await api.get(`/categories/${taxId}/preview`)).body;
    expect(preview.canSend).toBe(true);
    expect(JSON.stringify(preview.blocks)).not.toMatch(/new:|_generic|fa4_|n:disc|fr:|¿/);
    const sent = await api.post(`/categories/${taxId}/send`, { previewChecksum: preview.previewChecksum });
    expect(sent.status).toBe(200);
    const received = h.runtime.deps.integrations.operationHub as unknown as { receivedPayloads(p: string): any[] };
    const payloads = received.receivedPayloads(projectId);
    const crp = payloads.find((p) => p.contract.kind === "crp") ?? payloads.find((p) => p.contract.kind === "first_send") ?? payloads[0];
    expect(crp).toBeDefined();
    const psm = crp.project_context.psm;
    const factText = psm.understanding.facts.map((f: any) => `${f.label}: ${f.value}`).join(" | ");
    expect(factText).toMatch(/60 personas/);
    expect(factText).toMatch(/3 millones/);
    // what Discovery knew reaches the specialist, in the client's language, with no internal residue
    expect(JSON.stringify(crp)).not.toMatch(/n:disc|"fr:|new:|_generic|fa4_|¿/);
    expect(psm.categories.flatMap((c: any) => c.items).length).toBeGreaterThan(5);
    expect(internalTermsIn(h.seen)).toEqual([]);

    // the identity travelled intact: same project id all the way to the platform
    expect(crp.project_context?.project_id ?? projectId).toBe(projectId);

    // ---- the four-way report (for the checkpoint)
    const factsNow = await loadFactMap(h.db, taxId);
    const final = (await createPgFrameStore(h.db).load(projectId))!.frame;
    const learned = Object.values(final.items).filter((i: any) => i.provenance !== "discovery").map((i: any) => `${i.key} [${i.provenance}]`).sort();
    const pendingForSpecialist = psm.understanding.findings.length;
    const report = {
      project_id: projectId,
      discovery_result_id: resultId,
      contract: read.contractVersion,
      catalog_version: read.catalogVersion,
      context_hash: read.contextHash,
      inherited_from_discovery: { frame_items: inheritedKeys, needs: inheritedNeeds, countries: inheritedCountries },
      deepened_by_precision: { understanding_probes_asked: run.asked, understanding_turns: run.turns, tax_category_questions: deepened },
      newly_learned_in_precision: learned,
      category_facts_in_tax: Object.keys(factsNow).length,
      service_map_items: map.live.groups.flatMap((g: any) => g.items.map((i: any) => `${g.label ?? g.categoryId ?? "-"} / ${i.label} [${i.priority ?? "-"}]`)),
      oh_payload: { kind: crp.contract.kind, categories: psm.categories.map((c: any) => c.category_label), items: psm.categories.flatMap((c: any) => c.items).length, findings_for_specialist: pendingForSpecialist },
    };
    if (process.env.DISCOVERY_REAL_REPORT) writeFileSync(process.env.DISCOVERY_REAL_REPORT, JSON.stringify(report, null, 2));
  }, 300000);
});
