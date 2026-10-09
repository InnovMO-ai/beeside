import request from "supertest";
import { recordFact } from "../../../repository";
import { fillCategory, DEMO_STRATEGIC_FACTS } from "../../seed";
import { createHarness, describeWithDb, type Harness } from "./harness";
import { scanCustomerBody } from "./scan";

const auth = (projectId: string, extra: Record<string, string> = {}): Record<string, string> => ({ "x-test-project": projectId, ...extra });
const count = async (h: Harness, sql: string, args: unknown[]): Promise<number> => Number((await h.db.query<{ n: string }>(sql, args)).rows[0]!.n);
const HOSTILE = new RegExp(`[<>${String.fromCharCode(7)}${String.fromCharCode(0x202e)}]`);
const SHA = /^[0-9a-f]{64}$/;

describeWithDb("Preview and Send (PostgreSQL, simulated Operation Hub, test-only auth)", () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());

  const confirm = (p: { projectId: string }, id: string) => request(h.app).post(`/api/precision/categories/${id}/crp/confirm`).set(auth(p.projectId)).send({});
  const preview = (p: { projectId: string }, id: string, extra: Record<string, string> = {}) => request(h.app).get(`/api/precision/categories/${id}/preview`).set(auth(p.projectId, extra));
  const send = (p: { projectId: string }, id: string, checksum: string, extra: Record<string, string> = {}) =>
    request(h.app).post(`/api/precision/categories/${id}/send`).set(auth(p.projectId, extra)).send({ previewChecksum: checksum });
  const ready = async () => { const p = await h.newProject({ strategicReady: true }); return p; };
  const ledger = (key: string) => h.db.query<{ status: string; attempt: number }>("SELECT status, attempt FROM oh_delivery WHERE idempotency_key = $1 ORDER BY seq", [key]);

  beforeEach(() => { h.spy.payloads.length = 0; h.spy.publishCalls = 0; });

  it("never previews or sends an unconfirmed CRP", async () => {
    const p = await ready();
    const id = p.id("logistics");
    const pv = await preview(p, id);
    expect([pv.status, pv.body.error]).toEqual([409, "NOT_READY"]);
    const sn = await send(p, id, "a".repeat(64));
    expect([sn.status, sn.body.error]).toEqual([409, "NOT_READY"]);
    expect(h.spy.publishCalls).toBe(0);
    expect(await count(h, "SELECT count(*) AS n FROM oh_delivery WHERE project_id = $1", [p.projectId])).toBe(0);
  });

  it("happy path: confirm -> preview -> send; Sent only after acceptance + read-back; pending access until OH is reachable", async () => {
    const p = await ready();
    const id = p.id("logistics");
    await confirm(p, id);
    expect(h.spy.publishCalls).toBe(0); // confirmed is not sent

    const pv = await preview(p, id);
    expect(pv.status).toBe(200);
    expect(pv.body.previewChecksum).toMatch(SHA);
    expect(pv.body).toMatchObject({ categoryId: id, firstSend: true, sendState: "not_sent", canSend: true });
    expect(pv.body.blocks.map((b: { id: string }) => b.id)).toEqual(["project", "service_map", "crp", "context"]);
    expect(pv.body.notSent.length).toBeGreaterThan(2);
    const crpBlock = pv.body.blocks.find((b: { id: string }) => b.id === "crp");
    expect(crpBlock.view.state).toBe("confirmed");
    expect(crpBlock.lines.join("\n")).toMatch(/day-to-day logistics/i);
    expect(pv.body.blocks.find((b: { id: string }) => b.id === "project").lines.join("\n")).toContain("Northwind Foods Ltd");
    expect(pv.body.blocks.find((b: { id: string }) => b.id === "service_map").view.groups.length).toBe(4);
    expect(scanCustomerBody(pv.body)).toEqual([]);

    const sn = await send(p, id, pv.body.previewChecksum);
    expect(sn.status).toBe(200);
    expect(sn.body).toMatchObject({ state: "sent", clientAction: null, retryable: false });
    expect(sn.body.operationHub).toEqual({ state: "pending_access", url: null, contactSherpa: false });
    expect(scanCustomerBody(sn.body)).toEqual([]);
    expect(h.spy.publishCalls).toBe(1);
    expect(h.sim.storedCount()).toBeGreaterThanOrEqual(1);

    // the body that reached the platform is exactly the previewed one
    expect(h.spy.payloads).toHaveLength(1);
    const { payloadChecksum } = await import("../../../ports/operation-hub");
    expect(payloadChecksum(h.spy.payloads[0]!)).toBe(pv.body.previewChecksum);
    expect(h.spy.payloads[0]!.contract.kind).toBe("first_send");

    const after = await preview(p, id);
    expect(after.body).toMatchObject({ sendState: "sent", canSend: false, previewChecksum: pv.body.previewChecksum });
    expect(await count(h, "SELECT count(*) AS n FROM precision_journey_event WHERE project_id = $1 AND event_name = 'handoff_previewed'", [p.projectId])).toBe(1);
    expect(await count(h, "SELECT count(*) AS n FROM precision_journey_event WHERE project_id = $1 AND event_name IN ('operation_hub_send_completed','operation_hub_activated')", [p.projectId])).toBe(2);
    const status = (await h.db.query<{ status: string }>("SELECT status FROM oh_delivery_current WHERE project_id = $1", [p.projectId])).rows[0]!.status;
    expect(status).toBe("delivered");
  });

  it("the payload is a whitelist: no conversation, names, e-mail, FA provenance, internal keys, markup or control characters", async () => {
    const p = await ready();
    const id = p.id("logistics");
    // hostile free text from the client
    await recordFact(h.db, {
      projectId: p.projectId, scopeInstanceId: id, fieldKey: "precision.logistics_flows", valueType: "repeatable_group", answerState: "ANSWERED", source: "category", provenanceStage: "client_answered",
      value: [{ origin_country: "CL", destination_country: "MX", product: "<img src=x onerror=alert(1)>Dry goods" + String.fromCharCode(7, 0x202e) + "<script>x</script>", volume: { value: 5, unit: "pallets" }, frequency: "monthly", mode_of_transport: "ocean" }],
    });
    await confirm(p, id);
    const pv = await preview(p, id);
    await send(p, id, pv.body.previewChecksum);
    const payload = h.spy.payloads[0]!;
    const json = JSON.stringify(payload);
    expect(Object.keys(payload).sort()).toEqual(["artifact", "company_context", "contract", "identity", "project_context", "provenance", "workstream"]);
    expect(Object.keys(payload.artifact).sort()).toEqual(["crp_artifact_id", "crp_id", "crp_version", "structured"]);
    expect(Object.keys(payload.company_context)).toEqual(["display_name"]);
    expect(json).not.toMatch(/@|source_result_id|delivered_view_reference|person_id|prompt|conversation|logistics_flows|logistics_|precision\.|context_pin|contextHash|"id":/);
    expect(json).not.toMatch(/Demo|Contact/); // person names
    expect(json).not.toMatch(HOSTILE);
    expect(json).toContain("Dry goods");
    expect(JSON.stringify(pv.body)).not.toMatch(HOSTILE);
    expect(payload.identity.project_id).toBe(p.projectId);
    expect(payload.provenance).toMatchObject({ crp_version: 1, psm_version: 1 });
  });

  it("Spanish preview: titles and labels in Spanish, still no internal terms", async () => {
    const p = await ready();
    const id = p.id("logistics");
    await request(h.app).post(`/api/precision/categories/${id}/crp/confirm`).set(auth(p.projectId, { "x-precision-locale": "es" })).send({});
    const pv = await preview(p, id, { "x-precision-locale": "es" });
    expect(pv.status).toBe(200);
    expect(pv.body.blocks[0].title).toBe("Tu proyecto");
    expect(pv.body.notSent[0]).toMatch(/Tu conversación/);
    expect(pv.body.blocks.find((b: { id: string }) => b.id === "crp").title).toContain("Category Requirement Pack (CRP)");
    expect(scanCustomerBody(pv.body)).toEqual([]);
  });

  it("stale preview: a change after the preview is refused with PREVIEW_STALE; a fresh preview works and sends", async () => {
    const p = await ready();
    const id = p.id("logistics");
    await confirm(p, id);
    const old = await preview(p, id);
    // the client starts a new version, changes an answer and confirms again
    await request(h.app).post(`/api/precision/categories/${id}/crp/new-version`).set(auth(p.projectId)).send({});
    await recordFact(h.db, { projectId: p.projectId, scopeInstanceId: id, fieldKey: "precision.logistics_insurance_coverage_status", value: "covered", valueType: "enum", answerState: "ANSWERED", source: "category", provenanceStage: "client_answered" });
    await confirm(p, id);

    const stale = await send(p, id, old.body.previewChecksum);
    expect([stale.status, stale.body.error, stale.body.retryable]).toEqual([409, "PREVIEW_STALE", false]);
    expect(scanCustomerBody(stale.body)).toEqual([]);
    expect(h.spy.publishCalls).toBe(0);
    expect(await count(h, "SELECT count(*) AS n FROM oh_delivery WHERE project_id = $1", [p.projectId])).toBe(0);

    const fresh = await preview(p, id);
    expect(fresh.body.previewChecksum).not.toBe(old.body.previewChecksum);
    const ok = await send(p, id, fresh.body.previewChecksum);
    expect(ok.body.state).toBe("sent");
    expect(h.spy.payloads[0]!.provenance.crp_version).toBe(2);
  });

  it("a change to the confirmed My Service Map or the company invalidates the checksum too", async () => {
    const p = await ready();
    const id = p.id("logistics");
    await confirm(p, id);
    const a = await preview(p, id);
    await h.db.query("UPDATE company SET name = name || ' Group' WHERE company_id = $1", [p.companyId]);
    const b = await preview(p, id);
    expect(b.body.previewChecksum).not.toBe(a.body.previewChecksum);
    expect((await send(p, id, a.body.previewChecksum)).body.error).toBe("PREVIEW_STALE");
    expect((await send(p, id, b.body.previewChecksum)).body.state).toBe("sent");
  });

  it("rejects a malformed checksum or request key", async () => {
    const p = await ready();
    const id = p.id("logistics");
    await confirm(p, id);
    expect((await send(p, id, "nope")).body.error).toBe("INVALID_INPUT");
    const r = await request(h.app).post(`/api/precision/categories/${id}/send`).set(auth(p.projectId)).send({ previewChecksum: "a".repeat(64), requestKey: "x" });
    expect(r.status).toBe(400);
  });

  it("duplicate click / double submit race: exactly one delivery reaches the platform", async () => {
    const p = await ready();
    const id = p.id("logistics");
    await confirm(p, id);
    const pv = await preview(p, id);
    const rs = await Promise.all(Array.from({ length: 6 }, () => send(p, id, pv.body.previewChecksum)));
    expect(rs.map((r) => r.status)).toEqual(Array(6).fill(200));
    expect(rs.map((r) => r.body.state)).toEqual(Array(6).fill("sent"));
    expect(h.spy.publishCalls).toBe(1);
    const key = h.spy.payloads[0]!.contract.idempotency_key;
    expect((await ledger(key)).rows.filter((r) => r.status === "delivered")).toHaveLength(1);
    expect(await count(h, "SELECT count(*) AS n FROM precision_journey_event WHERE project_id = $1 AND event_name = 'operation_hub_send_completed'", [p.projectId])).toBe(1);
    expect(await count(h, "SELECT count(*) AS n FROM precision_journey_event WHERE project_id = $1 AND event_name = 'operation_hub_activated'", [p.projectId])).toBe(1);
  });

  it("lost response: retrying after a delivered send returns the same result without a second effect, even with an outdated checksum", async () => {
    const p = await ready();
    const id = p.id("logistics");
    await confirm(p, id);
    const pv = await preview(p, id);
    const first = await send(p, id, pv.body.previewChecksum);
    const again = await send(p, id, pv.body.previewChecksum);
    const outdated = await send(p, id, "b".repeat(64));
    expect(again.body).toEqual(first.body);
    expect([outdated.status, outdated.body.state]).toEqual([200, "sent"]);
    expect(h.spy.publishCalls).toBe(1);
  });

  it("acknowledgement lost after the platform stored it (timeout): resolved by read-back, sent once", async () => {
    const p = await ready();
    const id = p.id("logistics");
    await confirm(p, id);
    const pv = await preview(p, id);
    h.sim.timeoutAfterStore();
    const res = await send(p, id, pv.body.previewChecksum);
    expect(res.body.state).toBe("sent");
    expect(h.spy.publishCalls).toBe(1);
    expect((await ledger(h.spy.payloads[0]!.contract.idempotency_key)).rows.map((r) => r.status)).toEqual(["queued", "delivered"]);
  });

  it("platform unavailable: a friendly failure with no technical text, then Try again -> sent (same key, next attempt)", async () => {
    const p = await ready();
    const id = p.id("logistics");
    await confirm(p, id);
    const pv = await preview(p, id);
    h.sim.unavailableBeforeStore(); h.sim.unavailableBeforeStore(); h.sim.unavailableBeforeStore();
    const failed = await send(p, id, pv.body.previewChecksum);
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ state: "failed", clientAction: "try_again_later", retryable: true });
    expect(JSON.stringify(failed.body)).not.toMatch(/UNAVAILABLE|platform|timeout|error/i);
    expect(scanCustomerBody(failed.body)).toEqual([]);

    const pv2 = await preview(p, id);
    expect(pv2.body).toMatchObject({ sendState: "failed", clientAction: "try_again_later", retryable: true, canSend: true });
    expect(pv2.body.previewChecksum).toBe(pv.body.previewChecksum);
    expect(pv2.body.firstSend).toBe(true);

    const ok = await send(p, id, pv2.body.previewChecksum);
    expect(ok.body.state).toBe("sent");
    const key = h.spy.payloads[0]!.contract.idempotency_key;
    const rows = (await ledger(key)).rows;
    expect(rows.filter((r) => r.status === "delivered")).toHaveLength(1);
    expect(Math.max(...rows.map((r) => r.attempt))).toBe(2);
    expect(h.sim.storedCount()).toBeGreaterThanOrEqual(1);
  });

  it("a refused delivery is reported as needing attention and is not offered as retryable", async () => {
    const p = await ready();
    const id = p.id("logistics");
    await confirm(p, id);
    const pv = await preview(p, id);
    h.sim.rejectNext();
    const res = await send(p, id, pv.body.previewChecksum);
    expect(res.body).toMatchObject({ state: "failed", clientAction: "needs_attention", retryable: false });
    expect(JSON.stringify(res.body)).not.toMatch(/REJECTED|validation/i);
    const pv2 = await preview(p, id);
    expect(pv2.body).toMatchObject({ sendState: "failed", clientAction: "needs_attention", retryable: false });
  });

  it("the first send gates the others: while it has not succeeded another CRP is refused (ACTIVATION_PENDING_RETRY_FIRST); then both go", async () => {
    const p = await ready();
    const a = p.id("logistics");
    const b = p.id("strategic_advisory");
    await confirm(p, a);
    await confirm(p, b);
    const pa = await preview(p, a);
    h.sim.unavailableBeforeStore(); h.sim.unavailableBeforeStore(); h.sim.unavailableBeforeStore();
    expect((await send(p, a, pa.body.previewChecksum)).body.state).toBe("failed");

    const pb = await preview(p, b);
    expect(pb.body).toMatchObject({ canSend: false, blockedReason: "first_send_required", sendState: "not_sent", firstSend: false });
    const blocked = await send(p, b, pb.body.previewChecksum);
    expect([blocked.status, blocked.body.error]).toEqual([409, "ACTIVATION_PENDING_RETRY_FIRST"]);
    expect(scanCustomerBody(blocked.body)).toEqual([]);
    expect(h.spy.publishCalls).toBe(3); // only the first CRP's attempts reached the platform

    // a new version of the first CRP is not a way around the gate
    const nv = await request(h.app).post(`/api/precision/categories/${a}/crp/new-version`).set(auth(p.projectId)).send({});
    expect([nv.status, nv.body.error]).toEqual([409, "ACTIVATION_PENDING_RETRY_FIRST"]);

    expect((await send(p, a, pa.body.previewChecksum)).body.state).toBe("sent");
    const pb2 = await preview(p, b);
    expect(pb2.body).toMatchObject({ canSend: true, firstSend: false });
    expect(pb2.body.blockedReason).toBeUndefined();
    expect((await send(p, b, pb2.body.previewChecksum)).body.state).toBe("sent");
    expect(h.spy.payloads.at(-1)!.contract.kind).toBe("crp");
    // the activation event exists once per project
    expect(await count(h, "SELECT count(*) AS n FROM precision_journey_event WHERE project_id = $1 AND event_name = 'operation_hub_activated'", [p.projectId])).toBe(1);
    expect(await count(h, "SELECT count(*) AS n FROM precision_journey_event WHERE project_id = $1 AND event_name = 'operation_hub_send_completed'", [p.projectId])).toBe(2);
  });

  it("concurrent sends of two different CRPs: both are accepted in order, nothing is duplicated", async () => {
    const p = await ready();
    const a = p.id("logistics");
    const b = p.id("strategic_advisory");
    await confirm(p, a);
    await confirm(p, b);
    const [pa, pb] = await Promise.all([preview(p, a), preview(p, b)]);
    const rs = await Promise.all([send(p, a, pa.body.previewChecksum), send(p, b, pb.body.previewChecksum)]);
    // Whichever got the lock first is the activating send. The other one is either sent (it ran second and its Preview was still
    // current), refused because the first send is not complete yet, or told to review its Preview again: the "first send" wording
    // of a Preview ceases to apply once another category has been sent. Every refusal is safe to follow by reopening the Preview.
    const outcome = (r: (typeof rs)[number]): string => (r.status === 200 ? r.body.state : r.body.error);
    const allowed = ["sent", "ACTIVATION_PENDING_RETRY_FIRST", "PREVIEW_STALE"];
    const summary = JSON.stringify(rs.map((r) => [r.status, outcome(r)]));
    if (!rs.every((r) => allowed.includes(outcome(r)))) throw new Error(`unexpected concurrent send outcome ${summary} ${h.logs.slice(-3).join(" | ")}`);
    expect(rs.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    const ids: Array<[string, (typeof rs)[number]]> = [[a, rs[0]!], [b, rs[1]!]];
    for (const [id, r] of ids) {
      if (r.status === 200) continue;
      const again = await preview(p, id);
      expect(again.status).toBe(200);
      expect((await send(p, id, again.body.previewChecksum)).body.state).toBe("sent");
    }
    expect(await count(h, "SELECT count(*) AS n FROM oh_delivery WHERE project_id = $1 AND status = 'delivered'", [p.projectId])).toBe(2);
    expect(await count(h, "SELECT count(*) AS n FROM (SELECT idempotency_key FROM oh_delivery WHERE project_id = $1 AND status = 'delivered' GROUP BY 1 HAVING count(*) > 1) d", [p.projectId])).toBe(0);
  });

  it("read-only access can preview but not send; the platform is never called", async () => {
    const p = await ready();
    const id = p.id("logistics");
    await confirm(p, id);
    const ro = { "x-test-access": "READ_ONLY" };
    const pv = await preview(p, id, ro);
    expect(pv.status).toBe(200);
    expect(pv.body.canSend).toBe(false);
    const res = await send(p, id, pv.body.previewChecksum, ro);
    expect([res.status, res.body.error]).toEqual([403, "PRECISION_READ_ONLY"]);
    expect(h.spy.publishCalls).toBe(0);
    expect(await count(h, "SELECT count(*) AS n FROM precision_journey_event WHERE project_id = $1 AND event_name = 'handoff_previewed'", [p.projectId])).toBe(0);
  });

  it("while a new version is being prepared the previous pack cannot be sent, but a delivered one still answers sent", async () => {
    const p = await ready();
    const id = p.id("logistics");
    await confirm(p, id);
    const pv = await preview(p, id);
    await request(h.app).post(`/api/precision/categories/${id}/crp/new-version`).set(auth(p.projectId)).send({});
    expect((await send(p, id, pv.body.previewChecksum)).body.error).toBe("NOT_READY");
    expect((await preview(p, id)).body.error).toBe("NOT_READY");
  });

  it("after the first send, 'Go to Operation Hub' and Sherpa contact follow the platform's real state", async () => {
    const h2 = await createHarness({ accessAfterFirstSend: "accessible_with_sherpa" });
    try {
      await h2.db.query(`INSERT INTO precision_config (key, locale, value) VALUES ('operation_hub_url', '*', '"https://hub.example/enter"'::jsonb) ON CONFLICT DO NOTHING`);
      const p = await h2.newProject();
      const id = p.id("logistics");
      await request(h2.app).post(`/api/precision/categories/${id}/crp/confirm`).set(auth(p.projectId)).send({});
      const pv = await request(h2.app).get(`/api/precision/categories/${id}/preview`).set(auth(p.projectId));
      const res = await request(h2.app).post(`/api/precision/categories/${id}/send`).set(auth(p.projectId)).send({ previewChecksum: pv.body.previewChecksum });
      expect(res.body.state).toBe("sent");
      expect(res.body.operationHub.state).toBe("enter");
      expect(res.body.operationHub.contactSherpa).toBe(true);
      expect(res.body.operationHub.url === "https://hub.example/enter" || res.body.operationHub.url === null).toBe(true);
    } finally {
      await h2.close();
    }
  });

  it("unexpected server errors never leak: generic localized message, no internals", async () => {
    const p = await ready();
    const id = p.id("logistics");
    await confirm(p, id);
    const pv = await preview(p, id);
    const original = h.deps.delivery.send.bind(h.deps.delivery);
    (h.deps.delivery as unknown as { send: unknown }).send = async () => { throw new Error("connection to 10.0.0.5:5432 refused (secret=abc123)"); };
    try {
      const res = await send(p, id, pv.body.previewChecksum);
      expect([res.status, res.body.error, res.body.retryable]).toEqual([503, "TEMPORARILY_UNAVAILABLE", true]);
      expect(JSON.stringify(res.body)).not.toMatch(/10\.0|secret|connection/);
      expect(h.logs.join("\n")).not.toContain("abc123");
    } finally {
      (h.deps.delivery as unknown as { send: unknown }).send = original;
    }
  });

  it("only the client-confirmed Strategic Advisory structure travels as such (crp kind)", async () => {
    const p = await ready();
    const id = p.id("strategic_advisory");
    await confirm(p, id);
    const pv = await preview(p, id);
    expect(pv.status).toBe(200);
    const sn = await send(p, id, pv.body.previewChecksum);
    expect(sn.body.state).toBe("sent");
    expect(h.spy.payloads[0]!.workstream.crp_kind).toBe("strategic_advisory");
    void fillCategory; void DEMO_STRATEGIC_FACTS;
  });
});
