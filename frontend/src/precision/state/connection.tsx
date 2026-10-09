import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

interface ConnectionCtx {
  offline: boolean;
  /** Incremented by "Try now" and by every automatic retry cycle; resources refetch when it changes. */
  tick: number;
  markFail: () => void;
  markOk: () => void;
  retryNow: () => void;
  restored: boolean;
}
const Ctx = createContext<ConnectionCtx | null>(null);
export const BACKOFF_MS = [2000, 4000, 8000, 15000];

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [offline, setOffline] = useState(false);
  const [restored, setRestored] = useState(false);
  const [tick, setTick] = useState(0);
  const attempt = useRef(0);
  const wasOffline = useRef(false);
  const markFail = useCallback(() => { wasOffline.current = true; setRestored(false); setOffline(true); }, []);
  const markOk = useCallback(() => {
    attempt.current = 0;
    setOffline(false);
    if (wasOffline.current) { wasOffline.current = false; setRestored(true); }
  }, []);
  const retryNow = useCallback(() => setTick((n) => n + 1), []);
  // While offline, retry with backoff (2s, 4s, 8s, then every 15s) until some request succeeds.
  useEffect(() => {
    if (!offline) return;
    const delay = BACKOFF_MS[Math.min(attempt.current, BACKOFF_MS.length - 1)];
    const id = window.setTimeout(() => { attempt.current += 1; setTick((n) => n + 1); }, delay);
    return () => window.clearTimeout(id);
  }, [offline, tick]);
  useEffect(() => {
    if (!restored) return;
    const id = window.setTimeout(() => setRestored(false), 4000);
    return () => window.clearTimeout(id);
  }, [restored]);
  const value = useMemo(() => ({ offline, tick, markFail, markOk, retryNow, restored }), [offline, tick, markFail, markOk, retryNow, restored]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useConnection(): ConnectionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("ConnectionProvider missing");
  return v;
}
