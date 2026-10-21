import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { syncComponents, type Answers } from "@beeside/fa-public-engine";
import { journeyNortica } from "@beeside/fa-public-engine/testing";
import { ResultScreen } from "./components/ResultScreen";
import { modelFor } from "./fa4.test-helpers";

afterEach(cleanup);
/**
 * DSC-09 — VERIFICATION (no code change): commercial rules in the YEV. Expected / obtained, on the RENDERED result.
 *  1. Mexico: need states are shown, Premium only with real value.
 *  2. Chile + South Korea: ONE «no coverage» message per country, no need states, no Premium CTA.
 *  3. Mexico + Chile + South Korea: need states only under Mexico; one message for each of the other two.
 */
const NO_COVERAGE = "beeside aún no cuenta con cobertura activa en este país.";
const withDests = (isos: string[], sameInAll: boolean): Answers => {
  const a = journeyNortica("es"); const base = a.components[0]!;
  a.destinations = { list: isos.map((iso) => ({ iso })), open: false, sameInAll };
  a.components = sameInAll ? [{ ...base, id: "c1", destinations: isos }] : isos.map((iso) => ({ ...base, id: iso.toLowerCase(), destinations: [iso] }));
  a.fronts = {}; return syncComponents(a);
};

describe("DSC-09 · expected vs obtained", () => {
  it("Mexico: states per need are shown for Mexico and no «no coverage» message appears; Premium is offered (real value)", () => {
    const m = modelFor(withDests(["MX"], true)); const { container } = render(<ResultScreen model={m} locale="es" onContinue={() => Promise.resolve(true)} />);
    expect(m.destinations).toHaveLength(1); expect(m.destinations[0]!.countryMessage).toBeNull();
    expect(m.destinations[0]!.valueGroups.length).toBeGreaterThan(0); expect(m.premium.shown).toBe(true);
    expect(container.textContent).not.toContain(NO_COVERAGE);
    expect(screen.getByTestId("premium-continuation")).toHaveTextContent("Con beeside Premium pasas del diagnóstico a la ejecución.");
  });
  // DSC-09 RESULT = FAIL on «single message per country»: the «no coverage» message is rendered TWICE for each such country (the «De un vistazo» card AND the value block). Per the batch rule a failing
  // verification is NOT fixed here (outside P1, needs Product/Code decision). `it.fails` records the expected behaviour; when it is fixed this test turns red and must become a normal `it`.
  it.fails("Chile + South Korea: exactly ONE message per country without coverage, no need states, no Premium offer", () => {
    const m = modelFor(withDests(["CL", "KR"], true)); const { container } = render(<ResultScreen model={m} locale="es" />);
    expect(m.destinations.map((d) => [d.destination, d.countryMessage])).toEqual([["CL", "NO_ACTIVE_COVERAGE"], ["KR", "NO_ACTIVE_COVERAGE"]]);
    for (const d of m.destinations) { expect(d.valueGroups).toEqual([]); expect(d.glance).toEqual([]); }
    expect(container.textContent!.split(NO_COVERAGE).length - 1).toBe(2);                    // once for each country, never repeated
    expect(m.premium.shown).toBe(false); expect(screen.queryByRole("button", { name: "Start Your Expansion" })).toBeNull();
  });
  it.fails("Mexico + Chile + South Korea: need states only for Mexico; Chile and South Korea carry one message each (single message per country)", () => {
    const m = modelFor(withDests(["MX", "CL", "KR"], false)); const { container } = render(<ResultScreen model={m} locale="es" />);
    const by = Object.fromEntries(m.destinations.map((d) => [d.destination, d]));
    expect(by.MX!.countryMessage).toBeNull(); expect(by.MX!.valueGroups.length).toBeGreaterThan(0);
    for (const k of ["CL", "KR"]) { expect(by[k]!.countryMessage).toBe("NO_ACTIVE_COVERAGE"); expect(by[k]!.valueGroups).toEqual([]); }
    expect(container.textContent!.split(NO_COVERAGE).length - 1).toBe(2);   // obtained today: 4 (twice per country)
  });
});
