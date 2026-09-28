import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { VirtualSnapshot } from "./components/VirtualSnapshot";
import { makeT } from "./copy";
import { TEST_BUNDLE } from "./test-fixtures";
import { RenderedSnapshot, SnapshotView } from "./types";

function rendered(overrides: Partial<RenderedSnapshot> = {}): RenderedSnapshot {
  return {
    eyebrow: "Your Expansion Snapshot",
    headline: "Your project, in perspective.",
    generatedOn: "Generated on September 17, 2026",
    summary: ["Northwind is looking to set up a local operation in Mexico."],
    expansionProfile: [
      { key: "market_evidence", label: "Market Evidence", value: 0.7, tier: "well_defined", tierLabel: "Well defined" },
      { key: "commercial_ambition_differentiation", label: "Commercial Ambition & Differentiation", value: 0.4, tier: "partially_defined", tierLabel: "Partially defined" },
      { key: "local_capability_base", label: "Local Capability Base", value: 0.2, tier: "early_stage", tierLabel: "Early stage" },
      { key: "governance_constraints", label: "Governance & Constraints", value: 0, tier: "early_stage", tierLabel: "Early stage" },
      { key: "financial_framework", label: "Financial Framework", value: 0.5, tier: "partially_defined", tierLabel: "Partially defined" },
      { key: "activation_planning", label: "Activation Planning", value: 0.6, tier: "partially_defined", tierLabel: "Partially defined" },
    ],
    facts: [
      { key: "company", label: "Company", value: "Northwind", detail: "Manufacturing" },
      { key: "priority", label: "Your immediate priority", value: "Local entity & legal setup", detail: null },
    ],
    counts: [{ tone: "well_defined", label: "Well defined", count: 1 }],
    panels: [{ tone: "well_defined", title: "Well defined", intro: "You have a solid foundation in these areas.", items: [{ areaId: 1, label: "Target market", reason: null }] }],
    immediatePriority: { title: "Your immediate priority", value: "Local entity & legal setup", timing: "Within 30 days", reason: "We already signed a distributor." },
    reconcile: { title: "Something to reconcile", text: "Your timing is firm, but staffing isn't planned yet." },
    decisionAhead: { title: "The decision ahead", text: "Choose between Monterrey and Saltillo." },
    shapePlan: { title: "What could shape the plan", items: ["A firm launch commitment"] },
    oneThing: { title: "One thing you don't want to get wrong", text: "Don't sign a lease before the entity exists." },
    capabilities: {
      title: "Relevant capabilities for your expansion",
      intro: "Based on what you shared, these capabilities are relevant to your project.",
      items: [{ categoryId: 1, label: "Trade & customs", description: "Getting goods across borders" }],
    },
    needsPriorities: {
      title: "What matters now",
      intro: "Your declared priorities, with the dependencies and approvals they involve.",
      immediateLabel: "Immediate priority",
      nextLabel: "Next priorities",
      blockerLabel: "Blocker",
      dependsOnLabel: "Depends on",
      ownerLabel: "Internal owner",
      approvalLabel: "Needs approval from",
      items: [{ key: "company_setup", label: "Company Setup", isImmediatePriority: true, isBlocker: false, dependsOnLabel: null, owner: null, approvalRequired: false, approvalFrom: null }],
    },
    pathway: {
      title: "Your initial path",
      intro: "A starting sequence based on what you shared — not a rigid methodology or a guarantee.",
      stageLabels: { now: "Now", define: "Define", enable: "Enable", launch: "Launch" },
      immediateLabel: "Immediate priority",
      blockerLabel: "Blocker",
      items: [{ key: "company_setup", label: "Company Setup", stage: "now", isImmediatePriority: true, isBlocker: false, dependsOnLabel: null }],
    },
    needsLandscape: {
      title: "Capability landscape",
      intro: "Where things stand today across what you told us your project needs.",
      items: [{ key: "company_setup", label: "Company Setup", status: "covered_internally", statusLabel: "Covered internally" }],
    },
    disclosure: { title: "About this Snapshot", text: "This initial interpretation is based on the information you shared with us." },
    ...overrides,
  };
}

function snapshotView(en: RenderedSnapshot): SnapshotView {
  return {
    snapshotId: "snap-1",
    generatedAt: "2026-09-17T12:00:00Z",
    content: { schema_version: 1, kind: "expansion_snapshot", generated_at: "2026-09-17T12:00:00Z", deliverable_locale: "en", locales: { en, es: en } },
  };
}

const t = makeT(TEST_BUNDLE, "en");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("VirtualSnapshot", () => {
  it("assembles every beat in story order — Opening, Big Picture, What Stands Out, What Matters Now, Your Initial Path, Capability Landscape, Precision, How beeside Works", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } })));
    render(<VirtualSnapshot snapshot={snapshotView(rendered())} locale="en" t={t} />);

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    const openingIndex = headings.indexOf("Your project");
    const bigPictureIndex = headings.indexOf("The big picture");
    const standOutIndex = headings.indexOf("What stands out");
    const mattersNowIndex = headings.indexOf("What matters now");
    const pathIndex = headings.indexOf("Your initial path");
    const landscapeIndex = headings.indexOf("Capability landscape");
    const precisionIndex = headings.indexOf("What to expect in Precision Assessment");
    const worksIndex = headings.indexOf("How beeside works with you");

    for (const index of [openingIndex, bigPictureIndex, standOutIndex, mattersNowIndex, pathIndex, landscapeIndex, precisionIndex, worksIndex]) {
      expect(index).toBeGreaterThan(-1);
    }
    expect(openingIndex).toBeLessThan(bigPictureIndex);
    expect(bigPictureIndex).toBeLessThan(standOutIndex);
    expect(standOutIndex).toBeLessThan(mattersNowIndex);
    expect(mattersNowIndex).toBeLessThan(pathIndex);
    expect(pathIndex).toBeLessThan(landscapeIndex);
    expect(landscapeIndex).toBeLessThan(precisionIndex);
    expect(precisionIndex).toBeLessThan(worksIndex);
  });

  it("folds immediatePriority/reconcile/decisionAhead/oneThing into the story instead of a separate dashboard grid", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } })));
    render(<VirtualSnapshot snapshot={snapshotView(rendered())} locale="en" t={t} />);
    expect(screen.getByText("Something to reconcile")).toBeInTheDocument();
    expect(screen.getByText("We already signed a distributor.", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Choose between Monterrey and Saltillo.", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Don't sign a lease before the entity exists.", { exact: false })).toBeInTheDocument();
  });

  it("does not render the rules-engine capability recommendations on this screen", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } })));
    render(<VirtualSnapshot snapshot={snapshotView(rendered())} locale="en" t={t} />);
    expect(screen.queryByText("Relevant capabilities for your expansion")).not.toBeInTheDocument();
  });

  it("shows the disclosure as the closing footer", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } })));
    render(<VirtualSnapshot snapshot={snapshotView(rendered())} locale="en" t={t} />);
    expect(screen.getByText("About this Snapshot")).toBeInTheDocument();
  });
});
