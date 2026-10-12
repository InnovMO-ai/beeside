/**
 * In-memory implementation of the Precision API contract (docs/f5/precision-dto.ts). Stateful: conversation, quick replies, confirm cards,
 * progress, My Service Map, CRP, preview checksum and the send state machine behave as the contract describes, so the whole journey runs
 * and is testable before the backend exists.
 *
 * This module is a separate chunk that is only reachable when the app is BUILT with VITE_PRECISION_API_MODE=mock (see api/client.ts).
 * It is never part of a live build. Failure injection (window.__PRECISION_MOCK__ and the ?mock= switches) exists only here.
 */
import type {
  AccessDto, AccessMode, AddServiceThreadDto, CategoryCardDto, CategoryDto, CategoryProgressDto, CategoryStatus, CenterDto, CoverDto, CrpRequirementDto, CrpSectionDto, CrpViewDto,
  EntryDto, HelpDto, ItemState, Locale, PreviewDto, SendResultDto, SendStateDto, ServiceMapDto, ServiceMapGroupDto, ServiceMapViewDto, ThreadDto, TurnDto, TurnResultDto, UnderstandingState,
} from "../api/dto";
import { ApiFailure, type Transport, type TransportRequest, type TransportResponse } from "../api/transport";
import {
  askTurn, blockingGap, categoryFx, interviewStep, newInterview, processReply, progressOf, turn, isProcessQuestion, lastQuestionTurn,
  type Ids, type Interview, type StepInput, type StoredTurn,
} from "./engine";
import {
  bi, CATEGORY_ORDER, COMPANY, DISCLOSURE, EXTRA_CATEGORY_LABELS, MAP_ITEMS, MAP_OPEN_ITEMS, NEEDS_KNOWN, UNDERSTANDING_QUESTIONS, type Bi,
} from "./fixtures";

type Err = "UNAUTHENTICATED" | "PRECISION_READ_ONLY" | "PRECISION_REVOKED" | "NOT_FOUND" | "INVALID_INPUT" | "CONFLICT" | "PREVIEW_STALE" | "ACTIVATION_PENDING_RETRY_FIRST" | "NOT_READY" | "RATE_LIMITED" | "TEMPORARILY_UNAVAILABLE";
const HTTP: Record<Err, number> = { UNAUTHENTICATED: 401, PRECISION_READ_ONLY: 403, PRECISION_REVOKED: 403, NOT_FOUND: 404, INVALID_INPUT: 400, CONFLICT: 409, PREVIEW_STALE: 409, ACTIVATION_PENDING_RETRY_FIRST: 409, NOT_READY: 409, RATE_LIMITED: 429, TEMPORARILY_UNAVAILABLE: 503 };
const fail = (e: Err): never => { throw new HttpError(e); };
class HttpError extends Error { constructor(readonly code: Err) { super(code); } }

interface CatState { iv: Interview; lifecycle: "confirmed" | "in_progress" | "completed"; packVersion: number; confirmedAt: string | null; requestKeys: string[] }
interface SendState { packVersion: number; state: SendStateDto; attempts: number; settleAt: number | null; outcome: "sent" | "failed"; clientAction: SendResultDto["clientAction"] }
interface Need { id: string; text: string; category: string | null; confirmedInMap: boolean }
interface AddThread { turns: StoredTurn[]; stage: "ask" | "confirm"; pendingNeed: string | null; started: boolean }
interface Processing { readyAt: number; scope: string; input: StepInput; clientId: string }
interface TurnResultStored { status: "ok" | "blocked"; turnIds: string[]; mapChanged: boolean; scope: string }

/** What the API answers from configuration (the approved defaults of the backend configuration layer); never read by a screen directly. */
const MOCK_LINKS = {
  helpCenterUrl: "https://www.beeside.you/helpcenter",
  privacyUrl: "https://www.beeside.you/privacy",
  termsUrl: "https://beeside.you/termsandconditions",
  contactEmail: "contact@beeside.you",
} as const;

export interface MockConfig {
  latency: number;
  turnLatency: number;
  ohDelay: number;
  helpUrl: string | null;
  cover: CoverDto["composition"];
  ohMode: "pending_access" | "enter";
  contactSherpa: boolean;
}
interface MockState {
  seq: number;
  access: AccessDto;
  coverSeen: boolean;
  cfg: MockConfig;
  understanding: Interview;
  summaryConfirmed: boolean;
  smConfirmedAt: string | null;
  confirmedCategories: string[];
  smRequestKeys: string[];
  needs: Need[];
  add: AddThread;
  cats: Record<string, CatState>;
  sends: Record<string, SendState>;
  firstDelivered: boolean;
  firstAttemptCat: string | null;
  processing: Record<string, Processing>;
  results: Record<string, TurnResultStored>;
  failedKeys: Record<string, Processing>;
  inject: Record<string, number>;
  salt: number;
  contacts: string[];
  stats: { requests: number; turnCalls: number; sendCalls: number; confirmCrpCalls: number; confirmMapCalls: number };
}

const STORE_KEY = "precision.mock.state.v1";
const TOKEN_PREFIX = "mock-session-";

export interface MockControl {
  reset: () => void;
  /** Failure injection. kinds: ai_unavailable, offline, unavailable, unauthenticated, preview_stale, oh_fail, oh_fail_terminal, send_slow (OH does not answer for 25 s). */
  inject: (kind: string, count?: number) => void;
  setLatency: (ms: number, turnMs?: number) => void;
  setAccess: (mode: AccessMode, readOnlyUntil?: string | null) => void;
  setCover: (c: CoverDto["composition"]) => void;
  setOh: (mode: "pending_access" | "enter", contactSherpa?: boolean) => void;
  setHelpUrl: (u: string | null) => void;
  preset: (name: string) => void;
  stats: () => MockState["stats"];
  snapshot: () => MockState;
}

function freshState(): MockState {
  return {
    seq: 0, access: { mode: "FULL", readOnlyUntil: null }, coverSeen: false,
    cfg: { latency: 120, turnLatency: 1800, ohDelay: 2500, helpUrl: MOCK_LINKS.helpCenterUrl, cover: "neutral", ohMode: "pending_access", contactSherpa: false },
    understanding: newInterview(), summaryConfirmed: false, smConfirmedAt: null, confirmedCategories: [], smRequestKeys: [], needs: [],
    add: { turns: [], stage: "ask", pendingNeed: null, started: false },
    cats: {}, sends: {}, firstDelivered: false, firstAttemptCat: null, processing: {}, results: {}, failedKeys: {}, inject: {}, salt: 0, contacts: [],
    stats: { requests: 0, turnCalls: 0, sendCalls: 0, confirmCrpCalls: 0, confirmMapCalls: 0 },
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16).padStart(8, "0"); };
const loc = (b: Bi, l: Locale) => b[l];

export interface MockOptions { persist?: boolean; query?: string; now?: () => number }

export function createMockServer(opts: MockOptions = {}) {
  const persist = opts.persist ?? true;
  const nowMs = opts.now ?? (() => Date.now());
  const restored = load();
  let st: MockState = restored ?? freshState();
  const bootQuery = opts.query ?? (typeof window !== "undefined" ? window.location.search : "");

  function load(): MockState | null {
    if (!persist) return null;
    try { const raw = sessionStorage.getItem(STORE_KEY); return raw ? (JSON.parse(raw) as MockState) : null; } catch { return null; }
  }
  function save() { if (persist) { try { sessionStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch { /* memory only */ } } }
  const ids: Ids = { next: () => `t${++st.seq}`, now: () => new Date(nowMs()).toISOString() };

  function applyQuery(q: string) {
    const raw = new URLSearchParams(q).get("mock");
    if (!raw) return;
    for (const part of raw.split(",")) {
      const [k, v = ""] = part.split(":");
      if (k === "latency") { st.cfg.latency = Number(v); st.cfg.turnLatency = Number(v); }
      else if (k === "turn") st.cfg.turnLatency = Number(v);
      else if (k === "oh") st.cfg.ohDelay = Number(v);
      else if (k === "cover" && (v === "photo" || v === "global" || v === "neutral")) st.cfg.cover = v;
      else if (k === "access" && v) st.access = v === "read_only" ? { mode: "READ_ONLY", readOnlyUntil: "2026-12-18T00:00:00.000Z" } : v === "revoked" ? { mode: "REVOKED", readOnlyUntil: null } : st.access;
      else if (k === "ohmode" && (v === "enter" || v === "pending_access")) st.cfg.ohMode = v;
      else if (k === "sherpa") st.cfg.contactSherpa = true;
      else if (k === "fail" && v) st.inject[v] = (st.inject[v] ?? 0) + 1;
      else if (k === "preset" && v) runPreset(v);
    }
    save();
  }

  // ------------------------------------------------------------------ projections
  const mapOf = (id: string) => categoryFx(id);
  function uState(): UnderstandingState {
    if (!st.understanding.started) return "not_started";
    if (st.smConfirmedAt) return "confirmed";
    return st.summaryConfirmed ? "ready_to_confirm" : "in_progress";
  }
  const ser = (t: StoredTurn, l: Locale): TurnDto => ({
    id: t.id, role: t.role, kind: t.kind, text: loc(t.text, l), createdAt: t.createdAt,
    ...(t.quickReplies ? { quickReplies: t.quickReplies.map((q) => ({ value: q.value, label: loc(q.label, l), intent: q.intent })) } : {}),
    ...(t.confirmCard ? { confirmCard: { kind: t.confirmCard.kind, title: loc(t.confirmCard.title, l), body: loc(t.confirmCard.body, l), confirmLabel: loc(t.confirmCard.confirmLabel, l), correctLabel: loc(t.confirmCard.correctLabel, l), token: t.confirmCard.token } } : {}),
  });
  const canWrite = () => st.access.mode === "FULL";

  function ensureUnderstandingThread() {
    const u = st.understanding;
    if (u.turns.length) return;
    u.turns.push(turn(ids, "assistant", "disclosure", DISCLOSURE));
    u.current = UNDERSTANDING_QUESTIONS[0].key; u.stage = "asking";
    u.turns.push(askTurn(ids, "understanding", UNDERSTANDING_QUESTIONS[0]));
  }
  function ensureCategoryThread(id: string) {
    const fx = mapOf(id)!; const c = st.cats[id];
    if (c.iv.turns.length) return;
    const first = fx.questions[0];
    c.iv.current = first.key; c.iv.stage = "asking";
    c.iv.turns.push(askTurn(ids, `category:${id}`, first, fx.intro));
  }
  function ensureAddThread() {
    if (st.add.started) return;
    st.add.started = true;
    st.add.turns.push(turn(ids, "assistant", "message", bi("Tell me what you need.", "Cuéntame qué necesitas.")));
  }

  function catProgress(id: string): CategoryProgressDto & { ready: boolean } {
    const fx = mapOf(id)!; const c = st.cats[id];
    const p = progressOf(c.iv, fx.questions);
    return { progressPct: c.iv.started ? p.progressPct : p.progressPct, criticalOpen: p.criticalOpen, pendingCount: p.pendingCount, ready: p.ready, status: catStatus(id) };
  }
  function sendStateOf(id: string): SendStateDto {
    const s = st.sends[id]; const c = st.cats[id];
    return s && c && s.packVersion === c.packVersion ? s.state : "not_sent";
  }
  function catStatus(id: string): CategoryStatus {
    const fx = mapOf(id)!; const c = st.cats[id];
    if (c.lifecycle === "completed") return sendStateOf(id) === "sent" ? "sent" : "confirmed";
    if (!c.iv.started) return "not_started";
    return progressOf(c.iv, fx.questions).ready ? "ready_for_review" : "in_progress";
  }
  function progressDto(id: string): CategoryProgressDto {
    const p = catProgress(id);
    return { progressPct: p.progressPct, criticalOpen: p.criticalOpen, pendingCount: p.pendingCount, ready: p.ready, status: catStatus(id) };
  }

  function operationHub(): CenterDto["operationHub"] {
    if (!st.firstDelivered) return { state: "hidden", url: null, contactSherpa: false };
    const enter = st.cfg.ohMode === "enter";
    return { state: st.cfg.ohMode, url: enter ? "https://operationhub.beeside.example/" : null, contactSherpa: enter && st.cfg.contactSherpa };
  }
  const destinations = (l: Locale) => [{ code: "MX", label: l === "es" ? "México" : "Mexico" }];

  function center(l: Locale): CenterDto {
    const cards: CategoryCardDto[] = st.smConfirmedAt ? st.confirmedCategories.map((id) => {
      const p = progressDto(id);
      return { id, label: loc(mapOf(id)!.label, l), iconKey: mapOf(id)!.iconKey, status: p.status, progressPct: p.progressPct, criticalOpen: p.criticalOpen, pendingCount: p.pendingCount, sendState: sendStateOf(id) };
    }) : [];
    return {
      locale: l, access: st.access,
      project: { destinations: destinations(l), sector: l === "es" ? "Alimentos especializados" : "Specialty food" },
      understanding: { state: uState() },
      serviceMap: { available: ["ready_to_confirm", "confirmed"].includes(uState()), confirmedAt: st.smConfirmedAt, hasUnconfirmedChanges: hasUnconfirmed() },
      categories: cards,
      addService: { available: st.smConfirmedAt !== null },
      operationHub: operationHub(),
      help: { helpCenterUrl: st.cfg.helpUrl },
    };
  }

  const hasUnconfirmed = () => st.smConfirmedAt !== null && st.needs.some((n) => !n.confirmedInMap);

  function mapView(l: Locale, mode: "live" | "confirmed"): ServiceMapViewDto {
    const a = st.understanding.answers;
    const val = (k: string): string | null => (a[k] && a[k].state !== "unknown" ? a[k].text.en : null);
    const needs = st.needs.filter((n) => mode === "live" || n.confirmedInMap);
    const baseIds = mode === "confirmed" ? st.confirmedCategories.filter((c) => CATEGORY_ORDER.includes(c)) : CATEGORY_ORDER;
    const extraIds = [...new Set(needs.filter((n) => n.category).map((n) => n.category as string))];
    const groups: ServiceMapGroupDto[] = [];
    for (const id of [...baseIds, ...extraIds]) {
      const fx = mapOf(id)!;
      const items = (MAP_ITEMS[id] ?? needs.filter((n) => n.category === id).map((n) => ({
        id: `sm-${n.id}`, label: bi(n.text, n.text), why: bi("You asked us to add it.", "Nos pediste agregarlo."), priority: "medium" as const, timing: bi("To be defined", "Por definir"), state: "pending" as const,
      }))).map((it) => ({
        id: it.id, label: loc(it.label, l), why: loc(it.why, l), priority: it.priority, timing: loc(it.timing, l),
        state: (it.id === "sm-cla-1" && a.pa_operating_entity?.state === "unknown" ? "pending" : it.state) as ItemState,
      }));
      groups.push({ categoryId: st.smConfirmedAt && st.confirmedCategories.includes(id) ? id : null, label: loc(fx.label, l), iconKey: fx.iconKey, kind: fx.kind, items });
    }
    const review = needs.filter((n) => !n.category);
    if (review.length) groups.push({ categoryId: null, label: l === "es" ? "En revisión" : "Under review", iconKey: "to_review", kind: "to_review", items: review.map((n) => ({ id: `sm-${n.id}`, label: n.text, why: l === "es" ? "Nos pediste agregarlo." : "You asked us to add it.", priority: null, timing: null, state: "pending" as const })) });
    const open = MAP_OPEN_ITEMS.filter((_, i) => !(i === 0 && a.pa_critical_decisions?.text.en === "No open decisions")).map((o) => loc(o, l));
    const changes = mode === "live" && st.smConfirmedAt ? st.needs.filter((n) => !n.confirmedInMap).map((n) => ({ kind: "added" as const, text: n.text })) : [];
    return {
      title: `My Service Map · ${COMPANY}`,
      asOf: mode === "confirmed" && st.smConfirmedAt ? st.smConfirmedAt : ids.now(),
      summary: { objective: val("pa_project_objective"), destinations: destinations(l), timeWindow: a.pa_time_window ? a.pa_time_window.text[l] : null, productOrService: a.pa_expansion_product_or_service ? a.pa_expansion_product_or_service.text[l] : null },
      groups, openItems: open, changesSinceConfirmed: changes,
    };
  }
  function serviceMap(l: Locale): ServiceMapDto {
    const ready = uState() === "ready_to_confirm";
    const canConfirm = canWrite() && (ready || (st.smConfirmedAt !== null && hasUnconfirmed()));
    return {
      live: mapView(l, "live"),
      confirmed: st.smConfirmedAt ? { ...mapView(l, "confirmed"), confirmedAt: st.smConfirmedAt } : null,
      canConfirm, hasUnconfirmedChanges: hasUnconfirmed(), canWrite: canWrite(),
    };
  }

  function crpView(id: string, l: Locale): CrpViewDto {
    const fx = mapOf(id)!; const c = st.cats[id]; const prog = progressOf(c.iv, fx.questions);
    const req = (q: (typeof fx.questions)[number]): CrpRequirementDto => {
      const a = c.iv.answers[q.key];
      const state: ItemState = a?.state === "answered" ? "confirmed" : a?.state === "assumed" ? "assumed" : "pending";
      return { id: q.key, label: loc(q.label, l), value: a && a.state !== "unknown" ? a.text[l] : null, state, executionDependency: !!q.executionDependency };
    };
    const sections: CrpSectionDto[] = fx.sections.map((s) => ({ id: s.id, title: loc(s.title, l), items: fx.questions.filter((q) => q.section === s.id).map(req) })).filter((s) => s.items.length);
    const pending = fx.questions.map(req).filter((r) => r.state === "pending");
    const state: CrpViewDto["state"] = c.lifecycle === "completed" ? "confirmed" : prog.ready ? "ready_for_review" : "draft";
    return {
      categoryId: id, title: `${loc(fx.label, l)} · ${COMPANY}`, state, confirmedAt: c.lifecycle === "completed" ? c.confirmedAt : null,
      context: fx.contextLines.map((x) => loc(x, l)), sections, pending, requiredLater: fx.requiredLater.map((x) => loc(x, l)),
      canConfirm: canWrite() && state === "ready_for_review", canRequestChanges: canWrite() && state === "ready_for_review", canStartNewVersion: canWrite() && state === "confirmed",
    };
  }

  function previewOf(id: string, l: Locale): PreviewDto {
    const c = st.cats[id];
    if (c.lifecycle !== "completed") fail("NOT_READY");
    const checksum = `pc-${hash(JSON.stringify({ id, v: c.packVersion, a: c.iv.answers, m: st.smConfirmedAt, s: st.salt }))}`;
    const view = crpView(id, l);
    const map = { ...mapView(l, "confirmed"), confirmedAt: st.smConfirmedAt };
    // The preview stays sendable: the first-send rule is enforced when sending (ACTIVATION_PENDING_RETRY_FIRST), where the client shows it.
    const send = sendStateOf(id);
    return {
      categoryId: id, previewChecksum: checksum, firstSend: !st.firstDelivered, sendState: send,
      canSend: canWrite() && send !== "sent" && send !== "sending",
      blocks: [
        { id: "project", title: l === "es" ? "Tu proyecto" : "Your project", lines: [COMPANY, l === "es" ? "Destino: México" : "Destination: Mexico", `${l === "es" ? "Objetivo" : "Objective"}: ${map.summary.objective ?? "-"}`] },
        { id: "service_map", title: "My Service Map", lines: [(() => { const d = new Date(st.smConfirmedAt ?? ids.now()).toLocaleDateString(l === "es" ? "es-MX" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); return l === "es" ? `Confirmado el ${d}` : `Confirmed on ${d}`; })()], view: map },
        { id: "crp", title: "Category Requirement Pack (CRP)", lines: [view.title], view },
        { id: "context", title: l === "es" ? "Contexto de la empresa y del proyecto" : "Company and project context", lines: [l === "es" ? "Sector: Alimentos especializados" : "Sector: Specialty food", ...view.requiredLater] },
      ],
      notSent: l === "es"
        ? ["Tu conversación con Precision", "Nombres de personas", "Datos de contacto", "Cualquier cosa que no hayas confirmado"]
        : ["Your conversation with Precision", "Names of people", "Contact details", "Anything you have not confirmed"],
    };
  }

  // ------------------------------------------------------------------ turns
  function understandingStep(input: StepInput): StoredTurn[] {
    const u = st.understanding;
    const cfg = { scope: "understanding", questions: UNDERSTANDING_QUESTIONS, onComplete: (iv: Interview, i: Ids) => { iv.stage = "summary"; return [summaryTurn(i)]; } };
    if (u.stage === "summary" && !isProcessQuestion(input.text, !!input.confirm)) {
      if (input.confirm?.intent === "confirm") {
        st.summaryConfirmed = true;
        return [turn(ids, "assistant", "message", bi("Thank you. I prepared My Service Map from what we covered. You can review it now.", "Gracias. Preparé My Service Map con lo que vimos. Puedes revisarlo ahora."))];
      }
      u.stage = "summary_correct";
      return [turn(ids, "assistant", "message", bi("Understood. What would you like to change?", "Entendido. ¿Qué te gustaría cambiar?"))];
    }
    if (u.stage === "summary_correct" && !isProcessQuestion(input.text, false)) {
      const t = input.text.trim();
      u.answers.pa_project_objective = { state: "answered", text: bi(t, t) };
      u.stage = "summary";
      return [turn(ids, "assistant", "message", bi("Thank you, I updated it.", "Gracias, lo actualicé.")), summaryTurn(ids)];
    }
    if (u.stage === "summary" || u.stage === "summary_correct") return [processReply(ids, input.text, lastQuestionTurn(u))];
    return interviewStep(u, cfg, input, ids);
  }
  function summaryTurn(i: Ids): StoredTurn {
    const a = st.understanding.answers;
    const v = (k: string, l: Locale) => (a[k] && a[k].state !== "unknown" ? a[k].text[l] : l === "es" ? "Pendiente" : "Pending");
    const body = (l: Locale) => [`${l === "es" ? "Destino" : "Destination"}: ${v("pa_destination_countries", l)}`, `${l === "es" ? "Objetivo" : "Objective"}: ${v("pa_project_objective", l)}`, `${l === "es" ? "Producto" : "Product"}: ${v("pa_expansion_product_or_service", l)}`, `${l === "es" ? "Entidad" : "Entity"}: ${v("pa_operating_entity", l)}`, `${l === "es" ? "Ventana de tiempo" : "Time window"}: ${v("pa_time_window", l)}`].join("\n");
    return turn(i, "assistant", "message", bi("This is what I understood about your project. Is it right?", "Esto es lo que entendí de tu proyecto. ¿Es correcto?"), {
      confirmCard: { kind: "summary", title: bi("Summary of your project", "Resumen de tu proyecto"), body: bi(body("en"), body("es")), token: "understanding:summary", confirmLabel: bi("Yes, that is right", "Sí, es correcto"), correctLabel: bi("Change something", "Cambiar algo") },
    });
  }
  function categoryStep(id: string, input: StepInput): StoredTurn[] {
    const fx = mapOf(id)!; const c = st.cats[id];
    if (c.iv.current === "__change" && !isProcessQuestion(input.text, false)) {
      const t = input.text.trim();
      c.iv.answers.__change = { state: "answered", text: bi(t, t) };
      c.iv.current = null; c.iv.stage = "done";
      return [turn(ids, "assistant", "message", bi("Noted. I took it into account. Review the summary whenever you want.", "Anotado. Lo tomé en cuenta. Revisa el resumen cuando quieras."))];
    }
    return interviewStep(c.iv, {
      scope: `category:${id}`, questions: fx.questions,
      onComplete: (_iv, i) => [turn(i, "assistant", "message", bi("That is everything I need for this category. Review the summary whenever you want; pending items stay visible there.", "Eso es todo lo que necesito para esta categoría. Revisa el resumen cuando quieras; los pendientes siguen visibles ahí."))],
    }, input, ids);
  }
  function addStep(input: StepInput): { turns: StoredTurn[]; mapChanged: boolean } {
    const a = st.add;
    if (isProcessQuestion(input.text, !!input.confirm)) return { turns: [processReply(ids, input.text, a.turns.filter((t) => t.role === "assistant").slice(-1)[0] ?? null)], mapChanged: false };
    if (a.stage === "ask") {
      const text = input.text.trim(); a.pendingNeed = text; a.stage = "confirm";
      return { turns: [turn(ids, "assistant", "message", bi("Let me confirm what I understood.", "Déjame confirmar lo que entendí."), { confirmCard: { kind: "service_need", title: bi("What you need", "Lo que necesitas"), body: bi(text, text), token: "add_service:need", confirmLabel: bi("Yes, add it to my project", "Sí, agrégalo a mi proyecto"), correctLabel: bi("Say it again", "Decirlo de nuevo") } })], mapChanged: false };
    }
    if (input.confirm?.intent === "confirm" && a.pendingNeed) {
      const text = a.pendingNeed; const known = NEEDS_KNOWN.find((n) => n.match.test(text))?.category ?? null;
      st.needs.push({ id: `need${st.needs.length + 1}`, text, category: known, confirmedInMap: false });
      a.stage = "ask"; a.pendingNeed = null;
      return { turns: [turn(ids, "assistant", "message", bi("I added it and updated My Service Map. Review it when you want. If you need another service, tell me.", "Lo agregué y actualicé My Service Map. Revísalo cuando quieras. Si necesitas otro servicio, cuéntame."))], mapChanged: true };
    }
    a.stage = "ask"; a.pendingNeed = null;
    return { turns: [turn(ids, "assistant", "message", bi("No problem. Tell me again what you need.", "Sin problema. Cuéntame de nuevo qué necesitas."))], mapChanged: false };
  }

  function scopeInterview(scope: string): { turns: StoredTurn[]; started: () => void } {
    if (scope === "understanding") { ensureUnderstandingThread(); return { turns: st.understanding.turns, started: () => { st.understanding.started = true; } }; }
    if (scope === "add_service") { ensureAddThread(); return { turns: st.add.turns, started: () => undefined }; }
    const id = scope.slice("category:".length);
    ensureCategoryThread(id);
    return { turns: st.cats[id].iv.turns, started: () => { st.cats[id].iv.started = true; } };
  }

  function finalizeTurn(key: string) {
    const p = st.processing[key]; if (!p) return;
    delete st.processing[key];
    let assistant: StoredTurn[] = []; let mapChanged = false; let target: StoredTurn[];
    if (p.scope === "understanding") { assistant = understandingStep(p.input); target = st.understanding.turns; }
    else if (p.scope === "add_service") { const r = addStep(p.input); assistant = r.turns; mapChanged = r.mapChanged; target = st.add.turns; }
    else { const id = p.scope.slice("category:".length); assistant = categoryStep(id, p.input); target = st.cats[id].iv.turns; }
    target.push(...assistant);
    st.results[key] = { status: "ok", turnIds: [p.clientId, ...assistant.map((t) => t.id)], mapChanged, scope: p.scope };
    save();
  }
  function settle() {
    const now = nowMs();
    for (const [k, p] of Object.entries(st.processing)) if (p.readyAt <= now) finalizeTurn(k);
    for (const [id, s] of Object.entries(st.sends)) {
      if (s.state === "sending" && s.settleAt !== null && s.settleAt <= now) {
        s.settleAt = null;
        if (s.outcome === "sent") { s.state = "sent"; if (!st.firstDelivered) st.firstDelivered = true; }
        else { s.state = "failed"; }
        void id;
      }
    }
  }

  function turnResult(key: string, l: Locale, scope: string): TurnResultDto {
    const r = st.results[key];
    const all = scope === "understanding" ? st.understanding.turns : scope === "add_service" ? st.add.turns : st.cats[scope.slice(9)].iv.turns;
    const turns = all.filter((t) => r.turnIds.includes(t.id)).map((t) => ser(t, l));
    const catId = scope.startsWith("category:") ? scope.slice(9) : null;
    return {
      status: r.status, turns, progress: catId ? progressDto(catId) : null,
      understandingState: scope === "understanding" ? uState() : null, serviceMapChanged: r.mapChanged, retryable: false,
    };
  }

  async function handleTurnPost(scope: string, body: unknown, l: Locale): Promise<TurnResultDto> {
    if (!canWrite()) fail("PRECISION_READ_ONLY");
    const b = (body ?? {}) as { turnKey?: string; text?: string; quickReply?: StepInput["quickReply"]; confirm?: StepInput["confirm"] };
    if (typeof b.turnKey !== "string" || !/^[A-Za-z0-9_.:-]{8,80}$/.test(b.turnKey)) fail("INVALID_INPUT");
    if (typeof b.text !== "string" || b.text.length > 4000 || (!b.text.trim() && !b.confirm && !b.quickReply)) fail("INVALID_INPUT");
    const key = b.turnKey as string;
    if (scope.startsWith("category:")) {
      const c = st.cats[scope.slice(9)]; if (!c) fail("NOT_FOUND");
      if (c.lifecycle === "completed") fail("CONFLICT");
    }
    if (scope === "add_service" && !st.smConfirmedAt) fail("NOT_READY");
    st.stats.turnCalls++;
    if (st.results[key]) return turnResult(key, l, st.results[key].scope);
    // Input the guardrail will not process: nothing is saved and no assistant turn is produced.
    if (/ignore (all |your )?(previous |prior )?instructions|(another|other) customer/i.test(b.text ?? "")) return { status: "blocked", turns: [], progress: null, understandingState: null, serviceMapChanged: false, retryable: false };
    const { turns, started } = scopeInterview(scope);
    const clientId = `c-${key}`;
    const input: StepInput = { text: b.text ?? "", quickReply: b.quickReply, confirm: b.confirm };
    if (!turns.some((t) => t.id === clientId)) {
      turns.push({ id: clientId, role: "client", kind: "message", text: bi(input.text, input.text), createdAt: ids.now() });
      started();
    }
    if (!st.processing[key]) st.processing[key] = { readyAt: nowMs() + st.cfg.turnLatency, scope, input, clientId };
    delete st.failedKeys[key];
    save();
    if (st.inject.ai_unavailable > 0) {
      st.inject.ai_unavailable--;
      delete st.processing[key];
      st.failedKeys[key] = { readyAt: 0, scope, input, clientId };
      save();
      await sleep(st.cfg.turnLatency);
      const clientTurn = turns.find((t) => t.id === clientId)!;
      return { status: "ai_unavailable", turns: [ser(clientTurn, l)], progress: scope.startsWith("category:") ? progressDto(scope.slice(9)) : null, understandingState: scope === "understanding" ? uState() : null, serviceMapChanged: false, retryable: true };
    }
    const remaining = st.processing[key].readyAt - nowMs();
    if (remaining > 0) await sleep(remaining);
    settle();
    return turnResult(key, l, scope);
  }

  // ------------------------------------------------------------------ routes
  async function route(req: TransportRequest): Promise<unknown> {
    const l: Locale = req.headers["X-Precision-Locale"] === "es" ? "es" : "en";
    const url = req.path.replace(/^\/api\/precision/, "").split("?")[0];
    const m = `${req.method} ${url}`;
    if (m === "POST /session/exchange") {
      const code = (req.body as { code?: string } | undefined)?.code;
      if (!code || code === "expired" || code === "invalid" || code === "used") fail("UNAUTHENTICATED");
      return { sessionToken: `${TOKEN_PREFIX}${hash(code as string)}`, expiresAt: new Date(nowMs() + 8 * 3600_000).toISOString() };
    }
    const token = (req.headers.Authorization ?? "").replace(/^Bearer\s+/, "");
    if (!token.startsWith(TOKEN_PREFIX) || st.inject.unauthenticated > 0) { if (st.inject.unauthenticated > 0) st.inject.unauthenticated--; fail("UNAUTHENTICATED"); }
    settle();
    if (m === "GET /entry") {
      return { screen: st.coverSeen ? "center" : "cover", locale: "en", access: st.access, cover: coverOf(l) } satisfies EntryDto;
    }
    if (st.access.mode === "REVOKED") fail("PRECISION_REVOKED");
    const writes = req.method === "POST" && m !== "POST /cover/seen";
    if (writes && !canWrite()) fail("PRECISION_READ_ONLY");

    if (m === "POST /cover/seen") { st.coverSeen = true; save(); return { ok: true }; }
    if (m === "GET /center") return center(l);
    if (m === "GET /help") return { helpCenterUrl: st.cfg.helpUrl, privacyUrl: MOCK_LINKS.privacyUrl, termsUrl: MOCK_LINKS.termsUrl, contactEmail: MOCK_LINKS.contactEmail, contactAvailable: true } satisfies HelpDto;
    if (m === "GET /support") return { email: MOCK_LINKS.contactEmail };
    if (m === "GET /understanding") {
      ensureUnderstandingThread(); save();
      return { surface: "understanding", scopeId: "understanding", title: l === "es" ? "Precision Understanding" : "Precision Understanding", turns: st.understanding.turns.map((t) => ser(t, l)), progress: null, understandingState: uState(), aiDisclosureShown: true, canWrite: canWrite() && uState() !== "confirmed" } satisfies ThreadDto;
    }
    if (m === "POST /understanding/turns") return handleTurnPost("understanding", req.body, l);
    if (m === "GET /service-map") { if (!["ready_to_confirm", "confirmed"].includes(uState())) fail("NOT_READY"); return serviceMap(l); }
    if (m === "POST /service-map/confirm") {
      st.stats.confirmMapCalls++;
      const k = (req.body as { requestKey?: string } | undefined)?.requestKey;
      if (typeof k !== "string" || k.length < 8) fail("INVALID_INPUT");
      if (!st.smRequestKeys.includes(k as string)) {
        const sm = serviceMap(l);
        if (!sm.canConfirm) { if (st.smConfirmedAt && !hasUnconfirmed()) { /* idempotent no-op */ } else fail("NOT_READY"); }
        else { confirmMap(); st.smRequestKeys.push(k as string); }
      }
      save();
      return { confirmedAt: st.smConfirmedAt, serviceMap: serviceMap(l) };
    }
    if (m === "GET /add-service") {
      if (!st.smConfirmedAt) return { available: false, thread: null } satisfies AddServiceThreadDto;
      ensureAddThread(); save();
      return { available: true, thread: { surface: "add_service", scopeId: "add_service", title: "Add a Service", turns: st.add.turns.map((t) => ser(t, l)), progress: null, understandingState: null, aiDisclosureShown: true, canWrite: canWrite() } } satisfies AddServiceThreadDto;
    }
    if (m === "POST /add-service/turns") return handleTurnPost("add_service", req.body, l);

    const cm = url.match(/^\/categories\/([^/]+)(?:\/(crp|preview|send|turns))?(?:\/(request-changes|confirm|new-version))?$/);
    if (cm) {
      const id = decodeURIComponent(cm[1]); const sub = cm[2]; const act = cm[3];
      const c = st.cats[id];
      if (!c || !st.smConfirmedAt) fail("NOT_FOUND");
      if (!sub && req.method === "GET") {
        ensureCategoryThread(id); save();
        const fx = mapOf(id)!;
        return {
          id, label: loc(fx.label, l), iconKey: fx.iconKey, status: catStatus(id), progress: progressDto(id), sendState: sendStateOf(id),
          thread: { surface: "category", scopeId: id, title: loc(fx.label, l), turns: c.iv.turns.map((t) => ser(t, l)), progress: progressDto(id), understandingState: null, aiDisclosureShown: true, canWrite: canWrite() && c.lifecycle !== "completed" },
        } satisfies CategoryDto;
      }
      if (sub === "turns") return handleTurnPost(`category:${id}`, req.body, l);
      if (sub === "crp" && !act && req.method === "GET") return crpView(id, l);
      if (sub === "crp" && act === "request-changes") {
        const v = crpView(id, l); if (!v.canRequestChanges) fail("CONFLICT");
        c.iv.stage = "asking"; c.iv.current = "__change"; c.iv.reviewDone = false;
        c.iv.turns.push(turn(ids, "assistant", "message", bi("We reopened this category. Tell me what you would like to change and I will take it into account.", "Reabrimos esta categoría. Cuéntame qué te gustaría cambiar y lo tomaré en cuenta.")));
        save(); return { ok: true };
      }
      if (sub === "crp" && act === "confirm") {
        st.stats.confirmCrpCalls++;
        const k = (req.body as { requestKey?: string } | undefined)?.requestKey;
        if (typeof k !== "string" || k.length < 8) fail("INVALID_INPUT");
        if (!c.requestKeys.includes(k as string)) {
          if (c.lifecycle === "completed") { /* already confirmed: idempotent */ }
          else { if (!crpView(id, l).canConfirm) fail("NOT_READY"); c.lifecycle = "completed"; c.confirmedAt = ids.now(); }
          c.requestKeys.push(k as string);
        }
        save(); return { ok: true };
      }
      if (sub === "crp" && act === "new-version") {
        if (c.lifecycle !== "completed") fail("CONFLICT");
        c.lifecycle = "in_progress"; c.packVersion++; c.iv.stage = "asking"; c.iv.current = "__change"; c.iv.reviewDone = false;
        c.iv.turns.push(turn(ids, "assistant", "message", bi("We started a new version. The confirmed one stays as it is until you confirm this one. Tell me what has changed.", "Iniciamos una versión nueva. La confirmada se mantiene tal cual hasta que confirmes esta. Cuéntame qué cambió.")));
        save(); return { ok: true };
      }
      if (sub === "preview" && req.method === "GET") return previewOf(id, l);
      if (sub === "send" && req.method === "POST") return send(id, req.body, l);
    }
    fail("NOT_FOUND");
    return null;
  }

  function confirmMap() {
    const now = ids.now();
    st.smConfirmedAt = now;
    const wanted = [...CATEGORY_ORDER, ...new Set(st.needs.filter((n) => n.category).map((n) => n.category as string))];
    for (const id of wanted) {
      if (!st.cats[id]) st.cats[id] = { iv: newInterview(), lifecycle: "confirmed", packVersion: 1, confirmedAt: null, requestKeys: [] };
    }
    st.confirmedCategories = wanted;
    st.needs.forEach((n) => { n.confirmedInMap = true; });
  }

  function coverOf(l: Locale): CoverDto {
    const dest = destinations(l);
    if (st.cfg.cover === "neutral") return { composition: "neutral", image: null, destinations: dest };
    const svg = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#C6C1ED"/><stop offset="1" stop-color="#2E0879"/></linearGradient></defs><rect width="1200" height="1600" fill="url(#g)"/><circle cx="780" cy="560" r="260" fill="#F1F1FA" opacity=".35"/></svg>`);
    return { composition: st.cfg.cover, image: { url: `data:image/svg+xml;charset=utf-8,${svg}`, altText: l === "es" ? "Imagen de destino aprobada" : "Approved destination image", focal: { x: 0.6, y: 0.4 } }, destinations: dest };
  }

  function send(id: string, body: unknown, l: Locale): SendResultDto {
    st.stats.sendCalls++;
    const c = st.cats[id];
    const sentChecksum = (body as { previewChecksum?: string } | undefined)?.previewChecksum;
    if (typeof sentChecksum !== "string") fail("INVALID_INPUT");
    if (c.lifecycle !== "completed") fail("NOT_READY");
    if (!st.firstDelivered && st.firstAttemptCat !== null && st.firstAttemptCat !== id) fail("ACTIVATION_PENDING_RETRY_FIRST");
    const existing = st.sends[id];
    if (existing && existing.packVersion === c.packVersion && (existing.state === "sent" || existing.state === "sending")) return sendResult(existing.state, null, false);
    if (st.inject.preview_stale > 0) { st.inject.preview_stale--; st.salt++; fail("PREVIEW_STALE"); }
    if (sentChecksum !== previewOf(id, l).previewChecksum) fail("PREVIEW_STALE");
    const failing = st.inject.oh_fail > 0 || st.inject.oh_fail_terminal > 0;
    const terminal = st.inject.oh_fail_terminal > 0;
    if (st.inject.oh_fail > 0) st.inject.oh_fail--; else if (st.inject.oh_fail_terminal > 0) st.inject.oh_fail_terminal--;
    const slow = st.inject.send_slow > 0; if (slow) st.inject.send_slow--;
    if (!st.firstDelivered) st.firstAttemptCat = id;
    st.sends[id] = { packVersion: c.packVersion, state: "sending", attempts: (existing?.attempts ?? 0) + 1, settleAt: nowMs() + (slow ? 25_000 : st.cfg.ohDelay), outcome: failing ? "failed" : "sent", clientAction: failing ? (terminal ? "needs_attention" : "try_again_later") : null };
    save();
    return sendResult("sending", null, false);
  }
  function sendResult(state: SendResultDto["state"], action: SendResultDto["clientAction"], retryable: boolean): SendResultDto {
    return { state, clientAction: action, retryable, operationHub: operationHub() };
  }

  // ------------------------------------------------------------------ presets (drive the same engine a client would)
  function say(scope: string, input: StepInput) {
    const key = `preset-${++st.seq}-${scope.length}`;
    const { turns, started } = scopeInterview(scope);
    const clientId = `c-${key}`;
    turns.push({ id: clientId, role: "client", kind: "message", text: bi(input.text, input.text), createdAt: ids.now() }); started();
    st.processing[key] = { readyAt: 0, scope, input, clientId }; finalizeTurn(key);
  }
  function runPreset(name: string) {
    const steps = ["understanding", "map", "logistics", "crp", "sent"];
    // firstSendFailed: the first send was refused and a second category is confirmed, so sending that one must wait for the first (ACTIVATION_PENDING_RETRY_FIRST).
    const alias: Record<string, string> = { understandingReady: "understanding", mapConfirmed: "map", logisticsReady: "logistics", logisticsConfirmed: "crp", sent: "sent", firstSendFailed: "crp" };
    const upto = steps.indexOf(alias[name] ?? "");
    if (upto < 0) return;
    st.coverSeen = true;
    const confirm = (token: string) => ({ text: "Yes, that is right", confirm: { token, intent: "confirm" as const } });
    const qr = (text: string, intent: StepInput["quickReply"] extends infer Q ? (Q extends { intent: infer I } ? I : never) : never = "answer") => ({ text, quickReply: { value: text, intent } });
    scopeInterview("understanding");
    say("understanding", confirm("understanding:pa_destination_countries"));
    say("understanding", qr("Start selling to retail chains"));
    say("understanding", confirm("understanding:pa_expansion_product_or_service"));
    say("understanding", qr("We will use a distributor"));
    say("understanding", confirm("understanding:pa_time_window"));
    say("understanding", qr("Yes, who will act as importer"));
    say("understanding", confirm("understanding:summary"));
    if (upto < 1) return;
    confirmMap();
    if (upto < 2) return;
    ensureCategoryThread("logistics");
    const lg = mapOf("logistics")!;
    const answers = ["Finished goods to Mexico", "Sea freight", "Ambient only", "", "We do", "Yes", "Port of Veracruz, then a distribution centre", "No special handling"];
    lg.questions.forEach((_q, i) => {
      if (i === 3) say("category:logistics", { text: "I don't know yet", quickReply: { value: "unknown", intent: "unknown" } });
      else say("category:logistics", { text: answers[i] });
    });
    say("category:logistics", { text: "Continue with pending information", quickReply: { value: "continue", intent: "answer" } });
    if (upto < 3) return;
    st.cats.logistics.lifecycle = "completed"; st.cats.logistics.confirmedAt = ids.now();
    if (name === "firstSendFailed") {
      const second = "international_trade_customs";
      ensureCategoryThread(second);
      mapOf(second)!.questions.forEach(() => say(`category:${second}`, { text: "As described in the summary" }));
      say(`category:${second}`, { text: "Continue with pending information", quickReply: { value: "continue", intent: "answer" } });
      st.cats[second].lifecycle = "completed"; st.cats[second].confirmedAt = ids.now();
      st.firstAttemptCat = "logistics";
      st.sends.logistics = { packVersion: 1, state: "failed", attempts: 1, settleAt: null, outcome: "failed", clientAction: "try_again_later" };
      return;
    }
    if (upto < 4) return;
    st.firstAttemptCat = "logistics"; st.firstDelivered = true;
    st.sends.logistics = { packVersion: 1, state: "sent", attempts: 1, settleAt: null, outcome: "sent", clientAction: null };
  }

  // ------------------------------------------------------------------ transport
  const transport: Transport = async (req) => {
    st.stats.requests++;
    if (st.inject.offline > 0) { st.inject.offline--; save(); await sleep(60); throw new ApiFailure("network", 0, "UNKNOWN", true); }
    if (st.inject.unavailable > 0) { st.inject.unavailable--; save(); await sleep(60); return { status: 503, body: { error: "TEMPORARILY_UNAVAILABLE", message: "Temporarily unavailable.", retryable: true } }; }
    const isTurn = /\/turns$/.test(req.path);
    if (!isTurn && st.cfg.latency > 0) await sleep(st.cfg.latency);
    try {
      const body = await route(req);
      save();
      return { status: 200, body } as TransportResponse;
    } catch (e) {
      if (e instanceof HttpError) { save(); return { status: HTTP[e.code], body: { error: e.code, message: "Request not completed.", retryable: e.code === "TEMPORARILY_UNAVAILABLE" || e.code === "RATE_LIMITED" } }; }
      throw e;
    }
  };

  const control: MockControl = {
    reset() { st = freshState(); save(); },
    inject(kind, count = 1) { st.inject[kind] = (st.inject[kind] ?? 0) + count; save(); },
    setLatency(ms, turnMs) { st.cfg.latency = ms; st.cfg.turnLatency = turnMs ?? ms; save(); },
    setAccess(mode, until = null) { st.access = { mode, readOnlyUntil: mode === "READ_ONLY" ? until ?? "2026-12-18T00:00:00.000Z" : null }; save(); },
    setCover(c) { st.cfg.cover = c; save(); },
    setOh(mode, sherpa = false) { st.cfg.ohMode = mode; st.cfg.contactSherpa = sherpa; save(); },
    setHelpUrl(u) { st.cfg.helpUrl = u; save(); },
    preset(name) { runPreset(name); save(); },
    stats: () => st.stats,
    snapshot: () => st,
  };
  // Switches in the address (?mock=...) apply only to a fresh session of the mock server, never after a reload.
  if (!restored) applyQuery(bootQuery);
  void blockingGap; void EXTRA_CATEGORY_LABELS;
  return { transport, control };
}

declare global { interface Window { __PRECISION_MOCK__?: MockControl } }

const instance = createMockServer();
export const mockTransport: Transport = instance.transport;
export const mockControl: MockControl = instance.control;
if (typeof window !== "undefined") window.__PRECISION_MOCK__ = instance.control;
