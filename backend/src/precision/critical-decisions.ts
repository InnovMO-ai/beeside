/**
 * Macroblock 4 — Critical Decision Rule Storage (Master Contract Macroblock 4 brief; canonical
 * business shape per precision-block2-macroblock2-canonical-data-model-manifest-architecture-
 * 2026-10-02.md §14): a safe, non-`eval`, declarative representation for `resolution_rule`,
 * persisted as the `resolution_rule` key inside one entry of a category_manifest_version's
 * `content.critical_decisions[]` array (JSONB — no separate table, §3/§13).
 *
 * §14's own pseudocode example ("resolved once operating_model is answered AND, if
 * operating_model='direct_entity', legal_entity_status is also answered") is a small boolean
 * expression over the current fact state of a handful of fields — never arbitrary code. This
 * module gives that expression a closed, JSON-serializable AST and a pure recursive evaluator.
 * No `eval`, `new Function`, or template interpolation of any kind is used anywhere here.
 *
 * NOT VERIFIED BY THE TOOLCHAIN in this pass — see repository.ts's header note. This module has
 * no DB dependency and is the easiest candidate to typecheck/unit-test first once npm install
 * succeeds (its own acid-test-equivalent, a plain Jest table test, is sketched at the bottom of
 * this file as a comment, ready to lift into critical-decisions.test.ts).
 */

export type FieldAnswerState = "NOT_ASKED" | "UNKNOWN" | "WITHHELD" | "EXPLICIT_NO" | "ZERO" | "ANSWERED" | "NOT_APPLICABLE";

/** The minimal view of a Fact a resolution_rule can ever see — never the full row, never provenance. */
export interface FieldFactView {
  answerState: FieldAnswerState;
  value: unknown;
}

/** facts keyed by field_key — only fields the rule itself names ever need to be looked up. */
export type FactLookup = Readonly<Record<string, FieldFactView | undefined>>;

// ---------------------------------------------------------------------------------------------
// The declarative AST. Every node is plain, JSON-serializable data — this IS the persisted shape
// of `resolution_rule` inside category_manifest_version.content.critical_decisions[].
// ---------------------------------------------------------------------------------------------

export type ResolutionRule =
  | { op: "field_answered"; field_key: string }
  | { op: "field_not_answered"; field_key: string }
  | { op: "field_equals"; field_key: string; value: unknown }
  | { op: "field_in"; field_key: string; values: unknown[] }
  // "<field> is not NOT_ASKED" (precision-macroblock3 §4.3/§5.3 pseudocode) is NOT the same test as
  // field_answered: it is satisfied the instant a field has been *surfaced to the client at all* —
  // including a bare UNKNOWN — whereas field_answered requires a real answer (ANSWERED / EXPLICIT_NO
  // / ZERO / WITHHELD). Added as its own op rather than overloaded onto field_answered so the AST
  // keeps matching the authored pseudocode's actual truth table, not an approximation of it.
  | { op: "field_asked"; field_key: string }
  | { op: "field_not_asked"; field_key: string }
  // repeatable_group minimum-item-count gate (§6.2 of the same doc: "at least one `logistics_flows`
  // entry must exist is an ordinary requirement_level + a minimum-length applicability_rule" —
  // Macroblock 2 §13A's own anticipated mechanism). `field_key` must name a repeatable_group field;
  // its fact.value is the whole array, exactly as §13A stores it — no per-item sub-table to join.
  | { op: "group_min_items"; field_key: string; min: number }
  // Material-contradiction worked example (§9.2): "no logistics_flows item's `product` text matches
  // the hazmat-keyword list." Still a pure, closed, declarative check — plain case-insensitive
  // substring matching over already-stored item text, never a regex engine, never arbitrary code —
  // over the one group field + one of its group_item_schema sub-fields the rule names explicitly.
  | { op: "group_item_text_matches_any"; field_key: string; item_field_key: string; keywords: string[] }
  | { op: "and"; rules: ResolutionRule[] }
  | { op: "or"; rules: ResolutionRule[] }
  | { op: "not"; rule: ResolutionRule };

const ANSWERED_STATES: ReadonlySet<FieldAnswerState> = new Set(["ANSWERED", "EXPLICIT_NO", "ZERO", "WITHHELD"]);

/** A field counts as "answered" for rule-resolution purposes using the same answer-state
 * vocabulary §8 already defines (NOT_ASKED/UNKNOWN never count; WITHHELD/EXPLICIT_NO/ZERO do —
 * the client gave a real answer, even if that answer was "no" or "I'd rather not say"). */
function isAnswered(fact: FieldFactView | undefined): boolean {
  return fact !== undefined && ANSWERED_STATES.has(fact.answerState);
}

/** "is not NOT_ASKED" (§4.3/§5.3): true the instant the field has been surfaced at all, including
 * a bare UNKNOWN — a strictly weaker test than isAnswered(). A field with no fact row yet is the
 * only case this returns false for (NOT_ASKED is the one state a missing FactLookup entry stands in
 * for, by this module's own contract — see FactLookup's doc comment). */
function isAsked(fact: FieldFactView | undefined): boolean {
  return fact !== undefined && fact.answerState !== "NOT_ASKED";
}

/** True iff `value` is a repeatable_group's stored array and has at least `min` items (§6.1/§6.2) —
 * an empty or absent collection is treated as NOT_ASKED for this purpose, never a crash. */
function groupItemCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Pure, total, side-effect-free evaluator. Never throws on a missing field_key (an unanswered or
 * unknown field simply evaluates its node to `false`/`true` per the node's own semantics) — a
 * malformed rule authored against a field_key that doesn't exist in this manifest version is a
 * content-authoring error to catch at publish time (validateResolutionRule, below), not a runtime
 * crash during readiness evaluation.
 */
export function evaluateResolutionRule(rule: ResolutionRule, facts: FactLookup): boolean {
  switch (rule.op) {
    case "field_answered":
      return isAnswered(facts[rule.field_key]);
    case "field_not_answered":
      return !isAnswered(facts[rule.field_key]);
    case "field_equals": {
      const fact = facts[rule.field_key];
      return isAnswered(fact) && jsonEquals(fact!.value, rule.value);
    }
    case "field_in": {
      const fact = facts[rule.field_key];
      return isAnswered(fact) && rule.values.some((v) => jsonEquals(fact!.value, v));
    }
    case "field_asked":
      return isAsked(facts[rule.field_key]);
    case "field_not_asked":
      return !isAsked(facts[rule.field_key]);
    case "group_min_items":
      return groupItemCount(facts[rule.field_key]?.value) >= rule.min;
    case "group_item_text_matches_any": {
      const items = facts[rule.field_key]?.value;
      if (!Array.isArray(items)) return false;
      const needles = rule.keywords.map((k) => k.toLowerCase());
      return items.some((item) => {
        const text = (item as Record<string, unknown> | null)?.[rule.item_field_key];
        return typeof text === "string" && needles.some((needle) => text.toLowerCase().includes(needle));
      });
    }
    case "and":
      return rule.rules.every((r) => evaluateResolutionRule(r, facts));
    case "or":
      return rule.rules.some((r) => evaluateResolutionRule(r, facts));
    case "not":
      return !evaluateResolutionRule(rule.rule, facts);
  }
}

function jsonEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Every field_key a rule references — for publish-time validation (does each one exist in this
 * manifest version's `fields[]`?) and for selecting the minimal fact set evaluateReadiness() must
 * fetch before evaluating critical_decisions (an optimization the future engine-build macroblock
 * can use; not exercised here). */
export function referencedFieldKeys(rule: ResolutionRule): string[] {
  switch (rule.op) {
    case "field_answered":
    case "field_not_answered":
    case "field_equals":
    case "field_in":
    case "field_asked":
    case "field_not_asked":
    case "group_min_items":
    case "group_item_text_matches_any":
      return [rule.field_key];
    case "and":
    case "or":
      return rule.rules.flatMap(referencedFieldKeys);
    case "not":
      return referencedFieldKeys(rule.rule);
  }
}

/** Structural validation only (shape, depth, that every leaf names a non-empty field_key) — never
 * evaluates anything. Suitable to call at manifest-publish time, before a resolution_rule is ever
 * stored as PUBLISHED content (category_manifest_version is immutable once published, §13/0016,
 * so this is the only gate). Returns the first problem found, or null if the rule is well-formed. */
export function validateResolutionRule(rule: unknown, depth = 0): string | null {
  if (depth > 20) return "resolution_rule nesting exceeds the sanity depth limit (20)";
  if (typeof rule !== "object" || rule === null || !("op" in rule)) return "resolution_rule node must be an object with an `op`";
  const node = rule as { op: unknown };
  switch (node.op) {
    case "field_answered":
    case "field_not_answered":
    case "field_asked":
    case "field_not_asked": {
      const n = rule as { field_key?: unknown };
      return typeof n.field_key === "string" && n.field_key.length > 0 ? null : `${String(node.op)} requires a non-empty field_key`;
    }
    case "group_min_items": {
      const n = rule as { field_key?: unknown; min?: unknown };
      if (typeof n.field_key !== "string" || n.field_key.length === 0) return "group_min_items requires a non-empty field_key";
      if (typeof n.min !== "number" || n.min < 1) return "group_min_items requires min >= 1";
      return null;
    }
    case "group_item_text_matches_any": {
      const n = rule as { field_key?: unknown; item_field_key?: unknown; keywords?: unknown };
      if (typeof n.field_key !== "string" || n.field_key.length === 0) return "group_item_text_matches_any requires a non-empty field_key";
      if (typeof n.item_field_key !== "string" || n.item_field_key.length === 0) return "group_item_text_matches_any requires a non-empty item_field_key";
      if (!Array.isArray(n.keywords) || n.keywords.length === 0) return "group_item_text_matches_any requires a non-empty keywords array";
      return null;
    }
    case "field_equals": {
      const n = rule as { field_key?: unknown; value?: unknown };
      if (typeof n.field_key !== "string" || n.field_key.length === 0) return "field_equals requires a non-empty field_key";
      if (!("value" in n)) return "field_equals requires a value";
      return null;
    }
    case "field_in": {
      const n = rule as { field_key?: unknown; values?: unknown };
      if (typeof n.field_key !== "string" || n.field_key.length === 0) return "field_in requires a non-empty field_key";
      if (!Array.isArray(n.values) || n.values.length === 0) return "field_in requires a non-empty values array";
      return null;
    }
    case "and":
    case "or": {
      const n = rule as { rules?: unknown };
      if (!Array.isArray(n.rules) || n.rules.length === 0) return `${String(node.op)} requires a non-empty rules array`;
      for (const child of n.rules) {
        const err = validateResolutionRule(child, depth + 1);
        if (err) return err;
      }
      return null;
    }
    case "not": {
      const n = rule as { rule?: unknown };
      if (!("rule" in n)) return "not requires a nested rule";
      return validateResolutionRule(n.rule, depth + 1);
    }
    default:
      return `unknown resolution_rule op: ${String(node.op)}`;
  }
}

/*
 * Sketch of the Jest table test this file is written to make trivial, once npm install succeeds
 * (NOT executed in this sandbox — see this file's header note):
 *
 * const rule: ResolutionRule = { op: "and", rules: [
 *   { op: "field_answered", field_key: "operating_model" },
 *   { op: "or", rules: [
 *     { op: "not", rule: { op: "field_equals", field_key: "operating_model", value: "direct_entity" } },
 *     { op: "field_answered", field_key: "legal_entity_status" },
 *   ]},
 * ]};
 * evaluateResolutionRule(rule, {}) === false
 * evaluateResolutionRule(rule, { operating_model: { answerState: "ANSWERED", value: "distributor" } }) === true
 * evaluateResolutionRule(rule, { operating_model: { answerState: "ANSWERED", value: "direct_entity" } }) === false
 * evaluateResolutionRule(rule, {
 *   operating_model: { answerState: "ANSWERED", value: "direct_entity" },
 *   legal_entity_status: { answerState: "ANSWERED", value: "incorporated" },
 * }) === true
 */
