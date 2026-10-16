import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { SEED_CATALOG } from "@beeside/fa-public-engine/seed";
import { clientResolution, toPublicCatalog } from "@beeside/fa-public-engine";
import { Fa4App } from "./Fa4App";
import { resetRuntimeConfigForTests } from "./runtimeConfig";

/**
 * Stabilization (closed test) notice and the personal-e-mail warning. The browser behaviour of the native modal (focus trap, inert page, pointer blocking) is covered by
 * e2e/stabilization.spec.ts; here: the exact copy, who sees it, what confirming does, and that the warning is advisory.
 */
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const publicCatalog = toPublicCatalog(SEED_CATALOG);
type Call = { url: string; method: string };
function mockApi(closedTest: boolean | "absent") {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET" });
    if (/config\.json$/.test(url)) return closedTest === "absent" ? new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } }) : json({ closedTest, label: closedTest ? "PRUEBA CONTROLADA · datos ficticios · no comercial" : null });
    if (url === "/api/fa4/catalog") return json(publicCatalog);
    if (url === "/api/fa4/session/resolution") return json(clientResolution(JSON.parse(String(init?.body)).answers, SEED_CATALOG));
    if (url === "/api/fa4/sessions") return json({ sessionToken: "S".repeat(43) }, 201);
    if (url === "/api/fa4/session" && init?.method === "PUT") return json({ ok: true });
    return json({ error: "NOT_FOUND" }, 404);
  }));
  return calls;
}
beforeEach(() => {
  resetRuntimeConfigForTests(); sessionStorage.clear(); window.history.replaceState({}, "", "/fa4"); vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  // jsdom has no <dialog> modal support: model the part we assert (open attribute; cancel event is cancelable)
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const ES = { title: "Discovery está en etapa de Estabilización", button: "Entendido, continuar", start: "Comenzar" };
const EN = { title: "Discovery is in the Stabilization phase", button: "I understand, continue", start: "Start" };

async function toIdentity(locale: "es" | "en") {
  render(<Fa4App />);
  if (locale === "en") { await screen.findByRole("button", { name: "Comenzar" }); fireEvent.click(screen.getByRole("button", { name: "Cambiar idioma a English" })); }
  fireEvent.click(await screen.findByRole("button", { name: locale === "es" ? ES.start : EN.start }));
}
async function fillIdentity(locale: "es" | "en", email: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(locale === "es" ? "Nombre" : "Name"), "Ana");
  await user.type(screen.getByLabelText(locale === "es" ? "Empresa" : "Company", { exact: true }), "Acme");
  const mail = screen.getByLabelText(locale === "es" ? /Correo/ : "Work email"); await user.clear(mail); await user.type(mail, email);
  await user.click(screen.getByLabelText(locale === "es" ? "Yo" : "I do"));
  await user.click(screen.getByLabelText(locale === "es" ? /Acepto los Términos/ : /I accept the Terms/));
  await user.click(screen.getByLabelText(locale === "es" ? /Reconozco la Política de Privacidad/ : /I acknowledge the Privacy/));
  return user;
}

describe("Stabilization notice (closed test only)", () => {
  it("ES: appears right after leaving the cover, with the approved copy and a single confirm button", async () => {
    mockApi(true); await toIdentity("es");
    const dlg = await screen.findByTestId("stabilization-notice");
    expect(within(dlg).getByRole("heading", { name: ES.title })).toBeInTheDocument();
    for (const p of ["Esta versión está siendo utilizada para validar su funcionamiento antes de su apertura comercial.", "Por favor, utiliza únicamente información ficticia o de prueba. No ingreses datos reales, confidenciales, personales o comerciales.", "La información que ingreses será procesada únicamente para generar tu Your Expansion View (YEV) durante esta prueba. No será utilizada para procesos internos, comerciales ni operativos de beeside.", "Toda la información registrada durante esta etapa será eliminada antes de pasar a Producción.", "Al continuar, confirmas que utilizarás únicamente datos ficticios o de prueba."]) expect(within(dlg).getByText(p)).toBeInTheDocument();
    expect(within(dlg).getAllByRole("button").map((b) => b.textContent)).toEqual([ES.button]);       // no close button, no second action
    expect(screen.getByRole("note")).toHaveTextContent("PRUEBA CONTROLADA");
  });
  it("EN: same notice in English", async () => {
    mockApi(true); await toIdentity("en");
    const dlg = await screen.findByTestId("stabilization-notice");
    expect(within(dlg).getByRole("heading", { name: EN.title })).toBeInTheDocument();
    for (const p of ["This version is being used to validate the platform before its commercial launch.", "Please use only fictitious or test information. Do not enter real, confidential, personal, or commercial data.", "The information you enter will be processed solely to generate your Your Expansion View (YEV) during this test. It will not be used for beeside’s internal, commercial, or operational processes.", "All information recorded during this stage will be deleted before the platform moves to Production.", "By continuing, you confirm that you will use only fictitious or test data."]) expect(within(dlg).getByText(p)).toBeInTheDocument();
    expect(within(dlg).getAllByRole("button").map((b) => b.textContent)).toEqual([EN.button]);
  });
  it("cannot be dismissed without confirming (Escape is ignored); confirming closes it and it does not return in the same session", async () => {
    mockApi(true); await toIdentity("es");
    const dlg = await screen.findByTestId("stabilization-notice");
    const cancel = new Event("cancel", { cancelable: true }); dlg.dispatchEvent(cancel); expect(cancel.defaultPrevented).toBe(true);   // Escape
    expect(screen.getByTestId("stabilization-notice")).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: ES.button }));
    await waitFor(() => expect(screen.queryByTestId("stabilization-notice")).toBeNull());
    expect(sessionStorage.getItem("beeside.fa4.stabilization-ack")).toBe("1");
    expect(screen.getByRole("heading", { name: "Cuéntanos un poco sobre ti." }).textContent).toBeTruthy();     // the identity form is right there, untouched
  });
  it("does not return for a visitor who already confirmed in this browser session", async () => {
    sessionStorage.setItem("beeside.fa4.stabilization-ack", "1"); mockApi(true); await toIdentity("es");
    await screen.findByLabelText("Nombre"); expect(screen.queryByTestId("stabilization-notice")).toBeNull();
  });
  it.each([["closed test false", false], ["no config at all (not a closed deployment)", "absent"]] as const)("is absent outside Stabilization: %s", async (_n, mode) => {
    mockApi(mode); await toIdentity("es");
    await screen.findByLabelText("Nombre"); expect(screen.queryByTestId("stabilization-notice")).toBeNull(); expect(screen.queryByRole("note")).toBeNull();
  });
  it("is not shown on the cover itself (the cover design is unchanged)", async () => {
    mockApi(true); render(<Fa4App />);
    await screen.findByRole("button", { name: ES.start }); expect(screen.queryByTestId("stabilization-notice")).toBeNull();
  });
});

describe("Personal e-mail warning (advisory, never a blocker)", () => {
  async function ready(locale: "es" | "en", closedTest: boolean | "absent" = false) { const calls = mockApi(closedTest); await toIdentity(locale); await screen.findByLabelText(locale === "es" ? "Nombre" : "Name"); return calls; }
  it("ES: a personal address warns before continuing; «Continuar con este correo» goes on", async () => {
    const calls = await ready("es"); const user = await fillIdentity("es", "ana@gmail.com");
    await user.click(screen.getByRole("button", { name: "Aceptar y continuar" }));
    const dlg = await screen.findByTestId("personal-email-warning");
    expect(within(dlg).getByRole("heading", { name: "Parece que estás usando un correo personal." })).toBeInTheDocument();
    expect(within(dlg).getByText("Recomendamos utilizar tu correo corporativo para identificar mejor tu proyecto y facilitar la continuidad con beeside.")).toBeInTheDocument();
    expect(within(dlg).getAllByRole("button").map((b) => b.textContent)).toEqual(["Usar otro correo", "Continuar con este correo"]);
    expect(calls.some((c) => c.url === "/api/fa4/sessions")).toBe(false);                      // nothing was created yet
    await user.click(within(dlg).getByRole("button", { name: "Continuar con este correo" }));
    await screen.findByRole("heading", { name: "¿Tu empresa se encuentra operando actualmente?" });
    expect(calls.filter((c) => c.url === "/api/fa4/sessions")).toHaveLength(1);                // personal e-mail is accepted
  });
  it("EN: same warning in English", async () => {
    const calls = await ready("en"); const user = await fillIdentity("en", "ana@outlook.com");
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));
    const dlg = await screen.findByTestId("personal-email-warning");
    expect(within(dlg).getByRole("heading", { name: "It looks like you're using a personal email address." })).toBeInTheDocument();
    expect(within(dlg).getByText("We recommend using your work email so we can better identify your project and support continuity with beeside.")).toBeInTheDocument();
    expect(within(dlg).getAllByRole("button").map((b) => b.textContent)).toEqual(["Use another email", "Continue with this email"]);
    await user.click(within(dlg).getByRole("button", { name: "Continue with this email" }));
    await screen.findByRole("heading", { name: "Is your company currently operating?" });
    expect(calls.filter((c) => c.url === "/api/fa4/sessions")).toHaveLength(1);
  });
  it("«Usar otro correo» returns to the e-mail field without creating anything; a corporate address then continues with NO warning", async () => {
    const calls = await ready("es"); const user = await fillIdentity("es", "ana@hotmail.com");
    await user.click(screen.getByRole("button", { name: "Aceptar y continuar" }));
    await user.click(within(await screen.findByTestId("personal-email-warning")).getByRole("button", { name: "Usar otro correo" }));
    await waitFor(() => expect(screen.queryByTestId("personal-email-warning")).toBeNull());
    const mail = screen.getByLabelText(/Correo/) as HTMLInputElement; await waitFor(() => expect(document.activeElement).toBe(mail));
    expect(calls.some((c) => c.url === "/api/fa4/sessions")).toBe(false);
    await user.clear(mail); await user.type(mail, "ana@empresa.example");
    await user.click(screen.getByRole("button", { name: "Aceptar y continuar" }));
    await screen.findByRole("heading", { name: "¿Tu empresa se encuentra operando actualmente?" });
    expect(screen.queryByTestId("personal-email-warning")).toBeNull();
  });
  it("a corporate address passes without any warning", async () => {
    const calls = await ready("es"); const user = await fillIdentity("es", "lucia@nortica.example");
    await user.click(screen.getByRole("button", { name: "Aceptar y continuar" }));
    await screen.findByRole("heading", { name: "¿Tu empresa se encuentra operando actualmente?" });
    expect(calls.filter((c) => c.url === "/api/fa4/sessions")).toHaveLength(1);
  });
  it("works together with the Stabilization notice: confirm the notice, then the warning is still advisory", async () => {
    const calls = await ready("es", true); fireEvent.click(within(await screen.findByTestId("stabilization-notice")).getByRole("button", { name: ES.button }));
    const user = await fillIdentity("es", "ana@yahoo.com.mx"); await user.click(screen.getByRole("button", { name: "Aceptar y continuar" }));
    await user.click(within(await screen.findByTestId("personal-email-warning")).getByRole("button", { name: "Continuar con este correo" }));
    await screen.findByRole("heading", { name: "¿Tu empresa se encuentra operando actualmente?" });
    expect(calls.filter((c) => c.url === "/api/fa4/sessions")).toHaveLength(1);
  });
});
