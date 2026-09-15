import type { Condition } from "../fa/engine/bundle-types";
import { AnswerMap, evaluateCondition, isAnswered } from "../fa/engine/conditions";
import { isNotSureValue } from "../fa/engine/values";
import type { FindingStatus, RuleCondition } from "./types";

export interface RuleContext {
  answers: AnswerMap;
  /** Only available when evaluating a finding's own signals. */
  status?: FindingStatus;
}

/** A leaf that reads one declared answer (used by the bundle validator and the open-text audit). */
export interface ConditionLeaf {
  field: string;
  op: string;
  values: string[];
}

export function evaluateRuleCondition(condition: RuleCondition, ctx: RuleContext): boolean {
  if ("always" in condition) return true;
  if ("status_in" in condition) return ctx.status !== undefined && condition.status_in.includes(ctx.status);
  if ("all" in condition) return (condition.all as RuleCondition[]).every((c) => evaluateRuleCondition(c, ctx));
  if ("any" in condition) return (condition.any as RuleCondition[]).some((c) => evaluateRuleCondition(c, ctx));
  if ("not" in condition) return !evaluateRuleCondition(condition.not as RuleCondition, ctx);
  if (condition.op === "declared") {
    const value = ctx.answers.get(condition.field);
    return isAnswered(value) && !isNotSureValue(value);
  }
  return evaluateCondition(condition as Condition, ctx.answers);
}

export function conditionLeaves(condition: RuleCondition): ConditionLeaf[] {
  if ("always" in condition || "status_in" in condition) return [];
  if ("all" in condition) return (condition.all as RuleCondition[]).flatMap(conditionLeaves);
  if ("any" in condition) return (condition.any as RuleCondition[]).flatMap(conditionLeaves);
  if ("not" in condition) return conditionLeaves(condition.not as RuleCondition);
  const leaf = condition as { field: string; op: string; value?: unknown; values?: unknown[] };
  const values = leaf.values ? leaf.values.map(String) : leaf.value !== undefined && typeof leaf.value === "string" ? [leaf.value] : [];
  return [{ field: leaf.field, op: leaf.op, values }];
}

export function readsStatus(condition: RuleCondition): boolean {
  if ("status_in" in condition) return true;
  if ("all" in condition) return (condition.all as RuleCondition[]).some(readsStatus);
  if ("any" in condition) return (condition.any as RuleCondition[]).some(readsStatus);
  if ("not" in condition) return readsStatus(condition.not as RuleCondition);
  return false;
}
