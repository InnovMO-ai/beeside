/**
 * Human renderers for captured values (EN / ES). Used by the CRP and the Service Map builders: the client and the
 * Sherpa never see raw keys, enum codes, ISO codes or JSON. Pure; relies only on Intl (ICU ships with Node 20).
 *
 * Enum labels come from data/value-labels.json (drafted neutral wording, content approval pending); an unknown value
 * falls back to a humanised form of the key (underscores removed) — never the raw key.
 */
import type { FieldDefinition } from "./effective-fields";
import valueLabelsJson from "./data/value-labels.json";

export type Locale = "en" | "es";
export const LOCALES: readonly Locale[] = ["en", "es"];

interface ValueLabels {
  values: Record<string, Record<Locale, string>>;
  field_overrides?: Record<string, Record<string, Record<Locale, string>>>;
  units: Record<string, Record<Locale, string>>;
}
const LABELS = valueLabelsJson as unknown as ValueLabels;

const MAX_TEXT = 2000;

export function isLocale(x: unknown): x is Locale {
  return x === "en" || x === "es";
}

const STATE_LABELS = {
  confirmed: { en: "Confirmed", es: "Confirmado" },
  assumed: { en: "Assumed", es: "Asumido" },
  pending: { en: "Pending", es: "Pendiente" },
  not_applicable: { en: "Not applicable", es: "No aplica" },
} as const;
export function stateLabel(state: keyof typeof STATE_LABELS, locale: Locale): string {
  return STATE_LABELS[state][locale];
}

export function yesNo(v: boolean, locale: Locale): string {
  return locale === "es" ? (v ? "Sí" : "No") : v ? "Yes" : "No";
}

/** "snake_case_key" -> "Snake case key" (fallback only). */
export function humanizeKey(key: string): string {
  const s = key.replace(/^CAP_/, "").replace(/[_:]+/g, " ").trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

/** Collapses whitespace, strips control characters, bounds the length. */
export function cleanText(v: string): string {
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s;
}

const listFormatters = new Map<Locale, Intl.ListFormat>();
export function joinList(items: string[], locale: Locale): string {
  let f = listFormatters.get(locale);
  if (!f) {
    f = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
    listFormatters.set(locale, f);
  }
  return f.format(items);
}

const regionNames = new Map<Locale, Intl.DisplayNames>();
/** ISO 3166-1 alpha-2 -> localized country name (the code itself when unknown). */
export function countryName(code: string, locale: Locale): string {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return cleanText(code);
  let d = regionNames.get(locale);
  if (!d) {
    d = new Intl.DisplayNames([locale], { type: "region" });
    regionNames.set(locale, d);
  }
  try {
    return d.of(c) ?? c;
  } catch {
    return c;
  }
}

const languageNames = new Map<Locale, Intl.DisplayNames>();
export function languageName(code: string, locale: Locale): string {
  const c = code.trim();
  if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(c)) return cleanText(code);
  let d = languageNames.get(locale);
  if (!d) {
    d = new Intl.DisplayNames([locale], { type: "language" });
    languageNames.set(locale, d);
  }
  try {
    const n = d.of(c);
    return n ? n.charAt(0).toUpperCase() + n.slice(1) : c;
  } catch {
    return c;
  }
}

export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(n);
}

/** "2027", "2027-03", "2027-03-15" (also full ISO timestamps) -> "2027" / "March 2027" / "March 15, 2027". */
export function formatDate(v: string, locale: Locale): string {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?(?:T.*)?$/.exec(v.trim());
  if (!m) return cleanText(v);
  const [, y, mo, d] = m;
  if (!mo) return y as string;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, d ? Number(d) : 1));
  if (Number.isNaN(date.getTime()) || Number(mo) < 1 || Number(mo) > 12) return cleanText(v);
  const opts: Intl.DateTimeFormatOptions = d ? { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" } : { year: "numeric", month: "long", timeZone: "UTC" };
  return new Intl.DateTimeFormat(locale, opts).format(date);
}

export function unitLabel(unit: string, locale: Locale): string {
  return LABELS.units[unit]?.[locale] ?? humanizeKey(unit).toLowerCase();
}

/** Label of an enum value; `scope` is `field_key` or `group.sub` for per-field overrides. */
export function valueLabel(value: string, locale: Locale, scope?: string): string {
  const own = scope ? LABELS.field_overrides?.[scope]?.[value]?.[locale] : undefined;
  return own ?? LABELS.values[value]?.[locale] ?? humanizeKey(value);
}

/** True when a label exists for the value (tests assert coverage for every shipped enum value). */
export function hasValueLabel(value: string): boolean {
  return LABELS.values[value] !== undefined;
}

const asNumber = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

function renderMoney(v: unknown, locale: Locale): string | null {
  if (v !== null && typeof v === "object") {
    const o = v as { amount?: unknown; value?: unknown; currency?: unknown };
    const n = asNumber(o.amount ?? o.value);
    if (n === null) return null;
    const cur = typeof o.currency === "string" && /^[A-Za-z]{3}$/.test(o.currency) ? o.currency.toUpperCase() : null;
    if (!cur) return formatNumber(n, locale);
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency: cur }).format(n);
    } catch {
      return `${formatNumber(n, locale)} ${cur}`;
    }
  }
  const n = asNumber(v);
  return n === null ? null : formatNumber(n, locale);
}

const stringsOf = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).filter((x): x is string => typeof x === "string" && x.trim() !== "");

/**
 * Human text of one captured value of `field` (type-aware). Returns null when there is nothing renderable (so callers
 * show "pending" rather than an empty or technical string). Never JSON, never raw keys.
 */
export function renderFieldValue(field: Pick<FieldDefinition, "type" | "field_key">, value: unknown, locale: Locale, scope?: string): string | null {
  if (value === undefined || value === null) return null;
  switch (field.type) {
    case "boolean":
      return typeof value === "boolean" ? yesNo(value, locale) : null;
    case "number": {
      const n = asNumber(value);
      return n === null ? null : formatNumber(n, locale);
    }
    case "number_with_unit": {
      const o = value as { value?: unknown; unit?: unknown };
      const n = typeof value === "object" ? asNumber(o.value) : asNumber(value);
      if (n === null) return null;
      return typeof o.unit === "string" && o.unit ? `${formatNumber(n, locale)} ${unitLabel(o.unit, locale)}` : formatNumber(n, locale);
    }
    case "money":
      return renderMoney(value, locale);
    case "date":
      return typeof value === "string" && value.trim() ? formatDate(value, locale) : null;
    case "enum": {
      const s = stringsOf(value)[0];
      return s ? valueLabel(s, locale, scope ?? field.field_key) : null;
    }
    case "multi_enum": {
      const l = stringsOf(value).map((s) => valueLabel(s, locale, scope ?? field.field_key));
      return l.length ? joinList(l, locale) : null;
    }
    case "country_list": {
      const l = stringsOf(value).map((c) => countryName(c, locale));
      return l.length ? joinList(l, locale) : null;
    }
    case "language_list":
    case "text_or_language_code_list": {
      const l = stringsOf(value).map((c) => (field.type === "language_list" || /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(c) ? languageName(c, locale) : cleanText(c)));
      return l.length ? joinList(l, locale) : null;
    }
    case "text_list": {
      const l = stringsOf(value).map(cleanText).filter(Boolean);
      return l.length ? joinList(l, locale) : null;
    }
    default: {
      // text and anything unknown: only primitives are rendered
      if (typeof value === "string") return cleanText(value) || null;
      if (typeof value === "number" && Number.isFinite(value)) return formatNumber(value, locale);
      if (typeof value === "boolean") return yesNo(value, locale);
      return null;
    }
  }
}
