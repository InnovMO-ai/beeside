import { getFieldDefinition } from "@beeside/canonical-fields";
import type { Locale } from "../fa/engine/bundle-types";
import { isAnswered } from "../fa/engine/conditions";
import { evaluateRuleCondition, RuleContext } from "./conditions";
import {
  AreaDefinition,
  FindingStatus,
  PressurePrimitive,
  RANKING_FACTORS,
  RankingFactor,
  RulesEngineBundle,
  SignalStrength,
} from "./types";

/** One declared answer as the engine sees it: the stored value and the answer row it came from. */
export interface AnswerEvidence {
  value: unknown;
  answerId: string | null;
}
export type EvidenceMap = ReadonlyMap<string, AnswerEvidence>;

export interface EngineSignal {
  signal: string | null;
  strength: Exclude<SignalStrength, "NO_SIGNAL">;
  /** Raised one tier by an already-operating growth-focus response (Rules Matrix v1 §15). */
  boosted: boolean;
}

export interface FindingResult {
  areaId: number;
  category: string;
  status: FindingStatus;
  ruleTriggered: string;
  /** Client-facing reason per locale; null for NOT_APPLICABLE (never shown). */
  reasonClient: Record<Locale, string> | null;
  reasonInternal: string;
  evidence: Array<{ fieldKey: string; answerId: string | null; value: unknown }>;
  pressureMatched: PressurePrimitive[];
  signals: EngineSignal[];
  internalSignal: string | null;
  signalStrength: SignalStrength;
  factors: Record<RankingFactor, boolean>;
  /** 1-based rank inside its status panel (uncapped); null when not ranked in a panel. */
  panelRank: number | null;
  includedInSnapshot: boolean;
}

export interface CapabilityResult {
  categoryId: number;
  rank: number;
  includedInSnapshot: boolean;
  sourceAreaIds: number[];
  factors: Record<RankingFactor | "growth_boost", boolean>;
}

export interface PriorityAlignmentResult {
  alignment: "ALIGNED" | "TENSION_DETECTED";
  priorityCategory: string | null;
  tensionAreaId: number | null;
  testsMatched: Array<"shared_commitment" | "shared_timing_driver" | "go_to_market_dependency">;
  ruleTriggered: string | null;
  reason: Record<Locale, string> | null;
}

export interface RulesEvaluation {
  findings: FindingResult[];
  /** Area ids shown per panel, in display order, after ceilings. */
  panels: Record<"DEFINED" | "NEEDS_ATTENTION" | "CRITICAL_GAP", number[]>;
  /** Qualifying findings per panel before ceilings (the at-a-glance counts). */
  panelCounts: Record<"DEFINED" | "NEEDS_ATTENTION" | "CRITICAL_GAP", number>;
  /** CRITICAL_GAP area equal to the declared Immediate Priority (shown only as the priority). */
  priorityAreaId: number | null;
  priorityAlignment: PriorityAlignmentResult;
  capabilities: CapabilityResult[];
  strategicSignals: Array<{ signal: string; strength: "POSSIBLE"; source: string }>;
  boostedAreaIds: number[];
  /** Deferred near-timing primitive (Decision Log Part C): inert while the threshold is unset. */
  nearTiming: boolean;
}

const F = {
  launchTimingStatus: "fa.goal.launch_timing_status",
  launchTarget: "fa.goal.launch_target",
  timingDriver: "fa.goal.timing_driver",
  customerContract: "fa.constraints.has_customer_contract",
  commitmentAreas: "fa.constraints.commitment_areas",
  nonNegotiableAreas: "fa.constraints.non_negotiable_areas",
  priorityKnown: "fa.priority.priority_known",
  clientPriority: "fa.priority.client_priority",
  criticalConstraint: "fa.constraints.critical",
  constraintItems: "fa.constraints.items",
  stage: "fa.project.stage",
  growthFocus: "fa.operation.growth_focus",
} as const;

const STRENGTH_ORDER: Array<Exclude<SignalStrength, "NO_SIGNAL">> = ["POSSIBLE", "SUPPORTING", "STRONG"];

function listIncludes(answers: ReadonlyMap<string, unknown>, field: string, value: string): boolean {
  const current = answers.get(field);
  return Array.isArray(current) && current.map(String).includes(value);
}

/** Immediate Priority as declared (D1 = yes and D2 answered); never derived. */
function declaredPriority(answers: ReadonlyMap<string, unknown>): string | null {
  const priority = answers.get(F.clientPriority);
  return answers.get(F.priorityKnown) === "yes" && typeof priority === "string" ? priority : null;
}

export function pressureApplies(primitive: PressurePrimitive, category: string, answers: ReadonlyMap<string, unknown>): boolean {
  switch (primitive) {
    case "firm_commitment":
      return answers.get(F.launchTimingStatus) === "firm_commitment";
    case "customer_contract":
      return answers.get(F.customerContract) === "yes";
    case "commitment_area":
      return listIncludes(answers, F.commitmentAreas, category);
    case "non_negotiable_area":
      return listIncludes(answers, F.nonNegotiableAreas, category);
    case "client_priority":
      return declaredPriority(answers) === category;
    case "critical_constraint":
      return answers.get(F.criticalConstraint) === category;
    case "constraint_item":
      return listIncludes(answers, F.constraintItems, category);
    case "contract_and_commitment_area":
      return answers.get(F.customerContract) === "yes" && listIncludes(answers, F.commitmentAreas, category);
    case "execution_stage":
      return answers.get(F.stage) === "preparing_entry" || answers.get(F.stage) === "already_executing";
    default:
      return false;
  }
}

/**
 * Near timing is explicitly not implemented in Functional Freeze v1: with no approved threshold it
 * never fires, and even when configured it is not a CRITICAL_GAP pressure test in this version.
 */
export function nearTimingApplies(bundle: RulesEngineBundle, answers: ReadonlyMap<string, unknown>, now: Date): boolean {
  const threshold = bundle.near_timing_threshold_days;
  if (threshold === null) return false;
  const target = answers.get(F.launchTarget) as { precision?: string; value?: string } | undefined;
  if (!target || typeof target.value !== "string" || target.precision !== "date") return false;
  const days = (Date.parse(`${target.value}T00:00:00Z`) - now.getTime()) / 86_400_000;
  return days >= 0 && days <= threshold;
}

function fill(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, name: string) => variables[name] ?? match);
}

function describeValue(fieldKey: string, value: unknown): string {
  if (getFieldDefinition(fieldKey)?.openText) return "(open text provided)";
  return JSON.stringify(value);
}

function compareFactors<K extends string>(order: readonly K[], a: Record<K, boolean>, b: Record<K, boolean>): number {
  for (const key of order) {
    if (a[key] !== b[key]) return a[key] ? -1 : 1;
  }
  return 0;
}

function raise(strength: Exclude<SignalStrength, "NO_SIGNAL">): Exclude<SignalStrength, "NO_SIGNAL"> {
  return STRENGTH_ORDER[Math.min(STRENGTH_ORDER.indexOf(strength) + 1, STRENGTH_ORDER.length - 1)] ?? strength;
}

function evaluateArea(
  bundle: RulesEngineBundle,
  area: AreaDefinition,
  evidence: EvidenceMap,
  answers: ReadonlyMap<string, unknown>,
  boosted: ReadonlySet<number>,
): FindingResult {
  const ctx: RuleContext = { answers };
  const locales = bundle.locales;
  const factors = rankingFactors(area, answers);
  const base = {
    areaId: area.id,
    category: area.category,
    factors,
    panelRank: null,
    includedInSnapshot: false,
  };

  if (!evaluateRuleCondition(area.applies_when, ctx)) {
    return {
      ...base,
      status: "NOT_APPLICABLE",
      ruleTriggered: `area.${area.id}.not_applicable`,
      reasonClient: null,
      reasonInternal: `area.${area.id}.not_applicable → NOT_APPLICABLE: relevance trigger not present.`,
      evidence: [],
      pressureMatched: [],
      signals: [],
      internalSignal: null,
      signalStrength: "NO_SIGNAL",
    };
  }

  let status: FindingStatus = area.fallback.status;
  let ruleId = area.fallback.id;
  let copy = area.fallback.copy;
  let pressureMatched: PressurePrimitive[] = [];

  const critical = area.critical.find((rule) => {
    if (!evaluateRuleCondition(rule.unresolved, ctx)) return false;
    pressureMatched = rule.pressure.filter((p) => pressureApplies(p, area.category, answers));
    return pressureMatched.length > 0;
  });
  if (critical) {
    status = "CRITICAL_GAP";
    ruleId = critical.id;
    copy = critical.copy;
  } else {
    pressureMatched = [];
    const rule = area.rules.find((r) => evaluateRuleCondition(r.when, ctx));
    if (rule) {
      status = rule.status;
      ruleId = rule.id;
      copy = rule.copy;
    }
  }

  const reasonClient = {} as Record<Locale, string>;
  for (const locale of locales) {
    const pressureCopy = pressureMatched[0] ? bundle.pressure_reasons.find((p) => p.id === pressureMatched[0])?.copy[locale].reason : undefined;
    reasonClient[locale] = fill(copy[locale].reason, { pressure_reason: pressureCopy ?? "" });
  }

  const presentEvidence = area.evidence_fields
    .filter((key) => evidence.has(key) && isAnswered(evidence.get(key)?.value))
    .map((key) => ({ fieldKey: key, answerId: evidence.get(key)?.answerId ?? null, value: evidence.get(key)?.value }));

  const signalCtx: RuleContext = { answers, status };
  const signals: EngineSignal[] = [];
  for (const rule of area.signals) {
    if (!evaluateRuleCondition(rule.when, signalCtx)) continue;
    if (signals.some((s) => s.signal === rule.signal)) continue;
    const strength =
      rule.strength === "BY_STATUS" ? (status === "CRITICAL_GAP" ? "STRONG" : status === "NEEDS_ATTENTION" ? "SUPPORTING" : "POSSIBLE") : rule.strength;
    // Boosts never stack: at most one tier per area, whatever the number of growth responses.
    signals.push(boosted.has(area.id) ? { signal: rule.signal, strength: raise(strength), boosted: true } : { signal: rule.signal, strength, boosted: false });
  }
  const strongest = [...signals].sort((a, b) => STRENGTH_ORDER.indexOf(b.strength) - STRENGTH_ORDER.indexOf(a.strength));
  const named = strongest.find((s) => s.signal !== null);

  const reasonInternal = [
    `${ruleId} → ${status}.`,
    presentEvidence.length > 0 ? `Evidence: ${presentEvidence.map((e) => `${e.fieldKey}=${describeValue(e.fieldKey, e.value)}`).join("; ")}.` : "No declared evidence beyond relevance.",
    pressureMatched.length > 0 ? `Material pressure: ${pressureMatched.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    ...base,
    status,
    ruleTriggered: ruleId,
    reasonClient,
    reasonInternal,
    evidence: presentEvidence,
    pressureMatched,
    signals,
    internalSignal: named?.signal ?? null,
    signalStrength: strongest[0]?.strength ?? "NO_SIGNAL",
  };
}

function rankingFactors(area: AreaDefinition, answers: ReadonlyMap<string, unknown>): Record<RankingFactor, boolean> {
  const ctx: RuleContext = { answers };
  const has = (factor: "operational_dependency" | "capability_need" | "scale_volume") => {
    const condition = area.weighting[factor];
    return condition ? evaluateRuleCondition(condition, ctx) : false;
  };
  return {
    client_priority: pressureApplies("client_priority", area.category, answers),
    firm_deadline: pressureApplies("firm_commitment", area.category, answers) || pressureApplies("commitment_area", area.category, answers),
    critical_constraint: pressureApplies("critical_constraint", area.category, answers),
    contractual_commitment: area.contract_linked && pressureApplies("customer_contract", area.category, answers),
    operational_dependency: has("operational_dependency"),
    capability_need: has("capability_need"),
    scale_volume: has("scale_volume"),
    general_interest: pressureApplies("constraint_item", area.category, answers) || pressureApplies("non_negotiable_area", area.category, answers),
  };
}

/**
 * evaluate(rules_engine_version, current answers) → findings, panels, priority alignment and
 * capability ranks. Pure: no clock (except the inert near-timing check), no I/O, no hidden state.
 * Only applicable DECLARED_BY_USER answers may be passed in.
 */
export function evaluateRules(bundle: RulesEngineBundle, evidence: EvidenceMap, now: Date = new Date(0)): RulesEvaluation {
  const answers = new Map<string, unknown>([...evidence].map(([key, entry]) => [key, entry.value]));
  const growth = answers.get(F.growthFocus);
  const growthValues = Array.isArray(growth) ? growth.map(String).filter((v) => v !== "not_sure") : [];
  const selectedBoosts = bundle.growth_boosts.filter((b) => growthValues.includes(b.value));
  const boostedAreaIds = new Set(selectedBoosts.flatMap((b) => b.area_ids));
  const capabilityBoostAreaIds = new Set(selectedBoosts.filter((b) => b.capability_boost).flatMap((b) => b.area_ids));

  const findings = [...bundle.areas]
    .sort((a, b) => a.id - b.id)
    .map((area) => evaluateArea(bundle, area, evidence, answers, boostedAreaIds));

  const byWeighting = (a: FindingResult, b: FindingResult) => compareFactors(RANKING_FACTORS, a.factors, b.factors) || a.areaId - b.areaId;
  const priorityCategory = declaredPriority(answers);
  const priorityArea = findings.find((f) => f.status === "CRITICAL_GAP" && f.category === priorityCategory) ?? null;

  const ranked = {
    DEFINED: findings.filter((f) => f.status === "DEFINED").sort((a, b) => a.areaId - b.areaId),
    NEEDS_ATTENTION: findings.filter((f) => f.status === "NEEDS_ATTENTION").sort(byWeighting),
    CRITICAL_GAP: findings.filter((f) => f.status === "CRITICAL_GAP" && f !== priorityArea).sort(byWeighting),
  };
  const panels = { DEFINED: [] as number[], NEEDS_ATTENTION: [] as number[], CRITICAL_GAP: [] as number[] };
  for (const key of ["DEFINED", "NEEDS_ATTENTION", "CRITICAL_GAP"] as const) {
    ranked[key].forEach((finding, index) => {
      finding.panelRank = index + 1;
      finding.includedInSnapshot = index < bundle.panels[key].ceiling;
      if (finding.includedInSnapshot) panels[key].push(finding.areaId);
    });
  }

  const capabilities = rankCapabilities(bundle, findings, capabilityBoostAreaIds);
  const priorityAlignment = detectTension(bundle, findings, answers, priorityCategory, byWeighting);

  return {
    findings,
    panels,
    panelCounts: { DEFINED: ranked.DEFINED.length, NEEDS_ATTENTION: ranked.NEEDS_ATTENTION.length, CRITICAL_GAP: ranked.CRITICAL_GAP.length },
    priorityAreaId: priorityArea?.areaId ?? null,
    priorityAlignment,
    capabilities,
    strategicSignals: selectedBoosts
      .filter((b) => b.strategic_signal)
      .map((b) => ({ signal: b.strategic_signal as string, strength: "POSSIBLE" as const, source: `fa.operation.growth_focus=${b.value}` })),
    boostedAreaIds: [...boostedAreaIds].sort((a, b) => a - b),
    nearTiming: nearTimingApplies(bundle, answers, now),
  };
}

/** Capability relevance comes from the areas' relevance triggers only — never from finding status. */
function rankCapabilities(bundle: RulesEngineBundle, findings: FindingResult[], boostAreaIds: ReadonlySet<number>): CapabilityResult[] {
  const order = ["client_priority", "growth_boost", ...RANKING_FACTORS.slice(1)] as const;
  const qualifying = bundle.capabilities.categories
    .map((category) => {
      const sources = findings.filter((f) => f.status !== "NOT_APPLICABLE" && bundle.areas.find((a) => a.id === f.areaId)?.capability_ids.includes(category.id));
      const factors = { growth_boost: sources.some((f) => boostAreaIds.has(f.areaId)) } as Record<RankingFactor | "growth_boost", boolean>;
      for (const factor of RANKING_FACTORS) factors[factor] = sources.some((f) => f.factors[factor]);
      return { categoryId: category.id, sources, factors };
    })
    .filter((c) => c.sources.length > 0)
    .sort((a, b) => compareFactors(order, a.factors, b.factors) || a.categoryId - b.categoryId);

  return qualifying.map((c, index) => ({
    categoryId: c.categoryId,
    rank: index + 1,
    includedInSnapshot: index < bundle.capabilities.ceiling,
    sourceAreaIds: c.sources.map((s) => s.areaId),
    factors: c.factors,
  }));
}

/** "Something to Reconcile" (Rules Matrix v1 §18): structured evidence only, at most one line. */
function detectTension(
  bundle: RulesEngineBundle,
  findings: FindingResult[],
  answers: ReadonlyMap<string, unknown>,
  priorityCategory: string | null,
  byWeighting: (a: FindingResult, b: FindingResult) => number,
): PriorityAlignmentResult {
  const aligned: PriorityAlignmentResult = {
    alignment: "ALIGNED",
    priorityCategory,
    tensionAreaId: null,
    testsMatched: [],
    ruleTriggered: null,
    reason: null,
  };
  if (!priorityCategory) return aligned;

  const config = bundle.priority_alignment;
  const priorityAreaId = bundle.areas.find((a) => a.category === priorityCategory)?.id ?? null;
  const timingDriver = answers.get(F.timingDriver);
  const driverAreas = typeof timingDriver === "string" ? config.timing_driver_area_ids[timingDriver] ?? [] : [];
  const gtmCase = priorityCategory === "go_to_market_commercial_strategy" || answers.get(F.customerContract) === "yes";

  const candidates = findings
    .filter((f) => f.status === "CRITICAL_GAP" && f.category !== priorityCategory)
    .map((finding) => {
      const tests: PriorityAlignmentResult["testsMatched"] = [];
      const sharedList = [F.commitmentAreas, F.nonNegotiableAreas].some(
        (field) => listIncludes(answers, field, finding.category) && listIncludes(answers, field, priorityCategory),
      );
      if (sharedList) tests.push("shared_commitment");
      if (priorityAreaId !== null && driverAreas.includes(finding.areaId) && driverAreas.includes(priorityAreaId)) tests.push("shared_timing_driver");
      if (gtmCase && config.go_to_market_dependency_area_ids.includes(finding.areaId)) tests.push("go_to_market_dependency");
      return { finding, tests };
    })
    .filter((c) => c.tests.length > 0)
    .sort((a, b) => byWeighting(a.finding, b.finding));

  const selected = candidates[0];
  if (!selected) return aligned;
  const area = bundle.areas.find((a) => a.id === selected.finding.areaId) as AreaDefinition;
  const reason = {} as Record<Locale, string>;
  for (const locale of bundle.locales) {
    const copy = config.copy[locale];
    reason[locale] = fill(copy.template, {
      client_priority: copy.priority_phrases[priorityCategory] ?? copy.priority_phrases.other ?? priorityCategory,
      tension_area: area.copy[locale].short_label,
    });
  }
  return {
    alignment: "TENSION_DETECTED",
    priorityCategory,
    tensionAreaId: selected.finding.areaId,
    testsMatched: selected.tests,
    ruleTriggered: `priority_alignment.${selected.tests[0]}`,
    reason,
  };
}
