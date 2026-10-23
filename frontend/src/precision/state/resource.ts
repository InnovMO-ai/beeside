import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure } from "../api/transport";
import { useConnection } from "./connection";

export interface Resource<T> {
  data: T | null;
  error: ApiFailure | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (v: T | null | ((prev: T | null) => T | null)) => void;
}

/** Loads a server resource. A lost connection keeps what is on screen and retries automatically (see ConnectionProvider). */
export function useResource<T>(load: () => Promise<T>, deps: readonly unknown[], enabled = true): Resource<T> {
  const conn = useConnection();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(enabled);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);
  const { markFail, markOk } = conn;

  const run = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const v = await loadRef.current();
      if (mine !== seq.current) return;
      setData(v); setError(null); markOk();
    } catch (e) {
      if (mine !== seq.current) return;
      const f = e instanceof ApiFailure ? e : new ApiFailure("network", 0, "UNKNOWN", true);
      if (f.isConnection) markFail();
      setError(f);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [markFail, markOk]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!enabled) return; setLoading(true); setData(null); setError(null); void run(); return () => { seq.current++; }; }, [enabled, run, ...deps]);
  // Automatic retry while offline and nothing could be loaded.
  const lastTick = useRef(conn.tick);
  useEffect(() => {
    if (conn.tick !== lastTick.current) {
      lastTick.current = conn.tick;
      if (enabled && error?.isConnection) void run();
    }
  }, [conn.tick, enabled, error, run]);
  const reload = useCallback(async () => { await run(); }, [run]);
  return { data, error, loading, reload, setData };
}
