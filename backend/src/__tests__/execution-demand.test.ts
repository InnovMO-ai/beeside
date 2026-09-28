import { ExecutionDemandDimensionScore, scoreExecutionDemand } from "../fa/engine/execution-demand";
import type { ExpansionDimensionKey } from "../fa/engine/expansion-profile";
import type { NeedsMapValue } from "../fa/engine/needs-map-types";

/**
 * Unit tests for the approved Execution Demand methodology (Macroblock 7 — see
 * FA-MACROBLOCK-7-EXECUTION-DEMAND-METHODOLOGY-PROPOSAL.md and its ADDENDUM). These exercise
 * `scoreExecutionDemand` directly against representative answer maps, independent of the Snapshot
 * compose pipeline — `snapshot-compose.test.ts` covers the wiring into `RenderedSnapshot`.
 */

// `scoreExecutionDemand` always returns exactly one score per dimension (see the "orders the six
// dimensions" test below) — looking up by key, rather than positional destructuring, keeps every
// other test readable and immune to `noUncheckedIndexedAccess` array-element typing.
function byKey(scores: ExecutionDemandDimensionScore[], key: ExpansionDimensionKey): ExecutionDemandDimensionScore {
  const found = scores.find((s) => s.key === key);
  if (!found) throw new Error(`no score for ${key}`);
  return found;
}

describe("scoreExecutionDemand", () => {
  const APPLICABLE = new Set([
    "fa.project.destination_status",
    "fa.project.target_markets",
    "fa.plan.first_customer_known",
    "fa.operation.regulated.permits_status",
    "fa.constraints.non_negotiable_areas",
    "fa.constraints.items",
    "fa.provider.requires_language",
    "fa.provider.requires_local_presence",
    "fa.provider.required_presence_countries",
    "fa.provider.investment_range",
  ]);

  it("orders the six dimensions to match the Expansion Profile taxonomy exactly", () => {
    const scores = scoreExecutionDemand(new Map(), new Set(), undefined);
    expect(scores.map((s) => s.key)).toEqual([
      "market_evidence",
      "commercial_ambition_differentiation",
      "local_capability_base",
      "governance_constraints",
      "financial_framework",
      "activation_planning",
    ]);
  });

  describe("Market Evidence", () => {
    it("averages destination_status, target_markets count and first_customer_known when all three are evaluable", () => {
      const answers = new Map<string, unknown>([
        ["fa.project.destination_status", "comparing_countries"], // 0.67
        ["fa.project.target_markets", ["MX", "BR"]], // 2 markets -> 0.5
        ["fa.plan.first_customer_known", "not_defined_yet"], // 1
      ]);
      const marketEvidence = byKey(scoreExecutionDemand(answers, APPLICABLE, undefined), "market_evidence");
      expect(marketEvidence.evaluableCount).toBe(3);
      expect(marketEvidence.value).toBeCloseTo((0.67 + 0.5 + 1) / 3, 5);
      expect(marketEvidence.tier).not.toBe("not_evaluable");
    });

    it("excludes a not_sure destination_status from the evaluable set — never scored as zero or fabricated", () => {
      const answers = new Map<string, unknown>([
        ["fa.project.destination_status", "not_sure"],
        ["fa.project.target_markets", ["MX"]], // 0
      ]);
      const marketEvidence = byKey(scoreExecutionDemand(answers, APPLICABLE, undefined), "market_evidence");
      // Only 1 evaluable item (target_markets) — below the minimum of 2 — so NOT_EVALUABLE, not a
      // score computed from a partial set that silently dropped the not_sure field to zero.
      expect(marketEvidence.value).toBeNull();
      expect(marketEvidence.tier).toBe("not_evaluable");
      expect(marketEvidence.notEvaluableReason).toBe("insufficient_evidence");
    });

    it("never counts a field the respondent was never asked (not in applicableFieldKeys)", () => {
      const answers = new Map<string, unknown>([
        ["fa.project.destination_status", "know_country_location"],
        ["fa.project.target_markets", ["MX"]],
        ["fa.plan.first_customer_known", "defined"],
      ]);
      // Only destination_status and target_markets were actually applicable in this journey.
      const restricted = new Set(["fa.project.destination_status", "fa.project.target_markets"]);
      const marketEvidence = byKey(scoreExecutionDemand(answers, restricted, undefined), "market_evidence");
      expect(marketEvidence.evaluableCount).toBe(2);
    });
  });

  it("Commercial Ambition & Differentiation is always NOT_EVALUABLE (no defensible structured signal, per the full-registry audit)", () => {
    const answers = new Map<string, unknown>([
      ["fa.project.destination_status", "havent_decided"],
      ["fa.provider.investment_range", "over_2m"],
    ]);
    const commercialAmbition = byKey(scoreExecutionDemand(answers, new Set(answers.keys()), undefined), "commercial_ambition_differentiation");
    expect(commercialAmbition.value).toBeNull();
    expect(commercialAmbition.tier).toBe("not_evaluable");
    expect(commercialAmbition.notEvaluableReason).toBe("no_defensible_signal");
  });

  describe("Governance & Constraints", () => {
    it("resolves permits_status polarity: yes = already resolved (0), no = still to secure (1)", () => {
      const base = new Map<string, unknown>([
        ["fa.constraints.non_negotiable_areas", ["brand_control"]], // 1 item -> 0.33
        ["fa.constraints.items", ["a", "b"]], // 2 items -> 0
      ]);
      const yesAnswers = new Map(base).set("fa.operation.regulated.permits_status", "yes");
      const noAnswers = new Map(base).set("fa.operation.regulated.permits_status", "no");
      const yesResult = byKey(scoreExecutionDemand(yesAnswers, APPLICABLE, undefined), "governance_constraints");
      const noResult = byKey(scoreExecutionDemand(noAnswers, APPLICABLE, undefined), "governance_constraints");
      expect(yesResult.value).toBeLessThan(noResult.value as number);
    });

    it("excludes a not_sure permits_status from the evaluable set rather than escalating it like the rules engine does", () => {
      const answers = new Map<string, unknown>([
        ["fa.operation.regulated.permits_status", "not_sure"],
        ["fa.constraints.non_negotiable_areas", ["brand_control"]],
        ["fa.constraints.items", ["a", "b", "c"]],
      ]);
      const governance = byKey(scoreExecutionDemand(answers, APPLICABLE, undefined), "governance_constraints");
      // permits_status excluded -> only 2 evaluable items (non_negotiable_areas + constraint items).
      // minEvaluable is 3, so 2 evaluable items is still NOT_EVALUABLE — asserting evaluableCount
      // reflects the exclusion (2, not 3) is the point of this test, not a specific tier.
      expect(governance.evaluableCount).toBe(2);
      expect(governance.tier).toBe("not_evaluable");
    });

    it("only counts required_presence_countries when requires_local_presence is yes", () => {
      const withoutPresence = new Map<string, unknown>([
        ["fa.operation.regulated.permits_status", "yes"],
        ["fa.constraints.non_negotiable_areas", ["brand_control"]],
        ["fa.provider.requires_local_presence", "no"],
        ["fa.provider.required_presence_countries", ["MX", "BR", "CO"]], // must be ignored: local presence is "no"
      ]);
      const governance = byKey(scoreExecutionDemand(withoutPresence, APPLICABLE, undefined), "governance_constraints");
      expect(governance.evaluableCount).toBe(3); // permits + non_negotiable_areas + requires_local_presence only
    });
  });

  describe("Financial Framework", () => {
    it("maps investment_range to a demand value without ever answering whether the money suffices", () => {
      const low = byKey(scoreExecutionDemand(new Map([["fa.provider.investment_range", "under_50k"]]), APPLICABLE, undefined), "financial_framework");
      const high = byKey(scoreExecutionDemand(new Map([["fa.provider.investment_range", "over_2m"]]), APPLICABLE, undefined), "financial_framework");
      expect(low.value).toBe(0);
      expect(high.value).toBe(1);
    });

    it("treats not_yet_defined the same as not answered (excluded, never scored)", () => {
      const financial = byKey(scoreExecutionDemand(new Map([["fa.provider.investment_range", "not_yet_defined"]]), APPLICABLE, undefined), "financial_framework");
      expect(financial.value).toBeNull();
      expect(financial.notEvaluableReason).toBe("insufficient_evidence");
    });

    it("distinguishes not_applicable (field never asked in this journey) from insufficient_evidence (asked but unanswered)", () => {
      const notApplicable = byKey(scoreExecutionDemand(new Map(), new Set(), undefined), "financial_framework");
      expect(notApplicable.notEvaluableReason).toBe("not_applicable");

      const insufficientEvidence = byKey(scoreExecutionDemand(new Map(), new Set(["fa.provider.investment_range"]), undefined), "financial_framework");
      expect(insufficientEvidence.notEvaluableReason).toBe("insufficient_evidence");
    });
  });

  describe("Activation Planning", () => {
    it("is NOT_EVALUABLE (project_path_not_confirmed) when the client never used the PriorityRanker", () => {
      const activation = byKey(scoreExecutionDemand(new Map(), new Set(), undefined), "activation_planning");
      expect(activation.value).toBeNull();
      expect(activation.notEvaluableReason).toBe("project_path_not_confirmed");

      const emptyNeedsMap: NeedsMapValue = { selections: [], priorityRank: [], dependencies: [], blockerKeys: [] };
      const activationEmpty = byKey(scoreExecutionDemand(new Map(), new Set(), emptyNeedsMap), "activation_planning");
      expect(activationEmpty.value).toBeNull();
      expect(activationEmpty.notEvaluableReason).toBe("project_path_not_confirmed");
    });

    it("averages normalized pathway depth (0/.33/.67/1) across ranked items once the client has prioritized", () => {
      // b depends on a (depth 1), c depends on b (depth 2) -> normalized 0, .33, .67 over 3 stages max.
      const needsMap: NeedsMapValue = {
        selections: [],
        priorityRank: ["a", "b", "c"],
        dependencies: [
          { key: "a", dependsOn: null, owner: null, approvalRequired: false, approvalFrom: null },
          { key: "b", dependsOn: "a", owner: null, approvalRequired: false, approvalFrom: null },
          { key: "c", dependsOn: "b", owner: null, approvalRequired: false, approvalFrom: null },
        ],
        blockerKeys: [],
      };
      const activation = byKey(scoreExecutionDemand(new Map(), new Set(), needsMap), "activation_planning");
      expect(activation.value).toBeCloseTo((0 + 1 / 3 + 2 / 3) / 3, 5);
      expect(activation.notEvaluableReason).toBeNull();
    });
  });
});
