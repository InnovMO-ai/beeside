import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SEED_CATALOG } from "@beeside/fa-public-engine/seed";
import { clientResolution, toPublicCatalog } from "@beeside/fa-public-engine";
import { journeyNortica } from "@beeside/fa-public-engine/testing";
import { Fa4App } from "./Fa4App";
import { RESUME_IDLE_MS, sessionStore } from "./api";
import { resetRuntimeConfigForTests } from "./runtimeConfig";

/** DSC-01 — a visit never silently re-opens an earlier project, and facts of a company that is not operating are not carried. */
type Call = { url: string; method: string; body?: { answers?: { company?: unknown } } };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const publicCatalog = toPublicCatalog(SEED_CATALOG);
function mockApi(session?: unknown) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const c: Call = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined }; calls.push(c);
    if (url === "/api/fa4/catalog") return json(publicCatalog);
    if (url === "/api/fa4/session/resolution") return json(clientResolution((c.body as { answers: never }).answers, SEED_CATALOG));
    if (url === "/api/fa4/session" && c.method === "GET" && session) return json(session);
    if (url === "/api/fa4/session" && c.method === "PUT") return json({ ok: true });
    if (url === "/api/fa4/session/idle-continuation") return json({ state: "sent" });
    return json({ error: "NOT_FOUND" }, 404);
  }));
  return calls;
}
beforeEach(() => { resetRuntimeConfigForTests(); vi.spyOn(window, "scrollTo").mockImplementation(() => undefined); sessionStorage.clear(); window.history.replaceState({}, "", "/fa4"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("the tab session is bound to a recent visit", () => {
  it("fresh → resumable; idle too long or without activity record → NOT resumable, but its token is still available to ask for the continuation link (DSC-36); cleared on demand", () => {
    sessionStore.set("T".repeat(43)); const t0 = Date.now();
    expect(sessionStore.resumable(t0 + RESUME_IDLE_MS - 1)).toBe("T".repeat(43)); expect(sessionStore.idleToken(t0 + RESUME_IDLE_MS - 1)).toBeNull();
    expect(sessionStore.resumable(t0 + RESUME_IDLE_MS + 60_000)).toBeNull(); expect(sessionStore.idleToken(t0 + RESUME_IDLE_MS + 60_000)).toBe("T".repeat(43));
    sessionStorage.removeItem("beeside.fa4.session.at");                                                                 // a token without an activity record (old build / odd restore)
    expect(sessionStore.resumable()).toBeNull(); expect(sessionStore.idleToken()).toBe("T".repeat(43));
    sessionStore.clear(); expect(sessionStore.idleToken()).toBeNull(); expect(sessionStore.get()).toBeNull();
  });
  it("a recent visit is resumed on reload; a tab coming back after a long pause NEVER re-opens the old project (DSC-36: it asks for ONE continuation link and shows the continuity screen)", async () => {
    const answers = journeyNortica("es");
    sessionStore.set("T".repeat(43));
    let calls = mockApi({ answers, step: "decision", status: "IN_PROGRESS" });
    render(<Fa4App />);
    await screen.findByRole("heading", { name: "¿En qué punto está la decisión sobre este proyecto?" });
    expect(calls.some((c) => c.url === "/api/fa4/session" && c.method === "GET")).toBe(true);
    cleanup(); vi.unstubAllGlobals();

    sessionStorage.setItem("beeside.fa4.session.at", String(Date.now() - RESUME_IDLE_MS - 5 * 60_000));                    // the same tab, much later
    calls = mockApi({ answers, step: "decision", status: "IN_PROGRESS" });
    render(<Fa4App />);
    await screen.findByTestId("idle-continuation");                                                                          // continuity screen, not the old screen and not a silent resume
    expect(calls.some((c) => c.url === "/api/fa4/session" && c.method === "GET")).toBe(false);                            // the old project was not even requested
    expect(calls.filter((c) => c.url === "/api/fa4/session/idle-continuation")).toHaveLength(1);
    expect(sessionStorage.getItem("beeside.fa4.session")).toBeNull();
  });
});

describe("answering «no business operating» drops the company facts typed before", () => {
  it("sector, size and operating countries are cleared (and saved cleared); answering «Sí» again starts empty", async () => {
    const answers = journeyNortica("es"); sessionStore.set("T".repeat(43));
    const calls = mockApi({ answers, step: "company", status: "IN_PROGRESS" });
    render(<Fa4App />);
    await screen.findByRole("heading", { name: "¿Tu empresa se encuentra operando actualmente?" });
    expect((screen.getByLabelText("¿A qué se dedica tu empresa?") as HTMLInputElement).value).toContain("envases");
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    await waitFor(() => { const put = [...calls].reverse().find((c) => c.method === "PUT"); expect(put?.body?.answers?.company).toEqual({ hasExistingBusiness: false, sector: "", size: null, operatesIn: [] }); }, { timeout: 4000 });
    fireEvent.click(screen.getByRole("radio", { name: "Sí" }));
    expect((screen.getByLabelText("¿A qué se dedica tu empresa?") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("radio", { name: "51–250" })).not.toBeChecked();
  });
});
