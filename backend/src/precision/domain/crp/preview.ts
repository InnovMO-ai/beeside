/**
 * Preview before Send: a pure projection of the canonical payload (same builder as Send). The checksum is
 * `payloadChecksum(payload)`, so it changes whenever anything that would travel changes (confirmed pack, confirmed
 * My Service Map, company context, delivery kind): a stale checksum can never send a body the client did not see.
 */
import type { Locale, PreviewBlockDto, PreviewDto, ServiceMapGroupDto, ServiceMapViewDto } from "../../api/dto";
import { categoryInfo } from "../../manifest/categories";
import type { PrecisionDomainDeps } from "../deps";
import { emitEvent } from "../events";
import { toCrpView, viewLines } from "./content";
import { T, NOT_SENT } from "./copy";
import { failureAction } from "./data";
import { resolveCategory } from "./data";
import { buildHandoff, type Handoff, type PayloadPsm } from "./payload";
import type { CrpActor } from "./service";

type PreviewDeps = Pick<PrecisionDomainDeps, "db" | "now">;

function serviceMapView(psm: PayloadPsm, asOf: string, locale: Locale): ServiceMapViewDto {
  const groups: ServiceMapGroupDto[] = psm.categories.map((c) => {
    const info = categoryInfo(c.category_key ?? "new:review");
    return {
      categoryId: null,
      label: c.category_label,
      iconKey: info.iconKey,
      kind: c.kind as ServiceMapGroupDto["kind"],
      items: c.items.map((i, n) => ({
        id: `m${n + 1}`,
        label: i.label,
        why: i.why,
        priority: (i.priority as "high" | "medium" | "low" | null) ?? null,
        timing: i.timing,
        state: i.state as "confirmed" | "assumed" | "pending" | "not_applicable",
      })),
    };
  });
  return {
    title: T("mapTitle", locale),
    asOf,
    summary: {
      objective: psm.objectives[0] ?? null,
      destinations: psm.destinations.map((d) => ({ code: "", label: d })),
      timeWindow: psm.time_window,
      productOrService: psm.product_or_service,
    },
    groups,
    openItems: psm.open_items,
    changesSinceConfirmed: [],
  };
}

const line = (label: string, value: string | null): string[] => (value ? [`${label}: ${value}`] : []);

/** The blocks the client reviews, derived from the handoff (titles in the viewer's language; content as it will be sent). */
export function previewBlocks(h: Handoff, locale: Locale): PreviewBlockDto[] {
  const psm = h.psm;
  const projectLines = [
    ...line(T("company", locale), h.companyName),
    ...line(T("objective", locale), psm.objectives[0] ?? null),
    ...line(T("destination", locale), psm.destinations.join(", ") || null),
    ...line(T("timeWindow", locale), psm.time_window),
    ...line(T("product", locale), psm.product_or_service),
    ...line(T("operatingEntity", locale), psm.operating_entity),
  ];
  const mapView = serviceMapView(psm, h.payload.provenance.psm_confirmed_at, locale);
  const mapLines = psm.categories.flatMap((c) => [c.category_label, ...c.items.map((i) => i.label)]);
  const crpView = toCrpView(h.structured, {
    categoryId: h.category.instanceId,
    state: "confirmed",
    confirmedAt: h.pack.confirmedAt ? h.pack.confirmedAt.toISOString() : null,
    canConfirm: false,
    canRequestChanges: false,
    canStartNewVersion: false,
  });
  const contextLines = [...h.structured.required_later.map((l) => `${T("requiredLater", locale)}: ${l}`), ...psm.open_items.map((l) => `${T("openItems", locale)}: ${l}`)];
  return [
    { id: "project", title: T("project", locale), lines: projectLines },
    { id: "service_map", title: T("serviceMap", locale), lines: mapLines, view: mapView },
    { id: "crp", title: h.structured.title, lines: viewLines(crpView, h.contentLocale), view: crpView },
    { id: "context", title: T("context", locale), lines: contextLines },
  ];
}

export async function getPreview(deps: PreviewDeps, actor: CrpActor, categoryId: string): Promise<PreviewDto> {
  const category = await resolveCategory(deps.db, actor.projectId, categoryId);
  const h = await buildHandoff(deps.db, category, deps.now());
  const l = h.ledger;
  const blocked = l.blockedByOther && l.sendState !== "sent";
  const canSend = actor.canWrite && l.sendState !== "sent" && l.sendState !== "sending" && !blocked;
  const dto: PreviewDto = {
    categoryId: category.instanceId,
    previewChecksum: h.checksum,
    firstSend: h.payload.contract.kind === "first_send" && !blocked,
    blocks: previewBlocks(h, actor.locale),
    notSent: [...NOT_SENT[actor.locale]],
    sendState: l.sendState,
    canSend,
  };
  if (l.sendState === "failed") {
    const f = failureAction(l.lastErrorCode);
    dto.clientAction = f.clientAction;
    dto.retryable = f.retryable;
  }
  if (blocked) dto.blockedReason = "first_send_required";
  if (actor.canWrite) {
    await emitEvent(deps.db, {
      name: "handoff_previewed",
      eventKey: `handoff_previewed:${category.projectId}:${h.checksum}`,
      projectId: category.projectId,
      properties: { kind: h.payload.contract.kind, category_key: category.categoryKey },
      locale: actor.locale,
    }).catch(() => undefined);
  }
  return dto;
}
