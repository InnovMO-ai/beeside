import type { Locale } from "./bundle-types";
import type { ExecutionDemandTier } from "./execution-demand";
import type { RenderedExecutionDemand, RenderedExpansionDimension } from "../../snapshot/compose";

/**
 * Narrative Interpretation Library (Macroblock 7 — Final Gap Closure).
 *
 * Deterministic, rule-based copy for the three frozen sections that were data-only until now:
 * Key Reading, the Market Evidence narrative, and the Execution Pressure narrative. Every branch and
 * every EN/ES sentence below is verbatim from the Product Owner's own "MACROBLOCK 7 — NARRATIVE
 * INTERPRETATION LIBRARY" instruction (2026-09-28) — nothing here is generated or paraphrased.
 *
 * Ground rules (also the Product Owner's own, enforced structurally by this file):
 *  - No free-form AI generation — every string is a fixed literal, chosen by a branch, never composed.
 *  - No new scoring — this module only reads the tiers `scoreExpansionProfile()` (Definition &
 *    Evidence, three tiers) and `scoreExecutionDemand()` (Execution Demand, five tiers + NOT_EVALUABLE)
 *    already compute. It aggregates those existing per-dimension tiers into an overall pattern; it
 *    never recomputes a dimension's value or introduces a new field-level formula.
 *  - Every output traces to an approved state/tier — see the inline citation on each branch.
 */

export interface NarrativeInterpretation {
  keyReading: string | null;
  marketEvidenceNarrative: string | null;
  executionPressureNarrative: string | null;
}

const DEMAND_ORDINAL: Record<ExecutionDemandTier, number> = { low: 0, low_medium: 1, medium: 2, medium_high: 3, high: 4 };
const HIGH_OR_MEDIUM_HIGH: ReadonlySet<ExecutionDemandTier> = new Set(["high", "medium_high"]);

/**
 * Minimum number of the five *structurally evaluable* Execution Demand dimensions (Commercial
 * Ambition & Differentiation is always NOT_EVALUABLE by design — see execution-demand.ts — so it is
 * never part of this denominator) that must actually be evaluable before an overall demand pattern is
 * defensible. Below this, Key Reading uses pattern E and Execution Pressure uses pattern D instead of
 * risking a pattern built on 1-2 data points. This is the one threshold the Product Owner explicitly
 * left to this session's judgment ("you may refine the exact triggering thresholds... document the
 * trigger logic clearly") — set to a bare majority (3 of 5) of the dimensions that can ever carry an
 * Execution Demand reading.
 */
const MIN_EVALUABLE_FOR_DEMAND_PATTERN = 3;

/** Definition & Evidence "well defined" threshold, reused as-is from expansion-profile.ts's own
 *  tierFor() cut point (TIER_THRESHOLDS.wellDefined) — applied here to the six-dimension mean rather
 *  than a single dimension's value, to summarize "clarity" as one overall reading. Not a new score:
 *  it is the same threshold the six per-dimension tiers already use, aggregated. */
const CLARITY_HIGH_MEAN_THRESHOLD = 0.7;

/** Same reasoning as CLARITY_HIGH_MEAN_THRESHOLD, but for the five-point Execution Demand tier
 *  vocabulary expressed as ordinals 0..4 (low..high). A mean ordinal of 3 corresponds to "medium_high
 *  or above on average" — i.e. the same tier cut used per-dimension (medium_high/high are the two
 *  tiers this file treats as "high" everywhere else, e.g. Execution Pressure below), applied to the
 *  overall mean instead of one axis. */
const DEMAND_HIGH_MEAN_ORDINAL_THRESHOLD = 3;

function overallClarityHigh(dims: readonly RenderedExpansionDimension[]): boolean {
  const mean = dims.reduce((sum, d) => sum + d.value, 0) / dims.length;
  return mean >= CLARITY_HIGH_MEAN_THRESHOLD;
}

function evaluableDemand(dims: readonly RenderedExpansionDimension[]): Array<{ dim: RenderedExpansionDimension; demand: RenderedExecutionDemand }> {
  return dims
    .filter((d): d is RenderedExpansionDimension & { demand: RenderedExecutionDemand } => d.demand !== null)
    .map((d) => ({ dim: d, demand: d.demand }));
}

function overallDemandHigh(evaluable: ReadonlyArray<{ demand: RenderedExecutionDemand }>): boolean {
  const meanOrdinal = evaluable.reduce((sum, e) => sum + DEMAND_ORDINAL[e.demand.tier], 0) / evaluable.length;
  return meanOrdinal >= DEMAND_HIGH_MEAN_ORDINAL_THRESHOLD;
}

// ---------------------------------------------------------------------------------------------
// 1. KEY READING — one short executive interpretation of the overall Snapshot pattern.
// Dominant pattern from the six dimensions: overall Definition & Evidence clarity crossed with
// overall Execution Demand. Five branches (A-E), verbatim Product Owner copy.
// ---------------------------------------------------------------------------------------------
const KEY_READING_COPY: Record<"a" | "b" | "c" | "d" | "e", { en: string; es: string }> = {
  a: {
    en: "Your expansion plan is relatively well defined. The next step is less about defining the direction and more about organizing execution around the areas that still require attention.",
    es: "Tu plan de expansión está relativamente bien definido. El siguiente paso depende menos de definir la dirección y más de organizar la ejecución en las áreas que todavía requieren atención.",
  },
  b: {
    en: "Your expansion direction is clear, but execution will require coordinated work across several fronts. The challenge is not deciding where to go, but sequencing and activating the right capabilities.",
    es: "La dirección de tu expansión está clara, pero la ejecución requerirá coordinación en varios frentes. El reto no es decidir hacia dónde ir, sino secuenciar y activar las capacidades correctas.",
  },
  c: {
    en: "The execution path does not appear unusually complex, but several important elements of the plan still need definition before the project can move forward with confidence.",
    es: "La ruta de ejecución no parece especialmente compleja, pero varios elementos importantes del plan todavía necesitan definición antes de avanzar con mayor certeza.",
  },
  d: {
    en: "Several important decisions remain open while the project also carries meaningful execution demands. Clarifying the plan before activating providers will reduce friction and avoid unnecessary rework.",
    es: "Varias decisiones importantes siguen abiertas y, al mismo tiempo, el proyecto presenta demandas relevantes de ejecución. Aclarar el plan antes de activar proveedores reducirá fricción y evitará retrabajo innecesario.",
  },
  e: {
    en: "There is not yet enough confirmed information to produce a reliable overall reading. Completing the open decisions will make the execution picture clearer.",
    es: "Todavía no hay suficiente información confirmada para producir una lectura general confiable. Completar las decisiones pendientes permitirá entender mejor el panorama de ejecución.",
  },
};

function keyReading(dims: readonly RenderedExpansionDimension[], locale: Locale): string {
  const evaluable = evaluableDemand(dims);
  if (evaluable.length < MIN_EVALUABLE_FOR_DEMAND_PATTERN) return KEY_READING_COPY.e[locale];
  const clarityHigh = overallClarityHigh(dims);
  const demandHigh = overallDemandHigh(evaluable);
  if (clarityHigh && !demandHigh) return KEY_READING_COPY.a[locale];
  if (clarityHigh && demandHigh) return KEY_READING_COPY.b[locale];
  if (!clarityHigh && !demandHigh) return KEY_READING_COPY.c[locale];
  return KEY_READING_COPY.d[locale];
}

// ---------------------------------------------------------------------------------------------
// 2. MARKET EVIDENCE — NARRATIVE. Primary signal: the Market Evidence dimension's own Definition &
// Evidence tier (well_defined/partially_defined/early_stage — expansion-profile.ts's existing,
// unchanged vocabulary). Execution Demand is context only, via one optional appended sentence.
// ---------------------------------------------------------------------------------------------
const MARKET_EVIDENCE_COPY: Record<"wellDefined" | "partiallyDefined" | "earlyStage" | "notEvaluable" | "demandAppend", { en: string; es: string }> = {
  wellDefined: {
    en: "The target market is supported by a comparatively clear commercial rationale. The remaining work is primarily about validating and executing the chosen path.",
    es: "El mercado objetivo está respaldado por una lógica comercial relativamente clara. El trabajo pendiente se concentra principalmente en validar y ejecutar la ruta elegida.",
  },
  partiallyDefined: {
    en: "The market direction is taking shape, but some of the evidence needed to support the expansion decision is still incomplete.",
    es: "La dirección de mercado está tomando forma, pero parte de la evidencia necesaria para sustentar la decisión de expansión todavía está incompleta.",
  },
  earlyStage: {
    en: "The market case is still at an early stage. Key assumptions about where and how to compete need further definition before execution.",
    es: "El caso de mercado todavía se encuentra en una etapa temprana. Es necesario definir mejor supuestos clave sobre dónde y cómo competir antes de ejecutar.",
  },
  notEvaluable: {
    en: "There is not enough confirmed market information yet to produce a reliable reading.",
    es: "Todavía no hay suficiente información de mercado confirmada para producir una lectura confiable.",
  },
  demandAppend: {
    en: "At the same time, the remaining market work implies a meaningful execution load.",
    es: "Al mismo tiempo, el trabajo pendiente de mercado implica una carga relevante de ejecución.",
  },
};

/**
 * `marketEvidenceNotApplicable`: true when the Market Evidence dimension's Definition & Evidence
 * `applicableFieldCount` is 0 — none of its three fields (destination_status, target_markets,
 * first_customer_known) were applicable in this respondent's journey (`ExpansionDimensionScore`,
 * expansion-profile.ts; internal-only, so it must be read at the `renderLocale()` call site before
 * the client-safe `RenderedExpansionDimension` is built, and passed in here already reduced to a
 * boolean). Definition & Evidence's own `tierFor()` has no NOT_EVALUABLE state — an unasked dimension
 * still comes back "early_stage" by construction (value defaults to 0) — so without this signal
 * branch D could never fire and an unasked dimension would misleadingly read as "assessed and found
 * weak" (branch C) instead of "not asked at all" (branch D). This reuses an already-computed internal
 * field rather than inventing a new state, per the Product Owner's instruction.
 */
function marketEvidenceNarrative(marketEvidence: RenderedExpansionDimension, marketEvidenceNotApplicable: boolean, locale: Locale): string {
  if (marketEvidenceNotApplicable) return MARKET_EVIDENCE_COPY.notEvaluable[locale];
  const base =
    marketEvidence.tier === "well_defined"
      ? MARKET_EVIDENCE_COPY.wellDefined[locale]
      : marketEvidence.tier === "partially_defined"
        ? MARKET_EVIDENCE_COPY.partiallyDefined[locale]
        : MARKET_EVIDENCE_COPY.earlyStage[locale];
  const demandTier = marketEvidence.demand?.tier;
  if (demandTier && HIGH_OR_MEDIUM_HIGH.has(demandTier)) {
    return `${base} ${MARKET_EVIDENCE_COPY.demandAppend[locale]}`;
  }
  return base;
}

// ---------------------------------------------------------------------------------------------
// 3. EXECUTION PRESSURE — NARRATIVE. Summarizes where execution effort concentrates, using only
// evaluable Execution Demand dimensions and the existing high/medium-high tiers — no new ranking.
// ---------------------------------------------------------------------------------------------
const EXECUTION_PRESSURE_COPY = {
  contained: {
    en: "Execution pressure appears relatively contained. The project is more likely to benefit from disciplined coordination than from heavy operational intervention.",
    es: "La presión de ejecución parece relativamente contenida. El proyecto probablemente se beneficiará más de una coordinación disciplinada que de una intervención operativa intensa.",
  },
  one: {
    en: "Execution pressure is concentrated primarily in {dimension}. This is the area most likely to require early coordination and specialist support.",
    es: "La presión de ejecución se concentra principalmente en {dimension}. Esta es el área que probablemente requerirá coordinación temprana y apoyo especializado.",
  },
  two: {
    en: "Execution pressure is distributed across several areas, particularly {top_dimension_1} and {top_dimension_2}. Sequencing these workstreams will be important to avoid dependencies becoming bottlenecks.",
    es: "La presión de ejecución se distribuye entre varias áreas, especialmente {top_dimension_1} y {top_dimension_2}. Será importante secuenciar estos frentes para evitar que las dependencias se conviertan en cuellos de botella.",
  },
  tooFew: {
    en: "There is not yet enough confirmed execution data to identify where pressure will concentrate.",
    es: "Todavía no hay suficiente información de ejecución confirmada para identificar dónde se concentrará la presión.",
  },
} as const;

function fill(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((text, [key, value]) => text.replace(`{${key}}`, value), template);
}

function executionPressureNarrative(dims: readonly RenderedExpansionDimension[], locale: Locale): string {
  const evaluable = evaluableDemand(dims);
  if (evaluable.length < MIN_EVALUABLE_FOR_DEMAND_PATTERN) return EXECUTION_PRESSURE_COPY.tooFew[locale];
  // Only dimensions carrying the two highest Execution Demand tiers count as "pressure" — the same
  // high/medium_high cut Key Reading and the Market Evidence append-sentence use. Stable sort (ES2019
  // guarantee) preserves the canonical EXPANSION_PROFILE_DIMENSIONS order among equal-tier dimensions,
  // so ties never invent a secondary ranking — exactly as instructed.
  const pressured = evaluable
    .filter((e) => HIGH_OR_MEDIUM_HIGH.has(e.demand.tier))
    .sort((a, b) => DEMAND_ORDINAL[b.demand.tier] - DEMAND_ORDINAL[a.demand.tier]);
  if (pressured.length === 0) return EXECUTION_PRESSURE_COPY.contained[locale];
  if (pressured.length === 1) return fill(EXECUTION_PRESSURE_COPY.one[locale], { dimension: pressured[0]!.dim.label });
  return fill(EXECUTION_PRESSURE_COPY.two[locale], {
    top_dimension_1: pressured[0]!.dim.label,
    top_dimension_2: pressured[1]!.dim.label,
  });
}

/**
 * Single entry point wired from `compose.ts`'s `renderLocale()`, right after `expansionProfile` (the
 * client-facing, already-localized Dual Expansion Profile array) is built and while the internal
 * `scoreExpansionProfile()` result (source of `marketEvidenceNotApplicable`) is still in scope.
 */
export function composeNarrativeInterpretation(
  expansionProfile: readonly RenderedExpansionDimension[],
  marketEvidenceNotApplicable: boolean,
  locale: Locale,
): NarrativeInterpretation {
  const marketEvidence = expansionProfile.find((d) => d.key === "market_evidence");
  return {
    keyReading: keyReading(expansionProfile, locale),
    marketEvidenceNarrative: marketEvidence ? marketEvidenceNarrative(marketEvidence, marketEvidenceNotApplicable, locale) : null,
    executionPressureNarrative: executionPressureNarrative(expansionProfile, locale),
  };
}
