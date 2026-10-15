/**
 * Field model helpers: resolve a manifest field definition (country overlays included), brief it for the writer,
 * turn it into extraction specs, validate/assemble extracted values and walk repeatable groups.
 *
 * Only TYPES are imported from ENGINE's manifest modules; nothing here evaluates readiness.
 */
import type { CategoryManifestContent, FieldDefinition } from "../manifest/effective-fields";
import type { ExtractSpec, ExtractedValue, FieldBrief } from "./ports";
import { normalizeText } from "./text-utils";
import type { Locale } from "./types";

export type { FieldDefinition };

/** Presentation port: ENGINE's value renderers are wired by the caller (see adapters/engine-bindings.ts). */
export interface ValueRenderer {
  /** Human text of a captured value (type-aware); null when nothing renderable. */
  renderValue(def: Pick<FieldDefinition, "type" | "field_key">, value: unknown, locale: Locale, scope?: string): string | null;
  /** Label of one enum value; never the raw key. */
  enumLabel(value: string, locale: Locale, scope?: string): string;
}

export function humanize(key: string): string {
  const s = key.replace(/^CAP_/, "").replace(/[_:]+/g, " ").trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

const norm = (v: string): string => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
let NAME_TO_CODE: Map<string, string> | null = null;
/** Country name (English or Spanish) to ISO 3166-1 alpha-2, from the platform's own region names; null when unknown. */
export function countryCodeFromName(name: string): string | null {
  if (!NAME_TO_CODE) {
    const m = new Map<string, string>();
    try {
      const dn = [new Intl.DisplayNames(["en"], { type: "region" }), new Intl.DisplayNames(["es"], { type: "region" })];
      for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        for (const d of dn) {
          let n: string | undefined;
          try { n = d.of(code); } catch { n = undefined; }
          if (n && n !== code) m.set(norm(n), code);
        }
      }
    } catch { /* Intl.DisplayNames unavailable: names stay unresolved, codes still work */ }
    NAME_TO_CODE = m;
  }
  return NAME_TO_CODE.get(norm(name)) ?? null;
}

function regionName(code: string, locale: Locale): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
function languageName(code: string, locale: Locale): string {
  try {
    const n = new Intl.DisplayNames([locale], { type: "language" }).of(code);
    return n ? n.charAt(0).toUpperCase() + n.slice(1) : code;
  } catch {
    return code;
  }
}
function joinList(items: string[], locale: Locale): string {
  try {
    return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
}
function dateText(v: string, locale: Locale): string {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(v.trim());
  if (!m) return v;
  const [, y, mo, d] = m;
  if (!mo) return y as string;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, d ? Number(d) : 1));
  if (Number.isNaN(date.getTime())) return v;
  return new Intl.DateTimeFormat(locale, d ? { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" } : { year: "numeric", month: "long", timeZone: "UTC" }).format(date);
}

/** Default renderer used when none is injected (Intl-based; ENGINE's renderer is wired by the composition root). */
export const basicRenderer: ValueRenderer = {
  renderValue(def, value, locale) {
    if (value === undefined || value === null) return null;
    const strings = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string" && x.trim() !== "");
    switch (def.type) {
      case "boolean":
        return typeof value === "boolean" ? (locale === "es" ? (value ? "Sí" : "No") : value ? "Yes" : "No") : null;
      case "date":
        return typeof value === "string" ? dateText(value, locale) : null;
      case "country_list": {
        const l = strings(value).map((c) => regionName(c, locale));
        return l.length ? joinList(l, locale) : null;
      }
      case "language_list": {
        const l = strings(value).map((c) => languageName(c, locale));
        return l.length ? joinList(l, locale) : null;
      }
      case "multi_enum": {
        const l = strings(value).map((c) => humanize(c));
        return l.length ? joinList(l, locale) : null;
      }
      case "enum": {
        const s = strings(value)[0];
        return s ? humanize(s) : null;
      }
      case "text_list": {
        const l = strings(value);
        return l.length ? joinList(l, locale) : null;
      }
      case "money": {
        const o = value as { amount?: unknown; currency?: unknown };
        if (typeof value === "number") return String(value);
        return typeof o?.amount === "number" ? `${o.amount}${typeof o.currency === "string" ? ` ${o.currency}` : ""}` : null;
      }
      case "number_with_unit": {
        const o = value as { value?: unknown; unit?: unknown };
        if (typeof value === "number") return String(value);
        return typeof o?.value === "number" ? `${o.value}${typeof o.unit === "string" ? ` ${humanize(o.unit).toLowerCase()}` : ""}` : null;
      }
      default:
        if (typeof value === "string") return value.trim() || null;
        if (typeof value === "number") return String(value);
        return null;
    }
  },
  enumLabel: (value) => humanize(value),
};

export function labelOf(def: Pick<FieldDefinition, "label" | "field_key">, locale: Locale): string {
  return def.label?.[locale] ?? def.label?.en ?? humanize(def.field_key);
}

export function helpOf(def: Pick<FieldDefinition, "help_text">, locale: Locale): string | null {
  const h = def.help_text?.[locale] ?? def.help_text?.en;
  return h && h.trim() ? h.trim() : null;
}

/** Finds a field definition by key: base fields plus the additions/modifications of the scoped country overlays. */
export function resolveFieldDef(manifest: CategoryManifestContent, key: string, countries: readonly string[]): FieldDefinition | null {
  let found: FieldDefinition | null = manifest.fields?.find((f) => f.field_key === key) ?? null;
  for (const c of countries) {
    const ov = manifest.country_overlays?.[c.toUpperCase()];
    if (!ov) continue;
    const added = ov.add?.find((f) => f.field_key === key);
    if (!found && added) found = added;
    const patch = ov.modify?.find((m) => m.field_key === key)?.patch;
    if (found && patch) found = { ...found, ...patch };
  }
  return found;
}

export const GROUP_TYPE = "repeatable_group";
export const isGroup = (def: Pick<FieldDefinition, "type">): boolean => def.type === GROUP_TYPE;

// ------------------------------------------------------------------ group cursor
const REQUIRED = new Set(["blocking", "required", "conditional"]);

export function requiredSubs(def: FieldDefinition, materialSubs?: ReadonlySet<string>): FieldDefinition[] {
  return (def.group_item_schema ?? []).filter((s) => (REQUIRED.has(s.requirement_level) || materialSubs?.has(s.field_key) === true) && s.derived !== true);
}

function itemEntry(item: Record<string, unknown> | null, sub: string): { has: boolean } {
  if (!item) return { has: false };
  const raw = item[sub];
  if (raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0)) return { has: false };
  return { has: true };
}

export interface GroupCursor { itemIndex: number; sub: FieldDefinition; newItem: boolean }

/** Which sub-field of which item to ask next; null when the group has what it needs. */
export function groupCursor(def: FieldDefinition, value: unknown, materialSubs?: ReadonlySet<string>): GroupCursor | null {
  const subs = requiredSubs(def, materialSubs);
  if (subs.length === 0) return null;
  const items = Array.isArray(value) ? (value as Array<Record<string, unknown> | null>) : [];
  for (let i = 0; i < items.length; i++) {
    for (const s of subs) {
      if (itemEntry(items[i] ?? null, s.field_key).has) continue;
      // a material sub-field (not required by the manifest) is explored once for the group, not once per item
      const natively = REQUIRED.has(s.requirement_level);
      if (!natively && (i > 0 || items.some((it, j) => j !== i && itemEntry(it ?? null, s.field_key).has))) continue;
      return { itemIndex: i, sub: s, newItem: false };
    }
  }
  const minItems = typeof def.min_items === "number" && def.min_items >= 1 ? def.min_items : 1;
  if (items.length < minItems) return { itemIndex: items.length, sub: subs[0] as FieldDefinition, newItem: true };
  return null;
}

/** Writes one sub-field value (bare when answered, envelope otherwise) into a copy of the group value. */
export function mergeGroupItem(
  value: unknown,
  itemIndex: number,
  sub: string,
  subValue: unknown,
  answerState: "ANSWERED" | "UNKNOWN" | "WITHHELD" | "EXPLICIT_NO" | "ZERO" | "ASSUMED",
): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = Array.isArray(value) ? (value as Array<Record<string, unknown> | null>).map((it) => ({ ...(it ?? {}) })) : [];
  while (items.length <= itemIndex) items.push({});
  const item = items[itemIndex] as Record<string, unknown>;
  item[sub] = answerState === "ANSWERED" ? subValue : { answer_state: answerState, value: subValue ?? null };
  return items;
}

// ------------------------------------------------------------------ briefs and options
export function enumValuesOf(def: FieldDefinition): string[] {
  return Array.isArray(def.values) ? def.values.filter((v): v is string => typeof v === "string") : [];
}

export interface Target {
  /** The top-level requirement (what the engine's nextFieldKey names). */
  def: FieldDefinition;
  /** The field actually asked: the def itself, or a sub-field of a group item. */
  ask: FieldDefinition;
  groupKey: string | null;
  itemIndex: number | null;
  /** key used in specs/facts for the asked field: field_key, or `${group}__${sub}`. */
  specName: string;
}

export function makeTarget(def: FieldDefinition, groupValue: unknown, materialSubs?: ReadonlySet<string>): Target | null {
  if (!isGroup(def)) return { def, ask: def, groupKey: null, itemIndex: null, specName: def.field_key };
  const cur = groupCursor(def, groupValue, materialSubs);
  if (!cur) return null;
  return { def, ask: cur.sub, groupKey: def.field_key, itemIndex: cur.itemIndex, specName: `${def.field_key}__${cur.sub.field_key}` };
}

export function briefOf(t: Target, locale: Locale, r: ValueRenderer): FieldBrief {
  const scope = t.groupKey ? `${t.groupKey}.${t.ask.field_key}` : t.ask.field_key;
  const options = enumValuesOf(t.ask).map((v) => ({ value: v, label: r.enumLabel(v, locale, scope) }));
  return {
    fieldKey: t.def.field_key,
    ...(t.groupKey ? { subKey: t.ask.field_key } : {}),
    ...(t.itemIndex !== null ? { itemIndex: t.itemIndex } : {}),
    label: labelOf(t.ask, locale),
    ...(t.groupKey ? { groupLabel: labelOf(t.def, locale) } : {}),
    helpText: helpOf(t.ask, locale),
    type: t.ask.type,
    options,
    requirementLevel: t.ask.requirement_level,
  };
}

// ------------------------------------------------------------------ extraction specs
export function specsFor(def: FieldDefinition, specName: string, locale: Locale, r: ValueRenderer, isTarget: boolean, scope?: string): ExtractSpec[] {
  const label = labelOf(def, "en");
  const help = helpOf(def, "en");
  const description = help ? `${label}. ${help}` : label;
  const values = enumValuesOf(def);
  const labels: Record<string, string> = {};
  for (const v of values) labels[v] = r.enumLabel(v, locale, scope ?? def.field_key);
  switch (def.type) {
    case "enum":
      return [{ name: specName, type: "enum", description, enumValues: values, enumLabels: labels, isTarget }];
    case "multi_enum":
      return [{ name: specName, type: "multi_enum", description, enumValues: values, enumLabels: labels, isTarget }];
    case "boolean":
      return [{ name: specName, type: "boolean", description, isTarget }];
    case "number":
      return [{ name: specName, type: "number", description, isTarget }];
    case "date":
      return [{ name: specName, type: "date", description: `${description} (ISO date YYYY-MM-DD; a bare year YYYY or month YYYY-MM is acceptable)`, isTarget }];
    case "country_list":
      return [{ name: specName, type: "multi_enum", description: `${description} (ISO 3166-1 alpha-2 country codes)`, isTarget }];
    case "language_list":
      return [{ name: specName, type: "multi_enum", description: `${description} (ISO 639-1 language codes)`, isTarget }];
    case "text_list":
    case "text_or_language_code_list":
      return [{ name: specName, type: "multi_enum", description: `${description} (a list of short phrases)`, isTarget }];
    case "money":
      return [
        { name: `${specName}__amount`, type: "number", description: `${description} (amount only)`, isTarget },
        { name: `${specName}__currency`, type: "string", description: `${description} (ISO 4217 currency code, only if stated)`, isTarget: false },
      ];
    case "number_with_unit": {
      const units = Array.isArray(def.unit_values) ? def.unit_values.filter((u): u is string => typeof u === "string") : [];
      return [
        { name: `${specName}__value`, type: "number", description: `${description} (number only)`, isTarget },
        units.length > 0
          ? { name: `${specName}__unit`, type: "enum", description: `${description} (unit)`, enumValues: units, isTarget: false }
          : { name: `${specName}__unit`, type: "string", description: `${description} (unit, only if stated)`, isTarget: false },
      ];
    }
    default:
      return [{ name: specName, type: "string", description, isTarget }];
  }
}

// ------------------------------------------------------------------ validation / assembly
const DATE_RE = /^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/;
const LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/i;

export interface Assembled { ok: boolean; value: unknown; confidence: number | null; source: string | null }

const FAIL: Assembled = { ok: false, value: null, confidence: null, source: null };

/** Validates a raw extracted value against the field definition; returns the canonical value or null. */
export function validateValue(def: FieldDefinition, raw: unknown): unknown | null {
  switch (def.type) {
    case "boolean":
      return typeof raw === "boolean" ? raw : null;
    case "number":
      return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    case "date":
      return typeof raw === "string" && DATE_RE.test(raw.trim()) ? raw.trim() : null;
    case "enum": {
      if (typeof raw !== "string") return null;
      const values = enumValuesOf(def);
      const hit = values.find((v) => v === raw) ?? values.find((v) => v.toLowerCase() === raw.trim().toLowerCase());
      return hit ?? null;
    }
    case "multi_enum": {
      const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;]+/) : null;
      if (!arr) return null;
      const values = enumValuesOf(def);
      const out: string[] = [];
      for (const x of arr) {
        if (typeof x !== "string") return null;
        const t = x.trim();
        if (!t) continue;
        const hit = values.length ? (values.find((v) => v === t) ?? values.find((v) => v.toLowerCase() === t.toLowerCase())) : t;
        if (!hit) return null;
        if (!out.includes(hit)) out.push(hit);
      }
      return out.length ? out : null;
    }
    case "country_list": {
      // The prompt asks for ISO 3166-1 alpha-2 codes; a real model sometimes answers with the country name ("Mexico",
      // "México") instead. A name is resolved to its code deterministically (Intl region names, EN + ES); anything else is refused.
      const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? (/^[A-Za-z]{2}(?:[,;\s]+[A-Za-z]{2})*$/.test(raw.trim()) ? raw.trim().split(/[,;\s]+/) : raw.split(/\s*(?:[,;]|\by\b|\band\b)\s*/i)) : null;
      if (!arr) return null;
      const out: string[] = [];
      for (const x of arr) {
        if (typeof x !== "string") return null;
        const t = x.trim();
        if (!t) continue;
        const c = /^[A-Za-z]{2}$/.test(t) ? t.toUpperCase() : countryCodeFromName(t);
        if (!c) return null;
        if (!out.includes(c)) out.push(c);
      }
      return out.length ? out : null;
    }
    case "language_list": {
      const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;\s]+/) : null;
      if (!arr) return null;
      const out: string[] = [];
      for (const x of arr) {
        if (typeof x !== "string" || !LANG_RE.test(x.trim())) return null;
        const c = x.trim().toLowerCase();
        if (!out.includes(c)) out.push(c);
      }
      return out.length ? out : null;
    }
    case "text_list":
    case "text_or_language_code_list": {
      const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[;\n]+/) : null;
      if (!arr) return null;
      const out = arr.filter((x): x is string => typeof x === "string").map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x.length > 0 && x.length <= 200);
      return out.length > 0 && out.length <= 20 ? out : null;
    }
    case "text": {
      if (typeof raw !== "string") return null;
      const t = raw.replace(/\s+/g, " ").trim();
      return t.length >= 1 && t.length <= 2000 ? t : null;
    }
    default: {
      if (typeof raw === "string") {
        const t = raw.replace(/\s+/g, " ").trim();
        return t.length >= 1 && t.length <= 2000 ? t : null;
      }
      return null;
    }
  }
}

/** Builds the value of a field (single or compound) from the extracted entries named `specName` / `specName__part`. */
export function assembleValue(def: FieldDefinition, specName: string, got: ReadonlyMap<string, ExtractedValue>, clientText: string): Assembled {
  const main = def.type === "money" ? got.get(`${specName}__amount`) : def.type === "number_with_unit" ? got.get(`${specName}__value`) : got.get(specName);
  if (!main || main.status !== "ok" || main.value === null) return FAIL;
  // Anti-hallucination: the supporting snippet must really appear in the client's text.
  if (!sourceAppears(main.source, clientText)) return FAIL;
  let value: unknown;
  if (def.type === "money") {
    const amount = validateNumber(main.value);
    if (amount === null) return FAIL;
    const cur = got.get(`${specName}__currency`);
    const code = cur && cur.status === "ok" && typeof cur.value === "string" && /^[A-Za-z]{3}$/.test(cur.value.trim()) ? cur.value.trim().toUpperCase() : null;
    value = code ? { amount, currency: code } : { amount };
  } else if (def.type === "number_with_unit") {
    const n = validateNumber(main.value);
    if (n === null) return FAIL;
    const u = got.get(`${specName}__unit`);
    const units = Array.isArray(def.unit_values) ? def.unit_values : [];
    const unit = u && u.status === "ok" && typeof u.value === "string" && (units.length === 0 || units.includes(u.value)) ? u.value : null;
    value = unit ? { value: n, unit } : { value: n };
  } else {
    value = validateValue(def, main.value);
    if (value === null) return FAIL;
  }
  const confidence = typeof main.confidence === "number" && main.confidence >= 0 && main.confidence <= 1 ? main.confidence : null;
  return { ok: true, value, confidence, source: main.source };
}

function validateNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** The snippet must be a (normalized) substring of the client's text. A missing snippet is not accepted. */
export function sourceAppears(source: string | null, clientText: string): boolean {
  if (!source) return false;
  const s = normalizeText(source);
  if (s.length === 0) return false;
  return normalizeText(clientText).includes(s);
}

/** Value type label stored with the fact. */
export function valueTypeOf(def: FieldDefinition): string {
  return def.type;
}
