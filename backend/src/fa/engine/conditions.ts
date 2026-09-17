import { Condition } from "./bundle-types";

export type AnswerMap = ReadonlyMap<string, unknown>;

export function isAnswered(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Collects every field key a condition reads (used to validate that references point backwards). */
export function conditionFields(condition: Condition): string[] {
  if ("all" in condition) return condition.all.flatMap(conditionFields);
  if ("any" in condition) return condition.any.flatMap(conditionFields);
  if ("not" in condition) return conditionFields(condition.not);
  return [condition.field];
}

/**
 * `includes_any` normally reads a multi_select-style array answer. Level 2 MVP: it also accepts a
 * `needs_map` answer directly (its own field_key, e.g. `fa.needs.map`, never a synthetic derived
 * key) — a NeedsMapValue is not an array, but "was leaf X selected" is exactly the same question a
 * multi_select's `includes_any` already answers, just against `value.selections[].key` instead of
 * a flat array. This lets Needs-Explorer-gated follow-up questions (questions-needs-followups.ts)
 * use the same `when.includes(field, leafKey)` helper as every other conditional question, with no
 * new condition operator and no change to conditionFields()/validate-bundle.ts's "read before
 * asked" check (the field is still the real, previously-asked fa.needs.map field_key).
 */
function includesAnyValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value && typeof value === "object" && Array.isArray((value as { selections?: unknown }).selections)) {
    return (value as { selections: Array<{ key: unknown }> }).selections.map((s) => String(s.key));
  }
  return [];
}

/**
 * Evaluates a condition against effective answers. An unanswered field never satisfies a
 * positive test (eq / in / includes_any / answered / count) nor a negative one (neq / not_in):
 * applicability must be earned by something the respondent actually declared.
 */
export function evaluateCondition(condition: Condition, answers: AnswerMap): boolean {
  if ("all" in condition) return condition.all.every((c) => evaluateCondition(c, answers));
  if ("any" in condition) return condition.any.some((c) => evaluateCondition(c, answers));
  if ("not" in condition) return !evaluateCondition(condition.not, answers);

  const value = answers.get(condition.field);
  if (condition.op === "answered") return isAnswered(value);
  if (!isAnswered(value)) return false;

  switch (condition.op) {
    case "eq":
      return value === condition.value;
    case "neq":
      return typeof value === "string" && value !== condition.value;
    case "in":
      return typeof value === "string" && condition.values.includes(value);
    case "not_in":
      return typeof value === "string" && !condition.values.includes(value);
    case "includes_any":
      return includesAnyValues(value).some((v) => condition.values.includes(v));
    case "selected_count_gte": {
      if (!Array.isArray(value)) return false;
      const exclude = condition.exclude ?? [];
      return value.filter((v) => !exclude.includes(String(v))).length >= condition.value;
    }
    default:
      return false;
  }
}
