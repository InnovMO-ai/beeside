/**
 * ENTERPRISE SERVICES — prepared diagnostic knowledge (RAM) for the back-office family: accounting, payroll, tax filings, e-invoicing,
 * accounts payable, financial reporting. It is part of the existing Understanding structure (probes + materiality + frame), NOT a module,
 * NOT a service catalog and NOT a questionnaire.
 *
 * What it is: a reusable, provider-neutral map of the operating dimensions that MAY become material when one of these services is in the
 * project (`ENTERPRISE_DIMENSIONS`, A-L), and the probes that read them out of the client's own narrative. Each probe
 *   - extracts every fact the client already gave, in whatever order and however many per message (one answer can satisfy several
 *     dimensions: "35 employees, biweekly payroll, IFRS to the parent every month" fills three at once);
 *   - asks only when the dimension is relevant to THIS project and still open; a fact already known is never asked again;
 *   - stops: a "valuable" dimension is asked at most twice per project (depth.ts) and "I do not know" is an answer.
 *
 * What it is not:
 *   - it never concludes anything legal or tax-related: it records what the client states (is the filing current? is there an open
 *     audit?) so the scope can be diagnosed and the right specialist involved;
 *   - it never owns the facts (project memory does), nor reusable external knowledge (Knowledge Layer), nor the service catalog
 *     (Service Explorer): a need the catalog cannot place follows the existing unknown-service route;
 *   - it carries no provider wording: the source workbook's provider-specific procedures (independence, engagement terms) are not
 *     beeside requirements and appear nowhere here. A static test guards that.
 *
 * Documents (dimension K) are recommended only when they would materially help later professional work: never requested up front.
 */
import { findCountryMentions } from "./countries";
import { hasSignal, materialSignals } from "./material-signals";
import type { ProbeCtx, ProbeDef, ProbeHit } from "./probes";
import { answerKind } from "./signals";
import { spanAround } from "./text";
import type { L10n } from "./types";

// ------------------------------------------------------------------ the map (A-L)
export type EnterpriseDimensionId = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L";

export interface EnterpriseDimension {
  id: EnterpriseDimensionId;
  key: string;
  label: L10n;
  /** Probes (this file or probes.ts) that read and, when material and open, ask this dimension. */
  probes: readonly string[];
  /** Category-manifest fields that hold the same facts for the Category Requirement Pack (no duplicate questioning: the frame feeds them). */
  manifestFields: readonly string[];
  /** How the dimension behaves: inherited, extracted when volunteered, or asked when material. */
  mode: "inherit" | "service_recognition" | "ask_when_material" | "extract_only" | "recommend_only";
  note: string;
}

export const ENTERPRISE_DIMENSIONS: readonly EnterpriseDimension[] = [
  { id: "A", key: "company_context", label: { es: "Contexto de la empresa y operación", en: "Company and operating context" }, probes: [], manifestFields: [],
    mode: "inherit", note: "Identity, incorporation and contact data come from Discovery / the Persona; never asked conversationally unless operationally necessary." },
  { id: "B", key: "required_services", label: { es: "Servicios de back-office requeridos", en: "Required back-office services" }, probes: [], manifestFields: ["tax_services_in_scope", "hr_services_in_scope"],
    mode: "service_recognition", note: "Recognised from the client's words through the concept lexicon (accounting, payroll, tax filings, e-invoicing, accounts payable, reporting). Open list: an unplaced need follows the unknown-service route." },
  { id: "C", key: "accounting_model", label: { es: "Modelo contable", en: "Accounting operating model" }, probes: ["accounting.setup", "accounting.systems", "scale.volume", "compliance.status"], manifestFields: ["tax_accounting_framework"],
    mode: "ask_when_material", note: "Who keeps the books today, the system used, volume. The state of the books is read through compliance.status." },
  { id: "D", key: "payroll_people", label: { es: "Nómina y personas", en: "Payroll and people operations" }, probes: ["workforce.headcount", "workforce.model", "workforce.benefits", "workforce.payroll_cadence"], manifestFields: ["hr_employee_population_breakdown", "hr_payroll_provider_status", "hr_statutory_benefits_confirmation"],
    mode: "ask_when_material", note: "Headcount, how staff is engaged, payroll periodicity, statutory vs additional benefits. Facts inherited from Discovery or Understanding are never asked again." },
  { id: "E", key: "billing_ap_volume", label: { es: "Facturación, cuentas por pagar y volumen", en: "Billing, accounts payable and volume" }, probes: ["scale.volume", "scale.currencies"], manifestFields: [],
    mode: "ask_when_material", note: "Monthly invoices and payments, currencies sold and paid in." },
  { id: "F", key: "related_parties", label: { es: "Partes relacionadas", en: "Intercompany and related parties" }, probes: ["tax.intercompany"], manifestFields: ["tax_has_intercompany_transactions", "tax_intercompany_transactions", "tax_transfer_pricing_documentation_status"],
    mode: "ask_when_material", note: "Reuses the existing Fiscal / Transfer Pricing logic (signals + materiality overlay). Nothing is asked twice." },
  { id: "G", key: "reporting_banking", label: { es: "Reporte financiero y banca", en: "Financial reporting and banking" }, probes: ["reporting.group"], manifestFields: ["tax_parent_reporting_required", "tax_parent_reporting_framework"],
    mode: "ask_when_material", note: "Framework, periodicity and delivery date of the reports the group expects; reporting currencies. Number of bank accounts is never asked." },
  { id: "H", key: "foreign_vendors", label: { es: "Proveedores del extranjero", en: "Foreign vendors" }, probes: ["scale.foreign_vendors"], manifestFields: [],
    mode: "ask_when_material", note: "Whether services are received from abroad and from whom (related or not): a scoping fact for cross-border accounting and tax review, never a conclusion." },
  { id: "I", key: "tax_status", label: { es: "Estado del cumplimiento fiscal", en: "Tax compliance status" }, probes: ["compliance.status"], manifestFields: ["tax_registration_status", "tax_audit_trigger"],
    mode: "ask_when_material", note: "Current, late, open audit: stated by the client, recorded as a fact. No tax conclusion is drawn." },
  { id: "J", key: "labor_status", label: { es: "Estado del cumplimiento laboral", en: "Labor compliance status" }, probes: ["compliance.status"], manifestFields: ["hr_local_entity_status"],
    mode: "ask_when_material", note: "Same single question as the tax status: one answer can cover books, tax and labor." },
  { id: "K", key: "readiness_documents", label: { es: "Documentación existente", en: "Existing documentation" }, probes: [], manifestFields: [],
    mode: "recommend_only", note: "Trial balance, financial statements, annual filings, monthly reporting examples, delivery calendars: suggested only when materially useful later; never a request list." },
  { id: "L", key: "service_governance", label: { es: "Gobierno de la prestación del servicio", en: "Service governance" }, probes: ["reporting.group"], manifestFields: [],
    mode: "extract_only", note: "Cadence and deadlines are read with the reporting probe; the operating contact comes from the Persona; a confidentiality requirement is captured only if the client raises it (cross-cutting fact, no NDA workflow). Independence procedures of any provider are NOT beeside client requirements." },
];

/** Documents worth suggesting later (never requested up front). Neutral names. */
export const ENTERPRISE_DOCUMENT_HINTS: readonly { id: string; label: L10n }[] = [
  { id: "trial_balance", label: { es: "Balanza de comprobación", en: "Trial balance" } },
  { id: "financial_statements", label: { es: "Estados financieros", en: "Financial statements" } },
  { id: "annual_filings", label: { es: "Declaraciones anuales", en: "Annual tax filings" } },
  { id: "reporting_examples", label: { es: "Ejemplos de reporte mensual al grupo", en: "Examples of monthly group reporting" } },
  { id: "chart_of_accounts", label: { es: "Catálogo de cuentas del grupo", en: "Corporate chart of accounts" } },
  { id: "delivery_calendar", label: { es: "Calendario de entregas", en: "Delivery calendar" } },
];

// ------------------------------------------------------------------ helpers
const T = (es: string, en: string): L10n => ({ es, en });
const sentencesOf = (f: string): string[] => f.split(/(?<=[.;!?\n])\s+/).map((s) => s.trim()).filter(Boolean);
const loc = <V,>(ctx: { locale: "es" | "en" }, es: V, en: V): V => (ctx.locale === "es" ? es : en);

function hit(ctx: ProbeCtx, term: string, value: unknown, display: string, extra: Partial<ProbeHit> = {}): ProbeHit {
  return { value, display, quote: spanAround(ctx.text, term), ...extra };
}

/** Back-office needs that make the operating-model dimensions relevant (not a closed catalog: the lexicon recognises the words). */
const BACKOFFICE = ["accounting", "tax_compliance", "payroll", "social_security", "electronic_invoicing", "accounts_payable"] as const;

/** A group above the local entity: a headquarters / origin country other than the destination, or a signal that a parent exists. */
function hasForeignGroup(view: Parameters<ProbeDef["applies"]>[0]): boolean {
  const dest = view.destination();
  if (view.frame.countries.some((c) => (c.role === "headquarters" || c.role === "origin") && c.code !== dest && c.provenance !== "ai_understood")) return true;
  const s = materialSignals(view.frame);
  return hasSignal(s, "foreign_parent") || hasSignal(s, "group_reporting") || hasSignal(s, "parent_funding");
}

/** The entity already operates in the country (so the state of its books and obligations is a fact worth knowing). */
const entityAlreadyThere = (view: Parameters<ProbeDef["applies"]>[0]): boolean => {
  const s = materialSignals(view.frame);
  return hasSignal(s, "existing_presence") && !view.has("entity_setup");
};

// ------------------------------------------------------------------ display of merged values (used by the frame when answers add up)
type Lc = "es" | "en";

function renderReporting(v: { frameworks?: string[]; cadence?: string }, l: Lc): string {
  const fw = (v.frameworks ?? []).map((id) => FRAMEWORKS.find((x) => x.id === id)?.label ?? id).join(" / ");
  const cad = REPORT_CADENCE.find((x) => x.id === v.cadence);
  const parts = [fw, cad ? cad[l] : ""].filter(Boolean);
  return l === "es" ? `Reporte ${parts.join(" ")}` : `Reporting ${parts.join(" ")}`;
}
function renderCurrencies(v: { invoice?: string[]; pay?: string[] }, l: Lc): string {
  const list = (a: string[]): string => a.join(" / ");
  return [(v.invoice ?? []).length ? (l === "es" ? `Facturan en ${list(v.invoice!)}` : `Invoice in ${list(v.invoice!)}`) : "", (v.pay ?? []).length ? (l === "es" ? `pagan en ${list(v.pay!)}` : `pay in ${list(v.pay!)}`) : ""].filter(Boolean).join("; ");
}
function renderSystems(v: { systems?: string[]; payroll?: string[]; none?: boolean }, l: Lc): string {
  const books = v.systems ?? [];
  const pay = v.payroll ?? [];
  if (books.length === 0 && pay.length === 0) return v.none ? (l === "es" ? "Sin sistema contable" : "No accounting system") : "";
  if (pay.length === 0) return books.join(", ");
  if (books.length === 0) return l === "es" ? `Nómina: ${pay.join(", ")}` : `Payroll: ${pay.join(", ")}`;
  if (books.join("|") === pay.join("|")) return l === "es" ? `Contabilidad y nómina: ${books.join(", ")}` : `Accounting and payroll: ${books.join(", ")}`;
  return l === "es" ? `Contabilidad: ${books.join(", ")}; nómina: ${pay.join(", ")}` : `Accounting: ${books.join(", ")}; payroll: ${pay.join(", ")}`;
}
function renderCompliance(v: Partial<Record<Domain | "general" | "openReview", unknown>>, l: Lc): string {
  const names = { books: l === "es" ? "contabilidad" : "books", tax: l === "es" ? "fiscal" : "tax", labor: l === "es" ? "laboral" : "labor", general: l === "es" ? "general" : "overall" } as const;
  const label = (k: unknown): string => (k === "current" ? (l === "es" ? "al corriente" : "up to date") : (l === "es" ? "con pendientes" : "with pending items"));
  const parts = (Object.keys(names) as (keyof typeof names)[]).filter((d) => v[d] !== undefined).map((d) => `${names[d]}: ${label(v[d])}`);
  if (v.openReview) parts.push(l === "es" ? "revisión abierta" : "open review");
  return parts.join("; ");
}

/** Probes whose later answers ADD to what is known (a framework first, its periodicity later; a currency list that grows). */
export const ENTERPRISE_ADDITIVE: readonly string[] = ["reporting.group", "scale.currencies", "compliance.status", "accounting.systems"];
export function enterpriseDisplay(key: string, value: unknown, l: Lc): string | null {
  const v = (value ?? {}) as never;
  if (key === "reporting.group") return renderReporting(v, l);
  if (key === "scale.currencies") return renderCurrencies(v, l);
  if (key === "compliance.status") return renderCompliance(v, l);
  if (key === "accounting.systems") return renderSystems(v, l);
  return null;
}

// ------------------------------------------------------------------ D · payroll periodicity
const CADENCES: readonly { id: "weekly" | "biweekly" | "monthly" | "other"; re: RegExp; es: string; en: string }[] = [
  { id: "other", re: /\b(?:catorcenal(?:es)?|cada catorce dias|cada 14 dias)\b/, es: "catorcenal", en: "every 14 days" },
  { id: "biweekly", re: /\b(?:quincenal(?:es)?|cada quincena|bi-?semanal(?:es)?|cada dos semanas|bi-?weekly|fortnightly|every two weeks|semi-?monthly|twice a month)\b/, es: "quincenal", en: "biweekly" },
  { id: "weekly", re: /\b(?:semanal(?:es)?|cada semana|weekly|every week)\b/, es: "semanal", en: "weekly" },
  { id: "monthly", re: /\b(?:mensual(?:es)?|cada mes|una vez al mes|monthly|once a month|every month)\b/, es: "mensual", en: "monthly" },
];
const PAYROLL_CONTEXT = /\b(?:nomina\w*|sueldos?|salarios?|payroll|pago(?:s)? (?:al|a los|de) (?:personal|empleados|trabajadores|colaboradores)|pagamos (?:a |al )?(?:nuestros |los )?(?:empleados|personal|trabajadores)|(?:we |to )?pay (?:our |the )?(?:employees|staff|team))\b/;

const payrollCadence: ProbeDef = {
  key: "workforce.payroll_cadence", dimension: "workforce", order: 37,
  label: T("Periodicidad de la nómina", "Payroll periodicity"),
  question: (q) => (q.locale === "es" ? "¿Cada cuánto pagan la nómina: semanal, quincenal, mensual u otra periodicidad?" : "How often do you run payroll: weekly, biweekly, monthly or another schedule?"),
  why: T("La periodicidad define el calendario y el volumen de la nómina que hay que operar.", "The periodicity defines the calendar and volume of the payroll to run."),
  applies: (v) => v.has("payroll") || v.has("social_security"),
  tier: (v) => (v.has("payroll") ? "material" : "valuable"),
  extract: (ctx) => {
    for (const s of sentencesOf(ctx.f)) {
      if (!PAYROLL_CONTEXT.test(s)) continue;
      const c = CADENCES.find((x) => x.re.test(s));
      if (c) return hit(ctx, c.id === "other" ? "catorcenal" : c.es, { cadence: c.id }, loc(ctx, `Nómina ${c.es}`, `Payroll ${c.en}`));
    }
    if (ctx.asked && ctx.f.length <= 90) {
      const c = CADENCES.find((x) => x.re.test(ctx.f));
      if (c) return hit(ctx, c.es, { cadence: c.id }, loc(ctx, `Nómina ${c.es}`, `Payroll ${c.en}`));
    }
    return null;
  },
};

// ------------------------------------------------------------------ G / L · reporting to the group
const FRAMEWORKS: readonly { id: string; re: RegExp; label: string }[] = [
  { id: "ifrs", re: /\b(?:ifrs|niif)\b/, label: "IFRS" },
  { id: "us_gaap", re: /\b(?:u\.?s\.? gaap|us-gaap|gaap (?:de )?(?:ee\.?\s?uu\.?|estados unidos|americanos?))\b/, label: "US GAAP" },
  { id: "local", re: /\b(?:nif|normas de informacion financiera|local gaap|pgc|snc)\b/, label: "local" },
];
const REPORT_CONTEXT = /\b(?:report\w*|informes?|estados financieros|cierre|consolid\w*|financial statements|reporting|package|paquete|entregable\w*|deliverable\w*)\b/;
const REPORT_CADENCE: readonly { id: "monthly" | "quarterly" | "semiannual" | "annual"; re: RegExp; es: string; en: string }[] = [
  { id: "monthly", re: /\b(?:mensual(?:es)?|cada mes|todos los meses|monthly|every month)\b/, es: "mensual", en: "monthly" },
  { id: "quarterly", re: /\b(?:trimestral(?:es)?|cada trimestre|quarterly|every quarter)\b/, es: "trimestral", en: "quarterly" },
  { id: "semiannual", re: /\b(?:semestral(?:es)?|cada semestre|semi-?annual|every six months)\b/, es: "semestral", en: "semiannual" },
  { id: "annual", re: /\b(?:anual(?:es)?|cada ano|annual(?:ly)?|yearly|every year)\b/, es: "anual", en: "annual" },
];
const DEADLINE = /\b(?:primeros? (\d{1,2}) dias habiles|(?:antes del|para el|el) dia (\d{1,2})|dentro de (?:los )?(\d{1,2}) dias habiles|within (\d{1,2}) business days|by the (\d{1,2})(?:st|nd|rd|th))\b/;
const TO_GROUP = /\b(?:matriz|grupo|corporativo|headquarters|parent|group|head office|casa matriz|holding)\b/;

const reportingGroup: ProbeDef = {
  key: "reporting.group", dimension: "tax", order: 53,
  label: T("Reporte financiero al grupo", "Group financial reporting"),
  question: (q) => (q.locale === "es" ? "Sobre el reporte que necesita el grupo: ¿bajo qué norma contable (por ejemplo IFRS) y con qué periodicidad lo reciben?" : "On the reporting the group needs: under which accounting framework (for example IFRS) and how often do they receive it?"),
  why: T("La norma y la periodicidad definen el cierre y los entregables que hay que preparar.", "The framework and periodicity define the close and the deliverables to prepare."),
  applies: (v) => v.hasAny(["accounting", "tax_compliance"]) && (hasForeignGroup(v) || Boolean(v.item("reporting.group"))),
  tier: (v) => (hasForeignGroup(v) ? "material" : "valuable"),
  extract: (ctx) => {
    const frameworks = new Set<string>();
    let cadence: (typeof REPORT_CADENCE)[number] | undefined;
    let deadline: string | undefined;
    let toGroup = false;
    let first = "";
    for (const s of sentencesOf(ctx.f)) {
      const fw = FRAMEWORKS.filter((x) => x.re.test(s));
      const reporting = REPORT_CONTEXT.test(s) || fw.length > 0;
      if (!reporting) continue;
      for (const x of fw) { frameworks.add(x.id); first ||= x.id === "ifrs" ? "ifrs|niif" : x.label; }
      const cad = REPORT_CADENCE.find((x) => x.re.test(s));
      // a cadence only counts when the sentence talks about reporting, not payroll or a different subject
      if (cad && !cadence && (fw.length > 0 || REPORT_CONTEXT.test(s)) && !PAYROLL_CONTEXT.test(s)) { cadence = cad; first ||= "report|informe|reporte|cierre"; }
      const d = DEADLINE.exec(s);
      if (d && !deadline) deadline = d.slice(1).find(Boolean);
      if (TO_GROUP.test(s)) toGroup = true;
    }
    if (frameworks.size === 0 && !cadence) {
      if (ctx.asked && ctx.f.length <= 90) {
        const cad = REPORT_CADENCE.find((x) => x.re.test(ctx.f));
        if (cad) { const value = { frameworks: [], cadence: cad.id, toGroup: true }; return hit(ctx, cad.es, value, renderReporting(value, ctx.locale)); }
      }
      return null;
    }
    const value = { frameworks: [...frameworks], ...(cadence ? { cadence: cadence.id } : {}), ...(deadline ? { deadlineDay: Number(deadline) } : {}), toGroup };
    return hit(ctx, first || "report|informe|reporte", value, renderReporting(value, ctx.locale));
  },
  complete: (item) => {
    const v = item.value as { frameworks?: string[]; cadence?: string } | null;
    return Boolean(v) && (v!.frameworks ?? []).length > 0 && Boolean(v!.cadence);
  },
  merge: (prev, inc) => {
    const a = (prev ?? {}) as { frameworks?: string[]; cadence?: string; deadlineDay?: number; toGroup?: boolean };
    const b = (inc ?? {}) as typeof a;
    return { frameworks: [...new Set([...(a.frameworks ?? []), ...(b.frameworks ?? [])])], ...((b.cadence ?? a.cadence) ? { cadence: b.cadence ?? a.cadence } : {}), ...((b.deadlineDay ?? a.deadlineDay) ? { deadlineDay: b.deadlineDay ?? a.deadlineDay } : {}), toGroup: Boolean(a.toGroup || b.toGroup) };
  },
};

// ------------------------------------------------------------------ C · accounting system
const SYSTEMS = ["sap", "contpaqi", "contpaq", "aspel", "quickbooks", "odoo", "netsuite", "xero", "sage", "dynamics", "oracle", "zoho", "alegra", "siigo", "excel"] as const;
const SYSTEM_LABEL: Record<string, string> = { sap: "SAP", contpaqi: "CONTPAQi", contpaq: "CONTPAQi", aspel: "Aspel", quickbooks: "QuickBooks", odoo: "Odoo", netsuite: "NetSuite", xero: "Xero", sage: "Sage", dynamics: "Dynamics", oracle: "Oracle", zoho: "Zoho", alegra: "Alegra", siigo: "Siigo", excel: "Excel" };
const SYSTEM_CONTEXT = /\b(?:contab\w*|accounting|bookkeeping|sistema|software|erp|libros|nomina|payroll|facturacion|invoicing)\b/;
const FOR_WORD = "(?:para|de|del|en|for|of|in)";
const SKIP_ART = "(?:(?:la|el|los|las|nuestra|nuestro|the|our)\\s+)?";
type Family = "books" | "payroll";
const FAMILY_RE: Record<Family, string> = { books: "(?:contab\\w*|accounting|bookkeeping|libros|facturacion|invoicing)", payroll: "(?:nomina\\w*|payroll|sueldos?|salarios?)" };
const familiesIn = (text: string): Family[] => (["books", "payroll"] as Family[]).filter((f) => new RegExp(`\\b${FAMILY_RE[f]}`).test(text));

/**
 * Which activity does a system serve? Read from the words around the mention, not from the whole sentence:
 * "X para la contabilidad y Y para la nómina" -> X books, Y payroll; "contabilidad en X y nómina en Y" -> the same;
 * "contabilidad y nómina en SAP" -> both. No nearby cue: the whole sentence if it names only one activity, otherwise the books.
 */
function systemFamilies(sentence: string, at: number, end: number, prevEnd: number): Family[] {
  // system followed by "para/de ... <activity>" (and a second activity joined by "y")
  const after = sentence.slice(end, end + 70);
  const m = new RegExp(`^(?:\\s+\\w+){0,3}?\\s+${FOR_WORD}\\s+${SKIP_ART}(${FAMILY_RE.books}|${FAMILY_RE.payroll})(\\s+(?:y|e|and|,)\\s+${SKIP_ART}(${FAMILY_RE.books}|${FAMILY_RE.payroll}))?`).exec(after);
  if (m) return familiesIn(m[0]);
  // activity words just before the system, after the previous system
  const before = sentence.slice(Math.max(prevEnd, at - 45), at);
  const fam = familiesIn(before);
  if (fam.length > 0) return fam;
  const whole = familiesIn(sentence);
  return whole.length === 1 ? whole : ["books"];
}

const accountingSystems: ProbeDef = {
  key: "accounting.systems", dimension: "tax", order: 54,
  label: T("Sistema contable", "Accounting system"),
  question: (q) => (q.locale === "es" ? "¿Con qué sistema o software llevan hoy la contabilidad?" : "Which system or software do you use today for accounting?"),
  why: T("Saber con qué sistema trabajan ayuda a dimensionar el cambio y la integración.", "Knowing the system in use helps size the change and the integration."),
  applies: (v) => v.has("accounting") && entityAlreadyThere(v),
  tier: () => "valuable",
  extract: (ctx) => {
    // a system belongs to the activity named next to it: the accounting system and the payroll system may differ (or be the same one)
    const books: string[] = [];
    const payroll: string[] = [];
    let first = "";
    for (const s of sentencesOf(ctx.f)) {
      if (!SYSTEM_CONTEXT.test(s) && !ctx.asked) continue;
      const found = SYSTEMS.map((name) => ({ name, m: new RegExp(`\\b${name}\\b`).exec(s) })).filter((x) => x.m).sort((x, y) => x.m!.index - y.m!.index);
      let prevEnd = 0;
      for (const { name, m } of found) {
        const label = SYSTEM_LABEL[name]!;
        const fam = systemFamilies(s, m!.index, m!.index + m![0].length, prevEnd);
        prevEnd = m!.index + m![0].length;
        if (fam.includes("books") && !books.includes(label)) books.push(label);
        if (fam.includes("payroll") && !payroll.includes(label)) payroll.push(label);
        first ||= label.toLowerCase();
      }
    }
    if (books.length > 0 || payroll.length > 0) return hit(ctx, first, { systems: books, ...(payroll.length ? { payroll } : {}) }, renderSystems({ systems: books, payroll }, ctx.locale));
    if (ctx.asked && /\b(?:ninguno|no usamos|sin sistema|hojas? de calculo|spreadsheets?|no system)\b/.test(ctx.f)) return hit(ctx, "ninguno|sin sistema|hojas? de calculo|spreadsheets?|no system", { systems: [], none: true }, loc(ctx, "Sin sistema contable", "No accounting system"));
    return null;
  },
  // a payroll system alone does not answer which system keeps the books
  complete: (item) => {
    const v = item.value as { systems?: string[]; none?: boolean } | null;
    return Boolean(v) && ((v!.systems ?? []).length > 0 || Boolean(v!.none));
  },
  merge: (prev, inc) => {
    const a = (prev ?? {}) as { systems?: string[]; payroll?: string[]; none?: boolean };
    const b = (inc ?? {}) as typeof a;
    const payroll = [...new Set([...(a.payroll ?? []), ...(b.payroll ?? [])])];
    return { systems: [...new Set([...(a.systems ?? []), ...(b.systems ?? [])])], ...(payroll.length ? { payroll } : {}), ...((a.none || b.none) ? { none: true } : {}) };
  },
};

// ------------------------------------------------------------------ E · currencies of invoicing and payment
const CURRENCIES: readonly { code: string; re: RegExp }[] = [
  { code: "MXN", re: /\b(?:mxn|pesos?(?: mexicanos?)?|mexican pesos?)\b/ },
  { code: "USD", re: /\b(?:usd|dolar(?:es)?|us dollars?|dollars?)\b/ },
  { code: "EUR", re: /\b(?:eur|euros?)\b/ },
  { code: "GBP", re: /\b(?:gbp|libras? esterlinas?|pounds?)\b/ },
];
const INVOICE_VERB = /\b(?:factur\w+|cobr\w+|vend\w+|ingres\w+|invoic\w+|bill\w*|sell\w*|sales?|revenue)\b/;
const PAY_VERB = /\b(?:pag\w+|compr\w+|proveedor\w*|vendor\w*|supplier\w*|pay\w*|purchas\w+)\b/;

const currencies: ProbeDef = {
  key: "scale.currencies", dimension: "tax", order: 56,
  label: T("Monedas de facturación y de pago", "Invoicing and payment currencies"),
  question: (q) => (q.locale === "es" ? "¿En qué monedas facturan a sus clientes y en cuáles pagan a sus proveedores?" : "In which currencies do you invoice customers and in which do you pay vendors?"),
  why: T("Las monedas definen el tratamiento contable y las conciliaciones.", "The currencies define the accounting treatment and reconciliations."),
  applies: (v) => v.hasAny(["accounting", "tax_compliance", "electronic_invoicing", "accounts_payable"]),
  tier: () => "valuable",
  extract: (ctx) => {
    const invoice = new Set<string>();
    const pay = new Set<string>();
    for (const s of sentencesOf(ctx.f)) {
      const hits = CURRENCIES.map((c) => ({ code: c.code, m: c.re.exec(s) })).filter((x) => x.m);
      if (hits.length === 0) continue;
      const inv = INVOICE_VERB.exec(s);
      const pa = PAY_VERB.exec(s);
      for (const h of hits) {
        const at = h.m!.index;
        // the verb that governs the currency is the nearest one before it (else the nearest after)
        const dist = (m: RegExpExecArray | null): number => (m ? (m.index <= at ? at - m.index : (m.index - at) + 200) : Infinity);
        const toInvoice = dist(inv) <= dist(pa);
        if (!inv && !pa) { if (ctx.asked) invoice.add(h.code); continue; }
        (toInvoice ? invoice : pay).add(h.code);
      }
    }
    if (invoice.size === 0 && pay.size === 0) return null;
    const value = { invoice: [...invoice], pay: [...pay] };
    return hit(ctx, "pesos|dolares|euros|mxn|usd|eur|dollars", value, renderCurrencies(value, ctx.locale));
  },
  complete: (item) => ((item.value as { invoice?: string[] } | null)?.invoice ?? []).length > 0,
  merge: (prev, inc) => {
    const a = (prev ?? {}) as { invoice?: string[]; pay?: string[] };
    const b = (inc ?? {}) as typeof a;
    return { invoice: [...new Set([...(a.invoice ?? []), ...(b.invoice ?? [])])], pay: [...new Set([...(a.pay ?? []), ...(b.pay ?? [])])] };
  },
};

// ------------------------------------------------------------------ H · foreign vendors
const ABROAD = /\b(?:extranjer\w+|exterior|fuera del pais|foreign|abroad|overseas|offshore)\b/;
const RECEIVE = /\b(?:recib\w+|contrat\w+|compr\w+|pag\w+|adquir\w+|nos (?:prestan|brindan|facturan)|receiv\w+|buy\w*|bought|purchas\w+|pay\w*|engage\w*)\b/;
const RELATED = /\b(?:relacionad\w+|del grupo|afiliad\w+|filial\w*|matriz|related|affiliate\w*|group compan\w+)\b/;
const NO_FOREIGN = /\b(?:no (?:tenemos|hay|habra|contamos con|usamos) (?:ningun )?proveedor(?:es)? (?:del )?(?:extranjer\w+|exterior)|sin proveedores (?:del )?(?:extranjer\w+|exterior)|no foreign (?:vendors|suppliers))\b/;

const foreignVendors: ProbeDef = {
  key: "scale.foreign_vendors", dimension: "tax", order: 57,
  label: T("Proveedores del extranjero", "Foreign vendors"),
  question: (q) => (q.locale === "es" ? "¿Reciben servicios o compras de proveedores del extranjero? Si es así, cuéntame de qué tipo y en qué países." : "Do you receive services or purchases from vendors abroad? If so, tell me what kind and in which countries."),
  why: T("Los pagos al extranjero tienen tratamiento contable y fiscal propio que conviene revisar.", "Payments abroad have their own accounting and tax treatment worth reviewing."),
  applies: (v) => v.hasAny(["accounting", "tax_compliance", "accounts_payable"]),
  tier: (v) => (v.has("accounts_payable") ? "material" : "valuable"),
  extract: (ctx) => {
    if (NO_FOREIGN.test(ctx.f)) return hit(ctx, "proveedores|foreign", { has: false }, loc(ctx, "Sin proveedores del extranjero", "No foreign vendors"));
    for (const s of sentencesOf(ctx.f)) {
      if (!ABROAD.test(s) || !(RECEIVE.test(s) || /\bproveedor/.test(s))) continue;
      const related = RELATED.test(s);
      const services = /\bservicio/.test(s) || /\bservices?\b/.test(s);
      return hit(ctx, ABROAD.exec(s)![0], { has: true, related, services }, loc(ctx, related ? "Recibe servicios de una empresa relacionada en el extranjero" : "Tiene proveedores en el extranjero", related ? "Receives services from a related company abroad" : "Has vendors abroad"));
    }
    if (ctx.asked) {
      const k = answerKind(ctx.f);
      // "De Alemania, servicios de TI": naming where the vendors are answers the question without the word "extranjero"
      const dest = ctx.view.destination();
      const abroad = findCountryMentions(ctx.f, ctx.text).filter((m) => m.code !== dest);
      if (abroad.length > 0 && (k === null || k === "yes")) {
        const related = RELATED.test(ctx.f);
        const services = /\bservicio|\blicencia|\bsoftware|\bservices?\b|\blicen[cs]es?\b/.test(ctx.f);
        return hit(ctx, abroad[0]!.term, { has: true, related, services, countries: [...new Set(abroad.map((m) => m.code))] }, loc(ctx, related ? "Recibe servicios de una empresa relacionada en el extranjero" : "Tiene proveedores en el extranjero", related ? "Receives services from a related company abroad" : "Has vendors abroad"));
      }
      if (k === "no") return hit(ctx, "no", { has: false }, loc(ctx, "Sin proveedores del extranjero", "No foreign vendors"));
      if (k === "yes") return hit(ctx, "si|yes", { has: true }, loc(ctx, "Tiene proveedores en el extranjero", "Has vendors abroad"));
    }
    return null;
  },
};

// ------------------------------------------------------------------ C / I / J · state of books, taxes and labor obligations
type Domain = "books" | "tax" | "labor";
const DOMAIN_TERMS: Record<Domain, RegExp> = {
  tax: /\b(?:fiscal\w*|impuestos?|sat|declaraciones?|iva|tax\w*|vat|filings?)\b/,
  books: /\b(?:contab\w*|libros|conciliaci\w+|accounting|books|bookkeeping)\b/,
  labor: /\b(?:laboral\w*|imss|infonavit|seguridad social|nomina|obligaciones obrero|labor|labour|payroll|social security)\b/,
};
const CURRENT = /\b(?:al corriente|al dia|sin (?:rezagos?|pendientes|atrasos|adeudos)|up to date|current|in good standing|no (?:pending|outstanding))\b/;
const BEHIND = /\b(?:atrasad\w+|rezag\w+|pendientes?|retras\w+|adeud\w+|omit\w+|overdue|late|behind|outstanding|backlog|sin conciliar|desordenad\w+|unreconciled|errores|diferencias|discrepancias|inconsistencias|no cuadra\w*|regulariz\w+|depurar|depuracion|erroneo\w*|errors?|discrepanc\w+|inconsisten\w+|clean-?up|restate\w*)\b/;
const OPEN_AUDIT = /\b(?:(?:auditoria|revision|requerimiento|carta invitacion)[^.;]{0,30}(?:abiert[oa]|en curso|vigente|del sat|pendiente)|(?:abiert[oa]|en curso)[^.;]{0,20}(?:auditoria|revision)|open (?:tax )?audit|audit (?:is )?(?:open|ongoing)|under (?:tax )?audit)\b/;

const complianceStatus: ProbeDef = {
  key: "compliance.status", dimension: "tax", order: 55,
  label: T("Estado de las obligaciones contables, fiscales y laborales", "State of accounting, tax and labor obligations"),
  question: (q) => (q.locale === "es" ? `Hoy en ${q.dest}, ¿están al corriente en sus obligaciones contables, fiscales y laborales, o hay algo atrasado o en revisión?` : `Today in ${q.dest}, are you up to date on your accounting, tax and labor obligations, or is anything late or under review?`),
  why: T("Saber si hay algo atrasado o en revisión define por dónde empezar y qué especialista conviene involucrar.", "Knowing whether anything is late or under review defines where to start and which specialist to involve."),
  applies: (v) => v.hasAny(BACKOFFICE) && entityAlreadyThere(v),
  tier: () => "material",
  extract: (ctx) => {
    const status: Partial<Record<Domain | "general", "current" | "behind">> = {};
    let audit = false;
    let anchor = "";
    for (const sentence of sentencesOf(ctx.f)) {
      if (OPEN_AUDIT.test(sentence)) { audit = true; anchor ||= "auditoria|revision|audit|requerimiento"; }
      // clauses: a contrast ("lo fiscal está al corriente, pero la contabilidad tiene rezagos") gives each part its own status;
      // domains named before the clause that carries the status share it ("fiscal y laboral al corriente").
      let pending: Domain[] = [];
      for (const clause of sentence.split(/\s*(?:,|;|\bpero\b|\baunque\b|\bmientras que\b|\bsin embargo\b|\bbut\b|\bhowever\b|\bwhile\b)\s*/)) {
        const cur = CURRENT.exec(clause);
        const beh = BEHIND.exec(clause);
        const domains = (Object.keys(DOMAIN_TERMS) as Domain[]).filter((d) => DOMAIN_TERMS[d].test(clause));
        if (!cur && !beh) { pending = [...new Set([...pending, ...domains])]; continue; }
        // a stray "pendiente" / "late" is a compliance statement only next to a domain (or as the direct answer to the question)
        const targets = [...new Set([...pending, ...domains])];
        if (targets.length === 0 && !ctx.asked) continue;
        const value = cur && !(beh && beh.index < cur.index) ? "current" : beh ? "behind" : "current";
        for (const d of targets.length ? targets : (["general"] as const)) status[d] = value;
        anchor ||= (cur ?? beh)![0];
        pending = [];
      }
    }
    if (Object.keys(status).length === 0 && !audit) return null;
    const value = { ...status, ...(audit ? { openReview: true } : {}) };
    return hit(ctx, anchor, value, renderCompliance(value, ctx.locale));
  },
  merge: (prev, inc) => ({ ...((prev ?? {}) as object), ...((inc ?? {}) as object) }),
};

export const ENTERPRISE_PROBES: readonly ProbeDef[] = [payrollCadence, reportingGroup, accountingSystems, complianceStatus, currencies, foreignVendors];
