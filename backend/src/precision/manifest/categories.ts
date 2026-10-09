/**
 * Customer-facing category names and one-line descriptions (EN/ES), from data/category-labels.json.
 * The wording is neutral and drafted for the release candidate; approved Spanish labels are a content
 * dependency (Build Readiness K-3 / N-13) — change the JSON, not the callers.
 */
import labelsJson from "./data/category-labels.json";
import type { Locale } from "./value-render";

export type CategoryKind = "category" | "strategic_advisory" | "ecosystem_development" | "to_review";

export interface CategoryInfo {
  categoryKey: string;
  order: number;
  kind: CategoryKind;
  /** Icon key for the client icon set (= the category key for the 17 catalog categories). */
  iconKey: string;
  label: Record<Locale, string>;
  description: Record<Locale, string>;
}

interface LabelsFile {
  categories: Record<string, { order: number; kind: string; iconKey: string; label: Record<Locale, string>; description: Record<Locale, string> }>;
}
const FILE = labelsJson as unknown as LabelsFile;

const TO_REVIEW = "to_review";

/** Instance keys: `new:<slug>` is a possible new service held for review; it is never shown with its slug. */
export function isNewCategoryKey(categoryKey: string): boolean {
  return categoryKey.startsWith("new:");
}

/** Category keys of the catalog + reserved categories, in display order (no `to_review`). */
export function listCategoryKeys(): string[] {
  return Object.entries(FILE.categories)
    .filter(([k]) => k !== TO_REVIEW)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([k]) => k);
}

function kindOf(raw: string): CategoryKind {
  return raw === "reserved_platform" ? "category" : raw === "catalog" ? "category" : (raw as CategoryKind);
}

/** Display info for any instance key: a catalog category, SA/ED, or `new:<slug>` (shown as "under review"). */
export function categoryInfo(categoryKey: string): CategoryInfo {
  const key = isNewCategoryKey(categoryKey) ? TO_REVIEW : categoryKey;
  const raw = FILE.categories[key] ?? FILE.categories[TO_REVIEW];
  if (!raw) throw new Error("category labels file is missing the to_review entry");
  const kind: CategoryKind = key === "strategic_advisory" ? "strategic_advisory" : key === "ecosystem_development" ? "ecosystem_development" : key === TO_REVIEW || !FILE.categories[key] ? "to_review" : kindOf(raw.kind);
  return { categoryKey, order: raw.order, kind, iconKey: raw.iconKey, label: raw.label, description: raw.description };
}

export function categoryLabel(categoryKey: string, locale: Locale): string {
  return categoryInfo(categoryKey).label[locale];
}
