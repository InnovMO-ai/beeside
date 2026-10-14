/**
 * Interpreter port + the deterministic rule interpreter.
 *
 * "The AI understands, the product decides": ANY interpreter (this rule-based one, or a model-backed one) only returns an
 * `Interpretation` — proposed observations with the client's quote. The governor (governor.ts) validates it and the frame reducer
 * (frame.ts) decides what becomes knowledge. The rule interpreter is the offline, auditable baseline and the fallback when the model
 * is unavailable, so Understanding never depends on a model being up to be useful.
 */
import { COUNTRIES, countryByCode, findCountryMentions } from "./countries";
import { CONCEPTS, conceptById, type ConceptDef } from "./concepts";
import { PROBES, viewOf, type ProbeCtx } from "./probes";
import { answerKind, type AnswerKind } from "./signals";
import { fold, hasTerm, spanAround, spanAt, squash, termRegex } from "./text";
import type { CountryRole, Frame, Interpretive, ItemStatus, Loc, NeedResolution, PriorityRank } from "./types";

// ------------------------------------------------------------------ schema
export interface Observation { key: string; value: unknown; display: string; quote: string; interpretive: Interpretive; status?: ItemStatus; why?: string; confidence?: number }
export interface ConceptHit { id: string; quote: string }
export interface NeedHit { text: string; conceptIds: string[]; quote: string; resolution: NeedResolution; covered?: boolean }
export interface CountryHit { code: string; role: CountryRole; quote: string; phase?: number }
export interface PhaseHit { label: string; countries: string[]; quote: string }
export interface RationaleHit { subject: string; text: string; quote: string }
export interface PriorityHit { subjects: string[]; rank: PriorityRank; reason?: string; timing?: string; quote: string }
export type Intent = "answer" | "unknown" | "withheld" | "undecided" | "done" | "question" | "add_service" | "unclear" | "affirm" | "deny";

export interface Interpretation {
  source: "rules" | "model" | "discovery";
  intent: Intent;
  /** The client states this is a correction of something said before. */
  correction: boolean;
  observations: Observation[];
  concepts: ConceptHit[];
  needs: NeedHit[];
  countries: CountryHit[];
  phases: PhaseHit[];
  rationale: RationaleHit[];
  priorities: PriorityHit[];
  /** The client asks something (kept verbatim, routed by the engine: process answer / knowledge orientation). */
  question: string | null;
  /** The answer to the asked probe was "unknown" / "withheld" / "undecided" (no value). */
  answerState: Exclude<AnswerKind, "yes" | "no" | "done" | null> | null;
  /** The bare yes/no of a short reply (the engine decides what it answers). */
  yesNo: "yes" | "no" | null;
}

export interface InterpretInput {
  text: string;
  locale: Loc;
  frame: Frame;
  /** Probe key of the question just asked, or null. */
  asked: string | null;
  source: "client" | "discovery";
}

export interface Interpreter {
  describe(): { implementation: string };
  interpret(input: InterpretInput): Promise<Interpretation>;
}

export const emptyInterpretation = (source: Interpretation["source"] = "rules"): Interpretation => ({
  source, intent: "unclear", correction: false, observations: [], concepts: [], needs: [], countries: [], phases: [], rationale: [], priorities: [], question: null, answerState: null, yesNo: null,
});

// ------------------------------------------------------------------ concepts
const CONCEPT_MATCHERS: { def: ConceptDef; terms: string[] }[] = CONCEPTS.map((def) => ({ def, terms: [] }));
function termsOf(def: ConceptDef, loc: Loc): string[] {
  // Both languages are always read: clients mix them ("el EOR", "Warehouse"), and the displayed language stays the client's.
  return [...def.terms.es, ...def.terms.en];
}
void CONCEPT_MATCHERS;

const COVERED = /(?:ya (?:tenemos|tengo|contamos con|cuento con|esta cubiert\w+|lo tenemos|resolvimos)|no (?:necesitamos|requerimos|queremos|vamos a necesitar|ocupamos)|ya (?:lo )?(?:hacemos|resuelve)|already have|already covered|do not need|don't need|we do not need|no need for)/;

export function detectConcepts(text: string, f: string): { hits: ConceptHit[]; covered: Set<string> } {
  const hits: ConceptHit[] = [];
  const covered = new Set<string>();
  for (const def of CONCEPTS) {
    for (const term of termsOf(def, "es")) {
      const m = termRegex(term).exec(f);
      if (!m) continue;
      const before = f.slice(Math.max(0, m.index - 55), m.index);
      const sentenceStart = Math.max(before.lastIndexOf("."), before.lastIndexOf(";"), before.lastIndexOf("\n"));
      const window = sentenceStart >= 0 ? before.slice(sentenceStart + 1) : before;
      // "no manejaremos inventario", "sin proveedores": a negated mention is not evidence of a need.
      if (/(?:\bno\b|\bsin\b|\bni\b|\bnunca\b|\bwithout\b|\bnot\b|\bnever\b)[^.;,]{0,34}$/.test(window) && !COVERED.test(window)) continue;
      if (COVERED.test(window) && def.kind === "need") covered.add(def.id);
      hits.push({ id: def.id, quote: spanAt(text, m.index) });
      break;
    }
  }
  return { hits, covered };
}

// ------------------------------------------------------------------ countries, roles, phases
const SEQUENCERS = /(?:luego|despues|posteriormente|mas adelante|en una segunda (?:etapa|fase)|segunda fase|en una siguiente fase|then|later|afterwards|after that|second phase|next phase|en un segundo momento)/;
const HQ = /(?:casa matriz|empresa matriz|matriz|sede|oficinas centrales|headquarter\w*|head office|parent(?: company)?|corporate office)\s*(?:esta\s+)?(?:en|in|:)?\s*$/;
const FROM = /(?:desde|de parte de|procedente de|proveniente de|originarios? de|from|out of)\s*$/;
const SALES = /(?:vender(?:\s+\w+){0,3}\s+(?:en|a)|ventas?\s+(?:en|a)|clientes?\s+(?:en|de)|distribuir(?:\s+\w+){0,3}\s+(?:en|a)|sell(?:ing)?(?:\s+\w+){0,3}\s+(?:in|to)|customers?\s+in)\s*$/;
const TRANSIT = /(?:a traves de|via|por|escala en|transit(?:ing)? (?:through|via)|passing through|through)\s*$/;
const COMPANY_NOUN = /(?:empresa|compania|firma|grupo|constructora|ingenieria|consultora|fabrica|somos|soy|we are|we're|our company|a)\s+(?:una\s+|un\s+|una\s+)?(?:empresa|compania|firma|company)?\s*$/;
const STAFF_NOUN = /(?:personal|tecnicos|ingenieros|equipo|empleados|trabajadores|staff|engineers|technicians|team)\s*$/;

function roleFor(f: string, idx: number, len: number, demonym: boolean, seenOperation: boolean, nextGap: string | null): CountryRole {
  const before = f.slice(Math.max(0, idx - 48), idx);
  const sentenceBefore = before.slice(Math.max(before.lastIndexOf("."), before.lastIndexOf(";")) + 1);
  if (demonym) {
    if (STAFF_NOUN.test(sentenceBefore)) return "unspecified";
    return "origin";
  }
  if (HQ.test(sentenceBefore)) return "headquarters";
  if (FROM.test(sentenceBefore)) return "origin";
  if (SALES.test(sentenceBefore)) return "sales";
  if (/(?:a traves de|via|escala en|transit\w* (?:through|via)|passing through|through)\s*$/.test(sentenceBefore)) return "transit";
  // "Colombia a México": the first of an origin -> destination pair (not itself introduced by "a"/"en"/"hacia") is where it comes from.
  const introducedAsDestination = /(?:\ba|\bal|hacia|to|en|in|into)\s*$/.test(sentenceBefore);
  if (!introducedAsDestination && nextGap !== null && /^\s*(?:a|al|hacia|to|->|→|=>)\s*$/.test(nextGap)) return "origin";
  void len;
  return seenOperation ? "operation" : "operation";
}

export function readCountries(text: string, f: string, frame: Frame): { countries: CountryHit[]; phases: PhaseHit[] } {
  const mentions = findCountryMentions(f, text);
  if (mentions.length === 0) return { countries: [], phases: [] };
  const seq = SEQUENCERS.exec(f);
  const out: CountryHit[] = [];
  let seenOp = frame.countries.some((c) => c.role === "operation");
  const byIndex = [...mentions].sort((a, b) => a.index - b.index);
  for (const m of byIndex) {
    const def = countryByCode(m.code);
    if (!def) continue;
    const next = byIndex.find((x) => x.index >= m.end && x !== m);
    const role = roleFor(f, m.index, m.term.length, m.demonym, seenOp, next ? f.slice(m.end, next.index) : null);
    if (role === "unspecified") continue;
    // A company demonym ("empresa portuguesa") tells where the company comes from, but the same word also appears in "personal portugués".
    if (role === "operation") seenOp = true;
    const phase = seq && m.index > seq.index && (role === "operation" || role === "sales") ? 2 : role === "operation" || role === "sales" ? 1 : undefined;
    const hit: CountryHit = { code: m.code, role, quote: spanAround(text, m.term) };
    if (phase !== undefined) hit.phase = phase;
    out.push(hit);
  }
  // A country can be mentioned in several roles; keep the strongest per (code, role).
  const uniq = new Map<string, CountryHit>();
  for (const c of out) if (!uniq.has(`${c.code}:${c.role}`)) uniq.set(`${c.code}:${c.role}`, c);
  const countries = [...uniq.values()];
  const phases: PhaseHit[] = [];
  const dests = countries.filter((c) => c.role === "operation" || c.role === "sales");
  const p1 = dests.filter((c) => c.phase !== 2).map((c) => c.code);
  const p2 = dests.filter((c) => c.phase === 2).map((c) => c.code);
  if (p1.length > 0 && p2.length > 0) {
    phases.push({ label: p1.map((c) => countryByCode(c)?.es ?? c).join(" + "), countries: [...new Set(p1)], quote: dests.find((c) => c.phase !== 2)?.quote ?? "" });
    phases.push({ label: p2.map((c) => countryByCode(c)?.es ?? c).join(" + "), countries: [...new Set(p2)], quote: dests.find((c) => c.phase === 2)?.quote ?? "" });
  }
  return { countries, phases };
}

// ------------------------------------------------------------------ rationale / priorities
const WHY_CUE = /(?<![\p{L}\p{N}])(porque|ya que|debido a|a raiz de|con el fin de|con el objetivo de|para poder|fuimos subcontratad\w+|nos (?:subcontrataron|contrataron)|because|so that|in order to|due to|since we)(?![\p{L}\p{N}])/u;
const TOP_CUE = /(?:lo mas importante|lo prioritario|la prioridad (?:es|son|seria)|nuestra prioridad|lo mas urgente|lo que mas (?:nos )?urge|primero (?:necesitamos|debemos|hay que|queremos|tenemos que|lo)|antes que nada|lo primero|^primero\b|primero (?:la|el|los|las|nuestra|nuestro)\b|^first\b|arrancar con|empezar(?:iamos)? (?:con|por)|most important|our priority|top priority|first (?:we need|of all|thing)|most urgent|start with)/;
const WAIT_CUE = /(?:puede(?:n)? esperar|no (?:es|son) urgente|no corre prisa|despues|mas adelante|en una segunda etapa|menos prioritari\w+|segunda prioridad|can wait|not urgent|less urgent|later|second priority)/;

export function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?;\n])\s+/).map((s) => squash(s)).filter(Boolean);
}

export function readPriorities(text: string, locale: Loc): PriorityHit[] {
  void locale;
  const out: PriorityHit[] = [];
  for (const s of sentencesOf(text)) {
    const f = fold(s);
    const top = TOP_CUE.test(f);
    const wait = WAIT_CUE.test(f) && !top;
    if (!top && !wait) continue;
    const { hits } = detectConcepts(s, f);
    const subjects = [...new Set(hits.filter((h) => conceptById(h.id)?.kind === "need").map((h) => h.id))];
    if (subjects.length === 0) continue;
    const why = /(?:porque|ya que|debido a|because|since)\s+(.{4,140})/.exec(s);
    const timing = /(?:en\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)|(?:antes|a finales) de\s+\w+|este (?:mes|trimestre|ano)|en (?:las )?proximas? (?:semanas|meses)|next (?:month|quarter|weeks))/.exec(fold(s));
    const hit: PriorityHit = { subjects, rank: top ? "top" : "can_wait", quote: s.slice(0, 200) };
    if (why?.[1]) hit.reason = why[1].trim();
    if (timing) hit.timing = timing[0];
    out.push(hit);
  }
  return out;
}

export function readRationale(text: string): RationaleHit[] {
  const out: RationaleHit[] = [];
  for (const s of sentencesOf(text)) {
    const f = fold(s);
    const m = WHY_CUE.exec(f);
    if (!m) continue;
    // A rationale about priority belongs to the priority reader.
    if (TOP_CUE.test(f)) continue;
    out.push({ subject: "project", text: s.slice(0, 240), quote: s.slice(0, 240) });
    if (out.length >= 2) break;
  }
  return out;
}

// ------------------------------------------------------------------ the rule interpreter
const CORRECTION = /(?:en realidad|corrijo|me equivoque|mas bien|no son|no es asi|ya no|cambio de plan|cambiamos|cambio de|me corrijo|rectifico|perdon|actually|correction|i meant|no longer|we changed|that is wrong|that's wrong|instead of)/;
const ADD_SERVICE = /(?:quiero agregar|queremos agregar|agregar (?:mas )?servicios|anadir (?:mas )?servicios|necesito (?:otro|mas) servicio|add (?:more )?services?|add another service)/;
const QUESTION_START = /^(?:que|como|cuanto|cuantos|cuantas|cual|cuales|donde|por que|cuando|quien|me puedes|puedes|podrias|sabes|es necesario|hay que|what|how|which|where|why|when|who|can you|could you|do i|should i|is it|are there)\b/;

export function createRuleInterpreter(): Interpreter {
  return {
    describe: () => ({ implementation: "rules" }),
    async interpret(input) {
      return interpretByRules(input);
    },
  };
}

export function interpretByRules(input: InterpretInput): Interpretation {
  const { text, locale, frame, asked, source } = input;
  const f = fold(text);
  const out = emptyInterpretation(source === "discovery" ? "discovery" : "rules");
  const trimmed = text.trim();
  if (trimmed.length === 0) return out;

  // How the client answered, independent of content.
  const kind = answerKind(f);
  out.correction = CORRECTION.test(f);
  if (kind === "yes" || kind === "no") out.yesNo = kind;
  if (kind === "unknown" || kind === "withheld" || kind === "undecided") out.answerState = kind;

  // Concepts and needs (NEED FIRST: the client's words are the need, the catalog only enriches it).
  const { hits, covered } = detectConcepts(text, f);
  out.concepts = hits;
  for (const h of hits) {
    const def = conceptById(h.id);
    if (!def || def.kind !== "need") continue;
    out.needs.push({ text: h.quote.slice(0, 140), conceptIds: [def.id], quote: h.quote, resolution: def.category ? "resolved" : "unresolved", covered: covered.has(def.id) });
  }

  // Countries, roles, phases.
  const geo = readCountries(text, f, frame);
  out.countries = geo.countries;
  out.phases = geo.phases;

  // Probe extractors. Every extractor runs (volunteered mode); the asked one also reads bare answers.
  const view = viewOf({ ...frame, concepts: { ...frame.concepts, ...Object.fromEntries(hits.map((h) => [h.id, { first: h.quote, origin: "client" as const }])) } });
  for (const p of PROBES) {
    const ctx: ProbeCtx = { text, f, asked: asked === p.key, view, locale };
    let hit = null;
    try {
      hit = p.extract(ctx);
    } catch {
      hit = null; // a faulty extractor never breaks a turn
    }
    if (!hit) continue;
    out.observations.push({ key: p.key, value: hit.value, display: hit.display, quote: hit.quote, interpretive: hit.interpretive ?? "observed", ...(hit.status ? { status: hit.status } : {}), ...(hit.why ? { why: hit.why } : {}) });
  }

  // Rationale and priorities.
  out.rationale = readRationale(text);
  out.priorities = readPriorities(text, locale);

  // Intent.
  if (kind === "done") out.intent = "done";
  else if (ADD_SERVICE.test(f)) out.intent = "add_service";
  else if (/[?¿]/.test(trimmed) && (QUESTION_START.test(f.replace(/^[¿\s]+/, "")) || trimmed.endsWith("?")) && out.observations.length === 0 && out.needs.length === 0) {
    out.intent = "question";
    out.question = trimmed.slice(0, 400);
  } else if (/[?¿]/.test(trimmed) && QUESTION_START.test(f.replace(/^[¿\s]+/, "")) && f.length < 220 && out.observations.length === 0) {
    out.intent = "question";
    out.question = trimmed.slice(0, 400);
  } else if (out.answerState && out.observations.length === 0 && out.needs.length === 0) out.intent = out.answerState;
  else if (out.observations.length > 0 || out.needs.length > 0 || out.countries.length > 0 || out.priorities.length > 0 || out.rationale.length > 0 || out.phases.length > 0) out.intent = "answer";
  else if (kind === "yes") out.intent = "affirm";
  else if (kind === "no") out.intent = "deny";
  else out.intent = "unclear";

  // Hidden helper: workforce counts imply a workforce presence even when the client never used a hiring verb.
  if (out.observations.some((o) => o.key === "workforce.headcount" || o.key === "workforce.model") && !out.concepts.some((c) => c.id === "workforce_presence")) {
    const o = out.observations.find((x) => x.key.startsWith("workforce."))!;
    out.concepts.push({ id: "workforce_presence", quote: o.quote });
  }
  void COUNTRIES;
  void hasTerm;
  return out;
}
