import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { RadarProfile } from "./components/RadarProfile";
import { makeT } from "./copy";
import { TEST_BUNDLE } from "./test-fixtures";
import { RenderedExpansionDimension } from "./types";

const DIMENSIONS: RenderedExpansionDimension[] = [
  { key: "market_customer_clarity", label: "Market & Customer Clarity", value: 0.8, tier: "well_defined", tierLabel: "Well defined" },
  { key: "commercial_validation", label: "Commercial Validation", value: 0.5, tier: "partially_defined", tierLabel: "Partially defined" },
  { key: "operating_model_definition", label: "Operating Model Definition", value: 0.1, tier: "early_stage", tierLabel: "Early stage" },
  { key: "regulatory_compliance_definition", label: "Regulatory & Compliance Definition", value: 0, tier: "early_stage", tierLabel: "Early stage" },
  { key: "local_ecosystem_capabilities", label: "Local Ecosystem & Capabilities", value: 0.6, tier: "partially_defined", tierLabel: "Partially defined" },
  { key: "execution_preparedness", label: "Execution Preparedness", value: 0.9, tier: "well_defined", tierLabel: "Well defined" },
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
