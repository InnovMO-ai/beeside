import { evaluateCategory, evaluateCategoryDetailed } from "../readiness";
import type { EvaluationInput, FactMap } from "../types";
import { bundledCategoryManifest, type CategoryManifestDoc } from "../bundled";
import { A, ALL_KEYS, NO, UNK, WH, load, wrap } from "./helpers";
import { drive } from "./driver";

const ev = (key: string, facts: FactMap, countries: string[] = []) => evaluateCategory({ manifest: load(key), facts, countries });
const evd = (key: string, facts: FactMap, countries: string[] = []) => evaluateCategoryDetailed({ manifest: load(key), facts, countries });
const keysOf = (r: ReturnType<typeof evaluateCategory>, list: "critical" | "pending" | "requirements"): string[] =>
  list === "critical" ? r.critical.map((c) => c.itemKey) : r[list].map((x) => x.fieldKey);

// ---------------------------------------------------------------- fixtures
const lgFlow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  origin_country: "CN", destination_country: "US", product: "finished electronics",
  volume: { value: 100, unit: "containers" }, frequency: "monthly", mode_of_transport: "ocean", ...o,
});
const lgBase = (): Record<string, ReturnType<typeof A>> => ({
  logistics_services_in_scope: A(["freight_transportation", "warehousing"]),
  logistics_operating_responsibility: A("self_managed"),
  logistics_primary_product_type: A("general_cargo"),
  logistics_flows: A([lgFlow()]),
  logistics_warehousing_needed: NO(),
  logistics_hazardous_materials_flag: NO(),
  logistics_import_export_license_status: A("have_valid"),
  logistics_customs_broker_status: A("engaged"),
});
const itcGood = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  description: "industrial fasteners", classification_status: "classified", tariff_code: "7318.15", origin_country: "CN", requires_permit_or_control: false, ...o,
});
const itcBase = (): Record<string, ReturnType<typeof A>> => ({
  customs_services_in_scope: A(["customs_brokerage", "import_export_compliance"]),
  customs_trade_direction: A("import"),
  customs_goods_profile: A([itcGood()]),
  customs_restricted_goods_flag: NO(),
  customs_operator_registration_status: A("registered"),
  customs_preferential_origin_interest: NO(),
});
const saStudy = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  objective: "Decide whether to enter the market", question: "Is there appetite?", subject_type: ["market"], subject_detail: "Specialty food retail",
  markets: ["MX"], expected_result: "Go / no-go recommendation", decisions: "Invest or not", ...o,
});
const saBase = (): Record<string, ReturnType<typeof A>> => ({ sa_capabilities: A(["CAP_SA_ME_APPETITE"]), sa_studies: A([saStudy()]) });
const lgaBase = (): Record<string, ReturnType<typeof A>> => ({
  legal_services_in_scope: A(["company_incorporation_corporate_setup"]),
  legal_entity_stage: A("no_entity_planned"),
});

describe("CAT-LG logistics", () => {
  it("CAT-LG-01 nothing known: 0 %, not ready, three open critical items, the blocking field is asked first", () => {
    const r = ev("logistics", {}, ["US"]);
    expect(r.totalRequired).toBe(6);
    expect(r.confirmedRequired).toBe(0);
    expect(r.progressPct).toBe(0);
    expect(r.ready).toBe(false);
    expect(keysOf(r, "critical")).toEqual(["logistics_operating_model_decision", "logistics_hazmat_compliance_decision", "logistics_flows_defined_decision"]);
    expect(r.nextFieldKey).toBe("logistics_operating_responsibility");
    expect(r.notApplicable).toEqual(expect.arrayContaining(["logistics_warehousing_details", "logistics_hazmat_ack", "logistics_cold_chain_required", "generic_unmapped_needs"]));
    expect(r.notApplicable).not.toContain("generic_has_unmapped_need"); // derived facts are not requirements at all
    expect(keysOf(r, "requirements")).not.toContain("generic_has_unmapped_need");
  });

  it("CAT-LG-02 happy path (US): every applicable required item confirmed -> 100 %, ready, nothing pending, nothing left to ask", () => {
    const r = ev("logistics", lgBase(), ["US"]);
    expect([r.totalRequired, r.confirmedRequired, r.progressPct]).toEqual([8, 8, 100]);
    expect(r.ready).toBe(true);
    expect(r.critical).toEqual([]);
    expect(r.pending).toEqual([]);
    expect(r.nextFieldKey).toBeNull();
  });

  it("CAT-LG-03 partial: a non-blocking required field not yet asked lowers progress but not readiness; it is listed as pending and asked next", () => {
    const f = lgBase();
    delete f.logistics_import_export_license_status;
    const r = ev("logistics", f, ["US"]);
    expect([r.confirmedRequired, r.totalRequired, r.progressPct]).toEqual([7, 8, 87]);
    expect(r.ready).toBe(true);
    expect(keysOf(r, "pending")).toEqual(["logistics_import_export_license_status"]);
    expect(r.nextFieldKey).toBe("logistics_import_export_license_status");
  });

  it("CAT-LG-04 blocking gap: hazmat flag UNKNOWN -> not ready, critical item is the compliance decision, field is NOT re-asked", () => {
    const f = lgBase();
    f.logistics_hazardous_materials_flag = UNK();
    const r = ev("logistics", f, ["US"]);
    expect(r.ready).toBe(false);
    expect(keysOf(r, "critical")).toEqual(["logistics_hazmat_compliance_decision"]);
    expect(r.critical[0]?.kind).toBe("path");
    expect(r.critical[0]?.label.es).toBeTruthy();
    expect(keysOf(r, "pending")).toEqual(["logistics_hazardous_materials_flag"]);
    expect(r.nextFieldKey).toBeNull(); // UNKNOWN / WITHHELD are not re-asked until the final review
    f.logistics_hazardous_materials_flag = WH();
    expect(ev("logistics", f, ["US"]).ready).toBe(false);
  });

  it("CAT-LG-05 ready at 66 %: blocking items resolved, three required items unasked/unconfirmed does not block", () => {
    const f = { ...lgBase() };
    delete f.logistics_services_in_scope;
    delete f.logistics_primary_product_type;
    const r = ev("logistics", { ...f, logistics_flows: A([lgFlow({ origin_country: "US" })]) }, ["US"]); // domestic flow -> licence/broker not applicable
    expect([r.totalRequired, r.confirmedRequired, r.progressPct]).toEqual([6, 4, 66]);
    expect(r.ready).toBe(true);
    expect(keysOf(r, "pending")).toEqual(["logistics_services_in_scope", "logistics_primary_product_type"]);
  });

  it("CAT-LG-06 100 % while a critical decision is open is NOT ready (ready is independent of progress)", () => {
    // contradiction: "lithium" in a flow while hazmat = No -> acknowledgement required; answer everything except nothing else is left
    const f = lgBase();
    f.logistics_flows = A([lgFlow({ product: "lithium-ion battery packs" })]);
    const open = ev("logistics", f, ["US"]);
    expect(open.ready).toBe(false);
    expect(keysOf(open, "critical")).toEqual(["logistics_hazmat_description_consistency_decision"]);
    expect(open.nextFieldKey).toBe("logistics_hazmat_ack");
    f.logistics_hazmat_ack = A("Packs ship under the small-cell exemption.");
    const closed = ev("logistics", f, ["US"]);
    expect(closed.ready).toBe(true);
    expect(closed.progressPct).toBe(100);
  });

  it("CAT-LG-07 repeatable group is ONE requirement: more lanes never change the denominator", () => {
    const one = ev("logistics", lgBase(), ["US"]);
    const f = lgBase();
    f.logistics_flows = A([lgFlow(), lgFlow({ origin_country: "US", destination_country: "MX", mode_of_transport: "road", frequency: "weekly" })]);
    const two = ev("logistics", f, ["US"]);
    expect([two.totalRequired, two.progressPct, two.ready]).toEqual([one.totalRequired, 100, true]);
  });

  it("CAT-LG-08 group item with a required sub-field never asked: group pending, server asks that sub-field of that item", () => {
    const f = lgBase();
    f.logistics_flows = A([lgFlow(), lgFlow({ volume: undefined })]);
    const d = evd("logistics", f, ["US"]);
    expect(d.evaluation.progressPct).toBeLessThan(100);
    expect(d.evaluation.requirements.find((q) => q.fieldKey === "logistics_flows")?.state).toBe("pending");
    expect(d.nextTarget).toEqual({ fieldKey: "logistics_flows", itemIndex: 1, subFieldKey: "volume" });
    expect(d.evaluation.nextFieldKey).toBe("logistics_flows");
    expect(d.evaluation.ready).toBe(true); // flows is `required`, not blocking
  });

  it("CAT-LG-09 group sub-field answered UNKNOWN (envelope): pending, not re-asked, does not block", () => {
    const f = lgBase();
    f.logistics_flows = A([lgFlow({ volume: wrap("UNKNOWN", null) })]);
    const d = evd("logistics", f, ["US"]);
    expect(d.evaluation.requirements.find((q) => q.fieldKey === "logistics_flows")?.state).toBe("pending");
    expect(d.nextTarget).toBeNull();
    expect(d.evaluation.ready).toBe(true);
    expect(d.details.logistics_flows?.group?.subs.find((s) => s.sub === "volume")?.state).toBe("pending");
  });

  it("CAT-LG-10 zero flows (min_items = 1): the group is pending, the flows decision blocks, the group is asked", () => {
    const f = lgBase();
    f.logistics_flows = A([]); // an empty ANSWERED array is a corrupt row -> never asked
    let r = ev("logistics", f, ["US"]);
    expect(r.ready).toBe(false);
    expect(keysOf(r, "critical")).toContain("logistics_flows_defined_decision");
    expect(r.nextFieldKey).toBe("logistics_flows");
    f.logistics_flows = { answerState: "UNKNOWN", value: [] };
    r = ev("logistics", f, ["US"]);
    expect(r.ready).toBe(false);
    expect(r.nextFieldKey).toBeNull();
  });

  it("CAT-LG-11 ASSUMED: counts as resolved for the blocking gate, never as confirmed, listed as assumed", () => {
    const f = lgBase();
    f.logistics_warehousing_needed = A(false, "ASSUMED");
    f.logistics_hazardous_materials_flag = A(false, "ASSUMED");
    const r = ev("logistics", f, ["US"]);
    expect(r.ready).toBe(true);
    expect(r.confirmedRequired).toBe(6);
    expect(r.progressPct).toBe(75);
    const assumed = r.pending.filter((p) => p.state === "assumed").map((p) => p.fieldKey);
    expect(assumed).toEqual(["logistics_warehousing_needed", "logistics_hazardous_materials_flag"]);
    expect(r.nextFieldKey).toBeNull();
  });

  it("CAT-LG-12 nextFieldKey ordering: blocking first, then manifest order; UNKNOWN fields are skipped; null when nothing is left", () => {
    const f: Record<string, ReturnType<typeof A>> = {};
    const order: Array<string | null> = [];
    const push = (): void => { order.push(ev("logistics", f, ["US"]).nextFieldKey); };
    push(); // blocking op responsibility
    f.logistics_operating_responsibility = A("self_managed"); push(); // the other blocking field, before manifest-first services
    f.logistics_hazardous_materials_flag = NO(); push(); // manifest order resumes
    f.logistics_services_in_scope = UNK(); push(); // UNKNOWN is not re-asked -> next in manifest order
    f.logistics_primary_product_type = A("general_cargo"); push();
    f.logistics_flows = A([lgFlow()]); push();
    f.logistics_warehousing_needed = NO(); push(); // now licence (conditional, international flow)
    f.logistics_import_export_license_status = WH(); push(); // WITHHELD skipped -> broker
    f.logistics_customs_broker_status = A("engaged"); push();
    expect(order).toEqual([
      "logistics_operating_responsibility", "logistics_hazardous_materials_flag", "logistics_services_in_scope", "logistics_primary_product_type",
      "logistics_flows", "logistics_warehousing_needed", "logistics_import_export_license_status", "logistics_customs_broker_status", null,
    ]);
  });

  describe("reachability per branch (G-C2/G-C3: field_asked on a NOT_APPLICABLE field is vacuously true)", () => {
    it("CAT-LG-20 third-party operator + international flow: customs broker is not applicable, the operating-model decision resolves", () => {
      const f = lgBase();
      f.logistics_operating_responsibility = A("third_party_logistics");
      delete f.logistics_customs_broker_status;
      const d = evd("logistics", f, ["US"]);
      expect(d.evaluation.notApplicable).toContain("logistics_customs_broker_status");
      expect(d.unresolvedDecisions.map((x) => x.decision_key)).not.toContain("logistics_operating_model_decision");
      expect(d.evaluation.ready).toBe(true);
    });
    it("CAT-LG-21 operator by self + international flow: the broker status is asked (applicable) and gets answered", () => {
      const f = lgBase();
      delete f.logistics_customs_broker_status;
      const r = ev("logistics", f, ["US"]);
      expect(r.nextFieldKey).toBe("logistics_customs_broker_status");
      expect(r.ready).toBe(true); // path decision for self-managed does not depend on the broker
    });
    it("CAT-LG-22 hazmat = Yes + domestic flows: licence not applicable -> compliance decision resolves vacuously", () => {
      const f = lgBase();
      f.logistics_hazardous_materials_flag = A(true);
      f.logistics_flows = A([lgFlow({ origin_country: "US", destination_country: "US" })]);
      delete f.logistics_import_export_license_status;
      delete f.logistics_customs_broker_status;
      const d = evd("logistics", f, ["US"]);
      expect(d.evaluation.notApplicable).toContain("logistics_import_export_license_status");
      expect(d.unresolvedDecisions).toEqual([]);
      expect(d.evaluation.ready).toBe(true);
    });
    it("CAT-LG-23 hazmat = Yes + international flows + licence never asked: decision stays open (blocking) until the licence is asked", () => {
      const f = lgBase();
      f.logistics_hazardous_materials_flag = A(true);
      delete f.logistics_import_export_license_status;
      const open = ev("logistics", f, ["US"]);
      expect(open.ready).toBe(false);
      expect(keysOf(open, "critical")).toEqual(["logistics_hazmat_compliance_decision"]);
      f.logistics_import_export_license_status = UNK(); // asked, answer unknown -> the path decision only needs it to have been asked
      expect(ev("logistics", f, ["US"]).ready).toBe(true);
    });
    it("CAT-LG-24 contradiction: dangerous-goods wording in a lane while hazmat = No needs the acknowledgement; hazmat = Yes does not", () => {
      const f = lgBase();
      f.logistics_flows = A([lgFlow({ product: "aerosol cans" })]);
      const d = evd("logistics", f, ["US"]);
      expect(d.unresolvedDecisions.map((x) => x.decision_key)).toEqual(["logistics_hazmat_description_consistency_decision"]);
      expect(d.evaluation.critical[0]?.kind).toBe("consistency");
      expect(d.evaluation.requirements.find((q) => q.fieldKey === "logistics_hazmat_ack")?.applicable).toBe(true);
      f.logistics_hazardous_materials_flag = A(true);
      expect(ev("logistics", f, ["US"]).critical.map((c) => c.itemKey)).not.toContain("logistics_hazmat_description_consistency_decision");
    });
    it("CAT-LG-25 exhaustive driver: from any sampled branch the engine reaches ready / 100 % / nothing left to ask (no dead end) for every overlay scope", () => {
      const m = bundledCategoryManifest("logistics") as CategoryManifestDoc;
      const scopes = [[], ["US"], ["MX"], ["DE"], ["US", "DE"], ["US", "MX"]];
      let runs = 0;
      for (const countries of scopes) {
        for (let seed = 1; seed <= 80; seed++) {
          const { ev: e, steps } = drive(m, { seed, countries });
          expect({ scope: countries.join("+"), seed, ready: e.evaluation.ready, next: e.evaluation.nextFieldKey, pct: e.evaluation.progressPct, steps: steps < 300 }).toEqual({ scope: countries.join("+"), seed, ready: true, next: null, pct: 100, steps: true });
          runs += 1;
        }
      }
      expect(runs).toBe(480);
    });
  });

  describe("country overlays", () => {
    it("CAT-LG-30 deactivate: US and MX remove the VAT-deferment question that is asked without a country overlay", () => {
      const f = lgBase();
      expect(ev("logistics", f, []).totalRequired).toBe(9);
      expect(ev("logistics", f, []).nextFieldKey).toBe("logistics_vat_deferment_scheme_interest");
      for (const c of ["US", "MX"]) {
        const r = ev("logistics", f, [c]);
        // a deactivated field leaves the effective manifest altogether: not a requirement, not even "not applicable"
        expect(keysOf(r, "requirements")).not.toContain("logistics_vat_deferment_scheme_interest");
        expect(r.totalRequired).toBe(8);
      }
    });
    it("CAT-LG-31 add: DE adds the EORI question (required) only for an international flow touching the EU", () => {
      const f = lgBase();
      f.logistics_flows = A([lgFlow({ origin_country: "DE", destination_country: "US" })]);
      const r = ev("logistics", f, ["DE"]);
      expect(r.requirements.find((q) => q.fieldKey === "logistics_eori_number_status")).toMatchObject({ applicable: true, level: "required", state: "pending" });
      expect(r.nextFieldKey).toBe("logistics_vat_deferment_scheme_interest"); // base fields first; overlay additions follow in manifest order
      f.logistics_vat_deferment_scheme_interest = NO();
      expect(ev("logistics", f, ["DE"]).nextFieldKey).toBe("logistics_eori_number_status");
      f.logistics_eori_number_status = A("have_valid");
      expect(ev("logistics", f, ["DE"]).nextFieldKey).toBeNull();
      expect(ev("logistics", lgBase(), ["US"]).requirements.some((q) => q.fieldKey === "logistics_eori_number_status")).toBe(false);
    });
    it("CAT-LG-32 add + rule: US asks the FDA prior-notice question only for perishable food", () => {
      const f = lgBase();
      expect(ev("logistics", f, ["US"]).requirements.find((q) => q.fieldKey === "logistics_fda_prior_notice_required")?.applicable).toBe(false);
      f.logistics_primary_product_type = A("food_beverage_perishable");
      const r = ev("logistics", f, ["US"]);
      expect(r.requirements.find((q) => q.fieldKey === "logistics_fda_prior_notice_required")?.applicable).toBe(true);
      expect(r.requirements.find((q) => q.fieldKey === "logistics_cold_chain_required")?.applicable).toBe(true);
      expect(r.notApplicable).not.toContain("logistics_fda_prior_notice_required");
    });
    it("CAT-LG-33 multi-country scope unions the overlays (US + DE): VAT stays (DE keeps it) and EORI/FDA appear when their rule holds", () => {
      const f = lgBase();
      f.logistics_primary_product_type = A("food_beverage_perishable");
      f.logistics_flows = A([lgFlow({ origin_country: "DE", destination_country: "US" })]);
      const r = ev("logistics", f, ["US", "DE"]);
      const keys = keysOf(r, "requirements");
      expect(keys).toEqual(expect.arrayContaining(["logistics_vat_deferment_scheme_interest", "logistics_eori_number_status", "logistics_fda_prior_notice_required"]));
      expect(keysOf(ev("logistics", f, ["US", "MX"]), "requirements")).not.toContain("logistics_vat_deferment_scheme_interest");
    });
    it("CAT-LG-34 an unknown country (no overlay) behaves like no country", () => {
      expect(ev("logistics", lgBase(), ["ZZ"])).toEqual(ev("logistics", lgBase(), []));
    });
  });

  it("CAT-LG-40 derived fact: when the classification flags an out-of-catalog need the unmapped-needs group becomes a requirement (denominator rises)", () => {
    const f = lgBase();
    const before = ev("logistics", f, ["US"]);
    f.generic_has_unmapped_need = A(true);
    const after = ev("logistics", f, ["US"]);
    expect(after.totalRequired).toBe(before.totalRequired + 1);
    expect(after.progressPct).toBeLessThan(100);
    expect(after.nextFieldKey).toBe("generic_unmapped_needs");
    expect(after.ready).toBe(true); // conditional, not blocking
  });
});

describe("CAT-ITC international trade and customs", () => {
  it("CAT-ITC-01 happy path without country overlay: 6/6, ready", () => {
    const r = ev("international_trade_customs", itcBase());
    expect([r.totalRequired, r.confirmedRequired, r.progressPct, r.ready, r.nextFieldKey]).toEqual([6, 6, 100, true, null]);
  });
  it("CAT-ITC-02 MX overlay adds the importers-registry question for imports (conditional, counted, asked)", () => {
    const r = ev("international_trade_customs", itcBase(), ["MX"]);
    expect([r.totalRequired, r.progressPct, r.ready, r.nextFieldKey]).toEqual([7, 85, true, "customs_mx_importers_registry_status"]);
    expect(ev("international_trade_customs", { ...itcBase(), customs_trade_direction: A("export") }, ["MX"]).totalRequired).toBe(6);
  });
  it("CAT-ITC-03 blocking gap: trade direction UNKNOWN blocks through the scope decision; goods group still counts", () => {
    const r = ev("international_trade_customs", { ...itcBase(), customs_trade_direction: UNK() });
    expect(r.ready).toBe(false);
    expect(keysOf(r, "critical")).toEqual(["customs_trade_scope_decision"]);
    expect(r.nextFieldKey).toBeNull();
  });
  it("CAT-ITC-04 restricted-goods contradiction: goods wording (Spanish or English) with the flag at No needs the acknowledgement", () => {
    for (const description of ["lote de alimento para mascotas", "chemical solvents"]) {
      const f = { ...itcBase(), customs_goods_profile: A([itcGood({ description })]) };
      const r = ev("international_trade_customs", f);
      expect(r.ready).toBe(false);
      expect(keysOf(r, "critical")).toEqual(["customs_restricted_goods_consistency_decision"]);
      expect(r.nextFieldKey).toBe("customs_restricted_goods_ack");
    }
  });
  it("CAT-ITC-05 flag Yes: restricted path needs the operator-registration question to have been asked (it is a required, unconditional field)", () => {
    const f = { ...itcBase(), customs_restricted_goods_flag: A(true) };
    delete (f as Record<string, unknown>).customs_operator_registration_status;
    const r = ev("international_trade_customs", f);
    expect(r.ready).toBe(false);
    expect(keysOf(r, "critical")).toEqual(["customs_controls_path_decision"]);
    expect(r.nextFieldKey).toBe("customs_operator_registration_status");
  });
  it("CAT-ITC-06 repeatable group item missing a conditional sub-field with no authored rule (G-C1): counted as required, asked per item", () => {
    const f = { ...itcBase(), customs_goods_profile: A([itcGood({ tariff_code: undefined })]) };
    const d = evd("international_trade_customs", f);
    expect(d.nextTarget).toEqual({ fieldKey: "customs_goods_profile", itemIndex: 0, subFieldKey: "tariff_code" });
    expect(d.evaluation.ready).toBe(true);
    expect(d.evaluation.progressPct).toBe(83);
  });
  it("CAT-ITC-07 tariff code UNKNOWN inside an item is pending (not asked again) while the other items are fine", () => {
    const f = { ...itcBase(), customs_goods_profile: A([itcGood({ tariff_code: wrap("UNKNOWN", null) }), itcGood({ description: "steel brackets" })]) };
    const d = evd("international_trade_customs", f);
    expect(d.nextTarget).toBeNull();
    expect(d.evaluation.pending.map((p) => p.fieldKey)).toEqual(["customs_goods_profile"]);
  });
  it("CAT-ITC-08 exhaustive driver for every overlay scope", () => {
    const m = bundledCategoryManifest("international_trade_customs") as CategoryManifestDoc;
    for (const countries of [[], ["MX"], ["US"], ["MX", "US"]]) {
      for (let seed = 1; seed <= 60; seed++) {
        const e = drive(m, { seed, countries }).ev.evaluation;
        expect([e.ready, e.nextFieldKey, e.progressPct]).toEqual([true, null, 100]);
      }
    }
  });
});

describe("CAT-LGA corporate, legal and administrative", () => {
  it("CAT-LGA-01 no entity planned: only scope and stage are required", () => {
    const r = ev("corporate_legal_admin", lgaBase(), ["MX"]);
    expect([r.totalRequired, r.progressPct, r.ready, r.nextFieldKey]).toEqual([2, 100, true, null]);
    expect(r.notApplicable).toEqual(expect.arrayContaining(["legal_entity_form_preference", "legal_shareholder_structure", "legal_registered_address_status"]));
  });
  it("CAT-LGA-02 entity stage branch: deciding to incorporate activates form, shareholders and address; the path decision needs the form question asked", () => {
    const f = { ...lgaBase(), legal_entity_stage: A("decided_to_incorporate") };
    const r = ev("corporate_legal_admin", f, ["MX"]);
    expect(r.totalRequired).toBe(5);
    expect(r.nextFieldKey).toBe("legal_entity_form_preference");
    expect(r.ready).toBe(false);
    expect(keysOf(r, "critical")).toEqual(["legal_entity_path_decision"]);
    const full = { ...f, legal_entity_form_preference: A("Limited liability company"), legal_shareholder_structure: A([{ holder_type: "company", holder_country: "US" }]), legal_registered_address_status: A("needs_corporate_address") };
    const done = ev("corporate_legal_admin", full, ["MX"]);
    expect([done.progressPct, done.ready, done.nextFieldKey]).toEqual([100, true, null]);
  });
  it("CAT-LGA-03 services branch: selecting contract services activates the contract-workstream group and its decision blocks until one exists", () => {
    const f = { ...lgaBase(), legal_services_in_scope: A(["commercial_contracts"]) };
    const r = ev("corporate_legal_admin", f, ["MX"]);
    expect(r.requirements.find((q) => q.fieldKey === "legal_contract_workstreams")?.applicable).toBe(true);
    expect(r.ready).toBe(false);
    expect(keysOf(r, "critical")).toEqual(["legal_document_workstreams_defined_decision"]);
    expect(r.nextFieldKey).toBe("legal_contract_workstreams");
    const withItem = { ...f, legal_contract_workstreams: A([{ contract_type: "distribution", counterparty_type: "distributor_or_agent", starting_point: "from_scratch" }]) };
    const done = ev("corporate_legal_admin", withItem, ["MX"]);
    expect([done.ready, done.progressPct, done.nextFieldKey]).toEqual([true, 100, null]);
  });
  it("CAT-LGA-04 a contract item still missing a required sub-field stays pending and is asked at item level", () => {
    const f = { ...lgaBase(), legal_services_in_scope: A(["commercial_contracts"]), legal_contract_workstreams: A([{ contract_type: "distribution" }]) };
    const d = evd("corporate_legal_admin", f, ["MX"]);
    expect(d.nextTarget).toEqual({ fieldKey: "legal_contract_workstreams", itemIndex: 0, subFieldKey: "counterparty_type" });
    expect(d.evaluation.ready).toBe(true);
  });
  it("CAT-LGA-05 operational pending items become information required later (never requirements)", () => {
    const f = { ...lgaBase(), legal_entity_stage: A("decided_to_incorporate") };
    const d = evd("corporate_legal_admin", f, ["MX"]);
    expect(d.operationalPending.map((p) => p.pending_item_key)).toEqual(["legal_constitutive_documents_pending"]);
    expect(keysOf(d.evaluation, "requirements")).not.toContain("legal_constitutive_documents_pending");
  });
  it("CAT-LGA-06 exhaustive driver", () => {
    const m = bundledCategoryManifest("corporate_legal_admin") as CategoryManifestDoc;
    for (const countries of [[], ["MX"]]) {
      for (let seed = 1; seed <= 100; seed++) {
        const e = drive(m, { seed, countries }).ev.evaluation;
        expect([e.ready, e.nextFieldKey, e.progressPct]).toEqual([true, null, 100]);
      }
    }
  });
});

describe("CAT-SA strategic advisory (light intake)", () => {
  it("CAT-SA-01 nothing known: the blocking studies are asked before the capabilities", () => {
    const r = ev("strategic_advisory", {});
    expect([r.totalRequired, r.progressPct, r.ready, r.nextFieldKey]).toEqual([2, 0, false, "sa_studies"]);
    expect(keysOf(r, "critical")).toEqual(["sa_need_defined_decision"]);
  });
  it("CAT-SA-02 one complete study: 100 %, ready", () => {
    const r = ev("strategic_advisory", saBase());
    expect([r.progressPct, r.ready, r.nextFieldKey, r.pending]).toEqual([100, true, null, []]);
  });
  it("CAT-SA-03 'I do not know' on the execution-dependent sub-fields: ready (pending is never a blocker), 50 %, pending lists the study, nothing is re-asked", () => {
    const study = saStudy({ subject_detail: wrap("UNKNOWN", null), markets: wrap("UNKNOWN", null) });
    const d = evd("strategic_advisory", { sa_capabilities: A(["CAP_SA_ME_APPETITE"]), sa_studies: A([study]) });
    expect([d.evaluation.progressPct, d.evaluation.ready, d.evaluation.nextFieldKey]).toEqual([50, true, null]);
    expect(d.evaluation.pending.map((p) => [p.fieldKey, p.executionDependency])).toEqual([["sa_studies", true]]);
    const subs = d.details.sa_studies?.group?.subs.filter((s) => s.state === "pending");
    expect(subs?.map((s) => [s.sub, s.executionDependency])).toEqual([["subject_detail", true], ["markets", true]]);
  });
  it("CAT-SA-04 ASSUMED sub-field: group is 'assumed', ready, not confirmed", () => {
    const study = saStudy({ markets: wrap("ASSUMED", ["MX"]) });
    const r = ev("strategic_advisory", { sa_capabilities: A(["CAP_SA_ME_APPETITE"]), sa_studies: A([study]) });
    expect(r.requirements.find((q) => q.fieldKey === "sa_studies")?.state).toBe("assumed");
    expect([r.ready, r.progressPct]).toEqual([true, 50]);
  });
  it("CAT-SA-05 a study with a required sub-field never asked is a blocking gap reported under its own field and asked at item level", () => {
    const study = saStudy();
    delete study.expected_result;
    const d = evd("strategic_advisory", { sa_capabilities: A(["CAP_SA_ME_APPETITE"]), sa_studies: A([study]) });
    expect(d.evaluation.ready).toBe(false);
    expect(d.evaluation.critical).toEqual([expect.objectContaining({ itemKey: "sa_studies", kind: "field" })]);
    expect(d.nextTarget).toEqual({ fieldKey: "sa_studies", itemIndex: 0, subFieldKey: "expected_result" });
  });
  it("CAT-SA-06 a second study is appended without changing the denominator; an incomplete second study re-opens the gap", () => {
    const two = ev("strategic_advisory", { sa_capabilities: A(["CAP_SA_ME_APPETITE"]), sa_studies: A([saStudy(), saStudy({ objective: "Second study" })]) });
    expect([two.totalRequired, two.progressPct, two.ready]).toEqual([2, 100, true]);
    const incomplete = ev("strategic_advisory", { sa_capabilities: A(["CAP_SA_ME_APPETITE"]), sa_studies: A([saStudy(), { objective: "Second study" }]) });
    expect([incomplete.ready, incomplete.progressPct]).toEqual([false, 50]);
  });
  it("CAT-SA-07 exhaustive driver (also ecosystem_development and _generic)", () => {
    for (const key of ["strategic_advisory", "ecosystem_development", "_generic"]) {
      const m = bundledCategoryManifest(key) as CategoryManifestDoc;
      for (let seed = 1; seed <= 30; seed++) {
        const e = drive(m, { seed, countries: [] }).ev.evaluation;
        expect([key, e.ready, e.nextFieldKey, e.progressPct]).toEqual([key, true, null, 100]);
      }
    }
  });
});

describe("CAT-GEN cross-cutting rules", () => {
  it("CAT-GEN-01 G-C2: 100 % with an open critical decision is not ready (people_payroll_employment statutory benefits answered No)", () => {
    const m = bundledCategoryManifest("people_payroll_employment") as CategoryManifestDoc;
    const done = drive(m, { seed: 7, countries: ["MX"] }).facts;
    done.hr_statutory_benefits_confirmation = NO();
    const r = evaluateCategory({ manifest: m, facts: done, countries: ["MX"] });
    expect(r.progressPct).toBe(100);
    expect(r.ready).toBe(false);
    expect(r.critical.map((c) => c.itemKey)).toEqual(["hr_statutory_benefits_decision"]);
  });
  it("CAT-GEN-02 known content defect G-C2 is the ONLY dead end in the shipped manifests (every other manifest completes from every sampled branch)", () => {
    const dead: Record<string, Set<string>> = {};
    for (const key of ALL_KEYS) {
      const m = bundledCategoryManifest(key) as CategoryManifestDoc;
      for (const countries of [[], ...Object.keys(m.country_overlays).map((c) => [c])]) {
        for (let seed = 1; seed <= 40; seed++) {
          const e = drive(m, { seed, countries }).ev.evaluation;
          if (!(e.ready && e.nextFieldKey === null && e.progressPct === 100)) (dead[key] ||= new Set()).add(e.critical.map((c) => c.itemKey).join(","));
        }
      }
    }
    expect(Object.fromEntries(Object.entries(dead).map(([k, v]) => [k, [...v]]))).toEqual({ people_payroll_employment: ["hr_statutory_benefits_decision"] });
  });
  it("CAT-GEN-03 total = 0 -> progress null and never ready", () => {
    const manifest = { ...load("strategic_advisory"), fields: [{ field_key: "sa_note", type: "text", label: { en: "Note", es: "Nota" }, requirement_level: "supporting" as const }], critical_decisions: [] };
    const r = evaluateCategory({ manifest, facts: {}, countries: [] });
    expect([r.totalRequired, r.progressPct, r.ready, r.nextFieldKey]).toEqual([0, null, false, null]);
  });
  it("CAT-GEN-04 optional fields (supporting/informational) never count, never block, never appear in pending, never are asked", () => {
    const f = lgBase();
    const base = ev("logistics", f, ["US"]);
    f.logistics_insurance_coverage_status = UNK();
    f.logistics_lead_time_expectations = A("2 weeks");
    const r = ev("logistics", f, ["US"]);
    expect([r.totalRequired, r.confirmedRequired, r.progressPct]).toEqual([base.totalRequired, base.confirmedRequired, base.progressPct]);
    expect(keysOf(r, "pending")).toEqual([]);
    expect(r.requirements.find((q) => q.fieldKey === "logistics_insurance_coverage_status")?.level).toBe("supporting");
  });
  it("CAT-GEN-05 answer states: EXPLICIT_NO and ZERO confirm; UNKNOWN, WITHHELD, ASSUMED, NOT_ASKED do not; an ANSWERED fact without a value is a corrupt row (not asked)", () => {
    const state = (fact: ReturnType<typeof A> | undefined) => ev("logistics", { ...lgBase(), logistics_warehousing_needed: fact }, ["US"]).requirements.find((q) => q.fieldKey === "logistics_warehousing_needed")?.state;
    expect(state(NO())).toBe("confirmed");
    expect(state({ answerState: "ZERO", value: 0 })).toBe("confirmed");
    expect(state(A(true))).toBe("confirmed");
    expect(state(UNK())).toBe("pending");
    expect(state(WH())).toBe("pending");
    expect(state(A(true, "ASSUMED"))).toBe("assumed");
    expect(state(undefined)).toBe("pending");
    expect(state(A(null))).toBe("pending");
  });
  it("CAT-GEN-06 deterministic and pure: same input twice -> equal result; inputs are not mutated; requirements follow manifest order", () => {
    const manifest = load("logistics");
    const facts = lgBase();
    const before = JSON.stringify({ manifest, facts });
    const input: EvaluationInput = { manifest, facts, countries: ["us", "US", " DE "] };
    const a = evaluateCategory(input);
    const b = evaluateCategory(input);
    expect(a).toEqual(b);
    expect(JSON.stringify({ manifest, facts })).toBe(before);
    const order = manifest.fields.map((f) => f.field_key).filter((k) => a.requirements.some((q) => q.fieldKey === k));
    expect(a.requirements.map((q) => q.fieldKey).slice(0, order.length)).toEqual(order);
  });
  it("CAT-GEN-07 criticality never weights progress: the same confirmed count gives the same percentage whether the missing item is blocking or not", () => {
    const f1 = lgBase();
    delete f1.logistics_operating_responsibility; // blocking missing
    const f2 = lgBase();
    delete f2.logistics_primary_product_type; // required missing
    expect(ev("logistics", f1, ["US"]).progressPct).toBe(ev("logistics", f2, ["US"]).progressPct);
  });
  it("CAT-GEN-08 an inapplicable field never counts even if the client had answered it before the rule turned false", () => {
    const f = lgBase();
    f.logistics_warehousing_details = A("2,000 pallets"); // warehousing_needed = No -> details not applicable
    const r = ev("logistics", f, ["US"]);
    expect(r.notApplicable).toContain("logistics_warehousing_details");
    expect(r.totalRequired).toBe(8);
  });
  it("CAT-GEN-09 the percentage floors (never rounds up to 100 with a missing item)", () => {
    const f = lgBase();
    delete f.logistics_customs_broker_status; // 7 of 8 -> 87.5 -> 87
    expect(ev("logistics", f, ["US"]).progressPct).toBe(87);
  });
});
