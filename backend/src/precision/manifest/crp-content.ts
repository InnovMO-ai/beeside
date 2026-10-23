/**
 * Category Requirement Pack content — `crp.v1` (Track A contract §2/§3).
 *
 *   { schema:"crp.v1", categoryKey, crpKind, locale, title, context[], sections[], pending[], requiredLater[], versions }
 *
 *  - sections follow manifest order, grouped by the field's `section`/`theme` when the manifest declares one, otherwise
 *    by chunks of consecutive fields;
 *  - every requirement shows label (manifest copy, EN/ES), a human rendering of the value, a state
 *    (confirmed | assumed | pending | not_applicable) and the Execution Dependency mark;
 *  - `pending` lists every applicable required requirement that is not confirmed; "pending" is also a state the item
 *    keeps inside its section;
 *  - `requiredLater` = the manifest's operational_pending_items that apply (context lines, never a documents section);
 *  - rendered strings (title, context, labels, values, lines) never contain internal keys, JSON or enum codes.
 *    Structural ids (`id`, `categoryKey`) are data for the consumers, not display text.
 *
 * Deterministic and pure: same facts + manifest + locale -> same content.
 */
import { categoryInfo, isNewCategoryKey } from "./categories";
import type { CategoryManifestDoc } from "./bundled";
import { itemFact } from "./ast";
import type { FieldDefinition } from "./effective-fields";
import { evaluateCategoryDetailed, REQUIRED_LEVELS, type DetailedEvaluation, type RequirementDetail, type SubFieldStatus } from "./readiness";
import type { FactMap, FactView, RequirementState } from "./types";
import { cleanText, countryName, joinList, renderFieldValue, type Locale } from "./value-render";

export type CrpItemState = RequirementState;
export type CrpKind = "operational" | "strategic_advisory" | "ecosystem_development" | "new_category_discovery";

export interface CrpRequirementContent {
  /** Stable structural id (the manifest field key). Not display text. */
  id: string;
  label: string;
  /** Human rendering of the captured answer; null when there is none (pending / not applicable). */
  value: string | null;
  state: CrpItemState;
  executionDependency: boolean;
  /** Repeatable groups: one human line per entered item. */
  entries?: string[];
  /** Repeatable groups: required sub-fields still pending, as human lines ("Entry 2: Volume"). */
  missing?: string[];
  /**
   * Structural flag, not display text: present only when the manifest restricts who may see the item
   * (`confidential` = CONFIDENTIAL_ELIGIBLE, `context_only` = CONTEXT_ONLY_FOR_PROVIDER). Clients must not print it.
   */
  visibility?: "confidential" | "context_only";
}
export interface CrpSectionContent { id: string; title: string; items: CrpRequirementContent[] }

export interface CrpVersions {
  /** Manifest version pinned to the category assessment (stored, never shown). */
  manifest: string | null;
  catalog: string | null;
  crosswalk: string | null;
  contract: string | null;
}

export interface CrpV1Content {
  schema: "crp.v1";
  categoryKey: string;
  crpKind: CrpKind;
  locale: Locale;
  title: string;
  context: string[];
  sections: CrpSectionContent[];
  pending: CrpRequirementContent[];
  requiredLater: string[];
  versions: CrpVersions;
}

export interface CrpBuildInput {
  categoryKey: string;
  manifest: CategoryManifestDoc;
  facts: FactMap;
  /** ISO-3166-1 alpha-2 destination countries (overlay scope). */
  countries: string[];
  locale: Locale;
  /** Localized category label when the caller has one; otherwise taken from the label file. */
  categoryLabel?: string;
  /** Extra context sentences (already localized): objective, timing… */
  contextLines?: string[];
  versions?: Partial<CrpVersions>;
  /** "omit" (default) leaves inapplicable fields out; "include" lists required-level ones as Not applicable. */
  notApplicable?: "omit" | "include";
  /** Requirements per section when the manifest declares no section/theme. Default 6. */
  chunkSize?: number;
}

const DEFAULT_CHUNK = 6;

const COPY = {
  titleSuffix: { en: "Category Requirement Pack (CRP)", es: "Category Requirement Pack (CRP)" },
  destination: { en: "Destination", es: "Destino" },
  partN: { en: "Part", es: "Parte" },
  single: { en: "Requirements", es: "Requisitos" },
  entry: { en: "Entry", es: "Registro" },
} as const;

const sectionLabelOf = (f: FieldDefinition, locale: Locale): string | null => {
  const raw = (f as Record<string, unknown>).section ?? (f as Record<string, unknown>).theme;
  if (typeof raw === "string") return raw.trim() || null;
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const s = o[locale] ?? o.en;
    return typeof s === "string" && s.trim() ? s.trim() : null;
  }
  return null;
};

const labelOf = (label: Record<string, string> | undefined, locale: Locale, fallbackKey: string): string => cleanText(label?.[locale] ?? label?.en ?? fallbackKey.replace(/_/g, " "));

function visibilityOf(manifest: CategoryManifestDoc, fieldKey: string): "confidential" | "context_only" | undefined {
  const rules = manifest.visibility_rules as Array<{ field_key: string; mode: string }>;
  const mode = rules.find((r) => r.field_key === fieldKey)?.mode;
  return mode === "CONFIDENTIAL_ELIGIBLE" ? "confidential" : mode === "CONTEXT_ONLY_FOR_PROVIDER" ? "context_only" : undefined;
}

function renderItemLine(group: FieldDefinition, item: Record<string, unknown> | null, locale: Locale): string {
  const parts: string[] = [];
  for (const sub of group.group_item_schema ?? []) {
    const fact = itemFact(item ? item[sub.field_key] : undefined);
    if (fact.answerState === "NOT_ASKED" || fact.answerState === "UNKNOWN" || fact.answerState === "WITHHELD") continue;
    const text = renderFieldValue(sub, fact.value, locale, `${group.field_key}.${sub.field_key}`);
    if (text) parts.push(`${labelOf(sub.label, locale, sub.field_key)}: ${text}`);
  }
  return parts.join(" · ");
}

function missingLines(group: FieldDefinition, subs: SubFieldStatus[], locale: Locale): string[] {
  const out: string[] = [];
  for (const s of subs) {
    if (s.state !== "pending" && s.state !== "missing") continue;
    const sub = (group.group_item_schema ?? []).find((x) => x.field_key === s.sub);
    out.push(`${COPY.entry[locale]} ${s.item + 1}: ${labelOf(sub?.label, locale, s.sub)}`);
  }
  return out;
}

function requirementContent(manifest: CategoryManifestDoc, d: RequirementDetail, facts: FactMap, locale: Locale): CrpRequirementContent {
  const f = d.field;
  const fact: FactView | undefined = facts[f.field_key];
  const base: CrpRequirementContent = {
    id: f.field_key,
    label: labelOf(f.label, locale, f.field_key),
    value: null,
    state: d.state,
    executionDependency: d.executionDependency,
  };
  const vis = visibilityOf(manifest, f.field_key);
  if (vis) base.visibility = vis;
  if (!d.applicable) return base;
  if (f.type === "repeatable_group" && d.group) {
    const items = Array.isArray(fact?.value) ? (fact?.value as Array<Record<string, unknown> | null>) : [];
    const entries = items.map((it) => renderItemLine(f, it, locale)).filter(Boolean);
    if (entries.length) {
      base.entries = entries;
      base.value = entries.join("\n");
    }
    const missing = missingLines(f, d.group.subs, locale);
    if (missing.length) base.missing = missing;
    // The Execution Dependency mark also follows a pending sub-field that carries it.
    if (d.group.subs.some((s) => (s.state === "pending" || s.state === "missing") && s.executionDependency)) base.executionDependency = true;
    return base;
  }
  const st = fact?.answerState;
  if (st === "ANSWERED" || st === "EXPLICIT_NO" || st === "ZERO" || st === "ASSUMED") base.value = renderFieldValue(f, fact?.value, locale);
  return base;
}

/** Builds the `crp.v1` content for one category. */
export function buildCrpContent(input: CrpBuildInput, precomputed?: DetailedEvaluation): CrpV1Content {
  const { manifest, locale } = input;
  const ev = precomputed ?? evaluateCategoryDetailed({ manifest, facts: input.facts, countries: input.countries });
  const info = categoryInfo(input.categoryKey);
  const label = input.categoryLabel ? cleanText(input.categoryLabel) : info.label[locale];

  // Which requirements are shown, in manifest order.
  const shown: RequirementDetail[] = [];
  for (const f of ev.fields) {
    const d = ev.details[f.field_key];
    if (!d) continue;
    const required = REQUIRED_LEVELS.has(d.level);
    if (!d.applicable) {
      if (input.notApplicable === "include" && required) shown.push(d);
      continue;
    }
    if (required) {
      shown.push(d);
      continue;
    }
    // supporting / informational: shown only when the client gave a value
    const content = requirementContent(manifest, d, input.facts, locale);
    if ((d.state === "confirmed" || d.state === "assumed") && (content.value !== null || (content.entries?.length ?? 0) > 0)) shown.push(d);
  }

  // Sections: manifest-declared section/theme when present, else chunks of consecutive requirements.
  const chunk = Math.max(1, input.chunkSize ?? DEFAULT_CHUNK);
  interface Bucket { title: string | null; items: CrpRequirementContent[] }
  const buckets: Bucket[] = [];
  let run: Bucket | null = null;
  for (const d of shown) {
    const title = sectionLabelOf(d.field, locale);
    const item = requirementContent(manifest, d, input.facts, locale);
    if (title !== null) {
      if (!run || run.title !== title) {
        run = { title, items: [] };
        buckets.push(run);
      }
      run.items.push(item);
    } else {
      if (!run || run.title !== null || run.items.length >= chunk) {
        run = { title: null, items: [] };
        buckets.push(run);
      }
      run.items.push(item);
    }
  }
  const untitled = buckets.filter((b) => b.title === null).length;
  let n = 0;
  const sections: CrpSectionContent[] = buckets.map((b, i) => {
    if (b.title === null) n += 1;
    const title = b.title ?? (untitled === 1 && buckets.length === 1 ? COPY.single[locale] : `${COPY.partN[locale]} ${n}`);
    return { id: `section-${i + 1}`, title, items: b.items };
  });

  const pending = ev.evaluation.pending.map((r) => requirementContent(manifest, ev.details[r.fieldKey] as RequirementDetail, input.facts, locale));

  const context: string[] = [];
  if (input.countries.length) context.push(`${COPY.destination[locale]}: ${joinList(input.countries.map((c) => countryName(c, locale)), locale)}`);
  for (const line of input.contextLines ?? []) {
    const t = cleanText(line);
    if (t) context.push(t);
  }

  const requiredLater = ev.operationalPending.map((p) => labelOf(p.label, locale, p.pending_item_key));

  return {
    schema: "crp.v1",
    categoryKey: input.categoryKey,
    crpKind: (isNewCategoryKey(input.categoryKey) ? "new_category_discovery" : manifest.crp_kind) as CrpKind,
    locale,
    title: `${label} — ${COPY.titleSuffix[locale]}`,
    context,
    sections,
    pending,
    requiredLater,
    versions: { manifest: input.versions?.manifest ?? null, catalog: input.versions?.catalog ?? null, crosswalk: input.versions?.crosswalk ?? null, contract: input.versions?.contract ?? null },
  };
}
