import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import axe from "axe-core";
import { journeyA, journeyB, journeyC } from "@beeside/fa-public-engine/testing";
import { ResultScreen } from "./components/ResultScreen";
import { modelFor } from "./fa4.test-helpers";

afterEach(cleanup);
const FORBIDDEN = ["Por confirmar", "Sin servicio hoy", "Snapshot", "radar", "readiness", "SOURCEABLE", "NOT_OFFERED", "UNMAPPED_NEED", "NO_ACTIVE_COVERAGE", "DEVELOPING", "Grant Thornton", "Baker Tilly", "Traxión", "Santander", "MAPFRE", "Garza Ponce", "AMPIP"];

async function a11y(container: HTMLElement) {
  const res = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }, rules: { "color-contrast": { enabled: false } } });   // contrast: checked in a real browser (e2e)
  return res.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
}

describe("result composition: YourExpansionView → BeesideValueSection → PremiumContinuation", () => {
  it.each([["A", journeyA("es")], ["B", journeyB("es", "unknown")], ["C", journeyC("es", "unknown")]] as const)("Journey %s renders the three independent components in canonical order", (_n, a) => {
    const { container } = render(<ResultScreen model={modelFor(a)} locale="es" onContinue={vi.fn()} onEmail={vi.fn()} />);
    const root = screen.getByTestId("result-screen");
    const order = ["#yev-title", "[data-testid=beeside-value-section]", "[data-testid=premium-continuation]"].map((s) => root.querySelector(s)!);
    for (const el of order) expect(el).toBeTruthy();
    expect(order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1]!.compareDocumentPosition(order[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const value = screen.getByTestId("beeside-value-section");
    expect(within(value).getByText("Expande tu negocio.", { exact: false })).toBeInTheDocument();
    // the four fixed components (Option A, frozen copy for three; Strategic Advisory line is NEEDS_CANONICAL_COPY)
    expect(Array.from(value.querySelectorAll("[data-component]")).map((e) => e.getAttribute("data-component"))).toEqual(["sherpa", "hive", "operation-hub", "strategic-advisory"]);
    for (const t of ["Un Sherpa a tu lado", "Especialistas seleccionados", "Todo en un solo lugar", "Strategic Advisory"]) expect(within(value).getByText(t, { exact: true })).toBeInTheDocument();
    for (const bad of FORBIDDEN) expect(container.textContent ?? "", bad).not.toContain(bad);
    expect(container.textContent ?? "").not.toMatch(/\d\s?%/);
  });

  it("the institutional block is identical for every result (independent of the answers) — Journey A included", () => {
    const html = (a: Parameters<typeof modelFor>[0]) => { const r = render(<ResultScreen model={modelFor(a)} locale="es" />); const h = screen.getByTestId("beeside-value-section").innerHTML; r.unmount(); return h; };
    const ha = html(journeyA()); expect(ha).toBe(html(journeyB())); expect(ha).toBe(html(journeyC()));
  });

  it("Journey A (ES): states from the registry, Premium continuation offered", () => {
    render(<ResultScreen model={modelFor(journeyA("es"))} locale="es" onContinue={vi.fn()} />);
    expect(screen.getAllByText("beeside puede ayudarte").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tu beeside Sherpa buscará y validará la mejor opción para ti").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Depende de cómo decidas operar").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Continuar con beeside" })).toBeInTheDocument();
    expect(screen.getByText("Antes de Premium, no compartimos tu proyecto con proveedores.", { exact: false })).toBeInTheDocument();
  });

  it("Journey B: multi-destination grouping, country message instead of per-service states (ES)", () => {
    const { container } = render(<ResultScreen model={modelFor(journeyB("es", "unknown"))} locale="es" />);
    expect(screen.getByText("Trece temas aplican en dos países. Dos más dependen de una decisión.")).toBeInTheDocument();
    expect(screen.getAllByText("beeside aún no cuenta con cobertura activa en este país.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Lo revisaremos con tu Sherpa").length).toBeGreaterThan(0);
    const names = Array.from(container.querySelectorAll(".dest-head h2")).map((h) => h.textContent);
    expect(names.filter((n) => n?.startsWith("México")).length).toBe(2);        // "what it involves" + "where beeside adds value" (the glance uses h3)
    expect(container.textContent).toContain("Estados Unidos · Texas");
  });

  it("Journey C: marked vs NOT INDICATED semantics are visible and never read as resolved", () => {
    render(<ResultScreen model={modelFor(journeyC("es", "unknown"))} locale="es" />);
    expect(screen.getByText("Doce temas aplican. Marcaste ocho.")).toBeInTheDocument();
    expect(screen.getByText(/«No indicado» no significa resuelto/)).toBeInTheDocument();
    expect(screen.getByText("«grúas de gran capacidad»")).toBeInTheDocument();
  });

  it("English: canonical EN state and country messages, no Spanish leakage in the fixed labels", () => {
    const { container } = render(<ResultScreen model={modelFor(journeyB("en", "unknown"))} locale="en" />);
    for (const t of ["beeside can help", "Your beeside Sherpa will find and validate the best option for you", "beeside can explore the best option with you", "We'll review it with your Sherpa", "beeside does not yet have active coverage in this country."])
      expect(screen.getAllByText(t).length, t).toBeGreaterThan(0);
    expect(screen.getByText("Expand your business.", { exact: false })).toBeInTheDocument();
    expect(container.textContent).not.toContain("beeside puede ayudarte");
  });

  it("without real value there is no Premium call to action (D-050)", () => {
    const a = journeyA(); a.destinations = { list: [{ iso: "JP" }], open: false, sameInAll: true }; a.components = [{ ...a.components[0]!, destinations: ["JP"] }];
    render(<ResultScreen model={modelFor(a)} locale="es" onContinue={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Continuar con beeside" })).toBeNull();
    expect(screen.getByRole("button", { name: "Recibir este resultado por email" })).toBeInTheDocument();
  });

  it.each([["es"], ["en"]] as const)("has no serious/critical accessibility violations (WCAG 2.1 AA, %s)", async (loc) => {
    for (const a of [journeyA(loc), journeyB(loc, "unknown"), journeyC(loc, "unknown")]) {
      const { container, unmount } = render(<ResultScreen model={modelFor(a)} locale={loc} />);
      expect(await a11y(container)).toEqual([]);
      unmount();
    }
  });
});
