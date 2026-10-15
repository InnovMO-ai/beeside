/**
 * Category inheritance on the database. The Understanding frame (what the client said, what Discovery captured) is translated
 * into the category's facts with provenance, so a category conversation never asks what the project already established.
 *
 * Ownership is explicit in a ledger (`frame_inherited`, a system fact of the category instance):
 *  - a field we wrote from the frame is OURS while its current value is still what we wrote -> when the frame changes (freshness,
 *    a correction, a material change) we update it;
 *  - a field the client answered or corrected in the category is THEIRS -> never overwritten; when the frame disagrees with it,
 *    the disagreement is recorded as a conflict (for the specialist), not silently resolved;
 *  - idempotent: the same frame writes nothing the second time.
 */
import type { Db } from "../../db/database";
import type { CategoryManifestContent } from "../manifest/effective-fields";
import type { FactMap } from "../manifest/types";
import { canonicalJson } from "../ports/operation-hub";
import { deriveInherited, type InheritedFact } from "../understanding/category-inheritance";
import { knownLines } from "../understanding/category-readiness";
import { createPgFrameStore } from "../understanding/pg-store";
import type { Frame } from "../understanding/types";
import { loadCategoryRef, listCategoryRefs, type CategoryRef } from "./category-ref";
import type { PrecisionDomainDeps } from "./deps";
import { loadFactMap, recordCandidateFact, recordSystemFact } from "./facts";
import { mapNeedId, planFrameMap } from "./frame-map";

export const INHERITED_LEDGER_KEY = "frame_inherited";

type InheritDeps = Pick<PrecisionDomainDeps, "db" | "registry">;

export interface LedgerEntry { frameKey: string; written: string }
export interface LedgerConflict { frameKey: string; frame: unknown; category: unknown }
export interface InheritanceLedger { v: 1; fields: Record<string, LedgerEntry>; conflicts: Record<string, LedgerConflict>; stale: string[] }


export function parseLedger(value: unknown): InheritanceLedger {
  // a copy: the caller mutates the ledger and the stored value must stay untouched for the change check
  const o = (value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : {}) as Partial<InheritanceLedger>;
  return {
    v: 1,
    fields: o.fields && typeof o.fields === "object" ? o.fields : {},
    conflicts: o.conflicts && typeof o.conflicts === "object" ? o.conflicts : {},
    stale: Array.isArray(o.stale) ? o.stale.filter((s): s is string => typeof s === "string") : [],
  };
}

const stamp = (value: unknown, state: string): string => canonicalJson({ v: value ?? null, s: state });
/** A field with no real answer yet. */
const empty = (f: FactMap[string]): boolean => !f || f.answerState === "NOT_ASKED";

export const LIFECYCLES_OPEN = new Set(["proposed", "confirmed", "in_progress"]);

function fieldIndex(manifest: CategoryManifestContent): Map<string, { field_key: string; type: string; values?: unknown[] }> {
  return new Map(manifest.fields.map((f) => [f.field_key, f as { field_key: string; type: string; values?: unknown[] }]));
}

/** What the frame says for this category (pure view over the registry manifest). */
export async function inheritedFor(deps: Pick<PrecisionDomainDeps, "registry">, ref: CategoryRef, frame: Frame): Promise<InheritedFact[]> {
  const manifest = await deps.registry.getManifestForCategory(ref.categoryKey, ref.manifestVersion);
  const fields = fieldIndex(manifest.manifest);
  return [...deriveInherited(frame, ref.categoryKey, fields as never), ...deriveGenericNeeds(frame, ref.categoryKey, fields)];
}

type GenericItem = Record<string, unknown>;
const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const blank = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

/**
 * A category backed by the GENERIC manifest (no authored manifest: a need the catalog cannot place) starts from what the project already
 * knows about that need — the client's own words, the reason they gave and the priority they set — so the category conversation deepens
 * instead of restarting with "tell me what you need". Pure; only what the client said or confirmed, never an AI proposal.
 */
export function deriveGenericNeeds(frame: Frame, categoryKey: string, fields: ReadonlyMap<string, { field_key: string; type: string }>): InheritedFact[] {
  if (!fields.has("generic_needs")) return [];
  const planned = planFrameMap(frame).needs.filter((p) => p.categoryKey === categoryKey);
  const items: GenericItem[] = [];
  for (const p of planned) {
    const n = frame.needs.find((x) => mapNeedId(x) === p.need.id);
    if (!n || n.status === "removed" || n.origin === "implied") continue; // an AI proposal the client did not accept is not inherited
    const item: GenericItem = { need_description: n.text.trim() };
    if (p.need.why) item.problem = p.need.why;
    if (p.need.priority) item.urgency = p.need.priority;
    items.push(item);
  }
  if (items.length === 0) return [];
  const confirmed = frame.needs.some((n) => planned.some((p) => p.need.id === mapNeedId(n)) && n.status === "confirmed");
  const first = frame.needs.find((n) => mapNeedId(n) === planned[0]!.need.id)!;
  const out: InheritedFact[] = [{
    fieldKey: "generic_needs", value: items, valueType: "repeatable_group", answerState: "ANSWERED", provenance: "client_answered", frameKey: `need:${first.id}`,
    display: items.map((i) => String(i.need_description)).slice(0, 3).join(", "),
  }];
  if (confirmed && fields.has("generic_classification_confirmed")) out.push({ fieldKey: "generic_classification_confirmed", value: true, valueType: "boolean", answerState: "ANSWERED", provenance: "client_confirmed", frameKey: `need:${first.id}`, display: "" });
  return out;
}

/** Non-destructive merge of group items: matching items (same description) get only their EMPTY sub-fields filled; new needs are appended. */
export function mergeGenericItems(current: unknown, derived: unknown): GenericItem[] {
  const cur: GenericItem[] = Array.isArray(current) ? current.filter((x): x is GenericItem => Boolean(x) && typeof x === "object").map((x) => ({ ...x })) : [];
  for (const d of Array.isArray(derived) ? (derived as GenericItem[]) : []) {
    const hit = cur.find((c) => norm(c.need_description) === norm(d.need_description));
    if (!hit) { cur.push({ ...d }); continue; }
    for (const [k, v] of Object.entries(d)) if (blank(hit[k])) hit[k] = v;
  }
  return cur;
}

export interface InheritancePlan { writes: InheritedFact[]; ledger: InheritanceLedger; ledgerChanged: boolean; nextFacts: FactMap }

/** Pure: what to write and how the ledger changes, given the candidates, the category's current facts and its ledger. */
export function planInheritance(candidates: readonly InheritedFact[], factsNow: FactMap): InheritancePlan {
  let current = factsNow;
  const ledger = parseLedger(current[INHERITED_LEDGER_KEY]?.value);
  const before = canonicalJson(ledger);
  const writes: InheritedFact[] = [];

  const derivedKeys = new Set(candidates.map((c) => c.fieldKey));
  for (const c of candidates) {
    const cur = current[c.fieldKey];
    const mine = stamp(c.value, c.answerState);
    const owned = ledger.fields[c.fieldKey];
    const stillOurs = owned !== undefined && cur !== undefined && stamp(cur.value, cur.answerState) === owned.written;

    if (c.fieldKey === "generic_needs" && !empty(cur) && cur!.answerState === "ANSWERED") {
      // the client may already have started describing the need in the category: the frame only fills what is still empty, never overwrites
      const merged = mergeGenericItems(cur!.value, c.value);
      if (stamp(merged, "ANSWERED") !== stamp(cur!.value, cur!.answerState)) {
        writes.push({ ...c, value: merged });
        current = { ...current, [c.fieldKey]: { value: merged, answerState: "ANSWERED", provenance: cur!.provenance ?? c.provenance } };
        ledger.fields[c.fieldKey] = { frameKey: c.frameKey, written: stamp(merged, "ANSWERED") };
      }
      delete ledger.conflicts[c.fieldKey];
    } else if (empty(cur) || (stillOurs && owned!.written !== mine)) {
      writes.push(c);
      current = { ...current, [c.fieldKey]: { value: c.value, answerState: c.answerState, provenance: c.provenance } };
      ledger.fields[c.fieldKey] = { frameKey: c.frameKey, written: mine };
      delete ledger.conflicts[c.fieldKey];
    } else if (!stillOurs) {
      // the client's own answer in the category stands; a disagreement with the frame is recorded for the specialist
      delete ledger.fields[c.fieldKey];
      const same = cur !== undefined && stamp(cur.value, cur.answerState) === mine;
      if (same) delete ledger.conflicts[c.fieldKey];
      else if (cur !== undefined && cur.answerState === "ANSWERED" && c.answerState === "ANSWERED") ledger.conflicts[c.fieldKey] = { frameKey: c.frameKey, frame: c.value, category: cur.value };
    }
  }

  // fields we inherited that the frame no longer supports: nothing is deleted (append-only), but they are marked stale
  for (const key of Object.keys(ledger.fields)) {
    if (!derivedKeys.has(key)) {
      const cur = current[key];
      if (cur !== undefined && stamp(cur.value, cur.answerState) === ledger.fields[key]!.written) { if (!ledger.stale.includes(key)) ledger.stale.push(key); }
      else delete ledger.fields[key];
    }
  }
  ledger.stale = ledger.stale.filter((k) => !derivedKeys.has(k));
  return { writes, ledger, ledgerChanged: canonicalJson(ledger) !== before, nextFacts: current };
}

/** Applies the frame to ONE category instance inside `tx`. Returns true when something was written. */
export async function reconcileCategory(deps: Pick<PrecisionDomainDeps, "registry">, tx: Db, ref: CategoryRef, frame: Frame): Promise<boolean> {
  if (!LIFECYCLES_OPEN.has(ref.lifecycle)) return false; // a completed category keeps what it was completed with
  const candidates = await inheritedFor(deps, ref, frame);
  let current = await loadFactMap(tx, ref.instanceId);
  const plan = planInheritance(candidates, current);
  let wrote = false;
  for (const c of plan.writes) {
    const cur = current[c.fieldKey];
    const id = await recordCandidateFact(tx, {
      projectId: ref.projectId, scopeInstanceId: ref.instanceId, source: "category",
      fact: {
        fieldKey: c.fieldKey, value: c.value, valueType: c.valueType, answerState: c.answerState, provenanceStage: c.provenance, confidence: null,
        supersedes: !empty(cur), ...(c.sourcePinId ? { sourcePinId: c.sourcePinId, ...(c.sourceItemRef ? { sourceItemRef: c.sourceItemRef } : {}) } : {}),
        idempotencyKey: `inherit:${c.fieldKey}`,
      },
    }, current);
    if (id) wrote = true;
    current = { ...current, [c.fieldKey]: { value: c.value, answerState: c.answerState, provenance: c.provenance } };
  }
  if (plan.ledgerChanged) {
    const id = await recordSystemFact(tx, { projectId: ref.projectId, scopeInstanceId: ref.instanceId, source: "category", fieldKey: INHERITED_LEDGER_KEY, value: plan.ledger, valueType: "json" }, current);
    if (id) wrote = true;
  }
  return wrote;
}

/** Loads the project's frame; null when the project has none (legacy engine) -> nothing to inherit. */
export async function loadFrame(db: Db, projectId: string): Promise<Frame | null> {
  return (await createPgFrameStore(db).load(projectId))?.frame ?? null;
}

/** Cheap pre-check outside any transaction: is the category already in line with the frame? */
async function inSync(deps: InheritDeps, ref: CategoryRef, frame: Frame): Promise<boolean> {
  const plan = planInheritance(await inheritedFor(deps, ref, frame), await loadFactMap(deps.db, ref.instanceId));
  return plan.writes.length === 0 && !plan.ledgerChanged;
}

/** Applies the latest frame to one category (opening a thread, each category turn). Idempotent; best-effort for callers. */
export async function syncCategoryInheritance(deps: InheritDeps, projectId: string, instanceId: string): Promise<boolean> {
  const ref = await loadCategoryRef(deps.db, projectId, instanceId);
  if (!ref || !LIFECYCLES_OPEN.has(ref.lifecycle)) return false;
  const frame = await loadFrame(deps.db, projectId);
  if (!frame) return false;
  if (await inSync(deps, ref, frame)) return false;
  return deps.db.transaction((tx) => reconcileCategory(deps, tx, ref, frame));
}

/** Applies the latest frame to every open category of the project (after the frame or the map changes). */
export async function syncProjectInheritance(deps: InheritDeps, projectId: string): Promise<number> {
  const frame = await loadFrame(deps.db, projectId);
  if (!frame) return 0;
  let n = 0;
  for (const ref of await listCategoryRefs(deps.db, projectId)) {
    if (!LIFECYCLES_OPEN.has(ref.lifecycle)) continue;
    if (await inSync(deps, ref, frame)) continue;
    if (await deps.db.transaction((tx) => reconcileCategory(deps, tx, ref, frame))) n += 1;
  }
  return n;
}

/** Short client-language lines of what the project already established for this category (the thread opening). */
export function knownForCategory(ref: CategoryRef, frame: Frame, max = 3): string[] {
  return knownLines(frame, ref.categoryKey, max);
}
