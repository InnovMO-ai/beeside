/**
 * Product-owned wording of the Understanding conversation (L2 anchored wording): acknowledgements, clarifications, offers, the
 * checkpoint summary. Deterministic, tú register, one question per turn, no lists, no percentages, no quality judgments. The engine
 * runs every composed text through the same verifiers as any assistant text and falls back to the bare question on a violation.
 */
import { countryName } from "./countries";
import { conceptById } from "./concepts";
import { probeByKey, questionCtx, viewOf } from "./probes";
import type { Change } from "./frame";
import type { Frame, FrameItem, Loc, NeedItem } from "./types";

export const joinList = (items: readonly string[], loc: Loc): string => {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} ${loc === "es" ? "y" : "and"} ${xs[xs.length - 1]}`;
};
const AREA: Record<string, Record<Loc, string>> = {
  corporate_legal_admin: { es: "legal y corporativo", en: "corporate and legal" },
  tax_accounting_audit: { es: "fiscal y contable", en: "tax and accounting" },
  people_payroll_employment: { es: "personal y nómina", en: "people and payroll" },
  banking_finance_insurance: { es: "banca y seguros", en: "banking and insurance" },
  international_trade_customs: { es: "comercio exterior", en: "trade and customs" },
  logistics: { es: "logística", en: "logistics" },
  corporate_real_estate: { es: "oficinas", en: "offices" },
  industrial_real_estate: { es: "espacios industriales", en: "industrial space" },
  industrial_infrastructure: { es: "obra e infraestructura", en: "works and infrastructure" },
  technology_it: { es: "tecnología", en: "technology" },
  physical_security: { es: "seguridad física", en: "physical security" },
  procurement_supply_chain: { es: "compras y proveedores", en: "procurement" },
  certifications_quality: { es: "certificaciones", en: "certifications" },
  market_intelligence: { es: "inteligencia de mercado", en: "market intelligence" },
  marketing_communications: { es: "marketing", en: "marketing" },
  travel_mobility: { es: "viajes", en: "travel" },
  strategic_advisory: { es: "estrategia", en: "strategy" },
  ecosystem_development: { es: "ecosistema y socios", en: "ecosystem and partners" },
};
const lc = (s: string): string => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const stripEnd = (s: string): string => s.replace(/[\s.]+$/, "");

export const needPhrase = (n: NeedItem, loc: Loc): string => {
  const def = n.conceptIds[0] ? conceptById(n.conceptIds[0]) : undefined;
  return def ? def.phrase[loc] : stripEnd(n.text);
};

// ------------------------------------------------------------------ fact phrases
const SALIENCE = ["project.duration", "entity.form", "entity.activity", "entity.funding", "entity.funding_structure", "workforce.headcount", "workforce.model", "workforce.split", "workforce.origin", "workforce.benefits", "workforce.payroll_cadence", "tax.intercompany", "scale.revenue", "scale.volume", "scale.suppliers", "scale.inventory", "product.what", "trade.volume", "trade.temperature", "project.phases", "accounting.setup", "reporting.group", "scale.currencies", "scale.foreign_vendors", "accounting.systems", "compliance.status", "project.why"];

/** Valuable (non-blocking) questions: "I don't know" is not worth an acknowledgement. */
const QUIET_WHEN_PENDING = new Set(["project.why", "project.phases", "workforce.origin", "accounting.setup", "accounting.systems", "scale.currencies", "scale.foreign_vendors"]);
function pending(item: FrameItem, loc: Loc): string | null {
  const label = probeByKey(item.key)?.label[loc];
  if (!label || QUIET_WHEN_PENDING.has(item.key)) return null;
  if (item.status === "undecided") return loc === "es" ? `${lc(label)} queda por definir` : `${lc(label)} stays to be defined`;
  if (item.status === "unknown") return loc === "es" ? `${lc(label)} queda pendiente` : `${lc(label)} stays pending`;
  if (item.status === "withheld") return loc === "es" ? `${lc(label)} lo dejamos fuera por ahora` : `we leave ${lc(label)} out for now`;
  return null;
}

/** One short clause for a fact, in the client's language. */
export function factPhrase(item: FrameItem, loc: Loc): string | null {
  const p = pending(item, loc);
  if (p) return p;
  if (item.status !== "known") return null;
  const d = stripEnd(item.display);
  if (item.key === "workforce.model") {
    const m = item.value as string;
    const t = loc === "es" ? ({ direct: "los contratarían directamente", outsourced: "vendrían a través de un tercero", mixed: "parte directos y parte por un tercero" } as Record<string, string>)[m] : ({ direct: "you would hire them directly", outsourced: "they would come through a third party", mixed: "part direct, part through a third party" } as Record<string, string>)[m];
    if (t) return t;
  }
  const es: Record<string, string> = {
    "project.duration": `la operación durará ${d}`,
    "entity.form": `la entidad local será ${lc(d)}`,
    "entity.activity": `la operación local se encargaría de ${lc(d)}`,
    "entity.funding": `se financiaría con ${lc(d)}`,
    "entity.funding_structure": `la aportación de la matriz sería: ${lc(d)}`,
    "workforce.headcount": `necesitarán ${d}`,
    "workforce.model": `contratación: ${lc(d)}`,
    "workforce.split": `reparto: ${d}`,
    "workforce.origin": lc(d),
    "workforce.benefits": `prestaciones: ${lc(d)}`,
    "tax.intercompany": `operaciones con el grupo: ${lc(d)}`,
    "scale.revenue": `ingresos esperados de ${d}`,
    "scale.volume": `volumen esperado: ${d}`,
    "scale.suppliers": `proveedores locales: ${d}`,
    "scale.inventory": lc(d),
    "product.what": `el producto es ${lc(d)}`,
    "trade.volume": `volumen a mover: ${d}`,
    "trade.temperature": `temperatura: ${d}`,
    "project.phases": lc(d),
    "accounting.setup": `contabilidad: ${lc(d)}`,
    "workforce.payroll_cadence": lc(d),
    "reporting.group": lc(d),
    "accounting.systems": `sistema contable: ${d}`,
    "compliance.status": `obligaciones: ${lc(d)}`,
    "scale.currencies": lc(d),
    "scale.foreign_vendors": lc(d),
    "project.why": "",
  };
  const en: Record<string, string> = {
    "project.duration": `the operation will last ${d}`,
    "entity.form": `the local entity will be ${lc(d)}`,
    "entity.activity": `the local operation would handle ${lc(d)}`,
    "entity.funding": `it would be funded by ${lc(d)}`,
    "entity.funding_structure": `the parent's contribution would be: ${lc(d)}`,
    "workforce.headcount": `you will need ${d}`,
    "workforce.model": `hiring: ${lc(d)}`,
    "workforce.split": `split: ${d}`,
    "workforce.origin": lc(d),
    "workforce.benefits": `benefits: ${lc(d)}`,
    "tax.intercompany": `transactions with the group: ${lc(d)}`,
    "scale.revenue": `expected revenue of ${d}`,
    "scale.volume": `expected volume: ${d}`,
    "scale.suppliers": `local suppliers: ${d}`,
    "scale.inventory": lc(d),
    "product.what": `the product is ${lc(d)}`,
    "trade.volume": `volume to move: ${d}`,
    "trade.temperature": `temperature: ${d}`,
    "project.phases": lc(d),
    "accounting.setup": `accounting: ${lc(d)}`,
    "workforce.payroll_cadence": lc(d),
    "reporting.group": lc(d),
    "accounting.systems": `accounting system: ${d}`,
    "compliance.status": `obligations: ${lc(d)}`,
    "scale.currencies": lc(d),
    "scale.foreign_vendors": lc(d),
    "project.why": "",
  };
  const t = (loc === "es" ? es : en)[item.key];
  return t === undefined ? `${lc(probeByKey(item.key)?.label[loc] ?? item.key)}: ${d}` : t || null;
}

/** "Entendido: …" over what changed this turn (at most three clauses, in order of salience). */
export function acknowledge(frame: Frame, changes: readonly Change[], loc: Loc): string | null {
  const keys = changes.filter((c) => c.kind === "item").map((c) => c.key);
  const ordered = [...new Set(keys)].sort((a, b) => SALIENCE.indexOf(a) - SALIENCE.indexOf(b));
  const clauses: string[] = [];
  for (const k of ordered) {
    const it = frame.items[k];
    if (!it) continue;
    const ph = factPhrase(it, loc);
    if (ph) clauses.push(ph);
    if (clauses.length >= 3) break;
  }
  const newNeeds = changes.filter((c) => c.kind === "need");
  if (clauses.length === 0 && newNeeds.length > 0) {
    const names = newNeeds.slice(0, 3).map((c) => lc(c.display ?? c.key));
    return loc === "es" ? `Entendido, ${joinList(names, loc)}.` : `Understood, ${joinList(names, loc)}.`;
  }
  if (clauses.length === 0) return null;
  return loc === "es" ? `Entendido: ${joinList(clauses, loc)}.` : `Understood: ${joinList(clauses, loc)}.`;
}

// ------------------------------------------------------------------ the checkpoint
export function summarize(frame: Frame, loc: Loc): string {
  const view = viewOf(frame);
  const dest = view.destination();
  const destName = dest ? countryName(dest, loc) : null;
  const it = (k: string): FrameItem | undefined => (frame.items[k]?.status === "known" ? frame.items[k] : undefined);
  const sentences: string[] = [];

  // Situation
  const bits: string[] = [];
  const dur = it("project.duration");
  if (destName) bits.push(loc === "es" ? `operarán en ${destName}${dur ? ` durante ${dur.display}` : ""}` : `you will operate in ${destName}${dur ? ` for ${dur.display}` : ""}`);
  else if (dur) bits.push(loc === "es" ? `la operación durará ${dur.display}` : `the operation will last ${dur.display}`);
  if (frame.concepts.subcontracted_project) bits.push(loc === "es" ? "como subcontratados por quienes ganaron los proyectos" : "as subcontractors of the project winners");
  if (frame.phases.length >= 2) bits.push(loc === "es" ? `por fases (${frame.phases.map((p) => p.label).join(" y luego ")})` : `in phases (${frame.phases.map((p) => p.label).join(" and then ")})`);
  if (bits.length > 0) sentences.push(`${bits.join(", ")}.`.replace(/^./, (c) => c.toUpperCase()));

  // Needs, grouped by area so the list reads as a map and not as a dump
  const needs = frame.needs.filter((n) => n.status !== "removed");
  if (needs.length > 0) {
    const areas = new Map<string, string[]>();
    for (const n of needs) {
      const area = n.categoryKey ? (AREA[n.categoryKey]?.[loc] ?? "") : "";
      const name = n.conceptIds[0] ? lc(conceptById(n.conceptIds[0])!.label[loc]) : stripEnd(n.text);
      if (!areas.has(area)) areas.set(area, []);
      if (!areas.get(area)!.includes(name)) areas.get(area)!.push(name);
    }
    const parts = [...areas.entries()].map(([area, names]) => (area ? `${area} (${joinList(names, loc)})` : joinList(names, loc)));
    sentences.push(loc === "es" ? `Lo que necesitas: ${parts.join("; ")}.` : `What you need: ${parts.join("; ")}.`);
  }

  // Depth
  const facts = (keys: string[]): string[] => keys.map((k) => frame.items[k]).filter((i): i is FrameItem => i !== undefined && i.status === "known").map((i) => factPhrase(i, loc)).filter((x): x is string => Boolean(x));
  const entity = facts(["entity.form", "entity.activity", "entity.funding", "entity.funding_structure"]);
  if (entity.length > 0) sentences.push(`${loc === "es" ? "Entidad local" : "Local entity"}: ${entity.join("; ")}.`);
  const crew = facts(["workforce.headcount", "workforce.model", "workforce.split", "workforce.origin", "workforce.benefits"]);
  if (crew.length > 0) sentences.push(`${loc === "es" ? "Equipo" : "Team"}: ${crew.join("; ")}.`);
  const scale = facts(["scale.revenue", "scale.volume", "scale.suppliers", "scale.inventory"]);
  if (scale.length > 0) sentences.push(`${loc === "es" ? "Escala" : "Scale"}: ${scale.join("; ")}.`);
  const labelled = (keys: string[]): string[] => keys.map((k) => frame.items[k]).filter((i): i is FrameItem => i !== undefined && i.status === "known").map((i) => `${probeByKey(i.key)?.label[loc] ?? i.key}: ${stripEnd(i.display)}.`);
  sentences.push(...labelled(["tax.intercompany", "accounting.setup", "product.what", "trade.volume", "trade.temperature"]));

  // Priority (the client's)
  const top = frame.priority.groups.find((g) => g.rank === "top");
  if (frame.priority.status === "client_set" && top) {
    const names = top.subjects.map((s) => conceptById(s)?.phrase[loc] ?? s);
    sentences.push(loc === "es"
      ? `Lo primero para ti: ${joinList(names, loc)}${top.reason ? `, porque ${stripEnd(top.reason).replace(/^porque\s+/i, "")}` : ""}.`
      : `First for you: ${joinList(names, loc)}${top.reason ? `, because ${stripEnd(top.reason).replace(/^because\s+/i, "")}` : ""}.`);
  }

  const later = frame.priority.groups.find((g) => g.rank === "can_wait");
  if (frame.priority.status === "client_set" && later) {
    sentences.push(loc === "es" ? `Puede esperar: ${joinList(later.subjects.map((s) => conceptById(s)?.phrase[loc] ?? s), loc)}.` : `Can wait: ${joinList(later.subjects.map((s) => conceptById(s)?.phrase[loc] ?? s), loc)}.`);
  }

  // Open decisions
  const open = Object.values(frame.items).filter((i) => ["undecided", "unknown", "withheld"].includes(i.status)).map((i) => pending(i, loc)).filter((x): x is string => Boolean(x));
  if (open.length > 0) sentences.push(loc === "es" ? `Quedan abiertos: ${joinList(open.map((o) => o.replace(/ queda (por definir|pendiente)$/, "")), loc)}.` : `Still open: ${joinList(open.map((o) => o.replace(/ stays (to be defined|pending)$/, "")), loc)}.`);

  return sentences.join(" ").trim();
}

export const CHECKPOINT_QUESTION: Record<Loc, string> = { es: "¿Quieres corregir o agregar algo?", en: "Do you want to correct or add anything?" };

// ------------------------------------------------------------------ questions
export function questionFor(frame: Frame, probeKey: string, loc: Loc, withWhy: boolean): string {
  const probe = probeByKey(probeKey);
  if (!probe) return loc === "es" ? "¿Qué más debería saber de tu proyecto?" : "What else should I know about your project?";
  const q = probe.question(questionCtx(viewOf(frame), loc));
  return withWhy ? `${stripEnd(probe.why[loc])}. ${q}` : q;
}

export function priorityQuestion(loc: Loc, asked: number): string {
  if (asked === 0) return loc === "es" ? "Para ordenar el trabajo: ¿qué es lo que más te importa resolver primero y por qué?" : "To order the work: what matters most to you to solve first, and why?";
  return loc === "es" ? "Si tuvieras que elegir una sola cosa para resolver primero, ¿cuál sería?" : "If you had to pick one thing to solve first, which would it be?";
}

export function conflictQuestion(frame: Frame, key: string, loc: Loc): string {
  const prev = frame.items[key];
  const inc = frame.pendingConflicts.find((c) => c.key === key);
  const label = lc(probeByKey(key)?.label[loc] ?? key);
  if (inc?.source === "discovery") {
    return loc === "es"
      ? `En Discovery actualizaste ${label}: ${stripEnd(inc.display)}. Aquí me habías dicho ${stripEnd(prev?.display ?? "")}. ¿Cuál aplica?`
      : `In Discovery you updated ${label}: ${stripEnd(inc.display)}. Here you had told me ${stripEnd(prev?.display ?? "")}. Which one applies?`;
  }
  return loc === "es"
    ? `En Discovery quedó registrado ${label}: ${stripEnd(prev?.display ?? "")}. Ahora mencionas ${stripEnd(inc?.display ?? "")}. ¿Cuál aplica?`
    : `Discovery recorded ${label}: ${stripEnd(prev?.display ?? "")}. Now you mention ${stripEnd(inc?.display ?? "")}. Which one applies?`;
}

export function needClarifyQuestion(n: NeedItem, ambiguousQuestion: string | null, loc: Loc): string {
  if (ambiguousQuestion) return ambiguousQuestion;
  return loc === "es" ? `Mencionaste «${stripEnd(n.text)}». ¿Qué necesitas lograr con eso?` : `You mentioned “${stripEnd(n.text)}”. What do you need to achieve with it?`;
}

export function impliedQuestion(reason: string, phrase: string, loc: Loc): string {
  return loc === "es" ? `${stripEnd(reason)}. ¿Quieres que incluya ${lc(phrase)} entre tus necesidades?` : `${stripEnd(reason)}. Would you like me to include ${lc(phrase)} among your needs?`;
}
