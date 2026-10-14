import type { Db } from "../db/database";
import { recordJourneyEvent } from "../fa/services/analytics";
import { emitEvent } from "../precision/domain/events";

/**
 * V1.0 analytics catalog (Delta Review §6). Every event added for the commercial, funnel, AI-experience and Operation Hub families is
 * declared HERE with the exact properties it may carry, and can only be written through `emitV1Event`.
 *
 * The contract is closed on purpose: a property is either an enumerated code, a bounded counter or a flag. There is no free-text kind, so
 * an e-mail address, a name, a reason typed by an operator or a sentence from a conversation cannot be expressed as an event property.
 * Outside tests a property that violates its spec is dropped (analytics must never break a business flow); under NODE_ENV=test it throws,
 * so a call site that drifts from the catalog fails its own test.
 *
 * Channels: `core` events go to `fa_journey_event` (project optional: programs and company agreements have no single project);
 * `precision` events go to `precision_journey_event` (project required, exactly-once by event key).
 */
type PropSpec = { kind: "enum"; values: readonly string[] } | { kind: "count"; max: number } | { kind: "flag" };

interface EventSpec {
  channel: "core" | "precision";
  /** Who writes it today: "emitted" = wired in code; "defined" = reserved for the product layer that creates the behaviour (Fase 1). */
  status: "emitted" | "defined";
  properties: Record<string, PropSpec>;
}

const enumOf = (...values: string[]): PropSpec => ({ kind: "enum", values });
const count = (max = 100_000): PropSpec => ({ kind: "count", max });

const GRANT_SOURCES = enumOf("complimentary", "promotion", "trial", "manual", "partner", "sponsored");
const ACCESS_MODES = enumOf("FULL", "READ_ONLY", "REVOKED");
const LATENCY_BUCKETS = enumOf("lt_2s", "2_5s", "5_10s", "10_20s", "gte_20s");
const SURFACES = enumOf("understanding", "category");

export const V1_EVENTS = {
  // ---- Commercial / entitlement (Core) ----
  entitlement_granted: { channel: "core", status: "emitted", properties: { source_type: GRANT_SOURCES, scope: enumOf("project", "company"), program_kind: enumOf("none", "promotion", "trial", "partner", "sponsored"), chained: { kind: "flag" } } },
  entitlement_extended: { channel: "core", status: "emitted", properties: { source_type: GRANT_SOURCES } },
  entitlement_ended: { channel: "core", status: "emitted", properties: { reason_code: enumOf("terminated_early", "period_elapsed", "window_closed") } },
  entitlement_mode_changed: { channel: "core", status: "emitted", properties: { from_mode: ACCESS_MODES, to_mode: ACCESS_MODES } },
  program_activated: { channel: "core", status: "emitted", properties: { program_kind: enumOf("promotion", "trial", "partner", "sponsored") } },
  program_closed: { channel: "core", status: "emitted", properties: { program_kind: enumOf("promotion", "trial", "partner", "sponsored") } },
  program_redeemed: { channel: "core", status: "emitted", properties: { program_kind: enumOf("promotion", "trial", "partner", "sponsored") } },
  privacy_block_applied: { channel: "core", status: "emitted", properties: { privacy_event: enumOf("access_blocked", "anonymized"), reason_code: enumOf("erasure_request", "legal_order", "contract_closure", "security_action", "other") } },

  // ---- Operation Hub (Precision) ----
  operation_hub_send_failed: { channel: "precision", status: "emitted", properties: { error_class: enumOf("needs_attention", "try_again_later", "unavailable"), retryable: { kind: "flag" }, attempt: count(50) } },
  operation_hub_send_retried: { channel: "precision", status: "emitted", properties: { attempt: count(50) } },

  // ---- AI / experience (Precision) ----
  ai_turn_completed: { channel: "precision", status: "emitted", properties: { surface: SURFACES, status: enumOf("ok", "ai_unavailable"), latency_bucket: LATENCY_BUCKETS } },
  ai_fallback_used: { channel: "precision", status: "defined", properties: { surface: SURFACES, model_tier: enumOf("primary", "secondary", "tertiary") } },
  understanding_depth_reached: { channel: "precision", status: "defined", properties: { level: enumOf("minimal", "sufficient", "deep") } },
  turn_class_detected: { channel: "precision", status: "defined", properties: { answer_class: enumOf("fact", "meta_comment", "noise", "ambiguous", "question") } },
  service_need_routed: { channel: "precision", status: "defined", properties: { route: enumOf("known", "unknown_legit", "ambiguous", "noise") } },
  service_map_corrected: { channel: "precision", status: "defined", properties: { field_type: enumOf("name", "description", "status", "removed", "added") } },
  client_priority_set: { channel: "precision", status: "defined", properties: { rank_count: count(100) } },

  // ---- Funnel bridge FA -> Precision (Core) ----
  context_pinned: { channel: "core", status: "defined", properties: { context_version: count(10_000) } },
} as const satisfies Record<string, EventSpec>;

export type V1EventName = keyof typeof V1_EVENTS;

export interface EmitV1Input {
  projectId?: string | null;
  /** Precision channel only: exactly-once key (same key, no second row). */
  eventKey?: string;
  locale?: string;
  properties?: Record<string, string | number | boolean>;
}

type Clean = Record<string, string | number | boolean>;

/** Reduces the properties to the catalog spec. Returns the clean map and the names of the properties that were refused. */
export function conformProperties(name: V1EventName, properties: Record<string, unknown> | undefined): { clean: Clean; refused: string[] } {
  const spec = V1_EVENTS[name].properties as Record<string, PropSpec>;
  const clean: Clean = {};
  const refused: string[] = [];
  for (const [key, value] of Object.entries(properties ?? {})) {
    const rule = spec[key];
    const ok =
      rule !== undefined &&
      ((rule.kind === "enum" && typeof value === "string" && rule.values.includes(value)) ||
        (rule.kind === "count" && typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= rule.max) ||
        (rule.kind === "flag" && typeof value === "boolean"));
    if (ok) clean[key] = value as string | number | boolean;
    else refused.push(key);
  }
  return { clean, refused };
}

export class AnalyticsContractError extends Error {
  constructor(event: string, refused: string[]) {
    super(`analytics event ${event}: properties outside the catalog contract: ${refused.join(", ")}`);
    this.name = "AnalyticsContractError";
  }
}

/** Writes a catalogued event. Returns true when a row was written (always true for core events). */
export async function emitV1Event(db: Db, name: V1EventName, input: EmitV1Input = {}): Promise<boolean> {
  const { clean, refused } = conformProperties(name, input.properties);
  if (refused.length > 0 && process.env.NODE_ENV === "test") throw new AnalyticsContractError(name, refused);
  const spec = V1_EVENTS[name];
  if (spec.channel === "core") {
    await recordJourneyEvent(db, { eventType: name, projectId: input.projectId ?? null, properties: clean, ...(input.locale === "en" || input.locale === "es" ? { interfaceLanguage: input.locale } : {}) });
    return true;
  }
  if (!input.projectId || !input.eventKey) throw new Error(`analytics event ${name} needs projectId and eventKey`);
  return emitEvent(db, { name, eventKey: input.eventKey, projectId: input.projectId, properties: clean, ...(input.locale ? { locale: input.locale } : {}) });
}

/** Never lets analytics break the business flow that triggered it. */
export async function emitV1EventSafe(db: Db, name: V1EventName, input: EmitV1Input = {}): Promise<void> {
  try {
    await emitV1Event(db, name, input);
  } catch (error) {
    if (error instanceof AnalyticsContractError) throw error;
    // swallowed on purpose: the event is lost, the client's action is not
  }
}

export function latencyBucket(ms: number): "lt_2s" | "2_5s" | "5_10s" | "10_20s" | "gte_20s" {
  if (ms < 2_000) return "lt_2s";
  if (ms < 5_000) return "2_5s";
  if (ms < 10_000) return "5_10s";
  if (ms < 20_000) return "10_20s";
  return "gte_20s";
}
