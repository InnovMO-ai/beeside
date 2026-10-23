import { useCallback, useRef } from "react";

/** A stable function that always calls the latest closure (so effects and timers never see stale state). */
export function useEffectEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}
