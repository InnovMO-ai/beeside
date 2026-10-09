import request from "supertest";
import { recordFact } from "../../../repository";
import { fillCategory, DEMO_STRATEGIC_FACTS } from "../../seed";
import { createHarness, describeWithDb, type Harness } from "./harness";

const auth = (projectId: string, extra: Record<string, string> = {}): Record<string, string> => ({ "x-test-project": projectId, ...extra });
const count = async (h: Harness, sql: string, args: unknown[]): Promise<number> => Number((await h.db.query<{ n: string }>(sql, args)).rows[0]!.n);

describeWithDb("CRP lifecycle (PostgreSQL, committed rows, test-only auth)", () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());

  it("shows the live draft: ready for review, Pending Information always listed, Execution Dependency marked, no internal keys", async () => {
    const p = await h.newProject();
    const res = await request(h.app).get(`/api/precision/categories/${p.id("logistics")}/crp`).set(auth(p.projectId));
    expect(res.status).toBe(200);
    const v = res.body;
    expect(v.state).toBe("ready_for_review");
    expect(v.canConfirm).toBe(true);
    expect(v.canRequestChanges).toBe(true);
    expect(v.canStartNewVersion).toBe(false);
    expect(v.confirmedAt).toBeNull();
    expect(v.title).toContain("Category Requirement Pack (CRP)");
    expect(v.context.join(" ")).toContain("Mexico");
    // the client said "not sure yet" about licensing: it is listed as pending, and stays inside its section too
    expect(v.pending.map((r: { label: string }) => r.label).join(" ")).toMatch(/licens/i);
    const all = v.sections.flatMap((s: { items: Array<{ label: string; state: string; executionDependency: boolean; value: string | null }> }) => s.items);
    expect(all.some((r: { executionDependency: boolean }) => r.executionDependency)).toBe(true);
    expect(all.find((r: { label: string }) => /day-to-day logistics/i.test(r.label)).value).toMatch(/third/i);
    expect(JSON.stringify(v)).not.toMatch(/logistics_|precision\.|new:|_generic|CONTEXT_ONLY|"visibility"/);
  });

  it("renders in Spanish for an es request", async () => {
    const p = await h.newProject();
    const v = (await request(h.app).get(`/api/precision/categories/${p.id("logistics")}/crp`).set(auth(p.projectId, { "x-precision-locale": "es" }))).body;
    expect(v.context.join(" ")).toContain("Destino");
    expect(v.context.join(" ")).toContain("México");
  });

  it("confirm requires readiness: a category with no answers is NOT_READY", async () => {
    const p = await h.newProject();
    const res = await request(h.app).post(`/api/precision/categories/${p.id("international_trade_customs")}/crp/confirm`).set(auth(p.projectId)).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("NOT_READY");
    expect(res.body.message).toMatch(/information/i);
    expect(await count(h, "SELECT count(*) AS n FROM pack WHERE category_assessment_instance_id = $1", [p.id("international_trade_customs")])).toBe(0);
  });

  it("confirm with answers still missing in a started category is NOT_READY and writes nothing", async () => {
    const p = await h.newProject();
    const id = p.id("strategic_advisory");
    await fillCategory(h.db, p.projectId, id, DEMO_STRATEGIC_FACTS.slice(0, 1));
    const view = await request(h.app).get(`/api/precision/categories/${id}/crp`).set(auth(p.projectId));
    expect(view.body.state).toBe("draft");
    expect(view.body.canConfirm).toBe(false);
    const res = await request(h.app).post(`/api/precision/categories/${id}/crp/confirm`).set(auth(p.projectId)).send({});
    expect([res.status, res.body.error]).toEqual([409, "NOT_READY"]);
    expect((await h.db.query<{ lifecycle_status: string }>("SELECT lifecycle_status FROM category_assessment WHERE instance_id = $1", [id])).rows[0]!.lifecycle_status).toBe("in_progress");
    expect(await count(h, "SELECT count(*) AS n FROM pack WHERE category_assessment_instance_id = $1", [id])).toBe(0);
  });

  it("confirm creates one immutable pack + dated confirmation + lifecycle completed, does NOT send, emits crp_confirmed once", async () => {
    const p = await h.newProject();
    const id = p.id("logistics");
    const res = await request(h.app).post(`/api/precision/categories/${id}/crp/confirm`).set(auth(p.projectId)).send({ requestKey: "confirm-req-0001" });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("confirmed");
    expect(res.body.confirmedAt).toEqual(expect.any(String));
    expect(res.body.canConfirm).toBe(false);
    expect(res.body.canStartNewVersion).toBe(true);
    const cat = (await h.db.query<{ lifecycle_status: string; current_pack_id: string }>("SELECT lifecycle_status, current_pack_id FROM category_assessment WHERE instance_id = $1", [id])).rows[0]!;
    expect(cat.lifecycle_status).toBe("completed");
    expect(await count(h, "SELECT count(*) AS n FROM crp_confirmation WHERE pack_id = $1", [cat.current_pack_id])).toBe(1);
    expect(await count(h, "SELECT count(*) AS n FROM oh_delivery WHERE project_id = $1", [p.projectId])).toBe(0);
    expect(h.spy.publishCalls).toBe(0);
    expect(await count(h, "SELECT count(*) AS n FROM precision_journey_event WHERE project_id = $1 AND event_name = 'crp_confirmed'", [p.projectId])).toBe(1);
    // the stored pack is the client-facing structure: crp.v1 with the pointer manifest
    const pack = (await h.db.query<{ content: { schema: string }; context_snapshot: { fact_ids: string[] } }>("SELECT content, context_snapshot FROM pack WHERE id = $1", [cat.current_pack_id])).rows[0]!;
    expect(pack.content.schema).toBe("crp.v1");
    expect(pack.context_snapshot.fact_ids.length).toBeGreaterThan(3);
  });

  it("repeating the confirm click is a no-op (one pack, one confirmation, one event)", async () => {
    const p = await h.newProject();
    const id = p.id("logistics");
    const a = await request(h.app).post(`/api/precision/categories/${id}/crp/confirm`).set(auth(p.projectId)).send({});
    const b = await request(h.app).post(`/api/precision/categories/${id}/crp/confirm`).set(auth(p.projectId)).send({});
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.body.confirmedAt).toBe(a.body.confirmedAt);
    expect(await count(h, "SELECT count(*) AS n FROM pack WHERE category_assessment_instance_id = $1", [id])).toBe(1);
    expect(await count(h, "SELECT count(*) AS n FROM precision_journey_event WHERE project_id = $1 AND event_name = 'crp_confirmed'", [p.projectId])).toBe(1);
  });

  it("racing confirm requests (Promise.all) produce exactly one pack and one confirmation", async () => {
    const p = await h.newProject();
    const id = p.id("logistics");
    const rs = await Promise.all(Array.from({ length: 6 }, () => request(h.app).post(`/api/precision/categories/${id}/crp/confirm`).set(auth(p.projectId)).send({})));
    expect(rs.map((r) => r.status)).toEqual(Array(6).fill(200));
    expect(await count(h, "SELECT count(*) AS n FROM pack WHERE category_assessment_instance_id = $1", [id])).toBe(1);
    expect(await count(h, "SELECT count(*) AS n FROM crp_confirmation WHERE project_id = $1", [p.projectId])).toBe(1);
    expect(await count(h, "SELECT count(*) AS n FROM precision_journey_event WHERE project_id = $1 AND event_name = 'crp_confirmed'", [p.projectId])).toBe(1);
  });

  it("request changes keeps the category in progress, writes one assistant notice, is free of versioning and idempotent per state", async () => {
    const p = await h.newProject();
    const id = p.id("logistics");
    const a = await request(h.app).post(`/api/precision/categories/${id}/crp/request-changes`).set(auth(p.projectId)).send({});
    expect(a.status).toBe(200);
    expect(a.body.state).toBe("ready_for_review");
    await request(h.app).post(`/api/precision/categories/${id}/crp/request-changes`).set(auth(p.projectId)).send({});
    const notices = (await h.db.query<{ content: string; role: string; kind: string; surface: string }>("SELECT content, role, kind, surface FROM precision_turn WHERE scope_instance_id = $1", [id])).rows;
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ role: "assistant", kind: "notice", surface: "category" });
    expect(notices[0]!.content).not.toMatch(/reopen|reabrir|version/i);
    expect((await h.db.query<{ lifecycle_status: string }>("SELECT lifecycle_status FROM category_assessment WHERE instance_id = $1", [id])).rows[0]!.lifecycle_status).toBe("in_progress");
    expect(await count(h, "SELECT count(*) AS n FROM pack WHERE category_assessment_instance_id = $1", [id])).toBe(0);
    // after the facts change, asking again is a new notice
    await recordFact(h.db, { projectId: p.projectId, scopeInstanceId: id, fieldKey: "precision.logistics_insurance_coverage_status", value: "covered", valueType: "enum", answerState: "ANSWERED", source: "category", provenanceStage: "client_answered" });
    await request(h.app).post(`/api/precision/categories/${id}/crp/request-changes`).set(auth(p.projectId)).send({});
    expect(await count(h, "SELECT count(*) AS n FROM precision_turn WHERE scope_instance_id = $1", [id])).toBe(2);
  });

  it("request changes on a confirmed CRP is refused (a new version is the path)", async () => {
    const p = await h.newProject();
    const id = p.id("logistics");
    await request(h.app).post(`/api/precision/categories/${id}/crp/confirm`).set(auth(p.projectId)).send({});
    const res = await request(h.app).post(`/api/precision/categories/${id}/crp/request-changes`).set(auth(p.projectId)).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("CONFLICT");
  });

  it("new version: back to in progress, the confirmed pack stays current until a new one is confirmed", async () => {
    const p = await h.newProject();
    const id = p.id("logistics");
    await request(h.app).post(`/api/precision/categories/${id}/crp/confirm`).set(auth(p.projectId)).send({});
    const first = (await h.db.query<{ current_pack_id: string }>("SELECT current_pack_id FROM category_assessment WHERE instance_id = $1", [id])).rows[0]!.current_pack_id;

    const nv = await request(h.app).post(`/api/precision/categories/${id}/crp/new-version`).set(auth(p.projectId)).send({});
    expect(nv.status).toBe(200);
    expect(nv.body.state).toBe("ready_for_review");
    const dup = await request(h.app).post(`/api/precision/categories/${id}/crp/new-version`).set(auth(p.projectId)).send({});
    expect(dup.status).toBe(200);
    const mid = (await h.db.query<{ lifecycle_status: string; current_pack_id: string }>("SELECT lifecycle_status, current_pack_id FROM category_assessment WHERE instance_id = $1", [id])).rows[0]!;
    expect(mid).toEqual({ lifecycle_status: "in_progress", current_pack_id: first });
    expect(await count(h, "SELECT count(*) AS n FROM precision_journey_event WHERE project_id = $1 AND event_name = 'crp_change_requested'", [p.projectId])).toBe(1);

    await recordFact(h.db, { projectId: p.projectId, scopeInstanceId: id, fieldKey: "precision.logistics_insurance_coverage_status", value: "covered", valueType: "enum", answerState: "ANSWERED", source: "category", provenanceStage: "client_answered" });
    const c2 = await request(h.app).post(`/api/precision/categories/${id}/crp/confirm`).set(auth(p.projectId)).send({});
    expect(c2.body.state).toBe("confirmed");
    const end = (await h.db.query<{ current_pack_id: string }>("SELECT current_pack_id FROM category_assessment WHERE instance_id = $1", [id])).rows[0]!.current_pack_id;
    expect(end).not.toBe(first);
    expect(await count(h, "SELECT count(*) AS n FROM pack WHERE category_assessment_instance_id = $1", [id])).toBe(2);
    expect(await count(h, "SELECT count(*) AS n FROM crp_confirmation WHERE project_id = $1", [p.projectId])).toBe(2);
    // the first pack and its confirmation are untouched
    expect(await count(h, "SELECT count(*) AS n FROM crp_confirmation WHERE pack_id = $1", [first])).toBe(1);
  });

  it("new version needs a confirmed CRP", async () => {
    const p = await h.newProject();
    const res = await request(h.app).post(`/api/precision/categories/${p.id("logistics")}/crp/new-version`).set(auth(p.projectId)).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("CONFLICT");
  });

  it("a category of another project is a 404 on every route (cross-project isolation); malformed ids too", async () => {
    const a = await h.newProject();
    const b = await h.newProject();
    const foreign = a.id("logistics");
    for (const [m, path] of [["get", "crp"], ["post", "crp/request-changes"], ["post", "crp/confirm"], ["post", "crp/new-version"], ["get", "preview"], ["post", "send"]] as const) {
      const req = (request(h.app) as unknown as Record<string, (u: string) => request.Test>)[m]!(`/api/precision/categories/${foreign}/${path}`).set(auth(b.projectId));
      const res = await (m === "post" ? req.send({ previewChecksum: "a".repeat(64) }) : req);
      expect([m, path, res.status]).toEqual([m, path, 404]);
      expect(res.body.error).toBe("NOT_FOUND");
    }
    expect((await request(h.app).get("/api/precision/categories/not-a-uuid/crp").set(auth(a.projectId))).status).toBe(404);
    // and nothing happened to the owner's category
    expect((await h.db.query<{ lifecycle_status: string }>("SELECT lifecycle_status FROM category_assessment WHERE instance_id = $1", [foreign])).rows[0]!.lifecycle_status).toBe("in_progress");
  });

  it("a category that is not selected or only proposed is not visible", async () => {
    const p = await h.newProject();
    const other = (await h.db.query<{ id: string }>("INSERT INTO precision_instance (project_id, scope) VALUES ($1, 'category') RETURNING id", [p.projectId])).rows[0]!.id;
    const mv = (await h.db.query<{ version: string }>("SELECT version FROM category_manifest_version WHERE category_key = 'hr' AND is_current", [])).rows[0];
    void mv;
    const cmv = (await h.db.query<{ version: string }>("SELECT version FROM category_manifest_version WHERE category_key = 'people_payroll_employment' AND is_current")).rows[0]!.version;
    await h.db.query("INSERT INTO category_assessment (instance_id, project_id, category_key, manifest_version, category_origin) VALUES ($1, $2, 'people_payroll_employment', $3, 'pa_detected')", [other, p.projectId, cmv]);
    expect((await request(h.app).get(`/api/precision/categories/${other}/crp`).set(auth(p.projectId))).status).toBe(404);
  });

  it("read-only access reads but cannot write; revoked access reads nothing", async () => {
    const p = await h.newProject();
    const id = p.id("logistics");
    const ro = auth(p.projectId, { "x-test-access": "READ_ONLY" });
    const v = await request(h.app).get(`/api/precision/categories/${id}/crp`).set(ro);
    expect(v.status).toBe(200);
    expect(v.body.canConfirm).toBe(false);
    expect(v.body.canRequestChanges).toBe(false);
    for (const path of ["crp/confirm", "crp/request-changes", "crp/new-version", "send"]) {
      const r = await request(h.app).post(`/api/precision/categories/${id}/${path}`).set(ro).send({ previewChecksum: "a".repeat(64) });
      expect([path, r.status, r.body.error]).toEqual([path, 403, "PRECISION_READ_ONLY"]);
    }
    const rev = auth(p.projectId, { "x-test-access": "REVOKED" });
    expect((await request(h.app).get(`/api/precision/categories/${id}/crp`).set(rev)).body.error).toBe("PRECISION_REVOKED");
    expect((await request(h.app).post(`/api/precision/categories/${id}/crp/confirm`).set(rev).send({})).status).toBe(403);
    expect((await h.db.query<{ lifecycle_status: string }>("SELECT lifecycle_status FROM category_assessment WHERE instance_id = $1", [id])).rows[0]!.lifecycle_status).toBe("in_progress");
  });

  it("rejects an invalid request key", async () => {
    const p = await h.newProject();
    const res = await request(h.app).post(`/api/precision/categories/${p.id("logistics")}/crp/confirm`).set(auth(p.projectId)).send({ requestKey: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_INPUT");
  });
});
