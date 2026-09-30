import { ReactNode, useState } from "react";
import { T } from "../copy";
import { NeedsExplorer } from "./NeedsExplorer";
import { StructuredEchoChip } from "./StructuredEchoChip";
import { STRUCTURED_ECHO_SOURCE_FIELD } from "../structured-echo";
import { Bundle, CounterpartyEntry, Locale, NeedsMapValue, QuestionDef, RESTRICTION_TYPES, RestrictionType } from "../types";
import { countryName, resolveOptions, searchCountries, TimingPrecision, timingParts, timingValue, toggleMulti } from "../values";

export type ChangeMode = "now" | "debounced";

interface QuestionFieldProps {
  bundle: Bundle;
  question: QuestionDef;
  locale: Locale;
  t: T;
  value: unknown;
  dynamicOptions?: string[];
  countries: string[];
  showRequiredError: boolean;
  onChange: (value: unknown, mode: ChangeMode) => void;
  /** Level 2 MVP: looks up another question's current value by field_key (draft-aware, same source
   *  Journey.tsx uses for `value` above) — needed by StructuredEchoChip to read its source open-text
   *  answer, since a QuestionField only otherwise knows its own question's value. Optional so any
   *  other caller of QuestionField (there is none today) keeps compiling without it. */
  resolveFieldValue?: (field_key: string) => unknown;
  /** Level 2 MVP: "h2" when GroupedComposition renders several questions under its own step-level
   *  <h1> (accessible heading hierarchy — one h1 per screen); defaults to "h1" for the original
   *  one-question-per-screen layout, where the question IS the screen's heading. */
  headingLevel?: "h1" | "h2";
}

const TEXT_MAX = 4000;
const SHORT_TEXT_MAX = 200;

/**
 * One question per screen by default (Handoff v1 §26), or one of several questions rendered
 * together by GroupedComposition.tsx (Level 2 MVP, `StepDef.layout === "grouped"`) — this component
 * itself doesn't know or care which; it just renders one question's input.
 */
export function QuestionField(props: QuestionFieldProps) {
  const { question, locale, t, showRequiredError, headingLevel = "h1" } = props;
  const copy = question.copy[locale] ?? question.copy.en;
  const ids = {
    title: `q-${question.id}-title`,
    helper: `q-${question.id}-helper`,
    error: `q-${question.id}-error`,
  };
  const describedBy = [copy.helper ? ids.helper : "", showRequiredError ? ids.error : ""].filter(Boolean).join(" ") || undefined;

  const HeadingTag = headingLevel;
  const heading = (
    <HeadingTag className="question-title" id={ids.title} tabIndex={-1} style={{ outline: "none" }}>
      {copy.title}
      {!question.required && <span className="optional-tag"> · {t("common", "optional")}</span>}
    </HeadingTag>
  );
  const helper = copy.helper ? (
    <p className="helper" id={ids.helper}>
      {copy.helper}
    </p>
  ) : null;
  const error = showRequiredError ? (
    <p className="field-error" id={ids.error} role="alert">
      {t("common", "required_error")}
    </p>
  ) : null;

  const shared = { ...props, describedBy, ids };

  // Level 2 MVP: a *_structured single_select whose source open-text field is registered in
  // structured-echo.ts renders as a confirm/edit chip instead of a plain radio list — see
  // StructuredEchoChip.tsx and the Progressive Disclosure Rules this implements.
  const structuredEchoSource = STRUCTURED_ECHO_SOURCE_FIELD[question.field_key];
  if (question.type === "single_select" && structuredEchoSource) {
    const sourceValue = props.resolveFieldValue?.(structuredEchoSource);
    return (
      <Block heading={heading} helper={helper} error={error}>
        <StructuredEchoChip
          question={question}
          sourceValue={sourceValue}
          locale={locale}
          t={t}
          structuredValue={props.value}
          onConfirm={(value) => props.onChange(value, "now")}
        />
      </Block>
    );
  }

  switch (question.type) {
    case "single_select":
    case "locale":
    case "multi_select":
      return (
        <fieldset className="question" aria-describedby={describedBy}>
          <legend style={{ padding: 0 }}>{heading}</legend>
          {helper}
          <ChoiceOptions {...shared} />
          {error}
        </fieldset>
      );
    case "timing":
      return (
        <fieldset className="question" aria-describedby={describedBy}>
          <legend style={{ padding: 0 }}>{heading}</legend>
          {helper}
          <TimingInput {...shared} />
          {error}
        </fieldset>
      );
    case "quantity":
      return (
        <fieldset className="question" aria-describedby={describedBy}>
          <legend style={{ padding: 0 }}>{heading}</legend>
          {helper}
          <QuantityInput {...shared} />
          {error}
        </fieldset>
      );
    case "country_list":
      return (
        <Block heading={heading} helper={helper} error={error}>
          <CountryInput {...shared} />
        </Block>
      );
    case "tag_list":
      return (
        <Block heading={heading} helper={helper} error={error}>
          <TagListInput {...shared} />
        </Block>
      );
    case "counterparty_list":
      return (
        <Block heading={heading} helper={helper} error={error}>
          <CounterpartyListInput {...shared} />
        </Block>
      );
    case "needs_map":
      // The Needs Explorer renders its own section headings and helper text throughout — the
      // question's own title/helper still frame it, but no extra fieldset wrapper is needed.
      return (
        <div className="question">
          {heading}
          {helper}
          <NeedsExplorer locale={locale} t={t} value={props.value} onChange={(next: NeedsMapValue) => props.onChange(next, "now")} />
          {error}
        </div>
      );
    default:
      return (
        <Block heading={heading} helper={helper} error={error}>
          <TextInput {...shared} />
        </Block>
      );
  }
}

function Block({ heading, helper, error, children }: { heading: ReactNode; helper: ReactNode; error: ReactNode; children: ReactNode }) {
  return (
    <div className="question">
      {heading}
      {helper}
      {children}
      {error}
    </div>
  );
}

type Shared = QuestionFieldProps & { describedBy?: string; ids: { title: string; helper: string; error: string } };

function ChoiceOptions({ bundle, question, locale, value, dynamicOptions, onChange }: Shared) {
  const options = resolveOptions(bundle, question, dynamicOptions);
  const multi = question.type === "multi_select";
  const selected = multi ? (Array.isArray(value) ? (value as string[]) : []) : typeof value === "string" ? [value] : [];
  const order = options.map((o) => o.value);
  const atMaxSelect = multi && typeof question.max_select === "number" && selected.length >= question.max_select;
  return (
    <div className="options">
      {options.map((option) => {
        const isSelected = selected.includes(option.value);
        return (
          <label key={option.value} className="option" data-selected={isSelected}>
            <input
              type={multi ? "checkbox" : "radio"}
              name={question.id}
              value={option.value}
              checked={isSelected}
              disabled={multi && !isSelected && atMaxSelect}
              onChange={(e) => {
                if (!multi) return onChange(option.value, "now");
                const next = toggleMulti(selected, option.value, e.target.checked, question.exclusive_values ?? [], order);
                onChange(next.length > 0 ? next : null, "now");
              }}
            />
            <span>{option.copy[locale] ?? option.copy.en}</span>
          </label>
        );
      })}
    </div>
  );
}

function TextInput({ question, locale, value, onChange, describedBy, ids, showRequiredError }: Shared) {
  const copy = question.copy[locale] ?? question.copy.en;
  const text = typeof value === "string" ? value : "";
  const common = {
    id: `q-${question.id}-input`,
    value: text,
    placeholder: copy.placeholder,
    "aria-labelledby": ids.title,
    "aria-describedby": describedBy,
    "aria-required": question.required || undefined,
    "aria-invalid": showRequiredError || undefined,
  };
  if (question.type === "short_text") {
    return (
      <div className="field" style={{ marginTop: "1.5rem" }}>
        <input {...common} className="input" type="text" maxLength={question.max_length ?? SHORT_TEXT_MAX} onChange={(e) => onChange(e.target.value, "debounced")} />
      </div>
    );
  }
  return (
    <div className="field" style={{ marginTop: "1.5rem" }}>
      <textarea {...common} className="textarea" maxLength={question.max_length ?? TEXT_MAX} onChange={(e) => onChange(e.target.value, "debounced")} />
    </div>
  );
}

function TagListInput({ question, t, value, onChange, ids }: Shared) {
  const tags = Array.isArray(value) ? (value as string[]) : [];
  const [draft, setDraft] = useState("");
  const maxTags = question.max_tags ?? 20;
  const maxTagLength = question.max_tag_length ?? 80;
  const atLimit = tags.length >= maxTags;

  const add = () => {
    const trimmed = draft.trim().slice(0, maxTagLength);
    if (!trimmed || atLimit || tags.includes(trimmed)) return;
    onChange([...tags, trimmed], "now");
    setDraft("");
  };

  return (
    <div className="field" style={{ marginTop: "1.5rem" }}>
      {tags.length > 0 && (
        <ul className="chips" style={{ margin: "0 0 1rem" }}>
          {tags.map((tag) => (
            <li key={tag} className="chip">
              <span>{tag}</span>
              <button
                type="button"
                aria-label={t("level2", "tag_remove").replace("{{tag}}", tag)}
                onClick={() => onChange(tags.filter((x) => x !== tag).length > 0 ? tags.filter((x) => x !== tag) : null, "now")}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {!atLimit ? (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            id={`q-${question.id}-input`}
            className="input"
            type="text"
            aria-labelledby={ids.title}
            maxLength={maxTagLength}
            placeholder={t("level2", "tag_add_placeholder")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <button type="button" className="button button-text" onClick={add} disabled={draft.trim() === ""}>
            {t("level2", "tag_add_button")}
          </button>
        </div>
      ) : (
        <p className="helper">{t("level2", "tag_limit_reached").replace("{{max}}", String(maxTags))}</p>
      )}
    </div>
  );
}

const RESTRICTION_LABEL_KEY: Record<RestrictionType, string> = {
  cannot_contract: "counterparty_restriction_cannot_contract",
  do_not_share_information: "counterparty_restriction_do_not_share_information",
  both: "counterparty_restriction_both",
};

/**
 * fa.provider.restricted_counterparties (Level 2 MVP, composition 6). Rendered visually set apart
 * from the surrounding fields — a slightly darker background, per the Design Specification's
 * "operational-restriction weight without alarming colour" — since this is confidential,
 * operationally/compliance-sensitive data the respondent should notice is being handled with care,
 * without it reading as an error or a warning. Never confuse this with tag_list: every entry here
 * always carries a restrictionType, never a bare name.
 */
function CounterpartyListInput({ question, t, value, onChange, ids }: Shared) {
  const entries = Array.isArray(value) ? (value as CounterpartyEntry[]) : [];
  const [draftName, setDraftName] = useState("");
  const [draftType, setDraftType] = useState<RestrictionType>("cannot_contract");
  const maxEntries = question.max_tags ?? 25;
  const maxNameLength = question.max_tag_length ?? 200;
  const atLimit = entries.length >= maxEntries;

  const commit = (next: CounterpartyEntry[]) => onChange(next.length > 0 ? next : null, "now");

  const add = () => {
    const trimmed = draftName.trim().slice(0, maxNameLength);
    if (!trimmed || atLimit || entries.some((e) => e.name.toLowerCase() === trimmed.toLowerCase())) return;
    commit([...entries, { name: trimmed, restrictionType: draftType }]);
    setDraftName("");
    setDraftType("cannot_contract");
  };

  return (
    <div className="field counterparty-list" style={{ marginTop: "1.5rem", background: "var(--surface-muted, rgba(0,0,0,0.035))", borderRadius: "0.5rem", padding: "1rem" }}>
      <p className="helper" style={{ marginTop: 0 }}>
        {t("level2", "counterparty_confidential_note")}
      </p>
      {entries.length > 0 && (
        <ul className="chips" style={{ margin: "0 0 1rem", flexDirection: "column", alignItems: "stretch", gap: "0.5rem" }}>
          {entries.map((entry) => (
            <li key={entry.name} className="chip" style={{ justifyContent: "space-between" }}>
              <span>
                {entry.name} — {t("level2", RESTRICTION_LABEL_KEY[entry.restrictionType])}
              </span>
              <button
                type="button"
                aria-label={t("level2", "counterparty_remove").replace("{{name}}", entry.name)}
                onClick={() => commit(entries.filter((e) => e.name !== entry.name))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {!atLimit ? (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input
            id={`q-${question.id}-input`}
            className="input"
            type="text"
            aria-labelledby={ids.title}
            maxLength={maxNameLength}
            placeholder={t("level2", "counterparty_name_placeholder")}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <label className="visually-hidden" htmlFor={`q-${question.id}-restriction`}>
            {t("level2", "counterparty_restriction_label")}
          </label>
          <select
            id={`q-${question.id}-restriction`}
            className="select"
            value={draftType}
            onChange={(e) => setDraftType(e.target.value as RestrictionType)}
          >
            {RESTRICTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {t("level2", RESTRICTION_LABEL_KEY[type])}
              </option>
            ))}
          </select>
          <button type="button" className="button button-text" onClick={add} disabled={draftName.trim() === ""}>
            {t("level2", "counterparty_add_button")}
          </button>
        </div>
      ) : (
        <p className="helper">{t("level2", "counterparty_limit_reached").replace("{{max}}", String(maxEntries))}</p>
      )}
    </div>
  );
}

function CountryInput({ question, locale, t, value, countries, onChange, describedBy, ids }: Shared) {
  const selected = Array.isArray(value) ? (value as string[]) : [];
  const [query, setQuery] = useState("");
  const matches = searchCountries(countries, query, locale, selected);
  const listId = `q-${question.id}-suggestions`;
  const maxCount = question.max_count ?? 30;

  const add = (code: string) => {
    if (selected.length >= maxCount) return;
    onChange([...selected, code], "now");
    setQuery("");
    document.getElementById(`q-${question.id}-input`)?.focus();
  };

  return (
    <div className="field" style={{ marginTop: "1.5rem" }}>
      {selected.length > 0 && (
        <ul className="chips" style={{ margin: "0 0 1rem" }}>
          {selected.map((code) => (
            <li key={code} className="chip">
              <span>{countryName(code, locale)}</span>
              <button
                type="button"
                aria-label={`${t("common", "country_remove")} ${countryName(code, locale)}`}
                onClick={() => {
                  const next = selected.filter((c) => c !== code);
                  onChange(next.length > 0 ? next : null, "now");
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={`q-${question.id}-input`}
        className="input"
        type="text"
        autoComplete="off"
        role="combobox"
        aria-expanded={matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-labelledby={ids.title}
        aria-describedby={describedBy}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (matches[0]) add(matches[0]);
          }
        }}
      />
      {query.trim() !== "" && (
        <ul className="suggestions" id={listId} role="listbox" aria-labelledby={ids.title}>
          {matches.length === 0 ? (
            <li style={{ padding: "0.6rem 0.9rem", color: "var(--ink-soft)" }}>{t("common", "country_no_results")}</li>
          ) : (
            matches.map((code) => (
              <li key={code} role="option" aria-selected={false}>
                <button type="button" onClick={() => add(code)}>
                  {countryName(code, locale)}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function TimingInput({ question, locale, t, value, onChange }: Shared) {
  const initial = value && typeof value === "object" ? ((value as { precision?: TimingPrecision }).precision ?? null) : null;
  const [precision, setPrecision] = useState<TimingPrecision | null>(initial);
  const [parts, setParts] = useState(() => timingParts(value));
  const thisYear = new Date().getUTCFullYear();
  const years = Array.from({ length: 11 }, (_, i) => String(thisYear + i));
  for (const y of [parts.monthYear, parts.quarterYear]) if (y && !years.includes(y)) years.unshift(y);
  const monthFormat = new Intl.DateTimeFormat(locale === "es" ? "es-MX" : "en-US", { month: "long", timeZone: "UTC" });

  const update = (nextPrecision: TimingPrecision, nextParts = parts) => {
    setPrecision(nextPrecision);
    setParts(nextParts);
    const complete = timingValue(nextPrecision, nextParts);
    if (complete) onChange(complete, "now");
  };

  const choices: Array<{ value: TimingPrecision; label: string }> = [
    { value: "date", label: t("common", "timing_date") },
    { value: "month", label: t("common", "timing_month") },
    { value: "quarter", label: t("common", "timing_quarter") },
    { value: "not_sure", label: t("common", "timing_not_sure") },
  ];

  return (
    <div className="options">
      {choices.map((choice) => (
        <div key={choice.value}>
          <label className="option" data-selected={precision === choice.value}>
            <input type="radio" name={`${question.id}-precision`} checked={precision === choice.value} onChange={() => update(choice.value)} />
            <span>{choice.label}</span>
          </label>
          {precision === choice.value && choice.value === "date" && (
            <div className="field" style={{ margin: "0.75rem 0 0.5rem var(--indent)" }}>
              <label className="visually-hidden" htmlFor={`${question.id}-date`}>
                {choice.label}
              </label>
              <input
                id={`${question.id}-date`}
                className="input"
                type="date"
                min={`${thisYear - 1}-01-01`}
                max="2100-12-31"
                value={parts.date}
                onChange={(e) => update("date", { ...parts, date: e.target.value })}
              />
            </div>
          )}
          {precision === choice.value && choice.value === "month" && (
            <div className="two-col" style={{ margin: "0.75rem 0 0.5rem var(--indent)" }}>
              <SelectField id={`${question.id}-month`} label={choice.label} value={parts.month} onChange={(v) => update("month", { ...parts, month: v })}>
                {Array.from({ length: 12 }, (_, i) => {
                  const mm = String(i + 1).padStart(2, "0");
                  return (
                    <option key={mm} value={mm}>
                      {monthFormat.format(new Date(Date.UTC(2024, i, 1)))}
                    </option>
                  );
                })}
              </SelectField>
              <SelectField id={`${question.id}-month-year`} label={t("common", "year_label")} value={parts.monthYear} onChange={(v) => update("month", { ...parts, monthYear: v })}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </SelectField>
            </div>
          )}
          {precision === choice.value && choice.value === "quarter" && (
            <div className="two-col" style={{ margin: "0.75rem 0 0.5rem var(--indent)" }}>
              <SelectField id={`${question.id}-quarter`} label={t("common", "quarter_label")} value={parts.quarter} onChange={(v) => update("quarter", { ...parts, quarter: v })}>
                {["1", "2", "3", "4"].map((q) => (
                  <option key={q} value={q}>
                    Q{q}
                  </option>
                ))}
              </SelectField>
              <SelectField id={`${question.id}-quarter-year`} label={t("common", "year_label")} value={parts.quarterYear} onChange={(v) => update("quarter", { ...parts, quarterYear: v })}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </SelectField>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SelectField({ id, label, value, onChange, children }: { id: string; label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label htmlFor={id} style={{ fontWeight: 400 }}>
        {label}
      </label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>
          —
        </option>
        {children}
      </select>
    </div>
  );
}

function QuantityInput({ question, locale, t, value, onChange }: Shared) {
  const initial = (value && typeof value === "object" ? value : {}) as { amount?: number; unit?: string; not_sure?: boolean };
  const [amount, setAmount] = useState(initial.amount !== undefined ? String(initial.amount) : "");
  const [unit, setUnit] = useState(initial.unit ?? "");
  const [notSure, setNotSure] = useState(initial.not_sure === true);

  const emit = (next: { amount: string; unit: string; notSure: boolean }, mode: "now" | "debounced") => {
    if (next.notSure) return onChange({ not_sure: true }, "now");
    const n = Number(next.amount);
    if (next.amount.trim() !== "" && Number.isFinite(n) && n > 0 && next.unit.trim() !== "") onChange({ amount: n, unit: next.unit.trim() }, mode);
  };

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <div className="two-col">
        <div className="field">
          <label htmlFor={`${question.id}-amount`}>{t("common", "quantity_amount")}</label>
          <input
            id={`${question.id}-amount`}
            className="input"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            disabled={notSure}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              emit({ amount: e.target.value, unit, notSure }, "debounced");
            }}
          />
        </div>
        <div className="field">
          <label htmlFor={`${question.id}-unit`}>{t("common", "quantity_unit")}</label>
          {question.units && question.units.length > 0 ? (
            <select
              id={`${question.id}-unit`}
              className="select"
              disabled={notSure}
              value={unit}
              onChange={(e) => {
                setUnit(e.target.value);
                emit({ amount, unit: e.target.value, notSure }, "now");
              }}
            >
              <option value="" disabled>
                —
              </option>
              {question.units.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.copy[locale] ?? u.copy.en}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`${question.id}-unit`}
              className="input"
              type="text"
              maxLength={40}
              disabled={notSure}
              value={unit}
              onChange={(e) => {
                setUnit(e.target.value);
                emit({ amount, unit: e.target.value, notSure }, "debounced");
              }}
            />
          )}
        </div>
      </div>
      <label className="option" data-selected={notSure}>
        <input
          type="checkbox"
          checked={notSure}
          onChange={(e) => {
            setNotSure(e.target.checked);
            emit({ amount, unit, notSure: e.target.checked }, "now");
          }}
        />
        <span>{t("common", "quantity_not_sure")}</span>
      </label>
    </div>
  );
}
