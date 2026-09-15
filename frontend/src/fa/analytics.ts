import { api } from "./api";

// Journey analytics from the browser: technical ids only (step/question ids), no answer content,
// no personal data. Server-side events cover identity, saves, completion and lifecycle.

const ANON_KEY = "beeside.fa.anonymous_session";

export type ClientEventType =
  | "assessment_entered"
  | "assessment_started"
  | "step_viewed"
  | "question_viewed"
  | "language_changed"
  | "save_failed"
  | "step_back_navigated"
  | "snapshot_viewed"
  | "preview_room_clicked"
  | "premium_continue_clicked"
  | "premium_consideration_viewed"
  | "premium_activation_viewed";

export interface ClientEvent {
  type: ClientEventType;
  stepId?: string;
  questionId?: string;
  durationMs?: number;
  interfaceLanguage?: string;
  properties?: Record<string, string | number>;
}

function randomUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16),
  );
}

export function anonymousSessionId(): string {
  try {
    const existing = sessionStorage.getItem(ANON_KEY);
    if (existing) return existing;
    const id = randomUuid();
    sessionStorage.setItem(ANON_KEY, id);
    return id;
  } catch {
    return randomUuid();
  }
}

let queue: Array<ClientEvent & { clientOccurredAt: string }> = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let linkToken: string | null = null;

/**
 * Reading the Snapshot from the email link means there is no working session: the private link
 * identifies the project so those events are attributed instead of counted as anonymous.
 */
export function setAnalyticsLinkToken(token: string | null) {
  linkToken = token;
}

export function track(event: ClientEvent) {
  queue.push({ ...event, clientOccurredAt: new Date().toISOString() });
  if (!timer) timer = setTimeout(flush, 2000);
}

export async function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (queue.length === 0) return;
  const events = queue;
  queue = [];
  try {
    await api.events({ anonymousSessionId: anonymousSessionId(), linkToken, events });
  } catch {
    // Analytics must never interrupt the assessment.
  }
}
