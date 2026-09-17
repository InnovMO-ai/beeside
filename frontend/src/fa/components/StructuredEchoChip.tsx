import { useMemo, useState } from "react";
import { T } from "../copy";
import { STRUCTURED_ECHO_PARSERS, STRUCTURED_ECHO_SOURCE_FIELD } from "../structured-echo";
import { Locale, OptionDef, QuestionDef } from "../types";

interface StructuredEchoChipProps {
  /** The *_structured QuestionDef (e.g. fa.project.entry_approach_structured) — its own options are
   *  reused verbatim so the chip's confirmed value always matches a real, canonical option. */
  question: QuestionDef;
  sourceValue: unknown;
  locale: Locale;
  t: T;
  structuredValue: unknown;
  onConfirm: (value: string) => void;
}

/**
 * Progressive Disclosure Rule (Design Specification): open text earns a StructuredEcho, never a
 * verdict — "Does this match what you meant?", never "we detected...". Shown only once the source
 * open-text field has content and the deterministic parser (structured-echo.ts) finds a match; it
 * never appears before the respondent has written anything, and it never blocks Continue — this is
 * a suggestion the respondent can also dismiss by simply picking a different option below.
 */
export function StructuredEchoChip({ question, sourceValue, locale, t, structuredValue, onConfirm }: StructuredEchoChipProps) {
  // `dismissed` only tracks an explicit "let me choose" click in *this* render session — it must not
  // persist as the reason the manual list stays open, because the fallback below already covers every
  // case where the chip shouldn't show (confirmed, no match, or dismissed). Keeping it separate from
  // `alreadyConfirmed`/`suggestion` avoids the earlier bug where a confirmed or match-less question
  // rendered nothing at all and the respondent had no control to answer it with.
  const [dismissed, setDismissed] = useState(false);

  const parser = STRUCTURED_ECHO_PARSERS[question.field_key];
  const suggestion = useMemo(() => {
    if (!parser || typeof sourceValue !== "string" || sourceValue.trim() === "") return null;
    return parser(sourceValue);
  }, [parser, sourceValue]);

  const option: OptionDef | undefined = suggestion ? question.options?.find((o) => o.value === suggestion.value) : undefined;
  const alreadyConfirmed = typeof structuredValue === "string" && structuredValue.trim() !== "";
  const confirmedOption: OptionDef | undefined = alreadyConfirmed ? question.options?.find((o) => o.value === structuredValue) : undefined;

  if (!STRUCTURED_ECHO_SOURCE_FIELD[question.field_key]) return null;

  const showChip = !alreadyConfirmed && !dismissed && !!suggestion && !!option;
  if (showChip) {
    return (
      <div className="field structured-echo-chip" style={{ marginTop: "1rem" }} role="group" aria-label={t("level2", "structured_echo_question")}>
        <p style={{ margin: "0 0 0.5rem", fontWeight: 500 }}>{option!.copy[locale] ?? option!.copy.en}</p>
        <p className="helper" style={{ margin: "0 0 0.75rem" }}>{t("level2", "structured_echo_question")}</p>
        <div className="actions" style={{ marginTop: 0 }}>
          <button type="button" className="button button-primary" onClick={() => onConfirm(option!.value)}>
            {t("level2", "structured_echo_yes")}
          </button>
          <button type="button" className="button button-text" onClick={() => setDismissed(true)}>
            {t("level2", "structured_echo_edit")}
          </button>
        </div>
      </div>
    );
  }

  // Fallback covers three cases: already confirmed (respondent may still change it), the parser found
  // no match for what was written, or the respondent explicitly asked to pick manually. All three need
  // a real, always-available control — never a blank question a required field can't be satisfied by.
  return (
    <div style={{ marginTop: "0.75rem" }}>
      {confirmedOption && (
        <p className="helper" style={{ margin: "0 0 0.5rem" }}>
          {confirmedOption.copy[locale] ?? confirmedOption.copy.en}
        </p>
      )}
      <ManualPicker question={question} locale={locale} selectedValue={typeof structuredValue === "string" ? structuredValue : undefined} onConfirm={onConfirm} />
    </div>
  );
}

function ManualPicker({
  question,
  locale,
  selectedValue,
  onConfirm,
}: {
  question: QuestionDef;
  locale: Locale;
  selectedValue?: string;
  onConfirm: (value: string) => void;
}) {
  return (
    <div className="options">
      {(question.options ?? []).map((option) => (
        <label key={option.value} className="option" data-selected={selectedValue === option.value}>
          <input type="radio" name={`${question.id}-manual`} value={option.value} checked={selectedValue === option.value} onChange={() => onConfirm(option.value)} />
          <span>{option.copy[locale] ?? option.copy.en}</span>
        </label>
      ))}
    </div>
  );
}
