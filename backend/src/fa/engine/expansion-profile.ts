import { isAnswered } from "./conditions";
import { isNotSureValue } from "./values";

/**
 * Expansion Profile — the six-dimension "degree of definition and supporting evidence currently
 * available" axis set.
 *
 * MACROBLOCK 7 (Snapshot Runtime Convergence, 2026-09-28) SUPERSEDES the prior "owner-approved
 * FINAL taxonomy, 2026-09-17" comment that used to sit here. Per the Product Owner's explicit
 * Macroblock 7 governing decisions, cross-checked directly against the frozen Snapshot artifact
 * (`snapshot_etapa4_FROZEN_v8-night-shift.html`), the six dimensions are renamed and remapped to:
 * Market Evidence, Commercial Ambition & Differentiation, Local Capability Base, Governance &
 * Constraints, Financial Framework, Activation Planning. This replaces the six dimensions this file
 * previously called permanent (Market & Customer Clarity, Commercial Validation, Operating Model
 * Definition, Regulatory & Compliance Definition, Local Ecosystem & Capabilities, Execution
 * Preparedness) — Operating Model Definition in particular is retired outright (Macroblock 7
 * decision #4), not renamed. Do not re-litigate this new set without going back to the Product
 * Owner and the frozen Snapshot artifact — the same "do not silently redrift" discipline that
 * governed the previous taxonomy now governs this one.
 *
 * Product meaning (unchanged, still must not drift): these dimensions do NOT represent probability
 * of success, viability, pass/fail, investment attractiveness, or a customer-facing readiness
 * score. They represent how defined each area is and how much supporting evidence the respondent
 * has already provided for it. `value` below is a continuous 0..1 internal number, useful for
 * rendering a radar axis — it is never shown to the client as a percentage, a score, or any
 * pass/fail framing. `tier` is the only thing a customer-facing surface may render directly, and
 * even then only with qualitative, evidence-based wording (see the *_TIER copy at the bottom).
 *
 * Method (unchanged from the prior taxonomy, still an internal/reversible implementation detail):
 * each dimension lists the canonical `fa.*` field_keys (shared/canonical-fields/src/fields.ts) that
 * carry its evidence. A field counts toward a dimension only when it is BOTH (a) applicable to this
 * respondent's actual journey — i.e. present in `applicableFieldKeys` — and (b) answered with a
 * real, resolved value (`isAnswered` and not an explicit "not sure"). A field the respondent was
 * never even asked is excluded from that dimension's denominator rather than counted against them.
 *
 * KNOWN, DISCLOSED SCOPE LIMITS OF THIS CONVERGENCE PASS (flagged, not silently absorbed —
 * reported to the Product Owner alongside this change):
 *   - This module scores only the "Definition & Evidence" series (defined/applicable ratio). The
 *     frozen Snapshot's dumbbell and radar also plot a SECOND series per axis — "Execution Demand"
 *     (how much execution burden the respondent's declared scope implies) — approved by the Product
 *     Owner in the Macroblock 7 Execution Demand methodology addendum (2026-09-28) after the open
 *     points flagged in the 2026-09-24 Etapa 2 review (ordinal-value validity per field, the
 *     investment_range double-count risk, no minimum-evaluable threshold) were resolved: unweighted
 *     averaging, shared applicability/not-sure-exclusion rules, mechanical minimum-evaluable
 *     thresholds per dimension, and investment_range confined to exactly one dimension (Financial
 *     Framework). That series is implemented separately in `execution-demand.ts`
 *     (`scoreExecutionDemand`) rather than in this file, and composed alongside this module's output
 *     in `snapshot/compose.ts` — kept as a distinct module because it is a genuinely different
 *     scoring concept (execution burden, not definition completeness) with its own NOT_EVALUABLE
 *     reasons, not a variant of this file's method.
 *   - Commercial Ambition & Differentiation has no canonical field for "differentiators" yet
 *     (fa.* registry checked directly, 2026-09-28) — the axis is scored from success-objective and
 *     expansion-driver evidence only, documented as a partial-fidelity axis.
 *   - Financial Framework has no canonical field for the qualitative APPROVED/ESTIMATED/IN
 *     DEFINITION/NOT ANALYZED/PREFER NOT TO SHARE state model the Etapa 2 methodology specifies —
 *     only `fa.provider.investment_range` exists, an amount-bucket field. Per the Product Owner's
 *     own instruction that amount must never drive this axis's score, this dimension scores only
 *     whether a financial reference was given at all (any bucket other than "not_yet_defined"
 *     counts as defined), never which bucket. This is a documented proxy, not the full state model.
 *   - Governance & Constraints now absorbs the non-negotiables/restricted-areas fields that used to
 *     sit under Execution Preparedness (Activation Planning's predecessor), because the frozen
 *     Snapshot's Value Bridge trigger rules (Operation Hub — secure) explicitly key off "Governance
 *     & Constraints findings (non-negotiable areas, restrictions, compliance requirements)" —
 *     confirmed in project doc snapshot-etapa2-value-bridges-ronda-final.md, 2026-09-24.
 */

export type ExpansionDimensionKey =
  | "market_evidence"
  | "commercial_ambition_differentiation"
  | "local_capability_base"
  | "governance_constraints"
  | "financial_framework"
  | "activation_planning";

export interface ExpansionDimensionDef {
  key: ExpansionDimensionKey;
  label: { en: string; es: string };
  /** Canonical fa.* field_keys this dimension's evidence is measured from. Order is display-only. */
  fieldKeys: readonly string[];
}

export const EXPANSION_PROFILE_DIMENSIONS: readonly ExpansionDimensionDef[] = [
  {
    key: "market_evidence",
    label: { en: "Market Evidence", es: "Evidencia de Mercado" },
    fieldKeys: [
      "fa.project.destination_status",
      "fa.project.target_markets",
      "fa.project.target_location_detail",
      "fa.plan.first_customer_known",
      "fa.plan.first_customer_segment",
      "fa.plan.route_to_market",
      "fa.plan.demand_evidence",
      "fa.plan.competitive_landscape",
      "fa.business.customer_model",
      "fa.company.primary_business_model",
      "fa.company.business_models",
      "fa.business.revenue_model",
    ],
  },
  {
    key: "commercial_ambition_differentiation",
    label: { en: "Commercial Ambition & Differentiation", es: "Ambición Comercial y Diferenciación" },
    fieldKeys: [
      "fa.goal.success_definition",
      "fa.strategic.commercial_success",
      "fa.goal.expansion_driver",
      "fa.project.primary_driver_structured",
      "fa.plan.business_case",
    ],
  },
  {
    key: "local_capability_base",
    label: { en: "Local Capability Base", es: "Base de Capacidades Locales" },
    fieldKeys: [
      "fa.operation.partners.dependency",
      "fa.operation.partners.relationship_status",
      "fa.operation.sourcing.local_expected",
      "fa.operation.sourcing.relationship_status",
      "fa.operation.sourcing.critical_supplier_count",
      "fa.operation.banking_status",
      "fa.operation.insurance_status",
      "fa.operation.growth_focus",
      "fa.operation.expected_capabilities",
    ],
  },
  {
    key: "governance_constraints",
    label: { en: "Governance & Constraints", es: "Gobernanza y Restricciones" },
    fieldKeys: [
      "fa.operation.regulated.permits_status",
      "fa.operation.regulated.permits_which",
      "fa.constraints.non_negotiables",
      "fa.constraints.non_negotiable_areas",
      "fa.constraints.items",
      "fa.constraints.critical",
      "fa.provider.requires_language",
      "fa.provider.required_language",
      "fa.provider.requires_local_presence",
      "fa.provider.required_presence_countries",
    ],
  },
  {
    key: "financial_framework",
    label: { en: "Financial Framework", es: "Marco Financiero" },
    fieldKeys: ["fa.provider.investment_range"],
  },
  {
    key: "activation_planning",
    label: { en: "Activation Planning", es: "Planeación de Activación" },
    fieldKeys: [
      "fa.project.next_decision",
      "fa.goal.launch_timing_status",
      "fa.goal.launch_target",
      "fa.goal.timing_driver",
      "fa.priority.priority_known",
      "fa.priority.client_priority",
      "fa.priority.timing",
      "fa.priority.date_flexibility",
      "fa.priority.date_flexibility_reason",
      "fa.provider.resource_availability",
      "fa.provider.resource_gap",
      "fa.strategic.decided_vs_open",
      "fa.strategic.slowdown_concern",
      "fa.constraints.existing_commitments",
      "fa.constraints.commitment_areas",
      "fa.project.stop_go_criteria",
      "fa.project.primary_concern",
    ],
  },
];

export type ExpansionDefinitionTier = "well_defined" | "partially_defined" | "early_stage";

/** Thresholds are an internal, reversible calibration — not part of the owner-approved taxonomy. */
const TIER_THRESHOLDS = { wellDefined: 0.7, partiallyDefined: 0.35 };

function tierFor(value: number): ExpansionDefinitionTier {
  if (value >= TIER_THRESHOLDS.wellDefined) return "well_defined";
  if (value >= TIER_THRESHOLDS.partiallyDefined) return "partially_defined";
  return "early_stage";
}

export interface ExpansionDimensionScore {
  key: ExpansionDimensionKey;
  label: { en: string; es: string };
  /** Continuous 0..1 internal value for radar rendering only — never surfaced as a number/percentage/
   *  score to the client. */
  value: number;
  tier: ExpansionDefinitionTier;
  /** How many of this dimension's applicable fields carry a real, resolved answer. Internal-only
   *  (Internal Assessment), never part of the client Snapshot payload. */
  definedFieldCount: number;
  /** How many of this dimension's fields were actually applicable to this respondent's journey. */
  applicableFieldCount: number;
}

/**
 * Scores all six Expansion Profile dimensions from the project's effective answers.
 *
 * `applicableFieldKeys` MUST be the set of field_keys whose question was applicable in the
 * respondent's journey (derive from `JourneyState.applicableQuestionIds` mapped through the pinned
 * bundle's `questions[].field_key` — see snapshot-service.ts) — never just `answers.keys()`, which
 * only contains applicable-AND-answered fields and so cannot distinguish "not yet answered" from
 * "does not apply to this respondent".
 */
export function scoreExpansionProfile(answers: ReadonlyMap<string, unknown>, applicableFieldKeys: ReadonlySet<string>): ExpansionDimensionScore[] {
  return EXPANSION_PROFILE_DIMENSIONS.map((dimension) => {
    const applicable = dimension.fieldKeys.filter((key) => applicableFieldKeys.has(key));
    const defined = applicable.filter((key) => {
      const value = answers.get(key);
      return isAnswered(value) && !isNotSureValue(value);
    });
    const value = applicable.length > 0 ? defined.length / applicable.length : 0;
    return {
      key: dimension.key,
      label: dimension.label,
      value,
      tier: tierFor(value),
      definedFieldCount: defined.length,
      applicableFieldCount: applicable.length,
    };
  });
}

/** Which dimension (if any) a given field_key is mapped to. Tooling/tests only. */
export function dimensionForFieldKey(fieldKey: string): ExpansionDimensionKey | undefined {
  return EXPANSION_PROFILE_DIMENSIONS.find((d) => d.fieldKeys.includes(fieldKey))?.key;
}

/** Qualitative, evidence-based tier copy — the only client-facing wording for a dimension's state.
 *  Deliberately avoids "score", "ready", "pass", "risk" or any probability/investment framing. */
export const EXPANSION_TIER_COPY: Record<ExpansionDefinitionTier, { en: string; es: string }> = {
  well_defined: { en: "Well defined", es: "Bien definido" },
  partially_defined: { en: "Partially defined", es: "Parcialmente definido" },
  early_stage: { en: "Early stage", es: "Etapa inicial" },
};
