/**
 * Turn engine (Track A contract §4, Build Readiness §L/§M).
 *
 *   processTurn({projectId, surface, scopeInstanceId, turnKey, locale, text | quickReply | confirmAction})
 *
 * Pipeline per turn (serialised per project by `ConversationStore.withProjectLock`):
 *   1. idempotency: an existing assistant turn for (project, turnKey) is returned as-is; a client-only turn is
 *      reprocessed once (no second client row, facts are idempotent on `turnKey:fieldKey`);
 *   2. guard (engine/guard.ts, deterministic layers) -> client turn is persisted FIRST;
 *   3. deterministic pre-router: process questions are answered from the Process Knowledge pack, write nothing and
 *      resume the same pending question (0 model calls);
 *   4. otherwise the answer is read: answer-state signals and bare answers deterministically, free text through
 *      the provider's `extract` (validated: schema, anti-hallucination source check, confidence thresholds);
 *   5. validated facts go to the `FactWriter` port; ENGINE's `EvaluateCategory` (injected) picks the NEXT field —
 *      the model only phrases it (`write`), through the verified pipeline (<= 2 model calls per turn, regenerate
 *      once only if budget remains, then fixed-copy fallback);
 *   6. the assistant turn is persisted; the result is TurnResultDto-compatible plus CONV extras.
 *
 * Failure policy: if the answer cannot be read (extraction unavailable/timeout) the turn ends `ai_unavailable`
 * (client turn kept, nothing written, same turnKey retries safely, no provider text reaches the client). If only
 * the phrasing fails, the fixed-copy question is used and the turn still succeeds.
 */
import { guard } from "../engine/guard";
import { extraGuard } from "./guard-extra";
import { copyText } from "./copy";
import { briefOf, enumValuesOf, helpOf, isGroup, labelOf, makeTarget, mergeGroupItem, resolveFieldDef, assembleValue, specsFor, valueTypeOf, basicRenderer, type FieldDefinition, type Target, type ValueRenderer } from "./fields";
import { deterministicAnswer, detectAnswerSignal, hasEstimateCue } from "./answer-state";
import { buildWritePrompt } from "./prompts";
import {
  CRP_FULL,
  composeProcessAnswer,
  composeUnknownAnswer,
  isAmbiguousQuestion,
  lastQuestionOf,
  routeProcessQuestion,
  topicsSummaryForRouting,
  type RouteDecision,
} from "./process-knowledge";
import {
  ModelUnavailableError,
  systemClock,
  type Clock,
  type ContextReader,
  type ConversationStore,
  type EvaluateCategory,
  type ExtractRequest,
  type ExtractResponse,
  type FactWriter,
  type ModelProvider,
  type ModelRequest,
  type ModelResponseFor,
  type StoredTurn,
  type WriteIntent,
  type WriteRequest,
} from "./ports";
import { lastPending, stateOf, toTurnDto, type PendingCandidate, type PendingState } from "./thread-state";
import { hashString, lowerFirst, normalizeText, wordCount } from "./text-utils";
import {
  ConversationInputError,
  type CandidateFact,
  type CandidateAnswerState,
  type CategoryEvaluation,
  type CategoryProgressDto,
  type CategoryStatus,
  type ConfirmCardDto,
  type ConversationContext,
  type Locale,
  type OpenThreadInput,
  type PendingSignal,
  type ProcessTurnInput,
  type ProcessTurnResult,
  type QuickReplyDto,
  type Surface,
  type TurnDto,
  type TurnKind,
  type UnderstandingState,
  type WaitingHint,
} from "./types";
import { produceVerifiedText, verifyAssistantText, type VerifyContext } from "./verifiers";
import type { FactMap, FactView } from "../manifest/types";
import { introducedFromTexts } from "./process-knowledge/term-registry";
import { classifyPhrase } from "../understanding/need-explorer";

// ------------------------------------------------------------------ configuration
/** Progressive-waiting stages (keys only; the UI owns the copy and the exact wording). */
export const WAITING_HINTS: readonly WaitingHint[] = [
  { afterMs: 1500, key: "saved" },
  { afterMs: 4000, key: "reading" },
  { afterMs: 9000, key: "structuring" },
  { afterMs: 15000, key: "still_working" },
];

export interface EngineOptions {
  /** Ask the provider to route ambiguous short questions (costs one model call). Default false. */
  modelAssistedRouting?: boolean;
  extractTimeoutMs?: number;
  writeTimeoutMs?: number;
  routeTimeoutMs?: number;
  /** Whole-turn budget; the writer is skipped (fixed copy) when less than writeTimeoutMs remains. */
  turnBudgetMs?: number;
  /** Hard cap of logical model calls per turn. */
  maxModelCalls?: number;
  thresholds?: { target: number; other: number; confirm: number };
  historyLimit?: number;
}

export const DEFAULT_ENGINE_OPTIONS: Required<Omit<EngineOptions, "thresholds">> & { thresholds: { target: number; other: number; confirm: number } } = {
  modelAssistedRouting: false,
  extractTimeoutMs: 12_000,
  writeTimeoutMs: 12_000,
  routeTimeoutMs: 6_000,
  turnBudgetMs: 30_000,
  maxModelCalls: 2,
  thresholds: { target: 0.7, other: 0.85, confirm: 0.5 },
  historyLimit: 60,
};

export interface EngineDeps {
  store: ConversationStore;
  context: ContextReader;
  facts: FactWriter;
  evaluate: EvaluateCategory;
  provider: ModelProvider;
  clock?: Clock;
  renderer?: ValueRenderer;
  options?: EngineOptions;
}

export interface ConversationEngine {
  processTurn(input: ProcessTurnInput): Promise<ProcessTurnResult>;
  openThread(input: OpenThreadInput): Promise<ProcessTurnResult>;
}

export function createConversationEngine(deps: EngineDeps): ConversationEngine {
  return {
    processTurn: (input) => processTurn(deps, input),
    openThread: (input) => openThread(deps, input),
  };
}

const TURN_KEY_RE = /^[A-Za-z0-9_.:-]{8,120}$/;
const SURFACES: readonly Surface[] = ["understanding", "category", "add_service"];

function validate(input: ProcessTurnInput): { text: string | null } {
  if (!input.projectId || !input.scopeInstanceId) throw new ConversationInputError("INVALID_INPUT", "projectId and scopeInstanceId are required");
  if (!TURN_KEY_RE.test(input.turnKey ?? "")) throw new ConversationInputError("INVALID_INPUT", "turnKey must match [A-Za-z0-9_.:-]{8,120}");
  if (!SURFACES.includes(input.surface)) throw new ConversationInputError("INVALID_INPUT", "unknown surface");
  if (input.locale !== "es" && input.locale !== "en") throw new ConversationInputError("INVALID_INPUT", "unknown locale");
  const provided = [input.text !== undefined, input.quickReply !== undefined, input.confirmAction !== undefined].filter(Boolean).length;
  if (provided !== 1) throw new ConversationInputError("INVALID_INPUT", "exactly one of text, quickReply or confirmAction is required");
  if (input.text !== undefined) {
    // eslint-disable-next-line no-control-regex -- strips NUL on purpose
    const t = input.text.replace(/\u0000/g, "").trim();
    if (t.length < 1 || t.length > 8000) throw new ConversationInputError("INVALID_INPUT", "text must be 1..8000 characters");
    return { text: t };
  }
  if (input.quickReply && (typeof input.quickReply.value !== "string" || input.quickReply.value.length > 500)) throw new ConversationInputError("INVALID_INPUT", "invalid quick reply");
  if (input.confirmAction && (!input.confirmAction.token || (input.confirmAction.intent !== "confirm" && input.confirmAction.intent !== "correct"))) throw new ConversationInputError("INVALID_INPUT", "invalid confirm action");
  return { text: null };
}

export async function processTurn(deps: EngineDeps, input: ProcessTurnInput): Promise<ProcessTurnResult> {
  const v = validate(input);
  return deps.store.withProjectLock(input.projectId, () => new Run(deps, input.projectId, input.surface, input.scopeInstanceId, input.locale).processTurn(input, v.text));
}

export async function openThread(deps: EngineDeps, input: OpenThreadInput): Promise<ProcessTurnResult> {
  if (!input.projectId || !input.scopeInstanceId) throw new ConversationInputError("INVALID_INPUT", "projectId and scopeInstanceId are required");
  return deps.store.withProjectLock(input.projectId, () => new Run(deps, input.projectId, input.surface, input.scopeInstanceId, input.locale).openThread());
}

// ------------------------------------------------------------------ internals
type AckKind = "none" | "recorded" | "corrected" | "confirmed" | "clarify";

interface Reply {
  kind: TurnKind;
  text: string;
  state: PendingState;
  quickReplies?: QuickReplyDto[];
  confirmCard?: ConfirmCardDto;
  facts: CandidateFact[];
  confirmedServiceNeed: string | null;
  extra: Record<string, unknown>;
  serviceMapChanged: boolean;
}

interface Applied {
  facts: CandidateFact[];
  ack: AckKind;
  recorded: string | null;
  lead: { key: string; params?: Record<string, string> } | null;
  candidate: PendingCandidate | null;
  askCorrection: boolean;
}

const EMPTY_APPLIED: Applied = { facts: [], ack: "none", recorded: null, lead: null, candidate: null, askCorrection: false };

const CORRECTION_CUE = /\b(?:en realidad|mejor dicho|me equivoque|me equivoco|corrijo|correccion|corregir|no es asi|ya no|cambio de|cambiamos|actually|correction|i meant|my mistake|instead|changed our|we changed|not anymore)\b/;

const NUMERIC_TYPES = new Set(["number", "money", "number_with_unit"]);

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

class Run {
  private readonly clock: Clock;
  private readonly renderer: ValueRenderer;
  private readonly opt: typeof DEFAULT_ENGINE_OPTIONS;
  private ctx!: ConversationContext;
  private thread: StoredTurn[] = [];
  private introduced = new Set<string>();
  private calls = 0;
  private physical = 0;
  private readonly started: number;
  private copyKeys: string[] = [];
  private usedFallback = false;
  private pendingSignals: PendingSignal[] = [];
  private topicKeys: string[] = [];
  private turnKey = "";

  constructor(
    private readonly deps: EngineDeps,
    private readonly projectId: string,
    private readonly surface: Surface,
    private readonly scopeInstanceId: string,
    private readonly locale: Locale,
  ) {
    this.clock = deps.clock ?? systemClock;
    this.renderer = deps.renderer ?? basicRenderer;
    this.opt = { ...DEFAULT_ENGINE_OPTIONS, ...(deps.options ?? {}), thresholds: { ...DEFAULT_ENGINE_OPTIONS.thresholds, ...(deps.options?.thresholds ?? {}) } } as typeof DEFAULT_ENGINE_OPTIONS;
    this.started = this.clock.monotonicMs();
  }

  // ---------------------------------------------------------------- setup
  private async init(): Promise<void> {
    this.ctx = await this.deps.context.load({ projectId: this.projectId, surface: this.surface, scopeInstanceId: this.scopeInstanceId, locale: this.locale });
    this.thread = await this.deps.store.loadThread(this.projectId, this.scopeInstanceId, this.opt.historyLimit);
    this.introduced = new Set(this.ctx.introducedTerms);
    for (const t of introducedFromTexts(this.thread.filter((r) => r.role === "assistant").map((r) => r.content))) this.introduced.add(t);
    if (await this.deps.store.hasAssistantTextContaining(this.projectId, CRP_FULL)) this.introduced.add("crp");
  }

  private elapsed(): number {
    return this.clock.monotonicMs() - this.started;
  }

  private remainingMs(): number {
    return this.opt.turnBudgetMs - this.elapsed();
  }

  private async callModel<R extends ModelRequest>(req: R): Promise<ModelResponseFor<R>> {
    if (this.calls >= this.opt.maxModelCalls) throw new Error("model call budget exceeded (engine bug)");
    this.calls += 1;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ModelUnavailableError("timeout")), req.timeoutMs + 250);
    });
    try {
      const res = await Promise.race([this.deps.provider.complete(req), timeout]);
      this.physical += (res as { physicalCalls?: number }).physicalCalls ?? 1;
      return res as ModelResponseFor<R>;
    } catch (err) {
      this.physical += 1;
      throw err instanceof ModelUnavailableError ? err : new ModelUnavailableError("exhausted");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private copy(key: string, params: Record<string, string> = {}): string {
    const r = copyText(key, this.locale, params, this.introduced);
    this.introduced = r.introduced;
    this.copyKeys.push(key);
    return r.text;
  }

  // ---------------------------------------------------------------- evaluation helpers
  private evaluate(facts?: FactMap): CategoryEvaluation {
    return this.deps.evaluate(facts ? { ...this.ctx.evaluation, facts } : this.ctx.evaluation);
  }

  private defOf(key: string): FieldDefinition | null {
    return resolveFieldDef(this.ctx.evaluation.manifest, key, this.ctx.evaluation.countries);
  }

  private scopeOf(t: Target): string {
    return t.groupKey ? `${t.groupKey}.${t.ask.field_key}` : t.ask.field_key;
  }

  private progress(ev: CategoryEvaluation | null): CategoryProgressDto | null {
    if (this.surface !== "category" || !ev) return null;
    const cur = this.ctx.categoryStatus;
    let status: CategoryStatus = cur ?? "not_started";
    if (cur !== "confirmed" && cur !== "sent") status = ev.ready ? "ready_for_review" : ev.confirmedRequired > 0 || this.thread.length > 0 ? "in_progress" : (cur ?? "not_started");
    return { progressPct: ev.progressPct, criticalOpen: ev.critical.length, pendingCount: ev.pending.length, ready: ev.ready, status };
  }

  private understandingState(ev: CategoryEvaluation | null): UnderstandingState | null {
    if (this.surface !== "understanding" || !ev) return null;
    if (this.ctx.understandingState === "confirmed") return "confirmed";
    return ev.nextFieldKey === null && ev.ready ? "ready_to_confirm" : "in_progress";
  }

  private countryNames(): string[] {
    const out: string[] = [];
    for (const loc of ["es", "en"]) {
      let dn: Intl.DisplayNames | null = null;
      try {
        dn = new Intl.DisplayNames([loc], { type: "region" });
      } catch {
        dn = null;
      }
      for (const c of this.ctx.evaluation.countries) {
        const n = dn?.of(c.toUpperCase());
        if (n && n !== c) out.push(n);
      }
    }
    return out;
  }

  private knownFields(excludeKey?: string): { fieldKey: string; label: string }[] {
    const out: { fieldKey: string; label: string }[] = [];
    for (const f of this.ctx.evaluation.manifest.fields ?? []) {
      if (f.field_key === excludeKey) continue;
      const fact = this.ctx.evaluation.facts[f.field_key];
      if (fact && (fact.answerState === "ANSWERED" || fact.answerState === "EXPLICIT_NO" || fact.answerState === "ZERO")) out.push({ fieldKey: f.field_key, label: labelOf(f, this.locale) });
    }
    return out;
  }

  private vctx(extra: Partial<VerifyContext> = {}): VerifyContext {
    return {
      locale: this.locale,
      surface: this.surface,
      introducedTerms: this.introduced,
      sherpaAssigned: this.ctx.flags.sherpaAssigned,
      allowSherpaGeneral: false,
      approvedSources: this.ctx.approvedSources,
      extraCountryNames: this.countryNames(),
      questions: "at-most-one",
      ...extra,
    };
  }

  // ---------------------------------------------------------------- DTO assembly
  private result(args: {
    status: ProcessTurnResultStatus;
    turns: StoredTurn[];
    ev: CategoryEvaluation | null;
    facts?: CandidateFact[];
    serviceMapChanged?: boolean;
    retryable?: boolean;
    confirmedServiceNeed?: string | null;
    notice?: { copyKey: string; text: string } | null;
    replayed?: boolean;
    turnKind?: TurnKind;
  }): ProcessTurnResult {
    const turns: TurnDto[] = args.turns.map(toTurnDto);
    return {
      status: args.status,
      turns,
      progress: this.progress(args.ev),
      understandingState: this.understandingState(args.ev),
      serviceMapChanged: args.serviceMapChanged ?? false,
      retryable: args.retryable ?? false,
      factsToWrite: args.facts ?? [],
      pendingSignals: this.pendingSignals,
      confirmedServiceNeed: args.confirmedServiceNeed ?? null,
      notice: args.notice ?? null,
      meta: {
        turnKind: args.turnKind ?? "message",
        topicKeys: this.topicKeys,
        modelCalls: this.calls,
        physicalModelCalls: this.physical,
        usedFallbackCopy: this.usedFallback,
        copyKeys: [...new Set(this.copyKeys)],
        elapsedMs: this.elapsed(),
        waitingHints: WAITING_HINTS.map((h) => ({ ...h })),
        timeoutBudgetMs: this.opt.turnBudgetMs,
        replayed: args.replayed ?? false,
        providerImplementation: this.deps.provider.describe().implementation,
      },
    };
  }

  private async persistAssistant(turnKey: string, reply: Reply): Promise<StoredTurn[]> {
    const out: StoredTurn[] = [];
    if (this.surface === "understanding" && !(await this.deps.store.hasDisclosure(this.projectId))) {
      const disclosure = this.copy("ai_disclosure_once");
      const d = await this.deps.store.persistTurn({
        projectId: this.projectId,
        scopeInstanceId: this.scopeInstanceId,
        turnKey: `disclosure.${this.projectId}`.slice(0, 120),
        role: "assistant",
        surface: this.surface,
        kind: "disclosure",
        locale: this.locale,
        content: disclosure,
        structured: { copyKeys: ["ai_disclosure_once"] },
      });
      if (d.created) out.push(d.turn);
    }
    const structured: Record<string, unknown> = {
      state: reply.state,
      ...(reply.quickReplies ? { quickReplies: reply.quickReplies } : {}),
      ...(reply.confirmCard ? { confirmCard: reply.confirmCard } : {}),
      copyKeys: [...new Set(this.copyKeys)],
      usedFallback: this.usedFallback,
      modelCalls: this.calls,
      ...reply.extra,
    };
    const a = await this.deps.store.persistTurn({
      projectId: this.projectId,
      scopeInstanceId: this.scopeInstanceId,
      turnKey,
      role: "assistant",
      surface: this.surface,
      kind: reply.kind,
      locale: this.locale,
      content: reply.text,
      structured,
    });
    out.push(a.turn);
    return out;
  }

  // ---------------------------------------------------------------- processTurn
  async processTurn(input: ProcessTurnInput, text: string | null): Promise<ProcessTurnResult> {
    this.turnKey = input.turnKey;
    await this.init();
    if (!this.ctx.canWrite) throw new ConversationInputError("NOT_WRITABLE", "this thread is read-only");
    const existing = await this.deps.store.findByTurnKey(this.projectId, input.turnKey);
    if (existing.assistant) {
      const ev = this.evaluate();
      const turns = [existing.client, existing.assistant].filter((x): x is StoredTurn => x !== null);
      return this.result({ status: "ok", turns, ev, replayed: true, turnKind: existing.assistant.kind });
    }

    const pending = lastPending(this.thread);
    // confirm/correct must answer a pending confirmation: reject BEFORE anything is persisted
    if (input.confirmAction || input.quickReply?.intent === "confirm" || input.quickReply?.intent === "correct") {
      const st = pending?.state;
      if (!st || (st.mode !== "prefill_confirm" && st.mode !== "candidate_confirm" && st.mode !== "need_confirm")) throw new ConversationInputError("INVALID_INPUT", "no pending confirmation");
      if (input.confirmAction && st.confirmToken !== input.confirmAction.token) throw new ConversationInputError("INVALID_INPUT", "confirm token does not match the pending card");
    }
    const clientContent = this.clientContent(input, text, pending?.row ?? null);

    // guard + deterministic routing (no I/O) decide the client turn's kind before it is persisted
    const guardable = text ?? (input.quickReply && !this.chipFor(input.quickReply.value, pending?.row ?? null) ? input.quickReply.value : null);
    const verdict = existing.client || guardable === null ? null : await guard(guardable, { chain: [], timeoutMs: 0 }, {}, { useModelLayer: false });
    const blocked = verdict?.verdict === "block" || (!existing.client && guardable !== null && extraGuard(guardable).verdict === "block");
    const NO_ROUTE: RouteDecision = { kind: "none", topicKeys: [], mixed: false, rules: [] };
    const decision: RouteDecision = text !== null && !blocked ? routeProcessQuestion(text, { surface: this.surface, flags: this.ctx.flags, extraCountryNames: this.countryNames() }) : NO_ROUTE;

    const clientTurn = existing.client
      ? existing.client
      : (
          await this.deps.store.persistTurn({
            projectId: this.projectId,
            scopeInstanceId: this.scopeInstanceId,
            turnKey: input.turnKey,
            role: "client",
            surface: this.surface,
            kind: decision.kind !== "none" ? "process_question" : "message",
            locale: this.locale,
            content: clientContent,
            structured: { input: input.quickReply ? "quick_reply" : input.confirmAction ? "confirm_action" : "text", ...(input.quickReply ? { intent: input.quickReply.intent } : {}) },
          })
        ).turn;

    const evBefore = this.evaluate();

    if (blocked) {
      this.copyKeys.push("guard_block");
      const reply: Reply = {
        kind: "notice",
        text: this.copy("guard_block"),
        state: pending?.state ?? { mode: "closed", fieldKey: null, pendingQuestion: null },
        facts: [],
        confirmedServiceNeed: null,
        extra: {},
        serviceMapChanged: false,
      };
      const rows = await this.persistAssistant(input.turnKey, reply);
      return this.result({ status: "blocked", turns: [clientTurn, ...rows], ev: evBefore, retryable: false, turnKind: "notice" });
    }

    try {
      let reply: Reply;
      if (text !== null && decision.kind !== "none") {
        reply = await this.processQuestionReply(decision, pending?.state ?? null, pending?.row ?? null);
      } else if (text !== null && this.opt.modelAssistedRouting && isAmbiguousQuestion(text) && this.calls < this.opt.maxModelCalls) {
        const routed = await this.modelRoute(text);
        reply = routed ? await this.processQuestionReply(routed, pending?.state ?? null, pending?.row ?? null) : await this.answerReply(input, text, pending?.state ?? null, evBefore);
      } else {
        reply = await this.answerReply(input, text, pending?.state ?? null, evBefore);
      }

      // effects: facts first (idempotent on `${turnKey}:${fieldKey}`), then the assistant turn
      if (reply.facts.length > 0) {
        await this.deps.facts.recordFacts({ projectId: this.projectId, scopeInstanceId: this.scopeInstanceId, surface: this.surface, turnKey: input.turnKey, facts: reply.facts });
      }
      const rows = await this.persistAssistant(input.turnKey, reply);
      const evAfter = reply.facts.length > 0 ? this.evaluate(this.mergeFacts(reply.facts)) : evBefore;
      return this.result({
        status: "ok",
        turns: [clientTurn, ...rows],
        ev: evAfter,
        facts: reply.facts,
        serviceMapChanged: reply.serviceMapChanged || (this.surface === "understanding" && reply.facts.length > 0),
        confirmedServiceNeed: reply.confirmedServiceNeed,
        turnKind: reply.kind,
      });
    } catch (err) {
      if (err instanceof ModelUnavailableError || (err instanceof Error && err.name === "ModelUnavailableError")) {
        // The client turn is saved; nothing else happened. A retry with the same turnKey reprocesses safely.
        const notice = { copyKey: "ai_unavailable_retry", text: copyText("ai_unavailable_retry", this.locale).text };
        return this.result({ status: "ai_unavailable", turns: [clientTurn], ev: evBefore, retryable: true, notice, turnKind: "message" });
      }
      throw err;
    }
  }

  private mergeFacts(facts: readonly CandidateFact[]): FactMap {
    const merged: Record<string, FactView | undefined> = { ...this.ctx.evaluation.facts };
    for (const f of facts) merged[f.fieldKey] = { value: f.value, answerState: f.answerState, provenance: f.provenanceStage };
    return merged as FactMap;
  }

  private chipFor(value: string, row: StoredTurn | null): QuickReplyDto | null {
    const chips = (row?.structured as { quickReplies?: QuickReplyDto[] } | undefined)?.quickReplies ?? [];
    return chips.find((c) => c.value === value) ?? null;
  }

  private clientContent(input: ProcessTurnInput, text: string | null, pendingRow: StoredTurn | null): string {
    if (text !== null) return text;
    if (input.confirmAction) return this.copy(input.confirmAction.intent === "confirm" ? "client_echo_confirm" : "client_echo_correct");
    const qr = input.quickReply as NonNullable<ProcessTurnInput["quickReply"]>;
    const chip = this.chipFor(qr.value, pendingRow);
    if (chip) return chip.label;
    if (qr.intent === "unknown") return this.copy("qr_unknown");
    if (qr.intent === "confirm") return this.copy("client_echo_confirm");
    if (qr.intent === "correct") return this.copy("client_echo_correct");
    return qr.value.trim() || this.copy("qr_unknown");
  }

  // ---------------------------------------------------------------- process questions
  private async modelRoute(text: string): Promise<RouteDecision | null> {
    try {
      const res = await this.callModel({ task: "route", surface: this.surface, step: "route", locale: this.locale, turnKey: this.turnKey, clientText: text, topics: topicsSummaryForRouting(this.locale), timeoutMs: this.opt.routeTimeoutMs });
      if (res.topicKeys.length === 0) return null;
      return { kind: "pack", topicKeys: res.topicKeys.slice(0, 2), mixed: false, rules: ["model_route"] };
    } catch {
      return null;
    }
  }

  private async processQuestionReply(decision: RouteDecision, state: PendingState | null, pendingRow: StoredTurn | null): Promise<Reply> {
    const pendingQuestion = state?.pendingQuestion ?? (pendingRow ? lastQuestionOf(pendingRow.content) : null);
    const target = state?.fieldKey ? this.defOf(state.fieldKey) : null;
    const reason = target ? helpOf(state?.subKey ? ((target.group_item_schema ?? []).find((s) => s.field_key === state.subKey) ?? target) : target, this.locale) : null;
    let ans;
    if (decision.kind === "legal_unverified") {
      ans = composeUnknownAnswer(this.locale, pendingQuestion, "r10_cannot_confirm");
      this.pendingSignals.push({ kind: "country_claim_unverified", fieldKey: state?.fieldKey ?? null, note: "client asked a country-specific legal question without an approved source" });
    } else if (decision.kind === "unknown") {
      ans = composeUnknownAnswer(this.locale, pendingQuestion, "process_unknown");
      this.pendingSignals.push({ kind: "process_question_unanswered", fieldKey: state?.fieldKey ?? null, note: "process question outside the knowledge pack" });
    } else {
      ans = composeProcessAnswer({ topicKeys: decision.topicKeys, locale: this.locale, surface: this.surface, flags: this.ctx.flags, reason, introduced: this.introduced, pendingQuestion });
      if (ans.usedUnknownCopy) this.pendingSignals.push({ kind: "process_question_unanswered", fieldKey: state?.fieldKey ?? null, note: "no servable pack topic" });
    }
    this.topicKeys = ans.topicKeys;
    this.copyKeys.push(...ans.copyKeys);
    const introBefore = new Set(this.introduced);
    for (const t of ans.introduced) this.introduced.add(t);

    // Last line of defence: the composed answer must pass the same verifiers as any generated text.
    let text = ans.text;
    const vs = verifyAssistantText(text, this.vctx({ allowSherpaGeneral: true, questions: "at-most-one", introducedTerms: introBefore }));
    if (vs.some((v) => v.critical)) {
      const safe = composeUnknownAnswer(this.locale, pendingQuestion, "process_unknown");
      text = safe.text;
      this.usedFallback = true;
      this.copyKeys.push(...safe.copyKeys);
    }
    const base: PendingState = state ?? { mode: "ask", fieldKey: null, pendingQuestion };
    return {
      kind: "process_question",
      text,
      state: { ...base, pendingQuestion },
      // The SAME pending question is resumed with the SAME affordances (chips / confirm card).
      ...(pendingRow ? this.carryAffordances(pendingRow) : {}),
      facts: [],
      confirmedServiceNeed: null,
      serviceMapChanged: false,
      extra: { topicKeys: ans.topicKeys, packVersion: ans.packVersion, factIds: ans.factIds, sourceRefs: ans.sourceRefs, decision: decision.kind, mixed: decision.mixed },
    };
  }

  private carryAffordances(row: StoredTurn): { quickReplies?: QuickReplyDto[]; confirmCard?: ConfirmCardDto } {
    const st = row.structured as { quickReplies?: QuickReplyDto[]; confirmCard?: ConfirmCardDto };
    return { ...(st.quickReplies ? { quickReplies: st.quickReplies } : {}), ...(st.confirmCard ? { confirmCard: st.confirmCard } : {}) };
  }

  // ---------------------------------------------------------------- answers
  private async answerReply(input: ProcessTurnInput, text: string | null, state: PendingState | null, evBefore: CategoryEvaluation): Promise<Reply> {
    if (this.surface === "add_service") return this.addServiceReply(input, text, state);
    return this.fieldReply(input, text, state, evBefore);
  }

  // ---- add a service
  private async addServiceReply(input: ProcessTurnInput, text: string | null, state: PendingState | null): Promise<Reply> {
    const needState = (mode: PendingState["mode"], q: string, extra: Partial<PendingState> = {}): PendingState => ({ mode, fieldKey: null, pendingQuestion: q, ...extra });
    const rephrase = (): Reply => {
      const t = this.copy("add_service_rephrase");
      return this.simpleReply(t, needState("need", t));
    };
    // confirm / correct of the pending need
    const confirm = this.confirmIntent(input, text, state);
    if (state?.mode === "need_confirm" && confirm) {
      if (confirm === "confirm" && state.need) {
        const t = this.copy("add_service_confirmed_ack");
        return { ...this.simpleReply(t, needState("closed", t)), confirmedServiceNeed: state.need, serviceMapChanged: true };
      }
      return rephrase();
    }
    if (input.confirmAction || input.quickReply?.intent === "confirm" || input.quickReply?.intent === "correct") {
      throw new ConversationInputError("INVALID_INPUT", "no pending confirmation");
    }
    const raw = text ?? input.quickReply?.value ?? "";
    const sig = detectAnswerSignal(raw);
    if (sig.signal && sig.pure) return rephrase();
    if (input.quickReply?.intent === "unknown") return rephrase();

    // NEED FIRST (deterministic, before any model): meta-commands, objects and conditions are not services; an ambiguous word is
    // asked once; a known or legitimately unknown need goes on to be confirmed in the client's own words.
    const phrase = classifyPhrase(raw);
    const reply = phrase.kind === "meta" ? "add_service_meta" : phrase.kind === "goods_item" ? "add_service_goods" : phrase.kind === "attribute" ? "add_service_attribute" : phrase.kind === "ambiguous" ? "add_service_warehouse" : null;
    if (reply) {
      const t = this.copy(reply);
      return this.simpleReply(t, needState("need", t));
    }
    const canFallback = phrase.kind === "known" || phrase.kind === "unknown_legit";

    const spec = { name: "service_need", type: "string" as const, description: "The service or support the client says they need, as one short phrase (max 25 words), in the client's own language", isTarget: true };
    const res = await this.callModel({ task: "extract", surface: this.surface, step: "service_need", locale: this.locale, turnKey: this.turnKey, clientText: raw, question: state?.pendingQuestion ?? null, specs: [spec], timeoutMs: this.opt.extractTimeoutMs } satisfies ExtractRequest);
    const got = res.fields.find((f) => f.name === "service_need");
    const conf = got?.confidence ?? 0;
    const modelOk = Boolean(got && got.status === "ok" && typeof got.value === "string" && conf >= 0.6 && this.sourceOk(got.source, raw));
    if (!modelOk && !canFallback) return rephrase();
    // the model failed but the rules recognise a need: keep the client's own words (never lose a legitimate need)
    const need = clip(modelOk ? (got!.value as string) : raw.trim(), 160).replace(/[.!?¿¡]+$/g, "");
    if (need.length < 3) return rephrase();
    const t = this.copy("add_service_confirm_need", { need });
    const vs = verifyAssistantText(t, this.vctx({ questions: "one" }));
    if (vs.some((v) => v.critical)) return rephrase();
    const token = `cc_${hashString(`${this.turnKey}:service_need`)}`;
    const card: ConfirmCardDto = {
      kind: "service_need",
      title: this.copy("card_title_need"),
      body: need,
      confirmLabel: this.copy("confirm_yes"),
      correctLabel: this.copy("confirm_correct"),
      token,
    };
    return { ...this.simpleReply(t, needState("need_confirm", t, { need, confirmToken: token })), confirmCard: card };
  }

  private sourceOk(source: string | null, clientText: string): boolean {
    if (!source) return false;
    const s = normalizeText(source);
    return s.length > 0 && normalizeText(clientText).includes(s);
  }

  private simpleReply(text: string, state: PendingState): Reply {
    return { kind: "message", text, state, facts: [], confirmedServiceNeed: null, serviceMapChanged: false, extra: {} };
  }

  /** confirm / correct from a confirm action, a quick reply or a bare typed yes/no. */
  private confirmIntent(input: ProcessTurnInput, text: string | null, state: PendingState | null): "confirm" | "correct" | null {
    if (input.confirmAction) {
      if (state?.confirmToken && input.confirmAction.token !== state.confirmToken) throw new ConversationInputError("INVALID_INPUT", "confirm token does not match the pending card");
      return input.confirmAction.intent;
    }
    if (input.quickReply && (input.quickReply.intent === "confirm" || input.quickReply.intent === "correct")) return input.quickReply.intent;
    if (text !== null && state && (state.mode === "prefill_confirm" || state.mode === "candidate_confirm" || state.mode === "need_confirm")) {
      const n = normalizeText(text);
      if (/^(?:si|sii|claro|correcto|asi es|exacto|sigue siendo asi|yes|yeah|yep|sure|correct|that s right|right|exactly|still the case)$/.test(n)) return "confirm";
      if (/^(?:no|nope|incorrecto|no es asi|no es correcto|quiero corregirlo|corregir|not correct|incorrect|that s wrong|i want to correct it)$/.test(n)) return "correct";
    }
    return null;
  }

  // ---- category / understanding
  private targetFromState(state: PendingState | null): Target | null {
    if (!state || !state.fieldKey) return null;
    const def = this.defOf(state.fieldKey);
    if (!def) return null;
    if (!isGroup(def)) return { def, ask: def, groupKey: null, itemIndex: null, specName: def.field_key };
    const sub = (def.group_item_schema ?? []).find((s) => s.field_key === state.subKey);
    if (!sub) return makeTarget(def, this.ctx.evaluation.facts[def.field_key]?.value);
    return { def, ask: sub, groupKey: def.field_key, itemIndex: state.itemIndex ?? 0, specName: `${def.field_key}__${sub.field_key}` };
  }

  private nextTarget(ev: CategoryEvaluation, facts: FactMap, focus?: string | null): Target | null {
    const key = focus ?? ev.nextFieldKey;
    if (!key) return null;
    const def = this.defOf(key);
    if (!def) return null;
    return makeTarget(def, facts[def.field_key]?.value);
  }

  private makeFact(args: {
    target: { def: FieldDefinition; ask: FieldDefinition; groupKey: string | null; itemIndex: number | null };
    value: unknown;
    answerState: CandidateAnswerState;
    provenance: CandidateFact["provenanceStage"];
    confidence: number | null;
    supersedes: boolean;
    base?: Map<string, CandidateFact>;
    inherited?: { sourcePinId?: string; sourceItemRef?: string };
  }): CandidateFact {
    const { target } = args;
    const key = target.def.field_key;
    let value = args.value;
    let state: CandidateAnswerState = args.answerState;
    let valueType = valueTypeOf(target.ask);
    if (target.groupKey) {
      const prior = args.base?.get(key)?.value ?? this.ctx.evaluation.facts[key]?.value;
      value = mergeGroupItem(prior, target.itemIndex ?? 0, target.ask.field_key, args.value, args.answerState);
      state = "ANSWERED";
      valueType = "repeatable_group";
    }
    return {
      fieldKey: key,
      value,
      valueType,
      answerState: state,
      provenanceStage: args.provenance,
      confidence: args.provenance === "ai_extracted" ? args.confidence : null,
      supersedes: args.supersedes,
      ...(args.inherited?.sourcePinId ? { sourcePinId: args.inherited.sourcePinId } : {}),
      ...(args.inherited?.sourceItemRef ? { sourceItemRef: args.inherited.sourceItemRef } : {}),
      idempotencyKey: `${this.turnKey}:${key}`,
    };
  }

  private async fieldReply(input: ProcessTurnInput, text: string | null, state: PendingState | null, evBefore: CategoryEvaluation): Promise<Reply> {
    const facts = this.ctx.evaluation.facts;
    const inReview = state?.mode === "review" || state?.mode === "closed";
    let target = inReview ? null : this.targetFromState(state);
    if (!target && !inReview) target = this.nextTarget(evBefore, facts, this.ctx.focusFieldKey);
    let applied: Applied = EMPTY_APPLIED;

    const confirm = this.confirmIntent(input, text, state);
    if (confirm) {
      applied = this.applyConfirm(confirm, state);
    } else if (input.confirmAction || input.quickReply?.intent === "confirm" || input.quickReply?.intent === "correct") {
      throw new ConversationInputError("INVALID_INPUT", "no pending confirmation");
    } else if (target) {
      applied = await this.applyAnswer(input, text, state, target, evBefore);
    } else if (text !== null) {
      applied = await this.applyReviewCorrection(text, evBefore);
    }

    // After the answer: re-evaluate with the new facts; the SERVER picks the next field.
    const merged = applied.facts.length > 0 ? this.mergeFacts(applied.facts) : facts;
    const evAfter = applied.facts.length > 0 ? this.evaluate(merged) : evBefore;

    // fixed-copy branches that do not need a question from the model
    if (applied.askCorrection) {
      const t = this.copy("ask_correction");
      const tgt = target ?? this.targetFromState(state);
      return { ...this.simpleReply(t, { mode: "ask_correction", fieldKey: tgt?.def.field_key ?? state?.fieldKey ?? null, ...(tgt?.groupKey ? { subKey: tgt.ask.field_key, itemIndex: tgt.itemIndex ?? 0 } : {}), pendingQuestion: t }), facts: applied.facts, ...(tgt ? { quickReplies: this.quickRepliesFor(tgt) } : {}) };
    }
    if (applied.candidate) {
      const c = applied.candidate;
      const shown = clip(c.displayText, 200);
      const t = this.copy("confirm_candidate", { value: shown });
      if (verifyAssistantText(t, this.vctx({ questions: "one" })).some((v) => v.critical)) {
        const tgt = target;
        if (tgt) return this.askNext(tgt, "clarify", null, null, evAfter, applied.facts, state);
      }
      const token = `cc_${hashString(`${this.turnKey}:${c.fieldKey}`)}`;
      const card: ConfirmCardDto = {
        kind: "summary",
        title: this.copy("card_title_candidate"),
        body: shown,
        confirmLabel: this.copy("confirm_yes"),
        correctLabel: this.copy("confirm_correct"),
        token,
      };
      return { ...this.simpleReply(t, { mode: "candidate_confirm", fieldKey: c.fieldKey, ...(c.subKey ? { subKey: c.subKey, itemIndex: c.itemIndex ?? 0 } : {}), pendingQuestion: t, candidate: c, confirmToken: token }), confirmCard: card, facts: applied.facts };
    }

    const next = this.nextTarget(evAfter, merged);
    if (!next) {
      const readyKey = this.surface === "understanding" ? (evAfter.ready ? "understanding_review_ready" : "understanding_critical_pending") : evAfter.ready ? "category_review_ready" : "category_critical_pending";
      const lead = applied.lead ? `${this.copy(applied.lead.key, applied.lead.params ?? {})} ` : "";
      const t = `${lead}${this.copy(readyKey)}`;
      return { ...this.simpleReply(t, { mode: "review", fieldKey: null, pendingQuestion: null }), facts: applied.facts };
    }
    // inherited (PREFILL_CONFIRM) values are confirmed, not asked
    const inh = this.ctx.inherited.find((i) => i.fieldKey === next.def.field_key && !merged[i.fieldKey]);
    if (inh && !next.groupKey) {
      const shown = clip(inh.displayText, 200);
      const t = this.copy("fa_prefill_confirm", { value: shown });
      if (!verifyAssistantText(t, this.vctx({ questions: "one" })).some((v) => v.critical)) {
        const token = `cc_${hashString(`${this.turnKey}:${inh.fieldKey}:inh`)}`;
        const card: ConfirmCardDto = {
          kind: "inherited_value",
          title: this.copy("card_title_inherited"),
          body: shown,
          confirmLabel: this.copy("confirm_yes"),
          correctLabel: this.copy("confirm_correct"),
          token,
        };
        const lead = applied.lead ? `${this.copy(applied.lead.key, applied.lead.params ?? {})} ` : "";
        return { ...this.simpleReply(`${lead}${t}`, { mode: "prefill_confirm", fieldKey: inh.fieldKey, pendingQuestion: t, inherited: inh, confirmToken: token }), confirmCard: card, facts: applied.facts };
      }
    }
    return this.askNext(next, applied.ack, applied.recorded, applied.lead, evAfter, applied.facts, state);
  }

  // ---- applying inputs
  private applyConfirm(intent: "confirm" | "correct", state: PendingState | null): Applied {
    if (!state || (state.mode !== "prefill_confirm" && state.mode !== "candidate_confirm")) throw new ConversationInputError("INVALID_INPUT", "no pending confirmation");
    if (intent === "correct") return { ...EMPTY_APPLIED, askCorrection: true };
    if (state.mode === "prefill_confirm" && state.inherited) {
      const inh = state.inherited;
      const def = this.defOf(inh.fieldKey);
      if (!def) throw new ConversationInputError("INVALID_INPUT", "unknown field");
      const fact = this.makeFact({ target: { def, ask: def, groupKey: null, itemIndex: null }, value: inh.value, answerState: "ANSWERED", provenance: "client_confirmed", confidence: null, supersedes: false, inherited: { ...(inh.sourcePinId ? { sourcePinId: inh.sourcePinId } : {}), ...(inh.sourceItemRef ? { sourceItemRef: inh.sourceItemRef } : {}) } });
      return { ...EMPTY_APPLIED, facts: [fact], ack: "confirmed", recorded: clip(inh.displayText, 70) };
    }
    if (state.mode === "candidate_confirm" && state.candidate) {
      const c = state.candidate;
      const def = this.defOf(c.fieldKey);
      if (!def) throw new ConversationInputError("INVALID_INPUT", "unknown field");
      const ask = c.subKey ? ((def.group_item_schema ?? []).find((s) => s.field_key === c.subKey) ?? def) : def;
      const fact = this.makeFact({ target: { def, ask, groupKey: c.subKey ? def.field_key : null, itemIndex: c.subKey ? (c.itemIndex ?? 0) : null }, value: c.value, answerState: "ANSWERED", provenance: "client_confirmed", confidence: null, supersedes: c.supersedes });
      return { ...EMPTY_APPLIED, facts: [fact], ack: "confirmed", recorded: clip(c.displayText, 70) };
    }
    throw new ConversationInputError("INVALID_INPUT", "no pending confirmation");
  }

  private stateFact(target: Target, answerState: "UNKNOWN" | "WITHHELD", supersedes: boolean): CandidateFact {
    return this.makeFact({ target, value: null, answerState, provenance: "client_answered", confidence: null, supersedes });
  }

  private async applyAnswer(input: ProcessTurnInput, text: string | null, state: PendingState | null, target: Target, evBefore: CategoryEvaluation): Promise<Applied> {
    const existingFact = this.ctx.evaluation.facts[target.def.field_key];
    const alreadyConfirmed = existingFact !== undefined && ["ANSWERED", "EXPLICIT_NO", "ZERO"].includes(existingFact.answerState) && !target.groupKey;
    const correcting = state?.mode === "ask_correction" || alreadyConfirmed;
    const supersedes = alreadyConfirmed;
    const provenanceAnswer: CandidateFact["provenanceStage"] = correcting ? "client_corrected" : "client_answered";
    // quick replies
    if (input.quickReply) {
      const qr = input.quickReply;
      if (qr.intent === "unknown") return { ...EMPTY_APPLIED, facts: [this.stateFact(target, "UNKNOWN", supersedes)], lead: { key: "pending_accept" }, ack: "none" };
      if (qr.intent === "withheld") return { ...EMPTY_APPLIED, facts: [this.stateFact(target, "WITHHELD", supersedes)], lead: { key: "pending_accept_withheld" }, ack: "none" };
      if (qr.intent === "answer") {
        const direct = this.fromChip(target, qr.value);
        if (direct) {
          const fact = this.makeFact({ target, value: direct.value, answerState: direct.answerState, provenance: provenanceAnswer, confidence: null, supersedes });
          return { ...EMPTY_APPLIED, facts: [fact], ack: correcting ? "corrected" : "recorded", recorded: this.display(target, direct.value) };
        }
      }
      // estimate (or an unrecognised answer value) is read like typed text
      return this.applyText(qr.value, state, target, evBefore, correcting, supersedes, qr.intent === "estimate");
    }
    return this.applyText(text ?? "", state, target, evBefore, correcting, supersedes, false);
  }

  private fromChip(target: Target, value: string): { value: unknown; answerState: CandidateAnswerState } | null {
    const t = target.ask.type;
    if (t === "boolean") {
      const n = normalizeText(value);
      if (n === "true" || n === "yes" || n === "si") return { value: true, answerState: "ANSWERED" };
      if (n === "false" || n === "no") return { value: false, answerState: "EXPLICIT_NO" };
      return null;
    }
    if (t === "enum") {
      const values = enumValuesOf(target.ask);
      const hit = values.find((v) => v === value);
      return hit ? { value: hit, answerState: "ANSWERED" } : null;
    }
    return null;
  }

  private display(target: Target, value: unknown): string | null {
    const s = this.renderer.renderValue(target.ask, value, this.locale, this.scopeOf(target));
    return s ? clip(s, 70) : null;
  }

  private async applyText(rawText: string, state: PendingState | null, target: Target, evBefore: CategoryEvaluation, correcting: boolean, supersedes: boolean, estimateHint: boolean): Promise<Applied> {
    const text = rawText.trim();
    const provenanceAnswer: CandidateFact["provenanceStage"] = correcting ? "client_corrected" : "client_answered";
    const scope = this.scopeOf(target);
    const sig = detectAnswerSignal(text);

    if (sig.signal && sig.pure) {
      return { ...EMPTY_APPLIED, facts: [this.stateFact(target, sig.signal, supersedes)], lead: { key: sig.signal === "WITHHELD" ? "pending_accept_withheld" : "pending_accept" } };
    }
    const det = deterministicAnswer(target.ask, text, this.locale, this.renderer, scope);
    if (det) {
      const fact = this.makeFact({ target, value: det.value, answerState: det.answerState, provenance: provenanceAnswer, confidence: null, supersedes });
      return { ...EMPTY_APPLIED, facts: [fact], ack: correcting ? "corrected" : "recorded", recorded: this.display(target, det.value) };
    }

    // ---- free text: extraction (one model call)
    const specs = specsFor(target.ask, target.specName, this.locale, this.renderer, true, scope);
    const specOwner = new Map<string, { def: FieldDefinition; name: string; isTarget: boolean; correction: boolean; supersedes: boolean; tgt: Target }>();
    specOwner.set(target.specName, { def: target.ask, name: target.specName, isTarget: true, correction: correcting, supersedes, tgt: target });

    // opportunistic: other open fields the client may have volunteered (never groups) and sub-fields of the same item
    const openOthers = evBefore.pending.filter((p) => p.fieldKey !== target.def.field_key && p.answerState === "NOT_ASKED").slice(0, 4);
    for (const p of openOthers) {
      const d = this.defOf(p.fieldKey);
      if (!d || isGroup(d)) continue;
      specs.push(...specsFor(d, d.field_key, this.locale, this.renderer, false, d.field_key));
      specOwner.set(d.field_key, { def: d, name: d.field_key, isTarget: false, correction: false, supersedes: false, tgt: { def: d, ask: d, groupKey: null, itemIndex: null, specName: d.field_key } });
    }
    if (target.groupKey) {
      const item = (Array.isArray(this.ctx.evaluation.facts[target.groupKey]?.value) ? (this.ctx.evaluation.facts[target.groupKey]?.value as Array<Record<string, unknown> | null>) : [])[target.itemIndex ?? 0] ?? {};
      for (const s of target.def.group_item_schema ?? []) {
        if (s.field_key === target.ask.field_key || !["blocking", "required", "conditional"].includes(s.requirement_level)) continue;
        if ((item as Record<string, unknown>)[s.field_key] !== undefined) continue;
        if (specs.length >= 10) break;
        const name = `${target.groupKey}__${s.field_key}`;
        specs.push(...specsFor(s, name, this.locale, this.renderer, false, `${target.groupKey}.${s.field_key}`));
        specOwner.set(name, { def: s, name, isTarget: false, correction: false, supersedes: false, tgt: { def: target.def, ask: s, groupKey: target.groupKey, itemIndex: target.itemIndex, specName: name } });
      }
    }
    if (CORRECTION_CUE.test(normalizeText(text))) {
      const answered = evBefore.requirements.filter((r) => r.state === "confirmed" && r.fieldKey !== target.def.field_key).slice(0, 4);
      for (const r of answered) {
        const d = this.defOf(r.fieldKey);
        if (!d || isGroup(d) || specOwner.has(d.field_key)) continue;
        specs.push(...specsFor(d, d.field_key, this.locale, this.renderer, false, d.field_key));
        specOwner.set(d.field_key, { def: d, name: d.field_key, isTarget: false, correction: true, supersedes: true, tgt: { def: d, ask: d, groupKey: null, itemIndex: null, specName: d.field_key } });
      }
    }

    const res = await this.callModel({
      task: "extract",
      surface: this.surface,
      step: target.def.field_key,
      locale: this.locale,
      turnKey: this.turnKey,
      clientText: text,
      question: state?.pendingQuestion ?? null,
      specs: specs.slice(0, 12),
      timeoutMs: this.opt.extractTimeoutMs,
    } satisfies ExtractRequest);
    const got = new Map((res as ExtractResponse).fields.map((f) => [f.name, f]));

    const th = this.opt.thresholds;
    const facts = new Map<string, CandidateFact>();
    let ack: AckKind = "none";
    let recorded: string | null = null;
    let candidate: PendingCandidate | null = null;
    const estimate = (estimateHint || hasEstimateCue(text));

    for (const owner of specOwner.values()) {
      const a = assembleValue(owner.def, owner.name, got, text);
      if (!a.ok) continue;
      const conf = a.confidence ?? 0.6;
      const t = owner.tgt;
      const isCorrection = owner.correction;
      const isSuperseding = owner.supersedes;
      const accept = owner.isTarget ? conf >= th.target : conf >= th.other;
      if (accept) {
        const asEstimate = estimate && NUMERIC_TYPES.has(owner.def.type);
        const fact = this.makeFact({
          target: t,
          value: a.value,
          answerState: asEstimate ? "ASSUMED" : "ANSWERED",
          provenance: isCorrection ? "client_corrected" : "ai_extracted",
          confidence: a.confidence,
          supersedes: isSuperseding,
          base: facts,
        });
        facts.set(fact.fieldKey, fact);
        if (!recorded) {
          recorded = this.display(t, a.value);
          ack = isCorrection ? "corrected" : "recorded";
        }
        if (owner.isTarget && asEstimate) return { ...EMPTY_APPLIED, facts: [...facts.values()], ack, recorded, lead: { key: "pending_accept_estimate" } };
      } else if (owner.isTarget && conf >= th.confirm) {
        candidate = {
          fieldKey: t.def.field_key,
          ...(t.groupKey ? { subKey: t.ask.field_key, itemIndex: t.itemIndex ?? 0 } : {}),
          value: a.value,
          valueType: valueTypeOf(owner.def),
          supersedes: isSuperseding,
          provenance: "ai_extracted",
          confidence: a.confidence,
          displayText: this.renderer.renderValue(owner.def, a.value, this.locale, this.scopeOf(t)) ?? String(a.value),
        };
      }
    }
    const targetFactAccepted = [...facts.values()].some((f) => f.fieldKey === target.def.field_key);
    if (candidate && !targetFactAccepted) return { ...EMPTY_APPLIED, facts: [...facts.values()], candidate };

    if (!targetFactAccepted && sig.signal) {
      // "no sé …" plus other content: the target is recorded as pending; whatever else was said is kept
      facts.set(target.def.field_key, this.stateFact(target, sig.signal, supersedes));
      return { ...EMPTY_APPLIED, facts: [...facts.values()], ack: "none", lead: { key: sig.signal === "WITHHELD" ? "pending_accept_withheld" : "pending_accept" } };
    }
    if (facts.size === 0 && !targetFactAccepted) {
      // explicit "none"/zero in a longer message for list-like/numeric fields
      const short = detectNoneOrZero(target.ask, text);
      if (short) {
        const fact = this.makeFact({ target, value: short.value, answerState: short.answerState, provenance: provenanceAnswer, confidence: null, supersedes, base: facts });
        return { ...EMPTY_APPLIED, facts: [fact], ack: "recorded", recorded: null };
      }
      return { ...EMPTY_APPLIED, ack: "clarify" };
    }
    if (!targetFactAccepted && facts.size > 0) {
      // volunteered other facts but not the target: record them and ask the target again
      return { ...EMPTY_APPLIED, facts: [...facts.values()], ack, recorded };
    }
    return { ...EMPTY_APPLIED, facts: [...facts.values()], ack, recorded };
  }

  /** No pending question (review): only an explicit correction of a confirmed field is read from the text. */
  private async applyReviewCorrection(text: string, evBefore: CategoryEvaluation): Promise<Applied> {
    if (!CORRECTION_CUE.test(normalizeText(text))) return EMPTY_APPLIED;
    const answered = evBefore.requirements.filter((r) => r.state === "confirmed").slice(0, 8);
    const specs = [];
    const owners = new Map<string, FieldDefinition>();
    for (const r of answered) {
      const d = this.defOf(r.fieldKey);
      if (!d || isGroup(d)) continue;
      specs.push(...specsFor(d, d.field_key, this.locale, this.renderer, false, d.field_key));
      owners.set(d.field_key, d);
    }
    if (specs.length === 0) return EMPTY_APPLIED;
    const res = await this.callModel({ task: "extract", surface: this.surface, step: "review_correction", locale: this.locale, turnKey: this.turnKey, clientText: text, question: null, specs: specs.slice(0, 12), timeoutMs: this.opt.extractTimeoutMs } satisfies ExtractRequest);
    const got = new Map(res.fields.map((f) => [f.name, f]));
    const facts: CandidateFact[] = [];
    let recorded: string | null = null;
    for (const [key, d] of owners) {
      const a = assembleValue(d, key, got, text);
      if (!a.ok || (a.confidence ?? 0) < this.opt.thresholds.other) continue;
      const t = { def: d, ask: d, groupKey: null, itemIndex: null };
      facts.push(this.makeFact({ target: t, value: a.value, answerState: "ANSWERED", provenance: "client_corrected", confidence: null, supersedes: true }));
      recorded = recorded ?? this.display({ ...t, specName: key }, a.value);
    }
    return facts.length > 0 ? { ...EMPTY_APPLIED, facts, ack: "corrected", recorded } : EMPTY_APPLIED;
  }

  // ---- asking the next question
  private quickRepliesFor(t: Target): QuickReplyDto[] {
    const chips: QuickReplyDto[] = [];
    if (t.ask.type === "boolean") {
      chips.push({ value: "true", label: this.copy("qr_yes"), intent: "answer" }, { value: "false", label: this.copy("qr_no"), intent: "answer" });
    } else if (t.ask.type === "enum") {
      const vals = enumValuesOf(t.ask);
      if (vals.length > 0 && vals.length <= 6) for (const v of vals) chips.push({ value: v, label: this.renderer.enumLabel(v, this.locale, this.scopeOf(t)), intent: "answer" });
    }
    chips.push({ value: "unknown", label: this.copy("qr_unknown"), intent: "unknown" });
    return chips;
  }

  private fallbackQuestion(brief: { label: string; groupLabel?: string }): string {
    const label = brief.groupLabel ? `${brief.groupLabel} - ${brief.label}` : brief.label;
    let q: string;
    if (/[?¿]/.test(brief.label)) q = this.locale === "es" && !brief.label.trim().startsWith("¿") ? `¿${brief.label.trim()}` : brief.label.trim();
    else q = copyText("fallback_question_wrapper", this.locale, { label: lowerFirst(label) }).text;
    if (verifyAssistantText(q, this.vctx({ questions: "one" })).some((v) => v.critical)) {
      this.copyKeys.push("fallback_question_generic");
      return copyText("fallback_question_generic", this.locale).text;
    }
    this.copyKeys.push("fallback_question_wrapper");
    return q;
  }

  private async askNext(next: Target, ack: AckKind, recorded: string | null, lead: Applied["lead"], ev: CategoryEvaluation, facts: CandidateFact[], prior: PendingState | null, afterProcess = false): Promise<Reply> {
    const brief = briefOf(next, this.locale, this.renderer);
    const leadText = lead ? `${this.copy(lead.key, lead.params ?? {})} ` : "";
    const known = this.knownFields(next.def.field_key);
    const verifyCtx = this.vctx({ questions: "one", knownFields: known, targetLabels: [brief.label, ...(brief.groupLabel ? [brief.groupLabel] : [])] });
    const intent: WriteIntent = afterProcess
      ? { kind: "ask_field_after_process", field: brief }
      : { kind: "ask_field", field: brief, ack: lead ? "none" : ack, nextOrdinal: ev.confirmedRequired + 1, recorded: lead ? null : recorded };
    const budgetOk = this.remainingMs() > Math.min(this.opt.writeTimeoutMs, 4_000);

    const fallbackText = (): string => this.fallbackQuestion(brief);
    let text: string;
    let usedFallback = false;
    let r10 = false;
    if (!budgetOk || this.calls >= this.opt.maxModelCalls) {
      text = fallbackText();
      usedFallback = true;
    } else {
      try {
        const out = await produceVerifiedText({
          generate: async (attempt, feedback) => {
            const prompts = buildWritePrompt({ locale: this.locale, surface: this.surface, intent, attempt, feedback });
            const req: WriteRequest = {
              task: "write",
              surface: this.surface,
              step: next.def.field_key,
              locale: this.locale,
              turnKey: this.turnKey,
              attempt,
              intent,
              system: prompts.system,
              user: prompts.user,
              feedback,
              timeoutMs: this.opt.writeTimeoutMs,
            };
            const res = await this.callModel(req);
            return res.text;
          },
          verify: (t) => verifyAssistantText(t, verifyCtx),
          fallback: fallbackText,
          r10Replacement: () => `${this.copy("r10_cannot_confirm")} ${fallbackText()}`,
          canRegenerate: () => this.calls < this.opt.maxModelCalls && this.remainingMs() > Math.min(this.opt.writeTimeoutMs, 4_000),
        });
        text = out.text;
        usedFallback = out.usedFallback;
        r10 = out.r10;
      } catch {
        // phrasing failed: the fixed-copy question keeps the conversation going (extraction already succeeded)
        text = fallbackText();
        usedFallback = true;
      }
    }
    if (usedFallback) this.usedFallback = true;
    if (r10) this.pendingSignals.push({ kind: "country_claim_unverified", fieldKey: next.def.field_key, note: "generated text made a country-specific claim without an approved source; replaced" });
    for (const t of introducedFromTexts([text])) this.introduced.add(t);
    const full = `${leadText}${text}`.trim();
    const question = lastQuestionOf(text) ?? text;
    const st: PendingState = {
      mode: "ask",
      fieldKey: next.def.field_key,
      ...(next.groupKey ? { subKey: next.ask.field_key, itemIndex: next.itemIndex ?? 0 } : {}),
      pendingQuestion: question,
      clarifyCount: ack === "clarify" && prior?.fieldKey === next.def.field_key ? (prior.clarifyCount ?? 0) + 1 : 0,
    };
    return { kind: "message", text: full, state: st, quickReplies: this.quickRepliesFor(next), facts, confirmedServiceNeed: null, serviceMapChanged: false, extra: {} };
  }

  /** The category opens as a continuation of the project when it already knows something; otherwise the plain introduction. */
  private categoryIntro(): string {
    const known = (this.ctx.known ?? []).filter((k) => k.trim() !== "");
    if (known.length > 0) {
      const text = this.copy("category_intro_known", { category: this.ctx.title, known: known.join("; ") });
      if (!verifyAssistantText(text, this.vctx({ questions: "none" })).some((v) => v.critical)) return text;
    }
    return this.copy("category_intro", { category: this.ctx.title });
  }

  // ---------------------------------------------------------------- opening a thread
  async openThread(): Promise<ProcessTurnResult> {
    this.turnKey = `open.${this.scopeInstanceId}`.slice(0, 120);
    await this.init();
    const ev = this.evaluate();
    if (this.thread.length > 0) return this.result({ status: "ok", turns: this.thread, ev, replayed: true });
    if (!this.ctx.canWrite) return this.result({ status: "ok", turns: [], ev, replayed: true });

    let reply: Reply;
    if (this.surface === "add_service") {
      const t = this.copy("add_service_intro");
      reply = this.simpleReply(t, { mode: "need", fieldKey: null, pendingQuestion: t });
    } else {
      const intro = this.surface === "understanding" ? this.copy("understanding_welcome") : this.categoryIntro();
      const next = this.nextTarget(ev, this.ctx.evaluation.facts, this.ctx.focusFieldKey);
      if (!next) {
        reply = this.simpleReply(intro, { mode: "review", fieldKey: null, pendingQuestion: null });
      } else {
        const inh = this.ctx.inherited.find((i) => i.fieldKey === next.def.field_key && !this.ctx.evaluation.facts[i.fieldKey]);
        let asked: Reply | null = null;
        if (inh && !next.groupKey) {
          const shown = clip(inh.displayText, 200);
          const t = this.copy("fa_prefill_confirm", { value: shown });
          if (!verifyAssistantText(t, this.vctx({ questions: "one" })).some((v) => v.critical)) {
            const token = `cc_${hashString(`${this.turnKey}:${inh.fieldKey}:inh`)}`;
            const card: ConfirmCardDto = { kind: "inherited_value", title: this.copy("card_title_inherited"), body: shown, confirmLabel: this.copy("confirm_yes"), correctLabel: this.copy("confirm_correct"), token };
            asked = { ...this.simpleReply(t, { mode: "prefill_confirm", fieldKey: inh.fieldKey, pendingQuestion: t, inherited: inh, confirmToken: token }), confirmCard: card };
          }
        }
        if (!asked) asked = await this.askNext(next, "none", null, null, ev, [], null);
        reply = { ...asked, text: `${intro} ${asked.text}`.trim() };
      }
    }
    const rows = await this.persistAssistant(this.turnKey, reply);
    return this.result({ status: "ok", turns: rows, ev, turnKind: reply.kind });
  }
}

type ProcessTurnResultStatus = ProcessTurnResult["status"];

function detectNoneOrZero(def: FieldDefinition, text: string): { value: unknown; answerState: "EXPLICIT_NO" | "ZERO" } | null {
  const n = normalizeText(text);
  if (wordCount(text) > 8) return null;
  if (["multi_enum", "country_list", "language_list", "text_list", "text_or_language_code_list"].includes(def.type) && /\b(?:ninguno|ninguna|ningun|none|no hay|no tenemos|nothing)\b/.test(n)) return { value: [], answerState: "EXPLICIT_NO" };
  if (def.type === "number" && /\b(?:cero|zero)\b/.test(n)) return { value: 0, answerState: "ZERO" };
  return null;
}

export { stateOf };
