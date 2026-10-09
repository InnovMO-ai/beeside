import { evaluateRule, ruleFieldRefs, validateRule, unwrapItemValue, type Rule } from "../ast";
import { evaluateResolutionRule } from "../../critical-decisions";
import { effectiveFields, effectiveFieldsMulti, findOverlayFieldKeysMissingFromBase, normalizeCountries } from "../effective-fields";
import { A, ALL_KEYS, UNK, load, wrap } from "./helpers";

describe("rule AST (MB4 base + E1 + ASSUMED)", () => {
  it("MB4 truth table: operating_model / legal_entity_status", () => {
    const rule: Rule = { op: "and", rules: [{ op: "field_answered", field_key: "operating_model" }, { op: "or", rules: [{ op: "not", rule: { op: "field_equals", field_key: "operating_model", value: "direct_entity" } }, { op: "field_answered", field_key: "legal_entity_status" }] }] };
    expect(evaluateRule(rule, {})).toBe(false);
    expect(evaluateRule(rule, { operating_model: A("distributor") })).toBe(true);
    expect(evaluateRule(rule, { operating_model: A("direct_entity") })).toBe(false);
    expect(evaluateRule(rule, { operating_model: A("direct_entity"), legal_entity_status: A("incorporated") })).toBe(true);
  });

  it("ASSUMED counts as answered for rule evaluation; UNKNOWN does not", () => {
    expect(evaluateRule({ op: "field_answered", field_key: "x" }, { x: A(5, "ASSUMED") })).toBe(true);
    expect(evaluateRule({ op: "field_answered", field_key: "x" }, { x: UNK() })).toBe(false);
    expect(evaluateRule({ op: "field_equals", field_key: "x", value: 5 }, { x: A(5, "ASSUMED") })).toBe(true);
    expect(evaluateRule({ op: "field_in", field_key: "x", values: [4, 5] }, { x: A(5, "ASSUMED") })).toBe(true);
    expect(evaluateRule({ op: "field_not_answered", field_key: "x" }, { x: A(5, "ASSUMED") })).toBe(false);
  });

  it("E1 ops: contains / any_item_equals / in / differs", () => {
    const f = { svc: A(["a", "b"]), flows: A([{ o: "CN", d: "US" }, { o: "US", d: "US" }]) };
    expect(evaluateRule({ op: "field_contains", field_key: "svc", value: "b" }, f)).toBe(true);
    expect(evaluateRule({ op: "field_contains", field_key: "svc", value: "z" }, f)).toBe(false);
    expect(evaluateRule({ op: "field_contains", field_key: "svc", value: "b" }, { svc: UNK() })).toBe(false);
    expect(evaluateRule({ op: "group_any_item_equals", field_key: "flows", item_field_key: "d", value: "US" }, f)).toBe(true);
    expect(evaluateRule({ op: "group_any_item_in", field_key: "flows", item_field_key: "o", values: ["MX", "CN"] }, f)).toBe(true);
    const differs: Rule = { op: "group_any_item_differs", field_key: "flows", item_field_a: "o", item_field_b: "d" };
    expect(evaluateRule(differs, f)).toBe(true);
    expect(evaluateRule(differs, { flows: A([{ o: "US", d: "US" }]) })).toBe(false);
    expect(evaluateRule(differs, {})).toBe(false);
    expect(validateRule({ op: "group_any_item_in", field_key: "g", item_field_key: "i", values: [] })).not.toBeNull();
  });

  it("E1 ops compose inside and/or/not together with base ops", () => {
    const f = { flows: A([{ o: "CN", d: "US" }]), flag: A(true) };
    const r: Rule = { op: "and", rules: [{ op: "not", rule: { op: "group_any_item_equals", field_key: "flows", item_field_key: "o", value: "MX" } }, { op: "or", rules: [{ op: "field_equals", field_key: "flag", value: false }, { op: "group_any_item_differs", field_key: "flows", item_field_a: "o", item_field_b: "d" }] }] };
    expect(evaluateRule(r, f)).toBe(true);
    expect(validateRule(r)).toBeNull();
    expect(ruleFieldRefs(r).sort()).toEqual(["flag", "flows", "flows"]);
  });

  it("item values carrying the answer_state envelope are looked through by item ops", () => {
    const f = { flows: A([{ o: wrap("UNKNOWN", null), d: "US" }, { o: wrap("ANSWERED", "CN"), d: "US" }]) };
    expect(evaluateRule({ op: "group_any_item_differs", field_key: "flows", item_field_a: "o", item_field_b: "d" }, f)).toBe(true);
    expect(evaluateRule({ op: "group_any_item_differs", field_key: "flows", item_field_a: "o", item_field_b: "d" }, { flows: A([{ o: wrap("UNKNOWN", null), d: "US" }]) })).toBe(false);
    expect(unwrapItemValue(wrap("ANSWERED", 3))).toBe(3);
    expect(unwrapItemValue("plain")).toBe("plain");
  });

  it("group_item_text_matches_any equals the MB4 base evaluator on bare data and also reads envelopes", () => {
    const rule: Rule = { op: "group_item_text_matches_any", field_key: "g", item_field_key: "p", keywords: ["Lithium", "aerosol"] };
    const bare = { g: A([{ p: "lithium-ion battery packs" }]) };
    expect(evaluateRule(rule, bare)).toBe(evaluateResolutionRule(rule as never, bare as never));
    expect(evaluateRule(rule, { g: A([{ p: "t-shirts" }]) })).toBe(false);
    expect(evaluateRule(rule, { g: A([{ p: wrap("ANSWERED", "aerosol cans") }]) })).toBe(true);
  });

  it("field_asked: true for any state but NOT_ASKED, including NOT_APPLICABLE (vacuous truth, G-C3)", () => {
    const r: Rule = { op: "field_asked", field_key: "x" };
    expect(evaluateRule(r, {})).toBe(false);
    expect(evaluateRule(r, { x: UNK() })).toBe(true);
    expect(evaluateRule(r, { x: { answerState: "NOT_APPLICABLE", value: undefined } })).toBe(true);
    expect(evaluateRule(r, { x: { answerState: "NOT_ASKED", value: undefined } })).toBe(false);
  });

  it("validateRule rejects malformed nodes and runaway nesting", () => {
    expect(validateRule(null)).not.toBeNull();
    expect(validateRule({ op: "nope" })).toMatch(/unknown/);
    expect(validateRule({ op: "and", rules: [] })).not.toBeNull();
    let deep: Rule = { op: "field_answered", field_key: "x" };
    for (let i = 0; i < 25; i++) deep = { op: "not", rule: deep };
    expect(validateRule(deep)).toMatch(/depth/);
  });
});

describe("country overlays: effective fields", () => {
  it("single-country equivalence: effectiveFieldsMulti([c]) === effectiveFields(c) for every manifest x overlay country + none + unknown", () => {
    let n = 0;
    for (const k of ALL_KEYS) {
      const m = load(k);
      for (const c of [null, "ZZ", ...Object.keys(m.country_overlays)]) {
        expect(effectiveFieldsMulti(m, c === null ? [] : [c])).toEqual(effectiveFields(m, c));
        n += 1;
      }
    }
    expect(n).toBeGreaterThanOrEqual(16);
  });

  it("multi-country union (D1): a deactivation is effective only if every scoped country deactivates; additions carry applies_to_countries", () => {
    const lg = load("logistics");
    expect(effectiveFieldsMulti(lg, ["US", "MX"]).map((f) => f.field_key)).not.toContain("logistics_vat_deferment_scheme_interest");
    const usde = effectiveFieldsMulti(lg, ["US", "DE"]);
    expect(usde.some((f) => f.field_key === "logistics_vat_deferment_scheme_interest")).toBe(true);
    expect(usde.find((f) => f.field_key === "logistics_eori_number_status")?.applies_to_countries).toEqual(["DE"]);
    expect(usde.find((f) => f.field_key === "logistics_fda_prior_notice_required")?.applies_to_countries).toEqual(["US"]);
  });

  it("multi-country: the strictest requirement_level wins when overlays modify one field differently", () => {
    const m = load("logistics");
    m.country_overlays.MX!.modify!.push({ field_key: "logistics_insurance_coverage_status", patch: { requirement_level: "required" } });
    const both = effectiveFieldsMulti(m, ["US", "MX"]).find((f) => f.field_key === "logistics_insurance_coverage_status");
    expect(both?.requirement_level).toBe("required");
    expect(effectiveFieldsMulti(m, ["US"]).find((f) => f.field_key === "logistics_insurance_coverage_status")?.requirement_level).toBe("supporting");
  });

  it("normalizeCountries trims, upper-cases and de-duplicates", () => {
    expect(normalizeCountries([" us", "US", "mx", ""])).toEqual(["US", "MX"]);
    expect(normalizeCountries(undefined)).toEqual([]);
  });

  it("an overlay-added field is absent for a country without that overlay", () => {
    const lg = load("logistics");
    expect(effectiveFields(lg, "US").some((f) => f.field_key === "logistics_eori_number_status")).toBe(false);
    expect(effectiveFields(lg, "MX").some((f) => f.field_key === "logistics_eori_number_status")).toBe(false);
    expect(effectiveFields(lg, "DE").some((f) => f.field_key === "logistics_eori_number_status")).toBe(true);
  });

  it("hygiene A: no overlay deactivates or modifies a key missing from base (every manifest)", () => {
    for (const k of ALL_KEYS) expect(findOverlayFieldKeysMissingFromBase(load(k))).toEqual([]);
  });

  it("every rule in every manifest validates and names only declared keys", () => {
    for (const k of ALL_KEYS) {
      const m = load(k);
      const keys = new Set(m.fields.map((f) => f.field_key));
      for (const d of m.critical_decisions as Array<{ decision_key: string; resolution_rule: Rule }>) {
        expect(validateRule(d.resolution_rule)).toBeNull();
        for (const r of ruleFieldRefs(d.resolution_rule)) expect(keys.has(r)).toBe(true);
      }
    }
  });
});
