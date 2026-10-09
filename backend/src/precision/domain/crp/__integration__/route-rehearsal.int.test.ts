/**
 * Rehearsal of the demo route (docs/f5/demo-route.md): plays the EXACT client utterances of the document through the real
 * conversation engine (scripted model provider, real manifests, real readiness), then the CRP surface over HTTP with the
 * simulated Operation Hub. It keeps the document honest: if a manifest, the scripted provider or the readiness rules
 * change so that the route no longer works, this test fails.
 *
 * Test glue only: the Understanding confirmation (My Service Map) belongs to DOMAIN-A, so the category threads start from the
 * seeded "map confirmed" stage; the lifecycle move to "in progress" on the first answer (done by A's hook in the app) is
 * reproduced by a tiny hook here.
 */
import { writeFileSync } from "node:fs";
import request from "supertest";
import { createConversationEngine, type ProcessTurnResult } from "../../../conversation";
import { DrizzleConversationStore } from "../../../conversation/stores/drizzle-store";
import { ScriptedModelProvider } from "../../../conversation/providers/scripted-model";
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

type Loc = "en" | "es";
interface Step { say: string; expect: RegExp }

/** The utterances of docs/f5/demo-route.md section D, with the question each one must receive next. */
export const UNDERSTANDING: Record<Loc, { open: RegExp; steps: Step[] }> = {
  en: {
    open: /I understand this: Start selling our packaged food products in Mexico/,
    steps: [
      { say: "Yes", expect: /I understand this: Mexico/ },
      { say: "Yes", expect: /What product or service do you want to bring to this market\?/ },
      { say: "We make dry packaged food products with a long shelf life, mainly snacks and cereals", expect: /Which company or entity will operate in the destination\?/ },
      { say: "We plan to set up a local company in Mexico", expect: /When would you like to start\?/ },
      { say: "April 2027", expect: /put together your My Service Map/ },
    ],
  },
  es: {
    open: /entiendo esto: Start selling our packaged food products in Mexico/,
    steps: [
      { say: "Sí", expect: /entiendo esto: México/ },
      { say: "Sí", expect: /¿Qué producto o servicio quieres llevar a este mercado\?/ },
      { say: "Fabricamos alimentos secos empacados de larga vida útil, sobre todo botanas y cereales", expect: /¿Qué empresa o entidad operará en el destino\?/ },
      { say: "Vamos a constituir una empresa local en México", expect: /¿Cuándo te gustaría empezar\?/ },
      { say: "Abril de 2027", expect: /My Service Map/ },
    ],
  },
};

export const LOGISTICS: Record<Loc, { process: string; steps: Step[] }> = {
  en: {
    process: "What is a CRP and what happens with this?",
    steps: [
      { say: "Third-party logistics provider", expect: /hazardous or regulated materials\?/ },
      { say: "No", expect: /Which logistics services do you need/ },
      { say: "Third-party logistics and Freight transportation", expect: /What main type of product/ },
      { say: "General cargo", expect: /Which country do the products leave from\?/ },
      { say: "Chile", expect: /Which country do they arrive in\?/ },
      { say: "Mexico", expect: /What product moves in this flow\?/ },
      { say: "Packaged dry food products", expect: /What volume do you move/ },
      { say: "20 pallets", expect: /How often is this shipment made\?/ },
      { say: "Monthly", expect: /Which mode of transport/ },
      { say: "Ocean", expect: /Do you need dedicated warehousing/ },
      { say: "No", expect: /status of your import or export licenses/ },
      { say: "Not sure yet", expect: /prepare the summary of this category: your CRP\./ },
    ],
  },
  es: {
    process: "¿Qué es un CRP y qué va a pasar con esto?",
    steps: [
      { say: "Proveedor logístico externo", expect: /materiales peligrosos o regulados\?/ },
      { say: "No", expect: /Qué servicios de logística necesitas/ },
      { say: "Logística con terceros y Transporte de carga", expect: /Qué tipo de producto vas a mover/ },
      { say: "Carga general", expect: /Desde qué país salen los productos/ },
      { say: "Chile", expect: /A qué país llegan/ },
      { say: "México", expect: /Qué producto se mueve en este flujo/ },
      { say: "Alimentos secos empacados", expect: /Qué volumen mueves/ },
      { say: "20 pallets", expect: /Con qué frecuencia se hace este envío/ },
      { say: "Mensual", expect: /Qué modo de transporte usarás/ },
      { say: "Marítimo", expect: /Necesitas almacenamiento dedicado/ },
      { say: "No", expect: /estado de tus licencias/ },
      { say: "Todavía no lo sé", expect: /resumen de esta categoría: tu CRP\./ },
    ],
  },
};

const SHERPA_QUESTION: Record<Loc, string> = {
  en: "What role does the Sherpa play and when does it appear?",
  es: "¿Qué papel juega el Sherpa y cuándo aparece?",
};

/** Strategic Advisory answers of the optional second category (section K of the document). */
export const STRATEGIC: string[] = [
  "Decide whether to commit to a local presence",
  "Does the plan make commercial sense at our expected volumes?",
  "Market",
  "Retail and food-service distribution for packaged dry goods",
  "Mexico",
  "A clear recommendation we can take to our board",
  "Whether to set up a local company this year",
  "Feasibility report",
];

const text = (r: ProcessTurnResult): string => r.turns.filter((t) => t.role === "assistant").map((t) => t.text).join(" ");

describeWithDb("demo route rehearsal (scripted model, simulated Operation Hub)", () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());

  async function engineFor(projectId: string, opts: { demoFixture?: boolean } = {}) {
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
    const provider = new ScriptedModelProvider(opts.demoFixture === false ? {} : { fixture: DEMO_SCRIPT_FIXTURE });
    const engine = createConversationEngine({ store: new DrizzleConversationStore(h.pool), context, facts, evaluate: evaluateCategory, provider, renderer: engineValueRenderer });
    return { engine, projectId, provider };
  }

  for (const loc of ["en", "es"] as const) {
    it(`C-D: Understanding utterances in ${loc} reach "ready to confirm" in 5 client turns`, async () => {
      const seeded = await seedDemoProject(h.db, { reset: true, stage: "start", mintLink: false, bootstrapFaConfig: true });
      const pa = await createPrecisionAssessment(h.db, seeded.projectId);
      const { engine } = await engineFor(seeded.projectId);
      const base = { projectId: seeded.projectId, surface: "understanding" as const, scopeInstanceId: pa.instanceId, locale: loc };
      const opened = await engine.openThread(base);
      expect(opened.turns.map((t) => t.text).join(" ")).toMatch(UNDERSTANDING[loc].open);
      let last = opened;
      let n = 0;
      for (const s of UNDERSTANDING[loc].steps) {
        last = await engine.processTurn({ ...base, turnKey: `rehearsal-u-${loc}-${++n}`, text: s.say });
        expect(last.status).toBe("ok");
        expect(text(last)).toMatch(s.expect);
        expect(scanCustomerBody(text(last))).toEqual([]);
      }
      expect(last.understandingState).toBe("ready_to_confirm");
    });
  }

  for (const loc of ["en", "es"] as const) {
    it(`E-J: Logistics in ${loc}: process question (P-01), answers, CRP, Preview, Send`, async () => {
      const seeded = await seedDemoProject(h.db, { reset: true, stage: "map_confirmed", mintLink: false, bootstrapFaConfig: true });
      const catId = seeded.categories.find((c) => c.categoryKey === "logistics")!.categoryId;
      const { engine, provider } = await engineFor(seeded.projectId);
      const base = { projectId: seeded.projectId, surface: "category" as const, scopeInstanceId: catId, locale: loc };
      const transcript: string[] = [];
      const opened = await engine.openThread(base);
      transcript.push(`ASSISTANT: ${text(opened)}`);

      // F: a process question is answered from the pack, writes nothing and resumes the pending question
      const factsBefore = Number((await h.db.query<{ n: string }>("SELECT count(*) AS n FROM fact WHERE scope_instance_id = $1", [catId])).rows[0]!.n);
      const proc = await engine.processTurn({ ...base, turnKey: `rehearsal-p1-${loc}`, text: LOGISTICS[loc].process });
      expect(proc.turns.some((t) => t.kind === "process_question")).toBe(true);
      expect(text(proc)).toMatch(/Category Requirement Pack \(CRP\)/);
      expect(Number((await h.db.query<{ n: string }>("SELECT count(*) AS n FROM fact WHERE scope_instance_id = $1", [catId])).rows[0]!.n)).toBe(factsBefore);
      const sherpa = await engine.processTurn({ ...base, turnKey: `rehearsal-p2-${loc}`, text: SHERPA_QUESTION[loc] });
      expect(sherpa.turns.some((t) => t.kind === "process_question")).toBe(true);
      expect(text(sherpa)).not.toMatch(/your Sherpa|tu Sherpa/i);
      transcript.push(`CLIENT: ${LOGISTICS[loc].process}`, `ASSISTANT: ${text(proc)}`, `CLIENT: ${SHERPA_QUESTION[loc]}`, `ASSISTANT: ${text(sherpa)}`);

      let n = 0;
      for (const s of LOGISTICS[loc].steps) {
        const r = await engine.processTurn({ ...base, turnKey: `rehearsal-l-${loc}-${++n}`, text: s.say });
        expect(r.status).toBe("ok");
        expect(text(r)).toMatch(s.expect);
        expect(scanCustomerBody(text(r))).toEqual([]);
        transcript.push(`CLIENT: ${s.say}`, `ASSISTANT: ${text(r)}`);
      }
      expect(provider.calls.length).toBeGreaterThan(0);

      // H: CRP over HTTP
      const auth = { "x-test-project": seeded.projectId, "x-precision-locale": loc };
      const view = await request(h.app).get(`/api/precision/categories/${catId}/crp`).set(auth);
      expect(view.status).toBe(200);
      expect(view.body).toMatchObject({ state: "ready_for_review", canConfirm: true });
      const published0 = h.spy.publishCalls;
      const conf = await request(h.app).post(`/api/precision/categories/${catId}/crp/confirm`).set(auth).send({});
      expect(conf.status).toBe(200);
      expect(conf.body.state).toBe("confirmed");
      expect(h.spy.publishCalls).toBe(published0);

      // I: Preview, J: Send
      const pv = await request(h.app).get(`/api/precision/categories/${catId}/preview`).set(auth);
      expect(pv.status).toBe(200);
      expect(pv.body).toMatchObject({ firstSend: true, canSend: true, sendState: "not_sent" });
      const before = h.spy.publishCalls;
      const sent = await request(h.app).post(`/api/precision/categories/${catId}/send`).set(auth).send({ previewChecksum: pv.body.previewChecksum });
      expect(sent.status).toBe(200);
      expect(sent.body.state).toBe("sent");
      expect(h.spy.publishCalls).toBe(before + 1);
      const after = await request(h.app).get(`/api/precision/categories/${catId}/preview`).set(auth);
      expect(scanCustomerBody([view.body, conf.body, pv.body, sent.body, after.body])).toEqual([]);

      // K (optional, English): a second category after the first send: no first-send gate, same Preview and Send
      if (loc === "en") {
        const sa = seeded.categories.find((c) => c.categoryKey === "strategic_advisory")!.categoryId;
        const saBase = { ...base, scopeInstanceId: sa };
        await engine.openThread(saBase);
        let k = 0;
        let lastText = "";
        for (const say of STRATEGIC) {
          const r = await engine.processTurn({ ...saBase, turnKey: `rehearsal-sa-${++k}`, text: say });
          expect(r.status).toBe("ok");
          lastText = text(r);
          expect(scanCustomerBody(lastText)).toEqual([]);
        }
        expect(lastText).toMatch(/summary of this category: your CRP\./);
        const saAuth = { "x-test-project": seeded.projectId };
        expect((await request(h.app).post(`/api/precision/categories/${sa}/crp/confirm`).set(saAuth).send({})).status).toBe(200);
        const pv2 = await request(h.app).get(`/api/precision/categories/${sa}/preview`).set(saAuth);
        expect(pv2.body).toMatchObject({ firstSend: false, canSend: true });
        const sent2 = await request(h.app).post(`/api/precision/categories/${sa}/send`).set(saAuth).send({ previewChecksum: pv2.body.previewChecksum });
        expect(sent2.body.state).toBe("sent");
      }

      if (process.env.ROUTE_DUMP) {
        writeFileSync(`${process.env.ROUTE_DUMP}.${loc}.json`, JSON.stringify({ transcript, view: view.body, confirmed: conf.body, preview: pv.body, sent: sent.body, after: after.body }, null, 2));
      }
    }, 60_000);
  }

  for (const loc of ["en", "es"] as const) {
    it(`L: without the demo fixture the default scripted provider tells the two ends of a lane apart (${loc})`, async () => {
      const seeded = await seedDemoProject(h.db, { reset: true, stage: "map_confirmed", mintLink: false, bootstrapFaConfig: true });
      const catId = seeded.categories.find((c) => c.categoryKey === "logistics")!.categoryId;
      const { engine } = await engineFor(seeded.projectId, { demoFixture: false });
      const base = { projectId: seeded.projectId, surface: "category" as const, scopeInstanceId: catId, locale: loc };
      await engine.openThread(base);
      let n = 0;
      for (const s of LOGISTICS[loc].steps) {
        const r = await engine.processTurn({ ...base, turnKey: `rehearsal-nofix-${loc}-${++n}`, text: s.say });
        expect(r.status).toBe("ok");
        // no process question was asked first, so the closing statement spells the pack out in full
        expect(text(r)).toMatch(n === LOGISTICS[loc].steps.length ? /\(CRP\)/ : s.expect);
      }
      const view = await request(h.app).get(`/api/precision/categories/${catId}/crp`).set({ "x-test-project": seeded.projectId, "x-precision-locale": loc });
      const flows = JSON.stringify(view.body.sections);
      expect(flows).toMatch(loc === "en" ? /Origin country: Chile · Destination country: Mexico/ : /País de origen: Chile · País de destino: México/);
      expect(flows).not.toMatch(/Chile · (?:Destination country|País de destino): Chile/);
    }, 60_000);
  }
});
