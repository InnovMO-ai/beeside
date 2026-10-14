/**
 * The client journey through HTTP on PostgreSQL: entry and cover, Understanding, My Service Map, categories, Add a Service,
 * the Center, Help and the Operation Hub block.
 */
import { randomUUID } from "node:crypto";
import { addNeed, completeUnderstanding, confirmedProject, confirmMap, internalTermsIn, key } from "./drive";
import { FA_CONTEXT, setupHarness, TEST_DATABASE_URL, type Harness } from "./harness";

const describeWithDb = TEST_DATABASE_URL ? describe : describe.skip;

const count = async (h: Harness, sql: string, params: unknown[]): Promise<number> => Number((await h.db.query<{ n: string }>(sql, params)).rows[0]!.n);
const events = async (h: Harness, projectId: string): Promise<Record<string, number>> =>
  Object.fromEntries((await h.db.query<{ event_name: string; n: string }>("SELECT event_name, count(*) AS n FROM precision_journey_event WHERE project_id = $1 GROUP BY 1", [projectId])).rows.map((r) => [r.event_name, Number(r.n)]));

describeWithDb("Precision API — client journey", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);
  afterAll(async () => {
    expect(internalTermsIn(h.seen)).toEqual([]);
    await h.close();
  });

  describe("entry and cover", () => {
    beforeAll(async () => {
      await h.db.query("UPDATE precision_cover_asset SET is_active = false WHERE country_code IN ('MX', '*', 'ES') AND is_active");
    });

    it("first visit shows the cover (neutral when nothing is approved), then the Center; Precision starts once", async () => {
      const { projectId } = await h.newProject();
      const api = h.api(await h.session(projectId));
      const first = await api.get("/entry");
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ screen: "cover", locale: "en", access: { mode: "FULL", readOnlyUntil: null }, cover: { composition: "neutral", image: null, destinations: [{ code: "MX", label: "Mexico" }] } });
      expect((await api.get("/entry")).body.screen).toBe("cover"); // still the first visit until it is marked seen
      expect((await api.post("/cover/seen")).status).toBe(200);
      expect((await api.post("/cover/seen")).status).toBe(200); // idempotent
      expect(await count(h, "SELECT count(*) AS n FROM precision_cover_seen WHERE project_id = $1", [projectId])).toBe(1);
      const back = await api.get("/entry");
      expect(back.body).toMatchObject({ screen: "center", cover: null });
      const ev = await events(h, projectId);
      expect(ev.precision_started).toBe(1);
      expect((await h.db.query<{ precision_state: string }>("SELECT precision_state FROM project WHERE project_id = $1", [projectId])).rows[0]!.precision_state).toBe("STARTED");
    });

    it("cover: destination photo > global photo > neutral; unapproved or unsafe assets are ignored", async () => {
      const { projectId } = await h.newProject();
      const api = h.api(await h.session(projectId));
      const asset = (code: string, ref: string, approved = true, active = true) =>
        h.db.query(
          `INSERT INTO precision_cover_asset (country_code, asset_ref, approved, is_active, focal_x, focal_y, alt_text) VALUES ($1, $2, $3, $4, 0.25, 0.75, $5::jsonb)
           ON CONFLICT (country_code) DO UPDATE SET asset_ref = $2, approved = $3, is_active = $4, focal_x = 0.25, focal_y = 0.75, alt_text = $5::jsonb`,
          [code, ref, approved, active, JSON.stringify({ en: "A port at dawn", es: "Un puerto al amanecer" })],
        );
      const clear = () => h.db.query("UPDATE precision_cover_asset SET is_active = false WHERE country_code IN ('MX', '*') AND is_active");
      try {
        await clear();
        await asset("MX", "https://cdn.example.test/mx.jpg", false); // not approved
        await asset("*", "javascript:alert(1)"); // unsafe reference
        expect((await api.get("/entry")).body.cover.composition).toBe("neutral");
        await asset("*", "https://cdn.example.test/global.jpg");
        const global = (await api.get("/entry")).body.cover;
        expect(global).toMatchObject({ composition: "global", image: { url: "https://cdn.example.test/global.jpg", altText: "A port at dawn", focal: { x: 0.25, y: 0.75 } } });
        await asset("MX", "/covers/mx.jpg");
        const photo = (await api.get("/entry")).body.cover;
        expect(photo).toMatchObject({ composition: "photo", image: { url: "/covers/mx.jpg" }, destinations: [{ code: "MX", label: "Mexico" }] });
        expect((await h.api(await h.session(projectId), "es").get("/entry")).body.cover.image.altText).toBe("Un puerto al amanecer");
      } finally {
        await clear();
      }
    });
  });

  describe("Understanding -> My Service Map -> categories", () => {
    let projectId: string;
    let api: ReturnType<Harness["api"]>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cards: Record<string, any>;
    beforeAll(async () => {
      ({ projectId } = await h.newProject());
      api = h.api(await h.session(projectId));
    });

    it("Understanding opens with the First Assessment values offered for confirmation (never written as confirmed)", async () => {
      const t = await api.get("/understanding");
      expect(t.status).toBe(200);
      expect(t.body).toMatchObject({ surface: "understanding", canWrite: true, aiDisclosureShown: true, progress: null, understandingState: "not_started", pendingTurn: null });
      const first = t.body.turns[t.body.turns.length - 1];
      expect(first.confirmCard).toMatchObject({ kind: "inherited_value", body: "Open a distribution hub for our packaged foods" });
      // offered, not recorded
      expect(await count(h, "SELECT count(*) AS n FROM fact WHERE project_id = $1 AND field_key <> 'precision.map_needs'", [projectId])).toBe(0);
      // the source pin exists and is the one the confirmed fact will carry
      expect(await count(h, "SELECT count(*) AS n FROM context_pin WHERE project_id = $1 AND status = 'current'", [projectId])).toBe(1);
      expect((await api.get("/understanding")).body.turns).toHaveLength(t.body.turns.length); // reading again adds nothing
    });

    it("the map is not ready before Understanding is; then it is, with no percentage anywhere in Understanding", async () => {
      const early = await api.get("/service-map");
      expect([early.status, early.body.error]).toEqual([409, "NOT_READY"]);
      const done = await completeUnderstanding(api);
      expect(done.state).toBe("ready_to_confirm");
      const th = (await api.get("/understanding")).body;
      expect(th.understandingState).toBe("ready_to_confirm");
      expect(th.progress).toBeNull();
      expect(JSON.stringify(th)).not.toMatch(/progressPct|\d+\s?%/);
      // FA values were written only after the client confirmed them, with their provenance
      const facts = (await h.db.query<{ field_key: string; provenance_stage: string; source_pin_id: string | null; source_item_ref: string | null }>(
        "SELECT field_key, provenance_stage, source_pin_id, source_item_ref FROM fact WHERE project_id = $1 AND superseded_by IS NULL ORDER BY field_key", [projectId])).rows;
      const objective = facts.find((f) => f.field_key === "precision.pa_project_objective")!;
      expect(objective).toMatchObject({ provenance_stage: "client_confirmed", source_item_ref: "project.expansionObjective" });
      expect(objective.source_pin_id).not.toBeNull();
      expect(facts.every((f) => /^precision\.[a-z_.]+$/.test(f.field_key))).toBe(true);
    });

    it("GET service-map: live projection from the facts, grouped, no ids or versions of the platform", async () => {
      const r = await api.get("/service-map");
      expect(r.status).toBe(200);
      const m = r.body;
      expect(m).toMatchObject({ canConfirm: true, canWrite: true, hasUnconfirmedChanges: false, confirmed: null });
      expect(m.live.title).toBe("My Service Map");
      expect(m.live.summary).toMatchObject({ objective: "Open a distribution hub for our packaged foods", destinations: [{ code: "MX", label: "Mexico" }], timeWindow: "April 2027" });
      expect(m.live.groups.map((g: { label: string }) => g.label)).toEqual(["Tax, Accounting and Audit", "Logistics"]);
      expect(m.live.groups.every((g: { categoryId: string | null }) => g.categoryId === null)).toBe(true); // no workstream before confirmation
      expect(m.live.groups[1].items.map((i: { label: string; priority: string }) => [i.label, i.priority])).toEqual([["Third-party logistics", "high"], ["Freight transportation", "medium"]]);
      expect(m.live.changesSinceConfirmed).toEqual([]);
    });

    it("confirming creates the snapshot, makes categories 'Not started' and does NOT activate Operation Hub", async () => {
      const key1 = key("confirm");
      const r = await confirmMap(api, key1);
      expect(r.status).toBe(200);
      expect(r.body.serviceMap).toMatchObject({ canConfirm: false, hasUnconfirmedChanges: false });
      expect(r.body.serviceMap.confirmed.groups.map((g: { label: string }) => g.label)).toEqual(["Tax, Accounting and Audit", "Logistics"]);
      expect(r.body.serviceMap.confirmed.confirmedAt).toBe(r.body.confirmedAt);
      expect(await count(h, "SELECT count(*) AS n FROM service_map_snapshot s JOIN precision_instance i ON i.id = s.precision_instance_id WHERE i.project_id = $1", [projectId])).toBe(1);
      expect(await count(h, "SELECT count(*) AS n FROM oh_delivery WHERE project_id = $1", [projectId])).toBe(0);
      // the same confirmation sent again: same answer, no second snapshot
      const again = await confirmMap(api, key1);
      expect(again.body.confirmedAt).toBe(r.body.confirmedAt);
      expect(await count(h, "SELECT count(*) AS n FROM service_map_snapshot s JOIN precision_instance i ON i.id = s.precision_instance_id WHERE i.project_id = $1", [projectId])).toBe(1);
      // a different key with nothing changed: nothing to confirm, still one snapshot
      expect((await confirmMap(api)).status).toBe(200);
      expect(await count(h, "SELECT count(*) AS n FROM service_map_snapshot s JOIN precision_instance i ON i.id = s.precision_instance_id WHERE i.project_id = $1", [projectId])).toBe(1);

      const center = (await api.get("/center")).body;
      expect(center.understanding.state).toBe("confirmed");
      expect(center.serviceMap).toMatchObject({ available: true, hasUnconfirmedChanges: false });
      expect(center.categories.map((c: { label: string; status: string; sendState: string }) => [c.label, c.status, c.sendState])).toEqual([["Tax, Accounting and Audit", "not_started", "not_sent"], ["Logistics", "not_started", "not_sent"]]);
      expect(center.addService.available).toBe(true);
      expect(center.operationHub).toEqual({ state: "hidden", url: null, contact: null });
      cards = Object.fromEntries(center.categories.map((c: { label: string }) => [c.label, c]));
      const ev = await events(h, projectId);
      expect(ev.my_service_map_ready).toBe(1);
      expect(ev.my_service_map_confirmed).toBe(1);
      expect(ev.understanding_started).toBe(1);
    });

    it("later changes to the project become a new map version only when the client confirms them", async () => {
      const pa = (await h.db.query<{ id: string }>("SELECT id FROM precision_instance WHERE project_id = $1 AND scope = 'project'", [projectId])).rows[0]!.id;
      await h.db.query("SELECT fact_record($1, $2, 'precision.pa_project_objective', $3::jsonb, 'text', 'ANSWERED', 'precision_assessment', 'client_corrected')", [projectId, pa, JSON.stringify("Open two regional warehouses")]);
      const m = (await api.get("/service-map")).body;
      expect(m.hasUnconfirmedChanges).toBe(true);
      expect(m.canConfirm).toBe(true);
      expect(m.live.changesSinceConfirmed).toEqual([{ kind: "changed", text: "Project objective updated" }]);
      expect(m.confirmed.summary.objective).toBe("Open a distribution hub for our packaged foods"); // the confirmed one is untouched
      expect((await api.get("/center")).body.serviceMap.hasUnconfirmedChanges).toBe(true);
      const r = await confirmMap(api);
      expect(r.status).toBe(200);
      expect(r.body.serviceMap).toMatchObject({ hasUnconfirmedChanges: false, canConfirm: false });
      expect(r.body.serviceMap.confirmed.summary.objective).toBe("Open two regional warehouses");
      expect(await count(h, "SELECT count(*) AS n FROM service_map_snapshot s JOIN precision_instance i ON i.id = s.precision_instance_id WHERE i.project_id = $1", [projectId])).toBe(2);
      expect(JSON.stringify(r.body)).not.toMatch(/"version"|\bv\d\b/i);
    });

    it("a category conversation: Not started -> In progress on the first answer, pinned manifest, progress from the engine", async () => {
      const logistics = cards.Logistics;
      const pinned = (await h.db.query<{ manifest_version: string; lifecycle_status: string }>("SELECT manifest_version, lifecycle_status FROM category_assessment WHERE instance_id = $1", [logistics.id])).rows[0]!;
      expect(pinned.lifecycle_status).toBe("confirmed");
      const cat = (await api.get(`/categories/${logistics.id}`)).body;
      expect(cat).toMatchObject({ id: logistics.id, label: "Logistics", status: "not_started", sendState: "not_sent" });
      expect(cat.thread).toMatchObject({ surface: "category", title: "Logistics", canWrite: true, progress: { status: "not_started", ready: false } });
      expect(cat.thread.turns.at(-1).text).toMatch(/day-to-day logistics/i);
      expect(await count(h, "SELECT count(*) AS n FROM fact WHERE scope_instance_id = $1 AND field_key <> 'precision.map_needs'", [logistics.id])).toBe(0);

      // a process question changes nothing
      const q = await api.post(`/categories/${logistics.id}/turns`, { turnKey: key("q"), text: "Why do you need this?" });
      expect(q.status).toBe(200);
      expect((await h.db.query("SELECT lifecycle_status FROM category_assessment WHERE instance_id = $1", [logistics.id])).rows[0]!.lifecycle_status).toBe("confirmed");

      const a = await api.post(`/categories/${logistics.id}/turns`, { turnKey: key("a"), text: "", quickReply: { value: "third_party_logistics", intent: "answer" } });
      expect(a.status).toBe(200);
      expect(a.body.progress).toMatchObject({ status: "in_progress", ready: false });
      expect(a.body.progress.progressPct).toBeGreaterThan(0);
      expect((await h.db.query("SELECT lifecycle_status, manifest_version FROM category_assessment WHERE instance_id = $1", [logistics.id])).rows[0]).toEqual({ lifecycle_status: "in_progress", manifest_version: pinned.manifest_version });
      const fact = (await h.db.query<{ field_key: string; provenance_stage: string }>("SELECT field_key, provenance_stage FROM fact WHERE scope_instance_id = $1 AND field_key <> 'precision.map_needs'", [logistics.id])).rows;
      expect(fact).toEqual([{ field_key: "precision.logistics_operating_responsibility", provenance_stage: expect.stringMatching(/client_answered|ai_extracted/) }]);
      // the Center card and the category agree
      const card = (await api.get("/center")).body.categories.find((c: { id: string }) => c.id === logistics.id);
      const catNow = (await api.get(`/categories/${logistics.id}`)).body;
      expect(card).toMatchObject({ status: "in_progress", progressPct: catNow.progress.progressPct, criticalOpen: catNow.progress.criticalOpen, pendingCount: catNow.progress.pendingCount });
      expect(catNow.status).toBe("in_progress");
      // Analytics: each processed turn leaves one experience event (surface, outcome, latency bucket) — never the conversation text.
      const turns = (await h.db.query<{ properties: Record<string, string> }>("SELECT properties FROM precision_journey_event WHERE event_name = 'ai_turn_completed' AND properties->>'surface' = 'category'")).rows;
      expect(turns.length).toBeGreaterThanOrEqual(2);
      for (const t of turns) {
        expect(t.properties).toEqual({ surface: "category", status: "ok", latency_bucket: expect.stringMatching(/^(lt_2s|2_5s|5_10s|10_20s|gte_20s)$/) });
      }
      expect(JSON.stringify(turns)).not.toMatch(/third_party|Why do you need/);
    });

    it("ready is independent of progress: blocking items resolved => ready for review below 100%", async () => {
      const logistics = cards.Logistics;
      const turn = (body: object) => api.post(`/categories/${logistics.id}/turns`, { turnKey: key("r"), ...body });
      let last = await turn({ text: "", quickReply: { value: "false", intent: "answer" } }); // hazardous materials: no
      for (let i = 0; i < 16 && !last.body.progress.ready; i++) {
        const asked = (last.body.turns as Array<{ role: string; text: string; quickReplies?: Array<{ value: string; intent: string }> }>).filter((t) => t.role === "assistant").at(-1)!;
        const choice = asked.quickReplies?.find((x) => x.intent === "answer");
        last = choice ? await turn({ text: "", quickReply: { value: choice.value, intent: "answer" } }) : await turn({ text: /logistics services/i.test(asked.text) ? "Warehousing" : /leave from/i.test(asked.text) ? "Spain" : /arrive in/i.test(asked.text) ? "Mexico" : /what volume/i.test(asked.text) ? "20 pallets" : /product moves/i.test(asked.text) ? "Packaged food" : "yes" });
      }
      expect(last.body.progress.ready).toBe(true);
      expect(last.body.progress.status).toBe("ready_for_review");
      expect(last.body.progress.criticalOpen).toBe(0);
      expect(last.body.progress.progressPct).toBeLessThan(100);
      expect(last.body.progress.pendingCount).toBeGreaterThan(0);
      const card = (await api.get("/center")).body.categories.find((c: { id: string }) => c.id === logistics.id);
      expect(card).toMatchObject({ status: "ready_for_review", criticalOpen: 0 });
      const ev = await events(h, projectId);
      expect(ev.category_started).toBe(1);
      expect(ev.crp_ready_for_review).toBe(1);
      expect(ev.category_progress_changed).toBeGreaterThan(1);
      expect(ev.critical_item_resolved).toBeGreaterThan(0);
      // the other category is untouched
      expect((await api.get("/center")).body.categories.find((c: { label: string }) => c.label.startsWith("Tax"))).toMatchObject({ status: "not_started" });
    });
  });

  describe("Add a Service", () => {
    it("is unavailable until the map is confirmed", async () => {
      const { projectId } = await h.newProject();
      const api = h.api(await h.session(projectId));
      expect((await api.get("/add-service")).body).toEqual({ available: false, thread: null });
      expect((await api.post("/add-service/turns", { turnKey: key("n"), text: "We need customs brokerage" })).status).toBe(409);
      expect((await api.get("/center")).body.addService.available).toBe(false);
    });

    it("classifies deterministically: known service, study, unmapped/discovery; out of scope creates nothing; each adds a new map version", async () => {
      const { projectId } = await h.newProject();
      const api = h.api(await h.session(projectId));
      await confirmedProject(api);
      const versions = () => count(h, "SELECT count(*) AS n FROM service_map_snapshot s JOIN precision_instance i ON i.id = s.precision_instance_id WHERE i.project_id = $1", [projectId]);
      expect(await versions()).toBe(1);

      const known = await addNeed(api, "We need customs brokerage for imports");
      expect(known.body).toMatchObject({ status: "ok", serviceMapChanged: true });
      expect(await versions()).toBe(2);
      const sa = await addNeed(api, "A feasibility study for the Mexican market");
      expect(sa.body.serviceMapChanged).toBe(true);
      const discovery = await addNeed(api, "We want help with public procurement tenders");
      expect(discovery.body.serviceMapChanged).toBe(true);
      expect(await versions()).toBe(4);

      const oos = await addNeed(api, "We need work visas for our staff");
      expect(oos.body.serviceMapChanged).toBe(false);
      expect(oos.body.turns.at(-1).text).toMatch(/do not offer this service/i);
      expect(oos.body.turns.at(-1).text).not.toMatch(/adding it to your project/i);
      expect(await versions()).toBe(4);

      const map = (await api.get("/service-map")).body;
      const groups = map.live.groups.map((g: { label: string; kind: string; categoryId: string | null; items: Array<{ label: string }> }) => [g.label, g.kind, g.categoryId !== null || g.kind === "to_review", g.items.map((i) => i.label)]);
      expect(groups).toEqual([
        ["Tax, Accounting and Audit", "category", true, ["Tax and accounting advice"]],
        ["Logistics", "category", true, ["Third-party logistics", "Freight transportation"]],
        ["International Trade and Customs", "category", true, ["We need customs brokerage for imports"]],
        ["Strategic Advisory", "strategic_advisory", true, ["A feasibility study for the Mexican market"]],
        ["Under review", "to_review", true, ["We want help with public procurement tenders"]],
      ]);
      expect(map.hasUnconfirmedChanges).toBe(false); // the new version was recorded by the confirmation of the need itself
      expect(map.confirmed.groups).toHaveLength(5);
      expect(JSON.stringify(map)).not.toMatch(/new:|_generic|procurement_/);

      // the new workstreams exist as "Not started"; the unmapped need sits in a category backed by the generic questions
      const center = (await api.get("/center")).body;
      expect(center.categories.map((c: { label: string; status: string }) => [c.label, c.status])).toEqual([
        ["Tax, Accounting and Audit", "not_started"], ["Logistics", "not_started"], ["International Trade and Customs", "not_started"], ["Strategic Advisory", "not_started"], ["We want help with public procurement tenders", "not_started"],
      ]);
      const trade = (await h.db.query<{ value: unknown }>("SELECT f.value FROM fact f JOIN category_assessment ca ON ca.instance_id = f.scope_instance_id WHERE ca.project_id = $1 AND ca.category_key = 'international_trade_customs' AND f.superseded_by IS NULL AND f.field_key <> 'precision.map_needs'", [projectId])).rows;
      expect(JSON.stringify(trade)).toMatch(/customs brokerage|generic|need_description/i);
      const keys = (await h.db.query<{ category_key: string; category_origin: string; lifecycle_status: string }>("SELECT category_key, category_origin, lifecycle_status FROM category_assessment WHERE project_id = $1 ORDER BY created_at", [projectId])).rows;
      expect(keys.find((k) => k.category_key.startsWith("new:"))).toMatchObject({ category_origin: "client_added", lifecycle_status: "confirmed" });
      expect(keys.find((k) => k.category_key === "strategic_advisory")).toMatchObject({ category_origin: "client_added" });

      const ev = await events(h, projectId);
      expect(ev).toMatchObject({ add_service_started: 4, add_service_completed: 3, possible_new_service_detected: 1, possible_new_service_category_proposed: 1 });
    });

    it("the same confirmation twice has one effect", async () => {
      const { projectId } = await h.newProject();
      const api = h.api(await h.session(projectId));
      await confirmedProject(api);
      const tag = key("dup");
      const first = await addNeed(api, "We need customs brokerage for imports", tag);
      const card = (await h.db.query<{ structured: { state?: { confirmToken?: string } } }>("SELECT structured FROM precision_turn WHERE project_id = $1 AND turn_key = $2 AND role = 'assistant'", [projectId, `${tag}-1`.padEnd(12, "x")])).rows[0]!.structured.state!.confirmToken!;
      const replay = await api.post("/add-service/turns", { turnKey: `${tag}-2`.padEnd(12, "x"), text: "", confirm: { token: card, intent: "confirm" } });
      expect(replay.status).toBe(200);
      expect(replay.body.turns.map((t: { id: string }) => t.id)).toEqual(first.body.turns.map((t: { id: string }) => t.id));
      expect(await count(h, "SELECT count(*) AS n FROM service_map_snapshot s JOIN precision_instance i ON i.id = s.precision_instance_id WHERE i.project_id = $1", [projectId])).toBe(2);
      expect((await events(h, projectId)).add_service_completed).toBe(1);
    });
  });

  describe("Help and the Operation Hub block", () => {
    const setConfig = async (k: string, value: unknown) => {
      await h.db.query("UPDATE precision_config SET is_active = false WHERE key = $1 AND locale = '*' AND is_active", [k]);
      if (value !== null) await h.db.query("INSERT INTO precision_config (key, locale, value) VALUES ($1, '*', $2::jsonb)", [k, JSON.stringify(value)]);
    };

    it("Help: approved links and the single contact address (row > default); contact messages are stored without promising a response time", async () => {
      const { projectId } = await h.newProject();
      const api = h.api(await h.session(projectId));
      await setConfig("help_center_url", null);
      const approved = { helpCenterUrl: "https://www.beeside.you/helpcenter", privacyUrl: "https://www.beeside.you/privacy", termsUrl: "https://beeside.you/termsandconditions", contactEmail: "contact@beeside.you", contactAvailable: true };
      expect((await api.get("/help")).body).toEqual(approved);
      expect((await api.get("/help")).body).not.toHaveProperty("commercialNoticesUrl"); // only a commercial-consent context may show it
      expect((await api.get("/center")).body.help.helpCenterUrl).toBe("https://www.beeside.you/helpcenter");
      await setConfig("help_center_url", "https://help.example.test/precision");
      expect((await api.get("/help")).body.helpCenterUrl).toBe("https://help.example.test/precision");
      await setConfig("help_center_url", "javascript:alert(1)");
      expect((await api.get("/help")).body.helpCenterUrl).toBe("https://www.beeside.you/helpcenter");
      await setConfig("help_center_url", null);
    });

    it("hidden until the first delivery; pending access; enter with the configured link; Sherpa contact only with a valid direct channel", async () => {
      const { projectId } = await h.newProject();
      const api = h.api(await h.session(projectId));
      const delivery = h.runtime.deps.delivery;
      const original = delivery.getSendState.bind(delivery);
      const state = (goToOperationHub: "hidden" | "pending_access" | "enter", sherpaAssigned: boolean, sherpaContactEmail?: string, firstSendDone = goToOperationHub !== "hidden") =>
        (delivery.getSendState = async () => ({
          firstSendDone,
          ohAccess: { provisioned: firstSendDone, clientAccessible: goToOperationHub === "enter", sherpaAssigned, ...(sherpaContactEmail ? { sherpaContactEmail } : {}) },
          ux: { goToOperationHub, contactMySherpa: goToOperationHub === "enter" && sherpaAssigned },
        }));
      const hub = async () => (await api.get("/center")).body.operationHub;
      try {
        await setConfig("operation_hub_url", null);
        await setConfig("sherpa_contact_email", null);
        state("hidden", false);
        expect(await hub()).toEqual({ state: "hidden", url: null, contact: null });
        state("pending_access", false);
        expect(await hub()).toEqual({ state: "pending_access", url: null, contact: null });
        state("enter", true); // accessible but no link configured: honest "pending", never a dead button
        expect(await hub()).toEqual({ state: "pending_access", url: null, contact: null });
        await setConfig("operation_hub_url", "https://hub.example.test/enter");
        // Sherpa assigned but NO direct channel anywhere: the action is general Contact beeside, never "Contact my Sherpa"
        expect(await hub()).toEqual({ state: "enter", url: "https://hub.example.test/enter", contact: { kind: "beeside", email: "contact@beeside.you" } });
        // no Sherpa assigned: no contact action next to Operation Hub (general Help stays available)
        state("enter", false);
        expect(await hub()).toEqual({ state: "enter", url: "https://hub.example.test/enter", contact: null });
        // a direct channel provided by the hub for this project
        state("enter", true, "ana.sherpa@channel.example.test");
        expect((await hub()).contact).toEqual({ kind: "sherpa", email: "ana.sherpa@channel.example.test" });
        // a malformed hub value is not a channel
        state("enter", true, "not an address");
        expect((await hub()).contact).toEqual({ kind: "beeside", email: "contact@beeside.you" });
        // a configured direct channel (no hub value)
        await setConfig("sherpa_contact_email", "sherpas@channel.example.test");
        state("enter", true);
        expect((await hub()).contact).toEqual({ kind: "sherpa", email: "sherpas@channel.example.test" });
        // the hub's per-project channel wins over the configured one
        state("enter", true, "ana.sherpa@channel.example.test");
        expect((await hub()).contact).toEqual({ kind: "sherpa", email: "ana.sherpa@channel.example.test" });
        // channel present but nobody assigned: nothing
        state("enter", false, "ana.sherpa@channel.example.test");
        expect((await hub()).contact).toBeNull();
        await setConfig("sherpa_contact_email", null);
        delivery.getSendState = async () => { throw new Error("hub down"); };
        expect((await api.get("/center")).body.operationHub.state).toBe("hidden"); // the platform being unreachable never breaks the Center
      } finally {
        delivery.getSendState = original;
        await setConfig("sherpa_contact_email", null);
        await setConfig("operation_hub_url", null);
      }
    });
  });

  it("a project the platform does not know has no Precision data and no Center content", async () => {
    const { projectId } = await h.newProject({ context: null });
    const api = h.api(await h.session(projectId));
    const c = (await api.get("/center")).body;
    expect(c).toMatchObject({ understanding: { state: "not_started" }, categories: [], serviceMap: { available: false }, project: { destinations: [], sector: null } });
    void randomUUID;
    void FA_CONTEXT;
  });
});
