/**
 * Macroblock 4 — Country overlay deactivation mechanism (§15 of precision-block2-macroblock2-
 * canonical-data-model-manifest-architecture-2026-10-02.md): the pure `effective_fields()`
 * function, computed at read time, never materialized or stored. Operates purely on the two
 * immutable inputs §15 names — a published category_manifest_version's `content` and a country
 * code — so it is deterministic and reproducible by construction, exactly as required for
 * pack.context_snapshot (§10) to stay reconstructable.
 *
 * F5 (Track A): moved from precision/manifest.ts to precision/manifest/effective-fields.ts (the file and the
 * directory could not share the name `manifest`). `../manifest` keeps resolving through manifest/index.ts.
 * Added here: `effectiveFieldsMulti` (D1 multi-country union) and `normalizeCountries`.
 */

export interface FieldDefinition {
  field_key: string;
  type: string;
  label: Record<string, string>;
  requirement_level: "blocking" | "required" | "conditional" | "supporting" | "informational";
  applicability_rule?: unknown;
  evidence_expected?: boolean;
  normalization_hint?: unknown;
  help_text?: Record<string, string> | null;
  // Set only when type === 'repeatable_group' (§13A).
  group_item_schema?: FieldDefinition[] | null;
  // Authored extras the engine reads when present (all optional; unknown keys are tolerated by design).
  values?: string[];
  unit_values?: string[];
  min_items?: number;
  execution_dependency?: boolean;
  derived?: boolean;
  change_policy?: "any" | "threshold" | "operational";
  change_threshold?: { relative_pct?: number; period_shift_months?: number; [k: string]: unknown };
  [extra: string]: unknown;
}

export interface CountryOverlay {
  add?: FieldDefinition[];
  modify?: Array<{ field_key: string; patch: Partial<FieldDefinition> }>;
  deactivate?: string[];
}

export interface CategoryManifestContent {
  fields: FieldDefinition[];
  critical_decisions: unknown[];
  country_overlays: Record<string, CountryOverlay>;
  operational_pending_items: unknown[];
  visibility_rules: unknown[];
}

/**
 * effective_fields(category_key, manifest_version, country) — §15's formula, literally:
 *   base_fields(manifest_version) - deactivated_by(...) ∪ added_by(...) ⊕ modified_by(...)
 *
 * `content` is one already-resolved (category_key, version) row's JSONB content — the caller is
 * responsible for pinning/fetching the right manifest_version first (§19); this function has no
 * DB access and makes no currency decision itself, which is exactly what keeps it reproducible:
 * calling it twice with the same two inputs always yields the same effective manifest (§15).
 */
export function effectiveFields(content: CategoryManifestContent, country: string | null): FieldDefinition[] {
  const overlay = country ? content.country_overlays?.[country] : undefined;
  if (!overlay) return content.fields;

  const deactivated = new Set(overlay.deactivate ?? []);
  const base = content.fields.filter((f) => !deactivated.has(f.field_key));

  const modifications = new Map((overlay.modify ?? []).map((m) => [m.field_key, m.patch]));
  const patched = base.map((f) => {
    const patch = modifications.get(f.field_key);
    return patch ? { ...f, ...patch } : f;
  });

  const added = (overlay.add ?? []).filter((f) => !deactivated.has(f.field_key));
  return [...patched, ...added];
}

/**
 * Hygiene item A (Macroblock 4 brief §4A): a base field that is only ever *referenced* by an
 * overlay's `deactivate` list, and never itself listed in `fields[]`, is a content-authoring gap
 * — deactivating it is a silent no-op (there was nothing active to deactivate), which is exactly
 * the kind of mislabeling bug §15/§16 warn about for a different reason. This validator catches
 * that specific gap at publish time, across every overlay the manifest declares.
 */
export function findOverlayFieldKeysMissingFromBase(content: CategoryManifestContent): string[] {
  const baseKeys = new Set(content.fields.map((f) => f.field_key));
  const missing = new Set<string>();
  for (const overlay of Object.values(content.country_overlays)) {
    for (const key of overlay.deactivate ?? []) {
      if (!baseKeys.has(key)) missing.add(key);
    }
    for (const mod of overlay.modify ?? []) {
      if (!baseKeys.has(mod.field_key)) missing.add(mod.field_key);
    }
  }
  return Array.from(missing);
}

const LEVEL_ORDER: ReadonlyArray<FieldDefinition["requirement_level"]> = ["blocking", "required", "conditional", "supporting", "informational"];

/** Upper-cases, trims, drops empties and duplicates (first occurrence wins) — deterministic scope key for overlays. */
export function normalizeCountries(countries: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of countries ?? []) {
    const c = typeof raw === "string" ? raw.trim().toUpperCase() : "";
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/**
 * Multi-country scope (D1). Single country (or none) is EXACTLY `effectiveFields` (equivalence is tested).
 * For several countries: a base field survives when at least one scoped country keeps it active (a deactivation
 * is effective only when every scoped country deactivates it); when several variants of a field survive the
 * strictest requirement_level wins; fields added by an overlay are appended once, marked with the countries
 * whose overlay adds them (`applies_to_countries`).
 */
export function effectiveFieldsMulti(content: CategoryManifestContent, countries: readonly string[] | null | undefined): FieldDefinition[] {
  const list = normalizeCountries(countries);
  if (list.length === 0) return effectiveFields(content, null);
  const only = list[0];
  if (list.length === 1 && only !== undefined) return effectiveFields(content, only);
  const per = list.map((c) => effectiveFields(content, c));
  const out: FieldDefinition[] = [];
  const seen = new Set<string>();
  for (const base of content.fields) {
    const variants = per.map((p) => p.find((f) => f.field_key === base.field_key)).filter((f): f is FieldDefinition => f !== undefined);
    const first = variants[0];
    if (first === undefined) continue;
    const strictest = variants.reduce((a, b) => (LEVEL_ORDER.indexOf(b.requirement_level) < LEVEL_ORDER.indexOf(a.requirement_level) ? b : a), first);
    out.push(strictest);
    seen.add(base.field_key);
  }
  for (const fields of per) {
    for (const f of fields) {
      if (seen.has(f.field_key)) continue;
      const applied = list.filter((_, i) => per[i]?.some((x) => x.field_key === f.field_key));
      out.push({ ...f, applies_to_countries: applied });
      seen.add(f.field_key);
    }
  }
  return out;
}
