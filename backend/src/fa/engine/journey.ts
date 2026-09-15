import { QuestionBankBundle, QuestionDef, StepDef } from "./bundle-types";
import { AnswerMap, evaluateCondition, isAnswered } from "./conditions";

export interface QuestionState {
  question: QuestionDef;
  applicable: boolean;
  /** Applicable and holding a valid current value. */
  answered: boolean;
}

export interface StepState {
  step: StepDef;
  index: number;
  applicable: boolean;
  questions: QuestionState[];
  missingRequired: string[];
}

export interface JourneyState {
  steps: StepState[];
  /** Answers of applicable questions only — the input for rules, Snapshot and Precision. */
  effectiveAnswers: Map<string, unknown>;
  applicableQuestionIds: Set<string>;
  /** First applicable step the respondent still has to go through; null when nothing remains. */
  currentStepId: string | null;
  complete: boolean;
}

/** Allowed values of an options_from question, given the effective answers so far. */
export function dynamicOptionValues(question: QuestionDef, effective: AnswerMap): string[] {
  if (!question.options_from) return (question.options ?? []).map((o) => o.value);
  const source = effective.get(question.options_from.field);
  const exclude = question.options_from.exclude ?? [];
  return Array.isArray(source) ? source.map(String).filter((v) => !exclude.includes(v)) : [];
}

/**
 * Deterministic journey state from the pinned bundle and the stored answers (by field_key).
 *
 * Steps and questions are evaluated in bundle order; a condition only sees answers of questions
 * that are themselves applicable, so changing a foundational answer silently makes dependent
 * answers inapplicable (they stay in the append-only history and re-appear only if the condition
 * is re-triggered). `lastCompletedStepId` is the furthest step the respondent confirmed.
 */
export function computeJourney(
  bundle: QuestionBankBundle,
  storedAnswers: AnswerMap,
  lastCompletedStepId: string | null,
): JourneyState {
  const questionsById = new Map(bundle.questions.map((q) => [q.id, q]));
  const effective = new Map<string, unknown>();
  const applicableQuestionIds = new Set<string>();
  const lastIndex = lastCompletedStepId ? bundle.steps.findIndex((s) => s.id === lastCompletedStepId) : -1;

  const steps: StepState[] = bundle.steps.map((step, index) => {
    const stepApplies = !step.applies_when || evaluateCondition(step.applies_when, effective);
    const questions: QuestionState[] = step.question_ids.map((id) => {
      const question = questionsById.get(id);
      if (!question) throw new Error(`bundle step ${step.id} references unknown question ${id}`);
      const applicable = stepApplies && (!question.applies_when || evaluateCondition(question.applies_when, effective));
      let answered = false;
      if (applicable) {
        applicableQuestionIds.add(question.id);
        const value = storedAnswers.get(question.field_key);
        answered = isAnswered(value) && stillValid(question, value, effective);
        if (answered) effective.set(question.field_key, value);
      }
      return { question, applicable, answered };
    });
    const applicable = stepApplies && (step.kind === "transition" || questions.some((q) => q.applicable));
    const missingRequired = questions
      .filter((q) => q.applicable && q.question.required && !q.answered)
      .map((q) => q.question.id);
    return { step, index, applicable, questions, missingRequired };
  });

  const current = steps.find((s) => s.applicable && (s.index > lastIndex || s.missingRequired.length > 0));
  const lastApplicable = [...steps].reverse().find((s) => s.applicable);
  const complete =
    !current &&
    steps.every((s) => !s.applicable || s.missingRequired.length === 0) &&
    lastApplicable !== undefined &&
    lastApplicable.index <= lastIndex;

  return { steps, effectiveAnswers: effective, applicableQuestionIds, currentStepId: current?.step.id ?? null, complete };
}

/** A stored select answer stays valid only while its value is still an allowed option. */
function stillValid(question: QuestionDef, value: unknown, effective: AnswerMap): boolean {
  if (question.options_from) {
    const allowed = dynamicOptionValues(question, effective);
    return typeof value === "string" && allowed.includes(value);
  }
  return true;
}
