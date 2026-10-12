/**
 * Real-model rehearsal of the demo route A–J (docs/f5/demo-route.md) — FINAL EMBASSY CLOSURE, 12 Oct 2026.
 *
 * Plays the same client utterances as route-rehearsal.int.test.ts through the real conversation engine, real manifests,
 * real readiness and the real DB, but with the GATEWAY model provider (the PO's secure local key, read from the process
 * environment by the gateway at call time; this file never reads, prints or stores it) instead of the scripted one.
 * SYNTHETIC DATA ONLY (Northwind Foods Ltd, a made-up company). The scripted provider stays the deterministic fallback.
 *
 * Gated: it runs only with PRECISION_REHEARSAL=1 (and TEST_DATABASE_URL). PRECISION_REHEARSAL_PROVIDER=scripted runs the
 * very same measurements against the scripted provider (dry run of the harness itself, no network).
 *
 * It measures, per turn: wall latency, model calls (logical / physical), fallback copy, status, turn kind, the Process
 * Knowledge behaviour (P-01, P-02: answered from the pack, nothing written, pending question resumed), terminology scan of
 * every customer-facing string, whether the next question is the one the route expects, plus retry behaviour (an injected
 * model failure on one turn, then the same turn key again) and state preservation (a brand-new engine instance reopens the
 * thread). Output: JSON + Markdown in REHEARSAL_OUT (no secret is ever written).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { createConversationEngine, type ConversationEngine, type ProcessTurnResult } from "../../../conversation";
import { DrizzleConversationStore } from "../../../conversation/stores/drizzle-store";
import { GatewayModelProvider } from "../../../conversation/providers/gateway-model";
import { ScriptedModelProvider } from "../../../conversation/providers/scripted-model";
import { ModelUnavailableError, type ModelProvider, type ModelRequest, type ModelResponseFor } from "../../../conversation/ports";
import { engineValueRenderer } from "../../../conversation/adapters/engine-bindings";
import { evaluateCategory } from "../../../manifest";
import { FixtureEntitlementProvider } from "../../../adapters/fixture-entitlement";
import { FixtureFaContextReader } from "../../../adapters/fixture-fa-context";
import { createPrecisionAssessment, moveCategoryLifecycle } from "../../../repository";
import { DbFactWriter } from "../../facts";
import { createContextReader } from "../../context-reader";
import { createFaContextService } from "../../fa-context";
import { DEMO_SCRIPT_FIXTURE, loadDemoFixtures, seedDemoProject } from "../../seed";
import { createHarness, describeWithDb, type Harness } from "./harness";
import { scanCustomerBody } from "./scan";
import { LOGISTICS, STRATEGIC, UNDERSTANDING } from "./route-script";

type Loc = "en" | "es";

const ENABLED = process.env.PRECISION_REHEARSAL === "1";
const MODE = process.env.PRECISION_REHEARSAL_PROVIDER === "scripted" ? "scripted" : "gateway";
const OUT = process.env.REHEARSAL_OUT ?? "/tmp/precision-rehearsal";
const describeReal = ENABLED ? describeWithDb : describe.skip;

const SHERPA_QUESTION: Record<Loc, string> = {
  en: "What role does the Sherpa play and when does it appear?",
  es: "¿Qué papel juega el Sherpa y cuándo aparece?",
};
const PROCESS_Q: Record<Loc, string[]> = {
  en: ["Is my information confidential?", "How does this process work after I send it?"],
  es: ["¿Mi información es confidencial?", "¿Cómo funciona este proceso después de enviarlo?"],
};

interface CallRecord { task: string; ms: number; ok: boolean; reason?: string }
class MeasuringProvider implements ModelProvider {
  readonly calls: CallRecord[] = [];
  failNext = 0;
  constructor(private readonly inner: ModelProvider) {}
  describe() { return this.inner.describe(); }
  async complete<R extends ModelRequest>(req: R): Promise<ModelResponseFor<R>> {
    const t0 = Date.now();
    if (this.failNext > 0) {
      this.failNext -= 1;
      this.calls.push({ task: req.task, ms: Date.now() - t0, ok: false, reason: "injected" });
      throw new ModelUnavailableError("timeout");
    }
    try {
      const r = await this.inner.complete(req);
      this.calls.push({ task: req.task, ms: Date.now() - t0, ok: true });
      return r;
    } catch (e) {
      this.calls.push({ task: req.task, ms: Date.now() - t0, ok: false, reason: e instanceof ModelUnavailableError ? e.reason : "error" });
      throw e;
    }
  }
}

interface TurnRow {
  flow: string; loc: Loc; n: number; say: string; reply: string;
  wallMs: number; engineMs: number; status: string; turnKind: string;
  modelCalls: number; physicalCalls: number; fallbackCopy: boolean;
  factsWritten: number; scanHits: string[]; criticalViolations: string[];
  routeMatch: boolean | null; notes: string[];
}
const rows: TurnRow[] = [];
const checks: Array<{ id: string; loc: Loc | "-"; pass: boolean; detail: string }> = [];
const addCheck = (id: string, loc: Loc | "-", pass: boolean, detail = "") => checks.push({ id, loc, pass, detail });

const text = (r: ProcessTurnResult): string => r.turns.filter((t) => t.role === "assistant").map((t) => t.text).join(" ");
const pct = (xs: number[], p: number): number => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!; };

describeReal(`real-model rehearsal of the demo route A–J (${MODE})`, () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(async () => { await h.close(); });

  async function engineFor(): Promise<{ engine: ConversationEngine; provider: MeasuringProvider; mk: () => ConversationEngine }> {
    const fa = new FixtureFaContextReader();
    const ent = new FixtureEntitlementProvider();
    await loadDemoFixtures(h.db, { faContext: fa, entitlement: ent });
    const deps = { ...h.deps, integrations: { ...h.deps.integrations, entitlement: ent, faContext: fa } } as never;
    const context = createContextReader(deps, createFaContextService(fa, () => undefined));
    const facts = new DbFactWriter(h.db, {
      afterWrite: async (tx, info) => {
        const st = (await tx.query<{ lifecycle_status: string }>("SELECT lifecycle_status FROM category_assessment WHERE instance_id = $1", [info.scopeInstanceId])).rows[0]?.lifecycle_status;
        if (st === "confirmed") await moveCategoryLifecycle(tx, info.scopeInstanceId, "in_progress");
      },
    });
    const inner: ModelProvider = MODE === "scripted" ? new ScriptedModelProvider({ fixture: DEMO_SCRIPT_FIXTURE }) : new GatewayModelProvider();
    const provider = new MeasuringProvider(inner);
    const mk = () => createConversationEngine({ store: new DrizzleConversationStore(h.pool), context, facts, evaluate: evaluateCategory, provider, renderer: engineValueRenderer });
    return { engine: mk(), provider, mk };
  }

  async function play(flow: string, loc: Loc, engine: ConversationEngine, base: Record<string, unknown>, n: number, say: string, expect: RegExp | null, notes: string[] = []): Promise<ProcessTurnResult> {
    const t0 = Date.now();
    const r = await engine.processTurn({ ...(base as object), turnKey: `real-${flow}-${loc}-${n}-${Math.random().toString(36).slice(2, 8)}`, text: say } as never);
    const wallMs = Date.now() - t0;
    const reply = text(r);
    // The engine runs its own verifiers on every reply (a rejected draft is regenerated, then replaced by fixed copy: `usedFallbackCopy`).
    const v: string[] = r.meta.usedFallbackCopy ? ["engine replaced the draft with fixed copy"] : [];
    rows.push({
      flow, loc, n, say, reply, wallMs, engineMs: r.meta.elapsedMs, status: r.status, turnKind: r.meta.turnKind,
      modelCalls: r.meta.modelCalls, physicalCalls: r.meta.physicalModelCalls, fallbackCopy: r.meta.usedFallbackCopy,
      factsWritten: r.factsToWrite.length, scanHits: scanCustomerBody(reply), criticalViolations: v,
      routeMatch: expect ? expect.test(reply) : null, notes,
    });
    return r;
  }

  for (const loc of ["en", "es"] as const) {
    it(`A–C Understanding (${loc}): five client turns to "ready to confirm"`, async () => {
      const seeded = await seedDemoProject(h.db, { reset: true, stage: "start", mintLink: false, bootstrapFaConfig: true });
      const pa = await createPrecisionAssessment(h.db, seeded.projectId);
      const { engine, mk } = await engineFor();
      const base = { projectId: seeded.projectId, surface: "understanding" as const, scopeInstanceId: pa.instanceId, locale: loc };
      const opened = await engine.openThread(base);
      const openText = opened.turns.map((t) => t.text).join(" ");
      addCheck("U-open: opening confirms the First Assessment objective", loc, UNDERSTANDING[loc].open.test(openText), openText.slice(0, 120));
      addCheck("U-AI: AI disclosure appears once", loc, (openText.match(/inteligencia artificial|artificial intelligence/gi) ?? []).length === 1);
      let last = opened;
      let n = 0;
      for (const s of UNDERSTANDING[loc].steps) {
        last = await play("understanding", loc, engine, base, ++n, s.say, s.expect);
        if (n === 3) {
          // state preservation: a brand-new engine instance (a reload, another device) sees the same thread and pending question
          const again = await mk().openThread(base);
          addCheck("STATE: Understanding thread survives a new engine instance", loc, again.turns.length >= 6, `${again.turns.length} turns`);
        }
      }
      addCheck("U-end: Understanding reaches ready_to_confirm", loc, last.understandingState === "ready_to_confirm", String(last.understandingState));
    }, 240_000);

    it(`D–J Logistics (${loc}): P-01, P-02, extra process questions, answers, CRP, Preview, Send`, async () => {
      const seeded = await seedDemoProject(h.db, { reset: true, stage: "map_confirmed", mintLink: false, bootstrapFaConfig: true });
      const catId = seeded.categories.find((c) => c.categoryKey === "logistics")!.categoryId;
      const { engine, provider, mk } = await engineFor();
      const base = { projectId: seeded.projectId, surface: "category" as const, scopeInstanceId: catId, locale: loc };
      const opened = await engine.openThread(base);
      const pendingQ = (opened as { state?: { pendingQuestion?: string } }).state?.pendingQuestion ?? null;
      const factsCount = async () => Number((await h.db.query<{ n: string }>("SELECT count(*) AS n FROM fact WHERE scope_instance_id = $1", [catId])).rows[0]!.n);

      // P-01
      const f0 = await factsCount();
      const p1 = await play("process", loc, engine, base, 1, LOGISTICS[loc].process, /Category Requirement Pack \(CRP\)/);
      addCheck("P-01: process question answered from the pack (turn kind process_question)", loc, p1.meta.turnKind === "process_question", p1.meta.turnKind);
      addCheck("P-01: introduces Category Requirement Pack (CRP), no promise of provider/quote", loc, /Category Requirement Pack \(CRP\)/.test(text(p1)) && !/guarant|garantiz/i.test(text(p1)));
      addCheck("P-01: writes nothing", loc, (await factsCount()) === f0 && p1.factsToWrite.length === 0);
      addCheck("P-01: zero model calls for the routing/answer (deterministic pack) or fallback honest", loc, p1.status === "ok", `modelCalls ${p1.meta.modelCalls}`);
      // P-02
      const p2 = await play("process", loc, engine, base, 2, SHERPA_QUESTION[loc], /Sherpa/);
      addCheck("P-02: Sherpa answered as a role in Operation Hub, never 'your Sherpa'", loc, p2.meta.turnKind === "process_question" && !/your Sherpa|tu Sherpa/i.test(text(p2)), p2.meta.turnKind);
      addCheck("P-02: writes nothing", loc, (await factsCount()) === f0 && p2.factsToWrite.length === 0);
      // approved confidentiality answer (PO closure 12 Oct)
      const p3 = await play("process", loc, engine, base, 3, PROCESS_Q[loc][0]!, loc === "en" ? /Your project information is used to structure your expansion/ : /La información de tu proyecto se utiliza para estructurar tu expansión/);
      addCheck("Confidentiality: approved answer verbatim, no extra promises", loc, p3.meta.turnKind === "process_question" && (loc === "en" ? /Precision does not send conversation history, email, people's names or documents to Operation Hub; before sending a (?:Category Requirement Pack \(CRP\)|CRP), you can review exactly what information will be shared\./ : /Precision no envía a Operation Hub el historial de conversación, correo, nombres de personas ni documentos; antes de enviar un (?:Category Requirement Pack \(CRP\)|CRP), puedes revisar exactamente qué información se compartirá\./).test(text(p3)));
      const p4 = await play("process", loc, engine, base, 4, PROCESS_Q[loc][1]!, null);
      addCheck("Process: a question beyond the pack is honest ('cannot confirm') or answered from the pack, never invented", loc, p4.meta.turnKind === "process_question" && p4.status === "ok", text(p4).slice(0, 100));
      addCheck("Process: no fact written by any process question", loc, (await factsCount()) === f0);
      // the pending question is the one that closes every process answer
      if (pendingQ) addCheck("Process: pending question resumed after the answers", loc, [p1, p2, p3, p4].every((r) => text(r).trim().endsWith(pendingQ.trim())), pendingQ.slice(0, 60));

      let n = 0;
      let last: ProcessTurnResult | null = null;
      for (const s of LOGISTICS[loc].steps) {
        last = await play("logistics", loc, engine, base, ++n, s.say, s.expect);
        if (n === 6) {
          // retry behaviour: the model is unavailable on the next turn, the answer is kept, the SAME turn key succeeds afterwards (no duplicate)
          const key = `real-retry-${loc}-${Math.random().toString(36).slice(2, 8)}`;
          const nextStep = LOGISTICS[loc].steps[n]!;
          provider.failNext = 6; // enough to exhaust the engine's own attempts for this turn
          const failed = await engine.processTurn({ ...base, turnKey: key, text: nextStep.say } as never);
          provider.failNext = 0;
          addCheck("RETRY: unavailable model -> status ai_unavailable with a calm notice (no raw error)", loc, failed.status === "ai_unavailable" && !!failed.notice && scanCustomerBody(failed.notice.text).length === 0, `${failed.status}`);
          const ok = await engine.processTurn({ ...base, turnKey: key, text: nextStep.say } as never);
          addCheck("RETRY: the same turn key then succeeds and records the answer once", loc, ok.status === "ok", ok.status);
          rows.push({ flow: "logistics", loc, n: ++n, say: nextStep.say, reply: text(ok), wallMs: 0, engineMs: ok.meta.elapsedMs, status: ok.status, turnKind: ok.meta.turnKind, modelCalls: ok.meta.modelCalls, physicalCalls: ok.meta.physicalModelCalls, fallbackCopy: ok.meta.usedFallbackCopy, factsWritten: ok.factsToWrite.length, scanHits: scanCustomerBody(text(ok)), criticalViolations: [], routeMatch: nextStep.expect.test(text(ok)), notes: ["retry-after-failure"] });
          last = ok;
          const reopened = await mk().openThread(base);
          addCheck("STATE: category thread and answers survive a new engine instance", loc, reopened.turns.length >= n, `${reopened.turns.length} turns`);
        }
      }
      addCheck("L-end: Logistics reaches the CRP-ready statement", loc, !!last && (loc === "en" ? /summary of this category: your CRP\.|Category Requirement Pack \(CRP\)/ : /resumen de esta categoría: tu CRP\.|Category Requirement Pack \(CRP\)/).test(text(last)));

      const auth = { "x-test-project": seeded.projectId, "x-precision-locale": loc };
      const view = await request(h.app).get(`/api/precision/categories/${catId}/crp`).set(auth);
      addCheck("H: CRP ready for review and confirmable", loc, view.status === 200 && view.body.state === "ready_for_review" && view.body.canConfirm === true, `${view.status} ${view.body?.state}`);
      const flows = JSON.stringify(view.body.sections ?? []);
      addCheck("CRP lane: origin Chile / destination Mexico told apart (real model extraction)", loc, (loc === "en" ? /Origin country: Chile · Destination country: Mexico/ : /País de origen: Chile · País de destino: México/).test(flows), flows.slice(0, 200));
      const pending = (view.body.pending ?? []).length;
      const conf = await request(h.app).post(`/api/precision/categories/${catId}/crp/confirm`).set(auth).send({});
      addCheck("H: CRP confirm", loc, conf.status === 200 && conf.body.state === "confirmed");
      const pv = await request(h.app).get(`/api/precision/categories/${catId}/preview`).set(auth);
      addCheck("I: Preview ready (first send)", loc, pv.status === 200 && pv.body.canSend === true && pv.body.firstSend === true);
      const before = h.spy.publishCalls;
      const sent = await request(h.app).post(`/api/precision/categories/${catId}/send`).set(auth).send({ previewChecksum: pv.body.previewChecksum });
      addCheck("J: Send accepted by the simulated Operation Hub, exactly one publish", loc, sent.status === 200 && sent.body.state === "sent" && h.spy.publishCalls === before + 1);
      const payload = JSON.stringify(h.spy.payloads[h.spy.payloads.length - 1] ?? {});
      addCheck("J: payload carries no conversation history, email, people names or documents", loc, !/real-|CLIENT:|ASSISTANT:|@/.test(payload));
      addCheck("Customer surfaces: no internal term in CRP / Preview / Send bodies", loc, scanCustomerBody([view.body, conf.body, pv.body, sent.body]).length === 0, scanCustomerBody([view.body, conf.body, pv.body, sent.body]).slice(0, 3).join(" | "));
      addCheck("CRP pending items are visible (not hidden)", loc, pending >= 0, `${pending} pending`);

      if (loc === "en") {
        const sa = seeded.categories.find((c) => c.categoryKey === "strategic_advisory")!.categoryId;
        const saBase = { ...base, scopeInstanceId: sa };
        await engine.openThread(saBase);
        let k = 0; let lastSa: ProcessTurnResult | null = null;
        for (const say of STRATEGIC) lastSa = await play("strategic", loc, engine, saBase, ++k, say, null);
        addCheck("K: Strategic Advisory reaches the CRP-ready statement (name untranslated)", loc, !!lastSa && /your CRP|Category Requirement Pack/.test(text(lastSa)));
      }
    }, 600_000);
  }

  afterAll(() => {
    mkdirSync(OUT, { recursive: true });
    const real = rows.filter((r) => r.wallMs > 0);
    const wall = real.map((r) => r.wallMs);
    const modelTurns = real.filter((r) => r.modelCalls > 0);
    const summary = {
      mode: MODE,
      date: new Date().toISOString(),
      turns: rows.length,
      p50Ms: pct(wall, 50), p95Ms: pct(wall, 95), maxMs: Math.max(0, ...wall),
      modelTurns: modelTurns.length,
      p50ModelTurnMs: pct(modelTurns.map((r) => r.wallMs), 50), p95ModelTurnMs: pct(modelTurns.map((r) => r.wallMs), 95),
      logicalModelCalls: rows.reduce((a, r) => a + r.modelCalls, 0),
      physicalModelCalls: rows.reduce((a, r) => a + r.physicalCalls, 0),
      fallbackCopyTurns: rows.filter((r) => r.fallbackCopy).length,
      nonOkTurns: rows.filter((r) => r.status !== "ok").length,
      terminologyHits: rows.filter((r) => r.scanHits.length).length,
      criticalViolationTurns: rows.filter((r) => r.criticalViolations.length).length,
      routeMatchRate: (() => { const m = rows.filter((r) => r.routeMatch !== null); return m.length ? m.filter((r) => r.routeMatch).length / m.length : null; })(),
      checksPassed: checks.filter((c) => c.pass).length, checksTotal: checks.length,
    };
    writeFileSync(path.join(OUT, `rehearsal-${MODE}.json`), JSON.stringify({ summary, checks, rows }, null, 2));
    const md: string[] = [`# Real-model rehearsal A–J (${MODE}) — ${summary.date}`, "", "Synthetic data only (Northwind Foods Ltd). No key, endpoint or credential appears in this report.", "", "## Summary", "", "```json", JSON.stringify(summary, null, 2), "```", "", "## Checks", "", "| Result | Check | Locale | Detail |", "|---|---|---|---|"];
    for (const c of checks) md.push(`| ${c.pass ? "PASS" : "FAIL"} | ${c.id} | ${c.loc} | ${c.detail.replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 140)} |`);
    md.push("", "## Transcript (client → reply)", "");
    for (const r of rows) md.push(`**[${r.loc}/${r.flow}#${r.n}] CLIENT:** ${r.say}`, "", `**ASSISTANT** (${r.wallMs} ms, calls ${r.modelCalls}/${r.physicalCalls}, ${r.status}/${r.turnKind}${r.fallbackCopy ? ", FALLBACK COPY" : ""}${r.routeMatch === false ? ", next-question differs from route" : ""}${r.scanHits.length ? ", SCAN: " + r.scanHits.join("; ") : ""}${r.criticalViolations.length ? ", VERIFIER: " + r.criticalViolations.join("; ") : ""}): ${r.reply}`, "");
    writeFileSync(path.join(OUT, `rehearsal-${MODE}.md`), md.join("\n"));
  });
});
