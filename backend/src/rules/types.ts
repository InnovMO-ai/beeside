/**
 * First Assessment Rules Engine bundle — schema_version 1 (Rules Matrix v1, Capability Taxonomy v1).
 *
 * The rules engine is data, not code: every area rule, pressure test, ranking factor, signal and
 * capability mapping below lives in `rules_engine_version.config` and is interpreted by the pure
 * `evaluateRules` function. Localized strings live inside `copy` objects keyed by locale.
 */
import type { Condition, Locale } from "../fa/engine/bundle-types";

export type FindingStatus = "DEFINED" | "NEEDS_ATTENTION" | "CRITICAL_GAP" | "NOT_APPLICABLE";
export type SignalStrength = "STRONG" | "SUPPORTING" | "POSSIBLE" | "NO_SIGNAL";

/**
 * Conditions over DECLARED_BY_USER answers. Extends the question-bank condition language with:
 * - `always`: the area is evaluated for every project (Area 1);
 * - `declared`: answered and not an explicit "not sure" value (volumetric ranges, quantities);
 * - `status_in`: only inside `signals[].when`, reads the finding's own status.
 */
export type RuleCondition =
  | Condition
  | { always: true }
  | { field: string; op: "declared" }
  | { status_in: FindingStatus[] }
  | { all: RuleCondition[] }
  | { any: RuleCondition[] }
  | { not: RuleCondition };

/**
 * The only material-pressure tests a CRITICAL_GAP rule may use (Rules Matrix v1 §0 combinator plus
 * the area-specific tests written into Areas 6, 9 and 11). None of them reads an uncertainty value,
 * so "Not sure" can never produce CRITICAL_GAP on its own.
 */
export const PRESSURE_PRIMITIVES = [
  "firm_commitment",
  "customer_contract",
  "commitment_area",
  "non_negotiable_area",
  "client_priority",
  "critical_constraint",
  "constraint_item",
  "contract_and_commitment_area",
  "execution_stage",
] as const;
export type PressurePrimitive = (typeof PRESSURE_PRIMITIVES)[number];

/** Guide §8 Priority weighting order (Rules Matrix v1 §17, Capability Taxonomy v1 §2). */
export const RANKING_FACTORS = [
  "client_priority",
  "firm_deadline",
  "critical_constraint",
  "contractual_commitment",
  "operational_dependency",
  "capability_need",
  "scale_volume",
  "general_interest",
] as const;
export type RankingFactor = (typeof RANKING_FACTORS)[number];

type LocalizedCopy<T> = Record<Locale, T>;

export interface StatusRule {
  id: string;
  status: "DEFINED" | "NEEDS_ATTENTION";
  when: RuleCondition;
  copy: LocalizedCopy<{ reason: string }>;
}

/** CRITICAL_GAP = relevance (area applicable) + unresolved + material pressure, always all three. */
export interface CriticalRule {
  id: string;
  status: "CRITICAL_GAP";
  unresolved: RuleCondition;
  pressure: PressurePrimitive[];
  copy: LocalizedCopy<{ reason: string }>;
}

export interface SignalRule {
  when: RuleCondition;
  /** Internal service/capability name; null = "Possible, no forced name" (Precision clarifies). */
  signal: string | null;
  /** BY_STATUS: CRITICAL_GAP → STRONG, NEEDS_ATTENTION → SUPPORTING, DEFINED → POSSIBLE. */
  strength: Exclude<SignalStrength, "NO_SIGNAL"> | "BY_STATUS";
}

export interface AreaDefinition {
  /** rules_matrix_category.category_id (1–14). */
  id: number;
  /** Rules Matrix category value (same enum as C1/C2/D2/commitment areas). */
  category: string;
  applies_when: RuleCondition;
  evidence_fields: string[];
  /** Evaluated in order after the CRITICAL_GAP rules; the first match wins. */
  critical: CriticalRule[];
  rules: StatusRule[];
  /** Relevant but not matched by any explicit rule: never CRITICAL_GAP. */
  fallback: { id: string; status: "NEEDS_ATTENTION"; copy: LocalizedCopy<{ reason: string }> };
  /** The customer contract is part of this area's evidence (contractual-commitment ranking factor). */
  contract_linked: boolean;
  /** Area-specific ranking factors; the other factors are computed identically for every area. */
  weighting: Partial<Record<"operational_dependency" | "capability_need" | "scale_volume", RuleCondition>>;
  signals: SignalRule[];
  /** Client-facing capability category ids (Capability Taxonomy v1 §2) this area maps to. */
  capability_ids: number[];
  copy: LocalizedCopy<{ label: string; short_label: string; precision_focus: string }>;
}

export interface GrowthBoost {
  value: string;
  area_ids: number[];
  /** false = internal-only strategic boost that never raises client-facing capability rank. */
  capability_boost: boolean;
  strategic_signal?: string;
}

export interface CapabilityCategory {
  id: number;
  copy: LocalizedCopy<{ label: string; description: string }>;
}

export interface RulesEngineBundle {
  schema_version: 1;
  product: "first_assessment_rules";
  locales: Locale[];
  variables: string[];
  /** Question bank versions whose field keys and option values this bundle was authored against. */
  question_bank_versions: string[];
  areas: AreaDefinition[];
  pressure_reasons: Array<{ id: PressurePrimitive; copy: LocalizedCopy<{ reason: string }> }>;
  panels: {
    DEFINED: { ceiling: number };
    NEEDS_ATTENTION: { ceiling: number };
    CRITICAL_GAP: { ceiling: number };
  };
  capabilities: { ceiling: number; categories: CapabilityCategory[] };
  growth_boosts: GrowthBoost[];
  priority_alignment: {
    /** Fixed dependency map for the Go-to-Market / commercial-contract priority (Rules Matrix v1 §18). */
    go_to_market_dependency_area_ids: number[];
    /**
     * Test 2 (shared timing_driver). The frozen question model has one project-level timing_driver
     * and no per-area driver, so this map is intentionally empty (inert) until an approved mapping
     * is published as a new rules version.
     */
    timing_driver_area_ids: Record<string, number[]>;
    copy: LocalizedCopy<{ template: string; priority_phrases: Record<string, string> }>;
  };
  /** Deferred "near timing" threshold (Decision Log Part C): null = the primitive never fires. */
  near_timing_threshold_days: number | null;
  internal: {
    /** Information/handoff quality rating thresholds (count of explicit "not sure" answers). */
    handoff_quality: { high_max_not_sure: number; medium_max_not_sure: number };
    /** Derived decision flexibility thresholds (count of declared structured commitments). */
    decision_flexibility: { high_max_commitments: number; medium_max_commitments: number };
  };
}
