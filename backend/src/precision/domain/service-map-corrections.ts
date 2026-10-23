/**
 * Corrections of My Service Map by the client: remove a need, reword it ("that is not what I meant"), set THEIR priority, move it
 * to another group, give the reason. The client's decision is applied as stated.
 *
 *  - A need the Understanding conversation produced (or Discovery seeded) is corrected in the FRAME, the source of truth, and the
 *    map is re-derived from it (so the correction survives every later sync).
 *  - A need with no frame behind it (added later with "Add a service", or a project on the generic engine) is corrected on the map.
 *  - Idempotent by `requestKey`; nothing is sent anywhere and no workstream starts: confirming the map stays the client's act.
 */
import type { Db } from "../../db/database";
import type { Locale } from "../api/dto";
import { ApiError } from "../api/errors";
import { cleanText, listCategoryKeys } from "../manifest";
import { editFrame, type FrameEdit } from "../understanding/edit";
import { createPgFrameStore } from "../understanding/pg-store";
import { FrameConflictError } from "../understanding/store";
import type { PriorityRank } from "../understanding/types";
import { ensureCategoryInstance, loadMapNeeds, replaceMapNeeds, type MapNeed } from "./categories";
import { listCategoryRefs } from "./category-ref";
import type { PrecisionDomainDeps } from "./deps";
import { lockProjectMap } from "./facts";
import { syncProjectInheritance } from "./category-inheritance";
import { syncFrameMap } from "./frame-map";
import { opaqueGroupId, opaqueId } from "./opaque";
import { loadPaState } from "./project-state";

type Deps = Pick<PrecisionDomainDeps, "db" | "registry">;

export type CorrectionRequest =
  | { requestKey: string; op: "remove"; itemId: string }
  | { requestKey: string; op: "rename"; itemId: string; text: string }
  | { requestKey: string; op: "set_priority"; itemId: string; priority: "high" | "medium" | "low" | null }
  | { requestKey: string; op: "move"; itemId: string; toGroupId: string }
  | { requestKey: string; op: "set_why"; itemId: string; text: string };

const REQUEST_KEY = /^[A-Za-z0-9_.:-]{8,120}$/;
const RANK_OF = { high: "top", medium: "important", low: "can_wait" } as const;
const MOVABLE = new Set(listCategoryKeys());

/** Client-safe list of groups a need can be moved to. */
export function moveTargets(locale: Locale, info: (key: string) => string): { id: string; label: string }[] {
  void locale;
  return listCategoryKeys().map((k) => ({ id: opaqueGroupId(k), label: info(k) }));
}

const frameNeedIdOf = (mapId: string): string | null => (mapId.startsWith("fr:") ? mapId.slice(3) : mapId.startsWith("fa:") ? `n:disc:${mapId.slice(3)}` : null);

export async function applyCorrection(deps: Deps, projectId: string, locale: Locale, req: CorrectionRequest): Promise<void> {
  if (!req || typeof req.requestKey !== "string" || !REQUEST_KEY.test(req.requestKey) || typeof req.itemId !== "string") throw new ApiError("INVALID_INPUT");
  const pa = await loadPaState(deps.db, projectId);
  if (!pa) throw new ApiError("NOT_READY");

  const refs = await listCategoryRefs(deps.db, projectId);
  const needsBy = await loadMapNeeds(deps.db, refs.map((r) => r.instanceId));
  let found: { need: MapNeed; categoryKey: string; instanceId: string } | null = null;
  for (const r of refs) for (const n of needsBy.get(r.instanceId) ?? []) if (opaqueId(n.id) === req.itemId) found = { need: n, categoryKey: r.categoryKey, instanceId: r.instanceId };
  if (!found) throw new ApiError("NOT_FOUND");

  let toKey: string | null = null;
  if (req.op === "move") {
    toKey = listCategoryKeys().find((k) => opaqueGroupId(k) === req.toGroupId) ?? null;
    if (!toKey || !MOVABLE.has(toKey)) throw new ApiError("INVALID_INPUT");
  }
  if ((req.op === "rename" || req.op === "set_why") && (typeof req.text !== "string" || cleanText(req.text).length < 3)) throw new ApiError("INVALID_INPUT");
  if (req.op === "set_priority" && req.priority !== null && !(req.priority in RANK_OF)) throw new ApiError("INVALID_INPUT");

  const frameNeedId = frameNeedIdOf(found.need.id);
  const frames = createPgFrameStore(deps.db);
  const stored = frameNeedId ? await frames.load(projectId) : null;
  const inFrame = stored?.frame.needs.some((n) => n.id === frameNeedId) ?? false;

  if (stored && inFrame && frameNeedId) {
    const edit: FrameEdit =
      req.op === "remove" ? { op: "remove", needId: frameNeedId }
      : req.op === "rename" ? { op: "rename", needId: frameNeedId, text: cleanText(req.text) }
      : req.op === "set_priority" ? { op: "priority", needId: frameNeedId, rank: req.priority ? (RANK_OF[req.priority] as PriorityRank) : null }
      : req.op === "move" ? { op: "move", needId: frameNeedId, categoryKey: toKey as string }
      : { op: "why", needId: frameNeedId, text: cleanText(req.text) };
    if (!(await frames.hasEvent(projectId, req.requestKey, "correction"))) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const cur = (await frames.load(projectId)) ?? stored;
        const res = editFrame(cur.frame, edit, new Date().toISOString(), MOVABLE);
        if (!res.ok) throw new ApiError("INVALID_INPUT");
        try {
          await frames.commit(projectId, res.frame, cur.version, { turnKey: req.requestKey, kind: "correction", payload: { op: req.op, need: frameNeedId } });
          break;
        } catch (e) {
          if (!(e instanceof FrameConflictError) || attempt === 2) { if (e instanceof FrameConflictError && (await frames.hasEvent(projectId, req.requestKey, "correction"))) break; throw e; }
        }
      }
    }
    await syncFrameMap(deps, projectId, (await frames.load(projectId))!.frame, { allowConfirmed: true });
    await syncProjectInheritance(deps, projectId);
    return;
  }

  // map-level correction
  await deps.db.transaction(async (tx: Db) => {
    await lockProjectMap(tx, projectId);
    const f = found!;
    const mapNeeds = async (instanceId: string): Promise<MapNeed[]> => [...((await loadMapNeeds(tx, [instanceId], true)).get(instanceId) ?? [])];
    const mine = await mapNeeds(f.instanceId);
    const idx = mine.findIndex((n) => n.id === f.need.id);
    if (idx < 0) return;
    const cur = mine[idx] as MapNeed;
    if (req.op === "remove") mine[idx] = { ...cur, removed: true };
    else if (req.op === "rename") mine[idx] = { ...cur, label: cleanText(req.text).slice(0, 160) };
    else if (req.op === "set_priority") mine[idx] = { ...cur, priority: req.priority };
    else if (req.op === "set_why") mine[idx] = { ...cur, why: cleanText(req.text).slice(0, 240) };
    else if (req.op === "move" && toKey && toKey !== f.categoryKey) {
      mine[idx] = { ...cur, removed: true };
      const target = await ensureCategoryInstance(deps, tx, projectId, toKey, "client_added", pa.status === "confirmed" ? "confirmed" : "proposed");
      const theirs = await mapNeeds(target.instanceId);
      const k = theirs.findIndex((n) => n.id === cur.id);
      const moved: MapNeed = { ...cur };
      delete moved.removed;
      if (k >= 0) theirs[k] = moved; else theirs.push(moved);
      await replaceMapNeeds(tx, projectId, target.instanceId, theirs);
    }
    await replaceMapNeeds(tx, projectId, f.instanceId, mine);
  });
}
