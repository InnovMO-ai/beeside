import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, defaultTransport } from "../api/client";
import { sessionStore } from "../api/session";
import { ApiFailure, LOCALE_HEADER, liveTransport, type Transport, type TransportRequest } from "../api/transport";

describe("API client", () => {
  beforeEach(() => { sessionStorage.clear(); sessionStore.clear(); });

  it("uses the live transport unless the build was made in mock mode", async () => {
    expect(import.meta.env.VITE_PRECISION_API_MODE).not.toBe("mock");
    expect(await defaultTransport()).toBe(liveTransport);
  });

  it("sends the bearer token and the locale header, and keeps the exchange anonymous", async () => {
    const seen: TransportRequest[] = [];
    const transport: Transport = async (r) => { seen.push(r); return { status: 200, body: {} }; };
    const client = createClient({ transport: async () => transport, locale: () => "es", onUnauthenticated: () => undefined });
    await client.exchange("abc");
    sessionStore.set("tok-1");
    await client.center();
    expect(seen[0].headers.Authorization).toBeUndefined();
    expect(seen[0].path).toBe("/api/precision/session/exchange");
    expect(seen[1].headers.Authorization).toBe("Bearer tok-1");
    expect(seen[1].headers[LOCALE_HEADER]).toBe("es");
    expect(seen[1].path).toBe("/api/precision/center");
  });

  it("turns a 401 into a cleared session and a typed failure without leaking server text", async () => {
    const onUnauthenticated = vi.fn();
    sessionStore.set("tok-2");
    const transport: Transport = async () => ({ status: 401, body: { error: "UNAUTHENTICATED", message: "secret internal detail" } });
    const client = createClient({ transport: async () => transport, locale: () => "en", onUnauthenticated });
    const err = await client.center().catch((e) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect(err.code).toBe("UNAUTHENTICATED");
    expect(String(err.message ?? "")).not.toMatch(/secret internal detail/);
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it("treats 5xx as retryable and 4xx as not unless the server says otherwise", async () => {
    const mk = (status: number, body: unknown = {}) => createClient({ transport: async () => async () => ({ status, body }), locale: () => "en", onUnauthenticated: () => undefined });
    expect((await mk(503, { error: "TEMPORARILY_UNAVAILABLE" }).center().catch((e) => e)).retryable).toBe(true);
    expect((await mk(409, { error: "PREVIEW_STALE" }).center().catch((e) => e)).retryable).toBe(false);
  });
});
