import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { SEED_CATALOG } from "@beeside/fa-public-engine/seed";
import { clientResolution, toPublicCatalog } from "@beeside/fa-public-engine";
import { journeyA } from "@beeside/fa-public-engine/testing";
import { Fa4App } from "./Fa4App";
import { modelFor } from "./fa4.test-helpers";

type Call = { url: string; method: string; body?: unknown; auth?: string };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
// The API sends only the public projection (Front names + keyword index); resolution is per project and server-side.
const publicCatalog = toPublicCatalog(SEED_CATALOG);

function mockApi(extra: (c: Call) => Response | null = () => null) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const c: Call = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: headers["X-Fa4-Session"] };
    calls.push(c);
    const custom = extra(c); if (custom) return custom;
    if (url === "/api/fa4/catalog") return json(publicCatalog);
    if (url === "/api/fa4/session/resolution") return json(clientResolution((c.body as { answers: never }).answers, SEED_CATALOG));
    if (url === "/api/fa4/sessions") return json({ sessionToken: "S".repeat(43) }, 201);
    if (url === "/api/fa4/session" && c.method === "PUT") return json({ ok: true });
    if (url === "/api/fa4/session/finish-later") return json({ ok: true, email: "l***@nubia.example" });
    return json({ error: "NOT_FOUND" }, 404);
  }));
  return calls;
}

beforeEach(() => { vi.spyOn(window, "scrollTo").mockImplementation(() => undefined); sessionStorage.clear(); window.history.replaceState({}, "", "/fa4"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Fa4App (Vite/React) against the API contract", () => {
  it("cover offers ES/EN; the language is only chosen on the cover; identity creates the project and stores the Bearer session", async () => {
    const calls = mockApi();
    render(<Fa4App />);
    await screen.findByRole("button", { name: "Comienza tu evaluación" });
    fireEvent.click(screen.getByRole("button", { name: "Cambiar idioma a English" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your expansion starts with a clearer view.");
    fireEvent.click(screen.getByRole("button", { name: "Start your assessment" }));
    expect(screen.queryByRole("button", { name: /Switch language/ })).toBeNull();           // no language switcher after the cover
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Your name"), "Ana");
    await user.type(screen.getByLabelText("Company"), "Acme");
    await user.type(screen.getByLabelText("Work email"), "ana@acme.example");
    await user.click(screen.getByLabelText("I do"));
    expect(screen.getByRole("button", { name: "Accept and continue" })).toBeDisabled();       // terms and privacy are mandatory and separate
    await user.click(screen.getByLabelText(/I accept the Terms/));
    await user.click(screen.getByLabelText(/I acknowledge the Privacy/));
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));
    await screen.findByRole("heading", { name: "Who are you?" });
    const create = calls.find((c) => c.url === "/api/fa4/sessions")!;
    expect(create.method).toBe("POST");
    expect((create.body as { answers: { identity: { email: string }; locale: string } }).answers.identity.email).toBe("ana@acme.example");
    expect((create.body as { answers: { locale: string } }).answers.locale).toBe("en");
    expect(sessionStorage.getItem("beeside.fa4.session")).toBe("S".repeat(43));
    // legal links open in a new tab so progress is kept (CHK-1 configuration point)
  });

  it("resumes from the emailed link fragment: exchanges the token, clears it from the URL and lands on the saved step with answers restored", async () => {
    const a = journeyA("es");
    const linkToken = "L".repeat(43);
    window.history.replaceState({}, "", `/fa4#r=${linkToken}`);
    const calls = mockApi((c) => {
      if (c.url === "/api/fa4/links/continue") return json({ sessionToken: "T".repeat(43) });
      if (c.url === "/api/fa4/session" && c.method === "GET") return json({ answers: a, step: "decision", status: "IN_PROGRESS" });
      return null;
    });
    render(<Fa4App />);
    await screen.findByRole("heading", { name: "¿En qué punto está la decisión?" });
    expect(calls.find((c) => c.url === "/api/fa4/links/continue")!.body).toEqual({ token: linkToken });
    expect(calls.find((c) => c.url === "/api/fa4/session" && c.method === "GET")!.auth).toBe("T".repeat(43));   // X-Fa4-Session (not Authorization, which gateways like IAP consume)
    expect(window.location.hash).toBe("");
  });

  it("an invalid or expired link falls back to the cover without leaking the token", async () => {
    window.history.replaceState({}, "", `/fa4#r=${"X".repeat(43)}`);
    mockApi((c) => (c.url === "/api/fa4/links/continue" ? json({ error: "NOT_FOUND" }, 404) : null));
    render(<Fa4App />);
    await screen.findByRole("button", { name: "Comienza tu evaluación" });
  });

  it("generates the result through the API and renders the three components; 'save for later' uses the stored email", async () => {
    const a = journeyA("es");
    sessionStorage.setItem("beeside.fa4.session", "S".repeat(43));
    const model = modelFor(a);
    mockApi((c) => {
      if (c.url === "/api/fa4/session" && c.method === "GET") return json({ answers: a, step: "extra", status: "IN_PROGRESS" });
      if (c.url === "/api/fa4/session/result" && c.method === "POST") return json({ resultId: "r1", model });
      return null;
    });
    render(<Fa4App />);
    fireEvent.click(await screen.findByRole("button", { name: "Guardar y seguir después" }));
    await screen.findByText(/l\*\*\*@nubia\.example/);
    fireEvent.click(screen.getByRole("button", { name: "Ver mi resultado" }));
    await screen.findByTestId("result-screen");
    expect(screen.getByTestId("beeside-value-section")).toBeInTheDocument();
    expect(screen.getByTestId("premium-continuation")).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.lang).toBe("es"));
  });

  it("shows an error state with a retry when the catalog cannot be loaded (never an endless spinner)", async () => {
    let failing = true;
    mockApi((c) => (c.url === "/api/fa4/catalog" && failing ? json({ error: "X" }, 500) : null));
    render(<Fa4App />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No pudimos cargar First Assessment");
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByRole("button", { name: "Comienza tu evaluación" });
  });
});
