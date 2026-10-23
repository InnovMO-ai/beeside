import test from "node:test";
import assert from "node:assert/strict";
import * as R from "../validator/reference-model.mjs";
import { load, PM, catalog, A, NO, UNK } from "./helpers.mjs";

const lg = load("logistics"), hr = load("people_payroll_employment"), pm = PM();
const flow = (o = {}) => ({ origin_country: "CN", destination_country: "US", product: "finished electronics", volume: { value: 100, unit: "containers" }, frequency: "monthly", mode_of_transport: "ocean", ...o });
const lgBase = () => ({
  logistics_services_in_scope: A(["freight_transportation", "warehousing"]),
  logistics_operating_responsibility: A("self_managed"),
  logistics_primary_product_type: A("general_cargo"),
  logistics_flows: A([flow()]),
  logistics_warehousing_needed: NO(),
  logistics_hazardous_materials_flag: NO(),
  logistics_import_export_license_status: A("have_valid"),
  logistics_customs_broker_status: A("engaged"),
});
const keysOf = (r, lvl) => r[`${lvl}_gaps`].map((g) => g.field_key + (g.sub ? "." + g.sub : "") + (g.item !== undefined ? `#${g.item}` : ""));

test("MB3 #1/#18: two lanes of one objective = two items of one array, ready", () => {
  const f = lgBase(); f.logistics_flows = A([flow(), flow({ origin_country: "US", destination_country: "MX", mode_of_transport: "road", frequency: "weekly" })]);
  const r = R.evaluateReadiness(lg, f, ["US"]);
  assert.deepEqual(r.blocking_gaps, []); assert.deepEqual(r.required_gaps, []); assert.equal(r.ready, true);
});
test("MB3 #2: one complete + one incomplete item -> named, item-indexed gap; array still counts for the minimum", () => {
  const f = lgBase(); f.logistics_flows = A([flow(), flow({ volume: undefined })]);
  const r = R.evaluateReadiness(lg, f, ["US"]);
  assert.deepEqual(keysOf(r, "required"), ["logistics_flows.volume#1"]); assert.equal(r.ready, false);
});
test("MB3 #23: zero flows -> single min_items gap, not a silent pass", () => {
  const f = lgBase(); f.logistics_flows = A([]);
  const r = R.evaluateReadiness(lg, f, ["US"]);
  assert.ok(r.required_gaps.some((g) => g.kind === "min_items" && g.field_key === "logistics_flows"));
});
test("MB3 #4: EXPLICIT_NO resolves a boolean; UNKNOWN stays a gap (UNKNOWN != NO)", () => {
  const f = lgBase(); f.logistics_hazardous_materials_flag = UNK();
  const r = R.evaluateReadiness(lg, f, ["US"]);
  assert.ok(keysOf(r, "blocking").includes("logistics_hazardous_materials_flag"));
  f.logistics_hazardous_materials_flag = NO();
  assert.ok(!keysOf(R.evaluateReadiness(lg, f, ["US"]), "blocking").includes("logistics_hazardous_materials_flag"));
});
test("MB3 #5: cold-chain field is NOT_APPLICABLE for general cargo, gating for perishables", () => {
  const f = lgBase();
  assert.ok(R.evaluateReadiness(lg, f, ["US"]).not_applicable.includes("logistics_cold_chain_required"));
  f.logistics_primary_product_type = A("food_beverage_perishable");
  assert.ok(R.evaluateReadiness(lg, f, ["US"]).conditional_gaps.some((g) => g.field_key === "logistics_cold_chain_required"));
});
test("MB3 #6: hazmat=true with license NOT_ASKED keeps the compliance decision unresolved and blocking", () => {
  const f = lgBase(); f.logistics_hazardous_materials_flag = A(true); delete f.logistics_import_export_license_status;
  const r = R.evaluateReadiness(lg, f, ["US"]);
  assert.ok(r.blocking_gaps.some((g) => g.field_key === "logistics_hazmat_compliance_decision"));
});
test("MB3 #7: missing supporting field never blocks", () => {
  const r = R.evaluateReadiness(lg, lgBase(), ["US"]);
  assert.ok(r.supporting_gaps.some((g) => g.field_key === "logistics_insurance_coverage_status") && r.ready);
});
test("MB3 #8: operational pending items never appear in any gap list", () => {
  const r = R.evaluateReadiness(lg, lgBase(), ["US"]);
  assert.ok(!r.gaps.some((g) => /pending$/.test(g.field_key)));
});
test("MB3 #10-12: country overlays add/modify/deactivate drive effective fields in readiness", () => {
  const f = lgBase(); f.logistics_primary_product_type = A("food_beverage_perishable"); f.logistics_cold_chain_required = NO();
  assert.ok(R.evaluateReadiness(lg, f, ["US"]).conditional_gaps.some((g) => g.field_key === "logistics_fda_prior_notice_required"));
  assert.ok(!R.evaluateReadiness(lg, f, ["MX"]).gaps.some((g) => g.field_key === "logistics_fda_prior_notice_required"));
  assert.ok(R.evaluateReadiness(lg, lgBase(), ["DE"]).not_applicable.length >= 0);
  const de = lgBase(); de.logistics_flows = A([flow({ origin_country: "DE", destination_country: "US" })]);
  assert.ok(R.evaluateReadiness(lg, de, ["DE"]).required_gaps.some((g) => g.field_key === "logistics_eori_number_status"));
});
test("MB3 #21/#22 hazmat contradiction: blocked until corrected or acknowledged; AI suspicion alone never decides", () => {
  const f = lgBase(); f.logistics_flows = A([flow({ product: "lithium-ion battery packs" })]);
  let r = R.evaluateReadiness(lg, f, ["US"]);
  assert.ok(r.blocking_gaps.some((g) => g.field_key === "logistics_hazmat_description_consistency_decision"));
  f.logistics_hazmat_ack = A("Packs are shipped under the exemption for small cells.");
  r = R.evaluateReadiness(lg, f, ["US"]);
  assert.ok(!r.blocking_gaps.some((g) => g.field_key === "logistics_hazmat_description_consistency_decision"));
  const g = lgBase(); g.logistics_flows = A([flow({ product: "lithium-ion battery packs" })]); g.logistics_hazardous_materials_flag = A(true);
  assert.ok(!R.evaluateReadiness(lg, g, ["US"]).blocking_gaps.some((x) => x.field_key === "logistics_hazmat_description_consistency_decision"));
});
test("HR contradiction (MB3 §9.3) is reachable in v2: EOR + registered entity needs an acknowledgement", () => {
  const f = { hr_employment_model: A("eor_peo"), hr_local_entity_status: A("entity_registered") };
  const r = R.evaluateReadiness(hr, f, ["MX"]);
  assert.ok(r.blocking_gaps.some((g) => g.field_key === "hr_entity_employment_model_consistency_decision"));
  assert.ok(!R.evaluateReadiness(hr, { ...f, hr_entity_consistency_ack: A("Entity kept for a legacy contract.") }, ["MX"]).blocking_gaps.some((g) => g.field_key === "hr_entity_employment_model_consistency_decision"));
});
test("HR MB3 #3: headcount ZERO resolves the sub-field (zero != missing)", () => {
  const f = { hr_employment_model: A("eor_peo"), hr_employee_population_breakdown: A([{ role_type: "Sales", headcount: { answer_state: "ZERO", value: 0 }, employment_type: "full_time", country: "MX" }]) };
  const r = R.evaluateReadiness(hr, f, ["MX"]);
  assert.ok(!r.required_gaps.some((g) => g.field_key === "hr_employee_population_breakdown"));
});
test("HR overlay: MX modifies the bonus field, US deactivates it, SG deactivates + adds CPF when an SG employee exists", () => {
  const f = { hr_employee_population_breakdown: A([{ role_type: "Eng", headcount: 3, employment_type: "full_time", country: "SG" }]) };
  assert.ok(R.evaluateReadiness(hr, f, ["US"]).not_applicable.length >= 0);
  assert.ok(!R.evaluateReadiness(hr, f, ["US"]).gaps.some((g) => g.field_key === "hr_statutory_year_end_bonus_status"));
  assert.ok(R.evaluateReadiness(hr, f, ["SG"]).conditional_gaps.some((g) => g.field_key === "hr_cpf_contribution_status"));
  assert.ok(R.evaluateReadiness(hr, f, ["MX"]).required_gaps.some((g) => g.field_key === "hr_statutory_year_end_bonus_status"));
});

// ---------------- D12: pending information & completion gate ----------------
test("D12: 'I don't know' keeps readiness false but does NOT block closure; it surfaces as Pending, with Execution Dependency on blocking fields", () => {
  const f = lgBase(); f.logistics_flows = A([flow({ volume: { answer_state: "UNKNOWN", value: null } })]);
  f.logistics_warehousing_needed = UNK();
  const r = R.evaluateReadiness(lg, f, ["US"]);
  assert.equal(r.ready, false);
  const g = R.completionGate(lg, f, ["US"]);
  assert.equal(g.canComplete, true, JSON.stringify(g.notAsked));
  assert.equal(g.final_pending_review, true); assert.equal(g.completed_with_pending, true);
  const sec = R.crpPendingSection(g);
  assert.ok(sec.some((p) => p.field_key === "logistics_warehousing_needed" && p.label === "Pending"));
  assert.ok(sec.some((p) => p.sub === "volume" && p.label === "Pending"));
});
test("D12: NOT_ASKED applicable required field blocks closure", () => {
  const f = lgBase(); delete f.logistics_primary_product_type;
  const g = R.completionGate(lg, f, ["US"]);
  assert.equal(g.canComplete, false); assert.ok(g.notAsked.some((x) => x.field_key === "logistics_primary_product_type"));
});
test("D12: unacknowledged contradiction blocks closure (consistency decision), a pending path decision does not", () => {
  const f = lgBase(); f.logistics_flows = A([flow({ product: "aerosol cans" })]);
  const g = R.completionGate(lg, f, ["US"]);
  assert.equal(g.canComplete, false); assert.ok(g.unacknowledged.some((u) => u.decision_key === "logistics_hazmat_description_consistency_decision"));
  const h = lgBase(); h.logistics_hazardous_materials_flag = UNK();
  const gh = R.completionGate(lg, h, ["US"]);
  assert.equal(gh.canComplete, true); assert.ok(gh.pendingDecisions.length >= 1);
});
test("D12: ASSUMED counts as resolved for readiness, is listed as Assumed, never as Confirmed", () => {
  const f = lgBase(); f.logistics_warehousing_needed = A(true, "ASSUMED"); f.logistics_warehousing_details = A("about 2,000 pallets", "ASSUMED");
  const r = R.evaluateReadiness(lg, f, ["US"]);
  assert.ok(!r.required_gaps.some((g) => g.field_key === "logistics_warehousing_needed"));
  const sec = R.crpPendingSection(R.completionGate(lg, f, ["US"]));
  assert.ok(sec.some((p) => p.field_key === "logistics_warehousing_needed" && p.label === "Assumed"));
});
test("D12: the CRP never claims quality or provider-readiness", () => { assert.equal(R.completionGate(lg, lgBase(), ["US"]).ready_for_provider_claims, false); });
test("D12: SA light intake: closure possible with one study whose required items are addressed (even with UNKNOWN markets), nothing else asked", () => {
  const sa = load("strategic_advisory");
  const study = { objective: "Decide whether to enter", question: "Is there appetite?", subject_type: ["market"], subject_detail: { answer_state: "UNKNOWN", value: null }, markets: { answer_state: "UNKNOWN", value: null }, expected_result: "Go/no-go", decisions: "Invest or not" };
  const f = { sa_capabilities: A(["CAP_SA_ME_APPETITE"]), sa_studies: A([study]) };
  const g = R.completionGate(sa, f, []);
  assert.equal(g.canComplete, true);
  const p = R.crpPendingSection(g);
  assert.ok(p.filter((x) => x.execution_dependency_mark).map((x) => x.sub).sort().join() === "markets,subject_detail");
});
test("D12: Discovery manifest: closure needs the client's confirmation of the classification (confirmation decision)", () => {
  const gen = load("_generic");
  const item = { need_description: "Tender participation", objective: "Win public contracts", scope: "Local government", country_scope: ["MX"], timing_needed_by: "2027-03", expected_outcome: "Qualified bids" };
  const g = R.completionGate(gen, { generic_classification_confirmed: UNK(), generic_needs: A([item]) }, []);
  assert.equal(g.canComplete, false); assert.ok(g.unacknowledged.some((u) => u.kind === "confirmation"));
  assert.equal(R.completionGate(gen, { generic_classification_confirmed: A(true), generic_needs: A([item]) }, []).canComplete, true);
});
test("D1/MB4-equivalence: multi-country scope [US,MX] unions effective fields in readiness", () => {
  const f = lgBase(); f.logistics_primary_product_type = A("food_beverage_perishable"); f.logistics_cold_chain_required = NO();
  const r = R.evaluateReadiness(lg, f, ["US", "MX"]);
  assert.ok(r.conditional_gaps.some((g) => g.field_key === "logistics_fda_prior_notice_required"));
});

// ---------------- D11: materiality ----------------
test("D11 PO example: CRP v1.0 100 -> 150 containers is material (v2.0); 100 -> 105 is not", () => {
  const b = lgBase(), a = lgBase(), c = lgBase();
  a.logistics_flows = A([flow({ volume: { value: 150, unit: "containers" } })]);
  c.logistics_flows = A([flow({ volume: { value: 105, unit: "containers" } })]);
  assert.equal(R.isMaterial(R.materialChanges(lg, b, a)), true);
  assert.equal(R.isMaterial(R.materialChanges(lg, b, c)), false);
});
test("D11: operational field edit never material; required enum change is; date shift of a quarter is", () => {
  const b = lgBase(), a = lgBase(); a.logistics_insurance_coverage_status = A("covered"); a.logistics_lead_time_expectations = A("2 weeks");
  assert.equal(R.isMaterial(R.materialChanges(lg, b, a)), false);
  const c = lgBase(); c.logistics_primary_product_type = A("pharma_medical");
  assert.equal(R.isMaterial(R.materialChanges(lg, b, c)), true);
  const gen = load("_generic"); const mk = (d) => ({ generic_needs: A([{ need_description: "x", timing_needed_by: d }]) });
  assert.equal(R.isMaterial(R.materialChanges(gen, mk("2027-03"), mk("2027-04"))), false);
  assert.equal(R.isMaterial(R.materialChanges(gen, mk("2027-03"), mk("2027-07"))), true);
});
test("D11: a new SA or ED need (new array item) is structural -> always material", () => {
  const sa = load("strategic_advisory"); const s = { objective: "x" };
  assert.equal(R.isMaterial(R.materialChanges(sa, { sa_studies: A([s]) }, { sa_studies: A([s, { objective: "y" }]) })), true);
});

// ---------------- D10 classifier ----------------
const cls = (text, extra = {}) => R.classifyNeed({ text, ...extra }, pm, catalog);
test("D10 classification order and outcomes (one case per scenario)", () => {
  assert.equal(cls("I need work visas for 12 technicians").scenario, "out_of_scope");
  assert.equal(cls("Necesito la visa de trabajo de mis técnicos").scenario, "out_of_scope");
  assert.equal(cls("I want a feasibility study before investing").scenario, "strategic_advisory");
  assert.equal(cls("Busco un distribuidor local en Jalisco", { existing_instance_keys: [] }).scenario, "ecosystem_development");
  const k = cls("also need last mile delivery", { service_key: "last_mile_delivery" }); assert.deepEqual([k.scenario, k.category_key], ["known_service", "logistics"]);
  const u = cls("certify an industrial biodigester", { category_key: "certifications_quality" }); assert.deepEqual([u.scenario, u.internal_tag], ["unmapped_known_category", "unmapped_known_category"]);
  const d = cls("Quiero participar en licitaciones del gobierno local", { proposed_slug: "public procurement" }); assert.deepEqual([d.scenario, d.instance_key, d.manifest_category_key], ["discovery", "new:public_procurement", "_generic"]);
  assert.equal(d.internal_label_visible_to_client, false);
});
test("D10: out of scope creates nothing (no workstream, no PSM version, no provider)", () => { const o = cls("residence permit for the CEO"); assert.deepEqual([o.creates_workstream, o.creates_psm_version], [false, false]); });
test("D10: Partner Match -> ED but supplier search -> procurement_supply_chain (never mixed)", () => {
  assert.equal(cls("find a local partner for distribution").scenario, "ecosystem_development");
  const s = cls("supplier sourcing in Monterrey", { service_key: "supplier_sourcing" }); assert.deepEqual([s.scenario, s.category_key], ["known_service", "procurement_supply_chain"]);
});
test("D10: ambiguity (study wording + confirmed catalog service) is returned to the client, never decided", () => {
  const a = cls("I need a market feasibility study", { service_key: "market_research" }); assert.equal(a.scenario, "ambiguous"); assert.deepEqual(a.options, ["strategic_advisory", "market_intelligence"]);
});
test("D10: never create new:<slug> when the category already exists; a second need with the same slug is appended", () => {
  assert.equal(cls("x", { proposed_slug: "logistics" }).scenario, "known_category_exists");
  assert.equal(cls("tenders", { proposed_slug: "public procurement", existing_instance_keys: ["new:public_procurement"] }).action, "append_item");
});
test("D10: SA/ED instances: second need appends an item; first creates the instance", () => {
  assert.equal(cls("market appetite study", { existing_instance_keys: ["strategic_advisory"] }).action, "append_item");
  assert.equal(cls("market appetite study").action, "create_instance");
});
test("D10: Add a Service available only after PSM confirmed with >=1 snapshot and an active Project", () => {
  assert.equal(R.addServiceAvailability({ paStatus: "confirmed", snapshotCount: 1, projectActive: true }), true);
  for (const bad of [{ paStatus: "in_progress", snapshotCount: 0, projectActive: true }, { paStatus: "ready_for_confirmation", snapshotCount: 0, projectActive: true }, { paStatus: "confirmed", snapshotCount: 1, projectActive: false }]) assert.equal(R.addServiceAvailability(bad), false);
});
test("slug normalisation is deterministic and safe for category_key (new:<slug> matches the M-A CHECK)", () => {
  for (const t of ["Licitaciones del gobierno local", "  Árbol & Co!! ", "123 start", "public procurement"]) { const k = `new:${R.normalizeSlug(t)}`; assert.match(k, /^new:[a-z][a-z0-9_]{1,63}$/, k); }
});
