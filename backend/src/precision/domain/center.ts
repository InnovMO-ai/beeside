/**
 * Entry, Cover, Center, Help. Everything here is a read model over the same state the conversations write:
 * the Center never keeps counters of its own.
 *
 *  - Cover: the approved, active photo of the single destination country, else the approved global photo, else a neutral
 *    composition. Multiple destinations use the global photo. An image reference that is not an https URL or a site path is ignored.
 *  - Operation Hub block: hidden until a first send was delivered; "pending access" until the platform says the client can
 *    enter; "enter" with the configured link. "Contact my Sherpa" only for an active, accessible hub with an assigned Sherpa.
 *  - Progress and status come from the engine's evaluation (`CategoryState`), never from the conversation.
 */
import type { AccessDto, CategoryCardDto, CenterDto, CoverDto, EntryDto, HelpDto, Locale } from "../api/dto";
import { ApiError } from "../api/errors";
import { addServiceAvailability, categoryInfo } from "../manifest";
import type { EntitlementState } from "../ports/entitlement";
import { accessPermits } from "../ports/entitlement";
import { describeError } from "../../security/redact";
import { progressOf, projectCountries } from "./categories";
import { CONFIG_KEYS, configUrl } from "./config";
import { understandingStateOf } from "./context-reader";
import type { PrecisionDomainDeps } from "./deps";
import { destinationsOf, type FaContextService } from "./fa-context";
import { buildLiveMap, diffAgainst, type Caller } from "./service-map";
import { ensurePaInstance, ensurePrecisionStarted, latestSnapshot, loadPaState, snapshotCount } from "./project-state";

export interface Actor extends Caller { entitlement: EntitlementState }

export const accessOf = (e: EntitlementState): AccessDto => ({ mode: e.accessMode, readOnlyUntil: e.readonlyUntil ?? null });
export const actorCan = (a: Pick<Actor, "entitlement">): boolean => accessPermits(a.entitlement.accessMode, "write");

const safeRef = (ref: string): string | null => (/^https:\/\/[^\s]+$/i.test(ref) || /^\/[^\s/][^\s]*$/.test(ref) ? ref : null);

export interface CenterService {
  entry(actor: Actor): Promise<EntryDto>;
  coverSeen(actor: Actor): Promise<{ ok: true }>;
  center(actor: Actor): Promise<CenterDto>;
  help(actor: Actor): Promise<HelpDto>;
  contact(actor: Actor, message: unknown): Promise<{ ok: true }>;
}

export function createCenterService(deps: PrecisionDomainDeps, fa: FaContextService): CenterService {
  async function coverFor(codes: string[], locale: Locale): Promise<CoverDto> {
    const pick = async (country: string): Promise<CoverDto["image"]> => {
      const r = (await deps.db.query<{ asset_ref: string; focal_x: number; focal_y: number; alt_text: Record<string, string> }>(
        "SELECT asset_ref, focal_x, focal_y, alt_text FROM precision_cover_asset WHERE country_code = $1 AND approved AND is_active", [country],
      )).rows[0];
      const url = r ? safeRef(r.asset_ref) : null;
      if (!r || !url) return null;
      const alt = r.alt_text?.[locale] ?? r.alt_text?.en ?? "";
      return { url, altText: typeof alt === "string" ? alt : "", focal: { x: r.focal_x, y: r.focal_y } };
    };
    const destinations = destinationsOf(codes, locale);
    if (codes.length === 1) {
      const photo = await pick(codes[0]!);
      if (photo) return { composition: "photo", image: photo, destinations };
    }
    const global = await pick("*");
    if (global) return { composition: "global", image: global, destinations };
    return { composition: "neutral", image: null, destinations };
  }

  async function entry(actor: Actor): Promise<EntryDto> {
    const { projectId, locale } = actor;
    const access = accessOf(actor.entitlement);
    if (actor.entitlement.accessMode === "REVOKED") return { screen: "center", locale, access, cover: null };
    if (actor.entitlement.accessMode === "FULL") {
      // first entry creates the project's Precision state; a failure here must not stop the page from opening
      try {
        await ensurePrecisionStarted(deps.db, projectId, locale, deps.now());
        await ensurePaInstance(deps.db, projectId);
      } catch (error) {
        deps.log("warn", "precision entry bootstrap failed", { error: describeError(error) });
      }
    }
    const seen = (await deps.db.query("SELECT 1 FROM precision_cover_seen WHERE project_id = $1", [projectId])).rows.length > 0;
    if (seen) return { screen: "center", locale, access, cover: null };
    const codes = await projectCountries(deps.db, projectId, await fa.read(projectId));
    return { screen: "cover", locale, access, cover: await coverFor(codes, locale) };
  }

  async function coverSeen(actor: Actor): Promise<{ ok: true }> {
    await deps.db.query("INSERT INTO precision_cover_seen (project_id) VALUES ($1) ON CONFLICT (project_id) DO NOTHING", [actor.projectId]);
    return { ok: true };
  }

  async function operationHubBlock(projectId: string, locale: Locale): Promise<{ block: CenterDto["operationHub"] }> {
    const state = await deps.delivery.getSendState(projectId).catch((error: unknown) => {
      deps.log("warn", "operation hub state unavailable", { error: describeError(error) });
      return null;
    });
    if (!state || state.ux.goToOperationHub === "hidden") return { block: { state: "hidden", url: null, contactSherpa: false } };
    if (state.ux.goToOperationHub === "enter") {
      const url = await configUrl(deps.db, CONFIG_KEYS.operationHubUrl, locale);
      // an accessible hub without a configured link cannot be entered from here: honest "pending access", never a dead button
      if (url) return { block: { state: "enter", url, contactSherpa: state.ux.contactMySherpa } };
    }
    return { block: { state: "pending_access", url: null, contactSherpa: false } };
  }

  async function center(actor: Actor): Promise<CenterDto> {
    const { projectId, locale } = actor;
    const read = await fa.read(projectId);
    const codes = await projectCountries(deps.db, projectId, read);
    const pa = await loadPaState(deps.db, projectId);
    const writable = actorCan(actor);

    let categories: CategoryCardDto[] = [];
    let confirmedAt: string | null = null;
    let unconfirmed = false;
    if (pa?.snapshotId) {
      const snap = await latestSnapshot(deps.db, pa.instanceId);
      confirmedAt = snap?.confirmedAt.toISOString() ?? null;
      const live = await buildLiveMap(deps, deps.db, projectId, locale, read);
      unconfirmed = snap ? diffAgainst(live.content, live.destinationCodes, snap.content as never, locale).length > 0 : false;
      categories = live.states
        .filter((s) => s.ref.lifecycle === "confirmed" || s.ref.lifecycle === "in_progress" || s.ref.lifecycle === "completed")
        .sort((a, b) => categoryInfo(a.ref.categoryKey).order - categoryInfo(b.ref.categoryKey).order || a.ref.createdAt.getTime() - b.ref.createdAt.getTime())
        .map((s) => {
          const p = progressOf(s);
          return { id: s.ref.instanceId, label: s.label, iconKey: s.iconKey, status: s.status, progressPct: p.progressPct, criticalOpen: p.criticalOpen, pendingCount: p.pendingCount, sendState: s.sendState };
        });
    }
    const count = pa ? await snapshotCount(deps.db, pa.instanceId) : 0;
    const hub = await operationHubBlock(projectId, locale);
    return {
      locale,
      access: accessOf(actor.entitlement),
      project: { destinations: destinationsOf(codes, locale), sector: read?.context.project.sector ?? null },
      understanding: { state: pa ? understandingStateOf(pa.status) : "not_started" },
      serviceMap: { available: pa?.status === "ready_for_confirmation" || pa?.status === "confirmed", confirmedAt, hasUnconfirmedChanges: unconfirmed },
      categories,
      addService: { available: addServiceAvailability({ paStatus: pa?.status ?? "not_started", snapshotCount: count, projectActive: writable }) },
      operationHub: hub.block,
      help: { helpCenterUrl: await configUrl(deps.db, CONFIG_KEYS.helpCenterUrl, locale) },
    };
  }

  async function help(actor: Actor): Promise<HelpDto> {
    return { helpCenterUrl: await configUrl(deps.db, CONFIG_KEYS.helpCenterUrl, actor.locale), contactAvailable: true };
  }

  async function contact(actor: Actor, message: unknown): Promise<{ ok: true }> {
    // eslint-disable-next-line no-control-regex -- strips NUL on purpose
    const text = typeof message === "string" ? message.replace(/\u0000/g, "").trim() : "";
    if (text.length < 1 || text.length > 2000) throw new ApiError("INVALID_INPUT");
    // The message is stored for the team; no response time is promised to the client.
    await deps.db.query("INSERT INTO outbox_event (project_id, event_type, payload, occurred_at) VALUES ($1, 'precision.contact_message', $2::jsonb, $3)", [
      actor.projectId,
      JSON.stringify({ message: text, locale: actor.locale }),
      deps.now(),
    ]);
    return { ok: true };
  }

  return { entry, coverSeen, center, help, contact };
}
