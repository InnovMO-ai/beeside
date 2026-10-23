/**
 * My Service Map content — `psm.v1` (Track A contract §2):
 *   { schema:"psm.v1", project:{ objective, destinations[], timeWindow, productOrService, operatingEntity },
 *     groups:[{ categoryKey, label, kind, items:[{ id, label, why, priority, timing, state }] }],
 *     openItems:[string], contextPinId, versions:{ catalog, crosswalk, contract, manifests:{[categoryKey]:version} } }
 *
 * Pure builder: the DOMAIN service supplies the facts (already-localized need labels, client priorities, states) and,
 * optionally, each category's evaluation; this module owns grouping, ordering (deterministic) and rendering of
 * categories and countries. Version numbers are stored, never shown.
 */
import { categoryInfo, isNewCategoryKey, type CategoryKind } from "./categories";
import type { CategoryEvaluation, RequirementState } from "./types";
import { cleanText, countryName, type Locale } from "./value-render";

export type PsmItemState = RequirementState;
export type PsmPriority = "high" | "medium" | "low";

export interface ServiceMapNeed {
  id: string;
  label: string;
  why?: string | null;
  priority?: PsmPriority | null;
  timing?: string | null;
  state?: PsmItemState;
}
export interface ServiceMapCategoryInput {
  /** Instance key: a catalog category, strategic_advisory, ecosystem_development, or `new:<slug>`. */
  categoryKey: string;
  needs: ServiceMapNeed[];
  /** Localized label when the caller has one (otherwise the label file). */
  label?: string;
}
export interface ServiceMapProjectInput {
  objective?: string | null;
  /** ISO-3166-1 alpha-2 codes. */
  destinations: string[];
  timeWindow?: string | null;
  productOrService?: string | null;
  operatingEntity?: string | null;
}
export interface PsmVersions {
  catalog: string | null;
  crosswalk: string | null;
  contract: string | null;
  manifests: Record<string, string>;
}
/** What Precision understood about the project, in client language (built from the Understanding frame; optional). */
export interface PsmUnderstanding {
  context: string[];
  facts: { label: string; value: string }[];
  pending: string[];
  findings: { title: string; detail: string; specialty: string | null }[];
}
export interface ServiceMapBuildInput {
  understanding?: PsmUnderstanding | null;
  project: ServiceMapProjectInput;
  categories: ServiceMapCategoryInput[];
  locale: Locale;
  openItems?: string[];
  contextPinId?: string | null;
  versions?: Partial<PsmVersions>;
}
export interface PsmItem { id: string; label: string; why: string | null; priority: PsmPriority | null; timing: string | null; state: PsmItemState }
export interface PsmGroup { categoryKey: string; label: string; kind: CategoryKind; items: PsmItem[] }
export interface PsmV1Content {
  schema: "psm.v1";
  project: { objective: string | null; destinations: string[]; timeWindow: string | null; productOrService: string | null; operatingEntity: string | null };
  groups: PsmGroup[];
  openItems: string[];
  contextPinId: string | null;
  versions: PsmVersions;
  /** Present only when the project was understood by the Understanding engine. */
  understanding?: PsmUnderstanding;
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const textOrNull = (v: string | null | undefined): string | null => {
  const t = typeof v === "string" ? cleanText(v) : "";
  return t || null;
};

/** Builds the `psm.v1` content. Group order: catalog order, Strategic Advisory, Ecosystem Development, then "under review". */
export function buildServiceMapContent(input: ServiceMapBuildInput): PsmV1Content {
  const { locale } = input;
  const groups: PsmGroup[] = [];
  const byKey = new Map<string, PsmGroup>();
  for (const c of input.categories) {
    const info = categoryInfo(c.categoryKey);
    // every `new:<slug>` possible-new-service instance is held together under one neutral group
    const gk = isNewCategoryKey(c.categoryKey) ? "new:review" : c.categoryKey;
    let g = byKey.get(gk);
    if (!g) {
      g = { categoryKey: gk, label: c.label && !isNewCategoryKey(c.categoryKey) ? cleanText(c.label) : info.label[locale], kind: info.kind, items: [] };
      byKey.set(gk, g);
      groups.push(g);
    }
    for (const n of c.needs) {
      g.items.push({
        id: n.id,
        label: cleanText(n.label),
        why: textOrNull(n.why),
        priority: n.priority ?? null,
        timing: textOrNull(n.timing),
        state: n.state ?? "pending",
      });
    }
  }
  const rank = (g: PsmGroup): number => {
    const info = categoryInfo(g.categoryKey);
    return g.kind === "to_review" ? 1000 : info.order;
  };
  groups.sort((a, b) => rank(a) - rank(b) || a.categoryKey.localeCompare(b.categoryKey));
  for (const g of groups) {
    const seen = new Set<string>();
    g.items = g.items
      .filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
      .sort((a, b) => (a.priority ? PRIORITY_RANK[a.priority] ?? 3 : 3) - (b.priority ? PRIORITY_RANK[b.priority] ?? 3 : 3) || a.label.localeCompare(b.label, locale) || a.id.localeCompare(b.id));
  }
  const destinations = [...new Set(input.project.destinations.map((c) => c.trim().toUpperCase()).filter(Boolean))].map((c) => countryName(c, locale));
  const open: string[] = [];
  for (const o of input.openItems ?? []) {
    const t = cleanText(o);
    if (t && !open.includes(t)) open.push(t);
  }
  const u = input.understanding;
  const hasU = Boolean(u && (u.context.length || u.facts.length || u.pending.length || u.findings.length));
  return {
    schema: "psm.v1",
    project: {
      objective: textOrNull(input.project.objective),
      destinations,
      timeWindow: textOrNull(input.project.timeWindow),
      productOrService: textOrNull(input.project.productOrService),
      operatingEntity: textOrNull(input.project.operatingEntity),
    },
    groups,
    openItems: open,
    contextPinId: input.contextPinId ?? null,
    versions: {
      catalog: input.versions?.catalog ?? null,
      crosswalk: input.versions?.crosswalk ?? null,
      contract: input.versions?.contract ?? null,
      manifests: Object.fromEntries(Object.entries(input.versions?.manifests ?? {}).sort(([a], [b]) => a.localeCompare(b))),
    },
    ...(hasU && u ? { understanding: u } : {}),
  };
}

const OPEN_COPY = {
  critical: { en: "critical information pending", es: "información crítica pendiente" },
  pending: { en: "pending information", es: "información pendiente" },
} as const;

/**
 * Open lines for the map from category evaluations: one line per category with critical items open, then one per
 * category with other pending information. Sorted by category display order, so the result is deterministic.
 */
export function openItemsFromEvaluations(locale: Locale, rows: Array<{ categoryKey: string; label?: string; evaluation: CategoryEvaluation }>): string[] {
  const sorted = [...rows].sort((a, b) => categoryInfo(a.categoryKey).order - categoryInfo(b.categoryKey).order || a.categoryKey.localeCompare(b.categoryKey));
  const name = (r: { categoryKey: string; label?: string }): string => (r.label && !isNewCategoryKey(r.categoryKey) ? cleanText(r.label) : categoryInfo(r.categoryKey).label[locale]);
  const out: string[] = [];
  for (const r of sorted) if (r.evaluation.critical.length > 0) out.push(`${name(r)}: ${OPEN_COPY.critical[locale]}`);
  for (const r of sorted) if (r.evaluation.critical.length === 0 && r.evaluation.pending.length > 0) out.push(`${name(r)}: ${OPEN_COPY.pending[locale]}`);
  return out;
}
