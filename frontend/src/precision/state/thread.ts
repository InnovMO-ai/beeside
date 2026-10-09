import { useCallback, useEffect, useRef, useState } from "react";
import { newKey } from "../api/client";
import type { CategoryProgressDto, ThreadDto, TurnDto, TurnRequest, TurnResultDto, UnderstandingState } from "../api/dto";
import { ApiFailure } from "../api/transport";
import { useI18n } from "../i18n";
import { useSession } from "./app";
import { useConnection } from "./connection";
import { useResource } from "./resource";
import { useEffectEvent } from "./useEffectEvent";

export type PendingStatus = "processing" | "offline" | "ai_unavailable" | "error";
export interface Pending { key: string; req: TurnRequest; display: string; status: PendingStatus; startedAt: number; serverSeen: boolean }
export type WaitStage = "read" | "relate" | "prepare" | "long";

/** Staged, honest waiting copy by elapsed time. No percentages and no promised durations. */
export function waitStage(elapsedMs: number): WaitStage {
  if (elapsedMs < 3000) return "read";
  if (elapsedMs < 7000) return "relate";
  if (elapsedMs < 15000) return "prepare";
  return "long";
}

const storeKey = (scope: string) => `beeside.precision.pending.${scope}`;
function readStored(scope: string): Pending | null {
  try { const raw = sessionStorage.getItem(storeKey(scope)); return raw ? (JSON.parse(raw) as Pending) : null; } catch { return null; }
}
function writeStored(scope: string, p: Pending | null) {
  try { if (p) sessionStorage.setItem(storeKey(scope), JSON.stringify(p)); else sessionStorage.removeItem(storeKey(scope)); } catch { /* resume is best effort */ }
}
export function mergeTurns(existing: TurnDto[], incoming: TurnDto[]): TurnDto[] {
  const out = [...existing];
  for (const t of incoming) { const i = out.findIndex((x) => x.id === t.id); if (i >= 0) out[i] = t; else out.push(t); }
  return out;
}
const safeKey = (id: string) => `resume-${id}`.replace(/[^A-Za-z0-9_.:-]/g, "_").padEnd(8, "_");

export interface ThreadCfg<M> {
  scope: string;
  load: () => Promise<{ thread: ThreadDto | null; meta: M }>;
  submit: (req: TurnRequest) => Promise<TurnResultDto>;
  onResult?: (r: TurnResultDto) => void;
}

export function useThread<M>(cfg: ThreadCfg<M>) {
  const { locale } = useI18n();
  const { noteAccessFailure } = useSession();
  const conn = useConnection();
  const res = useResource(cfg.load, [cfg.scope, locale]);
  const [turns, setTurns] = useState<TurnDto[]>([]);
  const [progress, setProgress] = useState<CategoryProgressDto | null>(null);
  const [uState, setUState] = useState<UnderstandingState | null>(null);
  const [pending, setPendingState] = useState<Pending | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [orphan, setOrphan] = useState(false);
  const pendingRef = useRef<Pending | null>(null);
  const inflight = useRef(false);
  const scopeRef = useRef(cfg.scope);
  scopeRef.current = cfg.scope;

  const setPending = useCallback((p: Pending | null | ((prev: Pending | null) => Pending | null)) => {
    const next = typeof p === "function" ? p(pendingRef.current) : p;
    pendingRef.current = next;
    setPendingState(next);
    writeStored(scopeRef.current, next);
  }, []);

  // Server state (re)loaded.
  const data = res.data;
  useEffect(() => {
    if (!data) return;
    const th = data.thread;
    setTurns(th?.turns ?? []);
    setProgress(th?.progress ?? null);
    setUState(th?.understandingState ?? null);
  }, [data]);

  const run = useEffectEvent(async (p: Pending) => {
    if (inflight.current) return;
    inflight.current = true;
    setPending({ ...p, status: "processing", startedAt: Date.now() });
    setBlocked(false);
    try {
      const r = await cfg.submit(p.req);
      conn.markOk();
      setTurns((prev) => mergeTurns(prev, r.turns));
      if (r.progress) setProgress(r.progress);
      if (r.understandingState) setUState(r.understandingState);
      if (r.status === "ai_unavailable") { setPending((prev) => (prev ? { ...prev, status: "ai_unavailable", serverSeen: true } : prev)); return; }
      setPending(null);
      if (r.status === "blocked" && !r.turns.some((t) => t.role === "assistant")) setBlocked(true);
      cfg.onResult?.(r);
    } catch (e) {
      const f = e instanceof ApiFailure ? e : new ApiFailure("network", 0, "UNKNOWN", true);
      if (f.isConnection) { conn.markFail(); setPending((prev) => (prev ? { ...prev, status: "offline" } : prev)); return; }
      if (f.code === "PRECISION_READ_ONLY" || f.code === "PRECISION_REVOKED") { noteAccessFailure(f); setPending(null); void res.reload(); return; }
      setPending((prev) => (prev ? { ...prev, status: "error" } : prev));
    } finally { inflight.current = false; }
  });

  // Reload during processing resumes from server state: same turnKey, no duplicate effects.
  const resumed = useRef<string | null>(null);
  useEffect(() => {
    if (!data || resumed.current === cfg.scope + locale) return;
    resumed.current = cfg.scope + locale;
    const last = data.thread?.turns[data.thread.turns.length - 1];
    const stored = readStored(cfg.scope);
    if (last?.role === "client") {
      if (stored) { void run({ ...stored, serverSeen: true }); }
      else setOrphan(true);
    } else if (stored) writeStored(cfg.scope, null);
  }, [data, cfg.scope, locale, run]);

  // Automatic retry after a lost connection, driven by the shared backoff.
  const lastTick = useRef(conn.tick);
  useEffect(() => {
    if (conn.tick === lastTick.current) return;
    lastTick.current = conn.tick;
    const p = pendingRef.current;
    if (p && p.status === "offline") void run(p);
  }, [conn.tick, run]);

  const submit = useCallback((display: string, partial: Omit<TurnRequest, "turnKey" | "text">) => {
    if (pendingRef.current) return;
    const key = newKey("t");
    const req: TurnRequest = { turnKey: key, text: display, ...partial };
    const p: Pending = { key, req, display, status: "processing", startedAt: Date.now(), serverSeen: false };
    setOrphan(false);
    void run(p);
  }, [run]);
  const retry = useCallback(() => { const p = pendingRef.current; if (p) void run(p); }, [run]);
  const retryOrphan = useCallback(async () => {
    await res.reload();
  }, [res]);
  // Orphan (no stored key, e.g. another device): after a fresh load, resend the last client turn under a key derived from its id.
  useEffect(() => {
    if (!orphan || !res.data?.thread) return;
    const last = res.data.thread.turns[res.data.thread.turns.length - 1];
    if (last && last.role === "client") { /* wait for the user to press Try again */ } else setOrphan(false);
  }, [orphan, res.data]);
  const resendOrphan = useCallback(() => {
    const last = turns[turns.length - 1];
    if (!last || last.role !== "client") return;
    setOrphan(false);
    void run({ key: safeKey(last.id), req: { turnKey: safeKey(last.id), text: last.text }, display: last.text, status: "processing", startedAt: Date.now(), serverSeen: true });
  }, [turns, run]);

  return { res, turns, progress, uState, pending, blocked, orphan, submit, retry, resendOrphan, retryOrphan, setBlocked };
}
