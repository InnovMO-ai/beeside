/**
 * Macroblock 4 — Country overlay deactivation mechanism (§15 of precision-block2-macroblock2-
 * canonical-data-model-manifest-architecture-2026-10-02.md): the pure `effective_fields()`
 * function, computed at read time, never materialized or stored. Operates purely on the two
 * immutable inputs §15 names — a published category_manifest_version's `content` and a country
 * code — so it is deterministic and reproducible by construction, exactly as required for
 * pack.context_snapshot (§10) to stay reconstructable.
 *
 * NOT VERIFIED BY THE TOOLCHAIN in this pass — see repository.ts's header note.
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
  const overlay = country ? content.country_overlays[country] : undefined;
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
