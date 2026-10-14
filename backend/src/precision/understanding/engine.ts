/**
 * UnderstandingEngine — the conversation engine of the `understanding` surface (AI understands, product decides).
 *
 * It implements the same contract as the generic engine (openThread / processTurn) and delegates every other surface to it:
 *   interpret (rules baseline, model optional)  ->  govern  ->  frame reducer  ->  depth  ->  plan  ->  compose  ->  verify
 *
 * Reliability (same rules as the generic engine):
 *  - idempotent by `turnKey` (replays return the stored turns), serialised per project (store lock);
 *  - the frame and its event are committed atomically; a retry after a crash finds the event and repairs the reply from the frame;
 *  - an interpreter failure never loses the client's turn (status ai_unavailable, retry with the same key);
 *  - every assistant text passes the deterministic verifiers before it is stored.
 */
import { guard } from "../engine/guard";
import { copyText, plainCopy } from "../conversation/copy";
import { extraGuard } from "../conversation/guard-extra";
import { composeProcessAnswer } from "../conversation/process-knowledge/answer";
import { composeUnknownAnswer } from "../conversation/process-knowledge/answer";
import { routeProcessQuestion } from "../conversation/process-knowledge/router";
import { introducedFromTexts } from "../conversation/process-knowledge/term-registry";
import { lastPending, structuredOf, toTurnDto } from "../conversation/thread-state";
import type { ContextReader, ConversationStore, FactWriter, StoredTurn } from "../conversation/ports";
import { systemClock, type Clock } from "../conversation/ports";
import type { ConversationEngine } from "../conversation/turn-engine";
import { WAITING_HINTS } from "../conversation/turn-engine";
import { ConversationInputError, type CandidateFact, type ConversationContext, type Locale, type OpenThreadInput, type ProcessTurnInput, type ProcessTurnResult, type UnderstandingState } from "../conversation/types";
import { verifyAssistantText, type VerifyContext } from "../conversation/verifiers";
import type { ConfirmCardDto, QuickReplyDto } from "../api/dto";
import { createHash } from "node:crypto";
import { evaluateDepth } from "./depth";
import { interpretByRules, type Interpretation } from "./interpreter";
import { refreshFromDiscovery } from "./freshness";
import { seedFromDiscovery, type DiscoverySeedInput } from "./seed";
import { plan, promptFor, step, type Action, type QuickValue, type StepResult } from "./step";
import { FrameConflictError, type FrameStore, type StoredFrame } from "./store";
import { emptyFrame, type Frame } from "./types";
import { projectFacts } from "./facts-projection";

// ------------------------------------------------------------------ ports
export interface InterpretRequest { text: string; locale: Locale; frame: Frame; asked: string | null; turnKey: string }
/** Reads the client's words into a structured interpretation. The rule baseline is always available; a model can replace it. */
export interface UnderstandingInterpreter { interpret(req: InterpretRequest): Promise<Interpretation> }
export const rulesInterpreter: UnderstandingInterpreter = {
  async interpret(r) { return interpretByRules({ text: r.text, locale: r.locale, frame: r.frame, asked: r.asked, source: "client" }); },
};

/** Optional Level-2 orientation: answers a client question from approved knowledge (never a recommendation, never an obligation). */
export interface OrientationPort {
  /** True when approved sources exist for the project's jurisdiction. */
  available(frame: Frame): Promise<boolean>;
  /** Text answering the client's question or the offered orientation; null when nothing approved applies. */
  answer(frame: Frame, question: string, locale: Locale): Promise<{ text: string; sourceRefs: string[]; sherpaNote?: string } | null>;
}

export interface SeedSource { (projectId: string, locale: Locale): Promise<DiscoverySeedInput | null> }

export interface UnderstandingEngineDeps {
  /** The generic engine: handles the category and add_service surfaces. */
  base: ConversationEngine;
  store: ConversationStore;
  frames: FrameStore;
  context: ContextReader;
  seed: SeedSource;
  /** Receives the `pa_*` projection of the frame (keeps Service Map / readiness / OH readers working). */
  facts?: FactWriter;
  interpreter?: UnderstandingInterpreter;
  orientation?: OrientationPort;
  clock?: Clock;
  now?: () => Date;
}

// ------------------------------------------------------------------ pending action persisted with each assistant turn
interface Pending {
  action: Action | { kind: "offer_orientation" };
  frameVersion: number;
}
const pendingOf = (row: StoredTurn | null | undefined): Pending | null => {
  const u = (structuredOf(row) as { understanding?: Pending }).understanding;
  return u && typeof u === "object" && u.action ? u : null;
};
const QUICK = new Set<string>(["yes", "no", "unknown", "new", "previous", "ok", "change"]);
const TURN_KEY_RE = /^[A-Za-z0-9_.:-]{8,120}$/;
const hash = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);

const SEEDED_LEAD = { es: "Parto de lo que ya compartiste en Discovery.", en: "I am starting from what you already shared in Discovery." };

export function createUnderstandingEngine(deps: UnderstandingEngineDeps): ConversationEngine {
  const clock = deps.clock ?? systemClock;
  const interpreter = deps.interpreter ?? rulesInterpreter;
  const nowIso = (): string => (deps.now ? deps.now() : clock.now()).toISOString();

  async function loadFrame(projectId: string, locale: Locale): Promise<{ stored: StoredFrame; seeded: boolean }> {
    const found = await deps.frames.load(projectId);
    if (found) return { stored: await freshen(projectId, locale, found), seeded: false };
    const seed = await deps.seed(projectId, locale);
    const frame = seed ? seedFromDiscovery(seed, nowIso()).frame : emptyFrame(locale);
    const stored = await deps.frames.create(projectId, frame);
    if (stored.version === 1) await deps.frames.appendEvent(projectId, `seed.${projectId.slice(0, 8)}`, "seed", 1, { discovery: Boolean(seed), needs: frame.needs.length });
    return { stored, seeded: Boolean(seed) };
  }

  /**
   * Fact freshness: when Discovery moved to a new source pin after this frame was seeded, the frame follows (see freshness.ts).
   * Never breaks a turn: any failure leaves the frame as it was and the next turn tries again.
   */
  async function freshen(projectId: string, locale: Locale, found: StoredFrame): Promise<StoredFrame> {
    if (found.closedAt) return found;
    try {
      const seed = await deps.seed(projectId, locale);
      if (!seed?.pinId || seed.pinId === found.frame.discoveryPinId) return found;
      const r = refreshFromDiscovery(found.frame, seed, nowIso());
      return await deps.frames.commit(projectId, r.frame, found.version, { turnKey: `fresh.${seed.pinId}`.slice(0, 120), kind: "freshness", payload: { changed: r.changed.slice(0, 40), asks: r.asks } });
    } catch {
      return (await deps.frames.load(projectId)) ?? found;
    }
  }

  function vctx(ctx: ConversationContext, locale: Locale, introduced: Set<string>, questions: VerifyContext["questions"]): VerifyContext {
    return { locale, surface: "understanding", introducedTerms: introduced, sherpaAssigned: ctx.flags.sherpaAssigned, allowSherpaGeneral: false, approvedSources: ctx.approvedSources, questions };
  }

  /** Verified text: the composed text, else the bare prompt, else a safe generic question. */
  function safeText(ctx: ConversationContext, locale: Locale, introduced: Set<string>, composed: string, bare: string, questions: VerifyContext["questions"]): { text: string; fallback: boolean } {
    const ok = (t: string): boolean => !verifyAssistantText(t, vctx(ctx, locale, introduced, questions)).some((v) => v.critical);
    if (ok(composed)) return { text: composed, fallback: false };
    if (ok(bare)) return { text: bare, fallback: true };
    return { text: locale === "es" ? "¿Qué más debería saber de tu proyecto?" : "What else should I know about your project?", fallback: true };
  }

  const cardOf = (turnKey: string, card: NonNullable<StepResult["card"]>): ConfirmCardDto => ({ kind: "summary", title: card.title, body: card.body, confirmLabel: card.confirmLabel, correctLabel: card.correctLabel, token: `cc_${hash(`${turnKey}:summary`)}` });

  async function persistAssistant(ctx: ConversationContext, input: { projectId: string; scopeInstanceId: string; turnKey: string; locale: Locale; kind: "message" | "process_question" | "notice"; text: string; structured: Record<string, unknown> }): Promise<StoredTurn[]> {
    const out: StoredTurn[] = [];
    if (!(await deps.store.hasDisclosure(input.projectId))) {
      const d = await deps.store.persistTurn({
        projectId: input.projectId, scopeInstanceId: input.scopeInstanceId, turnKey: `disclosure.${input.projectId}`.slice(0, 120), role: "assistant", surface: "understanding", kind: "disclosure",
        locale: input.locale, content: copyText("ai_disclosure_once", input.locale, {}, new Set()).text, structured: { copyKeys: ["ai_disclosure_once"] },
      });
      if (d.created) out.push(d.turn);
    }
    const a = await deps.store.persistTurn({ projectId: input.projectId, scopeInstanceId: input.scopeInstanceId, turnKey: input.turnKey, role: "assistant", surface: "understanding", kind: input.kind, locale: input.locale, content: input.text, structured: input.structured });
    out.push(a.turn);
    void ctx;
    return out;
  }

  function resultOf(args: { ctx: ConversationContext; status: ProcessTurnResult["status"]; turns: StoredTurn[]; ready: boolean; facts?: CandidateFact[]; replayed?: boolean; started: number; retryable?: boolean; notice?: ProcessTurnResult["notice"]; kind?: "message" | "process_question" | "notice"; usedFallback?: boolean; topicKeys?: string[]; serviceMapChanged?: boolean }): ProcessTurnResult {
    const understandingState: UnderstandingState = args.ctx.understandingState === "confirmed" ? "confirmed" : args.ready ? "ready_to_confirm" : "in_progress";
    return {
      status: args.status, turns: args.turns.map(toTurnDto), progress: null, understandingState, serviceMapChanged: args.serviceMapChanged ?? (args.facts?.length ?? 0) > 0, retryable: args.retryable ?? false,
      factsToWrite: args.facts ?? [], pendingSignals: [], confirmedServiceNeed: null, notice: args.notice ?? null,
      meta: { turnKind: args.kind ?? "message", topicKeys: args.topicKeys ?? [], modelCalls: 0, physicalModelCalls: 0, usedFallbackCopy: args.usedFallback ?? false, copyKeys: [], elapsedMs: clock.monotonicMs() - args.started, waitingHints: WAITING_HINTS.map((h) => ({ ...h })), timeoutBudgetMs: 30_000, replayed: args.replayed ?? false, providerImplementation: "understanding-core" },
    };
  }

  const introducedOf = (ctx: ConversationContext, thread: readonly StoredTurn[]): Set<string> => {
    const s = new Set(ctx.introducedTerms);
    for (const t of introducedFromTexts(thread.filter((r) => r.role === "assistant").map((r) => r.content))) s.add(t);
    return s;
  };

  // ------------------------------------------------------------------ openThread
  async function openUnderstanding(input: OpenThreadInput): Promise<ProcessTurnResult> {
    const started = clock.monotonicMs();
    const ctx = await deps.context.load({ projectId: input.projectId, surface: "understanding", scopeInstanceId: input.scopeInstanceId, locale: input.locale });
    const thread = await deps.store.loadThread(input.projectId, input.scopeInstanceId, 60);
    const loaded = await deps.frames.load(input.projectId);
    const frameRead = loaded && ctx.canWrite ? await freshen(input.projectId, input.locale, loaded) : loaded;
    const ready = Boolean(frameRead?.frame.checkpoint.accepted);
    if (thread.length > 0 || !ctx.canWrite) return resultOf({ ctx, status: "ok", turns: thread, ready, replayed: true, started });

    const turnKey = `open.${input.scopeInstanceId}`.slice(0, 120);
    const { stored, seeded } = await loadFrame(input.projectId, input.locale);
    const frame = stored.frame;
    const action = plan(frame, evaluateDepth(frame), frame.locale);
    const p = promptFor(frame, action, frame.locale);
    if (action.kind === "ask_probe") frame.asked[action.probeKey] = (frame.asked[action.probeKey] ?? 0) + 1;
    if (action.kind === "ask_needs") frame.asked.needs = (frame.asked.needs ?? 0) + 1;
    if (action.kind === "ask_priority") frame.priority = { ...frame.priority, askedCount: frame.priority.askedCount + 1 };
    const lead = seeded ? SEEDED_LEAD[input.locale] : "";
    const introduced = introducedOf(ctx, thread);
    const welcome = action.kind === "open" ? "" : copyText("understanding_welcome", input.locale, {}, new Set()).text;
    const composed = [welcome, lead, p.text].filter(Boolean).join(" ");
    const { text, fallback } = safeText(ctx, input.locale, introduced, composed, p.text, "one");
    let saved: StoredFrame;
    try {
      saved = await deps.frames.commit(input.projectId, frame, stored.version, { turnKey, kind: "turn", payload: { opened: true, action: action.kind } });
    } catch (e) {
      if (!(e instanceof FrameConflictError)) throw e;
      saved = (await deps.frames.load(input.projectId)) ?? stored; // another request opened it first: the replayed thread below is the truth
    }
    const quickReplies: QuickReplyDto[] = p.quick.map((q) => ({ value: q.value, label: q.label, intent: q.intent }));
    const rows = await persistAssistant(ctx, {
      projectId: input.projectId, scopeInstanceId: input.scopeInstanceId, turnKey, locale: input.locale, kind: "message", text,
      structured: { state: { mode: "ask", fieldKey: null, pendingQuestion: p.text }, understanding: { action, frameVersion: saved.version } satisfies Pending, ...(quickReplies.length ? { quickReplies } : {}), ...(p.card ? { confirmCard: cardOf(turnKey, p.card) } : {}), copyKeys: [] },
    });
    return resultOf({ ctx, status: "ok", turns: rows, ready: false, started, usedFallback: fallback });
  }

  // ------------------------------------------------------------------ processTurn
  async function processUnderstanding(input: ProcessTurnInput): Promise<ProcessTurnResult> {
    const started = clock.monotonicMs();
    const { projectId, scopeInstanceId, turnKey, locale } = input;
    const ctx = await deps.context.load({ projectId, surface: "understanding", scopeInstanceId, locale });
    if (!ctx.canWrite) throw new ConversationInputError("NOT_WRITABLE", "this thread is read-only");
    const thread = await deps.store.loadThread(projectId, scopeInstanceId, 60);
    const existing = await deps.store.findByTurnKey(projectId, turnKey);
    if (existing.assistant) {
      const fr = await deps.frames.load(projectId);
      return resultOf({ ctx, status: "ok", turns: [existing.client, existing.assistant].filter((x): x is StoredTurn => x !== null), ready: Boolean(fr?.frame.checkpoint.accepted), replayed: true, started, kind: existing.assistant.kind as "message" });
    }

    const pending = lastPending(thread);
    const pendingRow = pending?.row ?? null;
    const pend = pendingOf(pendingRow);
    // The pending card/chips: a confirm action must answer the pending card, rejected BEFORE anything is persisted.
    const card = (structuredOf(pendingRow) as { confirmCard?: ConfirmCardDto }).confirmCard;
    if (input.confirmAction && (!card || card.token !== input.confirmAction.token)) throw new ConversationInputError("INVALID_INPUT", "confirm token does not match the pending card");

    const text = input.text !== undefined ? input.text.replace(/\u0000/g, "").trim() : null;
    const chips = (structuredOf(pendingRow) as { quickReplies?: QuickReplyDto[] }).quickReplies ?? [];
    const chip = input.quickReply ? chips.find((c) => c.value === input.quickReply!.value) ?? null : null;
    const quick: QuickValue | null = input.confirmAction ? (input.confirmAction.intent === "confirm" ? "ok" : "change") : input.quickReply && QUICK.has(input.quickReply.value) ? (input.quickReply.value as QuickValue) : null;
    const clientText = text ?? (input.confirmAction ? copyText(input.confirmAction.intent === "confirm" ? "client_echo_confirm" : "client_echo_correct", locale, {}, new Set()).text : chip?.label ?? input.quickReply?.value ?? "");
    const freeText = text ?? (input.quickReply && !QUICK.has(input.quickReply.value) ? input.quickReply.value : "");

    // guard + deterministic routing decide the client turn's kind BEFORE it is persisted
    const guardable = freeText || null;
    const verdict = existing.client || guardable === null ? null : await guard(guardable, { chain: [], timeoutMs: 0 }, {}, { useModelLayer: false });
    const blocked = verdict?.verdict === "block" || (!existing.client && guardable !== null && extraGuard(guardable).verdict === "block");
    const decision = guardable !== null && !blocked ? routeProcessQuestion(guardable, { surface: "understanding", flags: ctx.flags, extraCountryNames: [] }) : { kind: "none" as const, topicKeys: [] as string[], mixed: false, rules: [] as string[] };

    const clientTurn = existing.client ?? (await deps.store.persistTurn({
      projectId, scopeInstanceId, turnKey, role: "client", surface: "understanding", kind: decision.kind !== "none" ? "process_question" : "message", locale, content: clientText,
      structured: { input: input.quickReply ? "quick_reply" : input.confirmAction ? "confirm_action" : "text" },
    })).turn;

    const introduced = introducedOf(ctx, thread);
    try {
      const { stored } = await loadFrame(projectId, locale);
      let frame = stored.frame;
      const prior: Pending["action"] | null = pend?.action ?? null;

      if (blocked) {
        const t = copyText("guard_block", locale, {}, new Set()).text;
        const rows = await persistAssistant(ctx, { projectId, scopeInstanceId, turnKey, locale, kind: "notice", text: t, structured: { ...(pendingRow ? carry(pendingRow) : {}), copyKeys: ["guard_block"] } });
        return resultOf({ ctx, status: "blocked", turns: [clientTurn, ...rows], ready: false, started, kind: "notice" });
      }

      // ---- crash repair: this turn's event exists but the assistant never answered -> the frame already reflects it
      if (await deps.frames.hasEvent(projectId, turnKey, "turn")) {
        const action = plan(frame, evaluateDepth(frame), frame.locale);
        const p = promptFor(frame, action, frame.locale);
        const s = safeText(ctx, locale, introduced, p.text, p.text, action.kind === "ready" ? "none" : "one");
        const rows = await persistAssistant(ctx, { projectId, scopeInstanceId, turnKey, locale, kind: "message", text: s.text, structured: replyStructured(turnKey, action, stored.version, p) });
        return resultOf({ ctx, status: "ok", turns: [clientTurn, ...rows], ready: action.kind === "ready", started });
      }

      // ---- process question (how the process works): answered from the Process Knowledge pack, then the pending question resumes
      if (decision.kind !== "none" && pendingRow) {
        const pendingQuestion = (structuredOf(pendingRow) as { state?: { pendingQuestion?: string | null } }).state?.pendingQuestion ?? null;
        const ans = decision.kind === "legal_unverified" ? composeUnknownAnswer(locale, pendingQuestion, "r10_cannot_confirm")
          : decision.kind === "unknown" ? composeUnknownAnswer(locale, pendingQuestion, "process_unknown")
          : composeProcessAnswer({ topicKeys: decision.topicKeys, locale, surface: "understanding", flags: ctx.flags, reason: null, introduced, pendingQuestion });
        let t = ans.text;
        if (verifyAssistantText(t, { ...vctx(ctx, locale, introduced, "at-most-one"), allowSherpaGeneral: true }).some((v) => v.critical)) t = composeUnknownAnswer(locale, pendingQuestion, "process_unknown").text;
        const rows = await persistAssistant(ctx, { projectId, scopeInstanceId, turnKey, locale, kind: "process_question", text: t, structured: { ...carry(pendingRow), topicKeys: ans.topicKeys, packVersion: ans.packVersion, factIds: ans.factIds, sourceRefs: ans.sourceRefs, decision: decision.kind, copyKeys: ans.copyKeys } });
        return resultOf({ ctx, status: "ok", turns: [clientTurn, ...rows], ready: false, started, kind: "process_question", topicKeys: ans.topicKeys });
      }

      // ---- orientation offer answered (yes -> Level-2 orientation, no -> carry on)
      if (prior?.kind === "offer_orientation") {
        const yes = quick === "yes" || /^(?:si|sí|claro|dale|por favor|yes|sure|please|ok)\b/i.test(freeText);
        let lead = "";
        let refs: string[] = [];
        if (yes && deps.orientation) {
          const o = await deps.orientation.answer(frame, "criterios", locale);
          if (o) { lead = o.text; refs = o.sourceRefs; }
        }
        const action = plan(frame, evaluateDepth(frame), frame.locale);
        const p = promptFor(frame, action, frame.locale);
        frame = bump(frame, action);
        const composed = [lead, p.text].filter(Boolean).join(" ");
        return finishTurn({ ctx, input, frame, stored, clientTurn, introduced, action, p, composed, changes: [], started, extraStructured: refs.length ? { sourceRefs: refs } : {}, ready: action.kind === "ready" });
      }

      // ---- the normal path: interpret -> step
      const lastAction: Action | null = prior ?? null;
      const asked = lastAction?.kind === "ask_probe" ? lastAction.probeKey : null;
      const interp = freeText ? await interpreter.interpret({ text: freeText, locale: frame.locale, frame, asked, turnKey }) : emptyInterp();
      const r = step({ frame, text: freeText, interp, lastAction, quick, now: nowIso(), turnKey });
      frame = r.frame;

      // a question the process pack did not take: Level-2 orientation (approved knowledge), never an invented answer
      let answerLead = "";
      let refs: string[] = [];
      let sherpaNote: string | undefined;
      if (r.routeQuestion && deps.orientation && (await deps.orientation.available(frame))) {
        const o = await deps.orientation.answer(frame, r.routeQuestion, locale);
        if (o) { answerLead = o.text; refs = o.sourceRefs; sherpaNote = o.sherpaNote; }
      }

      // after the substance is covered, offer the optional orientation once (it never blocks readiness)
      let action = r.action;
      let promptText = r.prompt;
      let p: ReturnType<typeof promptFor> = { text: r.prompt, quick: r.quickReplies, ...(r.card ? { card: r.card } : {}) };
      let composed = answerLead ? `${answerLead} ${r.prompt}` : r.text;
      let nextAction: Pending["action"] = action;
      if (deps.orientation && !r.routeQuestion && (action.kind === "ask_priority" || action.kind === "checkpoint") && (await deps.orientation.available(frame))) {
        const { orientationOffer } = await import("../knowledge/drivers");
        const offer = orientationOffer(frame, true);
        if (offer) {
          frame.asked["offer:orientation"] = 1;
          nextAction = { kind: "offer_orientation" };
          promptText = offer.question[frame.locale];
          p = { text: promptText, quick: [{ value: "yes", label: frame.locale === "es" ? "Sí, quiero verlo" : "Yes, show me", intent: "confirm" }, { value: "no", label: frame.locale === "es" ? "No por ahora" : "Not now", intent: "answer" }] };
          composed = [r.text.slice(0, r.text.length - r.prompt.length).trim(), promptText].filter(Boolean).join(" ");
        }
      }
      if (sherpaNote) frame.notes.push({ text: sherpaNote.slice(0, 220), at: nowIso() });
      return finishTurn({ ctx, input, frame, stored, clientTurn, introduced, action: nextAction, p, composed, bare: promptText, changes: r.changes, started, extraStructured: refs.length ? { sourceRefs: refs } : {}, ready: r.ready, rawAction: action });
    } catch (err) {
      if (err instanceof FrameConflictError) {
        // Another request moved the frame (a retry racing the first attempt): the client's turn is saved, the retry reprocesses safely.
        const notice = { copyKey: "ai_unavailable_retry", text: copyText("ai_unavailable_retry", locale, {}, new Set()).text };
        return resultOf({ ctx, status: "ai_unavailable", turns: [clientTurn], ready: false, started, retryable: true, notice });
      }
      if (err instanceof Error && (err.name === "ModelUnavailableError")) {
        const notice = { copyKey: "ai_unavailable_retry", text: copyText("ai_unavailable_retry", locale, {}, new Set()).text };
        return resultOf({ ctx, status: "ai_unavailable", turns: [clientTurn], ready: false, started, retryable: true, notice });
      }
      throw err;
    }
  }

  function bump(frame: Frame, action: Action): Frame {
    const f = JSON.parse(JSON.stringify(frame)) as Frame;
    if (action.kind === "ask_probe") f.asked[action.probeKey] = (f.asked[action.probeKey] ?? 0) + 1;
    if (action.kind === "ask_needs") f.asked.needs = (f.asked.needs ?? 0) + 1;
    if (action.kind === "ask_priority") f.priority = { ...f.priority, askedCount: f.priority.askedCount + 1 };
    if (action.kind === "checkpoint") f.checkpoint = { offered: true, accepted: false, at: nowIso() };
    return f;
  }

  const emptyInterp = (): Interpretation => ({ source: "rules", intent: "answer", correction: false, observations: [], concepts: [], needs: [], countries: [], phases: [], rationale: [], priorities: [], question: null, answerState: null, yesNo: null });

  const carry = (row: StoredTurn): Record<string, unknown> => {
    const st = structuredOf(row) as { quickReplies?: QuickReplyDto[]; confirmCard?: ConfirmCardDto; state?: unknown; understanding?: Pending };
    return { ...(st.state ? { state: st.state } : {}), ...(st.understanding ? { understanding: st.understanding } : {}), ...(st.quickReplies ? { quickReplies: st.quickReplies } : {}), ...(st.confirmCard ? { confirmCard: st.confirmCard } : {}) };
  };

  function replyStructured(turnKey: string, action: Pending["action"], version: number, p: { text: string; quick: StepResult["quickReplies"]; card?: StepResult["card"] }): Record<string, unknown> {
    const quickReplies: QuickReplyDto[] = p.quick.map((q) => ({ value: q.value, label: q.label, intent: q.intent }));
    return { state: { mode: "ask", fieldKey: null, pendingQuestion: p.text }, understanding: { action, frameVersion: version } satisfies Pending, ...(quickReplies.length ? { quickReplies } : {}), ...(p.card ? { confirmCard: cardOf(turnKey, p.card) } : {}), copyKeys: [] };
  }

  async function finishTurn(a: {
    ctx: ConversationContext; input: ProcessTurnInput; frame: Frame; stored: StoredFrame; clientTurn: StoredTurn; introduced: Set<string>; action: Pending["action"];
    p: { text: string; quick: StepResult["quickReplies"]; card?: StepResult["card"] }; composed: string; bare?: string; changes: StepResult["changes"]; started: number; extraStructured: Record<string, unknown>; ready: boolean; rawAction?: Action;
  }): Promise<ProcessTurnResult> {
    const { ctx, input, frame, stored } = a;
    const { projectId, scopeInstanceId, turnKey, locale } = input;
    const questions: VerifyContext["questions"] = a.action.kind === "ready" ? "none" : "one";
    const s = safeText(ctx, locale, a.introduced, a.composed, a.bare ?? a.p.text, questions);

    // facts first (idempotent on `${turnKey}:${fieldKey}`), then the frame + event atomically, then the assistant turn
    const facts = projectFacts(frame, turnKey);
    const saved = await deps.frames.commit(projectId, frame, stored.version, { turnKey, kind: "turn", payload: { action: a.action.kind, changes: a.changes.map((c) => `${c.kind}:${c.key}`).slice(0, 40) } });
    if (facts.length > 0 && deps.facts) await deps.facts.recordFacts({ projectId, scopeInstanceId, surface: "understanding", turnKey, facts });
    const structured = { ...replyStructured(turnKey, a.action, saved.version, a.p), ...a.extraStructured };
    const rows = await persistAssistant(ctx, { projectId, scopeInstanceId, turnKey, locale, kind: "message", text: s.text, structured });
    return resultOf({ ctx, status: "ok", turns: [a.clientTurn, ...rows], ready: a.ready, facts, started: a.started, usedFallback: s.fallback });
  }

  return {
    async openThread(input) {
      if (input.surface !== "understanding") return deps.base.openThread(input);
      if (!input.projectId || !input.scopeInstanceId) throw new ConversationInputError("INVALID_INPUT", "projectId and scopeInstanceId are required");
      return deps.store.withProjectLock(input.projectId, () => openUnderstanding(input));
    },
    async processTurn(input) {
      if (input.surface !== "understanding") return deps.base.processTurn(input);
      if (!input.projectId || !input.scopeInstanceId) throw new ConversationInputError("INVALID_INPUT", "projectId and scopeInstanceId are required");
      if (!TURN_KEY_RE.test(input.turnKey ?? "")) throw new ConversationInputError("INVALID_INPUT", "turnKey must match [A-Za-z0-9_.:-]{8,120}");
      if (input.locale !== "es" && input.locale !== "en") throw new ConversationInputError("INVALID_INPUT", "unknown locale");
      const provided = [input.text !== undefined, input.quickReply !== undefined, input.confirmAction !== undefined].filter(Boolean).length;
      if (provided !== 1) throw new ConversationInputError("INVALID_INPUT", "exactly one of text, quickReply or confirmAction is required");
      if (input.text !== undefined) {
        const t = input.text.replace(/\u0000/g, "").trim();
        if (t.length < 1 || t.length > 8000) throw new ConversationInputError("INVALID_INPUT", "text must be 1..8000 characters");
      }
      return deps.store.withProjectLock(input.projectId, () => processUnderstanding(input));
    },
  };
}

void plainCopy;
