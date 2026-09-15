import { ApiError } from "./api";

export type SaveStatus = "idle" | "saving" | "saved" | "retrying" | "failed";

const DEFAULT_DELAYS_MS = [1000, 2000, 4000, 8000];

/**
 * Runs a save with bounded exponential backoff. Only transport/server failures are retried;
 * a 4xx answer (invalid, not applicable, locked) is final and returned immediately.
 */
export async function saveWithRetry<T>(
  attempt: () => Promise<T>,
  options: { delaysMs?: number[]; onRetry?: (attemptNumber: number) => void; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ ok: true; value: T } | { ok: false; error: unknown; attempts: number }> {
  const delays = options.delaysMs ?? DEFAULT_DELAYS_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let attempts = 0;
  for (;;) {
    attempts += 1;
    try {
      return { ok: true, value: await attempt() };
    } catch (error) {
      const retryable = !(error instanceof ApiError) || error.status >= 500;
      if (!retryable || attempts > delays.length) return { ok: false, error, attempts };
      options.onRetry?.(attempts);
      await sleep(delays[attempts - 1] ?? 1000);
    }
  }
}
