import { FA_FIELDS, FIELD_KEY_PATTERN, RULES_CATEGORY_ID, RULES_CATEGORY_VALUES, getFieldDefinition } from "./fields";

describe("First Assessment canonical fields", () => {
  it("uses unique, well-formed fa.* keys", () => {
    const keys = FA_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(FIELD_KEY_PATTERN);
      expect(key.startsWith("fa.")).toBe(true);
    }
  });

  it("declares values for every select field and keeps exclusive values inside them", () => {
    for (const f of FA_FIELDS) {
      if (f.dataType === "single_select" || f.dataType === "multi_select" || f.dataType === "locale") {
        expect(f.values && f.values.length > 0).toBe(true);
      }
      for (const v of f.exclusiveValues ?? []) expect(f.values).toContain(v);
      if (f.exclusiveValues) expect(f.dataType).toBe("multi_select");
      expect(new Set(f.values ?? []).size).toBe((f.values ?? []).length);
    }
  });

  it("binds every identity field to a column and never binds question-bank fields", () => {
    for (const f of FA_FIELDS) {
      if (f.source === "identity") expect(f.binding).toBeDefined();
      else expect(f.binding).toBeUndefined();
    }
  });

  it("keeps the Rules Matrix v1 §0 fixed category list (15 values, Other last) aligned with catalog ids", () => {
    expect(RULES_CATEGORY_VALUES).toHaveLength(15);
    expect(RULES_CATEGORY_ID.target_market).toBe(1);
    expect(RULES_CATEGORY_ID.go_to_market_commercial_strategy).toBe(14);
    expect(RULES_CATEGORY_ID.other).toBe(15);
    for (const key of ["fa.priority.client_priority", "fa.constraints.critical"]) {
      expect(getFieldDefinition(key)?.values).toEqual(RULES_CATEGORY_VALUES);
    }
  });

  it("offers the ten already-operating growth intents with Not sure yet mutually exclusive", () => {
    const growth = getFieldDefinition("fa.operation.growth_focus");
    expect(growth?.values).toHaveLength(10);
    expect(growth?.exclusiveValues).toEqual(["not_sure"]);
  });

  it("captures destination market, industry, objective and timing as structured fields for Precision", () => {
    expect(getFieldDefinition("fa.project.target_markets")?.dataType).toBe("country_list");
    expect(getFieldDefinition("fa.business.type")?.dataType).toBe("single_select");
    expect(getFieldDefinition("fa.goal.primary_goal")?.dataType).toBe("single_select");
    expect(getFieldDefinition("fa.goal.launch_target")?.dataType).toBe("timing");
  });
});
