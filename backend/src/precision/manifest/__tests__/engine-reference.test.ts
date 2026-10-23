import { addServiceAvailability, classifyNeed, containsTerm, normalizeSlug, proposeCategories, type ClassificationSignals } from "../classifier";
import { isMaterial, isMaterialFieldChange, materialChanges } from "../materiality";
import { A, PM, catalog, load } from "./helpers";

const lg = load("logistics");
const pm = PM();
const flow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  origin_country: "CN", destination_country: "US", product: "finished electronics", volume: { value: 100, unit: "containers" }, frequency: "monthly", mode_of_transport: "ocean", ...o,
});
const lgBase = (): Record<string, ReturnType<typeof A>> => ({
  logistics_primary_product_type: A("general_cargo"),
  logistics_flows: A([flow()]),
});

// ---------------- D11: materiality ----------------
describe("D11 materiality", () => {
  it("PO example: 100 -> 150 containers is material, 100 -> 105 is not", () => {
    const b = lgBase();
    const a = { ...lgBase(), logistics_flows: A([flow({ volume: { value: 150, unit: "containers" } })]) };
    const c = { ...lgBase(), logistics_flows: A([flow({ volume: { value: 105, unit: "containers" } })]) };
    expect(isMaterial(materialChanges(lg, b, a))).toBe(true);
    expect(isMaterial(materialChanges(lg, b, c))).toBe(false);
  });
  it("an operational field edit is never material; a required enum change is", () => {
    const b = lgBase();
    const a = { ...lgBase(), logistics_insurance_coverage_status: A("covered"), logistics_lead_time_expectations: A("2 weeks") };
    expect(isMaterial(materialChanges(lg, b, a))).toBe(false);
    const c = { ...lgBase(), logistics_primary_product_type: A("pharma_medical") };
    expect(isMaterial(materialChanges(lg, b, c))).toBe(true);
  });
  it("a date shift below the threshold is not material, a quarter is", () => {
    const gen = load("_generic");
    const mk = (d: string) => ({ generic_needs: A([{ need_description: "x", timing_needed_by: d }]) });
    expect(isMaterial(materialChanges(gen, mk("2027-03"), mk("2027-04")))).toBe(false);
    expect(isMaterial(materialChanges(gen, mk("2027-03"), mk("2027-07")))).toBe(true);
  });
  it("a new Strategic Advisory need (array item added or removed) is structural and always material", () => {
    const sa = load("strategic_advisory");
    const s = { objective: "x" };
    expect(isMaterial(materialChanges(sa, { sa_studies: A([s]) }, { sa_studies: A([s, { objective: "y" }]) }))).toBe(true);
    expect(isMaterial(materialChanges(sa, { sa_studies: A([s, { objective: "y" }]) }, { sa_studies: A([s]) }))).toBe(true);
  });
  it("identical facts produce no change at all; an uncomputable threshold is conservative", () => {
    expect(materialChanges(lg, lgBase(), lgBase())).toEqual([]);
    expect(isMaterialFieldChange({ type: "number", change_threshold: { relative_pct: 10 } }, "a", "b").material).toBe(true);
    expect(isMaterialFieldChange({ type: "number", change_policy: "operational" }, 1, 500).material).toBe(false);
    expect(isMaterialFieldChange({ type: "number", change_policy: "any" }, 1, 2).material).toBe(true);
  });
});

// ---------------- D10: classifier ----------------
const cls = (text: string, extra: Partial<ClassificationSignals> = {}) => classifyNeed({ text, ...extra }, pm, catalog);

describe("D10 classifier", () => {
  it("order and outcomes: one case per scenario", () => {
    expect(cls("I need work visas for 12 technicians").scenario).toBe("out_of_scope");
    expect(cls("Necesito la visa de trabajo de mis técnicos").scenario).toBe("out_of_scope");
    expect(cls("I want a feasibility study before investing").scenario).toBe("strategic_advisory");
    expect(cls("Busco un distribuidor local en Jalisco").scenario).toBe("ecosystem_development");
    const k = cls("also need last mile delivery", { service_key: "last_mile_delivery" });
    expect([k.scenario, k.category_key]).toEqual(["known_service", "logistics"]);
    const u = cls("certify an industrial biodigester", { category_key: "certifications_quality" });
    expect([u.scenario, u.internal_tag]).toEqual(["unmapped_known_category", "unmapped_known_category"]);
    const d = cls("Quiero participar en licitaciones del gobierno local", { proposed_slug: "public procurement" });
    expect([d.scenario, d.instance_key, d.manifest_category_key]).toEqual(["discovery", "new:public_procurement", "_generic"]);
    expect(d.internal_label_visible_to_client).toBe(false);
  });
  it("out of scope creates nothing", () => {
    const o = cls("residence permit for the CEO");
    expect([o.scenario, o.creates_workstream, o.creates_psm_version]).toEqual(["out_of_scope", false, false]);
  });
  it("out of scope wins over every later step (frozen order)", () => {
    expect(cls("visa for the feasibility study team", { service_key: "last_mile_delivery" }).scenario).toBe("out_of_scope");
  });
  it("Partner Match goes to Ecosystem Development, supplier search to procurement (never mixed)", () => {
    expect(cls("find a local partner for distribution").scenario).toBe("ecosystem_development");
    const s = cls("supplier sourcing in Monterrey", { service_key: "supplier_sourcing" });
    expect([s.scenario, s.category_key]).toEqual(["known_service", "procurement_supply_chain"]);
  });
  it("ambiguity (study wording + a confirmed catalog service) is returned to the client, never decided", () => {
    const a = cls("I need a market feasibility study", { service_key: "market_research" });
    expect(a.scenario).toBe("ambiguous");
    expect(a.options).toEqual(["strategic_advisory", "market_intelligence"]);
  });
  it("never creates new:<slug> when the category exists; a second need with the same slug is appended", () => {
    expect(cls("x", { proposed_slug: "logistics" }).scenario).toBe("known_category_exists");
    expect(cls("tenders", { proposed_slug: "public procurement", existing_instance_keys: ["new:public_procurement"] }).action).toBe("append_item");
  });
  it("SA / ED: the first need creates the instance, the next appends an item", () => {
    expect(cls("market appetite study", { existing_instance_keys: ["strategic_advisory"] }).action).toBe("append_item");
    expect(cls("market appetite study").action).toBe("create_instance");
    expect(cls("market appetite study").item_array).toBe("sa_studies");
  });
  it("a known service in an existing instance appends the service", () => {
    expect(cls("last mile", { service_key: "last_mile_delivery", existing_instance_keys: ["logistics"] }).action).toBe("append_service");
  });
  it("matches whole words only: 'revisable' is not 'visa'", () => {
    expect(containsTerm("un contrato revisable", "visa")).toBe(false);
    expect(containsTerm("necesito una visa", "visa")).toBe(true);
    expect(containsTerm("Necesito VISAS", "visa")).toBe(true);
    expect(cls("an easily revisable contract", { proposed_slug: "contract review" }).scenario).toBe("discovery");
  });
  it("matching ignores accents and case", () => {
    expect(containsTerm("Estudio de FACTIBILIDAD", "factibilidad")).toBe(true);
    expect(containsTerm("técnicos", "tecnicos")).toBe(true);
  });
  it("Add a Service is available only after the map is confirmed with >= 1 snapshot in an active project", () => {
    expect(addServiceAvailability({ paStatus: "confirmed", snapshotCount: 1, projectActive: true })).toBe(true);
    for (const bad of [
      { paStatus: "in_progress", snapshotCount: 0, projectActive: true },
      { paStatus: "ready_for_confirmation", snapshotCount: 0, projectActive: true },
      { paStatus: "confirmed", snapshotCount: 0, projectActive: true },
      { paStatus: "confirmed", snapshotCount: 1, projectActive: false },
    ])
      expect(addServiceAvailability(bad)).toBe(false);
  });
  it("slug normalisation is deterministic and matches the new:<slug> CHECK", () => {
    for (const t of ["Licitaciones del gobierno local", "  Árbol & Co!! ", "123 start", "public procurement", "x".repeat(200)]) {
      const k = `new:${normalizeSlug(t)}`;
      expect(k).toMatch(/^new:[a-z][a-z0-9_]{1,63}$/);
      expect(normalizeSlug(t)).toBe(normalizeSlug(t));
    }
  });
});

// ---------------- proposeCategories ----------------
describe("proposeCategories", () => {
  it("maps capability ids to categories, flags authored ones and keeps the highest priority", () => {
    const r = proposeCategories([
      { capabilityId: "CAP_HIVE_OL_FREIGHT", priority: "low" },
      { capabilityId: "CAP_HIVE_IL_3PL", priority: "high" },
      { capabilityId: "CAP_HIVE_IL_TRADE_CUSTOMS", priority: "medium" },
      { capabilityId: "CAP_HIVE_FIN_BANKING", priority: "medium" },
    ], pm);
    const keys = r.categories.map((c) => c.categoryKey);
    expect(keys).toEqual(["logistics", "banking_finance_insurance", "international_trade_customs"]); // equal priority: catalog order
    expect(r.categories[0]).toMatchObject({ authored: true, priority: "high", capabilityIds: ["CAP_HIVE_OL_FREIGHT", "CAP_HIVE_IL_3PL"] });
    expect(r.categories[1]).toMatchObject({ authored: false });
  });
  it("reserved platform categories are proposed too", () => {
    const r = proposeCategories([{ capabilityId: "CAP_SA_ME_APPETITE" }, { capabilityId: "CAP_SA_ED_PARTNER_MATCH" }], pm);
    expect(r.categories.map((c) => c.categoryKey).sort()).toEqual(["ecosystem_development", "strategic_advisory"]);
    expect(r.categories.every((c) => c.kind === "reserved_platform")).toBe(true);
  });
  it("out-of-scope capabilities create nothing; unknown ids are reported, never thrown", () => {
    const r = proposeCategories([{ capabilityId: "CAP_HIVE_HR_MOBILITY" }, { capabilityId: "CAP_NOT_A_THING" }, { capabilityId: "" }, { capabilityId: "CAP_NOT_A_THING" }], pm);
    expect(r.categories).toEqual([]);
    expect(r.outOfScope).toEqual([{ capabilityId: "CAP_HIVE_HR_MOBILITY", topicKey: "mobility_immigration" }]);
    expect(r.unmapped).toEqual(["CAP_NOT_A_THING"]);
  });
  it("is deterministic and tolerates empty input", () => {
    const needs = [{ capabilityId: "CAP_HIVE_FI_TAX", priority: "high" }, { capabilityId: "CAP_HIVE_HR_PAYROLL", priority: "high" }];
    expect(proposeCategories(needs, pm)).toEqual(proposeCategories([...needs].reverse(), pm));
    expect(proposeCategories([], pm)).toEqual({ categories: [], outOfScope: [], unmapped: [] });
  });
});
