import { QuestionDef } from "./bundle-types";
import { validateAnswerValue } from "./values";

const NEEDS_MAP_QUESTION: QuestionDef = {
  id: "NEEDS1",
  field_key: "fa.needs.map",
  type: "needs_map",
  required: true,
  copy: { en: { title: "Needs" }, es: { title: "Necesidades" } },
};

const TAG_LIST_QUESTION: QuestionDef = {
  id: "RESTRICTED1",
  field_key: "fa.provider.restricted_counterparties",
  type: "tag_list",
  required: false,
  copy: { en: { title: "Restricted counterparties" }, es: { title: "Contrapartes restringidas" } },
};

const effective = new Map<string, unknown>();

describe("validateAnswerValue — needs_map", () => {
  it("accepts a well-formed map with selections, priority rank and a dependency", () => {
    const result = validateAnswerValue(
      NEEDS_MAP_QUESTION,
      {
        selections: [
          { key: "company_setup", status: "needs_resolution" },
          { key: "banking", status: "in_progress" },
        ],
        priorityRank: ["company_setup", "banking"],
        dependencies: [{ key: "banking", dependsOn: "company_setup", owner: "Finance lead", approvalRequired: true, approvalFrom: "CFO" }],
        blockerKeys: ["company_setup"],
      },
      effective,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown leaf key", () => {
    const result = validateAnswerValue(NEEDS_MAP_QUESTION, { selections: [{ key: "not_a_real_leaf", status: "in_progress" }], priorityRank: [], dependencies: [], blockerKeys: [] }, effective);
    expect(result.ok).toBe(false);
  });

  it("rejects priorityRank referencing a key that was never selected", () => {
    const result = validateAnswerValue(
      NEEDS_MAP_QUESTION,
      { selections: [{ key: "company_setup", status: "in_progress" }], priorityRank: ["banking"], dependencies: [], blockerKeys: [] },
      effective,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects more than 5 priorities", () => {
    const selections = ["company_setup", "banking", "insurance", "erp", "wms", "tms"].map((key) => ({ key, status: "in_progress" as const }));
    const result = validateAnswerValue(
      NEEDS_MAP_QUESTION,
      { selections, priorityRank: selections.map((s) => s.key), dependencies: [], blockerKeys: [] },
      effective,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a dependency cycle", () => {
    const result = validateAnswerValue(
      NEEDS_MAP_QUESTION,
      {
        selections: [
          { key: "company_setup", status: "needs_resolution" },
          { key: "banking", status: "needs_resolution" },
        ],
        priorityRank: ["company_setup", "banking"],
        dependencies: [
          { key: "company_setup", dependsOn: "banking", approvalRequired: false, owner: null, approvalFrom: null },
          { key: "banking", dependsOn: "company_setup", approvalRequired: false, owner: null, approvalFrom: null },
        ],
        blockerKeys: [],
      },
      effective,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a status/selection with category selection conflated (missing independent status)", () => {
    const result = validateAnswerValue(NEEDS_MAP_QUESTION, { selections: [{ key: "company_setup" }], priorityRank: [], dependencies: [], blockerKeys: [] }, effective);
    expect(result.ok).toBe(false);
  });
});

describe("validateAnswerValue — tag_list", () => {
  it("accepts a short list of trimmed, deduplicated entries", () => {
    const result = validateAnswerValue(TAG_LIST_QUESTION, ["Acme Corp", " Globex "], effective);
    expect(result).toEqual({ ok: true, value: ["Acme Corp", "Globex"] });
  });

  it("rejects a duplicate entry (case-insensitive)", () => {
    const result = validateAnswerValue(TAG_LIST_QUESTION, ["Acme Corp", "acme corp"], effective);
    expect(result.ok).toBe(false);
  });

  it("rejects more entries than max_tags allows", () => {
    const question: QuestionDef = { ...TAG_LIST_QUESTION, max_tags: 2 };
    const result = validateAnswerValue(question, ["A", "B", "C"], effective);
    expect(result.ok).toBe(false);
  });

  it("clears cleanly with null when optional", () => {
    const result = validateAnswerValue(TAG_LIST_QUESTION, null, effective);
    expect(result).toEqual({ ok: true, value: null });
  });
});
