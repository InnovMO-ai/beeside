import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient, defaultTransport, type PrecisionClient } from "../api/client";
import type { AccessDto, CenterDto, EntryDto } from "../api/dto";
import { sessionStore } from "../api/session";
import { ApiFailure, type Transport } from "../api/transport";
import { useI18n, type DictKey } from "../i18n";
import { useResource, type Resource } from "./resource";

export type TransportFactory = () => Promise<Transport>;

interface SessionCtx {
  client: PrecisionClient;
  entry: EntryDto;
  center: Resource<CenterDto>;
  access: AccessDto;
  canWrite: boolean;
  /** Called when a write is refused: updates the access mode shown everywhere. */
  noteAccessFailure: (f: ApiFailure) => void;
  refreshCenter: () => Promise<void>;
}
const Ctx = createContext<SessionCtx | null>(null);
export function useSessionOptional(): SessionCtx | null { return useContext(Ctx); }
export function useSession(): SessionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("Session missing");
  return v;
}

type AuthState =
  | { s: "exchanging" } | { s: "missing" } | { s: "invalid" } | { s: "network" } | { s: "ready" };

// The one-time code is exchanged once per page load even when React renders twice (StrictMode).
const exchanges = new Map<string, Promise<void>>();

function readCode(): string | null {
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get("code");
  if (fromQuery) return fromQuery;
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  return hash.get("code");
}
function stripCode() {
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  hash.delete("code");
  url.hash = hash.toString();
  window.history.replaceState({}, "", url.pathname + url.search + (url.hash === "#" ? "" : url.hash));
}

export interface AuthGate {
  auth: AuthState;
  client: PrecisionClient;
  retryExchange: () => void;
}

export function useAuthGate(transport: TransportFactory = defaultTransport): AuthGate {
  const { locale } = useI18n();
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const [auth, setAuth] = useState<AuthState>(() => (sessionStore.get() && !readCode() ? { s: "ready" } : readCode() ? { s: "exchanging" } : { s: "missing" }));
  const [attempt, setAttempt] = useState(0);
  const client = useMemo(() => createClient({
    transport,
    locale: () => localeRef.current,
    onUnauthenticated: () => { sessionStore.clear(); setAuth({ s: "invalid" }); },
  }), [transport]);

  useEffect(() => {
    const code = readCode();
    if (!code) return;
    let cancelled = false;
    setAuth({ s: "exchanging" });
    let p = exchanges.get(code);
    if (!p) {
      p = client.exchange(code).then((r) => { sessionStore.set(r.sessionToken, r.expiresAt); });
      exchanges.set(code, p);
      p.catch(() => exchanges.delete(code));
    }
    p.then(() => { if (!cancelled) { stripCode(); setAuth({ s: "ready" }); } })
      .catch((e) => { if (!cancelled) setAuth(e instanceof ApiFailure && e.isConnection ? { s: "network" } : { s: "invalid" }); });
    return () => { cancelled = true; };
  }, [client, attempt]);

  const retryExchange = useCallback(() => setAttempt((n) => n + 1), []);
  return { auth, client, retryExchange };
}

export function SessionProvider({ client, children, fallback }: { client: PrecisionClient; children: (s: SessionCtx) => ReactNode; fallback: (state: "loading" | "error" | "invalid", retry: () => void) => ReactNode }) {
  const { locale, applyEntryLocale } = useI18n();
  const entry = useResource(() => client.entry(), [client]);
  const [accessOverride, setAccessOverride] = useState<AccessDto | null>(null);
  const ready = entry.data !== null;
  const center = useResource(() => client.center(), [client, locale], ready && entry.data?.access.mode !== "REVOKED");
  useEffect(() => { if (entry.data) applyEntryLocale(entry.data.locale); }, [entry.data, applyEntryLocale]);

  const noteAccessFailure = useCallback((f: ApiFailure) => {
    if (f.code === "PRECISION_READ_ONLY") setAccessOverride((a) => a ?? { mode: "READ_ONLY", readOnlyUntil: center.data?.access.readOnlyUntil ?? entry.data?.access.readOnlyUntil ?? null });
    if (f.code === "PRECISION_REVOKED") setAccessOverride({ mode: "REVOKED", readOnlyUntil: null });
  }, [center.data, entry.data]);

  const refreshCenter = center.reload;
  if (!entry.data) {
    if (entry.error && !entry.error.isConnection) return <>{fallback(entry.error.status === 401 ? "invalid" : "error", () => void entry.reload())}</>;
    if (entry.error) return <>{fallback("error", () => void entry.reload())}</>;
    return <>{fallback("loading", () => undefined)}</>;
  }
  const access = accessOverride ?? center.data?.access ?? entry.data.access;
  const value: SessionCtx = { client, entry: entry.data, center, access, canWrite: access.mode === "FULL", noteAccessFailure, refreshCenter };
  return <Ctx.Provider value={value}>{children(value)}</Ctx.Provider>;
}

/** Friendly copy for any failed call; raw codes and server text never reach the screen. */
export function failureKey(f: ApiFailure): DictKey {
  switch (f.code) {
    case "PRECISION_READ_ONLY": return "error.readOnly";
    case "RATE_LIMITED": return "error.rateLimited";
    case "NOT_READY": return "error.notReady";
    case "CONFLICT": return "error.conflict";
    default: return "error.generic";
  }
}
