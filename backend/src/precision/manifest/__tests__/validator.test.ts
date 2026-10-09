import { validateManifest, validateProjectManifest, CROSSWALK_SERVICE_ADDITIONS, type Finding, type RegistryEntry } from "../validator";
import { ALL_KEYS, PM, catalog, load } from "./helpers";

const additions = [...CROSSWALK_SERVICE_ADDITIONS];
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const errs = (m: unknown, ctx = {}): Finding[] => validateManifest(m, ctx).filter((x) => x.severity === "error");
const has = (arr: Finding[], check: string, re?: RegExp): boolean => arr.some((x) => x.check === check && (!re || re.test(x.message)));

describe("manifest validator (port of Gate D)", () => {
  it("all 8 shipped manifests pass with zero errors and zero warnings (one key, one meaning across the set)", () => {
    const registry = new Map<string, RegistryEntry>();
    let total = 0;
    for (const k of ALL_KEYS) {
      const m = load(k);
      expect(validateManifest(m, { registry, catalog, additions })).toEqual([]);
      total += m.fields.length;
    }
    expect(total).toBeGreaterThan(80);
  });

  it("Project Manifest v2 passes (19 candidates = 17 catalog + 2 reserved; all 20 FA 4.0 Fronts covered)", () => {
    const pm = PM();
    const fronts = (pm.fa4_front_signals as Array<{ front: string }>).map((x) => x.front);
    expect(fronts).toHaveLength(20);
    const manifests = new Map(ALL_KEYS.map((k) => [k, load(k)]));
    expect(validateProjectManifest(pm, { catalogCategories: Object.keys(catalog), manifests, fronts })).toEqual([]);
    expect(Object.keys(catalog)).toHaveLength(17);
  });

  it("mutation: unknown field in a rule", () => {
    const m = load("logistics");
    (m.critical_decisions[0] as any).resolution_rule.rules[0].field_key = "nope";
    expect(has(errs(m), "3.reference", /unknown field 'nope'/)).toBe(true);
  });
  it("mutation: decision reads a field not in depends_on_fields", () => {
    const m = load("logistics");
    (m.critical_decisions[0] as any).depends_on_fields.pop();
    expect(has(errs(m), "5.rule", /not listed in depends_on_fields/)).toBe(true);
  });
  it("mutation: enum value duplicating answer_state semantics ('unknown')", () => {
    const m = load("logistics");
    m.fields.find((f) => f.field_key === "logistics_insurance_coverage_status")!.values!.push("unknown");
    expect(has(errs(m), "1.schema", /answer_state/)).toBe(true);
  });
  it("mutation: provider name in a universal manifest", () => {
    const m = load("logistics");
    (m.fields[1] as any).notes = "prefer DHL for express";
    expect(has(errs(m), "6.forbidden", /DHL/)).toBe(true);
  });
  it("mutation: score / coverage keys are forbidden", () => {
    const m = load("tax_accounting_audit");
    (m.fields[1] as any).readiness_score = 3;
    (m.fields[2] as any).coverage = "core";
    const e = errs(m);
    expect(has(e, "6.forbidden", /readiness_score/) && has(e, "6.forbidden", /coverage/)).toBe(true);
  });
  it("mutation: overlay deactivates a key absent from base (hygiene A)", () => {
    const m = load("logistics");
    m.country_overlays.US!.deactivate!.push("ghost_field");
    expect(has(errs(m), "4.overlay", /silent no-op/)).toBe(true);
  });
  it("mutation: overlay adds a key that already exists in base", () => {
    const m = load("people_payroll_employment");
    m.country_overlays.MX!.add!.push(clone(m.fields[1]!));
    expect(has(errs(m), "4.overlay", /already exists in base/)).toBe(true);
  });
  it("mutation: overlay patch tries to change type/values (rejected, D1)", () => {
    const m = load("logistics");
    (m.country_overlays.US!.modify![0]!.patch as any).values = ["x"];
    expect(has(errs(m), "4.overlay", /not allowed/)).toBe(true);
  });
  it("mutation: same added key with different values across overlays (D1 conflict)", () => {
    const m = load("logistics");
    const f = clone(m.country_overlays.DE!.add![0]!) as any;
    f.values = ["only_one"];
    m.country_overlays.US!.add!.push(f);
    expect(has(errs(m), "4.overlay", /different type\/values/)).toBe(true);
  });
  it("mutation: one key two meanings across manifests", () => {
    const registry = new Map<string, RegistryEntry>();
    const a = load("logistics");
    const b = load("people_payroll_employment");
    const idx = b.fields.findIndex((f) => f.field_key === "generic_unmapped_needs");
    const bad = clone(b.fields[idx]!);
    bad.group_item_schema!.pop();
    b.fields[idx] = bad;
    validateManifest(a, { registry });
    expect(has(validateManifest(b, { registry }), "2.one_key_one_meaning", /defined differently/)).toBe(true);
  });
  it("mutation: catalog service missing / foreign in *_services_in_scope", () => {
    const m = load("international_trade_customs");
    m.fields[0]!.values = m.fields[0]!.values!.filter((v) => v !== "immex");
    m.fields[0]!.values!.push("made_up_service");
    const e = errs(m, { catalog, additions });
    expect(has(e, "10.catalog", /missing/) && has(e, "10.catalog", /made_up_service/)).toBe(true);
  });
  it("mutation: PUBLISHABLE without a domain validator is rejected", () => {
    const m = load("logistics");
    m.manifest_status = "PUBLISHABLE";
    expect(has(errs(m), "8.validator", /requires a registered domain validator/)).toBe(true);
  });
  it("mutation: threshold without change_threshold", () => {
    const m = load("logistics");
    delete m.fields.find((x) => x.field_key === "logistics_inventory_profile")!.change_threshold;
    expect(has(errs(m), "1.schema", /change_threshold/)).toBe(true);
  });
  it("mutation: consistency decision without a single *_ack field", () => {
    const m = load("logistics");
    const d = (m.critical_decisions as any[]).find((x) => x.kind === "consistency");
    d.depends_on_fields = d.depends_on_fields.filter((k: string) => !k.endsWith("_ack"));
    expect(errs(m).some((x) => x.check === "5.rule")).toBe(true);
  });
  it("mutation: wrong enum value inside an applicability rule (typo)", () => {
    const m = load("logistics");
    (m.fields.find((f) => f.field_key === "logistics_cold_chain_required")!.applicability_rule as any).values.push("pharma");
    expect(has(errs(m), "3.reference", /not an allowed value/)).toBe(true);
  });
  it("satisfiability: the MB3 pilot rule for hr_entity_consistency_ack is flagged unreachable", () => {
    const m = load("people_payroll_employment");
    m.fields.find((f) => f.field_key === "hr_local_entity_status")!.applicability_rule = { op: "field_equals", field_key: "hr_employment_model", value: "direct_entity" };
    expect(has(validateManifest(m, {}), "11.satisfiability", /unreachable/)).toBe(true);
  });
  it("Project Manifest mutations: missing front, reserved kind, wrong classification order", () => {
    const pm = clone(PM()) as any;
    const fronts = PM().fa4_front_signals as Array<{ front: string }>;
    pm.fa4_front_signals = pm.fa4_front_signals.slice(1);
    expect(validateProjectManifest(pm, { fronts: fronts.map((x) => x.front) }).some((x) => x.check === "P5.fronts")).toBe(true);
    const p2 = clone(PM()) as any;
    p2.candidate_categories.find((c: any) => c.category_key === "strategic_advisory").kind = "catalog";
    expect(validateProjectManifest(p2, {}).some((x) => x.check === "P1.reserved")).toBe(true);
    const p3 = clone(PM()) as any;
    p3.add_a_service.classification_order.reverse();
    expect(validateProjectManifest(p3, {}).some((x) => x.check === "P9.classification")).toBe(true);
  });
});
