/**
 * One conversation step: (frame, client message + interpretation) -> (new frame, next reply). Synchronous, deterministic, no I/O —
 * the engine does the I/O around it (model call, persistence, verifiers). That is what makes the whole Understanding behaviour
 * testable end to end against a simulated client.
 *
 * Pipeline: govern -> handle the answer to the pending action -> apply -> settle contradictions -> depth -> plan -> compose.
 * One question per turn. Confirmation only by exception (contradiction, ambiguity, material inference, the closing checkpoint).
 */
import { CHECKPOINT_QUESTION, acknowledge, conflictQuestion, impliedQuestion, needClarifyQuestion, needPhrase, priorityQuestion, questionFor, summarize } from "./compose";
import { conceptById } from "./concepts";
import { countryName } from "./countries";
import { MAX_VALUABLE_ASKS, evaluateDepth, type Depth } from "./depth";
import { applyInterpretation, deriveContext, resolveImplied, type Change } from "./frame";
import { govern, type Rejection } from "./governor";
import { detectConcepts, type Interpretation } from "./interpreter";
import { classifyPhrase, replyForPhrase } from "./need-explorer";
import { probeByKey, type ProbeDef } from "./probes";
import { fold, squash } from "./text";
import type { Frame, Loc, NeedItem } from "./types";

export type Action =
  | { kind: "open" }
  | { kind: "ask_needs" }
  | { kind: "ask_probe"; probeKey: string }
  | { kind: "clarify_conflict"; key: string }
  | { kind: "clarify_need"; needId: string; ambiguous: boolean }
  | { kind: "offer_implied"; impliedId: string }
  | { kind: "ask_priority" }
  | { kind: "checkpoint" }
  | { kind: "ready" }
  | { kind: "clarify_input" }
  | { kind: "note" };

export interface QuickReply { value: string; label: string; intent: "confirm" | "correct" | "answer" | "unknown" }
/** A structured card shown next to the assistant text (the checkpoint summary lives here, so the conversation text stays short). */
export interface SummaryCard { title: string; body: string; confirmLabel: string; correctLabel: string }
export type QuickValue = "yes" | "no" | "unknown" | "new" | "previous" | "ok" | "change";

export interface StepInput {
  frame: Frame;
  text: string;
  interp: Interpretation;
  lastAction: Action | null;
  quick?: QuickValue | null;
  now: string;
  turnKey: string;
  /** Extra probes contributed by the knowledge layer (question drivers). */
  extraProbes?: readonly ProbeDef[];
}

export interface StepResult {
  frame: Frame;
  action: Action;
  /** Assistant text; null when the engine must answer a question (process / knowledge) and resume `action` afterwards. */
  text: string;
  quickReplies: QuickReply[];
  changes: Change[];
  rejected: Rejection[];
  depth: Depth;
  /** Understanding may move to "ready to confirm" (the client accepted the closing checkpoint). */
  ready: boolean;
  /** The client asked something; the engine answers it (process knowledge / orientation) before resuming. */
  routeQuestion: string | null;
  /** The "bare" next prompt (without acknowledgement) — used to resume after answering a question. */
  prompt: string;
  card?: SummaryCard;
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const WHY_Q = /(?:por que (?:me )?(?:lo )?(?:preguntas|piden|pides|necesitas|necesitan|quieres saber|es importante)|para que (?:lo )?(?:necesitas|necesitan|preguntas|sirve)|why (?:are you asking|do you (?:need|ask)|is that (?:needed|important))|what for)/;

const QR = {
  yes: { es: "Sí", en: "Yes" }, no: { es: "No", en: "No" }, unknown: { es: "Todavía no lo sé", en: "Not sure yet" },
  newer: { es: "Usar lo que dije ahora", en: "Use what I just said" }, prev: { es: "Mantener lo anterior", en: "Keep the earlier one" },
  ok: { es: "No, así está bien", en: "No, that is right" }, change: { es: "Quiero corregir o agregar algo", en: "I want to correct or add something" },
};

// ------------------------------------------------------------------ planning
function valuableAsked(frame: Frame): number {
  return Object.entries(frame.asked).filter(([k, n]) => n > 0 && probeByKey(k) && !k.startsWith("need:") && !k.startsWith("imp:")).length;
}

export function plan(frame: Frame, depth: Depth, _loc: Loc): Action {
  void _loc;
  const activeNeeds = frame.needs.filter((n) => n.status !== "removed");
  // Nothing known at all: invite the client to tell the project in their own words.
  if (!depth.hasSubstance && activeNeeds.length === 0 && Object.keys(frame.items).length === 0) return { kind: "open" };
  if (frame.pendingConflicts.length > 0) return { kind: "clarify_conflict", key: frame.pendingConflicts[0]!.key };
  if (depth.needsClarification.length > 0) {
    const n = frame.needs.find((x) => x.id === depth.needsClarification[0])!;
    return { kind: "clarify_need", needId: n.id, ambiguous: n.resolution === "ambiguous" };
  }
  const material = depth.openMaterial[0];
  if (material) return { kind: "ask_probe", probeKey: material.probe.key };
  // No needs yet (sparse Discovery, early-stage client): elicit them, a few times at most, then hold gently instead of looping.
  if (activeNeeds.length === 0) return (frame.asked.needs ?? 0) >= 3 ? { kind: "note" } : { kind: "ask_needs" };
  const offered = Object.keys(frame.asked).filter((k) => k.startsWith("imp:") && (frame.asked[k] ?? 0) > 0).length;
  // Only a proposal that opens a NEW area is worth the client's attention: a sub-need inside a category already in play is detail for that category.
  const activeCategories = new Set(frame.needs.filter((n) => n.status !== "removed" && n.categoryKey).map((n) => n.categoryKey));
  const imp = frame.implied.find((i) => i.status === "proposed" && i.kind === "implied_need" && !frame.asked[i.id] && offered < 2 && !(conceptById(i.conceptId)?.category && activeCategories.has(conceptById(i.conceptId)!.category!)));
  if (imp) return { kind: "offer_implied", impliedId: imp.id };
  const valuable = depth.openValuable[0];
  if (valuable && valuableAsked(frame) < MAX_VALUABLE_ASKS) return { kind: "ask_probe", probeKey: valuable.probe.key };
  if (!depth.priorityDone) return { kind: "ask_priority" };
  if (!frame.checkpoint.offered) return { kind: "checkpoint" };
  if (frame.checkpoint.accepted) return { kind: "ready" };
  return { kind: "checkpoint" };
}

function ambiguityQuestion(n: NeedItem, loc: Loc): string | null {
  const r = classifyPhrase(n.text);
  return r.kind === "ambiguous" && r.question ? r.question[loc] : null;
}

/** The bare prompt for an action (question + quick replies), without acknowledgement. */
export function promptFor(frame: Frame, a: Action, loc: Loc): { text: string; quick: QuickReply[]; card?: SummaryCard } {
  const q = (k: keyof typeof QR): string => QR[k][loc];
  switch (a.kind) {
    case "ask_probe": {
      const probe = probeByKey(a.probeKey);
      const asks = frame.asked[a.probeKey] ?? 0;
      const sizing = probe && (probe.dimension === "scale" || probe.dimension === "tax" || probe.key === "workforce.benefits");
      const base = questionFor(frame, a.probeKey, loc, asks === 0 && Boolean(sizing));
      const numeric = probe && (probe.dimension === "scale" || ["workforce.headcount", "workforce.split", "trade.volume"].includes(probe.key));
      // A second ask is NOT the same question again: it lowers the bar (an approximation is enough, "I don't know" is an answer).
      const label = (probe?.label[loc] ?? "").toLowerCase();
      const retry = asks >= 1 && label
        ? (numeric
          ? (loc === "es" ? `Sobre ${label}: ¿cuál es tu mejor estimación? Con una cifra aproximada me basta, y si aún no la tienes también me sirve saberlo.` : `On ${label}: what is your best estimate? A rough figure is enough, and if you do not have one yet, that is useful to know.`)
          : (loc === "es" ? `Sobre ${label}: ¿qué tienes ya claro, aunque sea a grandes rasgos? Si aún no lo sabes o no está decidido, dímelo y lo dejamos anotado.` : `On ${label}: what do you already have clear, even roughly? If you do not know yet or it is not decided, tell me and I will note it.`))
        : "";
      const quick: QuickReply[] = probe?.onNo ? [{ value: "no", label: q("no"), intent: "answer" }] : [];
      if (probe && probe.dimension !== "project") quick.push({ value: "unknown", label: q("unknown"), intent: "unknown" });
      return { text: retry || base, quick };
    }
    case "clarify_conflict": return { text: conflictQuestion(frame, a.key, loc), quick: [{ value: "new", label: q("newer"), intent: "correct" }, { value: "previous", label: q("prev"), intent: "confirm" }] };
    case "clarify_need": {
      const n = frame.needs.find((x) => x.id === a.needId);
      return { text: n ? needClarifyQuestion(n, a.ambiguous ? ambiguityQuestion(n, loc) : null, loc) : (loc === "es" ? "¿Qué necesitas lograr?" : "What do you need to achieve?"), quick: [] };
    }
    case "offer_implied": {
      const i = frame.implied.find((x) => x.id === a.impliedId);
      if (!i) return { text: loc === "es" ? "¿Algo más que deba tener en cuenta?" : "Anything else I should take into account?", quick: [] };
      return { text: impliedQuestion(i.reason[loc], conceptById(i.conceptId)?.phrase[loc] ?? i.text[loc], loc), quick: [{ value: "yes", label: q("yes"), intent: "confirm" }, { value: "no", label: q("no"), intent: "answer" }] };
    }
    case "ask_priority": return { text: priorityQuestion(loc, frame.priority.askedCount), quick: [] };
    case "checkpoint": return {
      text: loc === "es" ? `Revisa lo que entendí de tu proyecto. ${CHECKPOINT_QUESTION[loc]}` : `Review what I understood about your project. ${CHECKPOINT_QUESTION[loc]}`,
      quick: [{ value: "ok", label: q("ok"), intent: "confirm" }, { value: "change", label: q("change"), intent: "correct" }],
      card: { title: loc === "es" ? "Esto es lo que entendí" : "This is what I understood", body: summarize(frame, loc), confirmLabel: q("ok"), correctLabel: q("change") },
    };
    case "ready": return { text: loc === "es" ? "Ya tengo lo necesario para armar tu My Service Map. Revísalo y, cuando estés de acuerdo, confírmalo." : "I have what I need to put together your My Service Map. Review it and, when you agree, confirm it.", quick: [] };
    case "clarify_input": return { text: loc === "es" ? "No te seguí del todo. ¿Me lo cuentas con otras palabras?" : "I did not quite follow. Could you tell me in other words?", quick: [] };
    case "ask_needs": {
      const n = frame.asked.needs ?? 0;
      const dest = frame.countries.find((c) => c.role === "operation");
      const where = dest ? countryName(dest.code, loc) : null;
      if (n === 0) return { text: loc === "es" ? `¿Qué necesitas resolver para que este proyecto avance${where ? ` en ${where}` : ""}?` : `What do you need to solve for this project to move forward${where ? ` in ${where}` : ""}?`, quick: [] };
      return { text: loc === "es" ? "Sin problema. Cuéntame qué quieres lograr y yo voy armando lo que podrías necesitar. ¿Por dónde empezamos?" : "No problem. Tell me what you want to achieve and I will put together what you may need. Where do we start?", quick: [] };
    }
    case "open": return { text: loc === "es" ? "Cuéntame con tus palabras cómo ves el proyecto: qué quieres lograr, dónde y qué ya tienes definido." : "Tell me in your own words how you see the project: what you want to achieve, where, and what you already have defined.", quick: [] };
    case "note": return { text: loc === "es" ? "Anotado. ¿Qué más debo saber de tu proyecto?" : "Noted. What else should I know about your project?", quick: [] };
  }
}

// ------------------------------------------------------------------ settle helpers
const SUBSTANTIVE = new Set(["item", "need", "country", "priority", "phase"]);

function settleStuck(frame: Frame, now: string, text: string, extra: readonly ProbeDef[]): void {
  const depth = evaluateDepth(frame, extra);
  for (const s of depth.statuses) {
    if (s.tier !== "material" || s.state === "resolved") continue;
    if ((frame.asked[s.probe.key] ?? 0) < 2) continue;
    const loc = frame.locale;
    frame.items[s.probe.key] = {
      key: s.probe.key, value: null, display: loc === "es" ? "Sin respuesta clara" : "No clear answer", status: "unknown", provenance: "client_stated",
      interpretive: "observed", quote: squash(text).slice(0, 160), at: now,
    };
  }
}

function resolveNeedDetail(frame: Frame, needId: string, text: string, now: string): Change[] {
  const changes: Change[] = [];
  const need = frame.needs.find((n) => n.id === needId);
  if (!need) return changes;
  frame.asked[`need:${needId}`] = (frame.asked[`need:${needId}`] ?? 0) + 1;
  const f = fold(text);
  const { hits } = detectConcepts(text, f);
  const found = hits.map((h) => conceptById(h.id)).filter((d): d is NonNullable<typeof d> => Boolean(d) && d!.kind === "need");
  // Ambiguity between candidate meanings: choose by the client's words ("rentar", "servicio").
  const r = classifyPhrase(need.text);
  let chosen = found[0];
  if (r.kind === "ambiguous" && r.options) {
    const pickRent = /(?:rent|renta|espacio|nave|local|alquil|lease|space)/.test(f);
    const pickService = /(?:servicio|operar|opere|almacene|operador|manej|service|operate|handle|store)/.test(f);
    const target = pickService && !pickRent ? r.options.find((o) => o.conceptId === "warehousing") : pickRent && !pickService ? r.options.find((o) => o.conceptId === "industrial_site") : undefined;
    if (target) chosen = conceptById(target.conceptId);
  }
  if (chosen) {
    need.conceptIds = [chosen.id];
    need.categoryKey = chosen.category ?? null;
    need.serviceKeys = chosen.services ?? [];
    need.resolution = chosen.category ? "resolved" : "unresolved";
    need.why = squash(text).slice(0, 200);
    if (!frame.concepts[chosen.id]) frame.concepts[chosen.id] = { first: squash(text).slice(0, 160), origin: "client" };
    changes.push({ kind: "need", key: need.id, display: chosen.label[frame.locale], updated: true });
  } else {
    // A legitimate need we cannot place: keep it in the client's words with the detail they gave, for specialist review.
    need.why = squash(text).slice(0, 240);
    need.resolution = "outcome";
    need.note = frame.locale === "es" ? "Necesidad fuera del catálogo; el cliente dio este detalle." : "Need outside the catalog; the client gave this detail.";
    changes.push({ kind: "need", key: need.id, display: need.text, updated: true });
  }
  need.at = now;
  return changes;
}

// ------------------------------------------------------------------ the step
export function step(input: StepInput): StepResult {
  const loc = input.frame.locale;
  const extra = input.extraProbes ?? [];
  let frame = clone(input.frame);
  const { interpretation: interp, rejected } = govern(input.interp, { text: input.text, source: "client" });
  const last = input.lastAction;
  const asked = last?.kind === "ask_probe" ? last.probeKey : null;
  const quick = input.quick ?? null;
  const changes: Change[] = [];
  const yes = quick === "yes" || interp.yesNo === "yes" || interp.intent === "affirm";
  const no = quick === "no" || interp.yesNo === "no" || interp.intent === "deny";
  const hasContent = interp.observations.length > 0 || interp.needs.length > 0 || interp.priorities.length > 0 || interp.countries.length > 0;
  let early: StepResult | null = null;
  const finish = (action: Action, ack: string | null, extraChanges: Change[] = [], forcedText?: string): StepResult => {
    const all = [...changes, ...extraChanges];
    if (all.some((c) => SUBSTANTIVE.has(c.kind)) && frame.checkpoint.offered && action.kind !== "ready") frame.checkpoint = { offered: false, accepted: false };
    // The prompt is composed BEFORE the "asked" bookkeeping (a retry wording depends on how many times it was asked so far).
    const p = promptFor(frame, action, loc);
    if (action.kind === "checkpoint") frame.checkpoint = { offered: true, accepted: false, at: input.now };
    if (action.kind === "ask_priority") frame.priority = { ...frame.priority, askedCount: frame.priority.askedCount + 1 };
    if (action.kind === "ask_probe") frame.asked[action.probeKey] = (frame.asked[action.probeKey] ?? 0) + 1;
    if (action.kind === "ask_needs") frame.asked.needs = (frame.asked.needs ?? 0) + 1;
    if (action.kind === "offer_implied") frame.asked[action.impliedId] = (frame.asked[action.impliedId] ?? 0) + 1;
    const text = forcedText ?? [action.kind === "checkpoint" || action.kind === "ready" ? null : ack, p.text].filter(Boolean).join(" ");
    const depth = evaluateDepth(frame, extra);
    return { frame, action, text, quickReplies: p.quick, changes: all, rejected, depth, ready: action.kind === "ready", routeQuestion: null, prompt: p.text, ...(p.card ? { card: p.card } : {}) };
  };

  /** The reply carried nothing we can use: say so briefly and keep the pending question (never lose the thread). */
  const unclear = (): StepResult => {
    const keepable = last && ["ask_probe", "ask_priority", "ask_needs", "clarify_need", "offer_implied", "clarify_conflict"].includes(last.kind);
    const key = last?.kind === "ask_probe" ? last.probeKey : last?.kind === "offer_implied" ? last.impliedId : last?.kind === "ask_priority" ? "priority" : last?.kind === "ask_needs" ? "needs" : last?.kind === "clarify_need" ? `need:${last.needId}` : "";
    const times = key === "priority" ? frame.priority.askedCount : (frame.asked[key] ?? 0);
    if (keepable && last && times < 2) {
      const lead = loc === "es" ? "No estoy seguro de haberte entendido." : "I am not sure I understood.";
      return finish(last, lead);
    }
    const depth = evaluateDepth(frame, extra);
    return finish(plan(frame, depth, loc), null);
  };

  // ---- 1. a question from the client (process / orientation / "why do you ask"): the engine answers, then we resume
  if (interp.intent === "question" && interp.question && !hasContent) {
    const resume = last && last.kind !== "ready" && last.kind !== "open" ? last : null;
    const depth = evaluateDepth(frame, extra);
    const action: Action = resume ?? plan(frame, depth, loc);
    const p = promptFor(frame, action, loc);
    if (resume?.kind === "ask_probe" && WHY_Q.test(fold(input.text))) {
      const probe = probeByKey(resume.probeKey);
      const why = probe ? `${probe.why[loc].replace(/[\s.]+$/, "")}. ` : "";
      return { frame, action, text: `${why}${p.text}`, quickReplies: p.quick, changes: [], rejected, depth, ready: false, routeQuestion: null, prompt: p.text };
    }
    return { frame, action, text: p.text, quickReplies: p.quick, changes: [], rejected, depth, ready: false, routeQuestion: interp.question, prompt: p.text };
  }

  // ---- 2. the answer to the pending action
  if (last?.kind === "checkpoint") {
    const ok = quick === "ok" || (!hasContent && (yes || no || interp.intent === "done"));
    if (ok && quick !== "change") {
      frame.checkpoint = { offered: true, accepted: true, at: input.now };
      frame.version += 1;
      return finish({ kind: "ready" }, null);
    }
    if (quick === "change" && !hasContent) {
      return finish({ kind: "note" }, null, [], loc === "es" ? "Claro. ¿Qué quieres corregir o agregar?" : "Of course. What would you like to correct or add?");
    }
  }
  if (last?.kind === "offer_implied") {
    const accept = quick === "yes" || (quick === null && yes);
    const reject = quick === "no" || (quick === null && no);
    if (accept || reject) {
      frame = resolveImplied(frame, last.impliedId, accept, input.now);
      changes.push({ kind: "implied", key: last.impliedId });
      if (accept) changes.push({ kind: "need", key: last.impliedId, display: conceptById(frame.implied.find((i) => i.id === last.impliedId)?.conceptId ?? "")?.label[loc] ?? "" });
      deriveContext(frame, input.now, changes);
      const depth = evaluateDepth(frame, extra);
      return finish(plan(frame, depth, loc), accept ? (loc === "es" ? "Lo incluyo." : "I will include it.") : (loc === "es" ? "De acuerdo, lo dejo fuera." : "Understood, I will leave it out."));
    }
  }
  if (last?.kind === "clarify_conflict") {
    const c = frame.pendingConflicts.find((x) => x.key === last.key);
    if (c) {
      const wantNew = quick === "new" || (quick === null && (hasContent || /(?:lo nuevo|ahora|actualiza|el nuevo|use the new|the new one|what i just said)/.test(fold(input.text))));
      const wantPrev = quick === "previous" || (quick === null && !wantNew && (yes || /(?:anterior|mantener|como estaba|keep|earlier|before)/.test(fold(input.text))));
      if (wantNew || wantPrev) {
        const prev = frame.items[last.key];
        if (wantNew && prev) {
          frame.changedSinceDiscovery.push({ key: last.key, from: prev.display, to: c.display, at: input.now });
          frame.items[last.key] = { key: last.key, value: c.value, display: c.display, status: "known", provenance: "client_corrected", interpretive: c.interpretive, quote: c.quote, at: input.now };
        } else if (prev) {
          frame.items[last.key] = { ...prev, status: "known", at: input.now };
        }
        frame.pendingConflicts = frame.pendingConflicts.filter((x) => x.key !== last.key);
        changes.push({ kind: "item", key: last.key, display: wantNew ? c.display : prev?.display });
        const depth = evaluateDepth(frame, extra);
        return finish(plan(frame, depth, loc), loc === "es" ? "Gracias, lo dejo registrado." : "Thanks, I have recorded it.");
      }
    }
  }
  if (last?.kind === "clarify_need" && !(hasContent && interp.needs.length > 1)) {
    changes.push(...resolveNeedDetail(frame, last.needId, input.text, input.now));
    const depth = evaluateDepth(frame, extra);
    return finish(plan(frame, depth, loc), null);
  }

  // ---- 3. short phrases that are not (yet) a known need: ambiguity, noise, meta, unknown-but-legitimate
  const words = fold(input.text).trim().split(/\s+/).filter(Boolean).length;
  if (words <= 14 && interp.observations.length === 0 && !quick && !interp.answerState && !yes && !no) {
    const r = classifyPhrase(input.text);
    if (r.kind === "ambiguous") {
      const id = `n:u:${fold(input.text).replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`;
      if (!frame.needs.some((n) => n.id === id)) frame.needs.push({ id, text: squash(input.text).slice(0, 100), conceptIds: [], resolution: "ambiguous", categoryKey: null, serviceKeys: [], status: "proposed", origin: "narrative", quote: squash(input.text).slice(0, 100), at: input.now });
      changes.push({ kind: "need", key: id, display: input.text });
      early = finish({ kind: "clarify_need", needId: id, ambiguous: true }, null);
    } else if (r.kind === "unknown_legit") {
      const id = `n:u:${fold(input.text).replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`;
      if (!frame.needs.some((n) => n.id === id)) frame.needs.push({ id, text: squash(input.text).replace(/^(?:necesito|necesitamos|quiero|queremos|busco|buscamos)\s+/i, "").slice(0, 100), conceptIds: [], resolution: "unresolved", categoryKey: null, serviceKeys: [], status: "proposed", origin: "narrative", quote: squash(input.text).slice(0, 100), at: input.now });
      changes.push({ kind: "need", key: id, display: input.text });
      early = finish({ kind: "clarify_need", needId: id, ambiguous: false }, null);
    } else if (r.kind === "goods_item" || r.kind === "meta" || r.kind === "attribute") {
      const reply = replyForPhrase(r, loc) ?? "";
      const depth = evaluateDepth(frame, extra);
      const resume: Action = last && last.kind !== "ready" ? last : plan(frame, depth, loc);
      if (r.kind === "attribute") {
        // A condition of the product (cold chain): keep it as context, then the normal flow continues.
        for (const id of r.conceptIds) if (!frame.concepts[id]) frame.concepts[id] = { first: squash(input.text).slice(0, 160), origin: "client" };
        deriveContext(frame, input.now, changes);
      }
      const p = promptFor(frame, resume, loc);
      early = { frame, action: resume, text: r.kind === "meta" || r.kind === "goods_item" ? reply : `${reply}`, quickReplies: p.quick, changes, rejected, depth, ready: false, routeQuestion: null, prompt: p.text };
    } else if (r.kind === "unclear" && interp.intent === "unclear" && !hasContent) {
      early = unclear();
    }
    if (early) return early;
  }

  // ---- 4. apply what the client said
  const applied = applyInterpretation(frame, interp, { now: input.now, turnKey: input.turnKey, source: "client", asked, text: input.text });
  frame = applied.frame;
  changes.push(...applied.changes);
  for (const c of applied.conflicts) {
    if (!frame.pendingConflicts.some((x) => x.key === c.key)) {
      frame.pendingConflicts.push({ key: c.key, value: c.incoming.value, display: c.incoming.display, quote: c.incoming.quote, interpretive: c.incoming.interpretive, at: input.now });
    }
  }
  if (interp.intent === "unclear" && !hasContent && !interp.answerState && !yes && !no) return unclear();

  settleStuck(frame, input.now, input.text, extra);
  deriveContext(frame, input.now, changes);

  const depth = evaluateDepth(frame, extra);
  const action = plan(frame, depth, loc);
  const ack = acknowledge(frame, changes, loc);
  void needPhrase;
  return finish(action, ack);
}
