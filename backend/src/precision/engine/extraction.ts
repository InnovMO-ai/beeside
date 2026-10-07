/**
 * Precision Engine — Extraction (Engine-Build Macroblock 2).
 *
 * FieldSpec-driven, schema/category/scope-agnostic extraction over gateway.ts.
 * Given an arbitrary list of field specs and a context text, asks the model for a
 * JSON object keyed by field name and returns one ExtractedField per requested
 * field, each carrying {value, confidence, source} and a three-state outcome:
 *
 *   - "ok"        — a value was found and safely coerced to the field's type.
 *   - "not_found"  — the model explicitly reports the context does not contain it.
 *   - "unresolved" — neither of the above: missing from the model's output, an
 *                    unrecognized per-field status, or a value that could not be
 *                    safely coerced (coerceValue never invents a value).
 *
 * A single retry is attempted, and only when the model's *output shape itself* is
 * unusable (unparseable JSON, or JSON that is not a field-keyed object) — never
 * when the gateway's whole chain is exhausted by network/HTTP/timeout failures,
 * and never a second time. Per-field coercion failures are reported as
 * "unresolved" on that field, not retried.
 *
 * This module calls gateway.ts only. It does not call guard.ts (that boundary is
 * client-input-only and is not this module's concern) and has no persistence,
 * category, or conversation-loop logic — those are out of scope for this
 * macroblock.
 *
 * New beeside implementation, written from the documented behavioral contract in
 * claude/beeside-ai-engine-architecture-validation-2026-10-01.md and
 * claude/precision-architecture-consultation-response-2026-10-01.md. Not a port
 * or copy of any prior system. CORRECTION (2026-10-06, Canon Patch #4): the AFP 3.0
 * (beta) source is available and was statically reviewed in Gate R1; see gateway.ts's
 * header correction and claude/precision-gate-r1-beta-reuse-matrix-2026-10-06.md
 * (verdict for this module: ADAPT). The invalidated historical completion reports
 * remain invalid (this module's
 * three-state outcome and coercion design were derived independently from the
 * frozen architecture docs' Extraction → Known facts / Missing facts mapping, not
 * from the invalidated reports' claimed export list).
 */

import { chatJSON, GatewayError, type ChatMessage, type GatewayConfig, type GatewayDeps } from "./gateway";

export type FieldType = "string" | "number" | "boolean" | "date" | "enum";

export interface FieldSpec {
  name: string;
  type: FieldType;
  /** Human-readable description shown to the model; also useful for logging/debugging. */
  description: string;
  /** Required and non-empty when type is "enum"; ignored otherwise. */
  enumValues?: string[];
}

export type ExtractionStatus = "ok" | "not_found" | "unresolved";

export interface ExtractedField {
  name: string;
  status: ExtractionStatus;
  value: string | number | boolean | null;
  confidence: number | null;
  source: string | null;
  /** Present only when status is "unresolved" — explains why. */
  reason?: string;
}

export interface ExtractionResult {
  fields: ExtractedField[];
  /** true when the single malformed-output-shape retry was used, regardless of whether it then succeeded. */
  attemptedRetry: boolean;
}

export type CoercionResult = { ok: true; value: string | number | boolean } | { ok: false };

/**
 * Coerces a raw model-supplied value to the field's declared type, when it is safe
 * to do so, and never invents a value otherwise. "Safe" means a lossless,
 * unambiguous conversion (e.g. the string "42" to the number 42; the number 42 to
 * the string "42"; a case-normalized enum match) — never a guess.
 */
export function coerceValue(type: FieldType, raw: unknown, enumValues?: string[]): CoercionResult {
  switch (type) {
    case "string": {
      if (typeof raw === "string") return { ok: true, value: raw };
      if (typeof raw === "number" && Number.isFinite(raw)) return { ok: true, value: String(raw) };
      if (typeof raw === "boolean") return { ok: true, value: String(raw) };
      return { ok: false };
    }
    case "number": {
      if (typeof raw === "number" && Number.isFinite(raw)) return { ok: true, value: raw };
      if (typeof raw === "string" && /^-?\d+(\.\d+)?$/.test(raw.trim())) return { ok: true, value: Number(raw.trim()) };
      return { ok: false };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (typeof raw === "string") {
        const normalized = raw.trim().toLowerCase();
        if (normalized === "true") return { ok: true, value: true };
        if (normalized === "false") return { ok: true, value: false };
      }
      return { ok: false };
    }
    case "date": {
      if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return { ok: true, value: raw.trim() };
      return { ok: false };
    }
    case "enum": {
      if (typeof raw !== "string" || !enumValues || enumValues.length === 0) return { ok: false };
      const exact = enumValues.find((v) => v === raw);
      if (exact !== undefined) return { ok: true, value: exact };
      const trimmedLower = raw.trim().toLowerCase();
      const caseInsensitive = enumValues.find((v) => v.toLowerCase() === trimmedLower);
      if (caseInsensitive !== undefined) return { ok: true, value: caseInsensitive };
      return { ok: false };
    }
    default:
      return { ok: false };
  }
}

function buildMessages(specs: FieldSpec[], context: string): ChatMessage[] {
  const fieldDescriptions = specs
    .map((spec) => {
      const typeNote = spec.type === "enum" && spec.enumValues?.length ? `One of: ${spec.enumValues.join(", ")}.` : `Type: ${spec.type}.`;
      return `- "${spec.name}": ${spec.description}. ${typeNote}`;
    })
    .join("\n");
  const systemPrompt =
    "You extract structured field values from the given context text. You never invent information that is " +
    "not present or clearly implied by the context. For each requested field, respond with exactly one JSON " +
    'object keyed by field name, where each value is an object: {"status":"found"|"not_found",' +
    '"value"?:<the value, matching the field\'s declared type>,"confidence"?:<a number from 0 to 1>,' +
    '"source"?:<a short quoted snippet from the context that supports this value>}. Use "not_found" when the ' +
    "context does not contain this information — do not guess. Respond with the JSON object only: no prose, " +
    `no code fences, no extra keys.\n\nFields to extract:\n${fieldDescriptions}`;
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: context },
  ];
}

type RequestOutcome =
  | { kind: "ok"; data: Record<string, unknown> }
  | { kind: "malformed_shape"; detail: string }
  | { kind: "unavailable"; detail: string };

async function requestOnce(
  specs: FieldSpec[],
  context: string,
  config: GatewayConfig,
  deps: GatewayDeps
): Promise<RequestOutcome> {
  const messages = buildMessages(specs, context);
  try {
    const result = await chatJSON<unknown>(messages, config, { temperature: 0 }, deps);
    if (typeof result.data !== "object" || result.data === null || Array.isArray(result.data)) {
      return { kind: "malformed_shape", detail: "Model JSON response was not a field-keyed object." };
    }
    return { kind: "ok", data: result.data as Record<string, unknown> };
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.kind === "not_configured") return { kind: "unavailable", detail: err.message };
      // chain_exhausted: a response that parsed to usable chat content but failed JSON.parse is a
      // malformed-output-shape case (eligible for the single retry); any other chain exhaustion
      // (network/HTTP/timeout across every target) is a genuine unavailability, not a shape problem.
      const hadInvalidJsonShape = err.attempts.some(
        (a) => a.errorCode === "invalid_response" && a.message.toLowerCase().includes("not valid json")
      );
      return hadInvalidJsonShape ? { kind: "malformed_shape", detail: err.message } : { kind: "unavailable", detail: err.message };
    }
    return { kind: "unavailable", detail: err instanceof Error ? err.message : String(err) };
  }
}

function resolveField(spec: FieldSpec, raw: unknown): ExtractedField {
  if (raw === undefined) {
    return { name: spec.name, status: "unresolved", value: null, confidence: null, source: null, reason: "Field missing from model output." };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { name: spec.name, status: "unresolved", value: null, confidence: null, source: null, reason: "Field entry was not an object." };
  }
  const entry = raw as Record<string, unknown>;
  const status = entry.status;

  if (status === "not_found") {
    return { name: spec.name, status: "not_found", value: null, confidence: null, source: null };
  }
  if (status !== "found") {
    return {
      name: spec.name,
      status: "unresolved",
      value: null,
      confidence: null,
      source: null,
      reason: `Unrecognized field status from model: ${JSON.stringify(status)}.`,
    };
  }

  const coerced = coerceValue(spec.type, entry.value, spec.enumValues);
  if (!coerced.ok) {
    return {
      name: spec.name,
      status: "unresolved",
      value: null,
      confidence: null,
      source: null,
      reason: `Value could not be safely coerced to type "${spec.type}": ${JSON.stringify(entry.value)}.`,
    };
  }

  const confidence = typeof entry.confidence === "number" && entry.confidence >= 0 && entry.confidence <= 1 ? entry.confidence : null;
  const source = typeof entry.source === "string" && entry.source.length > 0 ? entry.source : null;
  return { name: spec.name, status: "ok", value: coerced.value, confidence, source };
}

/**
 * Extracts every field in `specs` from `context`. Never throws: every requested
 * field is always represented in the result, falling back to "unresolved" with a
 * `reason` when the field can't be confidently resolved. Retries at most once,
 * and only for a malformed model-output shape.
 */
export async function extractFields(
  specs: FieldSpec[],
  context: string,
  config: GatewayConfig,
  deps: GatewayDeps = {}
): Promise<ExtractionResult> {
  let outcome = await requestOnce(specs, context, config, deps);
  let attemptedRetry = false;

  if (outcome.kind === "malformed_shape") {
    attemptedRetry = true;
    outcome = await requestOnce(specs, context, config, deps);
  }

  if (outcome.kind !== "ok") {
    const reason =
      outcome.kind === "unavailable"
        ? `Extraction gateway unavailable: ${outcome.detail}`
        : `Model output remained unusable after one retry: ${outcome.detail}`;
    return {
      fields: specs.map((spec) => ({ name: spec.name, status: "unresolved", value: null, confidence: null, source: null, reason })),
      attemptedRetry,
    };
  }

  const fields = specs.map((spec) => resolveField(spec, outcome.data[spec.name]));
  return { fields, attemptedRetry };
}
