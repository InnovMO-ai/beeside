import { T } from "../copy";
import { countryName } from "../values";
import { Bundle, CounterpartyEntry, Locale, NeedsMapValue, OptionDef, QuestionDef, SessionView, StepDef } from "../types";

interface ReviewRecapProps {
  bundle: Bundle;
  locale: Locale;
  t: T;
  view: SessionView;
  currentValue: (id: string) => unknown;
  onEditStep: (stepId: string) => void;
}

function labelFor(question: QuestionDef, raw: string, locale: Locale): string {
  const match = (question.options ?? []).find((o: OptionDef) => o.value === raw);
  return match ? match.copy[locale] ?? match.copy.en : raw;
}

/**
 * Best-effort, read-only summary of every prior grouped composition (Design Specification,
 * composition 7 — "review how we understood your project"). Scoped down for this pass: it echoes
 * what was answered, in plain text, with an Edit link back to the composition it came from; it does
 * NOT support inline editing on this screen itself (the respondent edits on the composition screen,
 * then re-advances through Continue as normal — there is no jump-ahead shortcut anywhere else in
 * this Journey either, so this matches existing behavior rather than introducing a new pattern).
 */
export function ReviewRecap({ bundle, locale, t, view, currentValue, onEditStep }: ReviewRecapProps) {
  const priorSteps = bundle.steps.filter((s) => s.kind !== "review" && view.steps.find((v) => v.id === s.id)?.applicable);

  return (
    <div className="review-recap">
      {priorSteps.map((step) => (
        <ReviewSection key={step.id} bundle={bundle} step={step} locale={locale} t={t} currentValue={currentValue} onEditStep={onEditStep} />
      ))}
    </div>
  );
}

function ReviewSection({
  bundle,
  step,
  locale,
  t,
  currentValue,
  onEditStep,
}: {
  bundle: Bundle;
  step: StepDef;
  locale: Locale;
  t: T;
  currentValue: (id: string) => unknown;
  onEditStep: (stepId: string) => void;
}) {
  if (step.kind === "transition" || step.question_ids.length === 0) return null;
  const stepCopy = step.copy[locale] ?? step.copy.en;
  // "Leave a note" (step.note_field_id) is shown as its own highlighted callout, not as a plain
  // dt/dd row — matching the frozen Review design's "📝 Note on file: ..." treatment — and only
  // when the client actually wrote something (an empty optional note is simply omitted).
  const noteValue = step.note_field_id ? currentValue(step.note_field_id) : undefined;
  const noteText = typeof noteValue === "string" ? noteValue.trim() : "";
  return (
    <section className="review-section">
      <div className="review-section-header">
        <h2 className="review-section-title">{stepCopy.title}</h2>
        <button type="button" className="button button-text" onClick={() => onEditStep(step.id)}>
          {t("level2", "review_edit")}
        </button>
      </div>
      <dl>
        {step.question_ids
          .filter((id) => id !== step.note_field_id)
          .map((id) => {
            const question = bundle.questions.find((q) => q.id === id);
            if (!question) return null;
            const value = currentValue(id);
            const copy = question.copy[locale] ?? question.copy.en;
            return (
              <div key={id} style={{ margin: "0.5rem 0" }}>
                <dt style={{ fontWeight: 500 }}>{copy.title}</dt>
                <dd style={{ margin: "0.1rem 0 0" }}>{renderAnswerSummary(question, value, locale, t)}</dd>
              </div>
            );
          })}
      </dl>
      {noteText && (
        <p className="review-note">
          {t("level2", "review_note_prefix")} "{noteText}"
        </p>
      )}
    </section>
  );
}

function renderAnswerSummary(question: QuestionDef, value: unknown, locale: Locale, t: T): string {
  const empty = t("level2", "review_empty");
  if (value === null || value === undefined || value === "") return empty;

  switch (question.type) {
    case "single_select":
    case "locale":
      return typeof value === "string" ? labelFor(question, value, locale) : empty;
    case "multi_select":
      return Array.isArray(value) && value.length > 0 ? value.map((v) => labelFor(question, String(v), locale)).join(", ") : empty;
    case "country_list":
      return Array.isArray(value) && value.length > 0 ? value.map((c) => countryName(String(c), locale)).join(", ") : empty;
    case "tag_list":
      return Array.isArray(value) && value.length > 0 ? value.join(", ") : empty;
    case "counterparty_list": {
      const entries = value as CounterpartyEntry[] | null;
      // Shown plainly here because Review is the client's own session — the client is always an
      // authorized viewer of their own restricted-counterparty list (see counterparty-types.ts).
      return Array.isArray(entries) && entries.length > 0 ? entries.map((e) => e.name).join(", ") : empty;
    }
    case "timing": {
      const v = value as { precision?: string; value?: string | null } | null;
      if (!v || v.precision === "not_sure") return t("common", "timing_not_sure");
      return v.value ?? empty;
    }
    case "quantity": {
      const v = value as { amount?: number; unit?: string; not_sure?: boolean } | null;
      if (!v || v.not_sure) return t("common", "quantity_not_sure");
      return v.amount !== undefined && v.unit ? `${v.amount} ${v.unit}` : empty;
    }
    case "needs_map": {
      const v = value as NeedsMapValue | null;
      if (!v || !Array.isArray(v.selections) || v.selections.length === 0) return empty;
      return t("level2", "needs_selected_count").replace("{{count}}", String(v.selections.length));
    }
    default:
      return typeof value === "string" ? value : empty;
  }
}
