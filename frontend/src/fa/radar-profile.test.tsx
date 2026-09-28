import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { RadarProfile } from "./components/RadarProfile";
import { makeT } from "./copy";
import { TEST_BUNDLE } from "./test-fixtures";
import { RenderedExpansionDimension } from "./types";

const DIMENSIONS: RenderedExpansionDimension[] = [
  { key: "market_evidence", label: "Market Evidence", value: 0.8, tier: "well_defined", tierLabel: "Well defined", demand: { value: 0.5, tier: "medium", tierLabel: "Medium" }, demandNote: null },
  {
    key: "commercial_ambition_differentiation",
    label: "Commercial Ambition & Differentiation",
    value: 0.5,
    tier: "partially_defined",
    tierLabel: "Partially defined",
    demand: null,
    demandNote: "There isn't yet a structured way to measure execution demand for this area.",
  },
  { key: "local_capability_base", label: "Local Capability Base", value: 0.1, tier: "early_stage", tierLabel: "Early stage", demand: { value: 0.8, tier: "high", tierLabel: "High" }, demandNote: null },
  { key: "governance_constraints", label: "Governance & Constraints", value: 0, tier: "early_stage", tierLabel: "Early stage", demand: { value: 0.55, tier: "medium", tierLabel: "Medium" }, demandNote: null },
  { key: "financial_framework", label: "Financial Framework", value: 0.6, tier: "partially_defined", tierLabel: "Partially defined", demand: { value: 0.82, tier: "high", tierLabel: "High" }, demandNote: null },
  { key: "activation_planning", label: "Activation Planning", value: 0.9, tier: "well_defined", tierLabel: "Well defined", demand: { value: 0.52, tier: "medium", tierLabel: "Medium" }, demandNote: null },
];

const DUAL_PROFILE = {
  title: "Definition & Evidence vs. Execution Demand",
  intro: "See where your expansion plan is well defined and where execution will demand more from the business.",
  definitionLabel: "Definition & Evidence",
  demandLabel: "Execution Demand",
};

const t = makeT(TEST_BUNDLE, "en");

describe("RadarProfile", () => {
  it("shows every dimension's label and qualitative tier for both series — never a number, percentage or score", () => {
    render(<RadarProfile dimensions={DIMENSIONS} dualProfile={DUAL_PROFILE} t={t} />);
    expect(screen.getByRole("heading", { level: 2, name: "Definition & Evidence vs. Execution Demand" })).toBeInTheDocument();
    expect(screen.getByText(DUAL_PROFILE.intro)).toBeInTheDocument();
    for (const d of DIMENSIONS) {
      expect(screen.getAllByText(d.label).length).toBeGreaterThan(0);
    }
    // Definition & Evidence tiers.
    expect(screen.getAllByText("Well defined", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Partially defined", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Early stage", { exact: false }).length).toBeGreaterThan(0);
    // Execution Demand tiers, and the NOT_EVALUABLE case's note.
    expect(screen.getAllByText("Medium", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("High", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByText("There isn't yet a structured way to measure execution demand for this area.")).toBeInTheDocument();
    // No raw value, percentage or score ever appears as text.
    expect(document.body.textContent).not.toMatch(/0\.\d|%|\bscore\b|\bprobability\b|\bpass\b|\bfail\b/i);
  });

  it("shows a plain not-evaluable note in the track view instead of fabricating a demand marker", () => {
    render(<RadarProfile dimensions={DIMENSIONS} dualProfile={DUAL_PROFILE} t={t} />);
    expect(screen.getByText("Not yet evaluable")).toBeInTheDocument();
  });

  it("hides the decorative track and chart from assistive tech and keeps the legend as the real accessible content", () => {
    const { container } = render(<RadarProfile dimensions={DIMENSIONS} dualProfile={DUAL_PROFILE} t={t} />);
    const track = container.querySelector(".dual-profile-track");
    expect(track).toHaveAttribute("aria-hidden", "true");
    const svg = container.querySelector("svg.radar-profile-chart");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    // No role="img" alongside aria-hidden — that pairing is contradictory (a role announces an
    // element that aria-hidden then removes from the tree); the <dl> below is the sole alternative.
    expect(svg).not.toHaveAttribute("role");
    const legend = container.querySelector("dl.radar-profile-legend");
    expect(legend).toHaveAttribute("aria-label", "Definition & Evidence and Execution Demand by dimension");
    expect(legend?.querySelectorAll("dt")).toHaveLength(DIMENSIONS.length);
  });

  it("gives every Definition & Evidence tier a distinct, stable CSS hook derived from the non-localized tier key", () => {
    const { container } = render(<RadarProfile dimensions={DIMENSIONS} dualProfile={DUAL_PROFILE} t={t} />);
    expect(container.querySelectorAll(".radar-tier-well-defined")).toHaveLength(2);
    expect(container.querySelectorAll(".radar-tier-partially-defined")).toHaveLength(2);
    expect(container.querySelectorAll(".radar-tier-early-stage")).toHaveLength(2);
  });

  it("gives the Execution Demand series its own distinct CSS hooks, including a not-evaluable hook that never collides with Definition & Evidence's", () => {
    const { container } = render(<RadarProfile dimensions={DIMENSIONS} dualProfile={DUAL_PROFILE} t={t} />);
    expect(container.querySelectorAll(".radar-demand-tier-medium")).toHaveLength(3);
    expect(container.querySelectorAll(".radar-demand-tier-high")).toHaveLength(2);
    expect(container.querySelectorAll(".radar-demand-tier-not-evaluable")).toHaveLength(1);
    expect(container.querySelectorAll(".radar-point-not-evaluable")).toHaveLength(1);
  });

  it("renders nothing when there are no dimensions to show", () => {
    const { container } = render(<RadarProfile dimensions={[]} dualProfile={DUAL_PROFILE} t={t} />);
    expect(container).toBeEmptyDOMElement();
  });
});
