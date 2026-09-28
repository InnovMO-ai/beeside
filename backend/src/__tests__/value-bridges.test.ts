import { computeValueBridgeKeys } from "../snapshot/value-bridges";
import type { NeedsMapValue } from "../fa/engine/needs-map-types";

/**
 * Unit tests for the Value Bridges selection logic (Macroblock 7), translating the approved library
 * (`snapshot-etapa2-value-bridges-ronda-final.md`) into structured-field triggers. See
 * `value-bridges.ts`'s docblock for the reasoning behind each trigger.
 */
describe("computeValueBridgeKeys", () => {
  const emptyNeedsMap: NeedsMapValue = { selections: [], priorityRank: [], dependencies: [], blockerKeys: [] };

  it("triggers nothing when no answer creates a natural context for any bridge", () => {
    const keys = computeValueBridgeKeys({ answers: new Map(), needsMap: emptyNeedsMap });
    expect(keys).toEqual([]);
  });

  it("triggers The Hive when a declared need still needs resolution or confirmation", () => {
    const needsMap: NeedsMapValue = {
      selections: [{ key: "customs_broker", status: "needs_resolution" }],
      priorityRank: [],
      dependencies: [],
      blockerKeys: [],
    };
    const keys = computeValueBridgeKeys({ answers: new Map(), needsMap });
    expect(keys).toContain("the_hive");
  });

  it("triggers beeside Verified when the client already has a specific partner/supplier candidate in mind", () => {
    const answers = new Map<string, unknown>([["fa.operation.partners.relationship_status", "in_discussions"]]);
    const keys = computeValueBridgeKeys({ answers, needsMap: emptyNeedsMap });
    expect(keys).toContain("beeside_verified");
  });

  it("triggers Strategic Advisory only when a non-negotiable coexists with genuinely unresolved regulatory status", () => {
    const withUnresolvedPermits = new Map<string, unknown>([
      ["fa.constraints.non_negotiable_areas", ["brand_control"]],
      ["fa.operation.regulated.permits_status", "no"],
    ]);
    expect(computeValueBridgeKeys({ answers: withUnresolvedPermits, needsMap: emptyNeedsMap })).toContain("strategic_advisory");

    const withResolvedPermits = new Map<string, unknown>([
      ["fa.constraints.non_negotiable_areas", ["brand_control"]],
      ["fa.operation.regulated.permits_status", "yes"],
    ]);
    expect(computeValueBridgeKeys({ answers: withResolvedPermits, needsMap: emptyNeedsMap })).not.toContain("strategic_advisory");
  });

  it("triggers exactly one Operation Hub variant, never both, even when both triggers fire", () => {
    // secure trigger (non-negotiable areas) AND productivity trigger (3+ selections) both present.
    const answers = new Map<string, unknown>([["fa.constraints.non_negotiable_areas", ["brand_control"]]]);
    const needsMap: NeedsMapValue = {
      selections: [
        { key: "a", status: "covered_internally" },
        { key: "b", status: "covered_internally" },
        { key: "c", status: "covered_internally" },
      ],
      priorityRank: [],
      dependencies: [],
      blockerKeys: [],
    };
    const keys = computeValueBridgeKeys({ answers, needsMap });
    const operationHubKeys = keys.filter((k) => k === "operation_hub_secure" || k === "operation_hub_productivity");
    expect(operationHubKeys).toHaveLength(1);
  });

  it("never returns more than 3 bridges, even when every trigger fires", () => {
    const answers = new Map<string, unknown>([
      ["fa.constraints.non_negotiable_areas", ["brand_control"]],
      ["fa.constraints.items", ["a"]],
      ["fa.operation.regulated.permits_status", "not_sure"],
      ["fa.operation.partners.relationship_status", "selected"],
      ["fa.goal.launch_timing_status", "firm_commitment"],
    ]);
    const needsMap: NeedsMapValue = {
      selections: [
        { key: "a", status: "needs_resolution" },
        { key: "b", status: "covered_internally" },
        { key: "c", status: "covered_internally" },
      ],
      priorityRank: ["a", "b"],
      dependencies: [],
      blockerKeys: [],
    };
    const keys = computeValueBridgeKeys({ answers, needsMap });
    expect(keys.length).toBeLessThanOrEqual(3);
    expect(new Set(keys).size).toBe(keys.length); // never repeats the same institutional component
  });
});
