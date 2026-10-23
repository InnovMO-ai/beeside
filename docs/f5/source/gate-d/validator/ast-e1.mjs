// Reference implementation of the closed rule AST = MB4 critical-decisions.ts (imported unchanged)
// + proposed additive set E1 (field_contains, group_any_item_equals/in/differs). Pure, deterministic.
import { pathToFileURL } from "node:url";
const MB4 = process.env.MB4_SRC; // .../mb4/backend/src/precision
if (!MB4) throw new Error("set MB4_SRC to the extracted MB4 backend/src/precision directory");
const cd = await import(pathToFileURL(`${MB4}/critical-decisions.ts`).href);
const mf = await import(pathToFileURL(`${MB4}/manifest.ts`).href);
export const { evaluateResolutionRule: evalBase, validateResolutionRule: validateBase, referencedFieldKeys: refsBase } = cd;
export const { effectiveFields, findOverlayFieldKeysMissingFromBase } = mf;

export const E1_OPS = ["field_contains", "group_any_item_equals", "group_any_item_in", "group_any_item_differs"];
// ASSUMED proposed in M-E: for rule evaluation it counts as answered (a value was given), like WITHHELD in MB4.
const ANSWERED = new Set(["ANSWERED", "EXPLICIT_NO", "ZERO", "WITHHELD", "ASSUMED"]);
const answered = (f) => f !== undefined && ANSWERED.has(f.answerState);
const jeq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const items = (f) => (f && Array.isArray(f.value) ? f.value : []);
const itemVal = (it, k) => { const v = it?.[k]; return v && typeof v === "object" && !Array.isArray(v) && "answer_state" in v ? v.value : v; };

export function evaluate(rule, facts) {
  switch (rule.op) {
    case "field_contains": { const f = facts[rule.field_key]; return answered(f) && Array.isArray(f.value) && f.value.some((x) => jeq(x, rule.value)); }
    case "group_any_item_equals": return items(facts[rule.field_key]).some((it) => jeq(itemVal(it, rule.item_field_key), rule.value));
    case "group_any_item_in": return items(facts[rule.field_key]).some((it) => { const v = itemVal(it, rule.item_field_key); return rule.values.some((x) => jeq(v, x)); });
    case "group_any_item_differs": return items(facts[rule.field_key]).some((it) => { const a = itemVal(it, rule.item_field_a), b = itemVal(it, rule.item_field_b); return a !== undefined && b !== undefined && a !== null && b !== null && !jeq(a, b); });
    case "and": return rule.rules.every((r) => evaluate(r, facts));
    case "or": return rule.rules.some((r) => evaluate(r, facts));
    case "not": return !evaluate(rule.rule, facts);
    default: // base ops; ASSUMED-aware wrappers for answered-based ops
      return evalBaseAssumedAware(rule, facts);
  }
}
// MB4's isAnswered does not know ASSUMED; map ASSUMED -> ANSWERED before delegating (proposed F5 change: add to ANSWERED_STATES).
function evalBaseAssumedAware(rule, facts) {
  const m = {};
  for (const [k, v] of Object.entries(facts)) m[k] = v && v.answerState === "ASSUMED" ? { ...v, answerState: "ANSWERED" } : v;
  return evalBase(rule, m);
}
export function validate(rule, depth = 0) {
  if (depth > 20) return "nesting exceeds depth 20";
  if (!rule || typeof rule !== "object" || !("op" in rule)) return "node must be an object with op";
  const s = (x) => typeof x === "string" && x.length > 0;
  switch (rule.op) {
    case "field_contains": return s(rule.field_key) && "value" in rule ? null : "field_contains needs field_key and value";
    case "group_any_item_equals": return s(rule.field_key) && s(rule.item_field_key) && "value" in rule ? null : "group_any_item_equals needs field_key,item_field_key,value";
    case "group_any_item_in": return s(rule.field_key) && s(rule.item_field_key) && Array.isArray(rule.values) && rule.values.length ? null : "group_any_item_in needs field_key,item_field_key,values";
    case "group_any_item_differs": return s(rule.field_key) && s(rule.item_field_a) && s(rule.item_field_b) ? null : "group_any_item_differs needs field_key,item_field_a,item_field_b";
    case "and": case "or":
      if (!Array.isArray(rule.rules) || !rule.rules.length) return `${rule.op} needs rules`;
      for (const c of rule.rules) { const e = validate(c, depth + 1); if (e) return e; }
      return null;
    case "not": return "rule" in rule ? validate(rule.rule, depth + 1) : "not needs rule";
    default: return validateBase(rule, depth);
  }
}
export function refs(rule) {
  switch (rule.op) {
    case "field_contains": case "group_any_item_equals": case "group_any_item_in": case "group_any_item_differs": return [rule.field_key];
    case "and": case "or": return rule.rules.flatMap(refs);
    case "not": return refs(rule.rule);
    default: return refsBase(rule);
  }
}
// item-level references: [{field_key, item_field_key}]
export function itemRefs(rule) {
  switch (rule.op) {
    case "group_item_text_matches_any": case "group_any_item_equals": case "group_any_item_in": return [{ field_key: rule.field_key, item: rule.item_field_key }];
    case "group_any_item_differs": return [{ field_key: rule.field_key, item: rule.item_field_a }, { field_key: rule.field_key, item: rule.item_field_b }];
    case "and": case "or": return rule.rules.flatMap(itemRefs);
    case "not": return itemRefs(rule.rule);
    default: return [];
  }
}
// multi-country union (D1): single-country result must equal MB4 effectiveFields exactly.
export function effectiveFieldsMulti(content, countries) {
  if (!countries || countries.length === 0) return effectiveFields(content, null);
  if (countries.length === 1) return effectiveFields(content, countries[0]);
  const per = countries.map((c) => effectiveFields(content, c));
  const baseKeys = content.fields.map((f) => f.field_key);
  const out = [];
  const seen = new Set();
  // base field survives if at least one country keeps it active (deactivate only effective if ALL scoped countries with overlays deactivate it)
  for (const k of baseKeys) {
    const variants = per.map((p) => p.find((f) => f.field_key === k)).filter(Boolean);
    if (variants.length === 0) continue;
    const order = ["blocking", "required", "conditional", "supporting", "informational"];
    const strictest = variants.reduce((a, b) => (order.indexOf(b.requirement_level) < order.indexOf(a.requirement_level) ? b : a));
    out.push(strictest); seen.add(k);
  }
  for (const p of per) for (const f of p) if (!seen.has(f.field_key)) {
    const countriesApplied = countries.filter((c, i) => per[i].some((x) => x.field_key === f.field_key));
    out.push({ ...f, applies_to_countries: countriesApplied }); seen.add(f.field_key);
  }
  return out;
}
