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
  | "step_back_navigated";

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
    await api.events({ anonymousSessionId: anonymousSessionId(), events });
  } catch {
    // Analytics must never interrupt the assessment.
  }
}
