/**
 * Probes: the dimensions a strong first consulting meeting would cover, each with
 *  - when it is relevant (derived from what the project IS, never from the catalog order),
 *  - whether it is MATERIAL for scoping (a material probe must be resolved before Understanding can be ready),
 *  - a deterministic extractor that reads it out of free narrative (so the client never has to repeat what they already said),
 *  - the canonical question (L2 anchored wording: one question, tú register, no list) and the short reason it is asked.
 *
 * A probe is resolved when the client gave the value, said the decision is still open (undecided), said they do not know it
 * (unknown) or preferred not to say (withheld). "Unknown" is honest knowledge: it becomes a finding, never a blocker and never a guess.
 */
import { countryName } from "./countries";
import { answerKind, describeMoney, money, negated, ranges } from "./signals";
import type { Range } from "./signals";
import { fold, hasTerm, parseDuration, describeMonths, parseQuantity, quantities, quantityNear, spanAround, termRegex, NUMBER_SOURCE } from "./text";
import type { Frame, FrameItem, ItemStatus, Interpretive, L10n, Loc } from "./types";

export type Tier = "material" | "valuable" | "optional";
export type Dimension = "project" | "entity" | "workforce" | "scale" | "tax" | "trade" | "product" | "location";

// ------------------------------------------------------------------ frame view
export interface FrameView {
  frame: Frame;
  has(conceptId: string): boolean;
  hasAny(ids: readonly string[]): boolean;
  item(key: string): FrameItem | undefined;
  value<T = unknown>(key: string): T | undefined;
  /** The country where the activity happens (first operation country), if known. */
  destination(): string | undefined;
}

export function viewOf(frame: Frame): FrameView {
  const v: FrameView = {
    frame,
    has: (id) => Boolean(frame.concepts[id]),
    hasAny: (ids) => ids.some((id) => Boolean(frame.concepts[id])),
    item: (key) => frame.items[key],
    value: <T,>(key: string) => frame.items[key]?.value as T | undefined,
    destination: () => frame.countries.find((c) => c.role === "operation")?.code ?? frame.countries.find((c) => c.role === "sales")?.code,
  };
  return v;
}

export interface ProbeCtx {
  text: string;
  f: string;
  /** This probe's question was the one just asked: bare/short answers are acceptable. */
  asked: boolean;
  view: FrameView;
  locale: Loc;
}
export interface ProbeHit {
  value: unknown;
  display: string;
  quote: string;
  status?: ItemStatus;
  interpretive?: Interpretive;
  why?: string;
}
export interface QuestionCtx { locale: Loc; dest: string; origin: string; view: FrameView }

export interface ProbeDef {
  key: string;
  dimension: Dimension;
  order: number;
  label: L10n;
  question: (q: QuestionCtx) => string;
  why: L10n;
  /** Relevant for this project? */
  applies: (v: FrameView) => boolean;
  /** Material for scoping when relevant? (Tier decided by the project, not fixed: some probes are material only in some projects.) */
  tier: (v: FrameView) => Tier;
  extract: (ctx: ProbeCtx) => ProbeHit | null;
  /** Knowledge topics that can inform (never replace) the question or the answer to doubts. */
  topics?: string[];
  /** Partial answers: the item exists but does not yet resolve the probe. */
  complete?: (item: FrameItem, v: FrameView) => boolean;
  /** What a bare "no" / "yes" means as the answer to this probe's question (e.g. "have you decided the form?" -> no = undecided). */
  onNo?: ItemStatus;
  onYes?: ItemStatus;
  /** Merge a later partial answer into the earlier value (e.g. a split given in two messages). */
  merge?: (previous: unknown, incoming: unknown) => unknown;
}

const sub = (s: string, q: QuestionCtx): string => s.replace(/\{dest\}/g, q.dest).replace(/\{origin\}/g, q.origin);
const L = (es: string, en: string) => (q: QuestionCtx): string => sub(q.locale === "es" ? es : en, q);

const PEOPLE = ["personas", "persona", "empleados", "empleado", "trabajadores", "trabajador", "colaboradores", "tecnicos", "ingenieros", "operarios", "personal", "people", "employees", "workers", "staff", "technicians", "engineers", "headcount", "plazas", "posiciones", "puestos", "head count"];
const DIRECT = ["directos", "directas", "directamente", "contratacion directa", "contratados directamente", "contratados por nosotros", "en nuestra nomina", "en nomina propia", "nomina propia", "propios", "empleados propios", "direct hires", "direct employees", "directly", "on our payroll", "in-house", "our own employees"];
const OUTSOURCED = ["subcontratad*", "tercerizad*", "terceriz*", "outsourc*", "por terceros", "por un tercero", "a traves de un tercero", "a traves de terceros", "por medio de un tercero", "externos", "de terceros", "empresa de personal", "agencia de personal", "staffing", "third[- ]party", "through a third party", "via a third party", "agency"];

const unitPeople = (n: number, loc: Loc): string => (loc === "es" ? `${n} ${n === 1 ? "persona" : "personas"}` : `${n} ${n === 1 ? "person" : "people"}`);
const rangeText = (min: number, max: number): string => (min === max ? String(min) : `${min}–${max}`);

function mk(ctx: ProbeCtx, term: string, value: unknown, display: string, extra: Partial<ProbeHit> = {}): ProbeHit {
  return { value, display, quote: spanAround(ctx.text, term), ...extra };
}

/** The range or quantity that sits right before/after one of the labels. */
function countNear(f: string, labels: readonly string[], gap = 22): { min: number; max: number; at: string } | null {
  const rs: Range[] = ranges(f);
  for (const label of labels) {
    const g = new RegExp(termRegex(label).source, "gu");
    for (const m of f.matchAll(g)) {
      const at = m.index ?? 0;
      const end = at + m[0].length;
      const r = rs.filter((x) => x.index + x.text.length <= at && at - (x.index + x.text.length) <= gap).sort((a, b) => b.index - a.index)[0]
        ?? rs.filter((x) => x.index >= end && x.index - end <= gap).sort((a, b) => a.index - b.index)[0];
      if (r) return { min: r.min, max: r.max, at: label };
    }
  }
  for (const label of labels) {
    const n = quantityNear(f, [label], { gap });
    if (n !== null) return { min: n, max: n, at: label };
  }
  return null;
}

/** First number/range in a short bare answer ("unos 40", "entre 30 y 50", "150"). */
function bareCount(f: string): { min: number; max: number } | null {
  if (f.length > 80) return null;
  const r = ranges(f)[0];
  if (r) return { min: r.min, max: r.max };
  const q = quantities(f)[0];
  return q ? { min: q.value, max: q.value } : null;
}

const hasDirect = (f: string): string | null => DIRECT.find((t) => hasTerm(f, t)) ?? null;
const hasOutsourced = (f: string): string | null => OUTSOURCED.find((t) => hasTerm(f, t)) ?? null;

// ------------------------------------------------------------------ entity form
const FORM_NAMED = new RegExp(
  "(?<![\\p{L}\\p{N}])(s\\.?\\s?a\\.?\\s?p\\.?\\s?i\\.?(?:\\s?de\\s?c\\.?\\s?v\\.?)?|s\\.?\\s?a\\.?\\s?de\\s?c\\.?\\s?v\\.?|s\\.?\\s?de\\s?r\\.?\\s?l\\.?(?:\\s?de\\s?c\\.?\\s?v\\.?)?|s\\.?a\\.?s\\.?|llc|gmbh|ltd|inc|sociedad anonima|sociedad de responsabilidad limitada|limited liability company|corporation)(?![\\p{L}\\p{N}])",
  "u",
);

// ------------------------------------------------------------------ definitions
const WORKFORCE_CONCEPTS = ["hiring", "workforce_presence", "payroll", "social_security", "outsourced_workforce", "eor", "benefits", "labor_legal"] as const;
const FINANCE_SCOPE = ["entity_setup", "accounting", "tax_compliance", "tax_services", "audit", "transfer_pricing"] as const;
const MOVES_GOODS = ["customs_trade", "logistics_transport", "warehousing", "temperature_control"] as const;

const resolvedIn = (it: FrameItem | undefined): boolean => Boolean(it) && ["known", "undecided", "unknown", "withheld"].includes(it!.status);

export const PROBES: readonly ProbeDef[] = [
  // ---------------------------------------------------------------- project
  {
    key: "project.duration", dimension: "project", order: 10,
    label: { es: "Duración de la operación", en: "Duration of the operation" },
    question: L("¿Cuánto tiempo calculas que operarán en {dest} con este proyecto?", "How long do you expect to operate in {dest} with this project?"),
    why: { es: "El horizonte de tiempo cambia qué estructura y qué apoyo conviene montar.", en: "The time horizon changes which structure and support make sense." },
    // A permanent expansion has no duration to ask; a temporary or project-bound operation does.
    applies: (v) => v.hasAny(["temporary_operation", "subcontracted_project"]),
    tier: () => "material",
    extract: (ctx) => {
      const d = parseDuration(ctx.f);
      if (!d) return null;
      const after = ctx.f.slice(ctx.f.indexOf(d.text.slice(0, Math.min(6, d.text.length))) + d.text.length, ctx.f.indexOf(d.text.slice(0, Math.min(6, d.text.length))) + d.text.length + 28);
      if (/^\s*(?:de|en el mercado|of)\s+(?:experiencia|antiguedad|trayectoria|historia|existencia|operacion en el mercado|experience)/.test(after) || /^\s*(?:de experiencia|of experience)/.test(after)) return null;
      const cue = /durante|por unos|por \d|duracion|estaremos|operar|operaremos|dure|proyecto|vamos a estar|plazo|temporal|for the duration|we will be|for about|for around|years in|horizonte/.test(ctx.f);
      if (!ctx.asked && !cue) return null;
      return mk(ctx, d.text, { minMonths: d.minMonths, maxMonths: d.maxMonths }, describeMonths(d.minMonths, d.maxMonths, ctx.locale));
    },
  },
  {
    key: "project.phases", dimension: "project", order: 12,
    label: { es: "Fases del proyecto", en: "Project phases" },
    question: L("¿El proyecto avanza por fases, o por países en distintos momentos? Cuéntame cuáles y en qué orden.", "Does the project move in phases, or country by country at different times? Tell me which and in what order."),
    why: { es: "Si hay fases, cada una puede necesitar servicios distintos y en momentos distintos.", en: "If there are phases, each may need different services at different times." },
    applies: (v) => v.has("multi_phase") || v.frame.countries.filter((c) => c.role !== "origin" && c.role !== "headquarters").length >= 2,
    tier: () => "valuable",
    extract: (ctx) => {
      if (/una sola fase|solo una fase|no hay fases|sin fases|un solo (?:pais|momento)|single phase|one phase|no phases/.test(ctx.f)) return mk(ctx, "fase", "single", ctx.locale === "es" ? "Una sola fase" : "A single phase");
      return null; // multi-phase content is recorded as phases by the interpreter
    },
    complete: () => true,
  },
  {
    key: "project.why", dimension: "project", order: 14,
    label: { es: "Por qué", en: "Why" },
    question: L("¿Qué los llevó a dar este paso ahora?", "What led you to take this step now?"),
    why: { es: "Entender el motivo me ayuda a priorizar lo que de verdad importa.", en: "Knowing the reason helps me prioritize what really matters." },
    applies: () => true,
    tier: () => "valuable",
    extract: (ctx) => {
      const m = /(?<![\p{L}\p{N}])(porque|ya que|debido a|con el fin de|con el objetivo de|para poder|a raiz de|because|so that|in order to|due to)(?![\p{L}\p{N}])/u.exec(ctx.f);
      // A reason given for a PRIORITY ("primero X, porque ...") is the priority's reason, not the project's.
      if (m && /primero|lo mas importante|prioridad|urgente|antes que nada|lo primero|first|priority|urgent|most important/.test(ctx.f.slice(Math.max(0, m.index - 140), m.index))) return null;
      if (!m) return ctx.asked && ctx.f.length > 12 && !answerKind(ctx.f) ? { value: ctx.text.trim().slice(0, 240), display: ctx.text.trim().slice(0, 140), quote: ctx.text.trim().slice(0, 160) } : null;
      return mk(ctx, m[1]!, spanAround(ctx.text, m[1]!, 240), spanAround(ctx.text, m[1]!, 140));
    },
  },
  // ---------------------------------------------------------------- product / trade
  {
    key: "product.what", dimension: "product", order: 16,
    label: { es: "Producto o servicio del proyecto", en: "Product or service" },
    question: L("¿Qué producto o servicio es el centro del proyecto?", "What product or service is at the center of the project?"),
    why: { es: "Define qué tipo de apoyo de comercio, logística y cumplimiento puede hacer falta.", en: "It defines the trade, logistics and compliance support that may be needed." },
    applies: (v) => v.hasAny(MOVES_GOODS) || v.hasAny(["certifications", "procurement", "market_research"]),
    tier: (v) => (v.hasAny(MOVES_GOODS) ? "material" : "valuable"),
    extract: (ctx) => {
      const m = new RegExp(
        "(?:vend(?:er|emos|eremos|iendo)|export(?:ar|amos|aremos|ando)|import(?:ar|amos|aremos|ando)|distribu(?:ir|imos|iremos|yendo)|comercializ(?:ar|amos|aremos|ando)|mover|movemos|moveremos|env(?:iar|iamos|iaremos)|produc(?:ir|imos|iremos)|fabric(?:ar|amos|aremos)|transport(?:ar|amos|aremos)|traer|traemos|llevar|llevamos|exporting|importing|export|import|sell|selling|distribute|distributing|ship|shipping|move|moving|produce|producing|bring)\\s+(?:nuestros?\\s+|nuestras?\\s+|mis\\s+|el\\s+|la\\s+|los\\s+|las\\s+|un\\s+|una\\s+|our\\s+|the\\s+|my\\s+|some\\s+)?([a-z][a-z ]{2,40}?)(?=\\s+(?:a|al|desde|hacia|de|del|en|para|con|y|from|to|into|in|for|and|that|which)\\b|[.,;:]|$)",
        "u",
      ).exec(ctx.f);
      const named = /(?:nuestro producto es|producto principal|nuestro producto|somos (?:productores|fabricantes|distribuidores|exportadores) de|our product is|we are (?:a )?(?:producer|manufacturer|distributor|exporter) of)\s+(?:el |la |los |las |un |una |de )?([a-z][a-z ]{2,40}?)(?=[.,;:]|$|\s+(?:y|que|and|that)\b)/u.exec(ctx.f);
      const equip = /(?:equipos?|maquinaria|equipamiento|equipment)\s+(?:de los |del |de las |de |of the |for the )?(?:proyectos?|projects?)/.exec(ctx.f);
      if (equip) return { value: "project equipment", display: ctx.locale === "es" ? "equipo del proyecto" : "project equipment", quote: spanAround(ctx.text, equip[0]), interpretive: "understood" };
      const raw = (named?.[1] ?? m?.[1])?.trim();
      if (raw && !/^(?:el proyecto|la empresa|la operacion|a mexico|nuestros? productos?|servicios?|mas|mucho|todo)$/.test(raw)) {
        const at = ctx.f.indexOf(raw);
        const shown = at >= 0 ? ctx.text.slice(at, at + raw.length) : raw;
        return { value: raw, display: shown, quote: spanAround(ctx.text, raw), interpretive: "understood" };
      }
      if (ctx.asked && ctx.f.length <= 100 && !answerKind(ctx.f)) {
        const t = ctx.text.trim().replace(/[.]+$/, "");
        return { value: fold(t), display: t, quote: t };
      }
      return null;
    },
  },
  {
    key: "trade.volume", dimension: "trade", order: 18,
    label: { es: "Volumen y frecuencia", en: "Volume and frequency" },
    question: L("¿Qué volumen esperas mover y con qué frecuencia?", "What volume do you expect to move, and how often?"),
    why: { es: "Con volumen y frecuencia se dimensiona el transporte, el almacenamiento y el trámite aduanal.", en: "Volume and frequency size transport, storage and customs handling." },
    applies: (v) => v.hasAny(MOVES_GOODS),
    tier: () => "valuable",
    extract: (ctx) => {
      const m = new RegExp(`(${NUMBER_SOURCE})\\s*(toneladas?|tons?|kilos?|kg|contenedor(?:es)?|containers?|pallets?|tarimas?|cajas?|unidades|units|embarques?|shipments?|camiones|trucks|envios|pedidos|orders|litros|liters)(?:\\s+(?:al|por|a la|each|per|a|every)\\s+(mes|semana|ano|dia|month|week|year|day))?`, "u").exec(ctx.f);
      if (m) return mk(ctx, m[0], m[0], m[0]);
      if (ctx.asked && ctx.f.length <= 140 && quantities(ctx.f).length > 0) return { value: ctx.text.trim(), display: ctx.text.trim().slice(0, 100), quote: ctx.text.trim().slice(0, 160) };
      return null;
    },
  },
  {
    key: "trade.temperature", dimension: "trade", order: 19,
    label: { es: "Rango de temperatura", en: "Temperature range" },
    question: L("¿En qué rango de temperatura debe mantenerse el producto?", "In what temperature range does the product need to be kept?"),
    why: { es: "Cambia el tipo de transporte y almacenamiento que hace falta.", en: "It changes the type of transport and storage required." },
    applies: (v) => v.has("temperature_control"),
    tier: () => "material",
    extract: (ctx) => {
      const m = /(-?\d{1,2})\s*(?:°|grados|º)?\s*(?:c|celsius)?\s*(?:a|y|-|to|and)\s*(-?\d{1,2})\s*(?:°|grados|º)\s*c?/.exec(ctx.f) ?? /(-?\d{1,2})\s*(?:°|º|grados)\s*c?/.exec(ctx.f);
      if (m) return mk(ctx, m[0], m[0].trim(), m[0].trim());
      if (/ambiente|sin refrigeracion|no requiere (?:frio|refrigeracion)|ambient/.test(ctx.f)) return mk(ctx, "ambiente", "ambient", ctx.locale === "es" ? "Temperatura ambiente" : "Ambient");
      if (/refrigerad|congelad|frozen|chilled|cold/.test(ctx.f) && ctx.asked) return mk(ctx, "refrigerad", ctx.text.trim().slice(0, 80), ctx.text.trim().slice(0, 80));
      return null;
    },
  },
  // ---------------------------------------------------------------- entity
  {
    key: "entity.form", dimension: "entity", order: 20,
    label: { es: "Forma societaria", en: "Legal form" },
    question: L("¿Ya tienen definida la forma de la entidad en {dest}: una sociedad, una sucursal o una oficina de representación?", "Have you decided the form of the entity in {dest}: a company, a branch or a representative office?"),
    why: { es: "La forma elegida cambia obligaciones, costos y el apoyo que necesitarás.", en: "The form you choose changes obligations, costs and the support you will need." },
    topics: ["entity_forms"],
    onNo: "undecided",
    applies: (v) => v.has("entity_setup"),
    tier: () => "material",
    extract: (ctx) => {
      const named = FORM_NAMED.exec(ctx.f);
      if (named) return mk(ctx, named[1]!, { kind: "company", label: named[1]!.toUpperCase().replace(/\s+/g, " ") }, spanAround(ctx.text, named[1]!, 60), { interpretive: "observed" });
      if (hasTerm(ctx.f, "sucursal") || hasTerm(ctx.f, "branch") || hasTerm(ctx.f, "branch office")) return mk(ctx, "sucursal", { kind: "branch" }, ctx.locale === "es" ? "Sucursal" : "Branch");
      if (/oficina de representacion|representative office/.test(ctx.f)) return mk(ctx, "oficina de representacion", { kind: "rep_office" }, ctx.locale === "es" ? "Oficina de representación" : "Representative office");
      if (/(?:filial|subsidiaria|subsidiary)/.test(ctx.f) && (ctx.asked || /constituir|crear|abrir|incorporar|set up|form|establish/.test(ctx.f))) {
        const t = /filial|subsidiaria|subsidiary/.exec(ctx.f)![0];
        return mk(ctx, t, { kind: "company", label: null }, ctx.locale === "es" ? "Filial o subsidiaria (tipo de sociedad por definir)" : "Subsidiary (company type to be defined)");
      }
      return null;
    },
    complete: (it) => {
      const v = it.value as { kind?: string } | null;
      return Boolean(v?.kind) && v!.kind !== "unspecified";
    },
  },
  {
    key: "entity.activity", dimension: "entity", order: 22,
    label: { es: "Qué hará la entidad local", en: "What the local entity will do" },
    question: L("¿Qué va a hacer concretamente la operación local en {dest}: instalar, facturar, contratar, dar servicio?", "What will the local operation in {dest} concretely do: install, invoice, hire, provide a service?"),
    why: { es: "Define el alcance real de la estructura local.", en: "It defines the real scope of the local structure." },
    applies: (v) => v.has("entity_setup"),
    tier: () => "material",
    extract: (ctx) => {
      const eq = /(instalar\w*|instalacion\w*|montaje\w*|montar\w*|install\w*)\s+(?:de\s+)?(?:parte\s+(?:de|del)\s+)?(?:el\s+|los\s+|las\s+)?(equipo\w*|maquinaria|equipamiento|equipment|systems?|sistemas?)/.exec(ctx.f);
      if (eq) return mk(ctx, eq[0], "equipment_installation", ctx.locale === "es" ? "instalar parte del equipo del proyecto" : "installing part of the project equipment", { interpretive: "understood" });
      if (ctx.asked && ctx.f.length > 12 && ctx.f.length <= 400 && !answerKind(ctx.f)) return { value: fold(ctx.text.trim()).slice(0, 240), display: ctx.text.trim().slice(0, 140), quote: ctx.text.trim().slice(0, 160) };
      return null;
    },
  },
  {
    key: "entity.funding", dimension: "entity", order: 24,
    label: { es: "Cómo se financia la operación local", en: "How the local operation is funded" },
    question: L("¿Cómo se va a financiar la operación local en {dest}?", "How will the local operation in {dest} be funded?"),
    why: { es: "La fuente de fondos condiciona la estructura y la parte fiscal y contable.", en: "The source of funds shapes the structure, tax and accounting." },
    topics: ["intercompany_funding"],
    applies: (v) => v.hasAny(["entity_setup", "intercompany_funding", "transfer_pricing"]),
    tier: (v) => (v.has("entity_setup") ? "material" : "valuable"),
    extract: (ctx) => {
      const sources: string[] = [];
      const parentRe = /(?:matriz|casa matriz|empresa matriz|parent|headquarters|intragrupo|intercompan|grupo)/;
      if ((hasTerm(ctx.f, "financiamiento (?:desde|de|por parte de|con) (?:la )?(?:casa )?matriz") || hasTerm(ctx.f, "matriz (?:va a|vaya a|vamos a|nos) financi*") || /(?:matriz|parent|headquarters)[^.]{0,60}(?:financ|fond|capitaliz|prest|loan|fund)/.test(ctx.f) || /(?:financ|fond|capitaliz|prest|loan|fund)[^.]{0,60}(?:matriz|parent|headquarters)/.test(ctx.f)) && parentRe.test(ctx.f)) sources.push("parent");
      if (/credito (?:local|bancario)|banco local|linea de credito|local (?:bank|credit)|bank (?:loan|credit)/.test(ctx.f)) sources.push("local_credit");
      if (/ingresos del proyecto|flujo del proyecto|pagos del contratista|con lo que (?:facturemos|cobremos)|project (?:revenue|cash ?flow)/.test(ctx.f)) sources.push("project_revenue");
      if (/(?:capital propio|recursos propios|own funds|own capital)/.test(ctx.f)) sources.push("own_funds");
      if (sources.length === 0) {
        if (ctx.asked && ctx.f.length <= 200 && !answerKind(ctx.f)) return { value: { sources: ["other"], text: ctx.text.trim().slice(0, 160) }, display: ctx.text.trim().slice(0, 120), quote: ctx.text.trim().slice(0, 160) };
        return null;
      }
      const label = (s: string): string => ({ parent: ctx.locale === "es" ? "la casa matriz" : "the parent company", local_credit: ctx.locale === "es" ? "crédito local" : "local credit", project_revenue: ctx.locale === "es" ? "ingresos del proyecto" : "project revenue", own_funds: ctx.locale === "es" ? "recursos propios" : "own funds", other: "" })[s] ?? s;
      const key = sources[0] === "parent" ? (/matriz|parent|headquarters/.exec(ctx.f)?.[0] ?? "matriz") : sources[0]!;
      return mk(ctx, key, { sources }, sources.map(label).join(", "));
    },
  },
  {
    key: "entity.funding_structure", dimension: "entity", order: 25,
    label: { es: "Aportación de la matriz", en: "How the parent funds it" },
    question: L("Cuando la casa matriz financie la operación, ¿lo harán como préstamo, como aportación de capital o aún no está definido?", "When the parent company funds the operation, will it be as a loan, as a capital contribution, or is it not defined yet?"),
    why: { es: "Un préstamo y un aporte de capital tienen tratamientos fiscales y contables distintos.", en: "A loan and a capital contribution are treated differently for tax and accounting." },
    topics: ["intercompany_funding"],
    applies: (v) => Boolean((v.value<{ sources?: string[] }>("entity.funding")?.sources ?? []).includes("parent")) || v.has("intercompany_funding"),
    tier: () => "material",
    extract: (ctx) => {
      const loan = /prestamo|loan|deuda|debt|credito intercompan|intercompany loan/.test(ctx.f);
      const equity = /aportacion(?:es)? de capital|aporte(?:s)? de capital|capitalizar|capitalizacion|capital social|equity|capital contribution|capital injection|inyeccion de capital/.test(ctx.f);
      if (loan && equity) return mk(ctx, loan ? "prestamo" : "capital", "mixed", ctx.locale === "es" ? "Combinación de préstamo y capital" : "A mix of loan and capital");
      if (loan) return mk(ctx, "prestamo|loan", "loan", ctx.locale === "es" ? "Préstamo de la matriz" : "Loan from the parent");
      if (equity) return mk(ctx, "capital", "equity", ctx.locale === "es" ? "Aportación de capital" : "Capital contribution");
      return null;
    },
  },
  // ---------------------------------------------------------------- workforce
  {
    key: "workforce.headcount", dimension: "workforce", order: 30,
    label: { es: "Personas en el país", en: "People in the country" },
    question: L("¿Cuántas personas calculas que necesitarás en {dest}, entre directas y subcontratadas?", "How many people do you expect to need in {dest}, counting direct and outsourced?"),
    why: { es: "El tamaño del equipo define el alcance de nómina, seguridad social y contratación.", en: "Team size defines the scope of payroll, social security and hiring." },
    topics: ["labor_market"],
    applies: (v) => v.hasAny(WORKFORCE_CONCEPTS),
    tier: () => "material",
    extract: (ctx) => {
      const near = countNear(ctx.f, PEOPLE);
      const d = parseDuration(ctx.f);
      if (near && !(d && Math.abs(near.min - (d.minMonths / 12)) < 0.01 && !ctx.asked && /anos|years/.test(ctx.f.slice(ctx.f.indexOf(String(near.min)))))) {
        const disp = near.min === near.max ? unitPeople(near.min, ctx.locale) : `${near.min}–${near.max} ${ctx.locale === "es" ? "personas" : "people"}`;
        return mk(ctx, String(near.min), { min: near.min, max: near.max }, disp);
      }
      // Counts given by group (direct + outsourced) add up to a total the client implied.
      const dc = countNear(ctx.f, DIRECT);
      const oc = countNear(ctx.f, OUTSOURCED);
      if (dc && oc && dc.min === dc.max && oc.min === oc.max) {
        const t = dc.min + oc.min;
        return mk(ctx, String(dc.min), { min: t, max: t }, unitPeople(t, ctx.locale), { interpretive: "understood" });
      }
      if (ctx.asked) {
        const b = bareCount(ctx.f);
        if (b) return mk(ctx, String(b.min), b, b.min === b.max ? unitPeople(b.min, ctx.locale) : `${b.min}–${b.max} ${ctx.locale === "es" ? "personas" : "people"}`);
      }
      return null;
    },
  },
  {
    key: "workforce.model", dimension: "workforce", order: 32,
    label: { es: "Cómo se contrata al personal", en: "How staff is engaged" },
    question: L("¿Esas personas las contratarían directamente, a través de un tercero, o una combinación de ambos?", "Would you hire those people directly, through a third party, or a combination of both?"),
    why: { es: "Contratar directo o por un tercero cambia obligaciones, riesgos y costos.", en: "Hiring directly or through a third party changes obligations, risks and costs." },
    topics: ["workforce_models"],
    applies: (v) => v.hasAny(WORKFORCE_CONCEPTS),
    tier: () => "material",
    extract: (ctx) => {
      const d = hasDirect(ctx.f);
      const o = hasOutsourced(ctx.f);
      const hireSome = /alguno[s]? (?:directamente|directos|de forma directa)|una parte (?:directamente|directa)|parte (?:de ellos|del personal)[^.]{0,30}(?:directo|directamente)|some (?:of them )?(?:directly|direct)|part of (?:them|the staff)[^.]{0,30}direct/.test(ctx.f);
      const both = (d || hireSome) && o;
      if (both) return mk(ctx, (d ?? "directamente"), "mixed", ctx.locale === "es" ? "Parte directos y parte por un tercero" : "Part direct, part through a third party");
      if (d && !o && !/no (?:vamos a|queremos|contratar\w*) (?:contratar )?directamente|no directamente/.test(ctx.f)) return mk(ctx, d, "direct", ctx.locale === "es" ? "Contratación directa" : "Direct hiring");
      if (o && !d) return mk(ctx, o, "outsourced", ctx.locale === "es" ? "A través de un tercero" : "Through a third party");
      if (/ambos|combinacion|mixto|las dos|both|a mix|combination/.test(ctx.f) && ctx.asked) return mk(ctx, "combinacion|ambos|both", "mixed", ctx.locale === "es" ? "Combinación de directos y por un tercero" : "A combination of direct and third party");
      return null;
    },
  },
  {
    key: "workforce.split", dimension: "workforce", order: 34,
    label: { es: "Reparto entre directos y subcontratados", en: "Direct vs outsourced split" },
    question: L("¿Cuántas de esas personas serían directas y cuántas subcontratadas, aproximadamente?", "Roughly how many of those people would be direct and how many outsourced?"),
    why: { es: "El reparto determina cuánta nómina y seguridad social corre por la entidad.", en: "The split determines how much payroll and social security the entity carries." },
    applies: (v) => v.value("workforce.model") === "mixed",
    tier: () => "material",
    merge: (a, b) => {
      const x = (a ?? {}) as Record<string, unknown>;
      const y = (b ?? {}) as Record<string, unknown>;
      const pick = (k: string): unknown => (y[k] !== null && y[k] !== undefined ? y[k] : x[k] ?? null);
      return { direct: pick("direct"), outsourced: pick("outsourced"), directPct: pick("directPct"), outsourcedPct: pick("outsourcedPct"), half: Boolean(y.half || x.half) };
    },
    extract: (ctx) => {
      const dc = countNear(ctx.f, DIRECT, 18);
      const oc = countNear(ctx.f, OUTSOURCED, 18);
      const pct = (labels: readonly string[]): number | null => {
        for (const l of labels) {
          const m = new RegExp(`(\\d{1,3})\\s*%[^.]{0,22}${termRegex(l).source}|${termRegex(l).source}[^.]{0,22}(\\d{1,3})\\s*%`, "u").exec(ctx.f);
          if (m) return Number(m[1] ?? m[2]);
        }
        return null;
      };
      const dp = pct(DIRECT);
      const op = pct(OUTSOURCED);
      const half = /la mitad|mitad y mitad|50\/50|half and half|half of/.test(ctx.f);
      const direct = dc && dc.min === dc.max ? dc.min : null;
      const out = oc && oc.min === oc.max ? oc.min : null;
      if (direct !== null || out !== null || dp !== null || op !== null || half) {
        const parts: string[] = [];
        if (direct !== null) parts.push(ctx.locale === "es" ? `${direct} directas` : `${direct} direct`);
        if (out !== null) parts.push(ctx.locale === "es" ? `${out} subcontratadas` : `${out} outsourced`);
        if (dp !== null) parts.push(ctx.locale === "es" ? `${dp}% directas` : `${dp}% direct`);
        if (op !== null) parts.push(ctx.locale === "es" ? `${op}% subcontratadas` : `${op}% outsourced`);
        if (half) parts.push(ctx.locale === "es" ? "mitad y mitad" : "half and half");
        return mk(ctx, String(direct ?? out ?? dp ?? op ?? "mitad"), { direct, outsourced: out, directPct: dp, outsourcedPct: op, half }, parts.join(", "));
      }
      if (ctx.asked) {
        const qs = quantities(ctx.f);
        if (qs.length >= 2 && ctx.f.length <= 140) return mk(ctx, String(qs[0]!.value), { direct: qs[0]!.value, outsourced: qs[1]!.value }, ctx.locale === "es" ? `${qs[0]!.value} directas, ${qs[1]!.value} subcontratadas` : `${qs[0]!.value} direct, ${qs[1]!.value} outsourced`, { interpretive: "understood" });
      }
      return null;
    },
    complete: (it, v) => {
      const s = it.value as { direct: number | null; outsourced: number | null; directPct: number | null; outsourcedPct: number | null; half: boolean } | null;
      if (!s) return false;
      if (s.half || (s.direct !== null && s.outsourced !== null) || (s.directPct !== null && s.outsourcedPct !== null)) return true;
      const head = v.value<{ max: number }>("workforce.headcount");
      return Boolean(head) && (s.direct !== null || s.outsourced !== null || s.directPct !== null || s.outsourcedPct !== null);
    },
  },
  {
    key: "workforce.origin", dimension: "workforce", order: 35,
    label: { es: "Origen del personal", en: "Where the staff comes from" },
    question: L("¿El personal sería contratado en {dest} o parte vendría desde {origin}?", "Would the staff be hired in {dest}, or would some come from {origin}?"),
    why: { es: "Si parte del equipo se traslada, importan además los temas migratorios y de movilidad.", en: "If part of the team relocates, immigration and mobility topics matter too." },
    applies: (v) => v.hasAny(["hiring", "relocation", "immigration_mobility"]) || v.hasAny(WORKFORCE_CONCEPTS),
    tier: () => "valuable",
    extract: (ctx) => {
      const local = /personal local|localmente|contratad[oa]s? (?:en el pais|en destino|en mexico|en colombia|en [a-z]+ por nosotros)|contratar (?:en el pais|en mexico)|gente (?:local|de la zona)|mano de obra local|contratacion local|local hires|hire locally|local staff|local workforce/.test(ctx.f);
      const moves = /traer|trasladar|enviar|expatri|desde (?:portugal|espana|colombia|alemania|china|brasil|el pais de origen)|personal (?:portugues|espanol|aleman|colombiano)|bring (?:our|some)|relocat|secondment|from (?:portugal|spain|germany)/.test(ctx.f);
      if (local && moves) return mk(ctx, "local", "both", ctx.locale === "es" ? "Personal local y personal que se traslada" : "Local hires and staff relocating");
      if (local) return mk(ctx, "local", "local", ctx.locale === "es" ? "Personal contratado localmente" : "Hired locally");
      if (moves) return mk(ctx, "traer|trasladar|enviar|expatri", "relocated", ctx.locale === "es" ? "Personal que se traslada desde el origen" : "Staff relocating from the home country");
      return null;
    },
  },
  {
    key: "workforce.benefits", dimension: "workforce", order: 36,
    label: { es: "Prestaciones", en: "Employee benefits" },
    question: L("Para el personal directo, ¿piensan ofrecer solo las prestaciones mínimas de ley o algo adicional?", "For direct staff, do you plan to offer only the legal minimum benefits or something additional?"),
    why: { es: "Las prestaciones adicionales afectan el costo del empleo y el diseño de la nómina.", en: "Additional benefits affect employment cost and payroll design." },
    topics: ["employment_benefits"],
    applies: (v) => ["direct", "mixed"].includes(String(v.value("workforce.model"))) || v.has("benefits"),
    tier: (v) => (["direct", "mixed"].includes(String(v.value("workforce.model"))) ? "material" : "valuable"),
    extract: (ctx) => {
      const items: string[] = [];
      const add = (re: RegExp, es: string, en: string): void => { if (re.test(ctx.f)) items.push(ctx.locale === "es" ? es : en); };
      add(/seguro de gastos medicos|gastos medicos mayores|medical insurance|health insurance/, "seguro de gastos médicos", "medical insurance");
      add(/vales de despensa|food vouchers|meal vouchers/, "vales de despensa", "food vouchers");
      add(/fondo de ahorro|savings fund/, "fondo de ahorro", "savings fund");
      add(/bonos?|bonus/, "bonos", "bonuses");
      add(/aguinaldo superior|aguinaldo mayor|vacaciones adicionales|additional vacation/, "días o aguinaldo adicionales", "additional days or year-end pay");
      add(/prestaciones superiores|por encima de la ley|mas que la ley|above the legal|beyond the legal|superiores a las de ley/, "por encima del mínimo de ley", "above the legal minimum");
      const minimum = /(?:solo|unicamente|nada mas que) (?:las )?(?:prestaciones )?(?:de ley|minimas|obligatorias|legales)|minimo (?:de ley|legal)|lo que (?:marca|exige|pide) la ley|prestaciones de ley|only (?:the )?legal|legal minimum|statutory (?:only|minimum)/.test(ctx.f);
      if (minimum && items.length === 0) return mk(ctx, "ley|legal", { mode: "legal_minimum", items: [] }, ctx.locale === "es" ? "Solo el mínimo de ley" : "Legal minimum only");
      if (items.length > 0) return mk(ctx, "prestaciones|benefits|seguro|vales|fondo de ahorro|bono", { mode: "above_minimum", items }, items.join(", "));
      return null;
    },
  },
  // ---------------------------------------------------------------- scale
  {
    key: "scale.revenue", dimension: "scale", order: 40,
    label: { es: "Ingresos esperados", en: "Expected revenue" },
    question: L("¿Qué ingresos calculas para la operación en {dest}, aunque sea una cifra aproximada mensual o anual?", "What revenue do you expect for the operation in {dest}, even a rough monthly or annual figure?"),
    why: { es: "El nivel de ingresos dimensiona la contabilidad, las obligaciones fiscales y la estructura.", en: "Revenue level sizes accounting, tax obligations and the structure." },
    applies: (v) => v.hasAny(FINANCE_SCOPE),
    tier: (v) => (v.hasAny(["entity_setup", "accounting", "tax_compliance"]) ? "material" : "valuable"),
    extract: (ctx) => {
      const ms = money(ctx.f);
      const m = ms.find((x) => /ingres|factur|ventas|revenue|billing|turnover|sales|cobr/.test(ctx.f.slice(Math.max(0, x.index - 70), x.index + x.text.length + 70))) ?? (ctx.asked ? ms[0] : undefined);
      if (!m) return null;
      return mk(ctx, m.text, { min: m.min, max: m.max, currency: m.currency, period: m.period }, describeMoney(m, ctx.locale));
    },
  },
  {
    key: "scale.volume", dimension: "scale", order: 42,
    label: { es: "Volumen de operación", en: "Operating volume" },
    question: L("¿Qué volumen de operación esperas en {dest}, por ejemplo facturas, transacciones o contratos al mes?", "What operating volume do you expect in {dest}, for example invoices, transactions or contracts per month?"),
    why: { es: "El volumen de operaciones define cuánta contabilidad y cumplimiento hay que atender.", en: "Operating volume defines how much accounting and compliance there is to handle." },
    applies: (v) => v.hasAny(["entity_setup", "accounting", "tax_compliance"]),
    tier: () => "material",
    extract: (ctx) => {
      const m = new RegExp(`(${NUMBER_SOURCE})\\s*(facturas?|invoices?|transacciones|transactions|operaciones|contratos|contracts|pedidos|orders|ordenes|movimientos|pagos|payments|clientes|customers|proyectos|projects)(?:\\s+(?:al|por|a la|each|per|a|every)\\s+(mes|semana|ano|dia|trimestre|month|week|year|day|quarter))?`, "u").exec(ctx.f);
      if (m) return mk(ctx, m[0], m[0], m[0]);
      if (ctx.asked && ctx.f.length <= 160 && quantities(ctx.f).length > 0 && !money(ctx.f).length) return { value: ctx.text.trim(), display: ctx.text.trim().slice(0, 100), quote: ctx.text.trim().slice(0, 160) };
      return null;
    },
  },
  {
    key: "scale.suppliers", dimension: "scale", order: 44,
    label: { es: "Proveedores locales", en: "Local suppliers" },
    question: L("¿Con cuántos proveedores locales calculas trabajar?", "How many local suppliers do you expect to work with?"),
    why: { es: "El número de proveedores afecta el volumen contable y los controles.", en: "The number of suppliers affects accounting volume and controls." },
    applies: (v) => v.has("entity_setup") && v.hasAny(["accounting", "tax_compliance", "audit"]),
    tier: () => "material",
    extract: (ctx) => {
      const near = countNear(ctx.f, ["proveedores", "proveedor", "suppliers", "supplier", "vendors", "vendor", "subcontratistas"], 20);
      if (near) return mk(ctx, String(near.min), { min: near.min, max: near.max }, near.min === near.max ? String(near.min) : `${near.min}–${near.max}`);
      if (/sin proveedores|no tendremos proveedores|ningun proveedor|no suppliers|no local suppliers/.test(ctx.f)) return mk(ctx, "proveedores|suppliers", { min: 0, max: 0 }, ctx.locale === "es" ? "Ninguno" : "None");
      if (ctx.asked) {
        const b = bareCount(ctx.f);
        if (b) return mk(ctx, String(b.min), b, rangeText(b.min, b.max));
      }
      return null;
    },
  },
  {
    key: "scale.inventory", dimension: "scale", order: 46,
    label: { es: "Inventario", en: "Inventory" },
    question: L("¿La operación en {dest} manejará inventario o material propio?", "Will the operation in {dest} hold inventory or its own materials?"),
    why: { es: "Tener inventario cambia la contabilidad, el almacenamiento y los seguros.", en: "Holding inventory changes accounting, storage and insurance." },
    applies: (v) => v.has("entity_setup") && v.hasAny(["accounting", "tax_compliance", "audit"]),
    tier: () => "material",
    extract: (ctx) => {
      if (/sin inventario|no (?:manejaremos|tendremos|habra|vamos a tener|vamos a manejar|llevaremos) inventario|no inventory|no stock|without inventory/.test(ctx.f)) return mk(ctx, "inventario|inventory", { holds: false }, ctx.locale === "es" ? "Sin inventario" : "No inventory");
      if (/(?:manejaremos|tendremos|mantendremos|llevaremos|vamos a tener|vamos a manejar|habra) (?:algo de |cierto |un )?(?:inventario|material|stock)|inventario propio|we will (?:hold|keep|carry) (?:some )?(?:inventory|stock)/.test(ctx.f)) return mk(ctx, "inventario|inventory|material|stock", { holds: true }, ctx.locale === "es" ? "Manejará inventario" : "Will hold inventory");
      if (ctx.asked) {
        const k = answerKind(ctx.f);
        if (k === "no") return mk(ctx, "no", { holds: false }, ctx.locale === "es" ? "Sin inventario" : "No inventory");
        if (k === "yes") return mk(ctx, "si|yes", { holds: true }, ctx.locale === "es" ? "Manejará inventario" : "Will hold inventory");
        if (/inventario|material|stock|equipo|refaccion|inventory|spare/.test(ctx.f) && ctx.f.length <= 160) return { value: { holds: true, text: ctx.text.trim().slice(0, 140) }, display: ctx.text.trim().slice(0, 100), quote: ctx.text.trim().slice(0, 160) };
      }
      return null;
    },
  },
  // ---------------------------------------------------------------- tax
  {
    key: "tax.intercompany", dimension: "tax", order: 50,
    label: { es: "Operaciones con la matriz", en: "Transactions with the group" },
    question: L("¿Qué tipo de operaciones habrá entre la entidad en {dest} y el resto del grupo: servicios, venta de equipo, préstamos u otras?", "What kinds of transactions will there be between the entity in {dest} and the rest of the group: services, equipment sales, loans or others?"),
    why: { es: "Las operaciones entre empresas del mismo grupo tienen reglas propias de documentación.", en: "Transactions within the same group have their own documentation rules." },
    topics: ["transfer_pricing"],
    applies: (v) => v.hasAny(["transfer_pricing", "intercompany_funding"]),
    tier: () => "material",
    extract: (ctx) => {
      const kinds: string[] = [];
      const add = (re: RegExp, es: string, en: string): void => { if (re.test(ctx.f)) kinds.push(ctx.locale === "es" ? es : en); };
      add(/servicios (?:intragrupo|intercompan\w*|de la matriz|corporativos|de administracion|compartidos)|servicios? (?:\w+\s+){0,3}(?:de|desde|con|por) la matriz|management fee|cuotas? de administracion|shared services|intercompany services|intra-?group services/, "servicios entre empresas del grupo", "intra-group services");
      add(/(?:venta|compra|suministro|transferencia|arrendamiento)\s+de\s+(?:el\s+)?(?:equipo|material|mercancia|bienes|maquinaria)[^.]{0,40}(?:filial|matriz|grupo|subsidiaria)|equipment (?:sales|purchases|transfers?)|goods (?:from|to) the (?:parent|group)/, "compraventa de equipo o materiales", "equipment or goods");
      add(/prestamo(?:s)? (?:entre|a la|de la) (?:filial|subsidiaria|empresas del grupo)|intercompany loans?|loans? to the (?:subsidiary|affiliate)/, "préstamos entre empresas del grupo", "intra-group loans");
      add(/regalias|royalt|licencia de uso|licence fee|license fee/, "regalías o licencias", "royalties or licences");
      if (/no (?:habra|tendremos|esperamos|hay) operaciones (?:intercompan\w*|con la matriz|entre partes relacionadas)|sin operaciones intercompan|no intercompany/.test(ctx.f)) return mk(ctx, "operaciones", { kinds: [] }, ctx.locale === "es" ? "Sin operaciones con el grupo" : "None expected");
      if (kinds.length === 0 && (hasTerm(ctx.f, "operaciones intercompania") || hasTerm(ctx.f, "operaciones entre partes relacionadas") || hasTerm(ctx.f, "intercompany transactions") || hasTerm(ctx.f, "related[- ]party transactions"))) return mk(ctx, "operaciones", { kinds: ["unspecified"], unspecified: true }, ctx.locale === "es" ? "Habrá operaciones con el grupo (tipo por precisar)" : "There will be group transactions (type to be specified)", { interpretive: "observed" });
      if (kinds.length === 0) return null;
      return mk(ctx, "servicios|equipo|prestamo|regalias|loan|services|equipment|royalt", { kinds }, kinds.join(", "));
    },
    complete: (it) => {
      const v = it.value as { kinds?: string[]; unspecified?: boolean } | null;
      return Boolean(v) && !(v!.unspecified && (v!.kinds ?? []).every((k) => k === "unspecified"));
    },
  },
  {
    key: "accounting.setup", dimension: "tax", order: 52,
    label: { es: "Contabilidad y reporte al grupo", en: "Accounting and group reporting" },
    question: L("¿Hoy quién lleva la contabilidad del grupo y qué necesitarán reportar a la casa matriz desde {dest}?", "Who keeps the group's accounting today, and what will you need to report to the parent from {dest}?"),
    why: { es: "Define si la contabilidad local debe alimentar la consolidación del grupo.", en: "It defines whether local accounting must feed the group's consolidation." },
    applies: (v) => v.has("accounting"),
    tier: () => "valuable",
    extract: (ctx) => {
      if (/consolid|reporte (?:a|para) la matriz|reportar a la matriz|ifrs|niif|group reporting|report to the parent/.test(ctx.f)) {
        const m = /consolid\w*|reporte (?:a|para) la matriz|reportar a la matriz|ifrs|niif|group reporting|report to the parent/.exec(ctx.f)![0];
        return mk(ctx, m, ctx.text.trim().slice(0, 140), spanAround(ctx.text, m, 120));
      }
      if (ctx.asked && ctx.f.length > 12 && ctx.f.length <= 300 && !answerKind(ctx.f)) return { value: ctx.text.trim().slice(0, 200), display: ctx.text.trim().slice(0, 120), quote: ctx.text.trim().slice(0, 160) };
      return null;
    },
  },
];

const PROBE_BY_KEY = new Map(PROBES.map((p) => [p.key, p]));
export const probeByKey = (key: string): ProbeDef | undefined => PROBE_BY_KEY.get(key);

/** Country names for question text. */
export function questionCtx(view: FrameView, locale: Loc): QuestionCtx {
  const dest = view.destination();
  const origin = view.frame.countries.find((c) => c.role === "origin" || c.role === "headquarters")?.code;
  return {
    locale,
    view,
    dest: dest ? countryName(dest, locale) : locale === "es" ? "el país destino" : "the destination country",
    origin: origin ? countryName(origin, locale) : locale === "es" ? "tu país de origen" : "your home country",
  };
}

export function parseCount(raw: string): number | null {
  return parseQuantity(raw);
}
