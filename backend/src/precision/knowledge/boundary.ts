/**
 * Professional boundary. Knowledge orients and helps ask better questions; it never replaces the specialist's work.
 *
 * A client question that asks for a DETERMINATION about their own operation (which option is best, what tax result applies, whether
 * something is legal, how to structure employment, how to optimise a route, which market to enter, whether to invest) is professional
 * work. Precision may give general, sourced context when approved knowledge exists, but it states the boundary and leaves the
 * determination to a beeside specialist. Pure and bilingual (Spanish is the product language; English is kept for parity).
 */
import { fold } from "../understanding/text";

export const BOUNDARY_KINDS = ["best_option", "tax_conclusion", "legal_opinion", "labor_advice", "logistics_optimization", "market_entry_comparison", "investment_recommendation"] as const;
export type BoundaryKind = (typeof BOUNDARY_KINDS)[number];

/** The area a specialist owns for each kind (used for routing; never shown as a promise of an outcome). */
export const BOUNDARY_AREA: Record<BoundaryKind, { es: string; en: string; categoryKey: string | null }> = {
  best_option: { es: "la elección de la mejor opción para tu operación", en: "choosing the best option for your operation", categoryKey: null },
  tax_conclusion: { es: "la conclusión fiscal de tu caso", en: "the tax conclusion for your case", categoryKey: "tax_accounting_audit" },
  legal_opinion: { es: "la opinión legal sobre tu caso", en: "the legal opinion on your case", categoryKey: "corporate_legal_admin" },
  labor_advice: { es: "la asesoría laboral de tu caso", en: "the labor advice for your case", categoryKey: "people_payroll_employment" },
  logistics_optimization: { es: "la optimización logística de tu operación", en: "the logistics optimisation of your operation", categoryKey: "logistics" },
  market_entry_comparison: { es: "la comparación de mercados de entrada para tu caso", en: "the comparison of entry markets for your case", categoryKey: "market_intelligence" },
  investment_recommendation: { es: "la recomendación de inversión para tu caso", en: "the investment recommendation for your case", categoryKey: null },
};

/** Ordered: the first kind whose pattern matches wins (most specific first). Patterns run on accent-folded lowercase text. */
const RULES: { kind: BoundaryKind; any: RegExp[] }[] = [
  { kind: "investment_recommendation", any: [/\bvale la pena invertir\b/, /\bme conviene invertir\b/, /\b(deberia|debo|conviene) invertir\b/, /\bretorno (de|sobre) (la )?inversion\b/, /\broi\b/, /\bshould i invest\b/, /\bis it worth investing\b/, /\bworth the investment\b/] },
  { kind: "tax_conclusion", any: [/\b(cuanto|que) (isr|iva|impuesto|impuestos)\b.*\b(pagar|pagaria|pagare|me toca|aplica)/, /\b(puedo|podria|debo|tengo que) (deducir|acreditar|tributar|pagar (isr|iva|impuesto))/, /\bme conviene (tributar|facturar|el regimen)/, /\bque (regimen|tratamiento) fiscal (me )?(aplica|corresponde|conviene)/, /\bcomo (tributaria|tributaria|tributo)\b/, /\bwhat (tax|vat) (will|would) i (pay|owe)\b/, /\bcan i deduct\b/, /\bwhich tax (regime|treatment) (applies|is best)\b/, /\bhow (will|would) .{0,40}be taxed\b/] },
  { kind: "legal_opinion", any: [/\b(es|seria) legal\b/, /\bpuedo (legalmente|constituir|operar sin|contratar sin)\b/, /\bme obliga(n)?\b/, /\bes obligatorio para (mi|nosotros|mi empresa)\b/, /\bcumplo con (la ley|la norma|la regulacion)\b/, /\bis it legal\b/, /\bam i (legally )?required\b/, /\bdo i comply\b/, /\bam i allowed to\b/] },
  { kind: "labor_advice", any: [/\b(despedir|despido|liquidar|finiquito|rescision)\b/, /\bcomo (debo|deberia|puedo) contratar\b/, /\b(subcontrat|outsourc)\w*\b.*\b(puedo|debo|conviene|legal)\b/, /\b(honorarios|empleado|nomina)\b.*\b(me conviene|que conviene|cual conviene)\b/, /\bhow should i (hire|employ)\b/, /\b(fire|terminate) (an |a |my )?(employee|worker)s?\b/, /\bcontractor or employee\b/] },
  { kind: "logistics_optimization", any: [/\b(mejor|optima|mas barata|mas rapida|mas eficiente) ruta\b/, /\boptimizar\b.*\b(ruta|flete|envio|cadena|inventario|almacen)/, /\bcomo (reduzco|bajo) (el )?(costo|costos) (de )?(flete|logistic|transporte|envio)/, /\bconsolidar\b.*\b(carga|envios|embarques)/, /\bcheapest (route|shipping)\b/, /\boptimi[sz]e\b.*\b(route|freight|shipping|supply chain)\b/] },
  { kind: "market_entry_comparison", any: [/\b(en )?que (pais|mercado)s? (me conviene|debo entrar|deberia entrar|es mejor)\b/, /\b(comparar|compara|comparame)\b.*\b(mercados?|paises)\b.*\b(entrar|entrada|expandir)/, /\bmejor (pais|mercado) (para|donde) (entrar|expandir|empezar)\b/, /\bwhich (country|market) (should i|is best to) (enter|expand)\b/, /\bbest (country|market) to (enter|start)\b/] },
  { kind: "best_option", any: [/\b(cual|que) (es )?(la )?(mejor|ideal|optim[ao]) (opcion|ciudad|estado|puerto|ubicacion|zona|parque|region|aduana|ruta|alternativa|lugar)\b/, /\b(donde|en que (estado|ciudad|puerto)) (me conviene|deberia|debo|es mejor)\b/, /\bcual me conviene\b/, /\b(es|seria) (la )?(mejor|ideal) (opcion )?\w*\s*(para|en)\b.*\b(mi|nuestra)\b/, /\bwhich (is|would be) (the )?best (option|city|state|port|location|site)\b/, /\bwhere should (i|we) (locate|set up|base)\b/, /\bis [a-z]+ the best (option|port|city|location)\b/, /\bes [a-zñ]+ la mejor opcion\b/] },
];

/** Returns the professional-judgment kind the question asks for, or null when it is a request for context/information. */
export function professionalAsk(question: string): BoundaryKind | null {
  const f = fold(question).replace(/\s+/g, " ");
  for (const r of RULES) if (r.any.some((re) => re.test(f))) return r.kind;
  return null;
}
