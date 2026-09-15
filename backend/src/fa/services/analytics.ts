import { Db } from "../../db/database";

/**
 * Journey analytics (Handoff v1 §22): technical ids, field keys, timestamps and enumerated
 * context only. No names, emails, company data or open-text content can enter an event — the
 * client payload is reduced to a strict whitelist before storage.
 */

export type ValueState = "answered" | "not_sure" | "cleared";

export interface JourneyEventInput {
  eventType: string;
  projectId?: string | null;
  anonymousSessionId?: string | null;
  stepId?: string | null;
  questionId?: string | null;
  fieldKey?: string | null;
  questionBankVersion?: string | null;
  interfaceLanguage?: string | null;
  durationMs?: number | null;
  valueState?: ValueState | null;
  clientOccurredAt?: Date | null;
  properties?: Record<string, string | number | boolean>;
}

/** Events the browser may report; everything else is recorded server-side only. */
export const CLIENT_EVENT_TYPES: ReadonlySet<string> = new Set([
  "assessment_entered",
  "assessment_started",
  "step_viewed",
  "question_viewed",
  "language_changed",
  "save_failed",
  "step_back_navigated",
  "snapshot_viewed",
  // Phase 9: the two post-Snapshot paths (no answer content, no personal data).
  "preview_room_clicked",
  "premium_continue_clicked",
  "premium_consideration_viewed",
  "premium_activation_viewed",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TECHNICAL_ID = /^[A-Za-z0-9_.-]{1,64}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export async function recordJourneyEvent(db: Db, event: JourneyEventInput): Promise<void> {
  await db.query(
    `INSERT INTO fa_journey_event (event_type, project_id, anonymous_session_id, step_id, question_id, field_key,
       question_bank_version, interface_language, duration_ms, value_state, client_occurred_at, properties)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
    [
      event.eventType,
      event.projectId ?? null,
      event.anonymousSessionId ?? null,
      event.stepId ?? null,
      event.questionId ?? null,
      event.fieldKey ?? null,
      event.questionBankVersion ?? null,
      event.interfaceLanguage ?? null,
      event.durationMs ?? null,
      event.valueState ?? null,
      event.clientOccurredAt ?? null,
      JSON.stringify(event.properties ?? {}),
    ],
  );
}

/**
 * Reduces an untrusted client event to the whitelist. Returns null for anything not allowed.
 * `knownIds` are the step/question ids of the relevant bundle — free-form strings are dropped.
 */
export function sanitizeClientEvent(
  raw: unknown,
  knownIds: { steps: ReadonlySet<string>; questions: ReadonlySet<string> },
): Omit<JourneyEventInput, "projectId" | "anonymousSessionId" | "questionBankVersion"> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.type !== "string" || !CLIENT_EVENT_TYPES.has(e.type)) return null;

  const stepId = typeof e.stepId === "string" && TECHNICAL_ID.test(e.stepId) && knownIds.steps.has(e.stepId) ? e.stepId : null;
  const questionId =
    typeof e.questionId === "string" && TECHNICAL_ID.test(e.questionId) && knownIds.questions.has(e.questionId) ? e.questionId : null;
  const durationMs =
    typeof e.durationMs === "number" && Number.isInteger(e.durationMs) && e.durationMs >= 0 && e.durationMs < 86_400_000
      ? e.durationMs
      : null;
  const interfaceLanguage = e.interfaceLanguage === "en" || e.interfaceLanguage === "es" ? e.interfaceLanguage : null;
  let clientOccurredAt: Date | null = null;
  if (typeof e.clientOccurredAt === "string") {
    const parsed = new Date(e.clientOccurredAt);
    if (!Number.isNaN(parsed.getTime())) clientOccurredAt = parsed;
  }

  const properties: Record<string, string | number | boolean> = {};
  const props = typeof e.properties === "object" && e.properties !== null ? (e.properties as Record<string, unknown>) : {};
  if (e.type === "language_changed" && (props.to === "en" || props.to === "es")) properties.to = props.to;
  if (e.type === "save_failed" && typeof props.attempts === "number" && Number.isInteger(props.attempts)) {
    properties.attempts = Math.min(Math.max(props.attempts, 0), 100);
  }

  return { eventType: e.type, stepId, questionId, durationMs, interfaceLanguage, clientOccurredAt, properties };
}
