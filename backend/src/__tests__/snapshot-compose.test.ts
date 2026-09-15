import { buildQuestionBankBundle } from "../fa/content/question-bank";
import { buildRulesEngineBundle } from "../rules/content/rules-engine-v1";
import { evaluateRules } from "../rules/engine";
import { ComposeInput, composeClientSnapshot, composeInternalAssessment } from "../snapshot/compose";
import { buildSnapshotTemplateBundle } from "../snapshot/template";

const qb = buildQuestionBankBundle();
const rules = buildRulesEngineBundle();
const template = buildSnapshotTemplateBundle();

/** Question-id keyed persona → effective answers by field_key (as the journey stores them). */
function byFieldKey(persona: Record<string, unknown>): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const [id, value] of Object.entries(persona)) {
    const question = qb.questions.find((q) => q.id === id);
    if (!question) throw new Error(`unknown question ${id}`);
    map.set(question.field_key, value);
  }
  return map;
}

function compose(persona: Record<string, unknown>, overrides: Partial<ComposeInput> = {}) {
  const answers = byFieldKey(persona);
  const evaluation = evaluateRules(rules, new Map([...answers].map(([k, v]) => [k, { value: v, answerId: `a:${k}` }])));
  const input: ComposeInput = {
    projectId: "00000000-0000-4000-8000-000000000001",
    generatedAt: new Date("2026-09-15T12:00:00Z"),
    versions: { questionBank: "fa-qb-1.0.0", rulesEngine: "re-1.0.0", snapshotTemplate: "st-1.0.0" },
    company: { name: "Northwind Manufacturing", website: null },
    person: { firstName: "Ana", lastName: "Rivera", preferredName: "Ana", deliverableLanguage: "en", interactionLanguage: "es" },
    answers,
    questionBank: qb,
    rules,
    template,
    evaluation,
    ...overrides,
  };
  return { evaluation, client: composeClientSnapshot(input), internal: composeInternalAssessment(input) };
}

/** QA persona 1: manufacturer entering Mexico with an existing customer commitment and imports. */
const MANUFACTURER = {
  STORY: "We make industrial valves in Texas and need to start assembling in Mexico for a new customer.",
  G1: "set_up_local_operation",
  G2: "Deliver the first contract volumes from Mexico on time.",
  G3: "firm_commitment",
  G4: { precision: "quarter", value: "2027-Q2" },
  G5: "customer_contract",
  G6: "existing_customer_demand",
  P1: "know_country_comparing_locations",
  P2: ["MX"],
  P3: "preparing_entry",
  P4: ["target_market", "commercial_model"],
  P6: "Choose between Monterrey and Saltillo.",
  SP1: "The market is decided; the site and legal structure are open.",
  B2: "manufacturing",
  B3: "b2b",
  B4: "physical_products",
  O1: ["manufacturing", "import_export", "local_workforce"],
  O_MFG_VOLUME: { amount: 20000, unit: "units" },
  O_IMP_SHIPMENTS: "21_100",
  O_IMP_CROSS_BORDER: "yes",
  O_WF_HIRING: "yes",
  O_WF_HEADCOUNT: "not_sure",
  CAP1: ["legal_corporate", "banking", "customs_trade"],
  CAP_BANKING: "need_to_establish",
  D1: "yes",
  D2: "local_entity_legal_setup",
  D3: "within_30_days",
  C1: ["customs_trade", "local_workforce"],
  C2: "customs_trade",
  C3: "Customer contract signed for deliveries starting Q2 2027.",
  C3_AREAS: ["go_to_market_commercial_strategy"],
  C_CONTRACT: "yes",
  C4: "Our quality certification process.",
  C4_AREAS: ["regulatory_permits_certifications"],
  C5: "Underestimating import lead times.",
  S1: "leading",
};

/** QA persona 2: SaaS company entering the US with no physical operations. */
const SAAS = {
  STORY: "We sell workflow software and want our first US customers.",
  G1: "find_customers_partners",
  G3: "approximate_timeframe",
  G4: { precision: "month", value: "2027-03" },
  P1: "know_country_location",
  P2: ["US"],
  P3: "validating",
  P4: ["offer"],
  B2: "technology_saas",
  O1: ["technology_systems"],
  O_TECH_SYSTEMS: ["crm"],
  O_TECH_INTEGRATION: "no",
  CAP1: ["sales_channels", "marketing"],
  D1: "not_yet",
  C1: ["go_to_market_commercial_strategy"],
  C_CONTRACT: "no",
  S1: "part_of_team",
};

/** Every string a person can read in the rendered Snapshot (structural keys excluded). */
function displayText(value: unknown, key = ""): string[] {
  if (typeof value === "string") return key === "tone" || key === "key" ? [] : [value];
  if (Array.isArray(value)) return value.flatMap((v) => displayText(v));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => displayText(v, k));
  return [];
}

const STATUS_OF_TONE = { well_defined: "DEFINED", needs_attention: "NEEDS_ATTENTION", resolve_early: "CRITICAL_GAP" } as const;

const INTERNAL_NAMES = [
  "Hive",
  "Business Check",
  "Country & Market Brief",
  "Trade & Market Access Strategy",
  "Supplier Search",
  "Local Partner Search",
  "Growth Strategy Playbook",
  "Feasibility",
  "STRONG",
  "SUPPORTING",
  "POSSIBLE",
  "CRITICAL_GAP",
  "NEEDS_ATTENTION",
  "NOT_APPLICABLE",
  "area.",
  "score",
  "maximum",
];

describe("Client Expansion Snapshot", () => {
  it("renders both locales from deterministic templates, verbatim answers and rule output", () => {
    const { client, evaluation } = compose(MANUFACTURER);
    const en = client.locales.en;
    expect(client).toMatchObject({ schema_version: 1, kind: "expansion_snapshot", deliverable_locale: "en" });
    expect(en.summary).toEqual([
      "Northwind Manufacturing is looking to set up a local operation in Mexico.",
      "The project is preparing for entry, with a firm commitment for Q2 2027.",
    ]);
    expect(client.locales.es.summary[0]).toBe("Northwind Manufacturing busca establecer una operación local en México.");
    expect(en.facts.map((f) => [f.key, f.value])).toEqual([
      ["company", "Northwind Manufacturing"],
      ["market", "Mexico"],
      ["launch", "Q2 2027"],
      ["priority", "Local entity & legal setup"],
    ]);
    expect(en.immediatePriority).toEqual({ title: "Your immediate priority", value: "Local entity & legal setup", timing: "Within 30 days", reason: null });
    expect(en.decisionAhead?.text).toBe(MANUFACTURER.P6);
    expect(en.oneThing?.text).toBe(MANUFACTURER.C5);
    expect(en.disclosure.text).toBe(
      "This initial interpretation is based on the information you shared with us. As we learn more about your project, beeside can provide greater context, precision and value to help you move forward.",
    );
    // Counts and panels agree with the rules output; ceilings are never exceeded.
    for (const panel of en.panels) {
      expect(panel.items.length).toBeLessThanOrEqual(5);
      expect(panel.items.map((i) => i.areaId)).toEqual(evaluation.panels[STATUS_OF_TONE[panel.tone]]);
    }
    expect(en.counts.map((c) => c.count)).toEqual([evaluation.panelCounts.DEFINED, evaluation.panelCounts.NEEDS_ATTENTION, evaluation.panelCounts.CRITICAL_GAP]);
    expect(en.capabilities?.items.length).toBeLessThanOrEqual(6);
  });

  it("never exposes internal service names, signal strengths, rule ids, ceilings or scores", () => {
    for (const persona of [MANUFACTURER, SAAS]) {
      const { client } = compose(persona);
      const serialized = JSON.stringify(client.locales);
      for (const status of ["DEFINED", "NEEDS_ATTENTION", "CRITICAL_GAP", "NOT_APPLICABLE"]) expect(serialized).not.toContain(status);
      const strings = displayText(client.locales);
      const visible = strings.join(" | ");
      for (const name of INTERNAL_NAMES) expect(visible).not.toContain(name);
      // No unfilled template variables or stringified placeholders ("still undefined" is real copy).
      expect(visible).not.toMatch(/\{\{|NaN|\[object Object\]/);
      expect(strings.filter((s) => ["", "null", "undefined"].includes(s.trim()))).toEqual([]);
    }
  });

  it("does not repeat the declared priority inside Resolve early and shows reasons only where they matter", () => {
    const { client, evaluation } = compose(MANUFACTURER);
    expect(evaluation.priorityAreaId).toBe(11);
    const critical = client.locales.en.panels.find((p) => p.tone === "resolve_early");
    expect(critical?.items.map((i) => i.areaId)).not.toContain(11);
    expect(critical?.items.every((i) => i.reason)).toBe(true);
    const defined = compose(SAAS).client.locales.en.panels.find((p) => p.tone === "well_defined");
    expect(defined?.items.length).toBeGreaterThan(0);
    expect(defined?.items.every((i) => i.reason === null)).toBe(true);
  });

  it("omits sections gracefully instead of padding or printing placeholders (QA persona 2)", () => {
    const { client } = compose(SAAS);
    const en = client.locales.en;
    expect(en.immediatePriority).toBeNull();
    expect(en.reconcile).toBeNull();
    expect(en.decisionAhead).toBeNull();
    expect(en.oneThing).toBeNull();
    expect(en.panels.every((p) => p.items.length > 0)).toBe(true);
    // Operational dependency (O1) outranks a target-market capability need in the Priority weighting order.
    expect(en.capabilities?.items.map((c) => c.label)).toEqual(["Systems & technology", "Go-to-market strategy"]);
    expect(en.summary).toEqual([
      "Northwind Manufacturing is looking to find customers or commercial partners in United States.",
      "The project is validating key assumptions, with an approximate timeframe of March 2027.",
    ]);
  });

  it("shows Something to Reconcile as a single line only when a tension is detected", () => {
    const tension = compose({ ...SAAS, P3: "preparing_entry", CAP1: ["legal_corporate", "sales_channels"], D1: "yes", D2: "go_to_market_commercial_strategy", D3: "immediately" });
    expect(tension.client.locales.en.reconcile).toEqual({
      title: "Something to reconcile",
      text: "Your priority is to define how you'll sell and compete locally, but the local legal structure required to support that is still unresolved.",
    });
  });
});

describe("Internal beeside Assessment", () => {
  it("is richer than the client Snapshot and keeps declared and derived information distinct", () => {
    const { internal, evaluation } = compose(MANUFACTURER);
    expect(internal.findings).toHaveLength(14);
    expect(internal.findings.every((f) => f.rule_triggered && f.reason_internal && f.source_type === "DERIVED_BY_RULE")).toBe(true);
    expect(internal.declared_priority).toMatchObject({ source_type: "DECLARED_BY_USER", client_priority: "local_entity_legal_setup", timing: "within_30_days" });
    expect(internal.derived_early_attention.area_ids[0]).toBe(11);
    expect(internal.narrative.project_story_raw).toBe(MANUFACTURER.STORY);
    expect(internal.narrative.strategic_prompts).toMatchObject({
      "fa.strategic.decided_vs_open": MANUFACTURER.SP1,
      "fa.constraints.existing_commitments": MANUFACTURER.C3,
      "fa.constraints.non_negotiables": MANUFACTURER.C4,
    });
    expect(internal.volumetrics.map((v) => v.field_key)).toEqual([
      "fa.operation.manufacturing.monthly_volume",
      "fa.operation.import_export.monthly_shipments",
      "fa.operation.workforce.first_year_headcount",
    ]);
    expect(internal.candidate_services.map((s) => s.signal)).toEqual(expect.arrayContaining(["Trade & Market Access Strategy", "The Hive: Firm Infrastructure / company setup"]));
    expect(internal.not_sure_answers).toEqual(["fa.operation.workforce.first_year_headcount"]);
    expect(internal.handoff_quality).toMatchObject({ rating: "HIGH", not_sure_count: 1 });
    expect(internal.constraints.decision_flexibility).toMatchObject({ rating: "LOW", declared_commitments: 4 });
    expect(internal.capabilities.length).toBe(evaluation.capabilities.length);
  });

  it("builds precision_focus from the tension, ranked findings, open answers and stop/go criteria", () => {
    const { internal } = compose({ ...MANUFACTURER, P3: "validating", STOPGO: ["economics", "timeline"], D2: "go_to_market_commercial_strategy", CAP1: ["legal_corporate", "commercial_strategy"] });
    const kinds = internal.precision_focus.map((p) => p.kind);
    expect(kinds[0]).toBe("priority_tension");
    expect(kinds).toContain("finding");
    expect(kinds).toContain("not_sure_answer");
    expect(kinds[kinds.length - 1]).toBe("stop_go");
    expect(internal.precision_focus[internal.precision_focus.length - 1]?.text.en).toBe("Validate the stop/go criteria: The economics don’t work, The timeline isn’t achievable.");
    expect(internal.recommended_questions.en.length).toBe(kinds.filter((k) => k === "finding").length);
  });

  it("assembles the Executive Intake Summary deterministically, omitting what is unknown", () => {
    const { internal } = compose(MANUFACTURER);
    expect(internal.executive_summary.en).toBe(
      "Manufacturing business evaluating Mexico. Expansion driver: Existing customer demand. Timing: Yes — a firm commitment (driven by: A customer or contract). Expected operation: Manufacturing, Import / export. Still undefined: Local entity & legal setup, Customs & trade structure. Primary concern: Underestimating import lead times. Respondent: Yes, I’m leading it.",
    );
    const saas = compose(SAAS).internal.executive_summary.en;
    expect(saas).not.toMatch(/Primary concern|Expansion driver/);
  });
});
