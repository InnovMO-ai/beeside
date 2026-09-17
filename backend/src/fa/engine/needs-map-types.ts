/**
 * The `fa.needs.map` answer value shape (dataType `needs_map`, composition 5 "Needs Landscape").
 *
 * One field captures the whole Needs Explorer / PriorityRanker / DependencyMap flow as a single
 * cohesive fact, exactly as the Design Specification describes it: "the user never leaves 'Needs
 * Landscape' to prioritize what they just mapped." Category selection and status are two
 * independent facts, never conflated (governing principle, Needs Explorer section): selecting a
 * capability is not a purchase signal, and the five-state status alone carries coverage meaning.
 *
 * Client priority (declared order) and dependency-derived order are also always kept as two
 * separate facts (Ranking & Dependency Interaction section) — `priorityRank` is never reordered by
 * `dependencies`, and vice versa; the frontend renders both and a neutral note when they disagree.
 */

/** The five states from the Needs Explorer section; a customer-facing status, not a purchase signal. */
export const NEEDS_MAP_STATUSES = [
  "covered_internally",
  "covered_by_provider",
  "in_progress",
  "needs_resolution",
  "needs_confirmation",
] as const;
export type NeedsMapStatus = (typeof NEEDS_MAP_STATUSES)[number];

export interface NeedsMapSelection {
  /** A leaf key from needs-explorer-taxonomy.ts (NEEDS_EXPLORER_LEAF_KEYS). */
  key: string;
  status: NeedsMapStatus;
}

export interface NeedsMapDependency {
  /** Must be a key present in `priorityRank` — dependencies are only built on prioritized items. */
  key: string;
  /** Another prioritized key this one depends on first, or null ("doesn't depend on anything else"). */
  dependsOn: string | null;
  owner: string | null;
  approvalRequired: boolean;
  approvalFrom: string | null;
}

export interface NeedsMapValue {
  selections: NeedsMapSelection[];
  /** Client-declared top-N order (up to 5) over a subset of `selections[].key`. Position 0 is the
   *  "Immediate Priority". Never silently reordered to match `dependencies`. */
  priorityRank: string[];
  /** Guided dependency flow over `priorityRank` items only. */
  dependencies: NeedsMapDependency[];
  /** Priority items the respondent explicitly flagged as blockers (subset of `priorityRank`). */
  blockerKeys: string[];
}

export const NEEDS_MAP_LIMITS = {
  maxSelections: 20,
  maxPriorityRank: 5,
  maxFreeTextLength: 200,
} as const;
