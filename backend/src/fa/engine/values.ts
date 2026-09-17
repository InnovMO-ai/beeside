import type { QuestionDef } from "./bundle-types";
import { AnswerMap } from "./conditions";
import { ISO_COUNTRY_CODES } from "./iso-countries";
import { dynamicOptionValues } from "./journey";
import { isKnownNeedsLeaf } from "../content/needs-explorer-taxonomy";
import { NEEDS_MAP_LIMITS, NeedsMapValue, NEEDS_MAP_STATUSES } from "./needs-map-types";

export type ValidationResult = { ok: true; value: unknown } | { ok: false; error: string };

const DEFAULT_TEXT_MAX = 4000;
const SHORT_TEXT_MAX = 200;
const DEFAULT_COUNTRY_MAX = 30;
const DEFAULT_TAG_MAX = 20;
const DEFAULT_TAG_LENGTH_MAX = 200;
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
      if (question.max_select !== undefined && value.length > question.max_select) {
        return { ok: false, error: `select at most ${question.max_select} options` };
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
      const max = question.max_count ?? DEFAULT_COUNTRY_MAX;
      if (!Array.isArray(value) || value.length === 0 || value.length > max) return { ok: false, error: `select between 1 and ${max} countries` };
      if (value.some((v) => typeof v !== "string" || !ISO_COUNTRY_CODES.has(v))) return { ok: false, error: "unknown country code" };
      if (new Set(value).size !== value.length) return { ok: false, error: "duplicate country" };
      return { ok: true, value };
    }
    case "timing":
      return validateTiming(value);
    case "quantity":
      return validateQuantity(question, value);
    case "tag_list":
      return validateTagList(question, value);
    case "needs_map":
      return validateNeedsMap(value);
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

/** tag_list: a free-text list (e.g. fa.provider.restricted_counterparties). Entries are stored
 *  verbatim (trimmed), never interpreted — same "open text, never parsed" rule as `text`/`short_text`. */
function validateTagList(question: QuestionDef, value: unknown): ValidationResult {
  if (!Array.isArray(value)) return { ok: false, error: "invalid list" };
  const maxTags = question.max_tags ?? DEFAULT_TAG_MAX;
  const maxLength = question.max_tag_length ?? DEFAULT_TAG_LENGTH_MAX;
  if (value.length > maxTags) return { ok: false, error: `at most ${maxTags} entries are allowed` };
  const tags: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") return { ok: false, error: "each entry must be text" };
    const tag = raw.trim();
    if (tag === "" || tag.length > maxLength) return { ok: false, error: `each entry must be 1-${maxLength} characters` };
    tags.push(tag);
  }
  if (new Set(tags.map((t) => t.toLowerCase())).size !== tags.length) return { ok: false, error: "duplicate entry" };
  if (value.length === 0 && question.required) return { ok: false, error: "at least one entry is required" };
  return { ok: true, value: tags };
}

/**
 * needs_map: the Needs Explorer / PriorityRanker / DependencyMap composite (see needs-map-types.ts
 * for the full shape and the two structural invariants this enforces:
 *   1. category selection and status are independent facts (every selection carries its own status,
 *      no derived/implied status);
 *   2. priorityRank and dependencies are built ONLY over already-selected keys — the Needs Explorer
 *      is never re-asked, per the Ranking & Dependency Interaction section.
 * Every leaf key must resolve against the canonical taxonomy (needs-explorer-taxonomy.ts) — this is
 * the one place that check happens, so a customer-facing key can never silently drift from the
 * canonical capability_taxonomy_category mapping.
 */
function validateNeedsMap(value: unknown): ValidationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, error: "invalid needs map" };
  const raw = value as Partial<NeedsMapValue>;

  if (!Array.isArray(raw.selections)) return { ok: false, error: "selections must be a list" };
  if (raw.selections.length > NEEDS_MAP_LIMITS.maxSelections) return { ok: false, error: `at most ${NEEDS_MAP_LIMITS.maxSelections} needs may be selected` };
  const seenKeys = new Set<string>();
  for (const selection of raw.selections) {
    if (typeof selection !== "object" || selection === null) return { ok: false, error: "invalid selection" };
    const { key, status } = selection as { key?: unknown; status?: unknown };
    if (typeof key !== "string" || !isKnownNeedsLeaf(key)) return { ok: false, error: `unknown need key: ${String(key)}` };
    if (seenKeys.has(key)) return { ok: false, error: `duplicate need key: ${key}` };
    seenKeys.add(key);
    if (typeof status !== "string" || !(NEEDS_MAP_STATUSES as readonly string[]).includes(status)) {
      return { ok: false, error: `invalid status for ${key}` };
    }
  }

  const priorityRank = raw.priorityRank ?? [];
  if (!Array.isArray(priorityRank)) return { ok: false, error: "priorityRank must be a list" };
  if (priorityRank.length > NEEDS_MAP_LIMITS.maxPriorityRank) return { ok: false, error: `at most ${NEEDS_MAP_LIMITS.maxPriorityRank} priorities may be ranked` };
  if (new Set(priorityRank).size !== priorityRank.length) return { ok: false, error: "duplicate entry in priorityRank" };
  for (const key of priorityRank) {
    if (typeof key !== "string" || !seenKeys.has(key)) return { ok: false, error: `priorityRank references an unselected need: ${String(key)}` };
  }
  const priorities = new Set(priorityRank as string[]);

  const dependencies = raw.dependencies ?? [];
  if (!Array.isArray(dependencies)) return { ok: false, error: "dependencies must be a list" };
  const dependencyByKey = new Map<string, string | null>();
  for (const dependency of dependencies) {
    if (typeof dependency !== "object" || dependency === null) return { ok: false, error: "invalid dependency" };
    const { key, dependsOn, owner, approvalRequired, approvalFrom } = dependency as {
      key?: unknown; dependsOn?: unknown; owner?: unknown; approvalRequired?: unknown; approvalFrom?: unknown;
    };
    if (typeof key !== "string" || !priorities.has(key)) return { ok: false, error: `dependency references a non-prioritized need: ${String(key)}` };
    if (dependencyByKey.has(key)) return { ok: false, error: `duplicate dependency entry for ${key}` };
    if (dependsOn !== null && (typeof dependsOn !== "string" || !priorities.has(dependsOn) || dependsOn === key)) {
      return { ok: false, error: `invalid dependsOn for ${key}` };
    }
    if (owner !== null && owner !== undefined && (typeof owner !== "string" || owner.length > NEEDS_MAP_LIMITS.maxFreeTextLength)) {
      return { ok: false, error: `invalid owner for ${key}` };
    }
    if (typeof approvalRequired !== "boolean") return { ok: false, error: `approvalRequired must be a boolean for ${key}` };
    if (approvalFrom !== null && approvalFrom !== undefined && (typeof approvalFrom !== "string" || approvalFrom.length > NEEDS_MAP_LIMITS.maxFreeTextLength)) {
      return { ok: false, error: `invalid approvalFrom for ${key}` };
    }
    dependencyByKey.set(key, (dependsOn as string | null) ?? null);
  }
  // Guided prompts build a simple predecessor chain, never a free-form graph — a cycle would mean
  // the client-declared priority order and the dependency order contradict each other structurally.
  for (const start of dependencyByKey.keys()) {
    let current: string | null = start;
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current)) return { ok: false, error: `dependency cycle detected at ${start}` };
      visited.add(current);
      current = dependencyByKey.get(current) ?? null;
    }
  }

  const blockerKeys = raw.blockerKeys ?? [];
  if (!Array.isArray(blockerKeys)) return { ok: false, error: "blockerKeys must be a list" };
  for (const key of blockerKeys) {
    if (typeof key !== "string" || !priorities.has(key)) return { ok: false, error: `blockerKeys references a non-prioritized need: ${String(key)}` };
  }
  if (new Set(blockerKeys).size !== blockerKeys.length) return { ok: false, error: "duplicate entry in blockerKeys" };

  const normalized: NeedsMapValue = {
    selections: raw.selections as NeedsMapValue["selections"],
    priorityRank: priorityRank as string[],
    dependencies: dependencies as NeedsMapValue["dependencies"],
    blockerKeys: blockerKeys as string[],
  };
  return { ok: true, value: normalized };
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
