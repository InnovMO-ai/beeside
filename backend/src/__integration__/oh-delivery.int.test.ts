import { Pool } from "pg";
import { createPoolDb, Db } from "../db/database";
import { SimulatedOperationHub } from "../precision/adapters/simulator-operation-hub";
import { decodeOhReference, ohIdempotencyKey, OhDeliveryService, SendInput } from "../precision/delivery/oh-delivery-service";
import { OhAcceptance, OhHandoffPayload, OhPortError, OperationHubPort, payloadChecksum } from "../precision/ports/operation-hub";
import { makeClickUpHarness } from "../__tests__/helpers/clickup-harness";
import { samplePayload } from "../__tests__/helpers/oh-conformance";
import { PrecisionFixture, setupPrecisionFixture } from "../__tests__/helpers/precision-fixtures";
import { describeWithDb, databaseUrl } from "./fa-harness";

/** Counts what actually reaches the platform, whatever it answers. */
class SpyPort implements OperationHubPort {
  publishCalls = 0;
  verifyCalls = 0;
  constructor(private readonly inner: OperationHubPort) {}
  describe() { return this.inner.describe(); }
  async publish(p: OhHandoffPayload): Promise<OhAcceptance> { this.publishCalls += 1; return this.inner.publish(p); }
  async verify(k: string) { this.verifyCalls += 1; return this.inner.verify(k); }
  accessState(projectId: string) { return this.inner.accessState(projectId); }
}

describeWithDb("OhDeliveryService (PostgreSQL, committed rows in a scratch database)", () => {
  let pool: Pool;
  let db: Db;
  let fx: PrecisionFixture;
  const sleeps: number[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 8 });
    db = createPoolDb(pool);
    fx = await setupPrecisionFixture(db);
  });
  afterAll(() => pool.end());
  beforeEach(() => { sleeps.length = 0; });

  const service = (port: OperationHubPort, retry = {}) =>
    new OhDeliveryService({ db, port, retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100, ...retry }, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5 });

  async function crp(projectId: string, companyId: string, categoryKey: "logistics" | "hr" = "logistics", version = 1, kind: "first_send" | "crp" = "first_send") {
    const packId = await fx.newPack(projectId, categoryKey);
    return { packId, ...input(projectId, companyId, packId, version, kind, categoryKey) };
  }
  function input(projectId: string, companyId: string, packId: string, version: number, kind: "first_send" | "crp" = "first_send", label = "logistics"): SendInput & { key: string } {
    const key = ohIdempotencyKey({ projectId, kind: "crp", artifactId: packId, artifactVersion: version });
    const payload = samplePayload({ key, kind, project: projectId });
    payload.identity = { company_id: companyId, project_id: projectId };
    payload.workstream = { ...payload.workstream, category_key: label, category_label: label === "hr" ? "People" : "Logistics" };
    payload.artifact = { ...payload.artifact, crp_version: version };
    return { projectId, kind: "crp", packId, artifactVersion: version, payload, key };
  }
  const rows = async (key: string) => (await db.query<{ status: string; attempt: number; error_code: string | null; oh_reference: string | null }>(
    "SELECT status, attempt, error_code, oh_reference FROM oh_delivery WHERE idempotency_key = $1 ORDER BY seq", [key])).rows;

  it("happy path: queued then delivered, compact reference, state sent only after acceptance", async () => {
    const { projectId, companyId } = await fx.newProject();
    const sim = new SimulatedOperationHub();
    const svc = service(sim);
    const i = await crp(projectId, companyId);
    const r = await svc.send(i);
    expect(r.state).toBe("sent");
    expect(decodeOhReference(r.reference!)).toMatchObject({ taskId: expect.stringMatching(/^task_/) });
    expect(r.reference).not.toContain("{");
    expect((await rows(i.key)).map((x) => `${x.status}:${x.attempt}`)).toEqual(["queued:1", "delivered:1"]);
    expect(sim.storedCount()).toBe(1);
  });

  it("duplicate click: a delivered key returns the stored result without calling the port", async () => {
    const { projectId, companyId } = await fx.newProject();
    const spy = new SpyPort(new SimulatedOperationHub());
    const svc = service(spy);
    const i = await crp(projectId, companyId);
    const first = await svc.send(i);
    const again = await svc.send(i);
    expect(again).toMatchObject({ state: "sent", alreadySent: true, reference: first.reference });
    expect(spy.publishCalls).toBe(1);
    expect(await rows(i.key)).toHaveLength(2);
  });

  it("concurrent double send: two parallel calls produce one publish and one delivered row", async () => {
    const { projectId, companyId } = await fx.newProject();
    const sim = new SimulatedOperationHub();
    const spy = new SpyPort(sim);
    const svc = service(spy);
    const i = await crp(projectId, companyId);
    const [a, b] = await Promise.all([svc.send(i), svc.send(i)]);
    expect([a.state, b.state]).toEqual(["sent", "sent"]);
    expect([a.alreadySent, b.alreadySent].filter(Boolean)).toHaveLength(1);
    expect(spy.publishCalls).toBe(1);
    expect(sim.storedCount()).toBe(1);
    expect((await rows(i.key)).filter((x) => x.status === "delivered")).toHaveLength(1);
  });

  it("concurrent sends from two service instances (two processes) are serialised by the database lock", async () => {
    const { projectId, companyId } = await fx.newProject();
    const sim = new SimulatedOperationHub();
    const spyA = new SpyPort(sim), spyB = new SpyPort(sim);
    const i = await crp(projectId, companyId);
    await Promise.all([service(spyA).send(i), service(spyB).send(i)]);
    expect(spyA.publishCalls + spyB.publishCalls).toBe(1);
    expect(sim.storedCount()).toBe(1);
  });

  it("timeout after the platform stored the delivery is resolved by read-back: sent, no duplicate", async () => {
    const { projectId, companyId } = await fx.newProject();
    const sim = new SimulatedOperationHub();
    const spy = new SpyPort(sim);
    sim.timeoutAfterStore();
    const i = await crp(projectId, companyId);
    const r = await service(spy).send(i);
    expect(r.state).toBe("sent");
    expect(spy.publishCalls).toBe(1);
    expect(spy.verifyCalls).toBe(1);
    expect(sim.storedCount()).toBe(1);
    expect((await rows(i.key)).map((x) => x.status)).toEqual(["queued", "delivered"]);
  });

  it("unavailable then success: retried within the policy, one queued row, one publish stored", async () => {
    const { projectId, companyId } = await fx.newProject();
    const sim = new SimulatedOperationHub();
    sim.unavailableBeforeStore();
    const i = await crp(projectId, companyId);
    const r = await service(sim).send(i);
    expect(r.state).toBe("sent");
    expect(sleeps).toEqual([5]);
    expect((await rows(i.key)).map((x) => x.status)).toEqual(["queued", "delivered"]);
  });

  it("permanent rejection: failed row with the taxonomy code, calm client category, no technical code in the result", async () => {
    const { projectId, companyId } = await fx.newProject();
    const sim = new SimulatedOperationHub();
    sim.rejectNext();
    const spy = new SpyPort(sim);
    const i = await crp(projectId, companyId);
    const r = await service(spy).send(i);
    expect(r).toMatchObject({ state: "failed", clientCategory: "needs_attention", canRetry: false });
    expect(JSON.stringify(r)).not.toMatch(/REJECTED|VALIDATION/);
    expect(spy.publishCalls).toBe(1); // not retried
    expect(await rows(i.key)).toMatchObject([{ status: "queued" }, { status: "failed", error_code: "REJECTED_VALIDATION" }]);
  });

  it("retryable errors exhausted: failed; the user can retry the same key later as a new attempt", async () => {
    const { projectId, companyId } = await fx.newProject();
    const sim = new SimulatedOperationHub();
    for (let n = 0; n < 3; n++) sim.unavailableBeforeStore();
    const svc = service(sim);
    const i = await crp(projectId, companyId);
    const failed = await svc.send(i);
    expect(failed).toMatchObject({ state: "failed", clientCategory: "try_again_later", canRetry: true, attempt: 1 });
    expect(sim.storedCount()).toBe(0);
    const retried = await svc.send(i);
    expect(retried).toMatchObject({ state: "sent", attempt: 2 });
    expect((await rows(i.key)).map((x) => `${x.status}:${x.attempt}${x.error_code ? ":" + x.error_code : ""}`)).toEqual([
      "queued:1", "failed:1:UNAVAILABLE", "queued:2", "delivered:2",
    ]);
  });

  it("a port that answers with a different checksum is never reported as sent", async () => {
    const { projectId, companyId } = await fx.newProject();
    const lying: OperationHubPort = {
      describe: () => new SimulatedOperationHub().describe(),
      publish: async (p) => ({ reference: { taskId: "t1" }, checksum: "0".repeat(64), contractVersion: "1.1", acceptedAt: new Date().toISOString(), replayed: false, ...(p ? {} : {}) }),
      verify: async () => ({ found: false }),
      accessState: async () => ({ provisioned: true, clientAccessible: true, sherpaAssigned: true }),
    };
    const i = await crp(projectId, companyId);
    const r = await service(lying).send(i);
    expect(r.state).toBe("failed");
    expect(await rows(i.key)).toMatchObject([{ status: "queued" }, { status: "failed", error_code: "CHECKSUM_MISMATCH" }]);
  });

  it("unknown outcome whose read-back shows different content is a failure, not a delivery", async () => {
    const { projectId, companyId } = await fx.newProject();
    const port: OperationHubPort = {
      describe: () => new SimulatedOperationHub().describe(),
      publish: async () => { throw new OhPortError("TIMEOUT", "no ack", { outcomeUnknown: true }); },
      verify: async () => ({ found: true, reference: { taskId: "t9" }, checksum: "f".repeat(64) }),
      accessState: async () => ({ provisioned: true, clientAccessible: false, sherpaAssigned: false }),
    };
    const i = await crp(projectId, companyId);
    expect((await service(port).send(i)).state).toBe("failed");
    expect((await rows(i.key)).at(-1)?.error_code).toBe("CHECKSUM_MISMATCH");
  });

  it("first send failed: a different artifact is blocked until the first succeeds; then it goes through", async () => {
    const { projectId, companyId } = await fx.newProject();
    const sim = new SimulatedOperationHub();
    const spy = new SpyPort(sim);
    const svc = service(spy);
    const a = await crp(projectId, companyId, "logistics");
    const b = await crp(projectId, companyId, "hr", 1, "crp");
    sim.rejectNext();
    expect((await svc.send(a)).state).toBe("failed");
    const blocked = await svc.send(b);
    expect(blocked).toMatchObject({ state: "blocked", clientCategory: "first_send_required" });
    expect(spy.publishCalls).toBe(1);
    expect(await rows(b.key)).toHaveLength(0); // nothing attempted, nothing in the ledger
    expect((await svc.send(a)).state).toBe("sent"); // the same artifact may be retried
    expect((await svc.send(b)).state).toBe("sent");
  });

  it("a PSM update before the project is provisioned is blocked", async () => {
    const { projectId, companyId } = await fx.newProject();
    const sim = new SimulatedOperationHub();
    const snapshotId = await fx.newSnapshot(projectId);
    const key = ohIdempotencyKey({ projectId, kind: "psm", artifactId: snapshotId, artifactVersion: 1 });
    const payload = samplePayload({ key, kind: "psm_update", project: projectId });
    payload.identity = { company_id: companyId, project_id: projectId };
    const r = await service(sim).send({ projectId, kind: "psm", snapshotId, artifactVersion: 1, payload });
    expect(r.state).toBe("blocked");
    expect(sim.storedCount()).toBe(0);
    expect(await rows(key)).toHaveLength(0);
  });

  it("a changed artifact version has a distinct key and a distinct delivery", async () => {
    const { projectId, companyId } = await fx.newProject();
    const sim = new SimulatedOperationHub();
    const svc = service(sim);
    const v1 = await crp(projectId, companyId, "logistics", 1);
    expect((await svc.send(v1)).state).toBe("sent");
    const v2 = input(projectId, companyId, v1.packId, 2, "crp");
    expect(v2.key).not.toBe(v1.key);
    const r2 = await svc.send(v2);
    expect(r2).toMatchObject({ state: "sent" });
    expect(r2.alreadySent).toBeUndefined();
    expect(sim.storedCount()).toBe(2);
  });

  it("the ledger is append-only: rows are never updated or deleted", async () => {
    const { projectId, companyId } = await fx.newProject();
    const i = await crp(projectId, companyId);
    await service(new SimulatedOperationHub()).send(i);
    await expect(db.query("UPDATE oh_delivery SET status = 'failed', error_code = 'X' WHERE idempotency_key = $1", [i.key])).rejects.toMatchObject({ code: "BV409" });
    await expect(db.query("DELETE FROM oh_delivery WHERE idempotency_key = $1", [i.key])).rejects.toMatchObject({ code: "BV409" });
    expect(await rows(i.key)).toHaveLength(2);
  });

  it("refuses inconsistent input before touching the ledger or the platform", async () => {
    const { projectId, companyId } = await fx.newProject();
    const sim = new SimulatedOperationHub();
    const svc = service(sim);
    const i = await crp(projectId, companyId);
    await expect(svc.send({ ...i, artifactVersion: 2 })).rejects.toThrow(/idempotency_key/);
    await expect(svc.send({ ...i, projectId: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow();
    expect(sim.storedCount()).toBe(0);
  });

  describe("getSendState (UX rules)", () => {
    it("before the first send: Operation Hub hidden, no Sherpa", async () => {
      const { projectId } = await fx.newProject();
      const s = await service(new SimulatedOperationHub()).getSendState(projectId);
      expect(s).toMatchObject({ firstSendDone: false, ux: { goToOperationHub: "hidden", contactMySherpa: false } });
      expect(s.lastDelivery).toBeUndefined();
    });

    it("after acceptance but before client access: pending-access notice, no Sherpa", async () => {
      const { projectId, companyId } = await fx.newProject();
      const svc = service(new SimulatedOperationHub());
      await svc.send(await crp(projectId, companyId));
      const s = await svc.getSendState(projectId);
      expect(s).toMatchObject({ firstSendDone: true, lastDelivery: { status: "delivered" }, ux: { goToOperationHub: "pending_access", contactMySherpa: false } });
    });

    it("client can enter, Sherpa not yet assigned: enter, still no Sherpa", async () => {
      const { projectId, companyId } = await fx.newProject();
      const svc = service(new SimulatedOperationHub({ accessAfterFirstSend: "accessible_without_sherpa" }));
      await svc.send(await crp(projectId, companyId));
      expect((await svc.getSendState(projectId)).ux).toEqual({ goToOperationHub: "enter", contactMySherpa: false });
    });

    it("provisioned + accessible + Sherpa assigned: contact my Sherpa", async () => {
      const { projectId, companyId } = await fx.newProject();
      const svc = service(new SimulatedOperationHub({ accessAfterFirstSend: "accessible_with_sherpa" }));
      await svc.send(await crp(projectId, companyId));
      expect((await svc.getSendState(projectId)).ux).toEqual({ goToOperationHub: "enter", contactMySherpa: true });
    });

    it("a failed first send keeps the Hub hidden; a later failed send never degrades a provisioned project", async () => {
      const { projectId, companyId } = await fx.newProject();
      const sim = new SimulatedOperationHub();
      const svc = service(sim, { maxAttempts: 1 });
      const a = await crp(projectId, companyId, "logistics");
      sim.unavailableBeforeStore();
      expect((await svc.send(a)).state).toBe("failed");
      expect((await svc.getSendState(projectId)).ux.goToOperationHub).toBe("hidden");
      expect((await svc.send(a)).state).toBe("sent");
      const b = await crp(projectId, companyId, "hr", 1, "crp");
      sim.unavailableBeforeStore();
      expect((await svc.send(b)).state).toBe("failed");
      const s = await svc.getSendState(projectId);
      expect(s).toMatchObject({ firstSendDone: true, lastDelivery: { status: "failed" }, ux: { goToOperationHub: "pending_access" } });
    });

    it("if the platform cannot be asked, only what the ledger proves is reported", async () => {
      const { projectId, companyId } = await fx.newProject();
      const sim = new SimulatedOperationHub({ accessAfterFirstSend: "accessible_with_sherpa" });
      const flaky: OperationHubPort = { describe: () => sim.describe(), publish: (p) => sim.publish(p), verify: (k) => sim.verify(k), accessState: async () => { throw new Error("down"); } };
      const svc = service(flaky);
      await svc.send(await crp(projectId, companyId));
      expect(await svc.getSendState(projectId)).toMatchObject({ ohAccess: { provisioned: true, clientAccessible: false, sherpaAssigned: false }, ux: { contactMySherpa: false } });
    });
  });

  describe("end to end with the ClickUp adapter against the local fake", () => {
    it("send -> sent; lost acknowledgement is recovered by read-back with a single task; duplicate click publishes nothing", async () => {
      const { projectId, companyId } = await fx.newProject();
      const h = makeClickUpHarness();
      h.server.injector(1).timeoutAfterStore();
      const spy = new SpyPort(h.port);
      const svc = service(spy);
      const i = await crp(projectId, companyId);
      const r = await svc.send(i);
      expect(r.state).toBe("sent");
      expect(h.server.taskCount()).toBe(1);
      expect(spy.verifyCalls).toBe(1);
      expect(decodeOhReference(r.reference!).taskId).toBeTruthy();
      const before = h.server.log.length;
      expect((await svc.send(i)).alreadySent).toBe(true);
      expect(h.server.log.length).toBe(before);
      const state = await svc.getSendState(projectId);
      expect(state.ux).toEqual({ goToOperationHub: "pending_access", contactMySherpa: false });
    });

    it("platform down: failed with a calm category; payload checksum helper agrees with the stored ledger reference after retry", async () => {
      const { projectId, companyId } = await fx.newProject();
      const h = makeClickUpHarness();
      h.server.injector(3).unavailableBeforeStore();
      const svc = service(h.port);
      const i = await crp(projectId, companyId);
      const failed = await svc.send(i);
      expect(failed).toMatchObject({ state: "failed", clientCategory: "try_again_later" });
      const ok = await svc.send(i);
      expect(ok).toMatchObject({ state: "sent", attempt: 2 });
      expect((await h.port.verify(i.key)).checksum).toBe(payloadChecksum(i.payload));
    });
  });
});
