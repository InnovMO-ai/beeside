/**
 * The conversation module's `ContextReader`: everything a turn needs to know about the project, read fresh from the
 * database on every turn (no state is kept between turns, so a reload or a second instance behaves identically).
 *
 *  - understanding: the virtual `pa_*` manifest, the project's facts and the First Assessment values offered for confirmation;
 *  - category: the manifest version pinned on the assessment, its facts, the destination countries;
 *  - add_service: nothing to ask (the thread only collects a need), writable once the Service Map is confirmed.
 *
 * First Assessment values are PREFILL_CONFIRM: they are offered to the client as `inherited` entries and become a fact
 * only when the client confirms (provenance `client_confirmed`), with the source pin attached.
 */
import type { ContextReader, ConversationContext, InheritedValue, StateFlags, Surface, UnderstandingState } from "../conversation";
import { accessPermits } from "../ports/entitlement";
import { joinList } from "../manifest";
import type { PaStatus } from "../repository";
import type { Locale } from "../api/dto";
import { ApiError } from "../api/errors";
import { describeError } from "../../security/redact";
import { MAP_NEEDS_KEY, labelOf, parseMapNeeds, projectCountries } from "./categories";
import { loadCategoryRef, packSendState } from "./category-ref";
import type { CoreDeps } from "./deps-types";
import { loadFactMap } from "./facts";
import { destinationsOf, parseCountryCodes, parseTimeWindow, type FaContextService } from "./fa-context";
import { addServiceManifestContent, paManifestContent } from "./pa-manifest";
import { loadPaState } from "./project-state";
import { cleanText } from "../manifest";

const TITLES: Record<Surface, Record<Locale, string>> = {
  understanding: { en: "Your project", es: "Tu proyecto" },
  category: { en: "Service", es: "Servicio" },
  add_service: { en: "Add a service", es: "Agregar un servicio" },
};

export const understandingStateOf = (s: PaStatus): UnderstandingState =>
  s === "not_started" ? "not_started" : s === "in_progress" ? "in_progress" : s === "ready_for_confirmation" ? "ready_to_confirm" : "confirmed";

/** Values the First Assessment holds for Understanding fields that the client has not answered yet. */
export async function understandingInherited(
  deps: Pick<CoreDeps, "db" | "log">,
  fa: FaContextService,
  projectId: string,
  locale: Locale,
  answered: ReadonlySet<string>,
): Promise<InheritedValue[]> {
  const read = await fa.read(projectId);
  if (!read) return [];
  const p = read.context.project;
  const candidates: Array<{ fieldKey: string; value: unknown; displayText: string; ref: string }> = [];
  const objective = cleanText(p.expansionObjective ?? "");
  if (objective && !answered.has("pa_project_objective")) candidates.push({ fieldKey: "pa_project_objective", value: objective, displayText: objective, ref: "project.expansionObjective" });
  const codes = parseCountryCodes(p.destinationCountry);
  if (codes.length > 0 && !answered.has("pa_destination_countries")) {
    candidates.push({ fieldKey: "pa_destination_countries", value: codes, displayText: joinList(destinationsOf(codes, locale).map((d) => d.label), locale), ref: "project.destinationCountry" });
  }
  const window = parseTimeWindow(p.timeframe);
  if (window && !answered.has("pa_time_window")) candidates.push({ fieldKey: "pa_time_window", value: window, displayText: window, ref: "project.timeframe" });
  if (candidates.length === 0) return [];
  try {
    const pinId = await fa.ensurePin(deps.db, projectId, read);
    return candidates.map((c) => ({ fieldKey: c.fieldKey, value: c.value, displayText: c.displayText, sourcePinId: pinId, sourceItemRef: c.ref }));
  } catch (error) {
    deps.log("warn", "first assessment source pin could not be created", { error: describeError(error) });
    return []; // ask normally rather than offer a value without provenance
  }
}

export function createContextReader(deps: CoreDeps, fa: FaContextService): ContextReader {
  return {
    async load({ projectId, surface, scopeInstanceId, locale }): Promise<ConversationContext> {
      const entitlement = await deps.integrations.entitlement.get(projectId);
      const mode = entitlement.accessMode;
      const writable = accessPermits(mode, "write");
      const sendState = await deps.delivery.getSendState(projectId).catch(() => null);
      const pa = await loadPaState(deps.db, projectId);
      const baseFlags: StateFlags = {
        crpState: "none",
        firstSendDone: sendState?.firstSendDone ?? false,
        ohDeliveryState: "not_sent",
        sherpaAssigned: sendState?.ux.contactMySherpa ?? false,
        premiumMode: mode,
        serviceMapConfirmed: pa?.status === "confirmed",
      };
      const common = { projectId, surface, scopeInstanceId, locale, approvedSources: [], introducedTerms: [] as string[] };

      if (surface === "understanding") {
        if (!pa || pa.instanceId !== scopeInstanceId) throw new ApiError("NOT_FOUND");
        const facts = await loadFactMap(deps.db, scopeInstanceId);
        const read = await fa.read(projectId);
        const answered = new Set(Object.entries(facts).filter(([, f]) => f !== undefined).map(([k]) => k));
        const inherited = await understandingInherited(deps, fa, projectId, locale, answered);
        return {
          ...common,
          title: TITLES.understanding[locale],
          evaluation: { manifest: paManifestContent(), facts, countries: await projectCountries(deps.db, projectId, read) },
          inherited,
          flags: baseFlags,
          understandingState: understandingStateOf(pa.status),
          canWrite: writable,
        };
      }

      if (surface === "add_service") {
        if (!pa) throw new ApiError("NOT_FOUND");
        return {
          ...common,
          title: TITLES.add_service[locale],
          evaluation: { manifest: addServiceManifestContent(), facts: {}, countries: [] },
          inherited: [],
          flags: baseFlags,
          canWrite: writable && pa.status === "confirmed",
        };
      }

      const ref = await loadCategoryRef(deps.db, projectId, scopeInstanceId);
      if (!ref) throw new ApiError("NOT_FOUND");
      const manifest = await deps.registry.getManifestForCategory(ref.categoryKey, ref.manifestVersion);
      const facts = await loadFactMap(deps.db, scopeInstanceId);
      const read = await fa.read(projectId);
      const crpSend = ref.lifecycle === "completed" ? await packSendState(deps.db, ref.currentPackId) : "not_sent";
      const statusOf = ref.lifecycle === "completed" ? (crpSend === "sent" ? "sent" : "confirmed") : ref.lifecycle === "in_progress" ? "in_progress" : "not_started";
      return {
        ...common,
        title: labelOf(ref, parseMapNeeds(facts[MAP_NEEDS_KEY]?.value), locale),
        evaluation: { manifest: manifest.manifest, facts, countries: await projectCountries(deps.db, projectId, read) },
        inherited: [],
        flags: { ...baseFlags, crpState: ref.lifecycle === "completed" ? "confirmed" : ref.lifecycle === "in_progress" ? "in_progress" : "none", ohDeliveryState: crpSend },
        categoryStatus: statusOf,
        canWrite: writable && (ref.lifecycle === "confirmed" || ref.lifecycle === "in_progress"),
      };
    },
  };
}

export { MAP_NEEDS_KEY };
