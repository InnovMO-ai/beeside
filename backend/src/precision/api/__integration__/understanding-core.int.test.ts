/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Understanding Core through the real API on PostgreSQL (engine = core): the Portuguese reference company from the first message to
 * a confirmed My Service Map, what Discovery already knew is used (never re-asked), the map carries the client's priority and
 * reasons, the client corrects it, and "Add a service" reads the NEED first.
 */
import { randomUUID } from "node:crypto";
import { createPgFrameStore } from "../../understanding/pg-store";
import { setupHarness, TEST_DATABASE_URL, type Harness } from "./harness";
import { confirmMap, internalTermsIn, key } from "./drive";
import type { FaClientSafeContext } from "../../ports/fa-context";
import { briefingHygiene } from "../../understanding/briefing";
import { toPayloadPsm } from "../../domain/crp/payload";

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

d("Understanding Core — through the API", () => {
  let h: Harness;
  beforeAll(async () => { h = await setupHarness({ engine: "core" }); });
  afterAll(async () => { await h.close(); });

  /** Last assistant turn's pending action (what the engine asked), read from the stored turn. */
  async function pending(projectId: string): Promise<{ kind: string; probeKey?: string; needId?: string } | null> {
    const r = await h.db.query<{ structured: any }>("SELECT structured FROM precision_turn WHERE project_id = $1 AND role = 'assistant' AND surface = 'understanding' ORDER BY seq DESC LIMIT 1", [projectId]);
    return r.rows[0]?.structured?.understanding?.action ?? null;
  }

  async function drive(api: ReturnType<Harness["api"]>, projectId: string, opening: string, maxTurns = 40): Promise<{ state: string; asked: string[]; turns: number }> {
    const asked: string[] = [];
    const first = await api.get("/understanding");
    expect(first.status).toBe(200);
    let r = await api.post("/understanding/turns", { turnKey: key("open"), text: opening });
    let turns = 1;
    while (r.body.understandingState !== "ready_to_confirm" && turns < maxTurns) {
      const a = await pending(projectId);
      const last = [...r.body.turns].reverse().find((t: any) => t.role === "assistant");
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
    return { state: r.body.understandingState, asked, turns };
  }

  it("opens from what Discovery knows: it is used, never asked again", async () => {
    const { projectId } = await h.newProject({ context: PT_CONTEXT });
    const api = h.api(await h.session(projectId), "es");
    const th = (await api.get("/understanding")).body;
    const text = th.turns.map((t: any) => t.text).join(" ").toLowerCase();
    expect(th.turns.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/qué producto|what product/);
    expect(text).not.toContain("a qué país");
  });

  it("scopes the Portuguese company like a strong first meeting, then builds My Service Map with the client's priority and reasons", async () => {
    const { projectId } = await h.newProject({ context: PT_CONTEXT });
    const api = h.api(await h.session(projectId), "es");
    const run = await drive(api, projectId, NARRATIVE);
    expect(run.state).toBe("ready_to_confirm");
    expect(run.asked).toEqual(expect.arrayContaining(["entity.form", "workforce.headcount", "workforce.split", "scale.revenue", "scale.volume", "tax.intercompany"]));
    for (const k of ["project.duration", "workforce.model", "entity.funding"]) expect(run.asked).not.toContain(k);
    expect(run.turns).toBeLessThanOrEqual(24);

    const map = (await api.get("/service-map")).body;
    const labels = map.live.groups.flatMap((g: any) => g.items.map((i: any) => i.label.toLowerCase()));
    expect(map.live.groups.length).toBeGreaterThanOrEqual(3);
    expect(labels.join(" ")).toMatch(/entidad/);
    // the client's priority (their words), not the catalog's
    const items = map.live.groups.flatMap((g: any) => g.items);
    const entity = items.find((i: any) => /entidad/i.test(i.label));
    expect(entity.priority).toBe("high");
    expect(entity.why).toBeTruthy();
    const tax = items.find((i: any) => /fiscal|impuestos/i.test(i.label));
    if (tax) expect(tax.priority).toBe("low");
    expect(map.canConfirm).toBe(true);
    // no workstream before the client confirms
    expect(map.live.groups.every((g: any) => g.categoryId === null)).toBe(true);
    expect(internalTermsIn(h.seen)).toEqual([]);

    const done = await confirmMap(api);
    expect(done.status).toBe(200);

    // the depth travels with the map: a clean briefing in the confirmed snapshot, whitelisted into the Operation Hub payload
    const snap = (await h.db.query<{ content: any; version: number }>(
      "SELECT s.content, s.version FROM service_map_snapshot s JOIN precision_instance i ON i.id = s.precision_instance_id WHERE i.project_id = $1 ORDER BY s.version DESC LIMIT 1", [projectId],
    )).rows[0]!;
    const u = snap.content.understanding;
    expect(u).toBeDefined();
    expect(briefingHygiene(u)).toEqual([]);
    const factText = u.facts.map((f: any) => `${f.label}: ${f.value}`).join(" | ");
    expect(factText).toMatch(/60 personas/);
    expect(factText).toMatch(/3 millones/);
    expect(factText).toMatch(/150 facturas/);
    expect(factText).not.toMatch(/seguridad(?! social)/i);
    expect(u.findings.map((f: any) => f.title).join(" ")).toMatch(/subcontratado/i);
    const payload = toPayloadPsm({ ...(snap as object), content: snap.content, version: snap.version } as never);
    expect(payload.understanding?.facts.length).toBeGreaterThan(5);
    expect(payload.understanding?.findings.length).toBeGreaterThan(2);
    expect(JSON.stringify(payload)).not.toMatch(/n:disc|fr:|new:|_generic|fa4_|¿/);

    const again = await confirmMap(api, key("again"));
    expect(again.status).toBe(200);
    expect(again.body.serviceMap.hasUnconfirmedChanges).toBe(false);
  }, 120000);

  it("offers an Admin-managed country guide once, in context, and only that project can open it", async () => {
    const guideId = randomUUID();
    await h.db.query(
      "INSERT INTO country_resource (id, country_code, title, language, version, destination_kind, destination_ref, active, updated_at, topic) VALUES ($1,'MX','Hacer negocios en México','es','2026.1','url','https://guides.example.test/mx','true'::boolean, now(), 'entity_setup')",
      [guideId],
    );
    try {
      const { projectId } = await h.newProject({ context: PT_CONTEXT });
      const api = h.api(await h.session(projectId), "es");
      await api.get("/understanding");
      const first = await api.post("/understanding/turns", { turnKey: key("open"), text: NARRATIVE });
      const offers = (r: any) => r.body.turns.filter((t: any) => t.resourceOffer);
      let seen = offers(first);
      let r = first;
      for (let i = 0; i < 4 && r.body.understandingState !== "ready_to_confirm"; i++) {
        const a = await pending(projectId);
        if (a?.kind !== "ask_probe") break;
        r = await api.post("/understanding/turns", { turnKey: key("u"), text: ANSWERS[a.probeKey as string] ?? "Todavía no lo sé." });
        seen = seen.concat(offers(r));
      }
      expect(seen).toHaveLength(1); // once
      expect(seen[0].resourceOffer).toEqual({ id: guideId, title: "Hacer negocios en México" });
      expect(seen[0].text).toContain("Hacer negocios en México");
      expect(seen[0].text).not.toContain("guides.example.test");
      expect(seen[0].text).toMatch(/no es necesario|no necesitas/i);
      expect(internalTermsIn(h.seen)).toEqual([]);

      const opened = await api.get(`/resources/${guideId}`);
      expect(opened.status).toBe(200);
      expect(opened.body).toMatchObject({ id: guideId, kind: "url", ref: "https://guides.example.test/mx" });

      // another project that was never offered the guide cannot resolve it
      const other = await h.newProject({ context: PT_CONTEXT });
      const apiOther = h.api(await h.session(other.projectId), "es");
      expect((await apiOther.get(`/resources/${guideId}`)).status).toBe(404);

      // deactivated in Admin -> no longer opens
      await h.db.query("UPDATE country_resource SET active = false WHERE id = $1", [guideId]);
      expect((await api.get(`/resources/${guideId}`)).status).toBe(404);
    } finally {
      await h.db.query("DELETE FROM country_resource WHERE id = $1", [guideId]);
    }
  }, 120000);

  it("the client corrects the map: remove, priority, reword and move are applied as stated and survive every later load", async () => {
    const { projectId } = await h.newProject({ context: PT_CONTEXT });
    const api = h.api(await h.session(projectId), "es");
    await drive(api, projectId, NARRATIVE);
    let map = (await api.get("/service-map")).body;
    const all = (): any[] => map.live.groups.flatMap((g: any) => g.items.map((i: any) => ({ ...i, group: g.label })));
    const victim = all().find((i) => /contabilidad/i.test(i.label));
    expect(victim).toBeDefined();
    expect(map.moveTargets?.length).toBeGreaterThan(5);

    // remove
    let r = await api.post("/service-map/corrections", { requestKey: key("rm"), op: "remove", itemId: victim.id });
    expect(r.status).toBe(200);
    map = r.body.serviceMap;
    expect(all().some((i) => i.id === victim.id)).toBe(false);
    // the same request twice has one effect
    const rm2 = await api.post("/service-map/corrections", { requestKey: key("rm2"), op: "remove", itemId: victim.id });
    expect(rm2.status).toBe(404);
    // survives a fresh load (the frame is the source, the proposal does not bring it back)
    map = (await api.get("/service-map")).body;
    expect(all().some((i) => i.id === victim.id)).toBe(false);

    // priority is the client's
    const social = all().find((i) => /seguridad social/i.test(i.label));
    r = await api.post("/service-map/corrections", { requestKey: key("pr"), op: "set_priority", itemId: social.id, priority: "high" });
    map = r.body.serviceMap;
    expect(all().find((i) => i.id === social.id).priority).toBe("high");

    // move to another group
    const target = map.moveTargets.find((t: any) => /Logística/i.test(t.label));
    const toMove = all().find((i) => /seguridad social/i.test(i.label));
    r = await api.post("/service-map/corrections", { requestKey: key("mv"), op: "move", itemId: toMove.id, toGroupId: target.id });
    map = r.body.serviceMap;
    expect(all().find((i) => i.id === toMove.id).group).toMatch(/Logística/i);

    // malformed requests are rejected
    expect((await api.post("/service-map/corrections", { requestKey: key("bad"), op: "move", itemId: toMove.id, toGroupId: "g_nope" })).status).toBe(400);
    expect((await api.post("/service-map/corrections", { requestKey: "x", op: "remove", itemId: toMove.id })).status).toBe(400);
  }, 120000);

  it("fact freshness: when Discovery changes after Precision started, the frame follows and says so", async () => {
    const { projectId } = await h.newProject({ context: PT_CONTEXT });
    const api = h.api(await h.session(projectId), "es");
    await api.get("/understanding");
    const before = (await createPgFrameStore(h.db).load(projectId))!;
    expect(before.frame.items["project.timeframe"]?.value).toBe("2027-01");
    h.fa.add({ projectId, resultId: randomUUID(), context: { ...PT_CONTEXT, project: { ...PT_CONTEXT.project, timeframe: "2027-09" } } });
    h.runtime.domain.fa.invalidate(projectId);
    expect((await api.get("/understanding")).status).toBe(200);
    const after = (await createPgFrameStore(h.db).load(projectId))!;
    expect(after.frame.items["project.timeframe"]?.value).toBe("2027-09");
    expect(after.frame.changedSinceDiscovery.some((c) => c.key === "project.timeframe")).toBe(true);
    expect(after.frame.discoveryPinId).not.toBe(before.frame.discoveryPinId);
    // the same pin read again changes nothing
    await api.get("/understanding");
    expect((await createPgFrameStore(h.db).load(projectId))!.version).toBe(after.version);
  });

  it("Add a service reads the NEED first: marketing is a known need, a warehouse is asked once, noise is not a service", async () => {
    const { projectId } = await h.newProject({ context: PT_CONTEXT });
    const api = h.api(await h.session(projectId), "es");
    await drive(api, projectId, NARRATIVE);
    expect((await confirmMap(api)).status).toBe(200);

    const say = async (text: string, tag: string): Promise<any> => (await api.post("/add-service/turns", { turnKey: key(tag), text })).body;
    const reply = (b: any): string => [...b.turns].reverse().find((t: any) => t.role === "assistant").text;

    expect(reply(await say("quiero agregar más servicios", "meta"))).toMatch(/otra necesidad/i);
    expect(reply(await say("4 plumones", "goods"))).toMatch(/artículo/i);
    expect(reply(await say("un sillón", "sofa"))).toMatch(/artículo/i);
    expect(reply(await say("almacén", "wh"))).toMatch(/espacio para rentar|servicio que almacene/i);
    expect(reply(await say("cadena de frío", "cold"))).toMatch(/condición|transporte/i);
    const marketing = await say("marketing", "mk");
    expect(marketing.turns.some((t: any) => t.confirmCard)).toBe(true);
    const card = marketing.turns.find((t: any) => t.confirmCard).confirmCard;
    const done = await api.post("/add-service/turns", { turnKey: key("mk2"), text: "", confirm: { token: card.token, intent: "confirm" } });
    expect(done.status).toBe(200);
    const map = (await api.get("/service-map")).body;
    const mk = map.live.groups.find((g: any) => /Marketing/i.test(g.label));
    expect(mk).toBeDefined();
    expect(mk.kind).toBe("category"); // a catalog category, not "under review"
    expect(map.live.groups.some((g: any) => g.kind === "to_review" && g.items.some((i: any) => /marketing/i.test(i.label)))).toBe(false);
  }, 120000);
});
