import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { RadarProfile } from "./components/RadarProfile";
import { makeT } from "./copy";
import { TEST_BUNDLE } from "./test-fixtures";
import { RenderedExpansionDimension } from "./types";

const DIMENSIONS: RenderedExpansionDimension[] = [
  { key: "market_evidence", label: "Market Evidence", value: 0.8, tier: "well_defined", tierLabel: "Well defined" },
  { key: "commercial_ambition_differentiation", label: "Commercial Ambition & Differentiation", value: 0.5, tier: "partially_defined", tierLabel: "Partially defined" },
  { key: "local_capability_base", label: "Local Capability Base", value: 0.1, tier: "early_stage", tierLabel: "Early stage" },
  { key: "governance_constraints", label: "Governance & Constraints", value: 0, tier: "early_stage", tierLabel: "Early stage" },
  { key: "financial_framework", label: "Financial Framework", value: 0.6, tier: "partially_defined", tierLabel: "Partially defined" },
  { key: "activation_planning", label: "Activation Planning", value: 0.9, tier: "well_defined", tierLabel: "Well defined" },
];

const t = makeT(TEST_BUNDLE, "en");

describe("RadarProfile", () => {
  it("shows every dimension's label and qualitative tier — never a number, percentage or score", () => {
    render(<RadarProfile dimensions={DIMENSIONS} t={t} />);
    expect(screen.getByRole("heading", { level: 2, name: "The big picture" })).toBeInTheDocument();
    expect(screen.getByText("Six dimensions of your project, and how clearly each one is defined today.")).toBeInTheDocument();
    for (const d of DIMENSIONS) {
      expect(screen.getByText(d.label)).toBeInTheDocument();
    }
    expect(screen.getAllByText("Well defined")).toHaveLength(2);
    expect(screen.getAllByText("Partially defined")).toHaveLength(2);
    expect(screen.getAllByText("Early stage")).toHaveLength(2);
    // No raw value, percentage or score ever appears as text.
    expect(document.body.textContent).not.toMatch(/0\.\d|%|\bscore\b|\bprobability\b|\bpass\b|\bfail\b/i);
  });

  it("hides the decorative chart from assistive tech and keeps the legend as the real accessible content", () => {
    const { container } = render(<RadarProfile dimensions={DIMENSIONS} t={t} />);
    const svg = container.querySelector("svg.radar-profile-chart");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    // No role="img" alongside aria-hidden — that pairing is contradictory (a role announces an
    // element that aria-hidden then removes from the tree); the <dl> below is the sole alternative.
    expect(svg).not.toHaveAttribute("role");
    const legend = container.querySelector("dl.radar-profile-legend");
    expect(legend).toHaveAttribute("aria-label", "Definition by dimension");
    expect(legend?.querySelectorAll("dt")).toHaveLength(DIMENSIONS.length);
  });

  it("gives every tier a distinct, stable CSS hook derived from the non-localized tier key, not the localized label", () => {
    const { container } = render(<RadarProfile dimensions={DIMENSIONS} t={t} />);
    expect(container.querySelectorAll(".radar-tier-well-defined")).toHaveLength(2);
    expect(container.querySelectorAll(".radar-tier-partially-defined")).toHaveLength(2);
    expect(container.querySelectorAll(".radar-tier-early-stage")).toHaveLength(2);
  });

  it("renders nothing when there are no dimensions to show", () => {
    const { container } = render(<RadarProfile dimensions={[]} t={t} />);
    expect(container).toBeEmptyDOMElement();
  });
});
