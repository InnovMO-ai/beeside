import type { NeedsMapDependency } from "./needs-map-types";

/**
 * Extracted verbatim from `backend/src/snapshot/compose.ts` (Macroblock 7, Snapshot Runtime
 * Convergence) so a second consumer — `execution-demand.ts`'s Activation Planning Execution Demand
 * formula — can reuse the exact same dependency-depth computation `compose.ts` already used for the
 * Pathway diagram, instead of re-deriving it. Pure move, no behavior change: `compose.ts` now imports
 * `PathwayStage`, `PATHWAY_STAGES` and `pathwayDepths` from here rather than declaring them locally.
 *
 * One of the four PathwayDiagram stages (§3.4). Not a rigid methodology — a deterministic bucket by
 * dependency depth over the client's own declared `fa.needs.map` dependency graph: items with no
 * unresolved prerequisite are NOW, one prerequisite deep is DEFINE, two is ENABLE, three or more (or
 * a cyclical/unresolvable chain) is LAUNCH. Items sharing a stage are parallel paths, not a forced
 * serial sequence.
 */
export type PathwayStage = "now" | "define" | "enable" | "launch";

export const PATHWAY_STAGES: readonly PathwayStage[] = ["now", "define", "enable", "launch"];

/**
 * Dependency depth over the client's own declared graph, scoped to `priorityRank` (dependencies on
 * an item outside the prioritized set — already excluded by the Needs Explorer's own guided flow —
 * are treated as "no prerequisite", i.e. depth 0). A cycle (should not occur given the guided UI, but
 * defended against here since this must stay a pure, always-terminating function) parks every member
 * of the cycle at the deepest stage rather than looping forever.
 */
export function pathwayDepths(priorityRank: readonly string[], dependencies: readonly NeedsMapDependency[]): Map<string, number> {
  const dependsOn = new Map(dependencies.map((d) => [d.key, d.dependsOn]));
  const ranked = new Set(priorityRank);
  const depth = new Map<string, number>();
  const inProgress = new Set<string>();
  const maxDepth = PATHWAY_STAGES.length - 1;

  function depthOf(key: string): number {
    const cached = depth.get(key);
    if (cached !== undefined) return cached;
    if (inProgress.has(key)) return maxDepth; // cycle: unresolved chain lands in the last stage
    inProgress.add(key);
    const parent = dependsOn.get(key) ?? null;
    const resolved = parent && ranked.has(parent) && parent !== key ? Math.min(depthOf(parent) + 1, maxDepth) : 0;
    inProgress.delete(key);
    depth.set(key, resolved);
    return resolved;
  }

  for (const key of priorityRank) depthOf(key);
  return depth;
}
