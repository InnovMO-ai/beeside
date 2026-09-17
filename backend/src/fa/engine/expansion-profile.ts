import { isAnswered } from "./conditions";
import { isNotSureValue } from "./values";

/**
 * Expansion Profile — the six-dimension radar of "degree of definition and supporting evidence
 * currently available" (owner-approved FINAL taxonomy, 2026-09-17, resolving the Design
 * Specification's own flagged open decision "Expansion Profile — six radar dimensions as a
 * permanent taxonomy"). Do not re-litigate the six dimension names/keys below — the owner was
 * explicit that this taxonomy is permanent and reused/validated again in Precision Assessment; the
 * per-dimension field mapping and scoring method ARE an internal, reversible implementation detail
 * and may be recalibrated later without a new approval gate.
 *
 * Product meaning (owner's own words, verbatim, must not drift): these dimensions do NOT represent
 * probability of success, viability, pass/fail, investment attractiveness, or a customer-facing
 * readiness score. They represent how defined each area is and how much supporting evidence the
 * respondent has already provided for it. `value` below is a continuous 0..1 internal number,
 * useful for rendering a radar axis — it is never shown to the client as a percentage, a score, or
 * any pass/fail framing. `tier` is the only thing a customer-facing surface may render directly,
 * and even then only with qualitative, evidence-based wording (see the *_TIER copy at the bottom).
 *
 * Method: each dimension lists the canonical `fa.*` field_keys (shared/canonical-fields/src/fields.ts)
 * that carry its evidence, per the owner's own conceptual mapping (2026-09-17 message). A field
 * counts toward a dimension only when it is BOTH (a) applicable to this respondent's actual journey
 * — i.e. present in `applicableFieldKeys`, never merely "exists somewhere in the bundle" — and (b)
 * answered with a real, resolved value (`isAnswered` and not an explicit "not sure"). A field the
 * respondent was never even asked (conditionally inapplicable, or absent from an older/newer pinned
 * bundle version entirely) is excluded from that dimension's denominator rather than counted
 * against them — nobody is penalized for a question they were never shown. This mirrors the
 * "no-guessing, evidence-only" approach already used for the restricted-counterparties leak fix and
 * the legacy-capability adapter: only real, verifiable evidence moves the needle.
 *
 * Known, disclosed scope limits of this first cut (non-blocking; flagged the same way
 * legacy-capability-adapter.ts flags its own gap, not silently):
 *   - `fa.needs.map`'s per-leaf selections/status and its dependency/blocker/approval structure are
 *     rich, directly relevant evidence for several dimensions (Local Ecosystem & Capabilities,
 *     Execution Preparedness in particular) but are NOT factored in here yet. Reason: an unselected
 *     leaf is genuinely ambiguous evidence (it can mean "not needed" or "didn't think of it"), and
 *     folding a composite, multi-shape field into a simple per-field completeness count would mean
 *     guessing at that distinction rather than measuring it. Left as a documented follow-up.
 *   - Regulatory & Compliance Definition has only two directly-mapped canonical fields
 *     (`fa.operation.regulated.permits_status` / `permits_which`) because First Assessment's
 *     canonical registry does not yet model tax/legal/certifications as separate fields from
 *     permits — that finer detail is deferred to Precision by design. Not a bug; documented so a
 *     future reviewer doesn't "fix" it by inventing fields that don't exist.
 */

export type ExpansionDimensionKey =
  | "market_customer_clarity"
  | "commercial_validation"
  | "operating_model_definition"
  | "regulatory_compliance_definition"
  | "local_ecosystem_capabilities"
  | "execution_preparedness";

export interface ExpansionDimensionDef {
  key: ExpansionDimensionKey;
  label: { en: string; es: string };
  /** Canonical fa.* field_keys this dimension's evidence is measured from. Order is display-only. */
  fieldKeys: readonly string[];
}

export const EXPANSION_PROFILE_DIMENSIONS: readonly ExpansionDimensionDef[] = [
  {
    key: "market_customer_clarity",
    label: { en: "Market & Customer Clarity", es: "Claridad de Mercado y Cliente" },
    fieldKeys: [
      "fa.project.destination_status",
      "fa.project.target_markets",
      "fa.project.target_location_detail",
      "fa.plan.first_customer_known",
      "fa.plan.first_customer_segment",
      "fa.plan.route_to_market",
      "fa.business.customer_model",
      "fa.company.primary_business_model",
      "fa.company.business_models",
      "fa.business.revenue_model",
    ],
  },
  {
    key: "commercial_validation",
    label: { en: "Commercial Validation", es: "Validación Comercial" },
    fieldKeys: [
      "fa.plan.demand_evidence",
      "fa.plan.competitive_landscape",
      "fa.plan.business_case",
      "fa.constraints.has_customer_contract",
      "fa.provider.investment_range",
      "fa.strategic.commercial_success",
    ],
  },
  {
    key: "operating_model_definition",
    label: { en: "Operating Model Definition", es: "Definición del Modelo Operativo" },
    fieldKeys: [
      "fa.project.entry_approach",
      "fa.project.entry_approach_structured",
      "fa.operation.components",
      "fa.operation.facilities.facility_required",
      "fa.operation.facilities.location_selected",
      "fa.operation.warehousing.current_model",
      "fa.operation.warehousing.local_expected",
      "fa.operation.freight.frequency",
      "fa.operation.freight.type",
      "fa.operation.last_mile.local_expected",
      "fa.operation.import_export.cross_border_expected",
      "fa.operation.technology.critical_systems",
      "fa.operation.technology.integration_expected",
      "fa.operation.workforce.local_hiring_expected",
      "fa.operation.workforce.first_year_headcount",
    ],
  },
  {
    key: "regulatory_compliance_definition",
    label: { en: "Regulatory & Compliance Definition", es: "Definición Regulatoria y de Cumplimiento" },
    fieldKeys: ["fa.operation.regulated.permits_status", "fa.operation.regulated.permits_which"],
  },
  {
    key: "local_ecosystem_capabilities",
    label: { en: "Local Ecosystem & Capabilities", es: "Ecosistema Local y Capacidades" },
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
    key: "execution_preparedness",
    label: { en: "Execution Preparedness", es: "Preparación para la Ejecución" },
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
      "fa.constraints.non_negotiables",
      "fa.constraints.commitment_areas",
      "fa.constraints.non_negotiable_areas",
      "fa.constraints.items",
      "fa.constraints.critical",
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
