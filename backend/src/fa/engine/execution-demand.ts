import { isAnswered } from "./conditions";
import type { ExpansionDimensionKey } from "./expansion-profile";
import { pathwayDepths, PATHWAY_STAGES } from "./needs-map-pathway";
import type { NeedsMapValue } from "./needs-map-types";
import { isNotSureValue } from "./values";

/**
 * Execution Demand — the second Dual Expansion Profile series (frozen Snapshot
 * `snapshot_etapa4_FROZEN_v8-night-shift.html`, `<section id="radar">`, `.radar-dem` / dumbbell
 * "Execution Demand" markers), alongside `expansion-profile.ts`'s existing "Definition & Evidence"
 * series. Approved methodology, Macroblock 7 (2026-09-28):
 *   - `FA-MACROBLOCK-7-EXECUTION-DEMAND-METHODOLOGY-PROPOSAL.md` (per-axis field selection,
 *     normalization, shared rules)
 *   - `FA-MACROBLOCK-7-EXECUTION-DEMAND-METHODOLOGY-ADDENDUM.md` (Governance & Constraints polarity
 *     resolved from the live question bank; Commercial Ambition & Differentiation full-registry
 *     audit; Activation Planning's conditional formula over `fa.needs.map`)
 * Both documents record the Product Owner's explicit approval of every formula below. Do not change
 * a normalization, threshold or field selection here without going back to those documents and the
 * Product Owner — the same "do not silently redrift" discipline that governs the six-dimension
 * taxonomy in `expansion-profile.ts` governs this methodology too.
 *
 * Product meaning (shared with Definition & Evidence, restated here because it is easy to
 * misread a "demand" number as a warning label): this is NOT a risk score, a viability signal or a
 * probability of success. It represents how much unresolved execution work or complexity the
 * respondent's own declared answers already imply for that dimension — evidence-based, never
 * inferred from anything the respondent didn't actually say.
 *
 * Shared rules, identical for every dimension below (approved, not to be re-derived per axis):
 *   - A field counts as evaluable only if it is BOTH applicable to this respondent's journey
 *     (`applicableFieldKeys`) AND answered with a real, resolved, non-"not sure" value
 *     (`isAnswered` + `!isNotSureValue`, the exact same gate `expansion-profile.ts` uses for
 *     Definition & Evidence — one definition of "not sure" for both series, never two).
 *   - No missing = zero: a field that isn't evaluable is excluded from both the numerator and the
 *     denominator, never scored as low (or high) demand by default.
 *   - Unweighted mean of evaluable fields' 0..1 values. No per-field weighting anywhere in this file.
 *   - A dimension whose evaluable-field count falls below its mechanical minimum renders
 *     `NOT_EVALUABLE` (`value: null`) — the same "no number is fabricated" principle Definition &
 *     Evidence already applies, extended to the second series.
 *   - `fa.provider.investment_range` is used in exactly one dimension (Financial Framework), for
 *     exactly this one fact (which bucket, not whether a reference exists at all — that question
 *     belongs to Definition & Evidence). Never reused as an effort proxy in any other dimension.
 */

export type ExecutionDemandTier = "low" | "low_medium" | "medium" | "medium_high" | "high";

/** Five equal bins over the 0..1 value — the bin boundaries are this file's own calibration (the
 *  frozen dumbbell's own numbers are illustrative demo data, not a declared threshold table); the
 *  five label strings are not invented — they are the frozen artifact's own marker-tag vocabulary. */
const TIER_BINS: ReadonlyArray<{ max: number; tier: ExecutionDemandTier }> = [
  { max: 0.2, tier: "low" },
  { max: 0.4, tier: "low_medium" },
  { max: 0.6, tier: "medium" },
  { max: 0.8, tier: "medium_high" },
  { max: Number.POSITIVE_INFINITY, tier: "high" },
];

function tierForDemand(value: number): ExecutionDemandTier {
  for (const bin of TIER_BINS) {
    if (value <= bin.max) return bin.tier;
  }
  return "high";
}

/** Qualitative-only wording — same discipline as `EXPANSION_TIER_COPY` in expansion-profile.ts: no
 *  number, percentage, "score", "risk" or pass/fail framing. Deliberately a different vocabulary from
 *  Definition & Evidence's (`well_defined` / `partially_defined` / `early_stage`) — part of what keeps
 *  the two series visibly independent to a reader, per the frozen artifact's own two-legend design. */
export const EXECUTION_DEMAND_TIER_COPY: Record<ExecutionDemandTier, { en: string; es: string }> = {
  low: { en: "Low", es: "Bajo" },
  low_medium: { en: "Low–Medium", es: "Bajo–Medio" },
  medium: { en: "Medium", es: "Medio" },
  medium_high: { en: "Medium–High", es: "Medio–Alto" },
  high: { en: "High", es: "Alto" },
};

/** Why a dimension is NOT_EVALUABLE — a stable key for template copy, never shown to the client as
 *  raw text. `no_defensible_signal`: no structured field exists that can represent this axis's demand
 *  without double-counting another dimension or inventing an ordinal ranking (Commercial Ambition &
 *  Differentiation only, per the full canonical-field-registry audit in the addendum).
 *  `project_path_not_confirmed`: the client has not used the PriorityRanker (Activation Planning
 *  only) — conditional, not permanent, exactly as the frozen artifact's own axis note describes.
 *  `insufficient_evidence`: fewer than the mechanical minimum of this dimension's candidate fields
 *  were both applicable and answered for this respondent. `not_applicable`: the one candidate field
 *  was never applicable in this respondent's journey at all. */
export type NotEvaluableReason = "no_defensible_signal" | "project_path_not_confirmed" | "insufficient_evidence" | "not_applicable";

export interface ExecutionDemandDimensionScore {
  key: ExpansionDimensionKey;
  /** Continuous 0..1 internal value, `null` when NOT_EVALUABLE. Same "never a number to the client"
   *  discipline as Definition & Evidence's `value`. */
  value: number | null;
  tier: ExecutionDemandTier | "not_evaluable";
  /** How many of this dimension's candidate demand fields were applicable-and-answered. */
  evaluableCount: number;
  /** The mechanical minimum required before this dimension renders a value at all. */
  minEvaluable: number;
  notEvaluableReason: NotEvaluableReason | null;
}

function evaluableValue(answers: ReadonlyMap<string, unknown>, applicableFieldKeys: ReadonlySet<string>, key: string): unknown | undefined {
  if (!applicableFieldKeys.has(key)) return undefined;
  const value = answers.get(key);
  if (!isAnswered(value) || isNotSureValue(value)) return undefined;
  return value;
}

/** Multi-select item count, excluding stable non-substantive markers (e.g. "none", "not_sure") that
 *  the field's own `exclusiveValues` already guarantee cannot combine with a real selection. */
function countOf(value: unknown, exclude: readonly string[] = []): number {
  if (!Array.isArray(value)) return 0;
  return value.filter((v) => !exclude.includes(String(v))).length;
}

function finalize(key: ExpansionDimensionKey, items: number[], minEvaluable: number, reasonWhenBlocked: NotEvaluableReason): ExecutionDemandDimensionScore {
  if (items.length < minEvaluable) {
    return { key, value: null, tier: "not_evaluable", evaluableCount: items.length, minEvaluable, notEvaluableReason: reasonWhenBlocked };
  }
  const value = items.reduce((a, b) => a + b, 0) / items.length;
  return { key, value, tier: tierForDemand(value), evaluableCount: items.length, minEvaluable, notEvaluableReason: null };
}

// ---------------------------------------------------------------------------- 1. Market Evidence

const DESTINATION_STATUS_DEMAND: Record<string, number> = {
  know_country_location: 0,
  know_country_comparing_locations: 0.33,
  comparing_countries: 0.67,
  havent_decided: 1,
};

function scoreMarketEvidence(answers: ReadonlyMap<string, unknown>, applicableFieldKeys: ReadonlySet<string>): ExecutionDemandDimensionScore {
  const items: number[] = [];
  const destination = evaluableValue(answers, applicableFieldKeys, "fa.project.destination_status") as string | undefined;
  if (destination && destination in DESTINATION_STATUS_DEMAND) items.push(DESTINATION_STATUS_DEMAND[destination]!);

  const markets = evaluableValue(answers, applicableFieldKeys, "fa.project.target_markets");
  if (Array.isArray(markets) && markets.length > 0) {
    items.push(markets.length === 1 ? 0 : markets.length <= 3 ? 0.5 : 1);
  }

  const firstCustomer = evaluableValue(answers, applicableFieldKeys, "fa.plan.first_customer_known") as string | undefined;
  if (firstCustomer === "defined") items.push(0);
  else if (firstCustomer === "not_defined_yet") items.push(1);

  return finalize("market_evidence", items, 2, "insufficient_evidence");
}

// ------------------------------------------------- 2. Commercial Ambition & Differentiation

/**
 * Always NOT_EVALUABLE (Macroblock 7, Product Owner decision, addendum item 3): a full audit of all
 * 90 canonical `fa.*` fields found no structured signal that can represent commercial-ambition
 * execution demand without double-counting a field already claimed by another dimension, inventing
 * an ordinal ranking among unordered categories, or measuring an adjacent concept (company size,
 * operating footprint) instead of commercial ambition. This is a documented data gap, not a
 * methodology shortcoming — do not force a score here; see the addendum for the full candidate list.
 */
function scoreCommercialAmbitionDifferentiation(): ExecutionDemandDimensionScore {
  return { key: "commercial_ambition_differentiation", value: null, tier: "not_evaluable", evaluableCount: 0, minEvaluable: 1, notEvaluableReason: "no_defensible_signal" };
}

// ---------------------------------------------------------------------------- 3. Local Capability Base

const YES_PROBABLY_NO_DEMAND: Record<string, number> = { yes: 1, probably: 0.67, no: 0 };
const RELATIONSHIP_STATUS_SCALE = ["still_looking", "identified", "evaluating", "in_discussions", "selected", "already_working_together"] as const;
const RESOLUTION_STATUS_DEMAND: Record<string, number> = { already_in_place: 0, in_progress: 0.5, need_to_establish: 1 };
const SUPPLIER_COUNT_DEMAND: Record<string, number> = { "1_5": 0, "6_20": 0.33, "21_50": 0.67, "51_plus": 1 };

/** Earlier stage in the relationship-status progression = more work left to close it (reversed order
 *  from the schema's own declared `RELATIONSHIP_STATUS` progression). */
function relationshipDemand(value: string): number | undefined {
  const idx = RELATIONSHIP_STATUS_SCALE.indexOf(value as (typeof RELATIONSHIP_STATUS_SCALE)[number]);
  if (idx < 0) return undefined;
  return 1 - idx / (RELATIONSHIP_STATUS_SCALE.length - 1);
}

function scoreLocalCapabilityBase(answers: ReadonlyMap<string, unknown>, applicableFieldKeys: ReadonlySet<string>): ExecutionDemandDimensionScore {
  const items: number[] = [];

  const dependency = evaluableValue(answers, applicableFieldKeys, "fa.operation.partners.dependency") as string | undefined;
  if (dependency && dependency in YES_PROBABLY_NO_DEMAND) items.push(YES_PROBABLY_NO_DEMAND[dependency]!);

  const partnerStatus = evaluableValue(answers, applicableFieldKeys, "fa.operation.partners.relationship_status") as string | undefined;
  if (partnerStatus) {
    const demand = relationshipDemand(partnerStatus);
    if (demand !== undefined) items.push(demand);
  }

  const sourcingLocal = evaluableValue(answers, applicableFieldKeys, "fa.operation.sourcing.local_expected") as string | undefined;
  if (sourcingLocal && sourcingLocal in YES_PROBABLY_NO_DEMAND) items.push(YES_PROBABLY_NO_DEMAND[sourcingLocal]!);

  const sourcingStatus = evaluableValue(answers, applicableFieldKeys, "fa.operation.sourcing.relationship_status") as string | undefined;
  if (sourcingStatus) {
    const demand = relationshipDemand(sourcingStatus);
    if (demand !== undefined) items.push(demand);
  }

  const supplierCount = evaluableValue(answers, applicableFieldKeys, "fa.operation.sourcing.critical_supplier_count") as string | undefined;
  if (supplierCount && supplierCount in SUPPLIER_COUNT_DEMAND) items.push(SUPPLIER_COUNT_DEMAND[supplierCount]!);

  const banking = evaluableValue(answers, applicableFieldKeys, "fa.operation.banking_status") as string | undefined;
  if (banking && banking in RESOLUTION_STATUS_DEMAND) items.push(RESOLUTION_STATUS_DEMAND[banking]!);

  const insurance = evaluableValue(answers, applicableFieldKeys, "fa.operation.insurance_status") as string | undefined;
  if (insurance && insurance in RESOLUTION_STATUS_DEMAND) items.push(RESOLUTION_STATUS_DEMAND[insurance]!);

  const growthFocus = evaluableValue(answers, applicableFieldKeys, "fa.operation.growth_focus");
  if (Array.isArray(growthFocus) && growthFocus.length > 0) {
    const n = growthFocus.length;
    items.push(n <= 1 ? 0 : n <= 3 ? 0.5 : 1);
  }

  const expectedCapabilities = evaluableValue(answers, applicableFieldKeys, "fa.operation.expected_capabilities");
  if (Array.isArray(expectedCapabilities) && expectedCapabilities.length > 0) {
    const n = expectedCapabilities.length;
    items.push(n <= 3 ? 0 : n <= 7 ? 0.5 : 1);
  }

  return finalize("local_capability_base", items, 5, "insufficient_evidence");
}

// ---------------------------------------------------------------------------- 4. Governance & Constraints

function scoreGovernanceConstraints(answers: ReadonlyMap<string, unknown>, applicableFieldKeys: ReadonlySet<string>): ExecutionDemandDimensionScore {
  const items: number[] = [];

  // Polarity resolved from the live question bank (addendum item 2): "Do you hold permits,
  // certifications or regulatory approvals today?" yes = already resolved (0), no = still to secure
  // (1), not_sure excluded (same treatment as every other axis — see the addendum for why the
  // existing rules engine's not_sure severity escalation is deliberately NOT imported here).
  const permits = evaluableValue(answers, applicableFieldKeys, "fa.operation.regulated.permits_status") as string | undefined;
  if (permits === "yes") items.push(0);
  else if (permits === "no") items.push(1);

  const nonNegotiableAreas = evaluableValue(answers, applicableFieldKeys, "fa.constraints.non_negotiable_areas");
  if (Array.isArray(nonNegotiableAreas)) {
    const n = countOf(nonNegotiableAreas, ["none"]);
    items.push(n === 0 ? 0 : n <= 2 ? 0.33 : n <= 4 ? 0.67 : 1);
  }

  const constraintItems = evaluableValue(answers, applicableFieldKeys, "fa.constraints.items");
  if (Array.isArray(constraintItems) && constraintItems.length > 0) {
    const n = constraintItems.length;
    items.push(n <= 2 ? 0 : n <= 5 ? 0.5 : 1);
  }

  const requiresLanguage = evaluableValue(answers, applicableFieldKeys, "fa.provider.requires_language") as string | undefined;
  if (requiresLanguage === "yes") items.push(1);
  else if (requiresLanguage === "no") items.push(0);

  const requiresLocalPresence = evaluableValue(answers, applicableFieldKeys, "fa.provider.requires_local_presence") as string | undefined;
  if (requiresLocalPresence === "yes") items.push(1);
  else if (requiresLocalPresence === "no") items.push(0);

  if (requiresLocalPresence === "yes") {
    const presenceCountries = evaluableValue(answers, applicableFieldKeys, "fa.provider.required_presence_countries");
    if (Array.isArray(presenceCountries) && presenceCountries.length > 0) {
      const n = presenceCountries.length;
      items.push(n === 1 ? 0.33 : n <= 3 ? 0.67 : 1);
    }
  }

  return finalize("governance_constraints", items, 3, "insufficient_evidence");
}

// ---------------------------------------------------------------------------- 5. Financial Framework

const INVESTMENT_RANGE_DEMAND: Record<string, number> = {
  under_50k: 0,
  "50k_150k": 0.25,
  "150k_500k": 0.5,
  "500k_2m": 0.75,
  over_2m: 1,
};

function scoreFinancialFramework(answers: ReadonlyMap<string, unknown>, applicableFieldKeys: ReadonlySet<string>): ExecutionDemandDimensionScore {
  // `not_yet_defined` is in the shared NOT_SURE_VALUES set (values.ts) so `evaluableValue` already
  // excludes it — this dimension answers "which range?" (a scale proxy), never "does the money
  // suffice?" (Definition & Evidence already answers "was any range given?" separately).
  const range = evaluableValue(answers, applicableFieldKeys, "fa.provider.investment_range") as string | undefined;
  if (range && range in INVESTMENT_RANGE_DEMAND) {
    const value = INVESTMENT_RANGE_DEMAND[range]!;
    return { key: "financial_framework", value, tier: tierForDemand(value), evaluableCount: 1, minEvaluable: 1, notEvaluableReason: null };
  }
  const reason: NotEvaluableReason = applicableFieldKeys.has("fa.provider.investment_range") ? "insufficient_evidence" : "not_applicable";
  return { key: "financial_framework", value: null, tier: "not_evaluable", evaluableCount: 0, minEvaluable: 1, notEvaluableReason: reason };
}

// ---------------------------------------------------------------------------- 6. Activation Planning

/**
 * Conditional formula over `fa.needs.map` (addendum item 4): evaluable exactly when the client used
 * the PriorityRanker (`priorityRank.length >= 1`), NOT_EVALUABLE otherwise — matching the frozen
 * artifact's own conditional example, not a permanent rule. Reuses `pathwayDepths()` verbatim (moved
 * to `needs-map-pathway.ts` so both `compose.ts`'s Pathway diagram and this formula share one
 * implementation) rather than re-deriving dependency-depth logic. `blockerKeys` and
 * `approvalRequired`/`approvalFrom` are deliberately NOT folded into this number — seeing them as
 * qualitative Snapshot context is a product/communication decision, not a scoring one; left open.
 */
function scoreActivationPlanning(needsMap: NeedsMapValue | undefined): ExecutionDemandDimensionScore {
  const priorityRank = needsMap?.priorityRank ?? [];
  if (priorityRank.length === 0) {
    return { key: "activation_planning", value: null, tier: "not_evaluable", evaluableCount: 0, minEvaluable: 1, notEvaluableReason: "project_path_not_confirmed" };
  }
  const depths = pathwayDepths(priorityRank, needsMap!.dependencies);
  const maxDepth = PATHWAY_STAGES.length - 1;
  const normalized = priorityRank.map((key) => (depths.get(key) ?? 0) / maxDepth);
  const value = normalized.reduce((a, b) => a + b, 0) / normalized.length;
  return { key: "activation_planning", value, tier: tierForDemand(value), evaluableCount: normalized.length, minEvaluable: 1, notEvaluableReason: null };
}

// ---------------------------------------------------------------------------- Entry point

/**
 * Scores all six Execution Demand dimensions. `needsMap` is the project's `fa.needs.map` answer
 * (`answers.get("fa.needs.map")`), passed separately because — unlike every other field here — its
 * structured sub-shape (`priorityRank`/`dependencies`) needs dedicated handling, not a single scalar
 * read. Dimension order matches `EXPANSION_PROFILE_DIMENSIONS` in `expansion-profile.ts` exactly, so
 * callers can zip the two arrays by index or by `key`.
 */
export function scoreExecutionDemand(
  answers: ReadonlyMap<string, unknown>,
  applicableFieldKeys: ReadonlySet<string>,
  needsMap: NeedsMapValue | undefined,
): ExecutionDemandDimensionScore[] {
  return [
    scoreMarketEvidence(answers, applicableFieldKeys),
    scoreCommercialAmbitionDifferentiation(),
    scoreLocalCapabilityBase(answers, applicableFieldKeys),
    scoreGovernanceConstraints(answers, applicableFieldKeys),
    scoreFinancialFramework(answers, applicableFieldKeys),
    scoreActivationPlanning(needsMap),
  ];
}
