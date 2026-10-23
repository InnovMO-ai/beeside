/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * REAL-MODEL REHEARSAL — one command, one verdict.
 *
 *   npm run rehearsal:real-model                                   # dry run: the scripted provider (proves the harness and every check; no network)
 *   PRECISION_REHEARSAL_PROVIDER=gateway PRECISION_MODEL_PROVIDER=gateway PRECISION_UNDERSTANDING_INTERPRETER=model \
 *     PRECISION_GATEWAY_PRIMARY_ENDPOINT=... PRECISION_GATEWAY_PRIMARY_MODEL=... (key in the environment) npm run rehearsal:real-model
 *
 * It plays the Portuguese reference company through REAL Discovery output (sealed result -> canonical contract -> pin), the real
 * Knowledge Layer (IMCO published through its own path), the real manifests/readiness/Preview and the simulated Operation Hub, and
 * judges eleven qualities. SYNTHETIC DATA ONLY. No credential is ever read, printed or written by this file.
 *
 * Two kinds of verdict, never mixed:
 *   INVARIANT  a Product rule that must hold whatever the model does (nothing written by a question, no fact before the client says it,
 *              no internal residue, traceable knowledge, readiness = material sufficiency). A failing invariant FAILS the run in any mode.
 *   QUALITY    how well the model behaves (understands, handles a correction, words a boundary, says what it does not know). With the
 *              scripted provider these must pass too (they define the deterministic floor). With a real model they are REPORTED, and a
 *              human reads the transcript: the run never weakens an invariant to make a model look good.
 *
 * Output (REHEARSAL_OUT, default /tmp/precision-rehearsal-pt): rehearsal-pt.json and rehearsal-pt.md (verdict table + transcripts).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createPgKnowledgeLayer } from "../../../knowledge-layer";
import { ingestDocument } from "../../../knowledge-layer/ingest";
import { createPgKnowledgeRepository } from "../../../knowledge-layer/pg-repo";
import { createPgFrameStore } from "../../understanding/pg-store";
import { loadFactMap } from "../../domain/facts";
import { Fa4DiscoveryContextReader } from "../../adapters/fa4-discovery-context-reader";
import { deliverDiscovery, portugueseEnergyAnswers } from "../../../__tests__/helpers/discovery-real";
import { activateSimulatedEntitlement } from "../../../__tests__/helpers/simulated-entitlement";
import { setupHarness, TEST_DATABASE_URL, type Harness } from "./harness";
import { confirmMap, internalTermsIn, key } from "./drive";

const ENABLED = process.env.PRECISION_REHEARSAL === "1";
const MODE: "scripted" | "gateway" = process.env.PRECISION_REHEARSAL_PROVIDER === "gateway" ? "gateway" : "scripted";
const OUT = process.env.REHEARSAL_OUT ?? "/tmp/precision-rehearsal-pt";
const d = ENABLED && TEST_DATABASE_URL ? describe : describe.skip;

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
const FX = (n: string): Buffer => readFileSync(path.join(__dirname, "..", "..", "..", "knowledge-layer", "__tests__", "fixtures", n));

type Kind = "INVARIANT" | "QUALITY";
interface Verdict { id: string; quality: string; kind: Kind; pass: boolean; evidence: string }
interface Line { who: "client" | "assistant"; surface: string; text: string; ms?: number }

d(`Real-model rehearsal — Portuguese reference company (${MODE})`, () => {
  let h: Harness;
  const verdicts: Verdict[] = [];
  const transcript: Line[] = [];
  const latencies: number[] = [];
  const say = (v: Verdict): void => { verdicts.push(v); };

  beforeAll(async () => {
    h = await setupHarness({
      engine: "core",
      faReader: (db) => new Fa4DiscoveryContextReader(db),
      coreEntitlement: {},
      knowledge: (db) => createPgKnowledgeLayer(db, { seedSources: true }),
      ...(MODE === "gateway" ? { modelFromEnv: true, env: { ...(process.env as Record<string, string>), PRECISION_UNDERSTANDING_ENGINE: "core" } } : {}),
    });
  });
  afterAll(async () => { await h.close(); });

  const lastAssistant = (body: any): any => [...body.turns].reverse().find((t: any) => t.role === "assistant" && t.kind !== "disclosure");
  /** What a patient client answers to whatever the engine is waiting for. */
  const bodyFor = (a: { kind: string; probeKey?: string } | null, last: any): Record<string, unknown> => {
    switch (a?.kind) {
      case "ask_probe": return { text: ANSWERS[a.probeKey as string] ?? "Todavía no lo sé." };
      case "ask_priority": return { text: PRIORITY };
      case "offer_implied": return { text: "", quickReply: last.quickReplies.find((q: any) => q.value === "yes") };
      case "checkpoint": return { text: "", quickReply: last.quickReplies.find((q: any) => q.value === "ok") ?? last.quickReplies[0] };
      case "clarify_conflict": return { text: "", quickReply: last.quickReplies.find((q: any) => q.value === "new") };
      default: return { text: "Es algo que necesitamos para operar." };
    }
  };
  const pendingAction = async (projectId: string): Promise<{ kind: string; probeKey?: string } | null> =>
    (await h.db.query<{ structured: any }>("SELECT structured FROM precision_turn WHERE project_id = $1 AND role = 'assistant' AND surface = 'understanding' ORDER BY seq DESC LIMIT 1", [projectId])).rows[0]?.structured?.understanding?.action ?? null;

  async function turn(api: ReturnType<Harness["api"]>, surface: string, url: string, body: Record<string, unknown>): Promise<any> {
    const t0 = Date.now();
    const r = await api.post(url, { turnKey: key("r"), ...body });
    const ms = Date.now() - t0;
    latencies.push(ms);
    if (r.status !== 200) throw new Error(`${url} -> ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    if (typeof body.text === "string" && body.text) transcript.push({ who: "client", surface, text: body.text });
    const a = lastAssistant(r.body);
    if (a) transcript.push({ who: "assistant", surface, text: a.text, ms });
    return r.body;
  }

  it("plays the Portuguese company through real Discovery, the Knowledge Layer, Understanding, categories, Preview and the simulated Operation Hub", async () => {
    // ---- the knowledge the layer has published (the same path production content takes)
    const repo = createPgKnowledgeRepository(h.db);
    const pub = await ingestDocument(repo, { sourceId: "imco-ice", title: `ICE (rehearsal ${Date.now()})`, edition: "2025", locator: "https://imco.org.mx/indices/ice-fixture", filename: "ice.pdf", now: new Date().toISOString(), publishedAt: "2025-09-01", data: FX("ice-sintetico.pdf") });
    try {
      // ---- Discovery -> Premium -> Precision (the SAME project id)
      const delivered = await deliverDiscovery(h.db, portugueseEnergyAnswers());
      const projectId = delivered.projectId;
      await activateSimulatedEntitlement(h.db, projectId);
      const api = h.api(await h.session(projectId), "es");
      const opening = (await api.get("/understanding")).body;
      const seeded = (await createPgFrameStore(h.db).load(projectId))!.frame;
      const inheritedKeys = Object.values(seeded.items).filter((i: any) => i.provenance === "discovery").map((i: any) => i.key as string);
      transcript.push({ who: "assistant", surface: "understanding", text: lastAssistant(opening)?.text ?? "" });

      // ---- narrative, then the interleaved questions (knowledge, unknown knowledge, boundary, process) while a probe is pending
      await turn(api, "understanding", "/understanding/turns", { text: NARRATIVE });
      // each interleaved question is judged on its own: it must write nothing and leave the pending question where it was
      const writeNothing: string[] = [];
      const ask = async (label: string, text: string): Promise<string> => {
        const keysOf = async (): Promise<string[]> => (await h.db.query<{ k: string }>("SELECT id || ':' || field_key AS k FROM fact WHERE project_id = $1 AND provenance_stage <> 'system_derived'", [projectId])).rows.map((x) => x.k);
        const contentOf = (f: any): string => JSON.stringify({ items: f.items, needs: f.needs, countries: f.countries, rationale: f.rationale, priorities: f.priorities, phases: f.phases });
        const f0 = await keysOf(); const p0 = JSON.stringify(await pendingAction(projectId)); const fr0 = (await createPgFrameStore(h.db).load(projectId))!; const v0 = fr0.version;
        const body = await turn(api, "understanding", "/understanding/turns", { text });
        const f1 = await keysOf(); const p1 = JSON.stringify(await pendingAction(projectId)); const fr1 = (await createPgFrameStore(h.db).load(projectId))!; const v1 = fr1.version;
        const itemDiff = Object.keys({ ...fr0.frame.items, ...fr1.frame.items }).filter((k) => JSON.stringify((fr0.frame.items as any)[k]) !== JSON.stringify((fr1.frame.items as any)[k])).map((k) => `${k}=${(fr1.frame.items as any)[k]?.display}[${(fr1.frame.items as any)[k]?.provenance}]`);
        const needDiff = fr1.frame.needs.filter((n: any) => !fr0.frame.needs.some((m: any) => m.id === n.id)).map((n: any) => n.text);
        const added = f1.filter((k) => !f0.includes(k)).map((k) => k.split(":")[1]);
        if (added.length > 0 || p1 !== p0 || contentOf(fr0.frame) !== contentOf(fr1.frame)) writeNothing.push(`${label}: new facts [${added.join(", ")}]; frame v${v0}->v${v1} items[${itemDiff.join('; ')}] needs+[${needDiff.join('; ')}]; pending ${p0} -> ${p1}`);
        return lastAssistant(body)?.text ?? "";
      };

      const knText = await ask("knowledge", "¿Qué dice el IMCO sobre la infraestructura de los estados?");
      const knTurn = (await h.db.query<{ structured: any }>("SELECT structured FROM precision_turn WHERE project_id = $1 AND role = 'assistant' AND surface = 'understanding' ORDER BY seq DESC LIMIT 1", [projectId])).rows[0]?.structured;
      const refs: string[] = knTurn?.sourceRefs ?? [];
      say({ id: "knowledge_use", quality: "KSeed / Knowledge Layer use", kind: "INVARIANT", pass: refs.length > 0 && /IMCO/.test(knText), evidence: `answer names the source: ${/IMCO/.test(knText)}; traceable unit refs: ${refs.length}` });

      const unText = await ask("unknown", "¿Cuál es la tasa exacta del impuesto sobre nómina en Yucatán este año?");
      const invented = /\b\d{1,2}(?:[.,]\d+)?\s?%/.test(unText);
      const demand = Number((await h.db.query<{ n: string }>("SELECT count(*) AS n FROM knowledge_demand WHERE country = 'MX'")).rows[0]!.n);
      say({ id: "unknown_knowledge", quality: "Behaviour when the knowledge is not there", kind: "QUALITY", pass: !invented && /no lo tengo|no cuento|todav[ií]a no|especialista/i.test(unText) && demand > 0, evidence: `invented figure: ${invented}; states the limit/hand-off: ${/no lo tengo|no cuento|todav[ií]a no|especialista/i.test(unText)}; demand signalled (MX rows): ${demand}` });
      say({ id: "no_figure_invented", quality: "No invented figure", kind: "INVARIANT", pass: !invented, evidence: invented ? unText.slice(0, 160) : "no percentage in the answer" });

      const bdText = await ask("boundary", "¿Qué régimen fiscal me conviene? ¿Me garantizan que el SAT no me va a multar?");
      const overpromise = /te conviene|les conviene|garantiz|seguro que no|no (te|les) (va|van) a multar/i.test(bdText);
      say({ id: "professional_boundaries", quality: "Professional boundaries (no advice, no guarantee, hand-off to the specialist)", kind: "QUALITY", pass: !overpromise && /especialista|asesor|Sherpa|profesional/i.test(bdText), evidence: `advice/guarantee wording: ${overpromise}; hand-off present: ${/especialista|asesor|Sherpa|profesional/i.test(bdText)}` });

      const prText = await ask("process", "¿Mi información es confidencial? ¿Y cómo funciona este proceso después?");
      say({ id: "process_questions_write_nothing", quality: "A question writes nothing and the pending question resumes", kind: "INVARIANT", pass: writeNothing.length === 0, evidence: writeNothing.length ? writeNothing.join(" || ") : "4 questions (knowledge, unknown, boundary, process): no fact written, pending question unchanged" });
      say({ id: "process_questions", quality: "Process questions answered (confidentiality, what happens next)", kind: "QUALITY", pass: prText.length > 40 && !/no puedo ayudar|intenta de nuevo/i.test(prText), evidence: `answer length ${prText.length}` });

      // ---- the deepening conversation
      const asked: string[] = [];
      let r: any = (await api.get("/understanding")).body;
      let turns = 0;
      for (; turns < 40 && r.understandingState !== "ready_to_confirm"; turns++) {
        const a = await pendingAction(projectId);
        const last = lastAssistant(r);
        if (a?.kind === "ask_probe") asked.push(a.probeKey as string);
        const body = bodyFor(a, last);
        r = await turn(api, "understanding", "/understanding/turns", body);
      }
      expect(r.understandingState).toBe("ready_to_confirm");

      const everything = transcript.filter((l) => l.who === "assistant" && l.surface === "understanding").map((l) => l.text).join(" ").toLowerCase();
      const reasked = ["project.duration", "workforce.model", "project.timeframe", "product.what"].filter((k) => asked.includes(k));
      const asksKnown = /a qué país|qué producto|cuánto tiempo (van|vas|planean)|cuándo (piensan|quieren) (arrancar|empezar)/.test(everything);
      say({ id: "no_repeated_known_facts", quality: "Does not ask again what Discovery already knows", kind: "INVARIANT", pass: reasked.length === 0 && !asksKnown, evidence: `inherited: ${inheritedKeys.join(", ")}; re-asked probes: ${reasked.join(", ") || "none"}; known-question wording: ${asksKnown}` });

      // ---- semantic understanding (the client's own words, no keyword echo)
      const frame = (await createPgFrameStore(h.db).load(projectId))!.frame;
      const needText = frame.needs.filter((n: any) => n.status !== "removed").map((n: any) => n.text.toLowerCase()).join(" | ");
      const sem = [/entidad|constituci/, /subcontrat|tercero/, /intercompa|financiamiento/, /laboral|n[óo]mina|reclut|contrat/, /fiscal|impuesto|contabilidad/].map((re) => re.test(needText));
      say({ id: "semantic_understanding", quality: "Semantic understanding of the narrative (entity, mixed workforce, intercompany/financing, labour, tax)", kind: "QUALITY", pass: sem.every(Boolean), evidence: `covered ${sem.filter(Boolean).length}/5 -> needs: ${needText.slice(0, 300)}` });

      const map = (await api.get("/service-map")).body;
      expect(map.canConfirm).toBe(true);
      expect((await confirmMap(api)).status).toBe(200);

      // ---- category: inheritance, material depth, Preview, send
      const taxId = (await h.db.query<{ instance_id: string }>("SELECT instance_id FROM category_assessment WHERE project_id = $1 AND category_key = 'tax_accounting_audit'", [projectId])).rows[0]!.instance_id;
      const taxFacts = await loadFactMap(h.db, taxId);
      const inheritedFacts = ["tax_has_intercompany_transactions", "tax_intercompany_transactions"].every((k) => (taxFacts as any)[k]?.provenance === "client_answered");
      const BY_FIELD: Record<string, Record<string, unknown>> = {
        tax_registration_status: { quickReply: { value: "not_started", intent: "answer" } },
        tax_fiscal_year_end: { text: "2026-12-31" },
        tax_accounting_framework: { quickReply: { value: "ifrs", intent: "answer" } },
        tax_parent_reporting_required: { quickReply: { value: "true", intent: "answer" } },
        tax_parent_reporting_framework: { quickReply: { value: "ifrs", intent: "answer" } },
        tax_transfer_pricing_documentation_status: { quickReply: { value: "not_started", intent: "answer" } },
        tax_advisory_questions: { text: "Cómo estructurar el financiamiento desde Portugal y qué documentar entre empresas del grupo." },
      };
      let cat: any = (await api.get(`/categories/${taxId}`)).body;
      const catAsked: string[] = [];
      for (let i = 0; i < 20 && !cat.progress.ready; i++) {
        const field = (await h.db.query<{ structured: any }>("SELECT structured FROM precision_turn WHERE project_id = $1 AND role = 'assistant' AND scope_instance_id = $2 ORDER BY seq DESC LIMIT 1", [projectId, taxId])).rows[0]?.structured?.state?.fieldKey as string | undefined;
        catAsked.push(String(field));
        cat = await turn(api, "category:tax", `/categories/${taxId}/turns`, { text: "", ...((field && BY_FIELD[field]) ?? { text: "Todavía no lo sé." }) });
        cat = { ...cat, progress: cat.progress };
      }
      say({ id: "category_inheritance", quality: "Category inheritance (the category deepens, it does not restart)", kind: "INVARIANT", pass: inheritedFacts && !catAsked.some((f) => ["tax_has_intercompany_transactions", "tax_services_in_scope"].includes(f)), evidence: `inherited with client provenance: ${inheritedFacts}; asked: ${catAsked.join(", ")}` });
      say({ id: "material_depth", quality: "Material depth before 'ready' (transfer pricing, agreements)", kind: "INVARIANT", pass: cat.progress.ready === true && catAsked.includes("tax_transfer_pricing_documentation_status"), evidence: `ready: ${cat.progress.ready}; transfer-pricing status explored: ${catAsked.includes("tax_transfer_pricing_documentation_status")}` });

      expect((await api.post(`/categories/${taxId}/crp/confirm`, {})).status).toBe(200);
      const preview = (await api.get(`/categories/${taxId}/preview`)).body;
      const previewMatch = /new:|_generic|fa4_|n:disc|fr:|¿|\bundefined\b|\[object/.exec(JSON.stringify(preview.blocks));
      const previewClean = previewMatch === null;
      expect(preview.canSend).toBe(true);
      const sent = await api.post(`/categories/${taxId}/send`, { previewChecksum: preview.previewChecksum });
      expect(sent.status).toBe(200);
      const received = h.runtime.deps.integrations.operationHub as unknown as { receivedPayloads(p: string): any[] };
      const payloads = received.receivedPayloads(projectId);
      const crp = payloads.find((p) => p.contract.kind === "crp") ?? payloads.find((p) => p.contract.kind === "first_send") ?? payloads[0];
      const psm = crp.project_context.psm;
      const residue = /n:disc|"fr:|new:|_generic|fa4_|¿/.test(JSON.stringify(crp));
      const terms = internalTermsIn(h.seen);
      say({ id: "preview_cleanliness", quality: "Preview and Operation Hub payload are clean (no internal terms, ids or conversational residue)", kind: "INVARIANT", pass: previewClean && !residue && terms.length === 0, evidence: `preview clean: ${previewClean}${previewMatch ? ` (found ${previewMatch[0]} near: ${JSON.stringify(preview.blocks).slice(Math.max(0, previewMatch.index - 60), previewMatch.index + 60)})` : ''}; payload residue: ${residue}; internal terms in customer responses: ${terms.length}` });

      const factText = psm.understanding.facts.map((f: any) => `${f.label}: ${f.value}`).join(" | ");
      const depth = [/60 personas/, /3 millones/, /150 facturas/].map((re) => re.test(factText));
      const findings = psm.understanding.findings.length;
      const items = psm.categories.flatMap((c: any) => c.items).length;
      say({ id: "portuguese_depth", quality: "Portuguese depth reaches the specialist (facts, findings, categories)", kind: "INVARIANT", pass: depth.every(Boolean) && findings >= 3 && items > 5, evidence: `facts ${depth.filter(Boolean).length}/3; findings ${findings}; items ${items}; categories ${psm.categories.length}` });

      // ---- correction handling (a separate Portuguese project: the client corrects a number they gave)
      const c2 = await deliverDiscovery(h.db, portugueseEnergyAnswers());
      await activateSimulatedEntitlement(h.db, c2.projectId);
      const api2 = h.api(await h.session(c2.projectId), "es");
      await api2.get("/understanding");
      let r2: any = await turn(api2, "understanding:correction", "/understanding/turns", { text: NARRATIVE });
      for (let i = 0; i < 30; i++) {
        const a = await pendingAction(c2.projectId);
        if (a?.kind === "ask_probe" && a.probeKey === "workforce.split") break; // the headcount was just given; the client now corrects it
        r2 = await turn(api2, "understanding:correction", "/understanding/turns", bodyFor(a, lastAssistant(r2)));
      }
      r2 = await turn(api2, "understanding:correction", "/understanding/turns", { text: "Perdón, me equivoqué: en realidad son 80 personas en total, no 60." });
      const f2 = (await createPgFrameStore(h.db).load(c2.projectId))!.frame;
      const hc: any = f2.items["workforce.headcount"];
      say({ id: "correction_handling", quality: "A correction replaces the value, keeps its history and is not argued with", kind: "QUALITY", pass: Boolean(hc) && /80/.test(String(hc.display)) && hc.provenance === "client_corrected", evidence: `headcount now "${hc?.display}" [${hc?.provenance}]` });

      // ---- latency and verdict
      const sorted = [...latencies].sort((a, b) => a - b);
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
      const failedInvariants = verdicts.filter((v) => v.kind === "INVARIANT" && !v.pass);
      const failedQuality = verdicts.filter((v) => v.kind === "QUALITY" && !v.pass);
      const report = {
        mode: MODE, project_id: projectId, discovery_result_id: delivered.resultId, turns: latencies.length, latency_ms: { p50: sorted[Math.floor(sorted.length / 2)] ?? 0, p95, max: sorted[sorted.length - 1] ?? 0 },
        verdicts, invariants_failed: failedInvariants.map((v) => v.id), quality_failed: failedQuality.map((v) => v.id),
        overall: failedInvariants.length > 0 ? "FAIL (a Product invariant broke)" : failedQuality.length > 0 ? (MODE === "scripted" ? "FAIL (the deterministic floor regressed)" : "REVIEW (quality items need the human read)") : "PASS",
      };
      mkdirSync(OUT, { recursive: true });
      writeFileSync(path.join(OUT, "rehearsal-pt.json"), JSON.stringify({ ...report, transcript }, null, 2));
      const md = [
        `# Real-model rehearsal — Portuguese reference company (${MODE})`, "", `Overall: **${report.overall}** · turns ${report.turns} · latency p50 ${report.latency_ms.p50} ms, p95 ${report.latency_ms.p95} ms`, "",
        "| # | Quality | Kind | Verdict | Evidence |", "|---|---|---|---|---|",
        ...verdicts.map((v, i) => `| ${i + 1} | ${v.quality} | ${v.kind} | ${v.pass ? "PASS" : "FAIL"} | ${v.evidence.replace(/\|/g, "/")} |`), "",
        "## Transcript (synthetic data)", "", ...transcript.map((l) => `- **${l.who}** _(${l.surface})_: ${l.text.replace(/\n/g, " ")}`),
      ].join("\n");
      writeFileSync(path.join(OUT, "rehearsal-pt.md"), md);

      expect(failedInvariants.map((v) => `${v.id}: ${v.evidence}`)).toEqual([]);
      if (MODE === "scripted") expect(failedQuality.map((v) => `${v.id}: ${v.evidence}`)).toEqual([]);
    } finally {
      if (pub.status === "ingested") {
        for (const t of ["knowledge_passage", "knowledge_document"]) await h.db.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
        try {
          await h.db.query("DELETE FROM knowledge_passage WHERE document_id = $1", [pub.document.id]);
          await h.db.query("DELETE FROM knowledge_document WHERE id = $1", [pub.document.id]);
        } finally { for (const t of ["knowledge_passage", "knowledge_document"]) await h.db.query(`ALTER TABLE ${t} ENABLE TRIGGER USER`); }
      }
    }
  }, 900000);
});
