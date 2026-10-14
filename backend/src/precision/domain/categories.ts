/**
 * Category instances of a project: creation (always pinned to a published manifest version), the needs that put a category
 * on the Service Map (`map_needs`, a system-derived fact of the category instance), the proposal made from the First
 * Assessment, and the evaluation every surface shares (card, thread header, Service Map, Center).
 *
 * Business rule: the client never sees a category key. A category is identified by `category_assessment.instance_id`;
 * `new:<slug>` instances are labelled from the client's own words or as "under review".
 */
import type { Db } from "../../db/database";
import { FaError } from "../../fa/services/errors";
import type { CategoryStatus, SendStateDto } from "../api/dto";
import type { FaContextRead } from "../ports/fa-context";
import { categoryInfo, cleanText, evaluateCategory, isNewCategoryKey, proposeCategories } from "../manifest";
import type { LoadedCategoryManifest } from "../manifest/registry";
import type { CategoryEvaluation, FactMap } from "../manifest/types";
import type { Locale } from "../manifest/value-render";
import { categoryUiStatus, listCategoryRefs, packSendState, type CategoryRef } from "./category-ref";
import type { PrecisionDomainDeps } from "./deps";
import { factKey, loadFactMap, lockProjectMap, recordSystemFact } from "./facts";
import { parseCountryCodes } from "./fa-context";
import { loadPaState } from "./project-state";
import { frameOwnedFaNeedIds, syncFrameMapForProject } from "./frame-map";
import { loadFrame } from "./category-inheritance";
import { categoryUnderstanding, type CategoryUnderstanding } from "../understanding/category-readiness";
import type { Frame } from "../understanding/types";


export const MAP_NEEDS_KEY = "map_needs";

export interface MapNeed {
  /** `fa:<capabilityId>` for needs the First Assessment detected, `add:<hash>` for what the client added. */
  id: string;
  label: string;
  priority: "high" | "medium" | "low" | null;
  source: "fa" | "client";
  /** Why the client needs it, in their words (from the conversation), when known. */
  why?: string | null;
  /** When the client needs it ("antes de marzo"), when known. */
  timing?: string | null;
  /** The client removed it. Kept as a tombstone so the First Assessment proposal never re-adds it; never shown. */
  removed?: boolean;
}

/** `keepRemoved`: tombstones stay in the list (writers); readers get the active needs only. */
export function parseMapNeeds(value: unknown, keepRemoved = false): MapNeed[] {
  if (!Array.isArray(value)) return [];
  const out: MapNeed[] = [];
  for (const v of value) {
    const o = v as Partial<MapNeed> | null;
    if (!o || typeof o.id !== "string" || typeof o.label !== "string") continue;
    if (o.removed === true && !keepRemoved) continue;
    const need: MapNeed = { id: o.id, label: o.label, priority: o.priority === "high" || o.priority === "medium" || o.priority === "low" ? o.priority : null, source: o.source === "client" ? "client" : "fa" };
    if (typeof o.why === "string" && o.why.trim()) need.why = o.why;
    if (typeof o.timing === "string" && o.timing.trim()) need.timing = o.timing;
    if (o.removed === true) need.removed = true;
    out.push(need);
  }
  return out;
}

export async function loadMapNeeds(db: Pick<Db, "query">, instanceIds: readonly string[], keepRemoved = false): Promise<Map<string, MapNeed[]>> {
  const out = new Map<string, MapNeed[]>();
  if (instanceIds.length === 0) return out;
  const { rows } = await db.query<{ scope_instance_id: string; value: unknown }>(
    "SELECT scope_instance_id, value FROM fact WHERE scope_instance_id = ANY($1::uuid[]) AND field_key = $2 AND superseded_by IS NULL",
    [instanceIds, factKey(MAP_NEEDS_KEY)],
  );
  for (const r of rows) out.set(r.scope_instance_id, parseMapNeeds(r.value, keepRemoved));
  return out;
}

/** Appends (by id) needs to a category's `map_needs`; returns true when something was written. */
export async function appendMapNeeds(tx: Db, projectId: string, instanceId: string, add: readonly MapNeed[]): Promise<boolean> {
  const current = await loadFactMap(tx, instanceId);
  const have = parseMapNeeds(current[MAP_NEEDS_KEY]?.value, true);
  const known = new Set(have.map((n) => n.id));
  const fresh = add.filter((n) => !known.has(n.id));
  if (fresh.length === 0) return false;
  const id = await recordSystemFact(tx, { projectId, scopeInstanceId: instanceId, source: "category", fieldKey: MAP_NEEDS_KEY, value: [...have, ...fresh], valueType: "json" }, current);
  return id !== null;
}

/** Replaces a category's `map_needs` (tombstones included). Returns true when something was written. */
export async function replaceMapNeeds(tx: Db, projectId: string, instanceId: string, next: readonly MapNeed[]): Promise<boolean> {
  const current = await loadFactMap(tx, instanceId);
  const have = parseMapNeeds(current[MAP_NEEDS_KEY]?.value, true);
  if (JSON.stringify(have) === JSON.stringify(next)) return false;
  const id = await recordSystemFact(tx, { projectId, scopeInstanceId: instanceId, source: "category", fieldKey: MAP_NEEDS_KEY, value: [...next], valueType: "json" }, current);
  return id !== null;
}

/**
 * Settles the proposals when the Service Map is confirmed: categories left without any active need (the client removed or moved
 * them) are NOT selected; the rest become confirmed. Caller holds the map lock.
 */
export async function settleProposedCategories(tx: Db, projectId: string): Promise<void> {
  const refs = (await listCategoryRefs(tx, projectId)).filter((r) => r.lifecycle === "proposed");
  if (refs.length === 0) return;
  const needsBy = await loadMapNeeds(tx, refs.map((r) => r.instanceId));
  for (const r of refs) {
    const empty = (needsBy.get(r.instanceId) ?? []).length === 0;
    await tx.query("UPDATE category_assessment SET lifecycle_status = $2 WHERE instance_id = $1 AND lifecycle_status = 'proposed'", [r.instanceId, empty ? "not_selected" : "confirmed"]);
  }
}

/**
 * Finds or creates the category instance of `categoryKey` in `target` lifecycle (`proposed` for what the First Assessment
 * detected, `confirmed` for what the client adds). A previously deselected category is reactivated. Caller holds the map lock.
 */
export async function ensureCategoryInstance(
  deps: Pick<PrecisionDomainDeps, "registry">,
  tx: Db,
  projectId: string,
  categoryKey: string,
  origin: "pa_detected" | "client_added",
  target: "proposed" | "confirmed",
): Promise<{ instanceId: string; created: boolean }> {
  const found = (await tx.query<{ instance_id: string; lifecycle_status: string }>("SELECT instance_id, lifecycle_status FROM category_assessment WHERE project_id = $1 AND category_key = $2", [projectId, categoryKey])).rows[0];
  if (found) {
    if (found.lifecycle_status === "not_selected" && target === "confirmed") await tx.query("UPDATE category_assessment SET lifecycle_status = 'confirmed' WHERE instance_id = $1", [found.instance_id]);
    return { instanceId: found.instance_id, created: false };
  }
  const manifest = await deps.registry.getManifestForCategory(categoryKey);
  const instanceId = (await tx.query<{ id: string }>("INSERT INTO precision_instance (project_id, scope) VALUES ($1, 'category') RETURNING id", [projectId])).rows[0]!.id;
  await tx.query("INSERT INTO category_assessment (instance_id, project_id, category_key, manifest_version, category_origin) VALUES ($1, $2, $3, $4, $5)", [instanceId, projectId, categoryKey, manifest.version, origin]);
  if (target === "confirmed") await tx.query("UPDATE category_assessment SET lifecycle_status = 'confirmed' WHERE instance_id = $1", [instanceId]);
  return { instanceId, created: true };
}

/**
 * Proposes the project's categories from the First Assessment needs while the Service Map is not confirmed. Idempotent:
 * already-present categories and needs are left alone, so it can run on every load. Never throws for a missing context.
 */
export async function syncProposals(deps: Pick<PrecisionDomainDeps, "db" | "registry">, projectId: string, read: FaContextRead | null): Promise<void> {
  // the Understanding frame (when the project has one) places its needs first; the First Assessment proposal covers the rest
  await syncFrameMapForProject(deps, projectId);
  if (!read) return;
  const pa = await loadPaState(deps.db, projectId);
  if (!pa || pa.status === "confirmed") return;
  const pm = (await deps.registry.getProjectManifest(pa.manifestVersion)) ?? (await deps.registry.getProjectManifest());
  if (!pm) return;
  const proposal = proposeCategories(read.context.needs, pm.manifest);
  if (proposal.categories.length === 0) return;

  // what the Understanding conversation already placed or the client removed is not proposed again
  const dropped = await frameOwnedFaNeedIds(deps.db, projectId);
  const wanted = proposal.categories.map((c) => ({
    categoryKey: c.categoryKey,
    needs: read.context.needs
      .filter((n) => c.capabilityIds.includes(n.capabilityId) && !dropped.has(`fa:${n.capabilityId}`))
      .map((n): MapNeed => ({ id: `fa:${n.capabilityId}`, label: cleanText(n.label || n.capabilityId), priority: n.priority, source: "fa" })),
  }));

  // cheap pre-check outside the transaction: nothing to do when everything is already there
  const refs = await listCategoryRefs(deps.db, projectId);
  const needsBy = await loadMapNeeds(deps.db, refs.map((r) => r.instanceId), true);
  const missing = wanted.some((w) => {
    const ref = refs.find((r) => r.categoryKey === w.categoryKey);
    if (!ref) return true;
    const have = new Set((needsBy.get(ref.instanceId) ?? []).map((n) => n.id));
    return w.needs.some((n) => !have.has(n.id));
  });
  if (!missing) return;

  await deps.db.transaction(async (tx) => {
    await lockProjectMap(tx, projectId);
    const current = await loadPaState(tx, projectId);
    if (!current || current.status === "confirmed") return;
    for (const w of wanted) {
      const { instanceId } = await ensureCategoryInstance(deps, tx, projectId, w.categoryKey, "pa_detected", "proposed");
      await appendMapNeeds(tx, projectId, instanceId, w.needs);
    }
  });
}

// ------------------------------------------------------------------ evaluation shared by every surface
export interface CategoryState {
  ref: CategoryRef;
  /** What the project conversation established for this category, combined with what was answered in the category. Null without a frame. */
  understanding: CategoryUnderstanding | null;
  label: string;
  iconKey: string;
  kind: ReturnType<typeof categoryInfo>["kind"];
  needs: MapNeed[];
  manifest: LoadedCategoryManifest;
  facts: FactMap;
  evaluation: CategoryEvaluation;
  sendState: SendStateDto;
  status: CategoryStatus;
}

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

export function labelOf(ref: Pick<CategoryRef, "categoryKey">, needs: readonly MapNeed[], locale: Locale): string {
  if (isNewCategoryKey(ref.categoryKey)) {
    const first = needs[0]?.label;
    if (first) return clip(cleanText(first), 60);
  }
  return categoryInfo(ref.categoryKey).label[locale];
}

/** `prefetchedFacts`: the instance's current fact map when the caller already loaded it in a batch (list views). */
export async function loadCategoryState(deps: Pick<PrecisionDomainDeps, "db" | "registry">, ref: CategoryRef, countries: string[], locale: Locale, needs?: MapNeed[], prefetchedFacts?: FactMap, prefetchedFrame?: Frame | null): Promise<CategoryState> {
  const manifest = await deps.registry.getManifestForCategory(ref.categoryKey, ref.manifestVersion);
  const facts = prefetchedFacts ?? (await loadFactMap(deps.db, ref.instanceId));
  const evaluation = evaluateCategory({ manifest: manifest.manifest, facts, countries });
  const sendState = ref.lifecycle === "completed" ? await packSendState(deps.db, ref.currentPackId) : "not_sent";
  const mapNeeds = needs ?? parseMapNeeds(facts[MAP_NEEDS_KEY]?.value);
  const info = categoryInfo(ref.categoryKey);
  const frame = prefetchedFrame !== undefined ? prefetchedFrame : await loadFrame(deps.db as never, ref.projectId).catch(() => null);
  const understanding = frame ? categoryUnderstanding(frame, ref.categoryKey, facts, new Set(manifest.manifest.fields.map((f) => f.field_key))) : null;
  return {
    ref,
    understanding,
    label: labelOf(ref, mapNeeds, locale),
    iconKey: info.iconKey,
    kind: info.kind,
    needs: mapNeeds,
    manifest,
    facts,
    evaluation,
    sendState,
    status: categoryUiStatus(ref.lifecycle, evaluation, sendState),
  };
}

export function progressOf(s: CategoryState): { progressPct: number | null; criticalOpen: number; pendingCount: number; ready: boolean; status: CategoryStatus } {
  return { progressPct: s.evaluation.progressPct, criticalOpen: s.evaluation.critical.length, pendingCount: s.evaluation.pending.length, ready: s.evaluation.ready, status: s.status };
}

const asCode = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z]{2}$/.test(v.trim()) ? v.trim().toUpperCase() : null);

/** Destination countries: the client's confirmed answer first, the First Assessment's text otherwise, else none. */
export async function projectCountries(db: Pick<Db, "query">, projectId: string, read: FaContextRead | null): Promise<string[]> {
  const pa = await loadPaState(db, projectId);
  if (pa) {
    const f = (await loadFactMap(db, pa.instanceId)).pa_destination_countries;
    if (f && (f.answerState === "ANSWERED" || f.answerState === "ASSUMED") && Array.isArray(f.value)) {
      const codes = f.value.map(asCode).filter((c): c is string => c !== null);
      if (codes.length > 0) return [...new Set(codes)];
    }
  }
  return read ? parseCountryCodes(read.context.project.destinationCountry) : [];
}

export function assertFound<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new FaError("NOT_FOUND", "not found");
  return v;
}
