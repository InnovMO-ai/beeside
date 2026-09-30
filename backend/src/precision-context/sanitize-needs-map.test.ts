import type { CounterpartyListValue } from "../fa/engine/counterparty-types";
import type { NeedsMapValue } from "../fa/engine/needs-map-types";
import { REDACTED_DEPENDENCY_VALUE, sanitizeNeedsMapForPrecision } from "./sanitize-needs-map";

const RESTRICTED: CounterpartyListValue = [
  { name: "Competitor X", restrictionType: "cannot_contract" },
  { name: "Blocked Holdings LLC", restrictionType: "both" },
];

function needsMap(overrides: Partial<NeedsMapValue> = {}): NeedsMapValue {
  return {
    selections: [{ key: "company_setup", status: "needs_resolution" }],
    priorityRank: ["company_setup"],
    dependencies: [{ key: "company_setup", dependsOn: null, owner: null, approvalRequired: false, approvalFrom: null }],
    blockerKeys: [],
    ...overrides,
  };
}

describe("sanitizeNeedsMapForPrecision", () => {
  it("redacts an exact restricted name in owner", () => {
    const input = needsMap({ dependencies: [{ key: "company_setup", dependsOn: null, owner: "Competitor X", approvalRequired: false, approvalFrom: null }] });
    const result = sanitizeNeedsMapForPrecision(input, RESTRICTED);
    expect(result.dependencies[0]!.owner).toBe(REDACTED_DEPENDENCY_VALUE);
    expect(result.dependencies[0]!.approvalFrom).toBeNull();
  });

  it("redacts an exact restricted name in approvalFrom", () => {
    const input = needsMap({
      dependencies: [{ key: "company_setup", dependsOn: null, owner: "Internal legal", approvalRequired: true, approvalFrom: "Blocked Holdings LLC" }],
    });
    const result = sanitizeNeedsMapForPrecision(input, RESTRICTED);
    expect(result.dependencies[0]!.approvalFrom).toBe(REDACTED_DEPENDENCY_VALUE);
    // The rest of the dependency, including the non-matching owner, is preserved untouched.
    expect(result.dependencies[0]!.owner).toBe("Internal legal");
    expect(result.dependencies[0]!.approvalRequired).toBe(true);
  });

  it("redacts a restricted name mentioned inside a longer free-text sentence", () => {
    const input = needsMap({
      dependencies: [{ key: "company_setup", dependsOn: null, owner: "Waiting on legal sign-off from Competitor X's counsel", approvalRequired: false, approvalFrom: null }],
    });
    const result = sanitizeNeedsMapForPrecision(input, RESTRICTED);
    expect(result.dependencies[0]!.owner).toBe(REDACTED_DEPENDENCY_VALUE);
  });

  it("leaves unrestricted names fully intact", () => {
    const input = needsMap({ dependencies: [{ key: "company_setup", dependsOn: null, owner: "Finance lead", approvalRequired: true, approvalFrom: "CFO" }] });
    const result = sanitizeNeedsMapForPrecision(input, RESTRICTED);
    expect(result.dependencies[0]!.owner).toBe("Finance lead");
    expect(result.dependencies[0]!.approvalFrom).toBe("CFO");
    // No redaction happened anywhere, so the original object is returned unchanged (no needless copy).
    expect(result).toBe(input);
  });

  it("redacts each dependency independently across multiple restricted counterparties", () => {
    const input = needsMap({
      priorityRank: ["company_setup", "banking"],
      dependencies: [
        { key: "company_setup", dependsOn: null, owner: "Competitor X", approvalRequired: false, approvalFrom: null },
        { key: "banking", dependsOn: "company_setup", owner: "Finance lead", approvalRequired: true, approvalFrom: "Blocked Holdings LLC" },
      ],
    });
    const result = sanitizeNeedsMapForPrecision(input, RESTRICTED);
    expect(result.dependencies[0]!.owner).toBe(REDACTED_DEPENDENCY_VALUE);
    expect(result.dependencies[1]!.owner).toBe("Finance lead");
    expect(result.dependencies[1]!.approvalFrom).toBe(REDACTED_DEPENDENCY_VALUE);
  });

  it("returns the input unchanged when there are no restricted counterparties for this project", () => {
    const input = needsMap({ dependencies: [{ key: "company_setup", dependsOn: null, owner: "Competitor X", approvalRequired: false, approvalFrom: null }] });
    const result = sanitizeNeedsMapForPrecision(input, []);
    expect(result).toBe(input);
    expect(result.dependencies[0]!.owner).toBe("Competitor X");
  });

  it("normalizes case and whitespace when matching", () => {
    const input = needsMap({
      dependencies: [{ key: "company_setup", dependsOn: null, owner: "  competitor   x  ", approvalRequired: false, approvalFrom: "BLOCKED HOLDINGS LLC" }],
    });
    const result = sanitizeNeedsMapForPrecision(input, RESTRICTED);
    expect(result.dependencies[0]!.owner).toBe(REDACTED_DEPENDENCY_VALUE);
    expect(result.dependencies[0]!.approvalFrom).toBe(REDACTED_DEPENDENCY_VALUE);
  });

  it("does not regress the rest of the needs_map handoff — selections, priorityRank, blockerKeys and non-redacted dependency fields all survive", () => {
    const input: NeedsMapValue = {
      selections: [
        { key: "company_setup", status: "needs_resolution" },
        { key: "banking", status: "in_progress" },
      ],
      priorityRank: ["company_setup", "banking"],
      dependencies: [{ key: "banking", dependsOn: "company_setup", owner: "Competitor X", approvalRequired: true, approvalFrom: "CFO" }],
      blockerKeys: ["company_setup"],
    };
    const result = sanitizeNeedsMapForPrecision(input, RESTRICTED);
    expect(result.selections).toEqual(input.selections);
    expect(result.priorityRank).toEqual(input.priorityRank);
    expect(result.blockerKeys).toEqual(input.blockerKeys);
    expect(result.dependencies[0]!.key).toBe("banking");
    expect(result.dependencies[0]!.dependsOn).toBe("company_setup");
    expect(result.dependencies[0]!.approvalRequired).toBe(true);
    expect(result.dependencies[0]!.approvalFrom).toBe("CFO");
    expect(result.dependencies[0]!.owner).toBe(REDACTED_DEPENDENCY_VALUE);
    // The original input is never mutated.
    expect(input.dependencies[0]!.owner).toBe("Competitor X");
  });

  it("is a no-op when the needs map has no dependencies yet", () => {
    const input = needsMap({ dependencies: [] });
    const result = sanitizeNeedsMapForPrecision(input, RESTRICTED);
    expect(result).toBe(input);
  });
});
