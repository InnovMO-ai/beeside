import { AnalyticsContractError, V1_EVENTS, V1EventName, conformProperties, emitV1Event, latencyBucket } from "./v1-events";

describe("V1.0 analytics catalog (closed contract: codes, counters and flags only)", () => {
  const names = Object.keys(V1_EVENTS) as V1EventName[];

  it("declares the Delta Review §6 families, every name snake_case and acceptable to the event tables", () => {
    for (const n of ["entitlement_granted", "entitlement_extended", "entitlement_ended", "entitlement_mode_changed", "program_activated", "program_closed", "program_redeemed",
      "privacy_block_applied", "operation_hub_send_failed", "operation_hub_send_retried", "ai_turn_completed", "ai_fallback_used", "understanding_depth_reached", "turn_class_detected",
      "service_need_routed", "service_map_corrected", "client_priority_set", "context_pinned"]) expect(names).toContain(n);
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
  });

  it("has no free-text-capable property anywhere: enum values are codes, counters are bounded", () => {
    for (const n of names) {
      for (const [key, rule] of Object.entries(V1_EVENTS[n].properties as Record<string, { kind: string; values?: readonly string[]; max?: number }>)) {
        expect(key).toMatch(/^[a-z][a-z0-9_]{0,40}$/);
        expect(key.split("_").filter((t) => ["email", "name", "text", "free", "comment", "note", "message", "phone", "company", "address"].includes(t))).toEqual([]);
        if (rule.kind === "enum") for (const v of rule.values ?? []) expect(v).toMatch(/^[A-Za-z0-9_]{1,24}$/);
        else if (rule.kind === "count") expect(rule.max).toBeLessThanOrEqual(100_000);
        else expect(rule.kind).toBe("flag");
      }
    }
  });

  it("refuses an e-mail, a sentence, an unknown key and an out-of-range counter", () => {
    const r = conformProperties("entitlement_granted", {
      source_type: "ana.rivera@northwind.example", scope: "project", program_kind: "we agreed this at the Madrid fair", chained: "yes", extra: "x",
    });
    expect(r.clean).toEqual({ scope: "project" });
    expect(r.refused.sort()).toEqual(["chained", "extra", "program_kind", "source_type"]);
    expect(conformProperties("operation_hub_send_retried", { attempt: 999 }).refused).toEqual(["attempt"]);
    expect(conformProperties("operation_hub_send_retried", { attempt: 2 }).clean).toEqual({ attempt: 2 });
  });

  it("fails loudly under test when a call site drifts from the catalog (so drift is caught by that site's own test)", async () => {
    const db = { query: jest.fn() } as never;
    await expect(emitV1Event(db, "entitlement_ended", { properties: { reason_code: "because the client asked" } })).rejects.toBeInstanceOf(AnalyticsContractError);
  });

  it("buckets latency", () => {
    expect([1_999, 2_000, 5_000, 10_000, 20_000].map(latencyBucket)).toEqual(["lt_2s", "2_5s", "5_10s", "10_20s", "gte_20s"]);
  });
});
