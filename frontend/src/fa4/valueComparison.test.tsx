import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { journeyA, journeyB, journeyNortica } from "@beeside/fa-public-engine/testing";
import { ResultScreen } from "./components/ResultScreen";
import { ValueComparison } from "./components/ValueComparison";
import { modelFor } from "./fa4.test-helpers";

afterEach(cleanup);

describe("DSC-10 — the comparison diagram is retired from the YEV; the component is kept", () => {
  it.each(["es", "en"] as const)("the result (%s) never renders the comparison: no flag, no partial view; the brand section and Premium block stay", (loc) => {
    for (const a of [journeyA(loc), journeyB(loc), journeyNortica(loc)]) {
      const { container, unmount } = render(<ResultScreen model={modelFor(a)} locale={loc} />);
      expect(screen.queryByTestId("value-comparison")).toBeNull(); expect(container.querySelector(".vc-compare, .vc-table, .vc-card")).toBeNull();
      expect(screen.getByTestId("beeside-value-section")).toBeInTheDocument(); expect(screen.getByTestId("premium-continuation")).toBeInTheDocument();
      unmount();
    }
  });
  it("the retired component and its content are preserved and still render on their own (rediseño pendiente)", () => {
    render(<ValueComparison locale="es" />);
    const sec = screen.getByTestId("value-comparison"); expect(sec.querySelector("table")).not.toBeNull(); expect(sec.querySelectorAll("tbody tr").length).toBeGreaterThan(1);
  });
});
