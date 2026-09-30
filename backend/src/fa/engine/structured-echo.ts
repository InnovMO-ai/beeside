/**
 * StructuredEcho deterministic parsing module (Design Specification "beeside First Assessment —
 * Level 2 MVP", Progressive Disclosure Rules + Implementation Handoff Recommendations).
 *
 * Non-negotiable, per the brief: this module has NO dependency on any AI/LLM call. It is a single,
 * testable, rules-based engine (keyword/phrase matching only) that takes an open-text answer and
 * returns a *suggested* structured interpretation. It never writes a confirmed answer by itself —
 * confirmed facts come exclusively from the user's own confirmation of the StructuredEcho chip
 * (frontend: StructuredEchoChip.tsx writes the *_structured field via the normal saveAnswer path,
 * exactly like any other question — this module only ever produces a *suggestion*).
 *
 * Two parsers are implemented, one per StructuredEcho field currently in the bundle:
 *   - parseEntryApproach(text)  -> suggests fa.project.entry_approach_structured
 *   - parsePrimaryDriver(text)  -> suggests fa.project.primary_driver_structured
 *
 * Both share the same shape and matching approach: lower-cased, accent-stripped, whitespace-
 * normalized text is scanned for a fixed list of keyword/phrase groups, one group per option
 * value; the first group with a match wins (groups are ordered most-specific-first on purpose,
 * see comments below); no match returns `null` (no chip is shown — "no predefined checklist shown
 * before the user has spoken").
 */

export interface StructuredEchoSuggestion<TValue extends string> {
  value: TValue;
  /** The exact keyword/phrase that triggered the match, for QA/debugging — never shown to the user. */
  matchedOn: string;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents (español -> espanol) so es/en keywords both match
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch<TValue extends string>(normalized: string, groups: ReadonlyArray<{ value: TValue; keywords: readonly string[] }>): StructuredEchoSuggestion<TValue> | null {
  for (const group of groups) {
    for (const keyword of group.keywords) {
      if (normalized.includes(keyword)) return { value: group.value, matchedOn: keyword };
    }
  }
  return null;
}

export type EntryApproachValue = "direct_entity" | "distributor_partner" | "ecommerce_only" | "joint_venture" | "acquisition" | "licensing_franchise" | "representative_office" | "other";

/**
 * Matches fa.project.entry_approach free text against the fa.project.entry_approach_structured
 * value set. Order matters: "joint venture" must be checked before generic "partner" language, and
 * "acquisition/acquire" before generic "distributor" language, or a JV/acquisition answer would be
 * mis-caught by the broader distributor group.
 */
export function parseEntryApproach(text: string): StructuredEchoSuggestion<EntryApproachValue> | null {
  const normalized = normalize(text);
  return firstMatch(normalized, [
    { value: "joint_venture", keywords: ["joint venture", "empresa conjunta", "coinversion", " jv ", "jv with", "jv con"] },
    { value: "acquisition", keywords: ["acquisition", "acquire", "buy a company", "buying a company", "adquisicion", "adquirir", "comprar una empresa"] },
    { value: "licensing_franchise", keywords: ["license", "licensing", "franchise", "licencia", "licenciamiento", "franquicia"] },
    { value: "representative_office", keywords: ["representative office", "rep office", "oficina de representacion"] },
    { value: "ecommerce_only", keywords: ["ecommerce", "e-commerce", "online only", "online store", "solo en linea", "tienda en linea", "comercio electronico"] },
    { value: "distributor_partner", keywords: ["distributor", "reseller", "local partner", "commercial partner", "agent", "distribuidor", "socio local", "socio comercial", "representante", "agente"] },
    { value: "direct_entity", keywords: ["set up our own", "own entity", "own subsidiary", "direct entity", "open our own", "propia entidad", "subsidiaria propia", "entidad propia", "abrir nuestra propia"] },
  ]);
}

export type PrimaryDriverValue =
  | "existing_customer_demand"
  | "new_market_opportunity"
  | "growth_targets"
  | "customer_request"
  | "supply_chain_strategy"
  | "cost_advantage"
  | "diversification"
  | "competitive_pressure"
  | "investor_board_direction"
  | "other";

/**
 * Matches fa.project.story_raw free text against the fa.project.primary_driver_structured value
 * set (shared value set with fa.goal.expansion_driver by design). "A specific customer asked us"
 * is checked before generic "customer demand" language so a request-shaped sentence isn't
 * swallowed by the broader demand group.
 */
export function parsePrimaryDriver(text: string): StructuredEchoSuggestion<PrimaryDriverValue> | null {
  const normalized = normalize(text);
  return firstMatch(normalized, [
    { value: "customer_request", keywords: ["a customer asked", "client asked", "customer requested", "at the request of", "un cliente nos pidio", "a peticion de un cliente", "cliente solicito"] },
    { value: "investor_board_direction", keywords: ["our board", "the board decided", "investors want", "board direction", "nuestro consejo", "el consejo decidio", "los inversionistas quieren"] },
    { value: "competitive_pressure", keywords: ["our competitors", "competitive pressure", "losing market share", "competitors are already", "nuestros competidores", "presion competitiva", "perdiendo mercado"] },
    { value: "cost_advantage", keywords: ["lower cost", "cheaper to", "cost advantage", "reduce costs", "costo mas bajo", "ventaja en costos", "reducir costos"] },
    { value: "supply_chain_strategy", keywords: ["supply chain", "closer to our suppliers", "nearshor", "cadena de suministro", "cerca de nuestros proveedores"] },
    { value: "diversification", keywords: ["diversify", "not depend on one market", "spread our risk", "diversificar", "no depender de un solo mercado"] },
    { value: "growth_targets", keywords: ["growth target", "grow revenue", "hit our growth", "meta de crecimiento", "crecer los ingresos"] },
    { value: "existing_customer_demand", keywords: ["our customers are asking", "existing customers want", "demand from our customers", "nuestros clientes actuales piden", "demanda de nuestros clientes"] },
    { value: "new_market_opportunity", keywords: ["saw an opportunity", "market opportunity", "new opportunity", "oportunidad de mercado", "vimos una oportunidad"] },
  ]);
}

/** Registry used by StructuredEchoChip.tsx to look up the right parser per structured field key. */
export const STRUCTURED_ECHO_PARSERS: Record<string, (text: string) => StructuredEchoSuggestion<string> | null> = {
  "fa.project.entry_approach_structured": (text) => parseEntryApproach(text),
  "fa.project.primary_driver_structured": (text) => parsePrimaryDriver(text),
};

/** The open-text field each structured field is parsed from (drives when the chip is offered). */
export const STRUCTURED_ECHO_SOURCE_FIELD: Record<string, string> = {
  "fa.project.entry_approach_structured": "fa.project.entry_approach",
  "fa.project.primary_driver_structured": "fa.project.story_raw",
};
