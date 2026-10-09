/**
 * Reliability of the conversation surface through HTTP on PostgreSQL: idempotent turns, AI failure and retry, reload in the
 * middle of a turn, serialisation of parallel turns, an unavailable First Assessment context, analytics exactly once, and a
 * Spanish run through the whole journey scanned for internal terms.
 */
import { addNeed, completeUnderstanding, confirmMap, confirmedProject, internalTermsIn, key } from "./drive";
import { FA_CONTEXT, setupHarness, TEST_DATABASE_URL, type Harness } from "./harness";

const describeWithDb = TEST_DATABASE_URL ? describe : describe.skip;
const one = async (h: Harness, sql: string, params: unknown[]): Promise<number> => Number((await h.db.query<{ n: string }>(sql, params)).rows[0]!.n);

describeWithDb("Precision API — reliability", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);
  afterAll(async () => {
    expect(internalTermsIn(h.seen)).toEqual([]);
    await h.close();
  });

  const turnRows = (projectId: string, turnKey: string) =>
    h.db.query<{ role: string }>("SELECT role FROM precision_turn WHERE project_id = $1 AND turn_key = $2 ORDER BY seq", [projectId, turnKey]).then((r) => r.rows.map((x) => x.role));

  describe("idempotent turns", () => {
    it("the same turnKey twice (sequential and parallel) has one effect and returns the same turns", async () => {
      const { projectId } = await h.newProject({ context: null });
      const api = h.api(await h.session(projectId));
      await api.get("/understanding");
      const turnKey = key("same");
      const body = { turnKey, text: "Open a distribution hub for our products" };
      const first = await api.post("/understanding/turns", body);
      expect(first.status).toBe(200);
      const second = await api.post("/understanding/turns", body);
      expect(second.status).toBe(200);
      expect(second.body.turns.map((t: { id: string }) => t.id)).toEqual(first.body.turns.map((t: { id: string }) => t.id));
      expect(await turnRows(projectId, turnKey)).toEqual(["client", "assistant"]);
      const facts = await one(h, "SELECT count(*) AS n FROM fact WHERE project_id = $1", [projectId]);

      const parallelKey = key("par");
      const results = await Promise.all([1, 2, 3].map(() => api.post("/understanding/turns", { turnKey: parallelKey, text: "Mexico and Spain" })));
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(new Set(results.map((r) => JSON.stringify(r.body.turns.map((t: { id: string }) => t.id)))).size).toBe(1);
      expect(await turnRows(projectId, parallelKey)).toEqual(["client", "assistant"]);
      // each fact version exists once: replays never wrote again
      const versions = await h.db.query<{ field_key: string; n: string }>("SELECT field_key, count(*) AS n FROM fact WHERE project_id = $1 GROUP BY field_key", [projectId]);
      expect(Number(versions.rows.find((r) => r.field_key === "precision.pa_destination_countries")?.n ?? 1)).toBeLessThanOrEqual(2);
      expect(facts).toBeGreaterThan(0);
    });

    it("a malformed turnKey is rejected before anything is saved", async () => {
      const { projectId } = await h.newProject();
      const api = h.api(await h.session(projectId));
      for (const turnKey of ["short", "has spaces in it", "x".repeat(121), 12345, undefined]) {
        const r = await api.post("/understanding/turns", { turnKey, text: "hello there" });
        expect([r.status, r.body.error]).toEqual([400, "INVALID_INPUT"]);
      }
      expect(await one(h, "SELECT count(*) AS n FROM precision_turn WHERE project_id = $1 AND role = 'client'", [projectId])).toBe(0);
    });
  });

  describe("AI failure", () => {
    it("keeps the client's turn, reports it on reload, and the retry with the SAME key completes with no duplicate", async () => {
      const { projectId } = await h.newProject({ context: null });
      const api = h.api(await h.session(projectId));
      await api.get("/understanding");
      const turnKey = key("ai");
      h.provider.failNext(1, "timeout");
      const failed = await api.post("/understanding/turns", { turnKey, text: "We want to open a hub in Mexico" });
      expect(failed.status).toBe(200);
      expect(failed.body).toMatchObject({ status: "ai_unavailable", retryable: true, serviceMapChanged: false });
      expect(failed.body.turns.map((t: { role: string }) => t.role)).toEqual(["client"]);
      expect(JSON.stringify(failed.body)).not.toMatch(/timeout|exhausted|ModelUnavailable|scripted|provider/i);
      expect(await turnRows(projectId, turnKey)).toEqual(["client"]);
      expect(await one(h, "SELECT count(*) AS n FROM fact WHERE project_id = $1", [projectId])).toBe(0);

      // reload: the saved turn is still there and the client is told to retry it
      const reload = await api.get("/understanding");
      expect(reload.body.pendingTurn).toEqual({ turnKey, status: "ai_unavailable" });
      expect(reload.body.turns.filter((t: { role: string }) => t.role === "client")).toHaveLength(1);

      const retry = await api.post("/understanding/turns", { turnKey, text: "We want to open a hub in Mexico" });
      expect(retry.status).toBe(200);
      expect(retry.body.status).toBe("ok");
      expect(await turnRows(projectId, turnKey)).toEqual(["client", "assistant"]);
      expect((await api.get("/understanding")).body.pendingTurn).toBeNull();
    });

    it("also on a category conversation: no progress change, no lifecycle move, no event", async () => {
      const { projectId } = await h.newProject();
      const api = h.api(await h.session(projectId));
      const cards = await confirmedProject(api);
      const id = cards.Logistics.id as string;
      h.provider.failNext(1, "exhausted");
      const turnKey = key("catfail");
      const r = await api.post(`/categories/${id}/turns`, { turnKey, text: "We will run it as a hybrid" });
      expect(r.body).toMatchObject({ status: "ai_unavailable", retryable: true });
      expect(r.body.progress).toMatchObject({ status: "not_started", progressPct: 0 });
      expect((await h.db.query("SELECT lifecycle_status FROM category_assessment WHERE instance_id = $1", [id])).rows[0]).toEqual({ lifecycle_status: "confirmed" });
      expect(await one(h, "SELECT count(*) AS n FROM precision_journey_event WHERE project_id = $1 AND event_name = 'category_started'", [projectId])).toBe(0);
      expect((await api.get(`/categories/${id}`)).body.thread.pendingTurn).toEqual({ turnKey, status: "ai_unavailable" });
      const retry = await api.post(`/categories/${id}/turns`, { turnKey, text: "We will run it as a hybrid" });
      expect(retry.body.status).toBe("ok");
      expect(retry.body.progress.status).toBe("in_progress");
      expect(await one(h, "SELECT count(*) AS n FROM precision_journey_event WHERE project_id = $1 AND event_name = 'category_started'", [projectId])).toBe(1);
    });

    it("Add a Service: a failed turn is retried with the same key and the map changes once", async () => {
      const { projectId } = await h.newProject();
      const api = h.api(await h.session(projectId));
      await confirmedProject(api);
      const tag = key("addfail");
      h.provider.failNext(1);
      const failed = await api.post("/add-service/turns", { turnKey: `${tag}-1`, text: "We need customs brokerage for imports" });
      expect(failed.body.status).toBe("ai_unavailable");
      const ok = await addNeed(api, "We need customs brokerage for imports", tag);
      expect(ok.body.serviceMapChanged).toBe(true);
      expect(await one(h, "SELECT count(*) AS n FROM service_map_snapshot s JOIN precision_instance i ON i.id = s.precision_instance_id WHERE i.project_id = $1", [projectId])).toBe(2);
    });
  });

  describe("reload in the middle of processing", () => {
    it("a saved client turn without an answer reads back as processing; finishing it with the same key completes it", async () => {
      const { projectId } = await h.newProject({ context: null });
      const api = h.api(await h.session(projectId));
      const thread = (await api.get("/understanding")).body;
      const turnKey = key("mid");
      await h.runtime.domain.store.persistTurn({ projectId, scopeInstanceId: thread.scopeId, turnKey, role: "client", surface: "understanding", kind: "message", locale: "en", content: "We want to open a hub", structured: {} });
      const reload = (await api.get("/understanding")).body;
      expect(reload.pendingTurn).toEqual({ turnKey, status: "processing" });
      expect(reload.turns.at(-1)).toMatchObject({ role: "client", text: "We want to open a hub" });
      const done = await api.post("/understanding/turns", { turnKey, text: "We want to open a hub" });
      expect(done.body.status).toBe("ok");
      expect(await turnRows(projectId, turnKey)).toEqual(["client", "assistant"]);
      expect((await api.get("/understanding")).body.pendingTurn).toBeNull();
    });
  });

  describe("serialisation", () => {
    it("parallel turns of one project are processed one at a time: client/assistant pairs never interleave", async () => {
      const { projectId } = await h.newProject({ context: null });
      const api = h.api(await h.session(projectId));
      await api.get("/understanding");
      const texts = ["Open a distribution hub", "Mexico", "Packaged foods", "Harness Foods Mexico", "April 2027"];
      const results = await Promise.all(texts.map((text, i) => api.post("/understanding/turns", { turnKey: key(`race${i}`), text })));
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      const rows = (await h.db.query<{ role: string; turn_key: string }>("SELECT role, turn_key FROM precision_turn WHERE project_id = $1 AND kind <> 'disclosure' ORDER BY seq", [projectId])).rows;
      const body = rows.slice(1); // the opening question
      expect(body).toHaveLength(texts.length * 2);
      for (let i = 0; i < body.length; i += 2) {
        expect(body[i]!.role).toBe("client");
        expect(body[i + 1]!.role).toBe("assistant");
        expect(body[i + 1]!.turn_key).toBe(body[i]!.turn_key);
      }
      // one current version per fact: no lost update, no duplicate current row
      const dup = await h.db.query("SELECT field_key FROM fact WHERE project_id = $1 AND superseded_by IS NULL GROUP BY field_key HAVING count(*) > 1", [projectId]);
      expect(dup.rows).toEqual([]);
    });

    it("parallel confirmations of the map with different keys create one snapshot", async () => {
      const { projectId } = await h.newProject();
      const api = h.api(await h.session(projectId));
      await completeUnderstanding(api);
      const results = await Promise.all([1, 2, 3, 4].map(() => confirmMap(api)));
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      expect(await one(h, "SELECT count(*) AS n FROM service_map_snapshot s JOIN precision_instance i ON i.id = s.precision_instance_id WHERE i.project_id = $1", [projectId])).toBe(1);
      expect(await one(h, "SELECT count(*) AS n FROM precision_journey_event WHERE project_id = $1 AND event_name = 'my_service_map_confirmed'", [projectId])).toBe(1);
    });
  });

  describe("First Assessment context unavailable", () => {
    it("no delivered context: plain questions, a graceful Center, and the map simply cannot be confirmed yet", async () => {
      const { projectId } = await h.newProject({ context: null });
      const api = h.api(await h.session(projectId));
      const th = (await api.get("/understanding")).body;
      expect(th.turns.at(-1).confirmCard).toBeUndefined();
      expect(th.turns.at(-1).text).toMatch(/achieve/i);
      const done = await completeUnderstanding(api);
      expect(done.state).toBe("ready_to_confirm");
      const map = await api.get("/service-map");
      expect(map.status).toBe(200);
      expect(map.body).toMatchObject({ canConfirm: false });
      expect(map.body.live.groups).toEqual([]);
      const c = await confirmMap(api);
      expect([c.status, c.body.error]).toEqual([409, "NOT_READY"]);
      expect(await one(h, "SELECT count(*) AS n FROM context_pin WHERE project_id = $1", [projectId])).toBe(0);
    });

    it("a reader that throws never reaches the client as a technical error; the first Understanding opening waits for the context (no opening without the inherited values) and later requests are untouched", async () => {
      const { projectId } = await h.newProject();
      const api = h.api(await h.session(projectId));
      const original = h.fa.read.bind(h.fa);
      h.runtime.domain.fa.invalidate();
      h.fa.read = async () => { throw new Error("fa upstream: ECONNRESET 10.1.2.3"); };
      try {
        for (const path of ["/entry", "/center", "/help"]) {
          const r = await api.get(path);
          expect([path, r.status]).toEqual([path, 200]);
        }
        // The very first opening needs the inherited values: it is NOT created without them (that would make the confirmation cards unreachable).
        const first = await api.get("/understanding");
        expect(first.status).toBe(500);
        expect(first.body).toMatchObject({ error: "TEMPORARILY_UNAVAILABLE", retryable: true });
        expect(JSON.stringify(first.body)).not.toMatch(/ECONNRESET|10\.1\.2\.3|upstream/);
        expect(await one(h, "SELECT count(*) AS n FROM precision_turn WHERE project_id = $1", [projectId])).toBe(0);
        expect(JSON.stringify(h.seen.slice(-6))).not.toMatch(/ECONNRESET|10\.1\.2\.3|upstream/);
        expect(h.logs.join("\n")).not.toMatch(/10\.1\.2\.3.*Bearer/);
      } finally {
        h.fa.read = original;
      }
      // the context is back: the same project now opens WITH the inherited-value confirmation
      h.runtime.domain.fa.invalidate();
      expect((await api.get("/understanding")).body.turns.at(-1).confirmCard).toMatchObject({ kind: "inherited_value" });
    });
  });

  describe("analytics: each event exactly once", () => {
    it("replays, retries and re-reads never duplicate an event; every event has a unique key", async () => {
      const { projectId } = await h.newProject();
      const api = h.api(await h.session(projectId));
      await api.get("/entry");
      await api.get("/entry");
      const requestKey = key("ev");
      await completeUnderstanding(api);
      await confirmMap(api, requestKey);
      await confirmMap(api, requestKey);
      await api.get("/center");
      await api.get("/service-map");
      const cards = (await api.get("/center")).body.categories as Array<{ id: string; label: string }>;
      const id = cards.find((c) => c.label === "Logistics")!.id;
      const turnKey = key("evturn");
      const body = { turnKey, text: "", quickReply: { value: "self_managed", intent: "answer" } };
      await api.post(`/categories/${id}/turns`, body);
      await api.post(`/categories/${id}/turns`, body);
      await addNeed(api, "We need customs brokerage for imports", "evadd-1");
      // a rejected turn (nothing to confirm) emits nothing
      expect((await api.post("/add-service/turns", { turnKey: key("evrej"), text: "", confirm: { token: "cc_x", intent: "confirm" } })).status).toBe(400);

      const rows = (await h.db.query<{ event_name: string; event_key: string; properties: Record<string, unknown> }>("SELECT event_name, event_key, properties FROM precision_journey_event WHERE project_id = $1", [projectId])).rows;
      const byName: Record<string, number> = {};
      for (const r of rows) byName[r.event_name] = (byName[r.event_name] ?? 0) + 1;
      expect(byName).toMatchObject({ precision_started: 1, understanding_started: 1, my_service_map_ready: 1, my_service_map_confirmed: 1, category_started: 1, add_service_started: 1, add_service_completed: 1 });
      expect(new Set(rows.map((r) => r.event_key)).size).toBe(rows.length);
      // technical identifiers and counters only: no answers, names or free text
      const text = JSON.stringify(rows.map((r) => r.properties));
      expect(text).not.toMatch(/Harness|Mexico|hub|customs|brokerage|@/i);
      for (const r of rows) for (const v of Object.values(r.properties)) expect(["string", "number", "boolean"]).toContain(v === null ? "string" : typeof v);
    });

    it("an event is written in the same transaction as its state change (rollback leaves nothing)", async () => {
      const { emitEvent } = await import("../../domain/events");
      const { projectId } = await h.newProject();
      await expect(
        h.db.transaction(async (tx) => {
          await emitEvent(tx, { name: "category_started", eventKey: `tx-test:${projectId}`, projectId });
          throw new Error("state change failed");
        }),
      ).rejects.toThrow();
      expect(await one(h, "SELECT count(*) AS n FROM precision_journey_event WHERE project_id = $1", [projectId])).toBe(0);
    });
  });

  describe("the whole journey in Spanish", () => {
    it("never shows internal terms and keeps everything localized", async () => {
      const { projectId } = await h.newProject({ context: { ...FA_CONTEXT, locale: "es" } });
      const api = h.api(await h.session(projectId), "es");
      expect((await api.get("/entry")).body.locale).toBe("es");
      const u = await api.get("/understanding");
      expect(u.body.title).toBe("Tu proyecto");
      // answer in Spanish
      let state = u.body.understandingState as string;
      let turns = u.body.turns as Array<{ role: string; text: string; kind: string; confirmCard?: { token: string } }>;
      for (let i = 0; i < 12 && state !== "ready_to_confirm"; i++) {
        const last = [...turns].reverse().find((t) => t.role === "assistant" && t.kind !== "disclosure")!;
        const q = last.text.toLowerCase();
        const body = last.confirmCard ? { text: "", confirm: { token: last.confirmCard.token, intent: "confirm" } } : { text: q.includes("producto") ? "Alimentos empacados" : q.includes("empresa") ? "Harness Foods México S.A." : q.includes("empezar") ? "abril 2027" : q.includes("lograr") ? "Abrir un centro de distribución" : "México" };
        const r = await api.post("/understanding/turns", { turnKey: key("es"), ...body });
        expect(r.status).toBe(200);
        state = r.body.understandingState;
        if (r.body.turns.some((t: { role: string }) => t.role === "assistant")) turns = r.body.turns;
      }
      expect(state).toBe("ready_to_confirm");
      const c = await confirmMap(api);
      expect(c.status).toBe(200);
      const center = (await api.get("/center")).body;
      expect(center.categories.map((x: { label: string }) => x.label)).toEqual(["Impuestos, Contabilidad y Auditoría", "Logística"].map((l) => expect.stringMatching(new RegExp(l.slice(0, 8), "i"))));
      const cat = await api.get(`/categories/${center.categories[1].id}`);
      expect(cat.body.thread.turns.at(-1).text).toMatch(/[¿]|Trabajemos/);
      const sm = (await api.get("/service-map")).body;
      expect(sm.live.title).toBe("My Service Map");
      expect(sm.live.summary.destinations).toEqual([{ code: "MX", label: "México" }]);
      const added = await addNeed(api, "Necesitamos agente aduanal para importaciones");
      expect(added.body.turns.at(-1).text).toMatch(/Entendido/);
    });
  });
});
