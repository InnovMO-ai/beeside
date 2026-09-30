import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StandOutPanels } from "./components/StandOutPanels";
import { makeT } from "./copy";
import { TEST_BUNDLE } from "./test-fixtures";
import { RenderedSnapshot } from "./types";

const COUNTS: RenderedSnapshot["counts"] = [
  { tone: "well_defined", label: "Well defined", count: 2 },
  { tone: "needs_attention", label: "Needs attention", count: 1 },
  { tone: "resolve_early", label: "Resolve early", count: 1 },
];

const PANELS: RenderedSnapshot["panels"] = [
  {
    tone: "well_defined",
    title: "Well defined",
    intro: "You have a solid foundation in these areas.",
    items: [{ areaId: 1, label: "Market clarity", reason: null }],
  },
  {
    tone: "resolve_early",
    title: "Resolve early",
    intro: "Addressing these early helps avoid delays later.",
    items: [{ areaId: 2, label: "Regulatory setup", reason: "No local entity yet" }],
  },
];

const t = makeT(TEST_BUNDLE, "en");

describe("StandOutPanels", () => {
  it("shows the overview counts first, then each tone's specific findings", () => {
    const { container } = render(<StandOutPanels counts={COUNTS} panels={PANELS} t={t} />);
    expect(screen.getByRole("heading", { level: 2, name: "What stands out" })).toBeInTheDocument();

    const countsList = container.querySelector(".snapshot-counts")!;
    expect(countsList).toHaveTextContent("2Well defined");
    expect(countsList).toHaveTextContent("1Needs attention");
    expect(countsList).toHaveTextContent("1Resolve early");

    expect(screen.getByRole("heading", { level: 3, name: "Well defined" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Resolve early" })).toBeInTheDocument();
    expect(screen.getByText("Market clarity")).toBeInTheDocument();
    expect(screen.getByText("Regulatory setup")).toBeInTheDocument();
    expect(screen.getByText("No local entity yet")).toBeInTheDocument();

    // Overview counts precede the specific per-tone panel breakdown (general, then specific).
    const countsIndex = container.innerHTML.indexOf("snapshot-counts");
    const panelsIndex = container.innerHTML.indexOf("snapshot-panels");
    expect(countsIndex).toBeGreaterThan(-1);
    expect(panelsIndex).toBeGreaterThan(countsIndex);
  });

  it("never depends on color alone — every count and panel also carries an icon and a label", () => {
    const { container } = render(<StandOutPanels counts={COUNTS} panels={PANELS} t={t} />);
    const chips = container.querySelectorAll(".status-chip");
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of Array.from(chips)) {
      expect(chip.querySelector("svg")).toBeInTheDocument();
      expect(chip.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it("renders nothing when there is nothing to stand out", () => {
    const { container } = render(<StandOutPanels counts={[]} panels={[]} t={t} />);
    expect(container).toBeEmptyDOMElement();
  });
});
