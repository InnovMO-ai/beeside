import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CapabilityLandscapeGrid } from "./components/CapabilityLandscapeGrid";
import { RenderedNeedsLandscapeItem } from "./types";

const ITEMS: RenderedNeedsLandscapeItem[] = [
  { key: "company_setup", label: "Company Setup", status: "covered_internally", statusLabel: "Covered internally" },
  { key: "tax", label: "Tax", status: "in_progress", statusLabel: "In progress" },
  { key: "hr_payroll_social_security", label: "HR, Payroll & Social Security", status: "needs_resolution", statusLabel: "Still needs to be resolved" },
  { key: "audit", label: "Audit", status: "needs_confirmation", statusLabel: "Need to confirm whether it applies" },
];

const LANDSCAPE = {
  title: "Capability landscape",
  intro: "Where things stand today across what you told us your project needs.",
  items: ITEMS,
};

describe("CapabilityLandscapeGrid", () => {
  it("shows every declared need with its status label, never a provider name", () => {
    render(<CapabilityLandscapeGrid landscape={LANDSCAPE} />);
    expect(screen.getByRole("heading", { level: 2, name: "Capability landscape" })).toBeInTheDocument();
    for (const item of ITEMS) {
      expect(screen.getByText(item.label)).toBeInTheDocument();
      expect(screen.getByText(item.statusLabel)).toBeInTheDocument();
    }
    expect(document.body.textContent).not.toMatch(/provider [a-z]+ (inc|llc|corp)/i);
  });

  it("gives every status a distinct, stable CSS hook from the non-localized status key", () => {
    const { container } = render(<CapabilityLandscapeGrid landscape={LANDSCAPE} />);
    expect(container.querySelector(".needs-status-covered_internally")).toBeInTheDocument();
    expect(container.querySelector(".needs-status-in_progress")).toBeInTheDocument();
    expect(container.querySelector(".needs-status-needs_resolution")).toBeInTheDocument();
    expect(container.querySelector(".needs-status-needs_confirmation")).toBeInTheDocument();
  });

  it("never frames coverage as a purchase decision — no price, buy or upgrade wording", () => {
    render(<CapabilityLandscapeGrid landscape={LANDSCAPE} />);
    expect(document.body.textContent).not.toMatch(/\$|price|buy|purchase|upgrade|subscribe/i);
  });

  it("renders nothing when there are no declared needs", () => {
    const { container } = render(<CapabilityLandscapeGrid landscape={{ ...LANDSCAPE, items: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
