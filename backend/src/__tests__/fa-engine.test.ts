import { buildQuestionBankBundle } from "../fa/content/question-bank";
import { evaluateCondition } from "../fa/engine/conditions";
import { computeJourney } from "../fa/engine/journey";
import { validateQuestionBankBundle } from "../fa/engine/validate-bundle";
import { isNotSureValue, validateAnswerValue } from "../fa/engine/values";

const bundle = buildQuestionBankBundle();
const question = (id: string) => {
  const found = bundle.questions.find((q) => q.id === id);
  if (!found) throw new Error(`missing question ${id}`);
  return found;
};

/** Minimal complete answer set for an exploring SaaS company (no operation follow-ups). */
function baseAnswers(): Map<string, unknown> {
  return new Map<string, unknown>([
    ["fa.project.story_raw", "We want to open a US office."],
    ["fa.project.another_project_in_mind", "no"],
    ["fa.goal.primary_goal", "start_selling_locally"],
    ["fa.goal.success_definition", "Ten enterprise customers."],
    ["fa.goal.launch_timing_status", "not_yet"],
    ["fa.goal.expansion_driver", "growth_targets"],
    ["fa.project.destination_status", "havent_decided"],
    ["fa.project.stage", "exploring"],
    ["fa.project.defined_areas", ["none"]],
    ["fa.project.previous_expansion_experience", "no"],
    ["fa.project.next_decision", "Pick the first market."],
    ["fa.strategic.decided_vs_open", "Product is decided; market is open."],
    ["fa.business.description", "We build scheduling software."],
    ["fa.business.type", "technology_saas"],
    ["fa.business.customer_model", "b2b"],
    ["fa.business.revenue_model", "software_subscriptions"],
    ["fa.business.employee_band", "11_50"],
    ["fa.strategic.commercial_success", "Recurring revenue within a year."],
    ["fa.operation.components", ["other"]],
    ["fa.operation.expected_capabilities", ["not_sure"]],
    ["fa.priority.priority_known", "not_sure"],
    ["fa.project.stop_go_criteria", ["nothing_specific"]],
    ["fa.constraints.items", ["not_sure"]],
    ["fa.strategic.slowdown_concern", "Hiring."],
    ["fa.constraints.existing_commitments", "Nothing yet."],
    ["fa.constraints.commitment_areas", ["none"]],
    ["fa.constraints.has_customer_contract", "no"],
    ["fa.constraints.non_negotiables", "Nothing fixed yet."],
    ["fa.constraints.non_negotiable_areas", ["none"]],
    ["fa.project.primary_concern", "Choosing the wrong market."],
    ["fa.ownership.project_responsibility", "leading"],
    ["fa.preferences.interaction_language", "es"],
    ["fa.preferences.deliverable_language", "en"],
  ]);
}

describe("First Assessment question bank v1", () => {
  it("is structurally valid against the canonical field registry", () => {
    expect(validateQuestionBankBundle(bundle)).toEqual([]);
  });

  it("keeps the approved macro progression and journey order with no review step", () => {
    expect(bundle.stages.map((s) => s.id)).toEqual(["project", "business", "operation", "priorities", "snapshot"]);
    expect(bundle.steps.map((s) => s.id)).toEqual([
      "project_story", "goal", "project", "business_transition", "business", "operation_transition",
      "operation_components", "operation_details", "operation_capabilities", "priorities", "constraints", "preferences",
    ]);
  });

  it("offers the five approved strategic open-text prompts", () => {
    for (const id of ["SP1", "SP2", "SP3", "C3", "C4"]) expect(question(id).type).toBe("text");
  });
});

describe("conditions", () => {
  it("never satisfies a negative test with an unanswered field", () => {
    const empty = new Map<string, unknown>();
    expect(evaluateCondition({ field: "x", op: "neq", value: "a" }, empty)).toBe(false);
    expect(evaluateCondition({ field: "x", op: "not_in", values: ["a"] }, empty)).toBe(false);
  });
});

describe("journey", () => {
  it("completes deterministically once every applicable required answer exists and the last step is confirmed", () => {
    const journey = computeJourney(bundle, baseAnswers(), "preferences");
    expect(journey.steps.flatMap((s) => s.missingRequired)).toEqual([]);
    expect(journey.complete).toBe(true);
    expect(journey.currentStepId).toBeNull();
  });

  it("skips operation follow-ups when no relevant component is selected", () => {
    const journey = computeJourney(bundle, baseAnswers(), null);
    expect(journey.steps.find((s) => s.step.id === "operation_details")?.applicable).toBe(false);
    expect(journey.currentStepId).toBe("project_story");
  });

  it("asks timing follow-ups only when a start date exists", () => {
    const answers = baseAnswers();
    expect(computeJourney(bundle, answers, null).applicableQuestionIds.has("G4")).toBe(false);
    answers.set("fa.goal.launch_timing_status", "firm_commitment");
    const journey = computeJourney(bundle, answers, "preferences");
    expect(journey.applicableQuestionIds.has("G4")).toBe(true);
    expect(journey.currentStepId).toBe("goal");
    expect(journey.complete).toBe(false);
  });

  it("invalidates dependent answers when a foundational answer changes, keeping them stored", () => {
    const answers = baseAnswers();
    answers.set("fa.project.stage", "already_operating");
    answers.set("fa.operation.growth_focus", ["grow_sales"]);
    let journey = computeJourney(bundle, answers, "preferences");
    expect(journey.effectiveAnswers.get("fa.operation.growth_focus")).toEqual(["grow_sales"]);
    expect(journey.applicableQuestionIds.has("STOPGO")).toBe(false);

    answers.set("fa.project.stage", "exploring");
    journey = computeJourney(bundle, answers, "preferences");
    expect(journey.applicableQuestionIds.has("GROWTH1")).toBe(false);
    expect(journey.effectiveAnswers.has("fa.operation.growth_focus")).toBe(false);
    expect(answers.get("fa.operation.growth_focus")).toEqual(["grow_sales"]);
  });

  it("asks for the biggest-impact constraint only among two or more selected items and drops stale choices", () => {
    const answers = baseAnswers();
    answers.set("fa.constraints.items", ["banking", "insurance"]);
    answers.set("fa.constraints.critical", "insurance");
    let journey = computeJourney(bundle, answers, "preferences");
    expect(journey.effectiveAnswers.get("fa.constraints.critical")).toBe("insurance");

    answers.set("fa.constraints.items", ["banking", "technology_systems"]);
    journey = computeJourney(bundle, answers, "preferences");
    expect(journey.effectiveAnswers.has("fa.constraints.critical")).toBe(false);
    expect(journey.currentStepId).toBe("constraints");
  });

  it("shows the already-operating growth question only for already-operating projects", () => {
    const answers = baseAnswers();
    answers.set("fa.project.stage", "already_operating");
    const journey = computeJourney(bundle, answers, "preferences");
    expect(journey.applicableQuestionIds.has("GROWTH1")).toBe(true);
    expect(journey.currentStepId).toBe("operation_capabilities");
  });
});

describe("answer values", () => {
  const empty = new Map<string, unknown>();

  it("keeps Not sure mutually exclusive in multi-selects", () => {
    expect(validateAnswerValue(question("CAP1"), ["not_sure", "tax"], empty).ok).toBe(false);
    expect(validateAnswerValue(question("CAP1"), ["not_sure"], empty).ok).toBe(true);
    expect(validateAnswerValue(question("GROWTH1"), ["grow_sales", "improve_logistics"], empty).ok).toBe(true);
  });

  it("accepts the four timing precisions and rejects impossible dates", () => {
    const g4 = question("G4");
    expect(validateAnswerValue(g4, { precision: "date", value: "2027-02-28" }, empty).ok).toBe(true);
    expect(validateAnswerValue(g4, { precision: "date", value: "2027-02-30" }, empty).ok).toBe(false);
    expect(validateAnswerValue(g4, { precision: "month", value: "2027-11" }, empty).ok).toBe(true);
    expect(validateAnswerValue(g4, { precision: "quarter", value: "2028-Q3" }, empty).ok).toBe(true);
    expect(validateAnswerValue(g4, { precision: "not_sure" }, empty)).toEqual({ ok: true, value: { precision: "not_sure", value: null } });
  });

  it("stores open text verbatim and validates structured countries and quantities", () => {
    const story = "  We’re  expanding to Mexico.\nFirst: Monterrey.  ";
    expect(validateAnswerValue(question("STORY"), story, empty)).toEqual({ ok: true, value: story });
    expect(validateAnswerValue(question("P2"), ["MX", "US"], empty).ok).toBe(true);
    expect(validateAnswerValue(question("P2"), ["XX"], empty).ok).toBe(false);
    expect(validateAnswerValue(question("O_WH_SCALE"), { amount: 1200, unit: "pallet_positions" }, empty).ok).toBe(true);
    expect(validateAnswerValue(question("O_WH_SCALE"), { amount: 1200, unit: "barrels" }, empty).ok).toBe(false);
    expect(validateAnswerValue(question("O_MFG_VOLUME"), { not_sure: true }, empty).ok).toBe(true);
  });

  it("recognises explicit uncertainty without treating it as missing", () => {
    expect(isNotSureValue("not_sure")).toBe(true);
    expect(isNotSureValue(["not_sure"])).toBe(true);
    expect(isNotSureValue({ precision: "not_sure", value: null })).toBe(true);
    expect(isNotSureValue("not_yet")).toBe(false);
  });
});
