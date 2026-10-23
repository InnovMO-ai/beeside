/**
 * Precision analytics (Build Readiness §F). One helper, `emitEvent`, writes `precision_journey_event` with
 * `ON CONFLICT (event_key) DO NOTHING`: an event fires exactly once per key, in the SAME transaction as the state
 * change that originates it (call it with the transaction's `Db`; a rollback leaves no event).
 *
 * Events carry technical identifiers and counters only: never answers, free text, names or e-mail. `properties` is
 * therefore reduced to short primitives; anything else is dropped before it is written.
 */
import type { Db } from "../../db/database";

/** The 19 Precision events (`premium_activated` is Core's and is not emitted here). */
export const PRECISION_EVENTS = [
  "precision_started",
  "understanding_started",
  "understanding_resumed",
  "my_service_map_ready",
  "my_service_map_confirmed",
  "category_started",
  "category_progress_changed",
  "critical_item_created",
  "critical_item_resolved",
  "add_service_started",
  "add_service_completed",
  "possible_new_service_detected",
  "possible_new_service_category_proposed",
  "crp_ready_for_review",
  "crp_change_requested",
  "crp_confirmed",
  "handoff_previewed",
  "operation_hub_send_completed",
  "operation_hub_activated",
] as const;
export type PrecisionEventName = (typeof PRECISION_EVENTS)[number];

export type EventPropertyValue = string | number | boolean | null;

export interface EmitEventInput {
  /** snake_case event name (one of PRECISION_EVENTS in practice; the table only enforces the shape). */
  name: string;
  /** Deduplication key: the same key never produces a second row. */
  eventKey: string;
  projectId: string;
  /** Technical properties only (ids, counters, category keys). Non-primitive values are dropped. */
  properties?: Record<string, unknown>;
  locale?: string;
}

const MAX_PROPERTY_TEXT = 120;
const MAX_KEY = 400;

function safeProperties(properties: Record<string, unknown> | undefined): Record<string, EventPropertyValue> {
  const out: Record<string, EventPropertyValue> = {};
  for (const [k, v] of Object.entries(properties ?? {})) {
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(k)) continue;
    if (v === null || typeof v === "boolean") out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, MAX_PROPERTY_TEXT);
  }
  return out;
}

/** Writes the event once; returns true when this call inserted it (false when the key already existed). */
export async function emitEvent(db: Db, input: EmitEventInput): Promise<boolean> {
  if (!input.eventKey || input.eventKey.length > MAX_KEY) throw new Error("emitEvent: eventKey must be 1..400 characters");
  const locale = input.locale === "en" || input.locale === "es" ? input.locale : null;
  const { rowCount } = await db.query(
    `INSERT INTO precision_journey_event (event_name, event_key, project_id, interface_language, properties)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (event_key) DO NOTHING`,
    [input.name, input.eventKey, input.projectId, locale, JSON.stringify(safeProperties(input.properties))],
  );
  return (rowCount ?? 0) > 0;
}
