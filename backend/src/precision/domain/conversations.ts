import { emitV1EventSafe, latencyBucket } from "../../analytics/v1-events";
/**
 * The three conversation surfaces (Understanding, Category, Add a Service): the thin domain layer around the conversation
 * engine. The engine phrases, extracts and verifies; this layer decides what the answers MEAN for the project:
 * lifecycle moves, analytics events, the Service Map side effects and the one DTO the client reads back.
 *
 * Reliability rules kept here:
 *  - A turn is idempotent by `turnKey` (the engine replays it) and processed once at a time per project (engine lock).
 *  - Facts and the events/lifecycle that follow from them are written in ONE transaction (`FactWriteHooks.afterWrite`).
 *  - Effects that follow a turn (Understanding readiness, Add a Service) are idempotent and recomputed on replay, so a crash
 *    between the engine and the effect is repaired by the client's retry with the same key.
 *  - An AI failure keeps the client's turn (retry with the same key); the thread read-back reports it as `pendingTurn`.
 */
import { describeError } from "../../security/redact";
import type {
  AddServiceThreadDto, CategoryDto, Locale, ThreadDto, ThreadSurface, TurnRequest, TurnResultDto,
} from "../api/dto";
import { ApiError } from "../api/errors";
import { plainCopy } from "../conversation/copy";
import type { ConversationStore, ProcessTurnInput, ProcessTurnResult } from "../conversation";
import { lastPending, toTurnDto } from "../conversation/thread-state";
import { addServiceAvailability, evaluateCategory } from "../manifest";
import { accessPermits } from "../ports/entitlement";
import type { PaStatus } from "../repository";
import { applyConfirmedNeed, classifyForProject } from "./add-service";
import { loadCategoryState, projectCountries, progressOf, syncProposals } from "./categories";
import { loadCategoryRef } from "./category-ref";
import { loadFrame, syncCategoryInheritance } from "./category-inheritance";
import { knowsPanel } from "../understanding/knows-panel";
import { CONFIG_KEYS, DEFAULT_RESUME_GAP_MINUTES, configNumber } from "./config";
import { understandingStateOf } from "./context-reader";
import type { PrecisionDomainDeps } from "./deps";
import type { CoreDeps } from "./deps-types";
import { emitEvent } from "./events";
import type { FactWriteHooks } from "./facts";
import type { FaContextService } from "./fa-context";
import { ensureAddServiceInstance, ensurePaInstance, loadPaState, snapshotCount, touchActivity } from "./project-state";
import type { Actor } from "./center";

const TITLES: Record<ThreadSurface, Record<Locale, string>> = {
  understanding: { en: "Your project", es: "Tu proyecto" },
  category: { en: "Service", es: "Servicio" },
  add_service: { en: "Add a service", es: "Agregar un servicio" },
};

const TURN_KEY = /^[A-Za-z0-9_.:-]{8,120}$/;
/** A client turn without an answer older than this is not "being processed" any more (the engine's whole-turn budget is 30 s). */
const PROCESSING_WINDOW_MS = 45_000;

// ------------------------------------------------------------------ request parsing
export function parseTurnRequest(body: unknown): Pick<ProcessTurnInput, "turnKey" | "text" | "quickReply" | "confirmAction"> {
  const b = body as Partial<TurnRequest> | null;
  if (!b || typeof b !== "object" || typeof b.turnKey !== "string" || !TURN_KEY.test(b.turnKey)) throw new ApiError("INVALID_INPUT");
  const turnKey = b.turnKey;
  const c = b.confirm;
  if (c !== undefined && c !== null) {
    if (typeof c !== "object" || typeof c.token !== "string" || c.token.length < 1 || c.token.length > 200 || (c.intent !== "confirm" && c.intent !== "correct")) throw new ApiError("INVALID_INPUT");
    return { turnKey, confirmAction: { token: c.token, intent: c.intent } };
  }
  const q = b.quickReply;
  if (q !== undefined && q !== null) {
    const intents = ["answer", "unknown", "withheld", "estimate", "confirm", "correct"];
    if (typeof q !== "object" || typeof q.value !== "string" || q.value.length < 1 || q.value.length > 500 || !intents.includes(q.intent)) throw new ApiError("INVALID_INPUT");
    return { turnKey, quickReply: { value: q.value, intent: q.intent } };
  }
  if (typeof b.text !== "string") throw new ApiError("INVALID_INPUT");
  // eslint-disable-next-line no-control-regex -- strips NUL on purpose
  const text = b.text.replace(/\u0000/g, "").trim();
  if (text.length < 1 || text.length > 8000) throw new ApiError("INVALID_INPUT");
  return { turnKey, text };
}

// ------------------------------------------------------------------ fact hooks (same transaction as the facts)
export function createFactHooks(deps: CoreDeps, fa: FaContextService): FactWriteHooks {
  return {
    async afterWrite(tx, info) {
      if (info.surface !== "category") return;
      const ref = await loadCategoryRef(tx, info.projectId, info.scopeInstanceId);
      if (!ref) return;
      const locale = ((await tx.query<{ locale: string }>("SELECT locale FROM precision_turn WHERE project_id = $1 AND turn_key = $2 AND role = 'client'", [info.projectId, info.turnKey])).rows[0]?.locale ?? "en") as Locale;
      if (ref.lifecycle === "confirmed") {
        await tx.query("UPDATE category_assessment SET lifecycle_status = 'in_progress' WHERE instance_id = $1 AND lifecycle_status = 'confirmed'", [ref.instanceId]);
        await emitEvent(tx, { name: "category_started", eventKey: `category_started:${ref.instanceId}`, projectId: info.projectId, locale, properties: { category_key: ref.categoryKey } });
      }
      const manifest = await deps.registry.getManifestForCategory(ref.categoryKey, ref.manifestVersion);
      const countries = await projectCountries(tx, info.projectId, await fa.read(info.projectId));
      let prev = evaluateCategory({ manifest: manifest.manifest, facts: info.before, countries });
      for (const step of info.steps) {
        const cur = evaluateCategory({ manifest: manifest.manifest, facts: step.after, countries });
        const base = `${ref.instanceId}`;
        if (cur.progressPct !== prev.progressPct) {
          await emitEvent(tx, { name: "category_progress_changed", eventKey: `category_progress_changed:${base}:${step.factId}`, projectId: info.projectId, locale, properties: { category_key: ref.categoryKey, progress_pct: cur.progressPct } });
        }
        const before = new Set(prev.critical.map((c) => c.itemKey));
        const after = new Set(cur.critical.map((c) => c.itemKey));
        for (const k of after) if (!before.has(k)) await emitEvent(tx, { name: "critical_item_created", eventKey: `critical_item_created:${base}:${k}:${step.factId}`, projectId: info.projectId, locale, properties: { category_key: ref.categoryKey, item_key: k } });
        for (const k of before) if (!after.has(k)) await emitEvent(tx, { name: "critical_item_resolved", eventKey: `critical_item_resolved:${base}:${k}:${step.factId}`, projectId: info.projectId, locale, properties: { category_key: ref.categoryKey, item_key: k } });
        if (!prev.ready && cur.ready) await emitEvent(tx, { name: "crp_ready_for_review", eventKey: `crp_ready_for_review:${base}:${step.factId}`, projectId: info.projectId, locale, properties: { category_key: ref.categoryKey } });
        prev = cur;
      }
    },
  };
}

// ------------------------------------------------------------------ services
export interface ThreadServices {
  understanding: { get(actor: Actor): Promise<ThreadDto>; turn(actor: Actor, body: unknown): Promise<TurnResultDto> };
  category: { get(actor: Actor, id: string): Promise<CategoryDto>; turn(actor: Actor, id: string, body: unknown): Promise<TurnResultDto> };
  addService: { get(actor: Actor): Promise<AddServiceThreadDto>; turn(actor: Actor, body: unknown): Promise<TurnResultDto> };
}

const resultDto = (r: ProcessTurnResult, extra: Partial<TurnResultDto>): TurnResultDto => ({
  status: r.status,
  turns: r.turns,
  progress: r.progress,
  understandingState: r.understandingState,
  serviceMapChanged: r.serviceMapChanged,
  retryable: r.retryable,
  ...extra,
});

export function createThreadServices(deps: PrecisionDomainDeps, fa: FaContextService, store: ConversationStore): ThreadServices {
  const inFlight = new Set<string>();
  const failed = new Set<string>();

  const canWrite = (a: Actor): boolean => accessPermits(a.entitlement.accessMode, "write");

  async function pendingTurn(projectId: string, scopeId: string): Promise<ThreadDto["pendingTurn"]> {
    const r = (await deps.db.query<{ turn_key: string; created_at: Date }>(
      `SELECT c.turn_key, c.created_at FROM precision_turn c
        WHERE c.project_id = $1 AND c.scope_instance_id = $2 AND c.role = 'client'
          AND NOT EXISTS (SELECT 1 FROM precision_turn a WHERE a.project_id = c.project_id AND a.turn_key = c.turn_key AND a.role = 'assistant')
        ORDER BY c.seq DESC LIMIT 1`,
      [projectId, scopeId],
    )).rows[0];
    if (!r) return null;
    if (inFlight.has(r.turn_key)) return { turnKey: r.turn_key, status: "processing" };
    if (failed.has(r.turn_key)) return { turnKey: r.turn_key, status: "ai_unavailable" };
    return { turnKey: r.turn_key, status: deps.now().getTime() - r.created_at.getTime() < PROCESSING_WINDOW_MS ? "processing" : "ai_unavailable" };
  }

  async function disclosureShown(projectId: string): Promise<boolean> {
    return (await deps.db.query("SELECT 1 FROM precision_turn WHERE project_id = $1 AND role = 'assistant' AND kind = 'disclosure' LIMIT 1", [projectId])).rows.length > 0;
  }

  async function threadOf(actor: Actor, surface: ThreadSurface, scopeId: string, title: string, open: ProcessTurnResult, over: Partial<ThreadDto>): Promise<ThreadDto> {
    return {
      surface,
      scopeId,
      title,
      turns: open.turns,
      progress: null,
      understandingState: null,
      aiDisclosureShown: await disclosureShown(actor.projectId),
      canWrite: open.status === "ok" && canWrite(actor),
      pendingTurn: await pendingTurn(actor.projectId, scopeId),
      ...over,
    };
  }

  /** Runs the engine for one turn with the in-flight / failed bookkeeping the read-back needs. */
  async function runTurn(input: ProcessTurnInput): Promise<ProcessTurnResult> {
    inFlight.add(input.turnKey);
    failed.delete(input.turnKey);
    const started = Date.now();
    try {
      const r = await deps.conversation.processTurn(input);
      if (r.status === "ai_unavailable") failed.add(input.turnKey);
      // Experience signal only (surface, outcome, latency bucket): never the text of the conversation.
      if (r.status === "ok" || r.status === "ai_unavailable") await emitV1EventSafe(deps.db, "ai_turn_completed", {
        projectId: input.projectId,
        eventKey: `ai_turn_completed:${input.turnKey}:${r.status}`,
        locale: input.locale,
        properties: { surface: input.surface === "understanding" ? "understanding" : "category", status: r.status, latency_bucket: latencyBucket(Date.now() - started) },
      });
      return r;
    } finally {
      inFlight.delete(input.turnKey);
    }
  }

  // ---------------------------------------------------------------- Understanding
  async function startUnderstanding(projectId: string, instanceId: string, locale: Locale): Promise<void> {
    await deps.db.transaction(async (tx) => {
      const r = await tx.query("UPDATE precision_assessment SET lifecycle_status = 'in_progress' WHERE instance_id = $1 AND lifecycle_status = 'not_started'", [instanceId]);
      if ((r.rowCount ?? 0) > 0) await emitEvent(tx, { name: "understanding_started", eventKey: `understanding_started:${projectId}`, projectId, locale });
    });
  }

  async function noteActivity(projectId: string, instanceId: string, wasStarted: boolean, locale: Locale): Promise<void> {
    const now = deps.now();
    const prior = await touchActivity(deps.db, instanceId, now);
    if (!wasStarted || !prior) return;
    const gapMin = await configNumber(deps.db, CONFIG_KEYS.resumeGapMinutes, locale, DEFAULT_RESUME_GAP_MINUTES);
    if (now.getTime() - prior.getTime() > gapMin * 60_000) {
      await emitEvent(deps.db, { name: "understanding_resumed", eventKey: `understanding_resumed:${projectId}:${prior.getTime()}`, projectId, locale });
    }
  }

  /** Moves the Understanding between in_progress and ready_for_confirmation to follow the engine's readiness. Returns the resulting status. */
  async function followReadiness(projectId: string, locale: Locale, ready: boolean): Promise<PaStatus> {
    const pa = await loadPaState(deps.db, projectId);
    if (!pa) throw new ApiError("NOT_FOUND");
    if (pa.status === "confirmed" || pa.status === "not_started") return pa.status;
    const want: PaStatus = ready ? "ready_for_confirmation" : "in_progress";
    if (pa.status === want) return pa.status;
    return deps.db.transaction(async (tx) => {
      const r = await tx.query("UPDATE precision_assessment SET lifecycle_status = $3 WHERE instance_id = $1 AND lifecycle_status = $2", [pa.instanceId, pa.status, want]);
      if ((r.rowCount ?? 0) > 0 && want === "ready_for_confirmation") {
        const cycle = (await snapshotCount(tx, pa.instanceId)) + 1;
        await emitEvent(tx, { name: "my_service_map_ready", eventKey: `my_service_map_ready:${projectId}:${cycle}`, projectId, locale });
      }
      return ((await loadPaState(tx, projectId))?.status ?? want) as PaStatus;
    });
  }

  const understanding: ThreadServices["understanding"] = {
    async get(actor) {
      const { projectId, locale } = actor;
      let pa = canWrite(actor) ? await ensurePaInstance(deps.db, projectId) : await loadPaState(deps.db, projectId);
      if (!pa) throw new ApiError("NOT_FOUND");
      const ctx = await fa.readWithStatus(projectId);
      // The opening offers the inherited values for confirmation. If the First Assessment reader failed just now and the thread has not
      // been opened yet, opening it would permanently lose those offers: ask the client to try again instead (nothing is saved, nothing is lost).
      if (canWrite(actor) && ctx.failed && (await store.loadThread(projectId, pa.instanceId, 1)).length === 0) throw new ApiError("TEMPORARILY_UNAVAILABLE", true);
      if (canWrite(actor)) await syncProposals(deps, projectId, ctx.read);
      const open = await deps.conversation.openThread({ projectId, surface: "understanding", scopeInstanceId: pa.instanceId, locale });
      pa = (await loadPaState(deps.db, projectId)) ?? pa;
      return threadOf(actor, "understanding", pa.instanceId, TITLES.understanding[locale], open, { understandingState: understandingStateOf(pa.status) });
    },

    async turn(actor, body) {
      const parsed = parseTurnRequest(body);
      const { projectId, locale } = actor;
      const pa0 = await ensurePaInstance(deps.db, projectId);
      await syncProposals(deps, projectId, await fa.read(projectId));
      const wasStarted = pa0.status !== "not_started";
      await startUnderstanding(projectId, pa0.instanceId, locale);
      await noteActivity(projectId, pa0.instanceId, wasStarted, locale);
      const r = await runTurn({ projectId, surface: "understanding", scopeInstanceId: pa0.instanceId, locale, ...parsed });
      let status: PaStatus = (await loadPaState(deps.db, projectId))?.status ?? pa0.status;
      if (r.status === "ok") status = await followReadiness(projectId, locale, r.understandingState === "ready_to_confirm");
      return resultDto(r, { progress: null, understandingState: understandingStateOf(status), serviceMapChanged: false });
    },
  };

  // ---------------------------------------------------------------- Category
  async function visibleRef(projectId: string, id: string) {
    const ref = await loadCategoryRef(deps.db, projectId, id);
    const pa = await loadPaState(deps.db, projectId);
    if (!ref || !pa?.snapshotId || ref.lifecycle === "proposed") throw new ApiError("NOT_FOUND");
    return ref;
  }

  /** "Lo que ya sé de esta parte de tu proyecto": best effort (a category without a frame simply has no panel). */
  async function knowsFor(projectId: string, instanceId: string, categoryKey: string) {
    try {
      await syncCategoryInheritance(deps, projectId, instanceId);
      const frame = await loadFrame(deps.db, projectId);
      return frame ? knowsPanel(frame, categoryKey) : null;
    } catch (error) {
      deps.log("warn", "knows panel could not be built", { error: describeError(error) });
      return null;
    }
  }

  const category: ThreadServices["category"] = {
    async get(actor, id) {
      const { projectId, locale } = actor;
      const ref = await visibleRef(projectId, id);
      const read = await fa.read(projectId);
      const countries = await projectCountries(deps.db, projectId, read);
      const open = await deps.conversation.openThread({ projectId, surface: "category", scopeInstanceId: ref.instanceId, locale });
      const state = await loadCategoryState(deps, (await loadCategoryRef(deps.db, projectId, id)) ?? ref, countries, locale);
      const progress = progressOf(state);
      const thread = await threadOf(actor, "category", ref.instanceId, state.label, open, {
        progress,
        canWrite: open.status === "ok" && canWrite(actor) && (state.ref.lifecycle === "confirmed" || state.ref.lifecycle === "in_progress"),
      });
      const knows = await knowsFor(projectId, ref.instanceId, ref.categoryKey);
      return { id: ref.instanceId, label: state.label, iconKey: state.iconKey, status: state.status, progress, sendState: state.sendState, thread, knows };
    },

    async turn(actor, id, body) {
      const parsed = parseTurnRequest(body);
      const { projectId, locale } = actor;
      const ref = await visibleRef(projectId, id);
      const r = await runTurn({ projectId, surface: "category", scopeInstanceId: ref.instanceId, locale, ...parsed });
      const countries = await projectCountries(deps.db, projectId, await fa.read(projectId));
      const state = await loadCategoryState(deps, (await loadCategoryRef(deps.db, projectId, id)) ?? ref, countries, locale);
      return resultDto(r, { progress: progressOf(state), understandingState: null, serviceMapChanged: false });
    },
  };

  // ---------------------------------------------------------------- Add a Service
  async function available(actor: Actor): Promise<boolean> {
    const pa = await loadPaState(deps.db, actor.projectId);
    if (!pa) return false;
    return addServiceAvailability({ paStatus: pa.status, snapshotCount: await snapshotCount(deps.db, pa.instanceId), projectActive: canWrite(actor) });
  }

  /** The need the client confirmed in `turnKey`, found in the thread (the engine does not report it again on a replay). */
  async function confirmedNeedOf(projectId: string, scopeId: string, turnKey: string): Promise<string | null> {
    const found = await store.findByTurnKey(projectId, turnKey);
    const ack = found.assistant;
    if (!ack || !(ack.structured as { copyKeys?: string[] }).copyKeys?.includes("add_service_confirmed_ack")) return null;
    const thread = await store.loadThread(projectId, scopeId, 20);
    const before = thread.filter((t) => t.seq < ack.seq && t.role === "assistant");
    for (let i = before.length - 1; i >= 0; i--) {
      const st = (before[i]!.structured as { state?: { mode?: string; need?: string } }).state;
      if (st?.mode === "need_confirm" && typeof st.need === "string") return st.need;
    }
    return null;
  }

  async function noticeTurn(projectId: string, scopeId: string, turnKey: string, locale: Locale, copyKey: string) {
    const text = plainCopy(copyKey, locale);
    const p = await store.persistTurn({
      projectId, scopeInstanceId: scopeId, turnKey: `notice.${turnKey}`.slice(0, 120), role: "assistant", surface: "add_service", kind: "notice", locale, content: text,
      structured: { state: { mode: "closed", fieldKey: null, pendingQuestion: text }, copyKeys: [copyKey] },
    });
    return toTurnDto(p.turn);
  }

  /** One `add_service_started` per Add a Service cycle (a cycle ends when a need is applied). Called only after a turn was accepted. */
  async function noteAddServiceStarted(projectId: string, locale: Locale): Promise<void> {
    const completed = Number((await deps.db.query<{ n: string }>("SELECT count(*) AS n FROM precision_journey_event WHERE project_id = $1 AND event_name = 'add_service_completed'", [projectId])).rows[0]?.n ?? 0);
    await emitEvent(deps.db, { name: "add_service_started", eventKey: `add_service_started:${projectId}:${completed + 1}`, projectId, locale });
  }

  const addService: ThreadServices["addService"] = {
    async get(actor) {
      const { projectId, locale } = actor;
      if (!(await available(actor))) return { available: false, thread: null };
      const scopeId = await ensureAddServiceInstance(deps.db, projectId);
      const open = await deps.conversation.openThread({ projectId, surface: "add_service", scopeInstanceId: scopeId, locale });
      return { available: true, thread: await threadOf(actor, "add_service", scopeId, TITLES.add_service[locale], open, {}) };
    },

    async turn(actor, body) {
      const parsed = parseTurnRequest(body);
      const { projectId, locale } = actor;
      if (!(await available(actor))) throw new ApiError("CONFLICT");
      const scopeId = await ensureAddServiceInstance(deps.db, projectId);
      const base: ProcessTurnInput = { projectId, surface: "add_service", scopeInstanceId: scopeId, locale, ...parsed };

      // A confirmation of an out-of-scope need must not be answered with "I am adding it": decide before the engine speaks.
      const confirming = base.confirmAction?.intent === "confirm" || base.quickReply?.intent === "confirm";
      if (confirming && (await store.findByTurnKey(projectId, parsed.turnKey)).assistant === null) {
        const pend = lastPending(await store.loadThread(projectId, scopeId, 20));
        const need = pend?.state.mode === "need_confirm" ? pend.state.need : undefined;
        const tokenOk = !base.confirmAction || pend?.state.confirmToken === base.confirmAction.token;
        if (need && tokenOk) {
          const pa = await loadPaState(deps.db, projectId);
          const d = pa ? await classifyForProject(deps, deps.db, projectId, pa.manifestVersion, need) : null;
          if (d?.outOfScope) {
            const clientText = plainCopy("confirm_yes", locale);
            const c = await store.persistTurn({ projectId, scopeInstanceId: scopeId, turnKey: parsed.turnKey, role: "client", surface: "add_service", kind: "message", locale, content: clientText, structured: {} });
            const notice = await noticeTurn(projectId, scopeId, parsed.turnKey, locale, d.outOfScope);
            await noteAddServiceStarted(projectId, locale);
            return { status: "ok", turns: [toTurnDto(c.turn), notice], progress: null, understandingState: null, serviceMapChanged: false, retryable: false };
          }
        }
      }

      const r = await runTurn(base);
      if (r.status !== "ok") return resultDto(r, { progress: null, understandingState: null, serviceMapChanged: false });
      await noteAddServiceStarted(projectId, locale);
      const need = r.confirmedServiceNeed ?? (await confirmedNeedOf(projectId, scopeId, parsed.turnKey));
      if (!need) return resultDto(r, { progress: null, understandingState: null, serviceMapChanged: false });
      try {
        const outcome = await applyConfirmedNeed(deps, await fa.read(projectId), { projectId, locale, turnKey: parsed.turnKey, need });
        if (outcome.kind === "out_of_scope") {
          const notice = await noticeTurn(projectId, scopeId, parsed.turnKey, locale, outcome.noticeCopyKey ?? "add_service_not_available_yet");
          return resultDto(r, { turns: [...r.turns, notice], progress: null, understandingState: null, serviceMapChanged: false });
        }
        return resultDto(r, { progress: null, understandingState: null, serviceMapChanged: true });
      } catch (error) {
        // The acknowledgement is saved but the map was not updated: say so honestly and let the same retry finish the work.
        deps.log("error", "add a service effect failed", { error: describeError(error) });
        throw error;
      }
    },
  };

  return { understanding, category, addService };
}

