/**
 * Service Explorer for free phrases: NEED FIRST. A phrase is read as a need (known capability / legitimate unknown / ambiguous),
 * not forced into the catalog, and noise or meta-commands never become a service.
 *
 *   known need            -> map it to a capability (concepts carry category + candidate services)
 *   legitimate unknown    -> preserve in the client's words, collect detail, route for specialist review
 *   ambiguous             -> ask one disambiguating question
 *   noise / meta          -> no service; a gentle, useful reply
 *
 * Mandatory behaviours (acceptance): "marketing", "almacén", "cadena de frío", "quiero agregar más servicios", "4 plumones", "un sillón".
 */
import { CONCEPTS, conceptById } from "./concepts";
import { detectConcepts } from "./interpreter";
import { fold, hasTerm, quantities } from "./text";
import type { Loc } from "./types";

export type PhraseKind = "known" | "attribute" | "ambiguous" | "unknown_legit" | "goods_item" | "meta" | "unclear";
export interface PhraseResult {
  kind: PhraseKind;
  conceptIds: string[];
  /** The attribute concept (e.g. temperature control) and the need it qualifies, when the phrase is an attribute. */
  attributeOf?: string[];
  /** Disambiguation question for `ambiguous`. */
  question?: { es: string; en: string };
  /** Candidate interpretations for `ambiguous`. */
  options?: { conceptId: string; label: { es: string; en: string } }[];
}

const META = ["agregar (?:mas )?servicios", "anadir (?:mas )?servicios", "quiero agregar", "queremos agregar", "otro servicio", "mas servicios", "add (?:more )?services?", "another service", "something else", "otra cosa"];
const GOODS = ["plumon*", "marcador*", "pluma*", "lapiz*", "lapices", "cuaderno*", "papel", "hojas", "silla*", "sillon*", "sillones", "escritorio*", "mesa*", "mesas", "sofa*", "lampara*", "impresora*", "laptop*", "computadora*", "monitor*", "celular*", "telefono*", "tijeras", "engrapadora*", "grapas", "folder*", "carpeta*", "borrador*", "pizarron*", "pizarra*", "markers?", "pens?", "pencils?", "notebooks?", "chairs?", "couch(?:es)?", "desks?", "tables?", "printers?", "laptops?"];
const SERVICE_SHAPE = /(?:servicio|servicios|asesoria|asesoramiento|apoyo|ayuda|gestion|tramite|busqueda|estudio|consultoria|implementacion|auditoria|capacitacion|entrenamiento|contratacion|reclutamiento|representacion|soporte|support|service|services|advice|advisory|help with|management of|search for|study of|consulting|implementation|training|recruitment|representation)\s+(?:de |del |en |con |para |of |for |in |with )?(.{3,60})/;

/** Phrases where one word covers two distinct needs. */
const AMBIGUOUS: { terms: string[]; unless: string[]; options: { conceptId: string; label: { es: string; en: string } }[]; question: { es: string; en: string } }[] = [
  {
    terms: ["almacen", "almacenes", "bodega", "bodegas", "warehouse", "warehouses"],
    unless: ["nave", "parque industrial", "renta", "rentar", "operador logistico", "3pl", "inventario", "wms", "industrial park", "lease", "rent", "storage service"],
    options: [
      { conceptId: "industrial_site", label: { es: "un espacio para rentar", en: "a space to rent" } },
      { conceptId: "warehousing", label: { es: "un servicio que almacene y opere tu mercancía", en: "a service that stores and handles your goods" } },
    ],
    question: {
      es: "Mencionaste almacén. ¿Buscas un espacio para rentar o un servicio que almacene y opere tu mercancía?",
      en: "You mentioned a warehouse. Are you looking for a space to rent or a service that stores and handles your goods?",
    },
  },
];

export function classifyPhrase(text: string): PhraseResult {
  const f = fold(text);
  const t = f.trim();
  if (!t) return { kind: "unclear", conceptIds: [] };

  // Meta-commands: "quiero agregar más servicios" is a request to add, not a service.
  if (META.some((m) => hasTerm(t, m)) && detectConcepts(text, f).hits.filter((h) => conceptById(h.id)?.kind === "need").length === 0) return { kind: "meta", conceptIds: [] };

  for (const a of AMBIGUOUS) {
    if (a.terms.some((x) => hasTerm(t, x)) && !a.unless.some((x) => hasTerm(t, x))) return { kind: "ambiguous", conceptIds: a.options.map((o) => o.conceptId), question: a.question, options: a.options };
  }

  const { hits } = detectConcepts(text, f);
  const needs = hits.filter((h) => conceptById(h.id)?.kind === "need").map((h) => h.id);
  const attrs = hits.filter((h) => conceptById(h.id)?.kind === "attribute").map((h) => h.id);
  if (needs.length > 0) return { kind: "known", conceptIds: needs };
  if (attrs.length > 0) {
    // "cadena de frío" is a property of a service that moves or stores goods, not a service by itself.
    const parents = [...new Set(attrs.flatMap((a) => (conceptById(a)?.implies ?? []).map((i) => i.concept)))];
    return { kind: "attribute", conceptIds: attrs, attributeOf: parents };
  }

  // A physical, everyday object (optionally with a quantity) and no service shape is not a service.
  if (GOODS.some((g) => hasTerm(t, g)) && !SERVICE_SHAPE.test(t)) return { kind: "goods_item", conceptIds: [] };
  if (quantities(t).length > 0 && t.split(/\s+/).length <= 4 && !SERVICE_SHAPE.test(t)) return { kind: "goods_item", conceptIds: [] };

  // Something that reads like a service we do not know: keep it, in the client's words.
  if (SERVICE_SHAPE.test(t)) return { kind: "unknown_legit", conceptIds: [] };
  if (/(?:necesit\w+|quier\w+|busc\w+|requier\w+|need|want|looking for|require)\s+(?:un |una |unos |unas |el |la |los |las |a |an |some )?[a-z]{4,}/.test(t) && t.split(/\s+/).length >= 3) return { kind: "unknown_legit", conceptIds: [] };
  return { kind: "unclear", conceptIds: [] };
}

export function replyForPhrase(r: PhraseResult, loc: Loc): string | null {
  switch (r.kind) {
    case "meta": return loc === "es" ? "Claro. ¿Qué otra necesidad tiene tu proyecto?" : "Of course. What other need does your project have?";
    case "goods_item": return loc === "es" ? "Eso parece un artículo y no un servicio. ¿Qué necesitas resolver con eso?" : "That sounds like an item rather than a service. What do you need to solve with it?";
    case "unclear": return loc === "es" ? "No termino de ubicar qué servicio necesitas. ¿Me lo cuentas con otras palabras?" : "I am not sure which service you need. Could you tell me in other words?";
    case "ambiguous": return r.question ? r.question[loc] : null;
    case "attribute": return loc === "es" ? "Entendido, es una condición del producto. ¿Qué parte necesitas apoyar: el transporte, el almacenamiento o ambos?" : "Understood, that is a condition of the product. Which part do you need help with: transport, storage or both?";
    default: return null;
  }
}

export const KNOWN_CONCEPT_IDS = new Set(CONCEPTS.map((c) => c.id));
