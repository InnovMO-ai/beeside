import { Bundle, Locale, OptionDef, QuestionDef } from "./types";

// Pure answer helpers for the question renderers. The backend remains the validator of record.

export function isAnswered(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Multi-select toggle: an exclusive value ("Not sure", "None") replaces the rest and vice versa; canonical order kept. */
export function toggleMulti(current: string[], value: string, checked: boolean, exclusive: string[], order: string[]): string[] {
  let next: string[];
  if (!checked) next = current.filter((v) => v !== value);
  else if (exclusive.includes(value)) next = [value];
  else next = [...current.filter((v) => !exclusive.includes(v)), value];
  return order.filter((v) => next.includes(v));
}

/** Options for a question, including options drawn from an earlier multi-select (`options_from`). */
export function resolveOptions(bundle: Bundle, question: QuestionDef, dynamicValues: string[] | undefined): OptionDef[] {
  if (!question.options_from) return question.options ?? [];
  const source = bundle.questions.find((q) => q.field_key === question.options_from?.field);
  const sourceOptions = source?.options ?? [];
  return (dynamicValues ?? []).flatMap((value) => sourceOptions.filter((o) => o.value === value));
}

export type TimingPrecision = "date" | "month" | "quarter" | "not_sure";
export interface TimingValue {
  precision: TimingPrecision;
  value: string | null;
}

export function timingValue(precision: TimingPrecision | null, parts: { date: string; month: string; monthYear: string; quarter: string; quarterYear: string }): TimingValue | null {
  switch (precision) {
    case "not_sure":
      return { precision, value: null };
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(parts.date) ? { precision, value: parts.date } : null;
    case "month":
      return parts.month && parts.monthYear ? { precision, value: `${parts.monthYear}-${parts.month}` } : null;
    case "quarter":
      return parts.quarter && parts.quarterYear ? { precision, value: `${parts.quarterYear}-Q${parts.quarter}` } : null;
    default:
      return null;
  }
}

export function timingParts(value: unknown) {
  const parts = { date: "", month: "", monthYear: "", quarter: "", quarterYear: "" };
  const v = value as TimingValue | null;
  if (!v || typeof v !== "object" || typeof v.value !== "string") return parts;
  if (v.precision === "date") parts.date = v.value;
  if (v.precision === "month") [parts.monthYear, parts.month] = v.value.split("-");
  if (v.precision === "quarter") {
    const [year, q] = v.value.split("-Q");
    parts.quarterYear = year;
    parts.quarter = q;
  }
  return parts;
}

const displayNames = new Map<Locale, Intl.DisplayNames | null>();

export function countryName(code: string, locale: Locale): string {
  if (!displayNames.has(locale)) {
    try {
      displayNames.set(locale, new Intl.DisplayNames([locale === "es" ? "es-MX" : "en-US"], { type: "region" }));
    } catch {
      displayNames.set(locale, null);
    }
  }
  return displayNames.get(locale)?.of(code) ?? code;
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function searchCountries(codes: string[], query: string, locale: Locale, selected: string[], limit = 8): string[] {
  const q = fold(query.trim());
  if (!q) return [];
  return codes
    .filter((code) => !selected.includes(code))
    .map((code) => ({ code, name: fold(countryName(code, locale)) }))
    .filter(({ code, name }) => name.includes(q) || code.toLowerCase() === q)
    .sort((a, b) => Number(!a.name.startsWith(q)) - Number(!b.name.startsWith(q)) || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ code }) => code);
}
