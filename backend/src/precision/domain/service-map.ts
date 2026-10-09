/**
 * My Service Map: the live projection (facts + category assessments), the latest confirmed snapshot, the difference between
 * them in client language, and the confirmation itself.
 *
 *  - The live map is always computed, never stored; the snapshot is immutable (`service_map_snapshot`).
 *  - Confirming does NOT activate Operation Hub and sends nothing: it promotes the proposed categories to "Not started".
 *  - The first confirmation uses `precision_assessment_confirm`; every later one (changes after confirmation, a service added)
 *    uses `precision_psm_new_version`. Version numbers are stored, never returned.
 */
import { createHash } from "node:crypto";
import type { Db } from "../../db/database";
import type { ConfirmServiceMapResponse, ItemState, Locale, ServiceMapDto, ServiceMapGroupDto, ServiceMapViewDto } from "../api/dto";
import { ApiError } from "../api/errors";
import { formatDate } from "../manifest/value-render";
import { categoryInfo, buildServiceMapContent, openItemsFromEvaluations, type PsmV1Content } from "../manifest";
import type { FaContextRead } from "../ports/fa-context";
import { confirmPrecisionAssessment } from "../repository";
import { listCategoryRefs, type CategoryRef } from "./category-ref";
import { loadCategoryState, loadMapNeeds, projectCountries, syncProposals, type CategoryState } from "./categories";
import type { PrecisionDomainDeps } from "./deps";
import { emitEvent } from "./events";
import { loadFactMap, lockProjectMap, recordSystemFact } from "./facts";
import { destinationsOf, type FaContextService } from "./fa-context";
import { latestSnapshot, loadPaState, type PaState, type SnapshotRow } from "./project-state";

type Q = Pick<Db, "query">;
type MapDeps = Pick<PrecisionDomainDeps, "db" | "registry">;

export interface Caller { projectId: string; locale: Locale; canWrite: boolean }

const REQUEST_KEY = /^[A-Za-z0-9_.:-]{8,120}$/;
const TITLE = "My Service Map";

const PA_OPEN: Record<string, Record<Locale, string>> = {
  pa_project_objective: { en: "Project objective", es: "Objetivo del proyecto" },
  pa_destination_countries: { en: "Destination countries", es: "Países de destino" },
  pa_expansion_product_or_service: { en: "Product or service to bring to the market", es: "Producto o servicio para el mercado" },
  pa_operating_entity: { en: "Company that will operate in the destination", es: "Empresa que operará en el destino" },
  pa_time_window: { en: "Start date", es: "Fecha de inicio" },
};

const CHANGE_COPY = {
  objective: { en: "Project objective updated", es: "Objetivo del proyecto actualizado" },
  destinations: { en: "Destination countries updated", es: "Países de destino actualizados" },
  timeWindow: { en: "Start date updated", es: "Fecha de inicio actualizada" },
  product: { en: "Product or service updated", es: "Producto o servicio actualizado" },
  groupAdded: { en: "Service added", es: "Servicio agregado" },
  groupRemoved: { en: "Service removed", es: "Servicio eliminado" },
  itemAdded: { en: "added", es: "agregado" },
  itemRemoved: { en: "removed", es: "eliminado" },
} as const;

/** Item ids are stored with their origin (capability or hash); the client only ever sees an opaque stable id. */
const opaqueId = (id: string): string => `i_${createHash("sha256").update(id).digest("hex").slice(0, 14)}`;

const plain = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
};

export interface LiveMap {
  pa: PaState;
  content: PsmV1Content;
  destinationCodes: string[];
  refs: CategoryRef[];
  states: CategoryState[];
  /** Workstream ids by instance key, only for categories already visible as cards (not `proposed`). */
  visibleIdByKey: Map<string, string>;
}

/** The map as the facts stand right now. */
export async function buildLiveMap(deps: MapDeps, q: Q, projectId: string, locale: Locale, read: FaContextRead | null): Promise<LiveMap> {
  const pa = await loadPaState(q, projectId);
  if (!pa) throw new ApiError("NOT_READY");
  const refs = await listCategoryRefs(q, projectId);
  const needsBy = await loadMapNeeds(q, refs.map((r) => r.instanceId));
  const paFacts = await loadFactMap(q, pa.instanceId);
  const destinationCodes = await projectCountries(q, projectId, read);
  const scoped = { db: q as Db, registry: deps.registry };

  const states: CategoryState[] = [];
  for (const ref of refs) states.push(await loadCategoryState(scoped, ref, destinationCodes, locale, needsBy.get(ref.instanceId) ?? []));

  const answered = (k: string): unknown => {
    const f = paFacts[k];
    return f && (f.answerState === "ANSWERED" || f.answerState === "ASSUMED") ? f.value : undefined;
  };
  const open: string[] = [];
  for (const [k, labels] of Object.entries(PA_OPEN)) {
    const f = paFacts[k];
    if (f && (f.answerState === "UNKNOWN" || f.answerState === "WITHHELD")) open.push(labels[locale]);
  }
  const started = states.filter((s) => s.ref.lifecycle === "in_progress");
  open.push(...openItemsFromEvaluations(locale, started.map((s) => ({ categoryKey: s.ref.categoryKey, label: s.label, evaluation: s.evaluation }))));

  const pin = (await q.query<{ id: string; catalog_version: string; crosswalk_version: string; contract_version: string }>(
    "SELECT id, catalog_version, crosswalk_version, contract_version FROM context_pin WHERE project_id = $1 AND status = 'current'", [projectId],
  )).rows[0];

  const content = buildServiceMapContent({
    project: {
      objective: plain(answered("pa_project_objective")),
      destinations: destinationCodes,
      timeWindow: plain(answered("pa_time_window")),
      productOrService: plain(answered("pa_expansion_product_or_service")),
      operatingEntity: plain(answered("pa_operating_entity")),
    },
    categories: states.map((s) => ({
      categoryKey: s.ref.categoryKey,
      label: s.label,
      needs: s.needs.map((n) => ({ id: n.id, label: n.label, priority: n.priority, state: (s.ref.lifecycle === "completed" ? "confirmed" : "pending") as ItemState })),
    })),
    locale,
    openItems: open,
    contextPinId: pin?.id ?? null,
    versions: {
      catalog: pin?.catalog_version ?? null,
      crosswalk: pin?.crosswalk_version ?? null,
      contract: pin?.contract_version ?? null,
      manifests: Object.fromEntries(refs.map((r) => [r.categoryKey, r.manifestVersion])),
    },
  });
  const visibleIdByKey = new Map(refs.filter((r) => r.lifecycle !== "proposed").map((r) => [r.categoryKey, r.instanceId]));
  return { pa, content, destinationCodes, refs, states, visibleIdByKey };
}

// ------------------------------------------------------------------ content -> DTO
interface StoredContent extends Partial<PsmV1Content> { destination_codes?: string[]; client_request_id?: string }

function viewOf(content: StoredContent, codes: string[], locale: Locale, asOf: string, visibleIdByKey: Map<string, string>): ServiceMapViewDto {
  const groups: ServiceMapGroupDto[] = (content.groups ?? []).map((g) => {
    const info = categoryInfo(g.categoryKey);
    return {
      categoryId: g.categoryKey.startsWith("new:") ? null : (visibleIdByKey.get(g.categoryKey) ?? null),
      // labels are re-localized at read time from the category key; "under review" groups are neutral
      label: info.label[locale],
      iconKey: info.iconKey,
      kind: info.kind,
      items: g.items.map((i) => ({ id: opaqueId(i.id), label: i.label, why: i.why, priority: i.priority, timing: i.timing, state: i.state })),
    };
  });
  const p = content.project;
  return {
    title: TITLE,
    asOf,
    summary: {
      objective: p?.objective ?? null,
      destinations: destinationsOf(codes, locale),
      timeWindow: p?.timeWindow ? formatDate(p.timeWindow, locale) : null,
      productOrService: p?.productOrService ?? null,
    },
    groups,
    openItems: content.openItems ?? [],
    changesSinceConfirmed: [],
  };
}

function codesOf(content: StoredContent, fallback: string[]): string[] {
  return Array.isArray(content.destination_codes) ? content.destination_codes : fallback;
}

/** Added / removed / changed vs. the confirmed snapshot, in client language. */
export function diffAgainst(live: PsmV1Content, liveCodes: string[], snap: StoredContent, locale: Locale): ServiceMapViewDto["changesSinceConfirmed"] {
  const out: ServiceMapViewDto["changesSinceConfirmed"] = [];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for the call sites
  const labelOf = (key: string, _fallback: string): string => categoryInfo(key).label[locale];
  const snapGroups = new Map((snap.groups ?? []).map((g) => [g.categoryKey, g]));
  const liveGroups = new Map(live.groups.map((g) => [g.categoryKey, g]));
  for (const [key, g] of liveGroups) {
    const before = snapGroups.get(key);
    if (!before) {
      out.push({ kind: "added", text: `${labelOf(key, g.label)}: ${CHANGE_COPY.groupAdded[locale]}` });
      continue;
    }
    const had = new Set(before.items.map((i) => i.id));
    for (const i of g.items) if (!had.has(i.id)) out.push({ kind: "added", text: `${labelOf(key, g.label)}: ${i.label} (${CHANGE_COPY.itemAdded[locale]})` });
    const has = new Set(g.items.map((i) => i.id));
    for (const i of before.items) if (!has.has(i.id)) out.push({ kind: "removed", text: `${labelOf(key, g.label)}: ${i.label} (${CHANGE_COPY.itemRemoved[locale]})` });
  }
  for (const [key, g] of snapGroups) if (!liveGroups.has(key)) out.push({ kind: "removed", text: `${labelOf(key, g.label)}: ${CHANGE_COPY.groupRemoved[locale]}` });
  const bp = snap.project;
  const lp = live.project;
  if ((bp?.objective ?? null) !== lp.objective) out.push({ kind: "changed", text: CHANGE_COPY.objective[locale] });
  if (JSON.stringify([...codesOf(snap, []) ].sort()) !== JSON.stringify([...liveCodes].sort())) out.push({ kind: "changed", text: CHANGE_COPY.destinations[locale] });
  if ((bp?.timeWindow ?? null) !== lp.timeWindow) out.push({ kind: "changed", text: CHANGE_COPY.timeWindow[locale] });
  if ((bp?.productOrService ?? null) !== lp.productOrService) out.push({ kind: "changed", text: CHANGE_COPY.product[locale] });
  return out;
}

/** True when the live map differs from the confirmed snapshot (the Center's "changes to review" flag). */
export async function hasUnconfirmedChanges(deps: MapDeps, q: Q, projectId: string, locale: Locale, read: FaContextRead | null, live?: LiveMap): Promise<boolean> {
  const l = live ?? (await buildLiveMap(deps, q, projectId, locale, read));
  if (l.pa.status !== "confirmed") return false;
  const snap = await latestSnapshot(q, l.pa.instanceId);
  if (!snap) return false;
  return diffAgainst(l.content, l.destinationCodes, snap.content as StoredContent, locale).length > 0;
}

// ------------------------------------------------------------------ service
export interface ServiceMapService {
  get(caller: Caller): Promise<ServiceMapDto>;
  confirm(caller: Caller, requestKey: string): Promise<ConfirmServiceMapResponse>;
}

export function createServiceMapService(deps: PrecisionDomainDeps, fa: FaContextService): ServiceMapService {
  async function get(caller: Caller): Promise<ServiceMapDto> {
    const { projectId, locale } = caller;
    const read = await fa.read(projectId);
    await syncProposals(deps, projectId, read);
    const pa = await loadPaState(deps.db, projectId);
    if (!pa || (pa.status !== "ready_for_confirmation" && pa.status !== "confirmed")) throw new ApiError("NOT_READY");
    const live = await buildLiveMap(deps, deps.db, projectId, locale, read);
    const snap: SnapshotRow | null = live.pa.status === "confirmed" ? await latestSnapshot(deps.db, live.pa.instanceId) : null;
    const stored = (snap?.content ?? null) as StoredContent | null;
    const changes = stored ? diffAgainst(live.content, live.destinationCodes, stored, locale) : [];
    const liveView = viewOf(live.content, live.destinationCodes, locale, deps.now().toISOString(), live.visibleIdByKey);
    liveView.changesSinceConfirmed = changes;
    const confirmed = snap && stored ? { ...viewOf(stored, codesOf(stored, live.destinationCodes), locale, snap.confirmedAt.toISOString(), live.visibleIdByKey), confirmedAt: snap.confirmedAt.toISOString() } : null;
    const unconfirmed = confirmed !== null && changes.length > 0;
    const canConfirm = caller.canWrite && ((live.pa.status === "ready_for_confirmation" && live.content.groups.length > 0) || (live.pa.status === "confirmed" && unconfirmed));
    return { live: liveView, confirmed, canConfirm, hasUnconfirmedChanges: unconfirmed, canWrite: caller.canWrite };
  }

  async function confirm(caller: Caller, requestKey: string): Promise<ConfirmServiceMapResponse> {
    if (typeof requestKey !== "string" || !REQUEST_KEY.test(requestKey)) throw new ApiError("INVALID_INPUT");
    const { projectId, locale } = caller;
    const read = await fa.read(projectId);
    await syncProposals(deps, projectId, read);
    const confirmedAt = await deps.db.transaction(async (tx): Promise<Date> => {
      await lockProjectMap(tx, projectId);
      const pa = await loadPaState(tx, projectId);
      if (!pa) throw new ApiError("NOT_READY");
      const again = (await tx.query<{ confirmed_at: Date }>("SELECT confirmed_at FROM service_map_snapshot WHERE precision_instance_id = $1 AND content->>'client_request_id' = $2", [pa.instanceId, requestKey])).rows[0];
      if (again) return again.confirmed_at; // the same confirmation sent twice: one effect
      if (pa.status !== "ready_for_confirmation" && pa.status !== "confirmed") throw new ApiError("NOT_READY");

      if (pa.status === "confirmed") {
        // later confirmation: only when something actually changed, otherwise nothing to do
        const current = await buildLiveMap(deps, tx, projectId, locale, read);
        if (!(await hasUnconfirmedChanges(deps, tx, projectId, locale, read, current))) return (await latestSnapshot(tx, pa.instanceId))!.confirmedAt;
      }
      await tx.query("UPDATE category_assessment SET lifecycle_status = 'confirmed' WHERE project_id = $1 AND lifecycle_status = 'proposed'", [projectId]);
      const live = await buildLiveMap(deps, tx, projectId, locale, read);
      if (live.content.groups.length === 0) throw new ApiError("NOT_READY");

      const current = await loadFactMap(tx, pa.instanceId);
      const visible = live.states.filter((s) => s.ref.lifecycle !== "not_selected");
      await recordSystemFact(tx, { projectId, scopeInstanceId: pa.instanceId, source: "precision_assessment", fieldKey: "pa_confirmed_categories", value: visible.map((s) => s.label), valueType: "text_list" }, current);
      const critical = live.states.filter((s) => s.ref.lifecycle === "in_progress").flatMap((s) => s.evaluation.critical.map((c) => c.label[locale] ?? Object.values(c.label)[0] ?? c.itemKey));
      await recordSystemFact(tx, { projectId, scopeInstanceId: pa.instanceId, source: "precision_assessment", fieldKey: "pa_critical_decisions", value: critical, valueType: "text_list" }, current);

      const content = { ...live.content, destination_codes: live.destinationCodes, client_request_id: requestKey };
      let snapshotId: string;
      if (pa.status === "ready_for_confirmation") snapshotId = await confirmPrecisionAssessment(tx, pa.instanceId, content);
      else snapshotId = (await tx.query<{ id: string }>("SELECT precision_psm_new_version($1, $2, $3::jsonb) AS id", [pa.instanceId, requestKey, JSON.stringify(content)])).rows[0]!.id;
      await emitEvent(tx, { name: "my_service_map_confirmed", eventKey: `my_service_map_confirmed:${snapshotId}`, projectId, locale, properties: { groups: live.content.groups.length } });
      return (await latestSnapshot(tx, pa.instanceId))!.confirmedAt;
    });
    return { confirmedAt: confirmedAt.toISOString(), serviceMap: await get(caller) };
  }

  return { get, confirm };
}
