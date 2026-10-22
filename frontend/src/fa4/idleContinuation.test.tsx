import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SEED_CATALOG } from "@beeside/fa-public-engine/seed";
import { clientResolution, toPublicCatalog } from "@beeside/fa-public-engine";
import { journeyNortica } from "@beeside/fa-public-engine/testing";
import { Fa4App } from "./Fa4App";
import { RESUME_IDLE_MS, sessionStore } from "./api";
import { resetRuntimeConfigForTests } from "./runtimeConfig";

/** DSC-36 · frontend (tests 13–18 of the handoff): idle timer, reload with an idle token, stale token, every state ES/EN (the address never shown), retry and «new project». */
type Call = { url: string; method: string; auth?: string; body?: Record<string, unknown> };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const catalog = toPublicCatalog(SEED_CATALOG);
function mockApi(idle: (c: Call, n: number) => Response, opts: { session?: boolean } = {}) {
  const calls: Call[] = []; let idleN = 0; const a = journeyNortica("es");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    const c: Call = { url, method: init?.method ?? "GET", auth: h["X-Fa4-Session"], body: init?.body ? JSON.parse(String(init.body)) : undefined }; calls.push(c);
    if (url === "/api/fa4/catalog") return json(catalog);
    if (url === "/api/fa4/session/resolution") return json(clientResolution((c.body as { answers: never }).answers, SEED_CATALOG));
    if (url === "/api/fa4/session" && c.method === "GET" && opts.session !== false) return json({ answers: a, step: "decision", status: "IN_PROGRESS" });
    if (url === "/api/fa4/session" && c.method === "PUT") return json({ ok: true });
    if (url === "/api/fa4/session/idle-continuation") return idle(c, ++idleN);
    if (url.startsWith("/api/fa4/session/email-status")) return json({ state: "sent" });
    if (url === "/api/fa4/links/request") return json({ ok: true });
    return json({ error: "NOT_FOUND" }, 404);
  }));
  return calls;
}
const idleCalls = (calls: Call[]) => calls.filter((c) => c.url === "/api/fa4/session/idle-continuation");
beforeEach(() => { resetRuntimeConfigForTests(); vi.spyOn(window, "scrollTo").mockImplementation(() => undefined); sessionStorage.clear(); window.history.replaceState({}, "", "/fa4"); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function openResumed(fake = false) {
  if (fake) vi.useFakeTimers({ shouldAdvanceTime: true });            // BEFORE the app mounts: its inactivity timer must be created under the fake clock
  sessionStore.set("T".repeat(43)); render(<Fa4App />);
  await screen.findByRole("heading", { name: "¿En qué punto está la decisión sobre este proyecto?" });
}
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("13 · the tab after 30 min without interaction", () => {
  it("calls the endpoint ONCE, shows the continuity screen with the exact copy, drops the token and never shows the address", async () => {
    const calls = mockApi(() => json({ state: "sent" })); await openResumed(true);
    await advance(RESUME_IDLE_MS + 20_000);
    const scr = screen.getByTestId("idle-continuation"); expect(scr).toHaveAttribute("data-phase", "sent");
    expect(screen.getByRole("heading", { name: "Guardamos tu avance." })).toBeInTheDocument();
    expect(screen.getByText("Te enviamos un enlace al correo que registraste para que puedas continuar cuando quieras. Tu proyecto queda tal como lo dejaste.")).toBeInTheDocument();
    expect(idleCalls(calls)).toHaveLength(1); expect(idleCalls(calls)[0]!.auth).toBe("T".repeat(43));
    expect(sessionStorage.getItem("beeside.fa4.session")).toBeNull(); expect(document.body.textContent).not.toMatch(/@|lucia|nortica/i);
    await advance(10 * RESUME_IDLE_MS); expect(idleCalls(calls)).toHaveLength(1);                                          // no second call by itself
  });
  it("14 · interaction before the 30 min restarts the timer", async () => {
    const calls = mockApi(() => json({ state: "sent" })); await openResumed(true);
    await advance(20 * 60_000); fireEvent.pointerDown(document.body);
    await advance(25 * 60_000); expect(idleCalls(calls)).toHaveLength(0);                                                  // 45 min since the start, only 25 since the interaction
    await advance(6 * 60_000); expect(idleCalls(calls)).toHaveLength(1);
  });
  it("is not armed on the cover (no project yet)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); const calls = mockApi(() => json({ state: "sent" })); render(<Fa4App />); await screen.findByRole("button", { name: "Comenzar" });
    await advance(2 * RESUME_IDLE_MS); expect(idleCalls(calls)).toHaveLength(0);
  });
});

describe("15 · reload / restored tab", () => {
  it("an IDLE token shows the continuity screen (not the cover, not the old answers) and drops the token; a RECENT token resumes (DSC-01 intact)", async () => {
    const calls = mockApi(() => json({ state: "sent" }));
    sessionStore.set("T".repeat(43)); sessionStorage.setItem("beeside.fa4.session.at", String(Date.now() - RESUME_IDLE_MS - 60_000));
    render(<Fa4App />); await screen.findByTestId("idle-continuation");
    expect(idleCalls(calls)).toHaveLength(1); expect(sessionStorage.getItem("beeside.fa4.session")).toBeNull();
    expect(calls.some((c) => c.url === "/api/fa4/session" && c.method === "GET")).toBe(false); expect(screen.queryByText(/Nórtica|envases/i)).toBeNull();
    cleanup(); vi.unstubAllGlobals();
    const calls2 = mockApi(() => json({ state: "sent" })); await openResumed();
    expect(idleCalls(calls2)).toHaveLength(0); expect(calls2.some((c) => c.url === "/api/fa4/session" && c.method === "GET")).toBe(true);
  });
});

describe("16 · invalid token (expired > 24 h)", () => {
  it("shows the «stale» screen with the updated text and the request-a-new-link form", async () => {
    mockApi(() => json({ error: "UNAUTHENTICATED" }, 401));
    sessionStore.set("T".repeat(43)); sessionStorage.setItem("beeside.fa4.session.at", String(Date.now() - 2 * RESUME_IDLE_MS));
    render(<Fa4App />);
    expect(await screen.findByText("Lo que respondiste está guardado. Si no encuentras el enlace que te enviamos, pide uno nuevo.")).toBeInTheDocument();
    expect(screen.getByLabelText("Correo electrónico")).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Enviarme un enlace nuevo" })).toBeInTheDocument();
  });
});

describe("17 · states, exact copy ES / EN, never the address", () => {
  const SENT = { es: "Te enviamos un enlace al correo que registraste para que puedas continuar cuando quieras. Tu proyecto queda tal como lo dejaste.", en: "We sent a link to the email address you provided so you can continue whenever you like. Your project stays exactly as you left it." };
  const FAILED = { es: "Tu avance está guardado, pero no pudimos enviar el enlace ahora.", en: "Your progress is saved, but we couldn't send the link right now." };
  const NOTAUTH = { es: "Tu avance está guardado. Durante la etapa de Estabilización sólo podemos enviar enlaces a direcciones autorizadas.", en: "Your progress is saved. During Stabilization we can only send links to authorized addresses." };
  const cases: Array<[string, () => Response, string, Record<"es" | "en", string>, boolean]> = [
    ["sent", () => json({ state: "sent" }), "sent", SENT, false],
    ["failed (502)", () => json({ error: "EMAIL_NOT_SENT" }, 502), "failed", FAILED, true],
    ["not authorized (403)", () => json({ error: "RECIPIENT_NOT_AUTHORIZED" }, 403), "unauthorized", NOTAUTH, false],
    ["daily quota (429): no retry (it would answer 429 again)", () => json({ error: "RATE_LIMITED" }, 429), "failedNoRetry", FAILED, false],
  ];
  const titles = { es: "Guardamos tu avance.", en: "We saved your progress." };
  it.each(cases)("%s", async (_n, reply, phase, copy, retryable) => {
    for (const loc of ["es", "en"] as const) {
      mockApi(reply); sessionStore.set("T".repeat(43)); sessionStorage.setItem("beeside.fa4.session.at", String(Date.now() - 2 * RESUME_IDLE_MS)); sessionStorage.setItem("beeside.fa4.locale", loc);
      const r = render(<Fa4App />); await screen.findByTestId("idle-continuation");
      expect(screen.getByTestId("idle-continuation")).toHaveAttribute("data-phase", phase);
      expect(screen.getByRole("heading", { name: titles[loc] })).toBeInTheDocument(); expect(screen.getByText(copy[loc])).toBeInTheDocument();
      expect(!!screen.queryByRole("button", { name: loc === "es" ? "Intentar de nuevo" : "Try again" })).toBe(retryable);
      expect(screen.getByRole("button", { name: loc === "es" ? "Empezar un proyecto nuevo" : "Start a new project" })).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/@/); expect(document.documentElement.lang).toBe(loc);
      r.unmount(); cleanup(); vi.unstubAllGlobals(); sessionStorage.clear();
    }
  });
  it("«sending»: the screen shows the approved «We saved your progress. We're sending your link…» while the delivery is pending, then the real outcome", async () => {
    mockApi(() => json({ state: "pending" })); sessionStore.set("T".repeat(43)); sessionStorage.setItem("beeside.fa4.session.at", String(Date.now() - 2 * RESUME_IDLE_MS));
    render(<Fa4App />); await screen.findByTestId("idle-continuation");
    expect(screen.getByTestId("idle-continuation")).toHaveAttribute("data-phase", "sending");
    expect(screen.getByRole("heading", { name: "Guardamos tu avance. Estamos enviando tu enlace para continuar…" })).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByTestId("idle-continuation")).toHaveAttribute("data-phase", "sent"), { timeout: 6000 });   // email-status → sent
  });
});

describe("18 · retry and «start a new project»", () => {
  it("«Try again» retries the SAME delivery (retry:true, token kept in memory only); «Start a new project» goes to the cover without any token", async () => {
    const calls = mockApi((_c, n) => (n === 1 ? json({ error: "EMAIL_NOT_SENT" }, 502) : json({ state: "sent" })));
    sessionStore.set("T".repeat(43)); sessionStorage.setItem("beeside.fa4.session.at", String(Date.now() - 2 * RESUME_IDLE_MS));
    render(<Fa4App />); await screen.findByTestId("idle-continuation");
    expect(screen.getByTestId("idle-continuation")).toHaveAttribute("data-phase", "failed"); expect(sessionStorage.getItem("beeside.fa4.session")).not.toBeNull();   // a transient failure keeps the idle token so a reload can still retry (it is never re-opened as a session)
    fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    await vi.waitFor(() => expect(screen.getByTestId("idle-continuation")).toHaveAttribute("data-phase", "sent"));
    expect(idleCalls(calls)).toHaveLength(2); expect(idleCalls(calls)[1]!.body).toEqual({ retry: true }); expect(idleCalls(calls)[1]!.auth).toBe("T".repeat(43));
    fireEvent.click(screen.getByRole("button", { name: "Empezar un proyecto nuevo" }));
    await screen.findByRole("button", { name: "Comenzar" }); expect(sessionStorage.getItem("beeside.fa4.session")).toBeNull();
  });
});
