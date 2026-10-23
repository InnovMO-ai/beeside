import { OhFaultInjector } from "../../precision/adapters/simulator-operation-hub";
import {
  OhHandoffPayload,
  OhPortError,
  OperationHubPort,
  payloadChecksum,
} from "../../precision/ports/operation-hub";

/**
 * Conformance suite for any OperationHubPort implementation. The SAME suite runs against the
 * simulator and the ClickUp adapter, which is what guarantees that swapping implementations needs
 * no change in Precision or in the customer experience. `faults` is optional: an adapter test
 * harness that can emulate platform failures provides it, enabling the failure-mode checks.
 */
export interface OhConformanceSubject {
  port: OperationHubPort;
  faults?: OhFaultInjector;
  /** Number of deliveries the platform actually holds (duplicate-protection assertions). */
  storedCount?: () => number;
}

let counter = 0;
export function samplePayload(overrides: { key?: string; kind?: OhHandoffPayload["contract"]["kind"]; project?: string; note?: string } = {}): OhHandoffPayload {
  counter += 1;
  const key = overrides.key ?? `proj-${counter}:crp:pack-${counter}:1`;
  const project = overrides.project ?? "00000000-0000-4000-8000-0000000000a1";
  return {
    contract: {
      oh_contract_version: "1.1",
      delivery_id: `del-${counter}`,
      idempotency_key: key,
      kind: overrides.kind ?? "first_send",
      sent_at: new Date(Date.UTC(2026, 9, 13, 10, 0, counter)).toISOString(),
    },
    identity: { company_id: "00000000-0000-4000-8000-0000000000c1", project_id: project },
    company_context: { display_name: "Synthetic Co", note: overrides.note ?? "a" },
    project_context: { psm: { objectives: ["Enter a new market"], categories: ["logistics"] } },
    workstream: { workstream_id: "ws-1", category_key: "logistics", category_label: "Logistics", crp_kind: "operational" },
    artifact: { crp_id: "crp-1", crp_artifact_id: "crpa-1", crp_version: 1, structured: { requirements: [{ id: "r1", value: 10 }] } },
    provenance: { psm_version: 1, psm_confirmed_at: "2026-10-12T09:00:00.000Z", crp_version: 1, crp_created_at: "2026-10-12T09:30:00.000Z", oh_contract_version: "1.1" },
  };
}

export function ohPortConformance(name: string, make: () => OhConformanceSubject): void {
  describe(`OperationHubPort conformance — ${name}`, () => {
    it("accepts a delivery and returns a stable reference and a matching checksum", async () => {
      const { port } = make();
      const payload = samplePayload();
      const acceptance = await port.publish(payload);
      expect(acceptance.replayed).toBe(false);
      expect(acceptance.checksum).toBe(payloadChecksum(payload));
      expect(acceptance.contractVersion).toBe("1.1");
      expect(Object.values(acceptance.reference).some(Boolean)).toBe(true);
    });

    it("is idempotent: the same key returns the same reference and creates nothing new", async () => {
      const { port, storedCount } = make();
      const payload = samplePayload();
      const first = await port.publish(payload);
      const again = await port.publish({ ...payload, contract: { ...payload.contract, sent_at: "2026-10-13T11:00:00.000Z" } });
      expect(again.replayed).toBe(true);
      expect(again.reference).toEqual(first.reference);
      expect(again.checksum).toBe(first.checksum);
      if (storedCount) expect(storedCount()).toBe(1);
    });

    it("refuses an existing key reused with different content", async () => {
      const { port } = make();
      const payload = samplePayload();
      await port.publish(payload);
      await expect(port.publish(samplePayload({ key: payload.contract.idempotency_key, note: "different" }))).rejects.toMatchObject({ code: "REJECTED_VALIDATION" });
    });

    it("reads back what it stored (lookup by idempotency key)", async () => {
      const { port } = make();
      const payload = samplePayload();
      expect((await port.verify(payload.contract.idempotency_key)).found).toBe(false);
      const acceptance = await port.publish(payload);
      const seen = await port.verify(payload.contract.idempotency_key);
      expect(seen.found).toBe(true);
      expect(seen.checksum).toBe(acceptance.checksum);
      expect(seen.reference).toEqual(acceptance.reference);
    });

    it("rejects an unsupported kind with a non-retryable error", async () => {
      const { port } = make();
      const bad = samplePayload();
      (bad.contract as { kind: string }).kind = "something_else";
      const error = await port.publish(bad).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(OhPortError);
      expect((error as OhPortError).code).toBe("UNSUPPORTED_KIND");
      expect((error as OhPortError).retryable).toBe(false);
    });

    it("reports no access before the first accepted send, and provisioned after it", async () => {
      const { port } = make();
      const payload = samplePayload({ project: "00000000-0000-4000-8000-0000000000b7" });
      expect((await port.accessState(payload.identity.project_id)).provisioned).toBe(false);
      await port.publish(payload);
      expect((await port.accessState(payload.identity.project_id)).provisioned).toBe(true);
    });

    it("describes itself for the internal review surface", () => {
      const d = make().port.describe();
      expect(d.port).toBe("operation_hub");
      expect(["SIMULATED", "SANDBOX", "REAL"]).toContain(d.mode);
    });

    const probe = make();
    if (probe.faults) {
      describe("failure modes", () => {
        it("timeout after the platform stored the delivery: outcome unknown, verify finds it, retry creates no duplicate", async () => {
          const { port, faults, storedCount } = make();
          const payload = samplePayload();
          faults!.timeoutAfterStore();
          const error = (await port.publish(payload).catch((e: unknown) => e)) as OhPortError;
          expect(error.code).toBe("TIMEOUT");
          expect(error.outcomeUnknown).toBe(true);
          expect((await port.verify(payload.contract.idempotency_key)).found).toBe(true);
          const retry = await port.publish(payload);
          expect(retry.replayed).toBe(true);
          if (storedCount) expect(storedCount()).toBe(1);
        });

        it("unavailable before storing: nothing stored, retry succeeds once", async () => {
          const { port, faults, storedCount } = make();
          const payload = samplePayload();
          faults!.unavailableBeforeStore();
          const error = (await port.publish(payload).catch((e: unknown) => e)) as OhPortError;
          expect(error.code).toBe("UNAVAILABLE");
          expect(error.retryable).toBe(true);
          expect((await port.verify(payload.contract.idempotency_key)).found).toBe(false);
          const retry = await port.publish(payload);
          expect(retry.replayed).toBe(false);
          if (storedCount) expect(storedCount()).toBe(1);
        });

        it("rate limited is retryable; validation rejection is not", async () => {
          const { port, faults } = make();
          faults!.rateLimitNext();
          const limited = (await port.publish(samplePayload()).catch((e: unknown) => e)) as OhPortError;
          expect(limited.code).toBe("RATE_LIMITED");
          expect(limited.retryable).toBe(true);
          faults!.rejectNext();
          const rejected = (await port.publish(samplePayload()).catch((e: unknown) => e)) as OhPortError;
          expect(rejected.code).toBe("REJECTED_VALIDATION");
          expect(rejected.retryable).toBe(false);
        });

        it("detects a checksum mismatch instead of reporting success", async () => {
          const { port, faults } = make();
          faults!.corruptNext();
          const error = (await port.publish(samplePayload()).catch((e: unknown) => e)) as OhPortError;
          expect(error.code).toBe("CHECKSUM_MISMATCH");
          expect(error.retryable).toBe(false);
        });

        it("authentication failure is not retryable", async () => {
          const { port, faults } = make();
          faults!.authFailureNext();
          const error = (await port.publish(samplePayload()).catch((e: unknown) => e)) as OhPortError;
          expect(error.code).toBe("AUTH");
          expect(error.retryable).toBe(false);
        });
      });
    }
  });
}
