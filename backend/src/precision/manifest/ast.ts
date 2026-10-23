/**
 * Closed, declarative rule AST used by `applicability_rule`, `critical_decisions[].resolution_rule` and
 * `operational_pending_items[].applicability_rule`.
 *
 * = the Macroblock 4 base set (critical-decisions.ts, reused unchanged for its leaf operators) + the additive set E1
 * (field_contains, group_any_item_equals, group_any_item_in, group_any_item_differs) + the F5 semantic rules:
 *   - ASSUMED counts as answered for rule evaluation (a value was given), like WITHHELD does in the base set;
 *   - item values inside a repeatable_group may be bare values or `{ answer_state, value }` envelopes: item operators
 *     look through the envelope;
 *   - `field_asked` on a field that is NOT_APPLICABLE is vacuously true (G-C3): the readiness engine masks
 *     inapplicable fields with `answerState = "NOT_APPLICABLE"`, which is "not NOT_ASKED".
 *
 * Pure and total: no eval, no regular expressions authored by content, no I/O, never throws on missing facts.
 */
import {
  evaluateResolutionRule,
  referencedFieldKeys,
  validateResolutionRule,
  type FactLookup,
  type FieldAnswerState,
  type ResolutionRule,
} from "../critical-decisions";
import type { AnswerState } from "./types";

export type BaseLeafRule = Exclude<ResolutionRule, { op: "and" } | { op: "or" } | { op: "not" }>;

export type E1Rule =
  | { op: "field_contains"; field_key: string; value: unknown }
  | { op: "group_any_item_equals"; field_key: string; item_field_key: string; value: unknown }
  | { op: "group_any_item_in"; field_key: string; item_field_key: string; values: unknown[] }
  | { op: "group_any_item_differs"; field_key: string; item_field_a: string; item_field_b: string };

export type Rule = BaseLeafRule | E1Rule | { op: "and"; rules: Rule[] } | { op: "or"; rules: Rule[] } | { op: "not"; rule: Rule };

export const E1_OPS = ["field_contains", "group_any_item_equals", "group_any_item_in", "group_any_item_differs"] as const;

/** Facts as the AST sees them: keyed by manifest field_key (no "precision." prefix). */
export type RuleFacts = Readonly<Record<string, { value: unknown; answerState: AnswerState } | undefined>>;

const MAX_DEPTH = 20;

// ASSUMED -> ANSWERED for the base evaluator (which predates ASSUMED). Only the fields the leaf names are copied, so
// facts maps may be mutated by the caller between evaluations (no caching on object identity).
function toLookup(facts: RuleFacts, keys: string[]): FactLookup {
  const out: Record<string, { answerState: FieldAnswerState; value: unknown } | undefined> = {};
  for (const key of keys) {
    const fact = facts[key];
    if (!fact) continue;
    out[key] = { value: fact.value, answerState: fact.answerState === "ASSUMED" ? "ANSWERED" : fact.answerState };
  }
  return out;
}

const ANSWERED: ReadonlySet<AnswerState> = new Set<AnswerState>(["ANSWERED", "EXPLICIT_NO", "ZERO", "WITHHELD", "ASSUMED"]);
const answered = (f: { answerState: AnswerState } | undefined): boolean => f !== undefined && ANSWERED.has(f.answerState);
const jsonEq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Items of a repeatable_group fact (the whole array is the fact value). */
function itemsOf(fact: { value: unknown } | undefined): Array<Record<string, unknown> | null> {
  return fact && Array.isArray(fact.value) ? (fact.value as Array<Record<string, unknown> | null>) : [];
}

/** Unwraps `{ answer_state, value }` envelopes; bare values pass through. */
export function unwrapItemValue(v: unknown): unknown {
  return v !== null && typeof v === "object" && !Array.isArray(v) && "answer_state" in (v as object) ? (v as { value?: unknown }).value : v;
}
const itemValue = (item: Record<string, unknown> | null, key: string): unknown => (item ? unwrapItemValue(item[key]) : undefined);

export function evaluateRule(rule: Rule, facts: RuleFacts): boolean {
  switch (rule.op) {
    case "and":
      return rule.rules.every((r) => evaluateRule(r, facts));
    case "or":
      return rule.rules.some((r) => evaluateRule(r, facts));
    case "not":
      return !evaluateRule(rule.rule, facts);
    case "field_contains": {
      const f = facts[rule.field_key];
      return answered(f) && Array.isArray(f?.value) && f.value.some((x) => jsonEq(x, rule.value));
    }
    case "group_any_item_equals":
      return itemsOf(facts[rule.field_key]).some((it) => jsonEq(itemValue(it, rule.item_field_key), rule.value));
    case "group_any_item_in":
      return itemsOf(facts[rule.field_key]).some((it) => {
        const v = itemValue(it, rule.item_field_key);
        return rule.values.some((x) => jsonEq(v, x));
      });
    case "group_any_item_differs":
      return itemsOf(facts[rule.field_key]).some((it) => {
        const a = itemValue(it, rule.item_field_a);
        const b = itemValue(it, rule.item_field_b);
        return a !== undefined && b !== undefined && a !== null && b !== null && !jsonEq(a, b);
      });
    case "group_item_text_matches_any": {
      const needles = rule.keywords.map((k) => k.toLowerCase());
      return itemsOf(facts[rule.field_key]).some((it) => {
        const text = itemValue(it, rule.item_field_key);
        return typeof text === "string" && needles.some((n) => text.toLowerCase().includes(n));
      });
    }
    default:
      // field_answered / field_not_answered / field_equals / field_in / field_asked / field_not_asked / group_min_items
      return evaluateResolutionRule(rule, toLookup(facts, referencedFieldKeys(rule)));
  }
}

/** Structural validation (shape, depth, non-empty keys). Returns the first problem or null. */
export function validateRule(rule: unknown, depth = 0): string | null {
  if (depth > MAX_DEPTH) return `nesting exceeds depth ${MAX_DEPTH}`;
  if (typeof rule !== "object" || rule === null || !("op" in rule)) return "node must be an object with op";
  const r = rule as Record<string, unknown>;
  const s = (x: unknown): boolean => typeof x === "string" && x.length > 0;
  switch (r.op) {
    case "field_contains":
      return s(r.field_key) && "value" in r ? null : "field_contains needs field_key and value";
    case "group_any_item_equals":
      return s(r.field_key) && s(r.item_field_key) && "value" in r ? null : "group_any_item_equals needs field_key,item_field_key,value";
    case "group_any_item_in":
      return s(r.field_key) && s(r.item_field_key) && Array.isArray(r.values) && r.values.length > 0 ? null : "group_any_item_in needs field_key,item_field_key,values";
    case "group_any_item_differs":
      return s(r.field_key) && s(r.item_field_a) && s(r.item_field_b) ? null : "group_any_item_differs needs field_key,item_field_a,item_field_b";
    case "and":
    case "or": {
      if (!Array.isArray(r.rules) || r.rules.length === 0) return `${String(r.op)} needs rules`;
      for (const c of r.rules) {
        const e = validateRule(c, depth + 1);
        if (e) return e;
      }
      return null;
    }
    case "not":
      return "rule" in r ? validateRule(r.rule, depth + 1) : "not needs rule";
    default:
      return validateResolutionRule(rule, depth);
  }
}

/** Every field_key a rule reads. */
export function ruleFieldRefs(rule: Rule): string[] {
  switch (rule.op) {
    case "field_contains":
    case "group_any_item_equals":
    case "group_any_item_in":
    case "group_any_item_differs":
      return [rule.field_key];
    case "and":
    case "or":
      return rule.rules.flatMap(ruleFieldRefs);
    case "not":
      return ruleFieldRefs(rule.rule);
    default:
      return referencedFieldKeys(rule);
  }
}

/** Item-level references: [{ field_key (the group), item (the sub-field) }]. */
export function ruleItemRefs(rule: Rule): Array<{ field_key: string; item: string }> {
  switch (rule.op) {
    case "group_item_text_matches_any":
      return [{ field_key: rule.field_key, item: rule.item_field_key }];
    case "group_any_item_equals":
    case "group_any_item_in":
      return [{ field_key: rule.field_key, item: rule.item_field_key }];
    case "group_any_item_differs":
      return [
        { field_key: rule.field_key, item: rule.item_field_a },
        { field_key: rule.field_key, item: rule.item_field_b },
      ];
    case "and":
    case "or":
      return rule.rules.flatMap(ruleItemRefs);
    case "not":
      return ruleItemRefs(rule.rule);
    default:
      return [];
  }
}

/**
 * Evaluates a sub-field `applicability_rule` inside one repeatable_group item: the item's own sub-fields are the
 * facts (bare values are ANSWERED, envelopes carry their state, missing/empty are NOT_ASKED).
 */
export function itemFacts(item: Record<string, unknown> | null): RuleFacts {
  const out: Record<string, { value: unknown; answerState: AnswerState }> = {};
  for (const [k, raw] of Object.entries(item ?? {})) out[k] = itemFact(raw);
  return out;
}

export function itemFact(raw: unknown): { value: unknown; answerState: AnswerState } {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw) && "answer_state" in (raw as object)) {
    const env = raw as { answer_state?: unknown; value?: unknown };
    const st = typeof env.answer_state === "string" ? (env.answer_state as AnswerState) : "NOT_ASKED";
    return { value: env.value, answerState: st };
  }
  const empty = raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0);
  return empty ? { value: undefined, answerState: "NOT_ASKED" } : { value: raw, answerState: "ANSWERED" };
}
