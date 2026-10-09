/**
 * Category readiness engine — `evaluateCategory` (frozen rules: docs/f5/precision-track-a-contract.md §3).
 *
 *  - Required  := requirement_level ∈ {blocking, required, conditional} AND applicable (applicability_rule null/true;
 *    country overlays add/modify/deactivate through `effectiveFieldsMulti`). supporting/informational never count.
 *  - Confirmed := ANSWERED | EXPLICIT_NO | ZERO. UNKNOWN / WITHHELD / ASSUMED / NOT_ASKED are not confirmed.
 *    A repeatable_group is ONE requirement, confirmed when min_items is met and every entered item has its required
 *    applicable sub-fields confirmed.
 *  - progressPct = floor(100 · confirmed / total); total = 0 -> null and ready = false.
 *  - ready := blocking_gaps == []. A blocking field is resolved when confirmed or ASSUMED; blocking critical decisions
 *    (AST) must resolve; there is no unacknowledged blocking contradiction (consistency decisions). `ready` is
 *    independent of `progressPct` (100 % with an open decision is not ready; 60 % can be ready) and pending
 *    (non-blocking) information never blocks and is always listed.
 *  - field_asked(x) on a NOT_APPLICABLE field is vacuously true (G-C3): inapplicable fields are masked as
 *    NOT_APPLICABLE before decisions are evaluated.
 *  - Critical items = blocking field gaps ∪ unresolved blocking decisions (a blocking field that a decision depends on is
 *    reported under the decision: identity = decision_key, else field_key). Criticality never weights progress.
 *  - nextFieldKey is chosen by the server: unresolved blocking first, then the fields an open contradiction/confirmation
 *    decision waits on (its acknowledgement), then manifest order of required/conditional fields with answerState NOT_ASKED;
 *    UNKNOWN/WITHHELD fields are not re-asked; nothing left -> null.
 *
 * Group blocking rule (interpretation, documented in the final report): a blocking repeatable_group is a gap when
 * min_items is not met or an entered item still has a required sub-field NOT ASKED. A sub-field the client answered
 * UNKNOWN/WITHHELD is Pending (listed, with its Execution Dependency mark) and does not block (completion-gate D12).
 *
 * Pure and deterministic: no clock, no database, no model.
 */
import { evaluateRule, itemFact, itemFacts, type Rule, type RuleFacts } from "./ast";
import { effectiveFieldsMulti, normalizeCountries, type FieldDefinition } from "./effective-fields";
import type { AnswerState, CategoryEvaluation, CriticalItem, EvaluationInput, FactMap, FactView, RequirementState, RequirementStatus } from "./types";

export const REQUIRED_LEVELS: ReadonlySet<FieldDefinition["requirement_level"]> = new Set(["blocking", "required", "conditional"]);
const CONFIRMED_STATES: ReadonlySet<AnswerState> = new Set<AnswerState>(["ANSWERED", "EXPLICIT_NO", "ZERO"]);

export interface CriticalDecision {
  decision_key: string;
  label: Record<string, string>;
  gates?: string;
  kind: "path" | "consistency" | "confirmation";
  depends_on_fields?: string[];
  resolution_rule: Rule;
}
export interface OperationalPendingItem {
  pending_item_key: string;
  label: Record<string, string>;
  applicability_rule?: Rule | null;
}

export interface SubFieldStatus {
  fieldKey: string;
  item: number;
  sub: string;
  level: FieldDefinition["requirement_level"];
  /** confirmed | assumed | pending (UNKNOWN/WITHHELD) | missing (NOT_ASKED) */
  state: "confirmed" | "assumed" | "pending" | "missing";
  answerState: AnswerState;
  executionDependency: boolean;
}

export interface GroupDetail {
  minItems: number;
  itemCount: number;
  completeItems: number;
  /** Required applicable sub-fields of every entered item (not the supporting ones). */
  subs: SubFieldStatus[];
}

export interface RequirementDetail extends RequirementStatus {
  field: FieldDefinition;
  group?: GroupDetail;
  /** Resolved for readiness purposes: confirmed or ASSUMED (groups: min_items met and nothing NOT_ASKED inside). */
  resolved: boolean;
  /** True when the field/group has never been asked (the server may still ask it). */
  needsAsk: boolean;
}

export interface NextTarget { fieldKey: string; itemIndex?: number; subFieldKey?: string }

export interface DetailedEvaluation {
  evaluation: CategoryEvaluation;
  /** Effective (country-resolved) manifest fields in order, derived fields excluded. */
  fields: FieldDefinition[];
  /** Every effective field (all levels) keyed by field_key. */
  details: Record<string, RequirementDetail>;
  /** Facts as rules saw them: inapplicable fields masked as NOT_APPLICABLE. */
  masked: FactMap;
  unresolvedDecisions: CriticalDecision[];
  /** operational_pending_items whose applicability rule is true (labels become "Information required later"). */
  operationalPending: OperationalPendingItem[];
  nextTarget: { fieldKey: string; itemIndex?: number; subFieldKey?: string } | null;
  countries: string[];
}

const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** The stored state with defensive normalisation: an ANSWERED fact without a value is a corrupt row -> NOT_ASKED. */
function stateOf(fact: FactView | undefined): AnswerState {
  if (!fact) return "NOT_ASKED";
  if (fact.answerState === "NOT_APPLICABLE") return "NOT_ASKED"; // derived by the engine only
  if (fact.answerState === "ANSWERED" && isEmpty(fact.value)) return "NOT_ASKED";
  return fact.answerState;
}

function requirementState(st: AnswerState): RequirementState {
  if (CONFIRMED_STATES.has(st)) return "confirmed";
  if (st === "ASSUMED") return "assumed";
  return "pending";
}

function subState(st: AnswerState): SubFieldStatus["state"] {
  if (CONFIRMED_STATES.has(st)) return "confirmed";
  if (st === "ASSUMED") return "assumed";
  if (st === "UNKNOWN" || st === "WITHHELD") return "pending";
  return "missing";
}

function groupItems(fact: FactView | undefined): Array<Record<string, unknown> | null> {
  return fact && Array.isArray(fact.value) ? (fact.value as Array<Record<string, unknown> | null>) : [];
}

/** Does a rule-less/absent applicability mean applicable? Yes (null/undefined = always). */
function isApplicable(field: FieldDefinition, facts: RuleFacts): boolean {
  if (field.derived === true) return false;
  const rule = field.applicability_rule as Rule | null | undefined;
  return !rule ? true : evaluateRule(rule, facts);
}

function analyzeGroup(field: FieldDefinition, fact: FactView | undefined): GroupDetail {
  const items = groupItems(fact);
  const minItems = typeof field.min_items === "number" && field.min_items >= 1 ? field.min_items : 1;
  const subs: SubFieldStatus[] = [];
  let complete = 0;
  items.forEach((item, idx) => {
    const local = itemFacts(item);
    let itemComplete = true;
    for (const sub of field.group_item_schema ?? []) {
      if (!REQUIRED_LEVELS.has(sub.requirement_level)) continue;
      const rule = sub.applicability_rule as Rule | null | undefined;
      if (rule && !evaluateRule(rule, local)) continue; // item-scoped applicability
      const st = itemFact(item ? item[sub.field_key] : undefined).answerState;
      const state = subState(st);
      subs.push({ fieldKey: field.field_key, item: idx, sub: sub.field_key, level: sub.requirement_level, state, answerState: st, executionDependency: sub.execution_dependency === true });
      if (state !== "confirmed") itemComplete = false;
    }
    if (itemComplete) complete += 1;
  });
  return { minItems, itemCount: items.length, completeItems: complete, subs };
}

const copyLabel = (label: Record<string, string>): Record<string, string> => ({ ...label });

export function evaluateCategoryDetailed(input: EvaluationInput): DetailedEvaluation {
  const manifest = input.manifest;
  const countries = normalizeCountries(input.countries);
  const content = { ...manifest, country_overlays: manifest.country_overlays ?? {} };
  const allFields = effectiveFieldsMulti(content, countries);
  const fields = allFields.filter((f) => f.derived !== true);

  // 1. applicability, in manifest order; inapplicable fields are masked for every later rule (G-C3).
  const masked: Record<string, FactView | undefined> = { ...input.facts };
  const applicable = new Map<string, boolean>();
  for (const f of allFields) {
    if (f.derived === true) continue;
    const ok = isApplicable(f, masked);
    applicable.set(f.field_key, ok);
    if (!ok) masked[f.field_key] = { value: undefined, answerState: "NOT_APPLICABLE" };
  }

  // 2. per-field status
  const details: Record<string, RequirementDetail> = {};
  const requirements: RequirementStatus[] = [];
  const notApplicable: string[] = [];
  for (const f of fields) {
    const app = applicable.get(f.field_key) === true;
    const executionDependency = f.execution_dependency === true;
    if (!app) {
      notApplicable.push(f.field_key);
      const d: RequirementDetail = { fieldKey: f.field_key, level: f.requirement_level, applicable: false, state: "not_applicable", executionDependency, answerState: "NOT_APPLICABLE", field: f, resolved: true, needsAsk: false };
      details[f.field_key] = d;
      requirements.push(d);
      continue;
    }
    const fact = input.facts[f.field_key];
    const st = stateOf(fact);
    let d: RequirementDetail;
    if (f.type === "repeatable_group") {
      const g = analyzeGroup(f, fact);
      const hasPending = g.subs.some((s) => s.state === "pending" || s.state === "missing");
      const hasAssumed = g.subs.some((s) => s.state === "assumed") || st === "ASSUMED";
      const enough = g.itemCount >= g.minItems;
      const confirmed = enough && g.completeItems === g.itemCount && !hasAssumed;
      const state: RequirementState = !enough || hasPending ? "pending" : confirmed ? "confirmed" : "assumed";
      const missing = g.subs.some((s) => s.state === "missing");
      // Asked again only when never asked (or an empty ANSWERED array), when entries are still short of min_items, or when
      // an entered item has a required sub-field that was never asked. A group the client answered UNKNOWN/WITHHELD/NO
      // with no entries is not re-asked.
      const asked = fact !== undefined && st !== "NOT_ASKED";
      const needsAsk = (!enough && (!asked || g.itemCount > 0)) || missing;
      d = {
        fieldKey: f.field_key, level: f.requirement_level, applicable: true, state, executionDependency,
        answerState: st, field: f, group: g, resolved: enough && !missing, needsAsk,
      };
    } else {
      d = {
        fieldKey: f.field_key, level: f.requirement_level, applicable: true, state: requirementState(st), executionDependency,
        answerState: st, field: f, resolved: CONFIRMED_STATES.has(st) || st === "ASSUMED", needsAsk: st === "NOT_ASKED",
      };
    }
    details[f.field_key] = d;
    requirements.push(d);
  }

  // 3. progress over applicable required requirements
  const required = requirements.filter((r) => r.applicable && REQUIRED_LEVELS.has(r.level));
  const totalRequired = required.length;
  const confirmedRequired = required.filter((r) => r.state === "confirmed").length;
  const progressPct = totalRequired === 0 ? null : Math.floor((100 * confirmedRequired) / totalRequired);

  // 4. critical decisions (AST over the masked facts)
  const decisions = (Array.isArray(manifest.critical_decisions) ? manifest.critical_decisions : []) as CriticalDecision[];
  const unresolvedDecisions = decisions.filter((d) => (d.gates ?? "blocking") === "blocking" && !evaluateRule(d.resolution_rule, masked));

  // 5. critical items: blocking field gaps (folded under the decision that waits on them) ∪ unresolved decisions
  const critical: CriticalItem[] = [];
  const seen = new Set<string>();
  const pushCritical = (item: CriticalItem): void => {
    if (seen.has(item.itemKey)) return;
    seen.add(item.itemKey);
    critical.push(item);
  };
  const blockingFieldGaps = required.filter((r) => r.level === "blocking" && !((details[r.fieldKey] as RequirementDetail).resolved));
  for (const gap of blockingFieldGaps) {
    const owner = unresolvedDecisions.find((d) => (d.depends_on_fields ?? []).includes(gap.fieldKey));
    if (owner) pushCritical({ itemKey: owner.decision_key, kind: owner.kind, label: copyLabel(owner.label) });
    else pushCritical({ itemKey: gap.fieldKey, kind: "field", label: copyLabel((details[gap.fieldKey] as RequirementDetail).field.label) });
  }
  for (const d of unresolvedDecisions) pushCritical({ itemKey: d.decision_key, kind: d.kind, label: copyLabel(d.label) });

  const ready = totalRequired > 0 && critical.length === 0;

  // 6. pending = applicable required requirements that are not confirmed (Pending / Assumed / not yet asked)
  const pending = required.filter((r) => r.state !== "confirmed");

  // 7. server-chosen next field
  // An open blocking contradiction/confirmation is a critical item: the fields it waits on (its acknowledgement) come
  // right after the blocking fields. Open `path` decisions add nothing here: their fields are asked in manifest order.
  const waitedOn = new Set(unresolvedDecisions.filter((d) => d.kind !== "path").flatMap((d) => d.depends_on_fields ?? []));
  const candidates = required.filter((r) => (details[r.fieldKey] as RequirementDetail).needsAsk);
  const firstBlocking = candidates.find((r) => r.level === "blocking");
  const firstWaited = candidates.find((r) => waitedOn.has(r.fieldKey));
  const nextReq = firstBlocking ?? firstWaited ?? candidates[0];
  let nextTarget: NextTarget | null = null;
  if (nextReq) {
    const det = details[nextReq.fieldKey] as RequirementDetail;
    const target: NextTarget = { fieldKey: nextReq.fieldKey };
    if (det.group && det.group.itemCount >= det.group.minItems) {
      const miss = det.group.subs.find((s) => s.state === "missing");
      if (miss) {
        target.itemIndex = miss.item;
        target.subFieldKey = miss.sub;
      }
    }
    nextTarget = target;
  }

  // 8. operational pending ("Information required later") — never documents sections, only context lines
  const opItems = (Array.isArray(manifest.operational_pending_items) ? manifest.operational_pending_items : []) as OperationalPendingItem[];
  const operationalPending = opItems.filter((p) => !p.applicability_rule || evaluateRule(p.applicability_rule, masked));

  const evaluation: CategoryEvaluation = {
    progressPct, totalRequired, confirmedRequired, ready, critical, pending, requirements, notApplicable,
    nextFieldKey: nextTarget ? nextTarget.fieldKey : null,
  };
  return { evaluation, fields, details, masked, unresolvedDecisions, operationalPending, nextTarget, countries };
}

/** The frozen contract entry point. */
export function evaluateCategory(input: EvaluationInput): CategoryEvaluation {
  return evaluateCategoryDetailed(input).evaluation;
}
