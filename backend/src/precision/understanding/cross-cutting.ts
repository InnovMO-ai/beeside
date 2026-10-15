/**
 * Cross-cutting material facts. A fact the client states that matters for several categories (or for none in particular) is captured
 * here, deterministically and with the client's own sentence, instead of being dropped because no probe or category owns it.
 * Only the client's words count (never an AI proposal); the quote must occur in the text; the same fact is never captured twice.
 */
import { fold } from "./text";
import type { CrossCuttingItem, CrossKind, Frame, Loc, Provenance } from "./types";

interface Marker { kind: CrossKind; re: RegExp; categories: string[] }

const LEGAL_TAX_HR = ["corporate_legal_admin", "tax_accounting_audit", "people_payroll_employment"];

/** Patterns over FOLDED text (no accents, lower case). Conservative: a marker needs an explicit statement, not a topic word. */
const MARKERS: readonly Marker[] = [
  { kind: "existing_presence", categories: LEGAL_TAX_HR,
    re: /\bya (?:tenemos|contamos con|operamos con|tiene|tienen|existe|hay) (?:una |un )?(?:filial|subsidiaria|sociedad|empresa|entidad|oficina|sucursal)[^.;]{0,60}(?:en|de) (?:mexico|el pais|alli|ahi)|\b(?:already (?:have|operate)|we already have) (?:a |an )?(?:subsidiary|local entity|office|branch)\b/ },
  { kind: "partners", categories: ["corporate_legal_admin", "tax_accounting_audit"],
    re: /\b(?:(?:tenemos|contamos con|trabajamos con|trabajaremos con|nos asociamos con|nos asociaremos con|asociarnos con|vamos a asociarnos con) (?:un |una |el |la )?(?:socio|socia|aliado|aliada|partner)[a-z ]{0,20}|joint venture|coinversion|we (?:have|will work with) a local partner)\b/ },
  { kind: "anchor_contract", categories: ["corporate_legal_admin", "tax_accounting_audit", "procurement_supply_chain"],
    re: /\b(?:contrato marco|cliente ancla|ya (?:tenemos|firmamos|ganamos) (?:un |el )?contrato|contrato (?:ya )?firmado|master (?:services )?agreement|anchor (?:client|customer)|signed contract)\b/ },
  { kind: "group_policy", categories: ["tax_accounting_audit", "banking_finance_insurance", "procurement_supply_chain"],
    re: /\b(?:politicas? (?:del grupo|corporativas?|de la matriz)|group polic(?:y|ies)|corporate polic(?:y|ies)|lineamientos (?:del grupo|de la matriz)|requisitos? de la matriz)\b/ },
  { kind: "prior_registration", categories: ["tax_accounting_audit", "corporate_legal_admin"],
    re: /\bya (?:estamos|estan|esta|fuimos) (?:inscritos?|registrad[oa]s?|dad[oa]s? de alta)\b[^.;]{0,40}(?:sat|hacienda|imss|registro)|\balready registered (?:with|at)\b/ },
  { kind: "currency_flows", categories: ["tax_accounting_audit", "banking_finance_insurance"],
    re: /\b(?:cobramos|facturamos|pagamos|pagos?|ingresos?) (?:en|a) (?:dolares|euros|moneda extranjera)|\b(?:paid|billed|invoiced) in (?:usd|dollars|euros)\b/ },
  { kind: "regulated_sector", categories: ["corporate_legal_admin", "international_trade_customs"],
    re: /\bsector regulado|requiere(?:n)? (?:una )?licencia|licencia (?:de operacion|sectorial)|regulated sector|requires? a licen[cs]e/ },
  { kind: "audited_group", categories: ["tax_accounting_audit"],
    re: /\b(?:cotiza(?:mos)? en bolsa|somos una empresa (?:publica|listada)|auditoria (?:externa )?del grupo|sujet[oa]s? a auditoria|publicly (?:listed|traded)|group audit)\b/ },
];

/** A hedge is not a statement: "quizá necesitemos un socio local" is a possibility the client has not decided. */
const HEDGE = /\b(?:quiza|quizas|tal vez|posiblemente|podriamos|podria|a lo mejor|no sabemos si|maybe|perhaps|might|we could)\b/;
const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?;\n])\s+/).map((s) => s.trim()).filter((s) => s.length >= 12);
const norm = (s: string): string => fold(s).replace(/[^a-z0-9]+/g, " ").trim();
const cut = (s: string, n = 200): string => (s.length <= n ? s : `${s.slice(0, n).replace(/\s+\S*$/, "").trimEnd()}…`);

/** New cross-cutting facts in what the client just wrote (those not already held). */
export function captureCrossCutting(text: string, existing: readonly CrossCuttingItem[], now: string, provenance: Provenance = "client_stated"): CrossCuttingItem[] {
  const out: CrossCuttingItem[] = [];
  const have = new Set(existing.map((i) => `${i.kind}|${norm(i.quote)}`));
  const kinds = new Set(existing.map((i) => i.kind));
  for (const sentence of sentencesOf(text)) {
    const f = fold(sentence);
    for (const m of MARKERS) {
      if (!m.re.test(f) || HEDGE.test(f)) continue;
      const quote = cut(sentence);
      const key = `${m.kind}|${norm(quote)}`;
      // one statement per kind is enough: the same kind restated is not another fact
      if (have.has(key) || kinds.has(m.kind)) continue;
      have.add(key); kinds.add(m.kind);
      out.push({ id: `x:${m.kind}`, kind: m.kind, quote, categories: m.categories, provenance, at: now });
    }
  }
  return out;
}

export const crossCuttingOf = (frame: Frame): CrossCuttingItem[] => frame.crossCutting ?? [];

/** The cross-cutting facts that inform a category (those that name it, or name none). */
export function crossCuttingFor(frame: Frame, categoryKey: string): CrossCuttingItem[] {
  return crossCuttingOf(frame).filter((i) => i.categories.length === 0 || i.categories.includes(categoryKey));
}

const LABEL: Record<CrossKind, Record<Loc, string>> = {
  existing_presence: { es: "Presencia que ya existe", en: "Existing presence" },
  partners: { es: "Socio o alianza local", en: "Local partner" },
  anchor_contract: { es: "Contrato o cliente ancla", en: "Anchor contract or client" },
  group_policy: { es: "Políticas del grupo", en: "Group policies" },
  prior_registration: { es: "Registros previos", en: "Prior registrations" },
  currency_flows: { es: "Flujos en otra moneda", en: "Foreign-currency flows" },
  regulated_sector: { es: "Sector con licencia o regulación", en: "Regulated sector" },
  audited_group: { es: "Grupo auditado o listado", en: "Audited or listed group" },
};
export const crossKindLabel = (k: CrossKind, loc: Loc): string => LABEL[k][loc];
