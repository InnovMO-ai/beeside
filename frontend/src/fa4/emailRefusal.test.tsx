import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SEED_CATALOG } from "@beeside/fa-public-engine/seed";
import { clientResolution, toPublicCatalog } from "@beeside/fa-public-engine";
import { journeyA } from "@beeside/fa-public-engine/testing";
import { Fa4App } from "./Fa4App";
import { modelFor } from "./fa4.test-helpers";
import { resetRuntimeConfigForTests } from "./runtimeConfig";

/** DSC-33 — the Stabilization message appears ONLY for the recipient-policy refusal; every other e-mail failure keeps the generic, real error. */
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const NOT_AUTH = /Durante la etapa de Estabilización sólo podemos enviar el resultado a direcciones autorizadas\. Tu resultado sigue disponible aquí\./;

function open(emailResponse: Response) {
  const a = journeyA("es"); const model = modelFor(a);
  sessionStorage.setItem("beeside.fa4.session", "S".repeat(43)); sessionStorage.setItem("beeside.fa4.session.at", String(Date.now()));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url === "/api/fa4/catalog") return json(toPublicCatalog(SEED_CATALOG));
    if (url === "/api/fa4/session/resolution") return json(clientResolution(JSON.parse(String(init!.body)).answers, SEED_CATALOG));
    if (url === "/api/fa4/session" && method === "GET") return json({ answers: a, step: "extra", status: "IN_PROGRESS" });
    if (url === "/api/fa4/session" && method === "PUT") return json({ ok: true });
    if (url === "/api/fa4/session/result" && method === "POST") return json({ preview: true, previewToken: "a".repeat(32), model });
    if (url === "/api/fa4/session/result/email") return emailResponse;
    return json({ error: "NOT_FOUND" }, 404);
  }));
}
beforeEach(() => { resetRuntimeConfigForTests(); vi.spyOn(window, "scrollTo").mockImplementation(() => undefined); sessionStorage.clear(); window.history.replaceState({}, "", "/fa4"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("result e-mail refusals", () => {
  it("recipient not authorized (closed test): the specific Stabilization message, the result stays available, no retry button", async () => {
    open(json({ error: "RECIPIENT_NOT_AUTHORIZED", message: "x" }, 403));
    render(<Fa4App />);
    fireEvent.click(await screen.findByRole("button", { name: "Ver mi resultado" }));
    fireEvent.click(await screen.findByRole("button", { name: "Recibir este resultado por email" }));
    expect(await screen.findByText(NOT_AUTH)).toBeInTheDocument();
    expect(screen.getByTestId("result-screen")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recibir este resultado por email" })).toBeNull();
    expect(screen.queryByText(/No pudimos enviarlo ahora/)).toBeNull();
  });
  it("a real failure (SMTP / backend) is NOT disguised: the generic error and the retry stay", async () => {
    open(json({ error: "EMAIL_NOT_SENT", message: "x", details: { state: "failed" } }, 502));
    render(<Fa4App />);
    fireEvent.click(await screen.findByRole("button", { name: "Ver mi resultado" }));
    fireEvent.click(await screen.findByRole("button", { name: "Recibir este resultado por email" }));
    expect(await screen.findByText(/No pudimos enviarlo ahora/)).toBeInTheDocument();
    expect(screen.queryByText(NOT_AUTH)).toBeNull();
    expect(screen.getByRole("button", { name: "Intentar de nuevo" })).toBeInTheDocument();
  });
});
