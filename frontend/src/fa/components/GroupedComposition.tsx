import { ChangeMode, QuestionField } from "./QuestionField";
import { T } from "../copy";
import { Bundle, Locale, SessionView } from "../types";

interface GroupedCompositionProps {
  bundle: Bundle;
  questionIds: string[];
  locale: Locale;
  t: T;
  countries: string[];
  view: SessionView;
  currentValue: (id: string) => unknown;
  resolveFieldValue: (field_key: string) => unknown;
  missingIds: Set<string>;
  onChange: (id: string, required: boolean, value: unknown, mode: ChangeMode) => void;
  /** The step's own title/intro (StepDef.copy) — rendered here as the screen's one <h1>, so every
   *  individual QuestionField below renders at <h2> instead (accessible heading hierarchy). */
  stepTitle: string;
  stepIntro?: string;
}

/**
 * Level 2 MVP — renders every applicable question of a `layout: "grouped"` step on one screen
 * (Design Specification: grouped compositions replace one-question-per-screen). Each question still
 * goes through the exact same QuestionField + autosave path as the original per-screen Journey; only
 * the layout changes. `questionIds` is expected to already be the server's applicable-filtered list
 * for this step (SessionView.steps[].questionIds), so a question that becomes applicable mid-flow
 * (e.g. a StructuredEcho *_structured field, or a needs_map-gated follow-up) simply appears once its
 * save round-trip returns the updated SessionView — no client-side re-derivation of applicability.
 */
export function GroupedComposition({
  bundle,
  questionIds,
  locale,
  t,
  countries,
  view,
  currentValue,
  resolveFieldValue,
  missingIds,
  onChange,
  stepTitle,
  stepIntro,
}: GroupedCompositionProps) {
  return (
    <div className="grouped-composition">
      <h1 className="step-title" tabIndex={-1} style={{ outline: "none" }}>
        {stepTitle}
      </h1>
      {stepIntro && <p className="lead">{stepIntro}</p>}
      {questionIds.map((id) => {
        const question = bundle.questions.find((q) => q.id === id);
        if (!question) return null;
        return (
          <div key={id} className="grouped-question" style={{ marginBottom: "2.25rem" }} data-question-id={id}>
            <QuestionField
              bundle={bundle}
              question={question}
              locale={locale}
              t={t}
              value={currentValue(id)}
              dynamicOptions={view.dynamicOptions[id]}
              countries={countries}
              showRequiredError={missingIds.has(id)}
              onChange={(value, mode) => onChange(id, question.required, value, mode)}
              resolveFieldValue={resolveFieldValue}
              headingLevel="h2"
            />
          </div>
        );
      })}
    </div>
  );
}
