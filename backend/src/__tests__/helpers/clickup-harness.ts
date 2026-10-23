import { ClickUpConfig, ClickUpOperationHub } from "../../precision/adapters/clickup-operation-hub";
import { FakeClickUpServer } from "../../precision/adapters/clickup-fake-server";

export const FAKE_TOKEN = "tk_fake_not_a_secret";

export interface ClickUpHarness {
  server: FakeClickUpServer;
  port: ClickUpOperationHub;
  /** Delays the adapter asked to sleep (instead of really sleeping). */
  sleeps: number[];
  /** Another adapter instance talking to the same fake (simulates a process restart / second process). */
  another(overrides?: Partial<ClickUpConfig>): ClickUpOperationHub;
  stop(): Promise<void>;
}

const open: ClickUpHarness[] = [];

/**
 * A fake ClickUp server plus an adapter wired to it. The server starts asynchronously; the adapter's fetch waits for it,
 * so the harness can be created synchronously (conformance suites call `make()` at collection time).
 */
export function makeClickUpHarness(overrides: Partial<ClickUpConfig> = {}): ClickUpHarness {
  const server = new FakeClickUpServer({ token: FAKE_TOKEN, workspaceId: "W1", spaceId: "S1" });
  const ready = server.start();
  const sleeps: number[] = [];
  const fetchViaFake: typeof fetch = async (input, init) => {
    const base = await ready;
    const u = new URL(String(input));
    return fetch(base + u.pathname.replace(/^\/api\/v2/, "") + u.search, init);
  };
  const config = (extra: Partial<ClickUpConfig> = {}): ClickUpConfig => ({
    apiBaseUrl: "http://clickup.fake/api/v2",
    token: FAKE_TOKEN,
    workspaceId: "W1",
    spaceId: "S1",
    requestTimeoutMs: 300,
    retry: { maxAttempts: 1, baseDelayMs: 10, maxDelayMs: 100, lookupLagRetries: 2, lookupLagDelayMs: 5 },
    fetch: fetchViaFake,
    sleep: async (ms) => { sleeps.push(ms); },
    random: () => 0.5,
    ...overrides,
    ...extra,
  });
  const harness: ClickUpHarness = {
    server,
    port: new ClickUpOperationHub(config()),
    sleeps,
    another: (o) => new ClickUpOperationHub(config(o)),
    stop: () => server.stop(),
  };
  open.push(harness);
  return harness;
}

afterAll(async () => {
  await Promise.all(open.map((h) => h.stop()));
});
