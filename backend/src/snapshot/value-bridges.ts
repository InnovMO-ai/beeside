import type { NeedsMapSelection, NeedsMapValue } from "../fa/engine/needs-map-types";

/**
 * Value Bridge selection — Macroblock 7, wiring the approved library
 * (`snapshot-etapa2-value-bridges-ronda-final.md`, Product Owner decision 2026-09-24, formally
 * closed) into the live Snapshot for the first time. That document approves final COPY and
 * narrative trigger intent per bridge (Section A) but does not spell out exact field-level
 * predicates — this file is that translation into concrete, structured-field logic, documented
 * inline per bridge so it can be reviewed and adjusted without re-deriving the reasoning.
 *
 * Etapa 2 rule (`snapshot-etapa2-value-bridges-ronda-final.md` §11 of the earlier round, reconfirmed
 * in the final round): at most 2–3 Value Bridges per Snapshot, never one per section, never the same
 * institutional component shown twice. `PRIORITY_ORDER` below is this file's own tie-break when more
 * than 3 candidates trigger; Operation Hub's two variants collapse into whichever fires first in that
 * order (never both).
 */
export type ValueBridgeKey = "strategic_advisory" | "operation_hub_secure" | "the_hive" | "beeside_verified" | "sherpa" | "operation_hub_productivity";

const OPERATION_HUB_KEYS: ReadonlySet<ValueBridgeKey> = new Set(["operation_hub_secure", "operation_hub_productivity"]);

const MAX_VALUE_BRIDGES = 3;

export interface ValueBridgeInput {
  answers: ReadonlyMap<string, unknown>;
  needsMap: NeedsMapValue | undefined;
}

function arr(answers: ReadonlyMap<string, unknown>, key: string): unknown[] {
  const value = answers.get(key);
  return Array.isArray(value) ? value : [];
}

/**
 * Returns at most 3 triggered Value Bridge keys, in priority order, never repeating an institutional
 * component (Operation Hub's two messages are mutually exclusive within one Snapshot).
 */
export function computeValueBridgeKeys(input: ValueBridgeInput): ValueBridgeKey[] {
  const { answers, needsMap } = input;
  const selections: readonly NeedsMapSelection[] = needsMap?.selections ?? [];
  const priorityRank = needsMap?.priorityRank ?? [];
  const triggered: ValueBridgeKey[] = [];

  // Strategic Advisory — a declared non-negotiable coexists with a genuinely unresolved regulatory
  // obligation: the kind of consequential tension the approved copy frames as "more than
  // coordination" (frozen artifact's own worked example: a brand-control non-negotiable intersecting
  // a distributor-led entry, i.e. a declared hard requirement meeting real execution friction).
  const nonNegotiableAreas = arr(answers, "fa.constraints.non_negotiable_areas").filter((v) => v !== "none");
  const permits = answers.get("fa.operation.regulated.permits_status");
  if (nonNegotiableAreas.length > 0 && (permits === "no" || permits === "not_sure")) {
    triggered.push("strategic_advisory");
  }

  // Operation Hub — secure: triggers specifically on Governance & Constraints findings (non-negotiable
  // areas, restrictions, compliance requirements already declared) — the exact trigger the approved
  // doc assigns to this message (Section A), distinct from the "productivity" message below so the
  // two Operation Hub variants never fire on the same generic signal.
  const constraintItems = arr(answers, "fa.constraints.items").filter((v) => v !== "not_sure");
  if (nonNegotiableAreas.length > 0 || constraintItems.length > 0) {
    triggered.push("operation_hub_secure");
  }

  // The Hive — an explicit capability-coverage gap: a declared need still unresolved/unconfirmed, or
  // an active partner/supplier search with nothing settled yet.
  const hasCoverageGap =
    selections.some((s) => s.status === "needs_resolution" || s.status === "needs_confirmation") ||
    ["fa.operation.partners.relationship_status", "fa.operation.sourcing.relationship_status"].some(
      (key) => answers.get(key) === "still_looking" || answers.get(key) === "evaluating",
    );
  if (hasCoverageGap) triggered.push("the_hive");

  // beeside Verified — the client already has a specific partner/supplier candidate in mind.
  const hasCandidateInMind = ["fa.operation.partners.relationship_status", "fa.operation.sourcing.relationship_status"].some((key) => {
    const value = answers.get(key);
    return value === "identified" || value === "in_discussions" || value === "selected";
  });
  if (hasCandidateInMind) triggered.push("beeside_verified");

  // Sherpa — activation approaching (near-term timing) with multiple prioritized needs that still
  // require human coordination toward contracting — the exact pairing the approved doc's Section A
  // describes ("timing cercano, múltiples workstreams needing coordination to reach contracting").
  const launchTiming = answers.get("fa.goal.launch_timing_status");
  const priorityTiming = answers.get("fa.priority.timing");
  const nearTermActivation =
    launchTiming === "firm_commitment" ||
    launchTiming === "target_date" ||
    ["already_in_progress", "immediately", "within_30_days", "1_3_months"].includes(String(priorityTiming));
  if (priorityRank.length >= 2 && nearTermActivation) triggered.push("sherpa");

  // Operation Hub — productivity: multiple declared capability workstreams — this message's
  // existing, unchanged trigger per the approved doc.
  if (selections.length >= 3) triggered.push("operation_hub_productivity");

  const result: ValueBridgeKey[] = [];
  let operationHubUsed = false;
  for (const key of triggered) {
    if (OPERATION_HUB_KEYS.has(key)) {
      if (operationHubUsed) continue;
      operationHubUsed = true;
    }
    if (!result.includes(key)) result.push(key);
    if (result.length === MAX_VALUE_BRIDGES) break;
  }
  return result;
}
