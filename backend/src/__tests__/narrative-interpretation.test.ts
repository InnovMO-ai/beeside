import { composeNarrativeInterpretation } from "../fa/engine/narrative-interpretation";
import type { RenderedExpansionDimension, RenderedExecutionDemand } from "../snapshot/compose";
import type { ExecutionDemandTier } from "../fa/engine/execution-demand";
import type { ExpansionDefinitionTier } from "../fa/engine/expansion-profile";

/**
 * Unit tests for the Narrative Interpretation Library (Macroblock 7 — Final Gap Closure). One test
 * per branch of each of the three rules, using the canonical six-dimension order
 * (market_evidence, commercial_ambition_differentiation, local_capability_base,
 * governance_constraints, financial_framework, activation_planning) so Execution Pressure's
 * tie-break-by-canonical-order behavior can be exercised directly.
 */

const KEYS = [
  "market_evidence",
  "commercial_ambition_differentiation",
  "local_capability_base",
  "governance_constraints",
  "financial_framework",
  "activation_planning",
] as const;

function demand(tier: ExecutionDemandTier | null): RenderedExecutionDemand | null {
  return tier === null ? null : { value: 0.5, tier, tierLabel: tier };
}

function dim(key: (typeof KEYS)[number], defTier: ExpansionDefinitionTier, defValue: number, demandTier: ExecutionDemandTier | null): RenderedExpansionDimension {
  return { key, label: key, value: defValue, tier: defTier, tierLabel: defTier, demand: demand(demandTier), demandNote: demandTier === null ? "not evaluable" : null };
}

/** Six dimensions, all evaluable on both series, with a controllable overall clarity/demand shape.
 *  Commercial Ambition & Differentiation is always NOT_EVALUABLE in the real engine, but Key Reading's
 *  and Execution Pressure's minimum-evaluable check only needs 3 of the 5 non-always-blocked
 *  dimensions evaluable — these fixtures keep it NOT_EVALUABLE too, matching production, without
 *  affecting any branch under test (never the top-2 by construction below). */
function sixDims(defTier: ExpansionDefinitionTier, defValue: number, demandTier: ExecutionDemandTier): RenderedExpansionDimension[] {
  return [
    dim("market_evidence", defTier, defValue, demandTier),
    dim("commercial_ambition_differentiation", defTier, defValue, null),
    dim("local_capability_base", defTier, defValue, demandTier),
    dim("governance_constraints", defTier, defValue, demandTier),
    dim("financial_framework", defTier, defValue, demandTier),
    dim("activation_planning", defTier, defValue, demandTier),
  ];
}

describe("composeNarrativeInterpretation — Key Reading", () => {
  it("A — high clarity, low/moderate demand", () => {
    const dims = sixDims("well_defined", 0.9, "low");
    const result = composeNarrativeInterpretation(dims, false, "en");
    expect(result.keyReading).toBe(
      "Your expansion plan is relatively well defined. The next step is less about defining the direction and more about organizing execution around the areas that still require attention.",
    );
  });

  it("B — high clarity, high demand", () => {
    const dims = sixDims("well_defined", 0.9, "high");
    const result = composeNarrativeInterpretation(dims, false, "en");
    expect(result.keyReading).toBe(
      "Your expansion direction is clear, but execution will require coordinated work across several fronts. The challenge is not deciding where to go, but sequencing and activating the right capabilities.",
    );
  });

  it("C — low/medium clarity, low/moderate demand", () => {
    const dims = sixDims("early_stage", 0.2, "low");
    const result = composeNarrativeInterpretation(dims, false, "en");
    expect(result.keyReading).toBe(
      "The execution path does not appear unusually complex, but several important elements of the plan still need definition before the project can move forward with confidence.",
    );
  });

  it("D — low/medium clarity, high demand", () => {
    const dims = sixDims("early_stage", 0.2, "high");
    const result = composeNarrativeInterpretation(dims, false, "en");
    expect(result.keyReading).toBe(
      "Several important decisions remain open while the project also carries meaningful execution demands. Clarifying the plan before activating providers will reduce friction and avoid unnecessary rework.",
    );
  });

  it("E — insufficient data when fewer than 3 dimensions are Execution-Demand-evaluable", () => {
    const dims: RenderedExpansionDimension[] = [
      dim("market_evidence", "well_defined", 0.9, "high"),
      dim("commercial_ambition_differentiation", "well_defined", 0.9, null),
      dim("local_capability_base", "well_defined", 0.9, null),
      dim("governance_constraints", "well_defined", 0.9, null),
      dim("financial_framework", "well_defined", 0.9, null),
      dim("activation_planning", "well_defined", 0.9, null),
    ];
    const result = composeNarrativeInterpretation(dims, false, "en");
    expect(result.keyReading).toBe(
      "There is not yet enough confirmed information to produce a reliable overall reading. Completing the open decisions will make the execution picture clearer.",
    );
  });

  it("renders the Spanish copy for the same branch", () => {
    const dims = sixDims("well_defined", 0.9, "low");
    const result = composeNarrativeInterpretation(dims, false, "es");
    expect(result.keyReading).toBe(
      "Tu plan de expansión está relativamente bien definido. El siguiente paso depende menos de definir la dirección y más de organizar la ejecución en las áreas que todavía requieren atención.",
    );
  });
});

describe("composeNarrativeInterpretation — Market Evidence narrative", () => {
  it("A — well defined, no demand append when demand is low", () => {
    const dims = sixDims("well_defined", 0.9, "low");
    const result = composeNarrativeInterpretation(dims, false, "en");
    expect(result.marketEvidenceNarrative).toBe(
      "The target market is supported by a comparatively clear commercial rationale. The remaining work is primarily about validating and executing the chosen path.",
    );
  });

  it("B — partially defined", () => {
    const dims = sixDims("partially_defined", 0.5, "low");
    const result = composeNarrativeInterpretation(dims, false, "en");
    expect(result.marketEvidenceNarrative).toBe(
      "The market direction is taking shape, but some of the evidence needed to support the expansion decision is still incomplete.",
    );
  });

  it("C — early stage", () => {
    const dims = sixDims("early_stage", 0.1, "low");
    const result = composeNarrativeInterpretation(dims, false, "en");
    expect(result.marketEvidenceNarrative).toBe(
      "The market case is still at an early stage. Key assumptions about where and how to compete need further definition before execution.",
    );
  });

  it("D — not applicable (market_evidence never asked in this journey) overrides the tier reading entirely", () => {
    const dims = sixDims("well_defined", 0.9, "high");
    const result = composeNarrativeInterpretation(dims, true, "en");
    expect(result.marketEvidenceNarrative).toBe("There is not enough confirmed market information yet to produce a reliable reading.");
  });

  it("appends the execution-demand context sentence when demand is high or medium-high", () => {
    const dims = sixDims("well_defined", 0.9, "medium_high");
    const result = composeNarrativeInterpretation(dims, false, "en");
    expect(result.marketEvidenceNarrative).toBe(
      "The target market is supported by a comparatively clear commercial rationale. The remaining work is primarily about validating and executing the chosen path. At the same time, the remaining market work implies a meaningful execution load.",
    );
  });

  it("does not append the context sentence when demand is NOT_EVALUABLE for market_evidence", () => {
    const dims = sixDims("well_defined", 0.9, "low");
    dims[0] = dim("market_evidence", "well_defined", 0.9, null);
    const result = composeNarrativeInterpretation(dims, false, "en");
    expect(result.marketEvidenceNarrative).toBe(
      "The target market is supported by a comparatively clear commercial rationale. The remaining work is primarily about validating and executing the chosen path.",
    );
  });
});

describe("composeNarrativeInterpretation — Execution Pressure narrative", () => {
  it("A — no high/medium-high dimensions: contained", () => {
    const dims = sixDims("well_defined", 0.9, "low");
    const result = composeNarrativeInterpretation(dims, false, "en");
    expect(result.executionPressureNarrative).toBe(
      "Execution pressure appears relatively contained. The project is more likely to benefit from disciplined coordination than from heavy operational intervention.",
    );
  });

  it("B — exactly one high/medium-high dimension names it", () => {
    const dims = sixDims("well_defined", 0.9, "low");
    dims[3] = dim("governance_constraints", "well_defined", 0.9, "high"); // only this one is high
    const result = composeNarrativeInterpretation(dims, false, "en");
    expect(result.executionPressureNarrative).toBe(
      "Execution pressure is concentrated primarily in governance_constraints. This is the area most likely to require early coordination and specialist support.",
    );
  });

  it("C — two or more high/medium-high dimensions names the top two, canonical order breaking ties", () => {
    const dims = sixDims("well_defined", 0.9, "low");
    dims[2] = dim("local_capability_base", "well_defined", 0.9, "high"); // tied at "high"
    dims[3] = dim("governance_constraints", "well_defined", 0.9, "high"); // tied at "high"
    dims[4] = dim("financial_framework", "well_defined", 0.9, "medium_high"); // lower tier, excluded from top 2
    const result = composeNarrativeInterpretation(dims, false, "en");
    // local_capability_base precedes governance_constraints in EXPANSION_PROFILE_DIMENSIONS order —
    // with an equal "high" tier, the stable sort must keep that order rather than inventing a ranking.
    expect(result.executionPressureNarrative).toBe(
      "Execution pressure is distributed across several areas, particularly local_capability_base and governance_constraints. Sequencing these workstreams will be important to avoid dependencies becoming bottlenecks.",
    );
  });

  it("picks strictly by tier before canonical order — a later dimension with a higher tier outranks an earlier lower one", () => {
    const dims = sixDims("well_defined", 0.9, "low");
    dims[2] = dim("local_capability_base", "well_defined", 0.9, "medium_high");
    dims[5] = dim("activation_planning", "well_defined", 0.9, "high");
    const result = composeNarrativeInterpretation(dims, false, "en");
    expect(result.executionPressureNarrative).toBe(
      "Execution pressure is distributed across several areas, particularly activation_planning and local_capability_base. Sequencing these workstreams will be important to avoid dependencies becoming bottlenecks.",
    );
  });

  it("D — too few evaluable Execution Demand dimensions", () => {
    const dims: RenderedExpansionDimension[] = [
      dim("market_evidence", "well_defined", 0.9, "high"),
      dim("commercial_ambition_differentiation", "well_defined", 0.9, null),
      dim("local_capability_base", "well_defined", 0.9, null),
      dim("governance_constraints", "well_defined", 0.9, null),
      dim("financial_framework", "well_defined", 0.9, null),
      dim("activation_planning", "well_defined", 0.9, null),
    ];
    const result = composeNarrativeInterpretation(dims, false, "en");
    expect(result.executionPressureNarrative).toBe("There is not yet enough confirmed execution data to identify where pressure will concentrate.");
  });
});
