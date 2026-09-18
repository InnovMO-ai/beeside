import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PathwayDiagram } from "./components/PathwayDiagram";
import { makeT } from "./copy";
import { TEST_BUNDLE } from "./test-fixtures";
import { RenderedPathwayItem } from "./types";

const t = makeT(TEST_BUNDLE, "en");

const ITEMS: RenderedPathwayItem[] = [
  { key: "company_setup", label: "Company Setup", stage: "now", isImmediatePriority: true, isBlocker: true, dependsOnLabel: null },
  { key: "tax", label: "Tax", stage: "define", isImmediatePriority: false, isBlocker: false, dependsOnLabel: "Company Setup" },
  { key: "hr_payroll_social_security", label: "HR, Payroll & Social Security", stage: "enable", isImmediatePriority: false, isBlocker: false, dependsOnLabel: "Tax" },
];

const PATHWAY = {
  title: "Your initial path",
  intro: "A starting sequence based on what you shared — not a rigid methodology or a guarantee.",
  stageLabels: { now: "Now", define: "Define", enable: "Enable", launch: "Launch" },
  immediateLabel: "Immediate priority",
  blockerLabel: "Blocker",
  items: ITEMS,
};

describe("PathwayDiagram", () => {
  it("lays out four stage columns in order, with every stage always visible even when empty", () => {
    render(<PathwayDiagram pathway={PATHWAY} t={t} />);
    expect(screen.getByRole("heading", { level: 2, name: "Your initial path" })).toBeInTheDocument();
    const stageTitles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(stageTitles).toEqual(["1Now", "2Define", "3Enable", "4Launch"]);
    // LAUNCH has no items in this fixture but its column still renders. The ordinal is aria-hidden,
    // so the heading's accessible name is the plain stage label ("Launch"), not "4Launch".
    expect(screen.getByRole("heading", { level: 3, name: "Launch" }).closest(".pathway-stage")).toHaveAttribute("data-empty", "true");
  });

  it("places each item under its own stage as a parallel path, not a forced single line", () => {
    const { container } = render(<PathwayDiagram pathway={PATHWAY} t={t} />);
    const nowColumn = screen.getByRole("heading", { level: 3, name: "Now" }).closest(".pathway-stage");
    const defineColumn = screen.getByRole("heading", { level: 3, name: "Define" }).closest(".pathway-stage");
    expect(nowColumn).toHaveTextContent("Company Setup");
    expect(defineColumn).toHaveTextContent("Tax");
    expect(container.querySelectorAll(".pathway-item")).toHaveLength(3);
  });

  it("flags immediate priority and blocker items with the same wording used in What Matters Now", () => {
    render(<PathwayDiagram pathway={PATHWAY} t={t} />);
    const nowColumn = screen.getByText("Company Setup").closest(".pathway-item")!;
    expect(nowColumn).toHaveTextContent("Immediate priority");
    expect(nowColumn).toHaveTextContent("Blocker");
  });

  it("renders nothing when there are no pathway items", () => {
    const { container } = render(<PathwayDiagram pathway={{ ...PATHWAY, items: [] }} t={t} />);
    expect(container).toBeEmptyDOMElement();
  });
});
