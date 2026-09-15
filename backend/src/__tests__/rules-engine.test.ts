import { getFieldDefinition } from "@beeside/canonical-fields";
import { conditionLeaves } from "../rules/conditions";
import { buildRulesEngineBundle } from "../rules/content/rules-engine-v1";
import { EvidenceMap, evaluateRules, nearTimingApplies, pressureApplies } from "../rules/engine";
import { FindingStatus, PRESSURE_PRIMITIVES, RulesEngineBundle } from "../rules/types";
import { validateRulesEngineBundle } from "../rules/validate-rules-bundle";

const bundle = buildRulesEngineBundle();

type Answers = Record<string, unknown>;

/** Pressure-free baseline: no firm timing, no contract, no commitments, no declared priority. */
const BASE: Answers = {
  "fa.project.destination_status": "know_country_location",
  "fa.project.target_markets": ["MX"],
  "fa.project.stage": "validating",
  "fa.project.defined_areas": ["target_market"],
  "fa.goal.primary_goal": "set_up_local_operation",
  "fa.goal.launch_timing_status": "target_date",
  "fa.constraints.has_customer_contract": "no",
  "fa.priority.priority_known": "not_yet",
  "fa.operation.components": [],
  "fa.operation.expected_capabilities": ["tax"],
  "fa.constraints.items": ["other"],
};

function evidence(answers: Answers): EvidenceMap {
  return new Map(
    Object.entries(answers)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, { value, answerId: `answer:${key}` }]),
  );
}

function run(overrides: Answers, b: RulesEngineBundle = bundle) {
  return evaluateRules(b, evidence({ ...BASE, ...overrides }));
}

function finding(overrides: Answers, areaId: number) {
  const result = run(overrides).findings.find((f) => f.areaId === areaId);
  if (!result) throw new Error(`no finding for area ${areaId}`);
  return result;
}

const FIRM = { "fa.goal.launch_timing_status": "firm_commitment" };
const CONTRACT = { "fa.constraints.has_customer_contract": "yes" };
const priority = (category: string) => ({ "fa.priority.priority_known": "yes", "fa.priority.client_priority": category });
const withComponents = (...components: string[]) => ({ "fa.operation.components": components });
const withCapabilities = (...capabilities: string[]) => ({ "fa.operation.expected_capabilities": capabilities });

describe("Rules Engine v1 bundle", () => {
  it("is structurally valid, covers the 14 areas and never interprets open text", () => {
    expect(validateRulesEngineBundle(bundle)).toEqual([]);
    const leaves = bundle.areas.flatMap((area) => [
      ...conditionLeaves(area.applies_when),
      ...area.critical.flatMap((r) => conditionLeaves(r.unresolved)),
      ...area.rules.flatMap((r) => conditionLeaves(r.when)),
      ...area.signals.flatMap((s) => conditionLeaves(s.when)),
      ...Object.values(area.weighting).flatMap((c) => (c ? conditionLeaves(c) : [])),
    ]);
    const openText = leaves.filter((leaf) => getFieldDefinition(leaf.field)?.openText);
    expect(openText.length).toBeGreaterThan(0); // presence of permits_which is read …
    expect(openText.every((leaf) => leaf.op === "answered")).toBe(true); // … but never its meaning
  });

  it("rejects bundles that interpret open text, skip material pressure or use unknown values", () => {
    const broken = structuredClone(bundle);
    broken.areas[9]!.rules[0]!.when = { field: "fa.operation.regulated.permits_which", op: "eq", value: "ISO" };
    broken.areas[0]!.critical[0]!.pressure = [];
    broken.areas[1]!.rules[0]!.when = { field: "fa.project.defined_areas", op: "includes_any", values: ["customs"] };
    const errors = validateRulesEngineBundle(broken);
    expect(errors.some((e) => e.includes("interprets open-text field fa.operation.regulated.permits_which"))).toBe(true);
    expect(errors.some((e) => e.includes("has no material-pressure test"))).toBe(true);
    expect(errors.some((e) => e.includes("value customs not allowed"))).toBe(true);
  });

  it("is deterministic: the same answers always produce the same evaluation", () => {
    const answers = { ...FIRM, ...CONTRACT, ...withComponents("import_export", "local_workforce"), "fa.operation.import_export.cross_border_expected": "yes" };
    expect(run(answers)).toEqual(run(answers));
  });
});

// ---------------------------------------------------------------------------------------------------
// Table-driven area fixtures (Rules Matrix v1 §1–§14).
// ---------------------------------------------------------------------------------------------------
type Case = [name: string, areaId: number, answers: Answers, status: FindingStatus, rule?: string];

const CASES: Case[] = [
  // 1. Target market
  ["market located", 1, {}, "DEFINED", "area.1.defined.market_located"],
  ["comparing countries", 1, { "fa.project.destination_status": "comparing_countries" }, "NEEDS_ATTENTION", "area.1.needs.comparing"],
  ["comparing locations", 1, { "fa.project.destination_status": "know_country_comparing_locations" }, "NEEDS_ATTENTION"],
  ["undecided without pressure", 1, { "fa.project.destination_status": "havent_decided", "fa.project.target_markets": undefined }, "NEEDS_ATTENTION", "area.1.needs.undecided"],
  ["undecided + firm timing", 1, { "fa.project.destination_status": "havent_decided", ...FIRM }, "CRITICAL_GAP", "area.1.critical.market_undecided"],
  ["undecided + customer contract", 1, { "fa.project.destination_status": "havent_decided", ...CONTRACT }, "CRITICAL_GAP"],
  ["known country without markets", 1, { "fa.project.target_markets": undefined }, "NEEDS_ATTENTION"],
  // 2. Customs & market access
  ["no import/export, no customs capability", 2, {}, "NOT_APPLICABLE"],
  ["cross-border, customs undefined", 2, { ...withComponents("import_export"), "fa.operation.import_export.cross_border_expected": "yes" }, "NEEDS_ATTENTION", "area.2.needs.customs_undefined"],
  ["cross-border probably + firm", 2, { ...withComponents("import_export"), "fa.operation.import_export.cross_border_expected": "probably", ...FIRM }, "CRITICAL_GAP", "area.2.critical.customs_undefined"],
  ["cross-border + contract", 2, { ...withComponents("import_export"), "fa.operation.import_export.cross_border_expected": "yes", ...CONTRACT }, "CRITICAL_GAP"],
  ["customs defined + firm", 2, { ...withComponents("import_export"), "fa.operation.import_export.cross_border_expected": "yes", "fa.project.defined_areas": ["regulatory"], ...FIRM }, "DEFINED", "area.2.defined.customs_defined"],
  ["no cross-border", 2, { ...withComponents("import_export"), "fa.operation.import_export.cross_border_expected": "no" }, "DEFINED", "area.2.defined.no_cross_border"],
  ["cross-border not sure + firm", 2, { ...withComponents("import_export"), "fa.operation.import_export.cross_border_expected": "not_sure", ...FIRM }, "NEEDS_ATTENTION", "area.2.needs.to_confirm"],
  ["customs capability only + contract", 2, { ...withCapabilities("customs_trade"), ...CONTRACT }, "NEEDS_ATTENTION"],
  // 3. Local sourcing
  ["suppliers identified, no pressure", 3, { ...withComponents("sourcing_suppliers"), "fa.operation.sourcing.local_expected": "yes", "fa.operation.sourcing.relationship_status": "identified" }, "NEEDS_ATTENTION", "area.3.needs.suppliers_open"],
  ["suppliers open + commitment area", 3, { ...withComponents("sourcing_suppliers"), "fa.operation.sourcing.local_expected": "yes", "fa.operation.sourcing.relationship_status": "evaluating", "fa.constraints.commitment_areas": ["local_sourcing_suppliers"] }, "CRITICAL_GAP", "area.3.critical.suppliers_open"],
  ["suppliers open + non-negotiable", 3, { ...withComponents("sourcing_suppliers"), "fa.operation.sourcing.local_expected": "probably", "fa.operation.sourcing.relationship_status": "still_looking", "fa.constraints.non_negotiable_areas": ["local_sourcing_suppliers"] }, "CRITICAL_GAP"],
  ["suppliers open + declared priority", 3, { ...withComponents("sourcing_suppliers"), "fa.operation.sourcing.local_expected": "yes", "fa.operation.sourcing.relationship_status": "in_discussions", ...priority("local_sourcing_suppliers") }, "CRITICAL_GAP"],
  ["suppliers open + firm timing only", 3, { ...withComponents("sourcing_suppliers"), "fa.operation.sourcing.local_expected": "yes", "fa.operation.sourcing.relationship_status": "identified", ...FIRM }, "NEEDS_ATTENTION"],
  ["suppliers selected", 3, { ...withComponents("sourcing_suppliers"), "fa.operation.sourcing.local_expected": "yes", "fa.operation.sourcing.relationship_status": "selected" }, "DEFINED", "area.3.defined.suppliers_selected"],
  ["no local sourcing", 3, { ...withComponents("sourcing_suppliers"), "fa.operation.sourcing.local_expected": "no" }, "DEFINED", "area.3.defined.no_local_sourcing"],
  ["not sure + selected", 3, { ...withComponents("sourcing_suppliers"), "fa.operation.sourcing.local_expected": "not_sure", "fa.operation.sourcing.relationship_status": "selected" }, "NEEDS_ATTENTION", "area.3.needs.to_confirm"],
  // 4. Local inventory & warehousing
  ["inventory expected, no model", 4, { ...withComponents("warehousing_inventory"), "fa.operation.warehousing.local_expected": "yes", "fa.operation.warehousing.current_model": "no_inventory" }, "NEEDS_ATTENTION", "area.4.needs.model_undecided"],
  ["inventory expected, no model + firm", 4, { ...withComponents("warehousing_inventory"), "fa.operation.warehousing.local_expected": "yes", "fa.operation.warehousing.current_model": "no_inventory", ...FIRM }, "CRITICAL_GAP", "area.4.critical.model_undecided"],
  ["inventory expected + model in place", 4, { ...withComponents("warehousing_inventory"), "fa.operation.warehousing.local_expected": "probably", "fa.operation.warehousing.current_model": "third_party_logistics", ...FIRM }, "DEFINED", "area.4.defined.model_in_place"],
  ["no local inventory", 4, { ...withComponents("warehousing_inventory"), "fa.operation.warehousing.local_expected": "no", "fa.operation.warehousing.current_model": "own" }, "DEFINED", "area.4.defined.no_local_inventory"],
  ["inventory not sure + model", 4, { ...withComponents("warehousing_inventory"), "fa.operation.warehousing.local_expected": "not_sure", "fa.operation.warehousing.current_model": "own" }, "NEEDS_ATTENTION", "area.4.needs.to_confirm"],
  // 5. Freight & logistics
  ["freight not sure + last mile + contract", 5, { ...withComponents("freight_transportation", "last_mile_delivery"), "fa.operation.freight.type": "not_sure", ...CONTRACT }, "CRITICAL_GAP", "area.5.critical.freight_undefined"],
  ["freight not sure + last mile, no contract", 5, { ...withComponents("freight_transportation", "last_mile_delivery"), "fa.operation.freight.type": "not_sure" }, "NEEDS_ATTENTION", "area.5.needs.freight_undefined"],
  ["freight not sure, no last mile + contract", 5, { ...withComponents("freight_transportation"), "fa.operation.freight.type": "not_sure", ...CONTRACT }, "NEEDS_ATTENTION"],
  ["freight defined", 5, { ...withComponents("freight_transportation"), "fa.operation.freight.type": "dry", "fa.operation.freight.frequency": "weekly" }, "DEFINED", "area.5.defined.freight_defined"],
  ["last mile only, volumes declared", 5, { ...withComponents("last_mile_delivery"), "fa.operation.last_mile.monthly_deliveries": "500_5000" }, "DEFINED", "area.5.defined.last_mile_defined"],
  ["last mile only, volumes not sure", 5, { ...withComponents("last_mile_delivery"), "fa.operation.last_mile.monthly_deliveries": "not_sure", ...CONTRACT }, "NEEDS_ATTENTION", "area.5.needs.to_confirm"],
  // 6. Technology systems
  ["systems named, integration expected", 6, { ...withComponents("technology_systems"), "fa.operation.technology.critical_systems": ["erp"], "fa.operation.technology.integration_expected": "yes" }, "DEFINED", "area.6.defined.systems_named"],
  ["integration open + technology constraint", 6, { ...withComponents("technology_systems"), "fa.operation.technology.integration_expected": "yes", "fa.constraints.items": ["technology_systems"] }, "CRITICAL_GAP", "area.6.critical.integration_open"],
  ["integration open, no constraint", 6, { ...withComponents("technology_systems"), "fa.operation.technology.integration_expected": "probably", ...FIRM }, "NEEDS_ATTENTION", "area.6.needs.integration_open"],
  ["integration not sure + systems", 6, { ...withComponents("technology_systems"), "fa.operation.technology.critical_systems": ["crm"], "fa.operation.technology.integration_expected": "not_sure" }, "NEEDS_ATTENTION", "area.6.needs.to_confirm"],
  ["no integration", 6, { ...withComponents("technology_systems"), "fa.operation.technology.integration_expected": "no" }, "DEFINED", "area.6.defined.no_integration"],
  // 7. Local workforce
  ["hiring, headcount not sure + firm", 7, { ...withComponents("local_workforce"), "fa.operation.workforce.local_hiring_expected": "yes", "fa.operation.workforce.first_year_headcount": "not_sure", ...FIRM }, "CRITICAL_GAP", "area.7.critical.headcount_open"],
  ["hiring, headcount not sure", 7, { ...withComponents("local_workforce"), "fa.operation.workforce.local_hiring_expected": "probably", "fa.operation.workforce.first_year_headcount": "not_sure" }, "NEEDS_ATTENTION", "area.7.needs.headcount_open"],
  ["hiring sized", 7, { ...withComponents("local_workforce"), "fa.operation.workforce.local_hiring_expected": "yes", "fa.operation.workforce.first_year_headcount": "11_50", ...FIRM }, "DEFINED", "area.7.defined.headcount_sized"],
  ["hiring not sure + firm", 7, { ...withComponents("local_workforce"), "fa.operation.workforce.local_hiring_expected": "not_sure", ...FIRM }, "NEEDS_ATTENTION", "area.7.needs.hiring_open"],
  ["no local hiring", 7, { ...withComponents("local_workforce"), "fa.operation.workforce.local_hiring_expected": "no" }, "DEFINED", "area.7.defined.no_local_hiring"],
  // 8. Facilities
  ["facility, no location + firm", 8, { ...withComponents("physical_facilities"), "fa.operation.facilities.facility_required": "warehouse", "fa.operation.facilities.location_selected": "no", ...FIRM }, "CRITICAL_GAP", "area.8.critical.location_open"],
  ["facility evaluating + firm", 8, { ...withComponents("physical_facilities"), "fa.operation.facilities.facility_required": "office", "fa.operation.facilities.location_selected": "evaluating", ...FIRM }, "NEEDS_ATTENTION", "area.8.needs.location_open"],
  ["facility location selected", 8, { ...withComponents("physical_facilities"), "fa.operation.facilities.facility_required": "manufacturing", "fa.operation.facilities.location_selected": "yes" }, "DEFINED", "area.8.defined.location_selected"],
  ["no facility", 8, { ...withComponents("physical_facilities"), "fa.operation.facilities.facility_required": "no" }, "DEFINED", "area.8.defined.no_facility"],
  ["facility not sure + firm", 8, { ...withComponents("physical_facilities"), "fa.operation.facilities.facility_required": "not_sure", ...FIRM }, "NEEDS_ATTENTION", "area.8.needs.to_confirm"],
  // 9. Local partner
  ["partner open + firm", 9, { ...withComponents("external_partners"), "fa.operation.partners.dependency": "yes", "fa.operation.partners.relationship_status": "identified", ...FIRM }, "CRITICAL_GAP", "area.9.critical.partner_open"],
  ["partner open + contract, not a partner commitment", 9, { ...withComponents("external_partners"), "fa.operation.partners.dependency": "yes", "fa.operation.partners.relationship_status": "identified", ...CONTRACT }, "NEEDS_ATTENTION"],
  ["partner open + contract + partner commitment", 9, { ...withComponents("external_partners"), "fa.operation.partners.dependency": "yes", "fa.operation.partners.relationship_status": "evaluating", ...CONTRACT, "fa.constraints.commitment_areas": ["local_partner_distributor"] }, "CRITICAL_GAP"],
  ["partner probably + firm", 9, { ...withComponents("external_partners"), "fa.operation.partners.dependency": "probably", "fa.operation.partners.relationship_status": "still_looking", ...FIRM }, "NEEDS_ATTENTION", "area.9.needs.partner_open"],
  ["partner selected", 9, { ...withComponents("external_partners"), "fa.operation.partners.dependency": "yes", "fa.operation.partners.relationship_status": "selected" }, "DEFINED", "area.9.defined.partner_selected"],
  ["no partner dependency", 9, { ...withComponents("external_partners"), "fa.operation.partners.dependency": "no" }, "DEFINED", "area.9.defined.no_dependency"],
  // 10. Permits
  ["permits not sure + critical constraint", 10, { ...withComponents("regulated_activities"), "fa.operation.regulated.permits_status": "not_sure", "fa.constraints.items": ["regulatory_permits_certifications", "banking"], "fa.constraints.critical": "regulatory_permits_certifications" }, "CRITICAL_GAP", "area.10.critical.permits_unresolved"],
  ["permits not sure, no pressure", 10, { ...withComponents("regulated_activities"), "fa.operation.regulated.permits_status": "not_sure" }, "NEEDS_ATTENTION", "area.10.needs.permits_unresolved"],
  ["permits held and named", 10, { ...withComponents("regulated_activities"), "fa.operation.regulated.permits_status": "yes", "fa.operation.regulated.permits_which": "COFEPRIS" }, "DEFINED", "area.10.defined.permits_identified"],
  ["no permits held", 10, { ...withComponents("regulated_activities"), "fa.operation.regulated.permits_status": "no" }, "NEEDS_ATTENTION", "area.10.needs.to_confirm"],
  ["relevant through C1 only + firm", 10, { "fa.constraints.items": ["regulatory_permits_certifications"], ...FIRM }, "NEEDS_ATTENTION", "area.10.needs.to_confirm"],
  ["permits not relevant", 10, {}, "NOT_APPLICABLE"],
  // 11. Local entity
  ["entity undefined at execution stage", 11, { ...withCapabilities("legal_corporate"), "fa.project.stage": "preparing_entry" }, "CRITICAL_GAP", "area.11.critical.entity_undefined"],
  ["entity undefined while validating", 11, { ...withCapabilities("legal_corporate") }, "NEEDS_ATTENTION", "area.11.needs.entity_undefined"],
  ["entity undefined while validating + firm", 11, { ...withCapabilities("legal_corporate"), ...FIRM }, "CRITICAL_GAP"],
  ["legal already defined", 11, { ...withCapabilities("legal_corporate"), "fa.project.defined_areas": ["legal"], "fa.project.stage": "preparing_entry" }, "DEFINED", "area.11.defined.legal_defined"],
  ["execution stage, legal not selected", 11, { "fa.project.stage": "already_executing" }, "NEEDS_ATTENTION", "area.11.needs.stage_without_legal"],
  ["legal not relevant", 11, {}, "NOT_APPLICABLE"],
  // 12. Banking
  ["banking to establish, no pressure", 12, { ...withCapabilities("banking"), "fa.operation.banking_status": "need_to_establish" }, "NEEDS_ATTENTION", "area.12.needs.banking_open"],
  ["banking not sure what's required + firm", 12, { ...withCapabilities("banking"), "fa.operation.banking_status": "not_sure_required", ...FIRM }, "CRITICAL_GAP", "area.12.critical.banking_open"],
  ["banking not sure what's required, no pressure", 12, { ...withCapabilities("banking"), "fa.operation.banking_status": "not_sure_required" }, "NEEDS_ATTENTION"],
  ["banking in progress + critical constraint", 12, { ...withCapabilities("banking"), "fa.operation.banking_status": "in_progress", "fa.constraints.critical": "banking", "fa.constraints.items": ["banking", "insurance"] }, "CRITICAL_GAP"],
  ["banking in place + firm", 12, { ...withCapabilities("banking"), "fa.operation.banking_status": "already_in_place", ...FIRM }, "DEFINED", "area.12.defined.banking_in_place"],
  // 13. Insurance
  ["insurance in progress + commitment area", 13, { ...withCapabilities("insurance"), "fa.operation.insurance_status": "in_progress", "fa.constraints.commitment_areas": ["insurance"] }, "CRITICAL_GAP", "area.13.critical.insurance_open"],
  ["insurance to establish", 13, { ...withCapabilities("insurance"), "fa.operation.insurance_status": "need_to_establish" }, "NEEDS_ATTENTION", "area.13.needs.insurance_open"],
  ["insurance in place", 13, { ...withCapabilities("insurance"), "fa.operation.insurance_status": "already_in_place" }, "DEFINED", "area.13.defined.insurance_in_place"],
  // 14. Go-to-market
  ["GTM open + customer contract", 14, { ...withCapabilities("commercial_strategy"), ...CONTRACT }, "CRITICAL_GAP", "area.14.critical.gtm_open"],
  ["GTM open + declared priority", 14, { ...withCapabilities("sales_channels"), ...priority("go_to_market_commercial_strategy") }, "CRITICAL_GAP"],
  ["GTM defined", 14, { ...withCapabilities("marketing"), "fa.project.defined_areas": ["commercial_model"], ...CONTRACT }, "DEFINED", "area.14.defined.gtm_defined"],
  ["goal: find customers, no pressure", 14, { "fa.goal.primary_goal": "find_customers_partners" }, "NEEDS_ATTENTION", "area.14.needs.gtm_open"],
  ["GTM not relevant", 14, {}, "NOT_APPLICABLE"],
];

describe("Rules Matrix v1 area fixtures", () => {
  // Rest parameters keep the callback arity at 0 so Jest never injects `done` for 4-tuple cases.
  it.each(CASES)("%s (area %i)", (...[, areaId, answers, status, rule]: Case) => {
    const result = finding(answers, areaId);
    expect(result.status).toBe(status);
    if (rule) expect(result.ruleTriggered).toBe(rule);
    if (status === "NOT_APPLICABLE") {
      expect(result.reasonClient).toBeNull();
      expect(result.evidence).toEqual([]);
    } else {
      expect(result.reasonClient?.en).toBeTruthy();
      expect(result.reasonClient?.es).toBeTruthy();
      expect(result.reasonClient?.en).not.toMatch(/\{\{/);
      expect(result.reasonInternal).toContain(result.ruleTriggered);
    }
  });

  it("covers at least 60 table-driven cases across every area and status", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(60);
    for (let area = 1; area <= 14; area++) expect(CASES.some((c) => c[1] === area)).toBe(true);
    for (const status of ["DEFINED", "NEEDS_ATTENTION", "CRITICAL_GAP", "NOT_APPLICABLE"]) expect(CASES.some((c) => c[3] === status)).toBe(true);
  });

  it("uses the Rules Matrix client wording, filling the material-pressure clause from the matched test", () => {
    expect(finding({ "fa.project.destination_status": "havent_decided", ...FIRM }, 1).reasonClient?.en).toBe(
      "A target market hasn't been decided yet, and your timing is already firm.",
    );
    expect(
      finding({ ...withComponents("regulated_activities"), "fa.operation.regulated.permits_status": "not_sure", "fa.constraints.items": ["regulatory_permits_certifications", "banking"], "fa.constraints.critical": "regulatory_permits_certifications" }, 10).reasonClient?.en,
    ).toBe("Regulatory approvals for this operation are unresolved, and this is the constraint you flagged as most likely to affect your plan.");
    expect(finding({ ...withCapabilities("banking"), "fa.operation.banking_status": "not_sure_required", ...FIRM }, 12).reasonClient).toEqual({
      en: "Local banking still needs to be established, and your timing is already firm.",
      es: "Todavía falta establecer la banca local, y tus tiempos ya están comprometidos.",
    });
  });

  it("keeps each finding's evidence traceable to the declared answer rows", () => {
    const result = finding({ ...withComponents("import_export"), "fa.operation.import_export.cross_border_expected": "yes", ...FIRM }, 2);
    expect(result.evidence.map((e) => e.fieldKey)).toEqual([
      "fa.operation.components",
      "fa.operation.import_export.cross_border_expected",
      "fa.project.defined_areas",
      "fa.operation.expected_capabilities",
      "fa.goal.launch_timing_status",
      "fa.constraints.has_customer_contract",
    ]);
    expect(result.evidence.every((e) => e.answerId === `answer:${e.fieldKey}`)).toBe(true);
    expect(result.pressureMatched).toEqual(["firm_commitment"]);
  });
});

// ---------------------------------------------------------------------------------------------------
// Frozen guarantees.
// ---------------------------------------------------------------------------------------------------
describe("CRITICAL_GAP safeguards", () => {
  const PRESSURE_FIELDS = new Set([
    "fa.goal.launch_timing_status",
    "fa.constraints.has_customer_contract",
    "fa.constraints.commitment_areas",
    "fa.constraints.non_negotiable_areas",
    "fa.priority.priority_known",
    "fa.priority.client_priority",
    "fa.constraints.critical",
    "fa.constraints.items",
    "fa.project.stage",
  ]);

  function domain(field: string): unknown[] {
    const def = getFieldDefinition(field);
    if (!def) return [undefined];
    if (def.dataType === "multi_select") return [undefined, ...(def.values ?? []).map((v) => [v])];
    if (def.values) return [undefined, ...def.values];
    if (def.dataType === "country_list") return [undefined, ["MX"]];
    if (def.openText || def.dataType === "text" || def.dataType === "short_text") return [undefined, "text"];
    if (def.dataType === "quantity") return [undefined, { not_sure: true }, { amount: 10, unit: "pallet_positions" }];
    return [undefined];
  }

  function* combinations(fields: string[]): Generator<Answers> {
    if (fields.length === 0) {
      yield {};
      return;
    }
    const [first, ...rest] = fields as [string, ...string[]];
    for (const tail of combinations(rest)) for (const value of domain(first)) yield { ...tail, [first]: value };
  }

  it("never produces CRITICAL_GAP without material pressure, whatever the unresolved or 'Not sure' answers", () => {
    let evaluated = 0;
    for (const area of bundle.areas) {
      const single = { ...bundle, areas: [area] };
      const fields = [
        ...new Set([...conditionLeaves(area.applies_when), ...area.critical.flatMap((r) => conditionLeaves(r.unresolved)), ...area.rules.flatMap((r) => conditionLeaves(r.when))].map((l) => l.field)),
      ].filter((f) => !PRESSURE_FIELDS.has(f));
      for (const combo of combinations(fields)) {
        const result = evaluateRules(single, evidence({ ...BASE, "fa.constraints.items": ["not_sure"], ...combo }));
        evaluated += 1;
        expect(result.findings[0]?.status).not.toBe("CRITICAL_GAP");
      }
    }
    expect(evaluated).toBeGreaterThan(1000);
  });

  it("does not turn a broadly 'Not sure' assessment red (QA persona 7)", () => {
    const result = run({
      "fa.project.destination_status": "havent_decided",
      "fa.project.target_markets": undefined,
      "fa.project.stage": "exploring",
      "fa.goal.launch_timing_status": "not_yet",
      "fa.operation.components": ["sourcing_suppliers", "import_export", "warehousing_inventory", "freight_transportation", "last_mile_delivery", "physical_facilities", "technology_systems", "local_workforce", "external_partners", "regulated_activities"],
      "fa.operation.sourcing.local_expected": "not_sure",
      "fa.operation.sourcing.relationship_status": "still_looking",
      "fa.operation.import_export.cross_border_expected": "not_sure",
      "fa.operation.warehousing.local_expected": "not_sure",
      "fa.operation.freight.type": "not_sure",
      "fa.operation.last_mile.monthly_deliveries": "not_sure",
      "fa.operation.technology.integration_expected": "not_sure",
      "fa.operation.workforce.local_hiring_expected": "not_sure",
      "fa.operation.facilities.facility_required": "not_sure",
      "fa.operation.partners.dependency": "not_sure",
      "fa.operation.partners.relationship_status": "still_looking",
      "fa.operation.regulated.permits_status": "not_sure",
      "fa.operation.expected_capabilities": ["not_sure"],
      "fa.priority.priority_known": "not_sure",
      "fa.constraints.items": ["not_sure"],
    });
    expect(result.findings.filter((f) => f.status === "CRITICAL_GAP")).toEqual([]);
    expect(result.panelCounts.NEEDS_ATTENTION).toBeGreaterThan(5);
    expect(result.panels.NEEDS_ATTENTION).toHaveLength(5);
  });

  it("only uses pressure primitives that never read an uncertainty value", () => {
    const empty = new Map<string, unknown>();
    for (const primitive of PRESSURE_PRIMITIVES) expect(pressureApplies(primitive, "banking", empty)).toBe(false);
    const notSure = new Map<string, unknown>([
      ["fa.goal.launch_timing_status", "not_yet"],
      ["fa.priority.priority_known", "not_sure"],
      ["fa.constraints.items", ["not_sure"]],
      ["fa.project.stage", "exploring"],
    ]);
    for (const primitive of PRESSURE_PRIMITIVES) expect(pressureApplies(primitive, "banking", notSure)).toBe(false);
  });

  it("keeps the near-timing primitive present but inert until a threshold is approved", () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const answers = new Map<string, unknown>([["fa.goal.launch_target", { precision: "date", value: tomorrow }]]);
    expect(bundle.near_timing_threshold_days).toBeNull();
    expect(nearTimingApplies(bundle, answers, new Date())).toBe(false);
    expect(nearTimingApplies({ ...bundle, near_timing_threshold_days: 30 }, answers, new Date())).toBe(true);
    expect(run({ "fa.goal.launch_target": { precision: "date", value: tomorrow } }).nearTiming).toBe(false);
  });
});

describe("Snapshot panels (Rules Matrix v1 §17)", () => {
  const MANY_CRITICAL: Answers = {
    ...FIRM,
    ...CONTRACT,
    "fa.project.destination_status": "havent_decided",
    "fa.project.target_markets": undefined,
    "fa.project.stage": "preparing_entry",
    "fa.project.defined_areas": ["none"],
    "fa.operation.components": ["import_export", "warehousing_inventory", "local_workforce", "physical_facilities", "external_partners", "freight_transportation", "last_mile_delivery"],
    "fa.operation.import_export.cross_border_expected": "yes",
    "fa.operation.warehousing.local_expected": "yes",
    "fa.operation.warehousing.current_model": "no_inventory",
    "fa.operation.workforce.local_hiring_expected": "yes",
    "fa.operation.workforce.first_year_headcount": "not_sure",
    "fa.operation.facilities.facility_required": "warehouse",
    "fa.operation.facilities.location_selected": "no",
    "fa.operation.partners.dependency": "yes",
    "fa.operation.partners.relationship_status": "still_looking",
    "fa.operation.freight.type": "not_sure",
    "fa.operation.expected_capabilities": ["legal_corporate", "banking", "commercial_strategy"],
    "fa.operation.banking_status": "need_to_establish",
    "fa.constraints.items": ["customs_trade", "local_workforce"],
    "fa.constraints.critical": "local_workforce",
  };

  it("shows at most 5 Resolve-early findings, ranked by the Priority weighting order (QA persona 13)", () => {
    const result = run(MANY_CRITICAL);
    expect(result.panelCounts.CRITICAL_GAP).toBeGreaterThan(5);
    expect(result.panels.CRITICAL_GAP).toHaveLength(5);
    // local_workforce is the critical constraint → ranks first among equally firm/contract findings.
    expect(result.panels.CRITICAL_GAP[0]).toBe(7);
    const hidden = result.findings.filter((f) => f.status === "CRITICAL_GAP" && !f.includedInSnapshot);
    expect(hidden.length).toBe(result.panelCounts.CRITICAL_GAP - 5);
    expect(hidden.every((f) => (f.panelRank ?? 0) > 5)).toBe(true);
  });

  it("never duplicates the declared Immediate Priority inside Resolve early", () => {
    const result = run({ ...MANY_CRITICAL, ...priority("local_entity_legal_setup") });
    expect(result.priorityAreaId).toBe(11);
    expect(result.panels.CRITICAL_GAP).not.toContain(11);
    expect(result.findings.find((f) => f.areaId === 11)?.status).toBe("CRITICAL_GAP");
  });

  it("orders Well defined by area and never pads short panels (QA persona 19)", () => {
    const result = run({
      "fa.operation.components": ["import_export", "sourcing_suppliers", "warehousing_inventory", "technology_systems", "local_workforce", "physical_facilities", "external_partners"],
      "fa.project.defined_areas": ["regulatory", "legal"],
      "fa.project.stage": "preparing_entry",
      "fa.operation.import_export.cross_border_expected": "yes",
      "fa.operation.sourcing.local_expected": "no",
      "fa.operation.warehousing.local_expected": "no",
      "fa.operation.technology.integration_expected": "no",
      "fa.operation.workforce.local_hiring_expected": "no",
      "fa.operation.facilities.facility_required": "no",
      "fa.operation.partners.dependency": "no",
    });
    expect(result.panelCounts.DEFINED).toBe(8);
    expect(result.panels.DEFINED).toEqual([1, 2, 3, 4, 6]);
    expect(result.panels.NEEDS_ATTENTION).toEqual([]);
    expect(result.panels.CRITICAL_GAP).toEqual([]);
  });

  it("shows exactly what qualifies when a panel has 4 findings", () => {
    const result = run({
      "fa.operation.components": ["import_export", "technology_systems", "local_workforce", "physical_facilities"],
      "fa.operation.import_export.cross_border_expected": "yes",
      "fa.operation.technology.integration_expected": "yes",
      "fa.operation.workforce.local_hiring_expected": "not_sure",
      "fa.operation.facilities.facility_required": "not_sure",
    });
    expect(result.panelCounts.NEEDS_ATTENTION).toBe(4);
    expect(result.panels.NEEDS_ATTENTION).toHaveLength(4);
  });
});

describe("Relevant capabilities (Capability Taxonomy v1)", () => {
  it("selects categories by relevance triggers, independent of finding status (QA persona 5)", () => {
    const result = run({ ...withComponents("external_partners"), "fa.operation.partners.dependency": "yes", "fa.operation.partners.relationship_status": "selected" });
    const partner = result.findings.find((f) => f.areaId === 9);
    expect(partner?.status).toBe("DEFINED");
    expect(partner?.signals).toEqual([{ signal: "Business Check / Third-Party Qualification", strength: "STRONG", boosted: false }]);
    expect(result.capabilities.map((c) => c.categoryId)).toEqual([4]);
  });

  it("shows at most 6 and ranks the declared priority first when more qualify (QA persona 17)", () => {
    const result = run({
      "fa.operation.components": ["import_export", "technology_systems", "local_workforce", "physical_facilities", "freight_transportation", "regulated_activities"],
      "fa.operation.expected_capabilities": ["legal_corporate", "banking", "commercial_strategy", "suppliers"],
      "fa.project.stage": "preparing_entry",
      ...priority("banking"),
    });
    expect(result.capabilities.length).toBeGreaterThan(6);
    expect(result.capabilities.filter((c) => c.includedInSnapshot)).toHaveLength(6);
    expect(result.capabilities[0]?.categoryId).toBe(9);
    expect(result.capabilities.map((c) => c.rank)).toEqual(result.capabilities.map((_, i) => i + 1));
  });

  it("shows no capability at all when no area is relevant (never padded)", () => {
    expect(run({ "fa.project.stage": "exploring" }).capabilities).toEqual([]);
  });
});

describe("Already-operating growth focus (Rules Matrix v1 §15, QA persona 18)", () => {
  const operating: Answers = {
    "fa.project.stage": "already_operating",
    "fa.project.defined_areas": ["legal"],
    "fa.operation.components": ["warehousing_inventory", "freight_transportation", "local_workforce"],
    "fa.operation.warehousing.local_expected": "yes",
    "fa.operation.warehousing.current_model": "own",
    "fa.operation.freight.type": "not_sure",
    "fa.operation.workforce.local_hiring_expected": "yes",
    "fa.operation.workforce.first_year_headcount": "not_sure",
  };

  it("raises mapped areas one tier without stacking when several responses map to the same area", () => {
    const plain = run(operating);
    const boosted = run({ ...operating, "fa.operation.growth_focus": ["improve_local_operation", "improve_logistics"] });
    const warehouse = (r: typeof plain) => r.findings.find((f) => f.areaId === 4)?.signals.find((s) => s.signal === "The Hive: 3PL warehousing/inventory");
    expect(warehouse(plain)).toEqual({ signal: "The Hive: 3PL warehousing/inventory", strength: "POSSIBLE", boosted: false });
    expect(warehouse(boosted)).toEqual({ signal: "The Hive: 3PL warehousing/inventory", strength: "SUPPORTING", boosted: true });
    expect(boosted.boostedAreaIds).toEqual([4, 5, 6, 7, 8]);
    // Status math is untouched by boosts.
    expect(boosted.findings.map((f) => f.status)).toEqual(plain.findings.map((f) => f.status));
  });

  it("gives 'Not sure yet' no boost and keeps exploratory growth internal-only", () => {
    const notSure = run({ ...operating, "fa.operation.growth_focus": ["not_sure"] });
    expect(notSure.boostedAreaIds).toEqual([]);
    const explore = run({ ...operating, "fa.operation.expected_capabilities": ["commercial_strategy"], "fa.operation.growth_focus": ["explore_growth_opportunity"] });
    expect(explore.strategicSignals).toEqual([{ signal: "Growth Strategy Playbook", strength: "POSSIBLE", source: "fa.operation.growth_focus=explore_growth_opportunity" }]);
    expect(explore.capabilities.find((c) => c.categoryId === 10)?.factors.growth_boost).toBe(false);
  });
});

describe("Priority alignment — Something to Reconcile (Rules Matrix v1 §18, QA persona 14)", () => {
  const legalCritical: Answers = { ...withCapabilities("legal_corporate"), "fa.project.stage": "preparing_entry" };

  it("detects tension through the Go-to-Market dependency map and renders one templated line", () => {
    const result = run({ ...legalCritical, ...priority("go_to_market_commercial_strategy"), ...withCapabilities("legal_corporate", "commercial_strategy") });
    expect(result.priorityAlignment).toMatchObject({
      alignment: "TENSION_DETECTED",
      tensionAreaId: 11,
      testsMatched: ["go_to_market_dependency"],
      ruleTriggered: "priority_alignment.go_to_market_dependency",
    });
    expect(result.priorityAlignment.reason?.en).toBe(
      "Your priority is to define how you'll sell and compete locally, but the local legal structure required to support that is still unresolved.",
    );
    expect(result.priorityAlignment.reason?.es).toBe(
      "Tu prioridad es definir cómo vas a vender y competir localmente, pero para lograrlo todavía falta resolver la estructura legal local.",
    );
  });

  it("detects tension when both areas share a structured commitment list", () => {
    const result = run({
      ...legalCritical,
      ...priority("banking"),
      ...withCapabilities("legal_corporate", "banking"),
      "fa.operation.banking_status": "already_in_place",
      "fa.constraints.non_negotiable_areas": ["banking", "local_entity_legal_setup"],
    });
    expect(result.priorityAlignment).toMatchObject({ alignment: "TENSION_DETECTED", tensionAreaId: 11, testsMatched: ["shared_commitment"] });
  });

  it("is legitimately absent when no qualifying tension exists or no priority was declared", () => {
    expect(run({ ...legalCritical, ...priority("banking"), ...withCapabilities("legal_corporate", "banking"), "fa.operation.banking_status": "already_in_place" }).priorityAlignment.alignment).toBe("ALIGNED");
    expect(run({ ...legalCritical, ...CONTRACT }).priorityAlignment).toMatchObject({ alignment: "ALIGNED", priorityCategory: null });
  });

  it("keeps the shared-timing-driver test inert while no driver-to-area mapping is approved", () => {
    const result = run({ ...legalCritical, ...priority("banking"), ...withCapabilities("legal_corporate", "banking"), "fa.operation.banking_status": "already_in_place", "fa.goal.timing_driver": "regulatory" });
    expect(bundle.priority_alignment.timing_driver_area_ids).toEqual({});
    expect(result.priorityAlignment.alignment).toBe("ALIGNED");
  });

  it("surfaces at most one line, choosing the most material candidate", () => {
    const result = run({
      ...FIRM,
      ...CONTRACT,
      ...priority("go_to_market_commercial_strategy"),
      "fa.project.stage": "preparing_entry",
      "fa.operation.expected_capabilities": ["legal_corporate", "commercial_strategy"],
      "fa.operation.components": ["local_workforce", "physical_facilities"],
      "fa.operation.workforce.local_hiring_expected": "yes",
      "fa.operation.workforce.first_year_headcount": "not_sure",
      "fa.operation.facilities.facility_required": "office",
      "fa.operation.facilities.location_selected": "no",
      "fa.constraints.items": ["facilities_real_estate", "local_workforce"],
      "fa.constraints.critical": "facilities_real_estate",
    });
    expect(result.priorityAlignment.alignment).toBe("TENSION_DETECTED");
    expect(result.priorityAlignment.tensionAreaId).toBe(8);
  });
});
