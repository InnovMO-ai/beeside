/**
 * Client-side mirror of backend/src/fa/engine/structured-echo.ts (same mirroring convention as
 * types.ts). Duplicated rather than fetched over the network so StructuredEchoChip can offer its
 * suggestion instantly, with no round trip, right as the respondent finishes typing — the backend's
 * copy is authoritative for anything persisted; this one only decides whether to show a chip.
 * Keep the two files' keyword lists in sync by hand; a drift here only ever means a chip that under-
 * or over-offers a suggestion, never a wrong *stored* answer (the respondent always confirms).
 */

export interface StructuredEchoSuggestion<TValue extends string> {
  value: TValue;
  matchedOn: string;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
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

export const STRUCTURED_ECHO_PARSERS: Record<string, (text: string) => StructuredEchoSuggestion<string> | null> = {
  "fa.project.entry_approach_structured": (text) => parseEntryApproach(text),
  "fa.project.primary_driver_structured": (text) => parsePrimaryDriver(text),
};

export const STRUCTURED_ECHO_SOURCE_FIELD: Record<string, string> = {
  "fa.project.entry_approach_structured": "fa.project.entry_approach",
  "fa.project.primary_driver_structured": "fa.project.story_raw",
};
