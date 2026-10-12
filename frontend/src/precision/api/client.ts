import type {
  AddServiceThreadDto, CategoryDto, CenterDto, ConfirmCrpRequest, ConfirmServiceMapRequest, ConfirmServiceMapResponse,
  CrpViewDto, EntryDto, HelpDto, SupportDto, Locale, PreviewDto, SendRequest, SendResultDto, ServiceMapDto, SessionExchangeResponse, ThreadDto, TurnRequest, TurnResultDto,
} from "./dto";
import { ApiFailure, LOCALE_HEADER, liveTransport, type Transport } from "./transport";
import { sessionStore } from "./session";

const BASE = "/api/precision";

/** Chooses the transport once. The in-memory adapter is a separate chunk that exists only in builds made with VITE_PRECISION_API_MODE=mock. */
export async function defaultTransport(): Promise<Transport> {
  if (import.meta.env.VITE_PRECISION_API_MODE === "mock") {
    const m = await import("../mock/mockTransport");
    return m.mockTransport;
  }
  return liveTransport;
}

export interface ClientDeps {
  transport: () => Promise<Transport>;
  locale: () => Locale;
  /** Called on any 401 so the app can clear the session and show the link page. */
  onUnauthenticated: () => void;
}

export function createClient(deps: ClientDeps) {
  async function call<T>(method: "GET" | "POST", path: string, body?: unknown, opts: { auth?: boolean; signal?: AbortSignal } = {}): Promise<T> {
    const transport = await deps.transport();
    const headers: Record<string, string> = { Accept: "application/json", [LOCALE_HEADER]: deps.locale() };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = opts.auth === false ? null : sessionStore.get();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await transport({ method, path: `${BASE}${path}`, headers, body, signal: opts.signal });
    if (res.status >= 200 && res.status < 300) return res.body as T;
    const err = (res.body ?? {}) as { error?: string; retryable?: boolean };
    const code = (typeof err.error === "string" ? err.error : "UNKNOWN") as ApiFailure["code"];
    if (res.status === 401 && opts.auth !== false) deps.onUnauthenticated();
    const retryable = typeof err.retryable === "boolean" ? err.retryable : res.status >= 500;
    throw new ApiFailure("http", res.status, code, retryable);
  }
  const enc = encodeURIComponent;
  return {
    exchange: (code: string) => call<SessionExchangeResponse>("POST", "/session/exchange", { code }, { auth: false }),
    entry: () => call<EntryDto>("GET", "/entry"),
    coverSeen: () => call<unknown>("POST", "/cover/seen", {}),
    center: () => call<CenterDto>("GET", "/center"),
    help: () => call<HelpDto>("GET", "/help"),
    /** Public: the Contact beeside address for pages that exist without a session. */
    support: () => call<SupportDto>("GET", "/support", undefined, { auth: false }),
    understanding: () => call<ThreadDto>("GET", "/understanding"),
    understandingTurn: (r: TurnRequest) => call<TurnResultDto>("POST", "/understanding/turns", r),
    serviceMap: () => call<ServiceMapDto>("GET", "/service-map"),
    confirmServiceMap: (r: ConfirmServiceMapRequest) => call<ConfirmServiceMapResponse>("POST", "/service-map/confirm", r),
    addService: () => call<AddServiceThreadDto>("GET", "/add-service"),
    addServiceTurn: (r: TurnRequest) => call<TurnResultDto>("POST", "/add-service/turns", r),
    category: (id: string) => call<CategoryDto>("GET", `/categories/${enc(id)}`),
    categoryTurn: (id: string, r: TurnRequest) => call<TurnResultDto>("POST", `/categories/${enc(id)}/turns`, r),
    crp: (id: string) => call<CrpViewDto>("GET", `/categories/${enc(id)}/crp`),
    crpRequestChanges: (id: string) => call<unknown>("POST", `/categories/${enc(id)}/crp/request-changes`, {}),
    crpConfirm: (id: string, r: ConfirmCrpRequest) => call<unknown>("POST", `/categories/${enc(id)}/crp/confirm`, r),
    crpNewVersion: (id: string) => call<unknown>("POST", `/categories/${enc(id)}/crp/new-version`, {}),
    preview: (id: string) => call<PreviewDto>("GET", `/categories/${enc(id)}/preview`),
    send: (id: string, r: SendRequest) => call<SendResultDto>("POST", `/categories/${enc(id)}/send`, r),
  };
}
export type PrecisionClient = ReturnType<typeof createClient>;

/** A stable, retry-safe key: 8+ chars from [A-Za-z0-9_.:-]. */
export function newKey(prefix: string): string {
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
    : Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  return `${prefix}-${rnd}`;
}
