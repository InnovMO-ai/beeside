import { QuestionDef } from "./bundle-types";
import { AnswerMap } from "./conditions";
import { ISO_COUNTRY_CODES } from "./iso-countries";
import { dynamicOptionValues } from "./journey";

export type ValidationResult = { ok: true; value: unknown } | { ok: false; error: string };

const DEFAULT_TEXT_MAX = 4000;
const SHORT_TEXT_MAX = 200;
const NOT_SURE_VALUES = new Set(["not_sure", "not_sure_required"]);

/**
 * Validates a submitted answer for a question and returns the canonical value to store.
 * `null` clears an optional answer (stored as JSON null — the append-only history is kept).
 * Open text is stored verbatim; it is only checked for type and length, never interpreted.
 */
export function validateAnswerValue(question: QuestionDef, value: unknown, effective: AnswerMap): ValidationResult {
  if (value === null) {
    return question.required ? { ok: false, error: "an answer is required" } : { ok: true, value: null };
  }
  switch (question.type) {
    case "single_select":
    case "locale": {
      const allowed = dynamicOptionValues(question, effective);
      if (typeof value !== "string" || !allowed.includes(value)) return { ok: false, error: "value is not an allowed option" };
      return { ok: true, value };
    }
    case "multi_select": {
      const allowed = dynamicOptionValues(question, effective);
      if (!Array.isArray(value) || value.length === 0) return { ok: false, error: "select at least one option" };
      if (value.some((v) => typeof v !== "string" || !allowed.includes(v))) return { ok: false, error: "value is not an allowed option" };
      if (new Set(value).size !== value.length) return { ok: false, error: "duplicate option" };
      const exclusive = question.exclusive_values ?? [];
      if (value.length > 1 && value.some((v) => exclusive.includes(v))) {
        return { ok: false, error: "this option cannot be combined with others" };
      }
      return { ok: true, value: allowed.filter((v) => value.includes(v)) };
    }
    case "text":
    case "short_text": {
      const max = question.max_length ?? (question.type === "short_text" ? SHORT_TEXT_MAX : DEFAULT_TEXT_MAX);
      if (typeof value !== "string" || value.trim() === "") return { ok: false, error: "text is required" };
      if (value.length > max) return { ok: false, error: `text must be at most ${max} characters` };
      return { ok: true, value };
    }
    case "country_list": {
      if (!Array.isArray(value) || value.length === 0 || value.length > 30) return { ok: false, error: "select between 1 and 30 countries" };
      if (value.some((v) => typeof v !== "string" || !ISO_COUNTRY_CODES.has(v))) return { ok: false, error: "unknown country code" };
      if (new Set(value).size !== value.length) return { ok: false, error: "duplicate country" };
      return { ok: true, value };
    }
    case "timing":
      return validateTiming(value);
    case "quantity":
      return validateQuantity(question, value);
    default:
      return { ok: false, error: "unsupported question type" };
  }
}

function validateTiming(value: unknown): ValidationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, error: "invalid timing" };
  const { precision, value: raw } = value as { precision?: unknown; value?: unknown };
  if (precision === "not_sure") return { ok: true, value: { precision, value: null } };
  if (typeof raw !== "string") return { ok: false, error: "invalid timing" };
  const inRange = (year: number) => year >= 2000 && year <= 2100;
  if (precision === "date") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!m) return { ok: false, error: "invalid date" };
    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    if (!inRange(year) || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return { ok: false, error: "invalid date" };
    return { ok: true, value: { precision, value: raw } };
  }
  if (precision === "month") {
    const m = /^(\d{4})-(\d{2})$/.exec(raw);
    if (!m || !inRange(Number(m[1])) || Number(m[2]) < 1 || Number(m[2]) > 12) return { ok: false, error: "invalid month" };
    return { ok: true, value: { precision, value: raw } };
  }
  if (precision === "quarter") {
    const m = /^(\d{4})-Q([1-4])$/.exec(raw);
    if (!m || !inRange(Number(m[1]))) return { ok: false, error: "invalid quarter" };
    return { ok: true, value: { precision, value: raw } };
  }
  return { ok: false, error: "invalid timing precision" };
}

function validateQuantity(question: QuestionDef, value: unknown): ValidationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, error: "invalid quantity" };
  const { amount, unit, not_sure: notSure } = value as { amount?: unknown; unit?: unknown; not_sure?: unknown };
  if (notSure === true) return { ok: true, value: { not_sure: true } };
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 1e12) {
    return { ok: false, error: "amount must be a positive number" };
  }
  if (typeof unit !== "string" || unit.trim() === "" || unit.length > 40) return { ok: false, error: "unit is required" };
  if (question.units && !question.units.some((u) => u.value === unit)) return { ok: false, error: "unit is not an allowed option" };
  return { ok: true, value: { amount, unit } };
}

/** Explicit uncertainty (valid, normal answer) — used for analytics and Precision open questions. */
export function isNotSureValue(value: unknown): boolean {
  if (typeof value === "string") return NOT_SURE_VALUES.has(value);
  if (Array.isArray(value)) return value.some((v) => NOT_SURE_VALUES.has(String(v)));
  if (typeof value === "object" && value !== null) {
    const v = value as { precision?: unknown; not_sure?: unknown };
    return v.precision === "not_sure" || v.not_sure === true;
  }
  return false;
}
