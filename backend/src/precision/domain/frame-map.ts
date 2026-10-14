/**
 * Frame -> My Service Map. The Understanding frame is where the client's needs, their priorities and their reasons live; this
 * module turns them into the proposed Service Map (categories + needs) WITHOUT inventing anything:
 *
 *  - NEED FIRST: a need keeps the client's own words as its label. The catalog only decides where it is grouped.
 *  - a need the concepts place in a catalog category goes there ("Marketing" -> marketing_communications), whatever the depth of
 *    the authored manifest (a category without an authored manifest is backed by the generic one);
 *  - a legitimate need the catalog cannot place stays in the client's words under a possible new service (`new:<slug>`), held
 *    for beeside review; an ambiguous one waits for the one clarifying question; an outcome ("crecer") is a finding, not a service;
 *  - priority is the CLIENT's (their ranking in the conversation, or the one Discovery captured), never the catalog's or the AI's;
 *  - removed needs are tombstoned so neither the frame nor the First Assessment proposal brings them back;
 *  - idempotent: running it twice on the same frame writes nothing.
 */
import type { Db } from "../../db/database";
import { listCategoryKeys, normalizeSlug } from "../manifest";
import { conceptById } from "../understanding/concepts";
import { createPgFrameStore } from "../understanding/pg-store";
import type { Frame, Loc, NeedItem } from "../understanding/types";
import { ensureCategoryInstance, loadMapNeeds, replaceMapNeeds, type MapNeed } from "./categories";
import { listCategoryRefs } from "./category-ref";
import type { PrecisionDomainDeps } from "./deps";
import { lockProjectMap } from "./facts";
import { syncProjectInheritance } from "./category-inheritance";
import { loadPaState } from "./project-state";

type MapDeps = Pick<PrecisionDomainDeps, "db" | "registry">;

const CATALOG_KEYS = new Set(listCategoryKeys());
const RANK_PRIORITY = { top: "high", important: "medium", can_wait: "low" } as const;

/** The map-need id: Discovery's needs keep `fa:<capabilityId>` (the First Assessment proposal's id) so they are never duplicated. */
export function mapNeedId(n: NeedItem): string {
  return n.id.startsWith("n:disc:") ? `fa:${n.id.slice("n:disc:".length)}` : `fr:${n.id}`;
}

export interface PlannedNeed { categoryKey: string; need: MapNeed }
export interface FrameMapPlan {
  /** Active needs by the category they belong to. */
  needs: PlannedNeed[];
  /** Map-need ids the client removed. */
  removed: string[];
  /** Needs held back: they wait for a clarification or are outcomes (not services). Never silently dropped. */
  held: { id: string; reason: "ambiguous" | "outcome" | "compound" | "unplaced" }[];
}

/**
 * The line the client reads on their map. A need recognised from a long narrative keeps its quote in the frame, but the map shows
 * the clean name of the need ("Constitución de la entidad local"), never a slice of their paragraph. What Discovery captured, and
 * what the client typed as a short phrase, are already clean and stay in their words.
 */
export function labelOf(n: NeedItem, loc: Loc): string {
  const def = n.conceptIds[0] ? conceptById(n.conceptIds[0]) : undefined;
  const short = n.text.length <= 60 && !/[.;]/.test(n.text);
  if (def && n.origin !== "discovery" && !short) return def.label[loc];
  if (def && n.origin !== "discovery" && short && n.conceptIds.length === 1 && n.text.toLowerCase() === def.label[loc].toLowerCase()) return def.label[loc];
  return short ? n.text : cleanFragment(n.text);
}
const cleanFragment = (t: string): string => {
  const first = t.split(/[.;]/)[0] ?? t;
  const words = first.trim().split(/\s+/).slice(0, 12).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Pure: what the Service Map should carry from this frame. */
export function planFrameMap(frame: Frame): FrameMapPlan {
  const plan: FrameMapPlan = { needs: [], removed: [], held: [] };
  const groups = frame.priority.status === "client_set" ? frame.priority.groups : [];

  for (const n of frame.needs) {
    const id = mapNeedId(n);
    if (n.status === "removed") {
      plan.removed.push(id);
      continue;
    }
    let categoryKey: string | null = n.categoryKey && CATALOG_KEYS.has(n.categoryKey) ? n.categoryKey : null;
    if (!categoryKey) {
      if (n.resolution === "unresolved") categoryKey = `new:${normalizeSlug(n.text) || "necesidad"}`;
      else if (n.id.startsWith("n:disc:")) { plan.held.push({ id, reason: "unplaced" }); continue; } // the First Assessment proposal places it
      else { plan.held.push({ id, reason: n.resolution === "ambiguous" ? "ambiguous" : n.resolution === "outcome" ? "outcome" : n.resolution === "compound" ? "compound" : "unplaced" }); continue; }
    }

    const subjects = new Set([n.id, ...n.conceptIds]);
    const group = groups.find((g) => g.subjects.some((s) => subjects.has(s)));
    const rationale = frame.rationale.find((r) => subjects.has(r.subject));
    const why = n.why ?? group?.reason ?? rationale?.text ?? null;
    const need: MapNeed = { id, label: labelOf(n, frame.locale), priority: group ? RANK_PRIORITY[group.rank] : null, source: n.origin === "added" ? "client" : "fa" };
    if (why) need.why = why;
    if (group?.timing) need.timing = group.timing;
    plan.needs.push({ categoryKey, need });
  }
  return plan;
}

function mergeNeed(current: MapNeed, next: MapNeed): MapNeed {
  // a priority the frame does not know (the First Assessment's) is kept; the frame's own (the client's words) wins when present
  const out: MapNeed = { ...current, label: next.label, source: current.source };
  if (next.priority) out.priority = next.priority;
  if (next.why) out.why = next.why;
  if (next.timing) out.timing = next.timing;
  delete out.removed;
  return out;
}

/** Pure: the category's needs after the frame is applied. */
export function reconcileList(current: readonly MapNeed[], wanted: readonly MapNeed[], removed: readonly string[], elsewhere: ReadonlySet<string> = new Set()): MapNeed[] {
  const want = new Map(wanted.map((n) => [n.id, n]));
  const next: MapNeed[] = [];
  for (const c of current) {
    const w = want.get(c.id);
    if (w) { next.push(mergeNeed(c, w)); want.delete(c.id); continue; }
    if (removed.includes(c.id)) { next.push({ ...c, removed: true }); continue; }
    if (elsewhere.has(c.id)) continue; // the frame placed it in another category
    if (c.id.startsWith("fr:")) continue; // frame-derived and no longer placed here (the need moved or was reworded)
    next.push(c);
  }
  for (const w of want.values()) next.push(w);
  return next;
}

/**
 * Reconciles the project's categories with the frame. Before the Service Map is confirmed, categories are proposals; after it,
 * new categories are created already confirmed (the client re-confirms the new version). Returns true when anything changed.
 */
export async function syncFrameMap(deps: MapDeps, projectId: string, frame: Frame, opts: { allowConfirmed?: boolean } = {}): Promise<boolean> {
  const pa = await loadPaState(deps.db, projectId);
  if (!pa) return false;
  if (pa.status === "confirmed" && !opts.allowConfirmed) return false;
  const plan = planFrameMap(frame);
  const wanted = new Map<string, MapNeed[]>();
  for (const p of plan.needs) wanted.set(p.categoryKey, [...(wanted.get(p.categoryKey) ?? []), p.need]);

  const elsewhereOf = (key: string): Set<string> => new Set(plan.needs.filter((p) => p.categoryKey !== key).map((p) => p.need.id));

  // cheap pre-check outside the transaction: nothing to do when the map already says the same
  const refs = await listCategoryRefs(deps.db, projectId);
  const have = await loadMapNeeds(deps.db, refs.map((r) => r.instanceId), true);
  const clean = [...wanted.keys()].every((k) => refs.some((r) => r.categoryKey === k)) &&
    refs.every((r) => {
      const cur = have.get(r.instanceId) ?? [];
      return JSON.stringify(reconcileList(cur, wanted.get(r.categoryKey) ?? [], plan.removed, elsewhereOf(r.categoryKey))) === JSON.stringify(cur);
    });
  if (clean) return false;

  let changed = false;
  await deps.db.transaction(async (tx) => {
    await lockProjectMap(tx, projectId);
    const cur = await loadPaState(tx, projectId);
    if (!cur || (cur.status === "confirmed" && !opts.allowConfirmed)) return;
    const target = cur.status === "confirmed" ? "confirmed" : "proposed";
    for (const key of wanted.keys()) await ensureCategoryInstance(deps, tx, projectId, key, "pa_detected", target);
    const inside = await listCategoryRefs(tx, projectId);
    const needsBy = await loadMapNeeds(tx, inside.map((r) => r.instanceId), true);
    for (const ref of inside) {
      const next = reconcileList(needsBy.get(ref.instanceId) ?? [], wanted.get(ref.categoryKey) ?? [], plan.removed, elsewhereOf(ref.categoryKey));
      changed = (await replaceMapNeeds(tx, projectId, ref.instanceId, next)) || changed;
    }
  });
  return changed;
}

/**
 * First Assessment needs the frame already owns (placed by the conversation or removed by the client): the First Assessment
 * proposal must neither duplicate nor bring them back. Needs the frame holds without a placement stay with the proposal.
 */
export async function frameOwnedFaNeedIds(db: Pick<Db, "query">, projectId: string): Promise<Set<string>> {
  const stored = await createPgFrameStore(db as Db).load(projectId);
  if (!stored) return new Set();
  const plan = planFrameMap(stored.frame);
  return new Set([...plan.needs.map((p) => p.need.id), ...plan.removed].filter((id) => id.startsWith("fa:")));
}

/** Loads the project's frame (if any) and syncs the map. No frame (legacy engine) -> nothing to do. */
export async function syncFrameMapForProject(deps: MapDeps, projectId: string, opts: { allowConfirmed?: boolean } = {}): Promise<boolean> {
  const stored = await createPgFrameStore(deps.db).load(projectId);
  if (!stored) return false;
  const changed = await syncFrameMap(deps, projectId, stored.frame, opts);
  await syncProjectInheritance(deps, projectId);
  return changed;
}

export { conceptById };
