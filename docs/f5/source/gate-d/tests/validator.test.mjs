import test from "node:test";
import assert from "node:assert/strict";
import { validateManifest, validateProjectManifest } from "../validator/manifest-validator.mjs";
import { load, ALL, catalog, PM } from "./helpers.mjs";

const additions = ["intellectual_property", "wind_down_closure", "retail_premises", "corporate_transactional_advisory"];
const clone = (o) => JSON.parse(JSON.stringify(o));
const errs = (m, ctx = {}) => validateManifest(m, ctx).filter((x) => x.severity === "error");
const has = (arr, check, re) => arr.some((x) => x.check === check && (!re || re.test(x.message)));

test("all 8 draft manifests pass the validator with zero errors and zero warnings (one-key-one-meaning across the whole set)", () => {
  const registry = new Map(); let total = 0;
  for (const k of ALL) { const r = validateManifest(load(k), { registry, catalog, additions }); assert.deepEqual(r, [], k); total += load(k).fields.length; }
  assert.ok(total > 80, `fields: ${total}`);
});
test("Project Manifest v2 passes (19 candidates = 17 catalog + 2 reserved; all 20 FA 4.0 Fronts covered)", () => {
  const fronts = PM().fa4_front_signals.map((x) => x.front);
  assert.equal(fronts.length, 20);
  const manifests = new Map(ALL.map((k) => [k, load(k)]));
  const r = validateProjectManifest(PM(), { catalogCategories: Object.keys(catalog), manifests, fronts });
  assert.deepEqual(r, []);
  assert.equal(Object.keys(catalog).length, 17);
});
test("mutation: unknown field in a rule", () => { const m = load("logistics"); m.critical_decisions[0].resolution_rule.rules[0].field_key = "nope"; assert.ok(has(errs(m), "3.reference", /unknown field 'nope'/)); });
test("mutation: decision reads a field not in depends_on_fields", () => { const m = load("logistics"); m.critical_decisions[0].depends_on_fields.pop(); assert.ok(has(errs(m), "5.rule", /not listed in depends_on_fields/)); });
test("mutation: enum value duplicating answer_state semantics ('unknown')", () => { const m = load("logistics"); m.fields.find((f) => f.field_key === "logistics_insurance_coverage_status").values.push("unknown"); assert.ok(has(errs(m), "1.schema", /answer_state/)); });
test("mutation: provider name in a universal manifest", () => { const m = load("logistics"); m.fields[1].notes = "prefer DHL for express"; assert.ok(has(errs(m), "6.forbidden", /DHL/)); });
test("mutation: score / coverage keys are forbidden", () => { const m = load("tax_accounting_audit"); m.fields[1].readiness_score = 3; m.fields[2].coverage = "core"; const e = errs(m); assert.ok(has(e, "6.forbidden", /readiness_score/) && has(e, "6.forbidden", /coverage/)); });
test("mutation: overlay deactivates a key absent from base (hygiene A)", () => { const m = load("logistics"); m.country_overlays.US.deactivate.push("ghost_field"); assert.ok(has(errs(m), "4.overlay", /silent no-op/)); });
test("mutation: overlay adds a key that already exists in base", () => { const m = load("people_payroll_employment"); m.country_overlays.MX.add.push(clone(m.fields[1])); assert.ok(has(errs(m), "4.overlay", /already exists in base/)); });
test("mutation: overlay patch tries to change type/values (rejected, D1)", () => { const m = load("logistics"); m.country_overlays.US.modify[0].patch.values = ["x"]; assert.ok(has(errs(m), "4.overlay", /not allowed/)); });
test("mutation: same added key with different values across overlays (D1 conflict)", () => { const m = load("logistics"); const f = clone(m.country_overlays.DE.add[0]); f.values = ["only_one"]; m.country_overlays.US.add.push(f); assert.ok(has(errs(m), "4.overlay", /different type\/values/)); });
test("mutation: one key two meanings across manifests", () => {
  const registry = new Map(); const a = load("logistics"); const b = load("people_payroll_employment");
  const bad = clone(b.fields.find((f) => f.field_key === "generic_unmapped_needs")); bad.group_item_schema.pop();
  b.fields[b.fields.findIndex((f) => f.field_key === "generic_unmapped_needs")] = bad;
  validateManifest(a, { registry }); assert.ok(has(validateManifest(b, { registry }), "2.one_key_one_meaning", /defined differently/));
});
test("mutation: catalog service missing / foreign in *_services_in_scope", () => {
  const m = load("international_trade_customs"); m.fields[0].values = m.fields[0].values.filter((v) => v !== "immex"); m.fields[0].values.push("made_up_service");
  const e = errs(m, { catalog, additions }); assert.ok(has(e, "10.catalog", /missing/) && has(e, "10.catalog", /made_up_service/));
});
test("mutation: PUBLISHABLE without a domain validator is rejected (no publication without validator)", () => { const m = load("logistics"); m.manifest_status = "PUBLISHABLE"; assert.ok(has(errs(m), "8.validator", /requires a registered domain validator/)); });
test("mutation: threshold without change_threshold / non-quantifiable type", () => { const m = load("logistics"); const f = m.fields.find((x) => x.field_key === "logistics_inventory_profile"); delete f.change_threshold; assert.ok(has(errs(m), "1.schema", /change_threshold/)); });
test("mutation: consistency decision without a single *_ack field", () => { const m = load("logistics"); const d = m.critical_decisions.find((x) => x.kind === "consistency"); d.depends_on_fields = d.depends_on_fields.filter((k) => !k.endsWith("_ack")); assert.ok(errs(m).some((x) => x.check === "5.rule")); });
test("mutation: wrong enum value inside an applicability rule (typo)", () => { const m = load("logistics"); m.fields.find((f) => f.field_key === "logistics_cold_chain_required").applicability_rule.values.push("pharma"); assert.ok(has(errs(m), "3.reference", /not an allowed value/)); });
test("satisfiability: the MB3 pilot rule for hr_entity_consistency_ack (entity_registered under eor_peo with field only under direct_entity) is flagged unreachable", () => {
  const m = load("people_payroll_employment");
  const status = m.fields.find((f) => f.field_key === "hr_local_entity_status");
  status.applicability_rule = { op: "field_equals", field_key: "hr_employment_model", value: "direct_entity" }; // pilot behaviour
  assert.ok(has(validateManifest(m, {}), "11.satisfiability", /unreachable/));
});
test("Project Manifest mutations: missing front, reserved kind, wrong classification order", () => {
  const pm = clone(PM()); pm.fa4_front_signals = pm.fa4_front_signals.slice(1);
  const fronts = PM().fa4_front_signals.map((x) => x.front);
  assert.ok(validateProjectManifest(pm, { fronts }).some((x) => x.check === "P5.fronts"));
  const p2 = clone(PM()); p2.candidate_categories.find((c) => c.category_key === "strategic_advisory").kind = "catalog";
  assert.ok(validateProjectManifest(p2, {}).some((x) => x.check === "P1.reserved"));
  const p3 = clone(PM()); p3.add_a_service.classification_order.reverse();
  assert.ok(validateProjectManifest(p3, {}).some((x) => x.check === "P9.classification"));
});
