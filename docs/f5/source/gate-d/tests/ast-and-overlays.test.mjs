import test from "node:test";
import assert from "node:assert/strict";
import * as AST from "../validator/ast-e1.mjs";
import { load, ALL, A, NO, UNK } from "./helpers.mjs";

test("MB4 resolution-rule evaluator: documented truth table (critical-decisions.ts sketch)", () => {
  const rule = { op: "and", rules: [{ op: "field_answered", field_key: "operating_model" }, { op: "or", rules: [{ op: "not", rule: { op: "field_equals", field_key: "operating_model", value: "direct_entity" } }, { op: "field_answered", field_key: "legal_entity_status" }] }] };
  assert.equal(AST.evaluate(rule, {}), false);
  assert.equal(AST.evaluate(rule, { operating_model: A("distributor") }), true);
  assert.equal(AST.evaluate(rule, { operating_model: A("direct_entity") }), false);
  assert.equal(AST.evaluate(rule, { operating_model: A("direct_entity"), legal_entity_status: A("incorporated") }), true);
});
test("ASSUMED counts as answered for rule evaluation (M-E); UNKNOWN does not", () => {
  const r = { op: "field_answered", field_key: "x" };
  assert.equal(AST.evaluate(r, { x: A(5, "ASSUMED") }), true);
  assert.equal(AST.evaluate(r, { x: UNK() }), false);
  assert.equal(AST.evaluate({ op: "field_equals", field_key: "x", value: 5 }, { x: A(5, "ASSUMED") }), true);
});
test("E1 ops: contains / any_item_equals / in / differs", () => {
  const f = { svc: A(["a", "b"]), flows: A([{ o: "CN", d: "US" }, { o: "US", d: "US" }]) };
  assert.equal(AST.evaluate(AST.validate && { op: "field_contains", field_key: "svc", value: "b" }, f), true);
  assert.equal(AST.evaluate({ op: "field_contains", field_key: "svc", value: "z" }, f), false);
  assert.equal(AST.evaluate({ op: "group_any_item_equals", field_key: "flows", item_field_key: "d", value: "US" }, f), true);
  assert.equal(AST.evaluate({ op: "group_any_item_in", field_key: "flows", item_field_key: "o", values: ["MX", "CN"] }, f), true);
  assert.equal(AST.evaluate({ op: "group_any_item_differs", field_key: "flows", item_field_a: "o", item_field_b: "d" }, f), true);
  assert.equal(AST.evaluate({ op: "group_any_item_differs", field_key: "flows", item_field_a: "o", item_field_b: "d" }, { flows: A([{ o: "US", d: "US" }]) }), false);
  assert.equal(AST.evaluate({ op: "group_any_item_differs", field_key: "flows", item_field_a: "o", item_field_b: "d" }, {}), false);
  assert.equal(AST.validate({ op: "group_any_item_in", field_key: "g", item_field_key: "i", values: [] }) !== null, true);
});
test("item values carrying answer_state convention are unwrapped by item ops", () => {
  const f = { flows: A([{ o: { answer_state: "UNKNOWN", value: null }, d: "US" }]) };
  assert.equal(AST.evaluate({ op: "group_any_item_differs", field_key: "flows", item_field_a: "o", item_field_b: "d" }, f), false);
});
test("single-country equivalence: effectiveFieldsMulti([c]) === MB4 effectiveFields(c) for every manifest × every overlay country + null + unknown country", () => {
  let n = 0;
  for (const k of ALL) {
    const m = load(k);
    const countries = [null, "ZZ", ...Object.keys(m.country_overlays)];
    for (const c of countries) {
      const a = AST.effectiveFields(m, c);
      const b = AST.effectiveFieldsMulti(m, c === null ? [] : [c]);
      assert.deepEqual(b, a, `${k}/${c}`); n++;
    }
  }
  assert.ok(n >= 8 + 8);
});
test("multi-country union (D1): deactivate effective only if every scoped country deactivates; add marked applies_to_countries", () => {
  const lg = load("logistics");
  const both = AST.effectiveFieldsMulti(lg, ["US", "MX"]).map((f) => f.field_key);
  assert.ok(!both.includes("logistics_vat_deferment_scheme_interest"), "US and MX both deactivate it");
  const usde = AST.effectiveFieldsMulti(lg, ["US", "DE"]);
  assert.ok(usde.some((f) => f.field_key === "logistics_vat_deferment_scheme_interest"), "DE keeps it");
  const eori = usde.find((f) => f.field_key === "logistics_eori_number_status");
  assert.deepEqual(eori.applies_to_countries, ["DE"]);
  const fda = usde.find((f) => f.field_key === "logistics_fda_prior_notice_required");
  assert.deepEqual(fda.applies_to_countries, ["US"]);
});
test("overlay-added field absent for non-overlaid country (MB3 test 24)", () => {
  const lg = load("logistics");
  assert.ok(!AST.effectiveFields(lg, "US").some((f) => f.field_key === "logistics_eori_number_status"));
  assert.ok(!AST.effectiveFields(lg, "MX").some((f) => f.field_key === "logistics_eori_number_status"));
});
test("hygiene A: no overlay deactivates/modifies a key missing from base (MB4 validator, every manifest)", () => {
  for (const k of ALL) assert.deepEqual(AST.findOverlayFieldKeysMissingFromBase(load(k)), [], k);
});
test("every rule in every manifest validates and only names declared keys (E1-extended AST)", () => {
  for (const k of ALL) {
    const m = load(k); const keys = new Set(m.fields.map((f) => f.field_key));
    for (const d of m.critical_decisions) { assert.equal(AST.validate(d.resolution_rule), null, d.decision_key); for (const r of AST.refs(d.resolution_rule)) assert.ok(keys.has(r), `${d.decision_key}->${r}`); }
  }
});
