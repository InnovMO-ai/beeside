/**
 * What an assistant turn remembers so the next turn can continue (stored in `precision_turn.structured`):
 * the pending question (resumed after process questions), the field being asked, a candidate or inherited value
 * awaiting confirmation, and the UI affordances (quick replies, confirm card).
 */
import type { ConfirmCardDto, QuickReplyDto, TurnDto } from "../api/dto";
import type { StoredTurn } from "./ports";
import type { InheritedValue } from "./types";

export type PendingMode = "ask" | "prefill_confirm" | "candidate_confirm" | "ask_correction" | "need" | "need_confirm" | "review" | "closed";

export interface PendingCandidate {
  fieldKey: string;
  subKey?: string;
  itemIndex?: number;
  value: unknown;
  valueType: string;
  supersedes: boolean;
  provenance: "ai_extracted" | "client_answered";
  confidence: number | null;
  displayText: string;
}

export interface PendingState {
  mode: PendingMode;
  /** Top-level requirement being asked (engine's nextFieldKey) or null. */
  fieldKey: string | null;
  subKey?: string;
  itemIndex?: number;
  /** The exact question text shown to the client (resumed verbatim after a process answer). */
  pendingQuestion: string | null;
  candidate?: PendingCandidate;
  inherited?: InheritedValue;
  /** add_service: the need awaiting confirmation. */
  need?: string;
  confirmToken?: string;
  clarifyCount?: number;
}

export interface AssistantStructured {
  state?: PendingState;
  quickReplies?: QuickReplyDto[];
  confirmCard?: ConfirmCardDto;
  /** A country guide offered in this turn (opened through the resource resolver; the link itself is Admin configuration). */
  resourceOffer?: { id: string; title: string };
  topicKeys?: string[];
  packVersion?: string;
  factIds?: string[];
  sourceRefs?: string[];
  copyKeys?: string[];
  usedFallback?: boolean;
  modelCalls?: number;
  [k: string]: unknown;
}

export function structuredOf(row: StoredTurn | null | undefined): AssistantStructured {
  return (row?.structured ?? {}) as AssistantStructured;
}

export function stateOf(row: StoredTurn | null | undefined): PendingState | null {
  const s = structuredOf(row).state;
  return s && typeof s === "object" && typeof s.mode === "string" ? s : null;
}

/** The most recent assistant turn that carries a pending state (skips disclosure/notice turns). */
export function lastPending(thread: readonly StoredTurn[]): { row: StoredTurn; state: PendingState } | null {
  for (let i = thread.length - 1; i >= 0; i--) {
    const row = thread[i] as StoredTurn;
    if (row.role !== "assistant") continue;
    const st = stateOf(row);
    if (st) return { row, state: st };
  }
  return null;
}

export function toTurnDto(row: StoredTurn): TurnDto {
  const st = structuredOf(row);
  return {
    id: row.id,
    role: row.role,
    kind: row.kind,
    text: row.content,
    createdAt: row.createdAt.toISOString(),
    ...(st.quickReplies && st.quickReplies.length > 0 ? { quickReplies: st.quickReplies } : {}),
    ...(st.confirmCard ? { confirmCard: st.confirmCard } : {}),
    ...(st.resourceOffer ? { resourceOffer: st.resourceOffer } : {}),
  };
}
