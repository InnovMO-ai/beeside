/**
 * CONV — shared types of the conversation module.
 *
 * Boundaries (Track A contract §1): this module phrases questions, extracts candidate facts and answers
 * process questions. It never decides readiness, progress, classification or what a CRP says (those come from
 * the `EvaluateCategory` port), and it never writes facts itself (it hands validated `CandidateFact`s to the
 * `FactWriter` port, implemented by DOMAIN).
 */
import type { AnswerState, CategoryEvaluation, EvaluationInput } from "../manifest/types";
import type {
  CategoryProgressDto,
  CategoryStatus,
  ConfirmCardDto,
  QuickReplyDto,
  QuickReplyIntent,
  SendStateDto,
  TurnDto,
  TurnKind,
  TurnResultDto,
  UnderstandingState,
} from "../api/dto";

export type Locale = "en" | "es";
export type Surface = "understanding" | "category" | "add_service";
export type { AnswerState, CategoryEvaluation, EvaluationInput, CategoryProgressDto, CategoryStatus, ConfirmCardDto, QuickReplyDto, QuickReplyIntent, TurnDto, TurnKind, TurnResultDto, UnderstandingState };

// ------------------------------------------------------------------ state flags (Process Knowledge L-2, L-6)
export interface StateFlags {
  crpState: "none" | "in_progress" | "ready_for_review" | "confirmed";
  firstSendDone: boolean;
  ohDeliveryState: SendStateDto;
  /** OH active AND a Sherpa really assigned. Until true, "your Sherpa" can never be said. */
  sherpaAssigned: boolean;
  premiumMode: "FULL" | "READ_ONLY" | "REVOKED";
  serviceMapConfirmed: boolean;
}

export const DEFAULT_FLAGS: StateFlags = {
  crpState: "none",
  firstSendDone: false,
  ohDeliveryState: "not_sent",
  sherpaAssigned: false,
  premiumMode: "FULL",
  serviceMapConfirmed: false,
};

// ------------------------------------------------------------------ context supplied by DOMAIN
/** A value inherited from the First Assessment that the client has not confirmed yet (PREFILL_CONFIRM). */
export interface InheritedValue {
  fieldKey: string;
  value: unknown;
  /** Client-language rendering of the value (already localized). */
  displayText: string;
  sourcePinId?: string;
  sourceItemRef?: string;
}

/** An approved statement the assistant may repeat about a country (R10). */
export interface ApprovedSource {
  sourceRef: string;
  country?: string;
  text: string;
}

export type UnderstandingStage = "understand_project" | "company_context_request" | "psm_complete_confirm";

export interface ConversationContext {
  projectId: string;
  surface: Surface;
  scopeInstanceId: string;
  locale: Locale;
  /** Category label (localized) for category threads; thread title otherwise. */
  title: string;
  /** Manifest + facts + countries for the scope. Understanding uses the pa_* manifest. */
  evaluation: EvaluationInput;
  inherited: InheritedValue[];
  /** Category threads: short client-language lines of what the project already established (the thread continues the project). */
  known?: string[];
  flags: StateFlags;
  approvedSources: ApprovedSource[];
  /** Term ids the UI already showed in full to the client (counts as introduced). */
  introducedTerms: string[];
  categoryStatus?: CategoryStatus;
  understandingState?: UnderstandingState;
  stage?: UnderstandingStage;
  /** DOMAIN may force the next target (e.g. the client opened a pending item). */
  focusFieldKey?: string | null;
  canWrite: boolean;
}

// ------------------------------------------------------------------ candidate facts (written by DOMAIN)
export type CandidateAnswerState = "ANSWERED" | "UNKNOWN" | "WITHHELD" | "EXPLICIT_NO" | "ZERO" | "ASSUMED";
export type CandidateProvenance = "ai_extracted" | "client_answered" | "client_confirmed" | "client_corrected";

export interface CandidateFact {
  /** Manifest field key WITHOUT the "precision." prefix. */
  fieldKey: string;
  value: unknown;
  valueType: string;
  answerState: CandidateAnswerState;
  provenanceStage: CandidateProvenance;
  /** Only meaningful for provenanceStage = ai_extracted. */
  confidence: number | null;
  /** True when this replaces an already confirmed value (a correction). */
  supersedes: boolean;
  sourcePinId?: string;
  sourceItemRef?: string;
  /** `${turnKey}:${fieldKey}` — the FactWriter must be idempotent on this key. */
  idempotencyKey: string;
}

// ------------------------------------------------------------------ turn input / output
export interface QuickReplyInput { value: string; intent: QuickReplyIntent }
export interface ConfirmActionInput { token: string; intent: "confirm" | "correct" }

export interface ProcessTurnInput {
  projectId: string;
  surface: Surface;
  scopeInstanceId: string;
  /** Client-generated, stable across retries (>= 8 chars, [A-Za-z0-9_.:-]). */
  turnKey: string;
  locale: Locale;
  text?: string;
  quickReply?: QuickReplyInput;
  confirmAction?: ConfirmActionInput;
}

export interface OpenThreadInput {
  projectId: string;
  surface: Surface;
  scopeInstanceId: string;
  locale: Locale;
}

/** Signals DOMAIN must persist (never shown to the client as such). */
export interface PendingSignal {
  kind: "country_claim_unverified" | "process_question_unanswered";
  fieldKey: string | null;
  note: string;
}

export interface WaitingHint { afterMs: number; key: "saved" | "reading" | "structuring" | "still_working" }

export interface TurnMeta {
  turnKind: TurnKind;
  topicKeys: string[];
  modelCalls: number;
  physicalModelCalls: number;
  usedFallbackCopy: boolean;
  copyKeys: string[];
  /** Per-turn timing, in ms, from the injected clock. */
  elapsedMs: number;
  /** Progressive-waiting stage hints: keys only, the UI owns the copy. */
  waitingHints: WaitingHint[];
  timeoutBudgetMs: number;
  replayed: boolean;
  providerImplementation: string;
}

export interface ProcessTurnResult extends TurnResultDto {
  /** Validated facts handed to the FactWriter during this turn (empty on replay, process turns and failures). */
  factsToWrite: CandidateFact[];
  pendingSignals: PendingSignal[];
  /** add_service: the need the client confirmed (DOMAIN classifies it). */
  confirmedServiceNeed: string | null;
  /** Present on ai_unavailable: localized notice the UI may show next to the retry affordance. */
  notice: { copyKey: string; text: string } | null;
  meta: TurnMeta;
}

export class ConversationInputError extends Error {
  readonly code: "INVALID_INPUT" | "NOT_WRITABLE";
  constructor(code: "INVALID_INPUT" | "NOT_WRITABLE", message: string) {
    super(message);
    this.name = "ConversationInputError";
    this.code = code;
  }
}
