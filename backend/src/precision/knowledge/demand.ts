/**
 * Knowledge demand — what clients ask that approved knowledge (KSeed / Knowledge Layer) cannot answer yet.
 *
 * Precision is KNOWLEDGE-FIRST, NOT SEARCH-FIRST: when approved knowledge is absent or partial it recognises the limit, keeps the
 * diagnosis going, and registers the unmet demand here so people can decide what to curate. Nothing in this module searches the web,
 * and a demand NEVER publishes anything: recurrence only informs a person's decision.
 *
 * The record is normalised from CONTROLLED vocabularies only (country, topic, subtopic, category, information type...). It carries no
 * client text, no names, no identifiers: `describeDemand` reads the question to classify it and discards it, and `assertNormalized`
 * rejects any record that is not made of vocabulary values, so free text cannot reach storage.
 */
import { createHash } from "node:crypto";
import { fold } from "../understanding/text";
import type { Frame } from "../understanding/types";
import { BOUNDARY_KINDS, professionalAsk, type BoundaryKind } from "./boundary";
import { classifyTopics } from "./topics";
import { TOPICS, type Topic } from "./types";

export const COVERAGE = ["absent", "partial"] as const;
export type DemandCoverage = (typeof COVERAGE)[number];
/** Future knowledge item vs work a specialist does (the demand may be both, but the first disposition is the primary one). */
export const DISPOSITIONS = ["candidate_knowledge", "specialist_service"] as const;
export type DemandDisposition = (typeof DISPOSITIONS)[number];
export const REASONS = ["no_sources", "no_hits", "granularity", "professional_judgment", "unclassified"] as const;
export type DemandReason = (typeof REASONS)[number];
export const INFO_TYPES = ["regulatory_requirement", "tax_treatment", "procedure_steps", "cost_estimate", "timeline", "statistics_comparison", "local_provider_or_site", "market_data", "general_context"] as const;
export type InfoType = (typeof INFO_TYPES)[number];
/** Workflow of a demand. Only a person moves it; recurrence never does. */
export const DEMAND_STATUSES = ["open", "triaged", "accepted_for_curation", "kept_as_service", "declined"] as const;
export type DemandStatus = (typeof DEMAND_STATUSES)[number];

export interface KnowledgeDemand {
  /** ISO country code of the operation, "INT" for cross-border, "unknown" when the project has none yet. */
  country: string;
  topic: Topic | "unclassified";
  subtopic: string;
  /** Category of the service map the question belongs to (e.g. tax_accounting_audit), when known. */
  categoryKey: string | null;
  serviceKey: string | null;
  infoType: InfoType;
  coverage: DemandCoverage;
  disposition: DemandDisposition;
  reason: DemandReason;
  /** Set when the client asked for a determination that belongs to a specialist. */
  boundary: BoundaryKind | null;
}

// ------------------------------------------------------------------ vocabulary
/** Subtopics are a controlled list (grows through code review, not from client text). Unmatched questions land in "general". */
const SUBTOPICS: { topic: Topic; id: string; keywords: string[] }[] = [
  { topic: "taxes", id: "income_tax", keywords: ["isr", "impuesto sobre la renta", "income tax", "tasa corporativa"] },
  { topic: "taxes", id: "vat", keywords: ["iva", "valor agregado", "vat", "devolucion de iva"] },
  { topic: "taxes", id: "transfer_pricing", keywords: ["precios de transferencia", "transfer pricing", "partes relacionadas", "intercompany", "intercompania"] },
  { topic: "taxes", id: "withholding", keywords: ["retencion", "retenciones", "withholding", "dividendos", "regalias", "royalties"] },
  { topic: "taxes", id: "tax_registration", keywords: ["rfc", "alta en hacienda", "inscripcion fiscal", "tax registration", "firma electronica", "efirma"] },
  { topic: "taxes", id: "tax_incentives", keywords: ["incentivo fiscal", "estimulo fiscal", "tax incentive", "deduccion inmediata"] },
  { topic: "corporate_law", id: "entity_types", keywords: ["sociedad anonima", "s.a. de c.v.", "sapi", "s de rl", "tipo de sociedad", "entity type", "subsidiaria o sucursal", "sucursal"] },
  { topic: "corporate_law", id: "incorporation_steps", keywords: ["constituir", "constitucion", "acta constitutiva", "incorporation", "registro publico de comercio"] },
  { topic: "corporate_law", id: "foreign_ownership", keywords: ["inversion extranjera", "capital extranjero", "foreign ownership", "socio mexicano", "registro nacional de inversiones"] },
  { topic: "labor_market", id: "hiring_model", keywords: ["contratar", "contratacion", "employer of record", "eor", "subcontratacion", "outsourcing", "repse", "hiring"] },
  { topic: "labor_market", id: "talent_availability", keywords: ["disponibilidad de talento", "talento disponible", "mano de obra", "talent availability", "ingenieros", "perfiles"] },
  { topic: "wages", id: "salary_benchmarks", keywords: ["salario promedio", "cuanto se paga", "benchmark salarial", "salary benchmark", "sueldo"] },
  { topic: "wages", id: "mandatory_benefits", keywords: ["aguinaldo", "prima vacacional", "ptu", "reparto de utilidades", "prestaciones", "benefits"] },
  { topic: "social_security", id: "imss_registration", keywords: ["imss", "registro patronal", "seguro social", "cuotas obrero"] },
  { topic: "social_security", id: "infonavit_afore", keywords: ["infonavit", "afore", "sar"] },
  { topic: "customs", id: "tariff_classification", keywords: ["fraccion arancelaria", "clasificacion arancelaria", "tariff classification", "arancel", "tigie"] },
  { topic: "customs", id: "duty_regimes", keywords: ["immex", "importacion temporal", "deposito fiscal", "recinto fiscalizado", "temporary import", "regimen aduanero"] },
  { topic: "customs", id: "customs_brokerage", keywords: ["agente aduanal", "customs broker", "pedimento", "patente aduanal"] },
  { topic: "exports_trade", id: "trade_agreements", keywords: ["t-mec", "tmec", "usmca", "tratado de libre comercio", "certificado de origen", "reglas de origen", "trade agreement"] },
  { topic: "exports_trade", id: "export_procedures", keywords: ["exportar", "exportacion", "export procedure", "documentos de exportacion"] },
  { topic: "transportation_logistics", id: "ports_and_borders", keywords: ["puerto", "manzanillo", "veracruz", "lazaro cardenas", "altamira", "cruce fronterizo", "frontera", "border crossing", "port of"] },
  { topic: "transportation_logistics", id: "freight_costs", keywords: ["flete", "costo de transporte", "freight cost", "tarifa de carga"] },
  { topic: "transportation_logistics", id: "warehousing", keywords: ["almacen", "bodega", "warehouse", "centro de distribucion", "3pl"] },
  { topic: "infrastructure", id: "industrial_parks", keywords: ["parque industrial", "nave industrial", "industrial park", "industrial site", "suelo industrial"] },
  { topic: "infrastructure", id: "utilities", keywords: ["agua", "energia electrica", "gas natural", "internet", "utilities", "conectividad"] },
  { topic: "energy", id: "power_supply", keywords: ["suministro electrico", "cfe", "tarifa electrica", "power supply", "energia renovable"] },
  { topic: "immigration_mobility", id: "work_visas", keywords: ["visa de trabajo", "permiso de trabajo", "work permit", "work visa", "residente temporal", "inm"] },
  { topic: "regulatory_environment", id: "permits_licenses", keywords: ["permiso", "licencia", "licencia de funcionamiento", "permit", "license", "cofepris", "uso de suelo"] },
  { topic: "foreign_investment", id: "investment_incentives", keywords: ["incentivo", "estimulo", "plan mexico", "polos de bienestar", "incentive"] },
  { topic: "competitiveness_state", id: "state_comparison", keywords: ["comparar estados", "ranking de estados", "estado mas competitivo", "state ranking"] },
  { topic: "education_talent", id: "talent_pipeline", keywords: ["universidades", "egresados", "carreras", "graduates", "universities"] },
  { topic: "rule_of_law", id: "security_environment", keywords: ["seguridad", "robo", "crimen", "security situation"] },
];

export const SUBTOPIC_IDS: ReadonlySet<string> = new Set(["general", ...SUBTOPICS.map((s) => s.id)]);
const topicOfSubtopic = new Map(SUBTOPICS.map((s) => [s.id, s.topic] as const));

const INFO_RULES: { type: InfoType; any: string[] }[] = [
  { type: "local_provider_or_site", any: ["proveedor", "donde encontrar", "recomiendame un", "nave disponible", "parque disponible", "despacho", "provider", "where can i find", "vendor"] },
  { type: "cost_estimate", any: ["cuanto cuesta", "costo", "precio", "tarifa", "cuanto pagar", "how much", "cost of", "price"] },
  { type: "timeline", any: ["cuanto tarda", "cuanto tiempo", "plazo", "en cuanto tiempo", "how long", "timeline", "lead time"] },
  { type: "tax_treatment", any: ["impuesto", "isr", "iva", "tributa", "deducible", "retencion", "tax treatment", "taxed"] },
  { type: "regulatory_requirement", any: ["requisito", "obligatorio", "obligacion", "necesito para", "permiso", "licencia", "regulacion", "requirement", "required", "regulation"] },
  { type: "procedure_steps", any: ["como se hace", "como hago", "pasos", "proceso para", "tramite", "procedimiento", "how do i", "steps", "procedure"] },
  { type: "statistics_comparison", any: ["comparar", "comparacion", "ranking", "cuantos", "estadistica", "indice", "versus", " vs ", "compare", "statistics"] },
  { type: "market_data", any: ["tamano de mercado", "demanda", "competidores", "clientes potenciales", "market size", "demand", "competitors"] },
];

/** Default category for a topic when the project's own map does not settle it. */
const TOPIC_CATEGORY: Partial<Record<Topic, string>> = {
  taxes: "tax_accounting_audit", corporate_law: "corporate_legal_admin", foreign_investment: "corporate_legal_admin", regulatory_environment: "corporate_legal_admin",
  labor_market: "people_payroll_employment", wages: "people_payroll_employment", social_security: "people_payroll_employment", immigration_mobility: "people_payroll_employment",
  customs: "international_trade_customs", exports_trade: "international_trade_customs",
  transportation_logistics: "logistics", infrastructure: "industrial_real_estate", energy: "industrial_real_estate",
  competitiveness_state: "market_intelligence", economy_innovation: "market_intelligence", education_talent: "market_intelligence", rule_of_law: "market_intelligence",
};

// ------------------------------------------------------------------ describe
export interface DemandOutcome {
  coverage: "none" | "partial" | "full";
  reason: DemandReason;
  boundary?: BoundaryKind;
}

const has = (folded: string, words: string[]): boolean => words.some((w) => folded.includes(w));

export function classifyInfoType(question: string): InfoType {
  const f = ` ${fold(question)} `;
  for (const r of INFO_RULES) if (has(f, r.any)) return r.type;
  return "general_context";
}

export function classifySubtopic(question: string, topic: Topic | "unclassified"): string {
  const f = ` ${fold(question)} `;
  const pool = SUBTOPICS.filter((s) => topic === "unclassified" || s.topic === topic);
  let best: { id: string; n: number } | null = null;
  for (const s of pool) {
    const n = s.keywords.filter((k) => f.includes(fold(k))).length;
    if (n > 0 && (!best || n > best.n)) best = { id: s.id, n };
  }
  return best?.id ?? "general";
}

/** Topics a question is about: the topic classifier plus the topic implied by a specific subtopic keyword ("IMMEX" -> customs, "Manzanillo" -> logistics). */
export function topicsOfQuestion(question: string, max = 4): Topic[] {
  const t = classifyTopics(question, max) as Topic[];
  const sub = classifySubtopic(question, "unclassified");
  const st = sub !== "general" ? topicOfSubtopic.get(sub) : undefined;
  return st && !t.includes(st) ? [...t, st].slice(0, max) : t;
}

function countryOf(frame: Frame): string {
  const op = frame.countries.find((c) => c.role === "operation") ?? frame.countries.find((c) => c.role === "sales");
  return op?.code ? String(op.code).toUpperCase().slice(0, 2) : "unknown";
}

/**
 * Normalises one unmet question. Returns null when the knowledge fully covered it (nothing to register).
 * The question is read for classification only and is not part of the result.
 */
export function describeDemand(frame: Frame, question: string, outcome: DemandOutcome): KnowledgeDemand | null {
  if (outcome.coverage === "full" && !outcome.boundary) return null;
  const boundary = outcome.boundary ?? professionalAsk(question);
  const topics = classifyTopics(question, 1);
  let topic: Topic | "unclassified" = topics[0] ?? "unclassified";
  let subtopic = classifySubtopic(question, topic);
  // a specific subtopic keyword can point at a topic the topic classifier missed or tied on (e.g. "IMMEX" -> customs, "Manzanillo" -> logistics)
  if (subtopic === "general" && topic !== "unclassified") {
    const any = classifySubtopic(question, "unclassified");
    if (any !== "general") { subtopic = any; topic = topicOfSubtopic.get(any) ?? topic; }
  } else if (topic === "unclassified" && subtopic !== "general") topic = topicOfSubtopic.get(subtopic) ?? "unclassified";
  const infoType = classifyInfoType(question);
  const categoryKey = categoryFor(frame, topic, boundary);
  const serviceKey = categoryKey ? (frame.needs.find((n) => n.status !== "removed" && n.categoryKey === categoryKey)?.serviceKeys[0] ?? null) : null;

  const specialist = boundary !== null || infoType === "local_provider_or_site";
  const coverage: DemandCoverage = outcome.coverage === "partial" ? "partial" : "absent";
  const reason: DemandReason = boundary ? "professional_judgment" : topic === "unclassified" ? "unclassified" : outcome.reason;
  return { country: countryOf(frame), topic, subtopic, categoryKey, serviceKey, infoType, coverage, disposition: specialist ? "specialist_service" : "candidate_knowledge", reason, boundary };
}

function categoryFor(frame: Frame, topic: Topic | "unclassified", boundary: BoundaryKind | null): string | null {
  const open = new Set(frame.needs.filter((n) => n.status !== "removed" && n.categoryKey).map((n) => n.categoryKey as string));
  const preferred = topic !== "unclassified" ? TOPIC_CATEGORY[topic] ?? null : null;
  if (preferred && open.has(preferred)) return preferred;
  if (boundary) {
    const b = boundaryCategory(boundary);
    if (b && open.has(b)) return b;
  }
  return preferred ?? (boundary ? boundaryCategory(boundary) : null);
}
const boundaryCategory = (b: BoundaryKind): string | null => ({ tax_conclusion: "tax_accounting_audit", legal_opinion: "corporate_legal_admin", labor_advice: "people_payroll_employment", logistics_optimization: "logistics", market_entry_comparison: "market_intelligence", best_option: null, investment_recommendation: null } as Record<BoundaryKind, string | null>)[b];

// ------------------------------------------------------------------ normalisation guard
const SLUG = /^[a-z][a-z0-9_]{1,63}$/;
/** Service keys are catalog identifiers (capability ids such as CAP_HIVE_IL_3PL). */
const SERVICE_KEY = /^[A-Za-z][A-Za-z0-9_]{1,63}$/;
/** Throws unless every field is a controlled value. This is what keeps free text (and so PII) out of the registry. */
export function assertNormalized(d: KnowledgeDemand): void {
  const bad: string[] = [];
  if (!/^([A-Z]{2}|INT|unknown)$/.test(d.country)) bad.push("country");
  if (d.topic !== "unclassified" && !(TOPICS as readonly string[]).includes(d.topic)) bad.push("topic");
  if (!SUBTOPIC_IDS.has(d.subtopic)) bad.push("subtopic");
  if (d.categoryKey !== null && !SLUG.test(d.categoryKey)) bad.push("categoryKey");
  if (d.serviceKey !== null && !SERVICE_KEY.test(d.serviceKey)) bad.push("serviceKey");
  if (!(INFO_TYPES as readonly string[]).includes(d.infoType)) bad.push("infoType");
  if (!(COVERAGE as readonly string[]).includes(d.coverage)) bad.push("coverage");
  if (!(DISPOSITIONS as readonly string[]).includes(d.disposition)) bad.push("disposition");
  if (!(REASONS as readonly string[]).includes(d.reason)) bad.push("reason");
  if (d.boundary !== null && !(BOUNDARY_KINDS as readonly string[]).includes(d.boundary)) bad.push("boundary");
  if (bad.length) throw new Error(`knowledge demand is not normalised: ${bad.join(", ")}`);
}

/** Stable identity of a demand: the same need from any project lands on one row (that is what recurrence counts). */
export function demandId(d: KnowledgeDemand): string {
  return createHash("sha256").update([d.country, d.topic, d.subtopic, d.categoryKey ?? "-", d.infoType, d.coverage].join("|")).digest("hex").slice(0, 24);
}

/** Opaque, non-reversible reference used to count distinct projects/turns without storing identifiers. */
export const opaqueRef = (scope: string, value: string): string => createHash("sha256").update(`${scope}:${value}`).digest("hex").slice(0, 32);

// ------------------------------------------------------------------ repository port
export interface StoredDemand extends KnowledgeDemand {
  id: string;
  status: DemandStatus;
  occurrences: number;
  projects: number;
  firstSeenAt: string;
  lastSeenAt: string;
  decisionNote: string | null;
}
export interface DemandRepository {
  /** Idempotent per (demand, project, turn): a retried turn counts once. Never changes `status`. */
  register(d: KnowledgeDemand, ref: { projectId: string; turnKey: string }, now: string): Promise<StoredDemand>;
  list(filter?: { country?: string; topic?: string; status?: DemandStatus; minOccurrences?: number }): Promise<StoredDemand[]>;
  get(id: string): Promise<StoredDemand | null>;
  /** The ONLY way a status changes: an explicit decision by a person (Admin). */
  decide(id: string, status: DemandStatus, note: string | null, now: string): Promise<StoredDemand>;
}

export class InMemoryDemandRepository implements DemandRepository {
  private rows = new Map<string, StoredDemand>();
  private events = new Set<string>();
  private projectRefs = new Map<string, Set<string>>();

  async register(d: KnowledgeDemand, ref: { projectId: string; turnKey: string }, now: string): Promise<StoredDemand> {
    assertNormalized(d);
    const id = demandId(d);
    const ev = `${id}:${opaqueRef("p", ref.projectId)}:${opaqueRef("t", ref.turnKey)}`;
    const cur = this.rows.get(id) ?? { ...d, id, status: "open" as DemandStatus, occurrences: 0, projects: 0, firstSeenAt: now, lastSeenAt: now, decisionNote: null };
    if (!this.events.has(ev)) {
      this.events.add(ev);
      const set = this.projectRefs.get(id) ?? new Set<string>();
      set.add(opaqueRef("p", ref.projectId));
      this.projectRefs.set(id, set);
      cur.occurrences += 1;
      cur.projects = set.size;
      cur.lastSeenAt = now;
    }
    this.rows.set(id, cur);
    return { ...cur };
  }
  async list(f: { country?: string; topic?: string; status?: DemandStatus; minOccurrences?: number } = {}): Promise<StoredDemand[]> {
    return [...this.rows.values()].filter((r) => (!f.country || r.country === f.country) && (!f.topic || r.topic === f.topic) && (!f.status || r.status === f.status) && r.occurrences >= (f.minOccurrences ?? 0))
      .sort((a, b) => b.projects - a.projects || b.occurrences - a.occurrences || a.id.localeCompare(b.id)).map((r) => ({ ...r }));
  }
  async get(id: string): Promise<StoredDemand | null> { const r = this.rows.get(id); return r ? { ...r } : null; }
  async decide(id: string, status: DemandStatus, note: string | null, _now: string): Promise<StoredDemand> {
    void _now;
    const r = this.rows.get(id);
    if (!r) throw new Error(`unknown demand ${id}`);
    r.status = status;
    r.decisionNote = note;
    return { ...r };
  }
}
