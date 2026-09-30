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
      { key: "market_evidence", label: "Market Evidence", value: 0.7, tier: "well_defined", tierLabel: "Well defined", demand: { value: 0.5, tier: "medium", tierLabel: "Medium" }, demandNote: null },
      {
        key: "commercial_ambition_differentiation",
        label: "Commercial Ambition & Differentiation",
        value: 0.4,
        tier: "partially_defined",
        tierLabel: "Partially defined",
        demand: null,
        demandNote: "There isn't yet a structured way to measure execution demand for this area — shown as not evaluable rather than assumed.",
      },
      { key: "local_capability_base", label: "Local Capability Base", value: 0.2, tier: "early_stage", tierLabel: "Early stage", demand: { value: 0.7, tier: "medium_high", tierLabel: "Medium–High" }, demandNote: null },
      { key: "governance_constraints", label: "Governance & Constraints", value: 0, tier: "early_stage", tierLabel: "Early stage", demand: { value: 0.55, tier: "medium", tierLabel: "Medium" }, demandNote: null },
      { key: "financial_framework", label: "Financial Framework", value: 0.5, tier: "partially_defined", tierLabel: "Partially defined", demand: { value: 0.82, tier: "high", tierLabel: "High" }, demandNote: null },
      { key: "activation_planning", label: "Activation Planning", value: 0.6, tier: "partially_defined", tierLabel: "Partially defined", demand: { value: 0.52, tier: "medium", tierLabel: "Medium" }, demandNote: null },
    ],
    dualProfile: {
      title: "Definition & Evidence vs. Execution Demand",
      intro: "See where your expansion plan is well defined and where execution will demand more from the business.",
      definitionLabel: "Definition & Evidence",
      demandLabel: "Execution Demand",
    },
    keyReading:
      "Your expansion direction is clear, but execution will require coordinated work across several fronts. The challenge is not deciding where to go, but sequencing and activating the right capabilities.",
    marketEvidenceNarrative:
      "The target market is supported by a comparatively clear commercial rationale. The remaining work is primarily about validating and executing the chosen path.",
    executionPressureNarrative:
      "Execution pressure is concentrated primarily in financial_framework. This is the area most likely to require early coordination and specialist support.",
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
    valueBridges: [],
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
  it("assembles every beat in the frozen v8.1 macro-flow order (2026-09-30 Product Owner authorization, item 1): Opening, Dual Expansion Profile, Key Reading, What Matters Now, Market Evidence, Capability Landscape, Your Initial Path, Execution Pressure, What Stands Out, What's next (Precision Transition), Why continue with beeside (SnapshotValueCase)", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } })));
    render(<VirtualSnapshot snapshot={snapshotView(rendered())} locale="en" t={t} />);

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    const openingIndex = headings.indexOf("Your project");
    const dualProfileIndex = headings.indexOf("Definition & Evidence vs. Execution Demand");
    const keyReadingIndex = headings.indexOf("Key Reading");
    const mattersNowIndex = headings.indexOf("What matters now");
    const marketEvidenceIndex = headings.indexOf("Market Evidence");
    const landscapeIndex = headings.indexOf("Capability landscape");
    const pathIndex = headings.indexOf("Your initial path");
    const executionPressureIndex = headings.indexOf("Execution Pressure");
    const standOutIndex = headings.indexOf("What stands out");
    const whatsNextIndex = headings.indexOf("What's next");
    const valueCaseIndex = headings.indexOf("The value of one coordinated expansion.");

    for (const index of [
      openingIndex,
      dualProfileIndex,
      keyReadingIndex,
      mattersNowIndex,
      marketEvidenceIndex,
      landscapeIndex,
      pathIndex,
      executionPressureIndex,
      standOutIndex,
      whatsNextIndex,
      valueCaseIndex,
    ]) {
      expect(index).toBeGreaterThan(-1);
    }
    expect(openingIndex).toBeLessThan(dualProfileIndex);
    expect(dualProfileIndex).toBeLessThan(keyReadingIndex);
    expect(keyReadingIndex).toBeLessThan(mattersNowIndex);
    expect(mattersNowIndex).toBeLessThan(marketEvidenceIndex);
    expect(marketEvidenceIndex).toBeLessThan(landscapeIndex);
    expect(landscapeIndex).toBeLessThan(pathIndex);
    expect(pathIndex).toBeLessThan(executionPressureIndex);
    expect(executionPressureIndex).toBeLessThan(standOutIndex);
    expect(standOutIndex).toBeLessThan(whatsNextIndex);
    expect(whatsNextIndex).toBeLessThan(valueCaseIndex);
  });

  it("hides Key Reading, Market Evidence narrative and Execution Pressure narrative sections when the compose layer returns null (e.g. insufficient data)", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } })));
    render(
      <VirtualSnapshot
        snapshot={snapshotView(rendered({ keyReading: null, marketEvidenceNarrative: null, executionPressureNarrative: null }))}
        locale="en"
        t={t}
      />,
    );
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).not.toContain("Key Reading");
    expect(headings).not.toContain("Market Evidence");
    expect(headings).not.toContain("Execution Pressure");
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

  it("shows the disclosure as the closing footer, followed by nothing else", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } })));
    render(<VirtualSnapshot snapshot={snapshotView(rendered())} locale="en" t={t} />);
    expect(screen.getByText("About this Snapshot")).toBeInTheDocument();
  });

  it("renders no Value Bridge card when nothing triggered one", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } })));
    render(<VirtualSnapshot snapshot={snapshotView(rendered({ valueBridges: [] }))} locale="en" t={t} />);
    expect(screen.queryByText("beeside can help")).not.toBeInTheDocument();
  });

  it("threads The Hive and beeside Verified as a paired card group right after Capability Landscape, before Your Initial Path (2026-09-30 authorization, item 1 — replaces the retired end-of-page ValueBridges grid)", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } })));
    render(
      <VirtualSnapshot
        snapshot={snapshotView(
          rendered({
            valueBridges: [
              { key: "the_hive", eyebrow: "beeside can help", heading: "The Hive", body: "The Hive gives you access to beeside's curated ecosystem of trusted local providers." },
              { key: "beeside_verified", eyebrow: "beeside can help", heading: "beeside Verified", body: "beeside Verified confirms who you are dealing with before you commit." },
            ],
          }),
        )}
        locale="en"
        t={t}
      />,
    );
    expect(screen.getByRole("heading", { name: "The Hive" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "beeside Verified" })).toBeInTheDocument();
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    const landscapeIndex = headings.indexOf("Capability landscape");
    const hiveIndex = headings.indexOf("The Hive");
    const verifiedIndex = headings.indexOf("beeside Verified");
    const pathIndex = headings.indexOf("Your initial path");
    expect(landscapeIndex).toBeLessThan(hiveIndex);
    expect(landscapeIndex).toBeLessThan(verifiedIndex);
    expect(hiveIndex).toBeLessThan(pathIndex);
    expect(verifiedIndex).toBeLessThan(pathIndex);
  });

  it("threads Operation Hub right after Your Initial Path, before Execution Pressure", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } })));
    render(
      <VirtualSnapshot
        snapshot={snapshotView(
          rendered({
            valueBridges: [{ key: "operation_hub_secure", eyebrow: "beeside can help", heading: "Operation Hub", body: "Operation Hub keeps every task and document in one place." }],
          }),
        )}
        locale="en"
        t={t}
      />,
    );
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    const pathIndex = headings.indexOf("Your initial path");
    const ohIndex = headings.indexOf("Operation Hub");
    const executionPressureIndex = headings.indexOf("Execution Pressure");
    expect(pathIndex).toBeLessThan(ohIndex);
    expect(ohIndex).toBeLessThan(executionPressureIndex);
  });

  it("threads Strategic Advisory right after What Stands Out, before the Next Decisions context cards", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } })));
    render(
      <VirtualSnapshot
        snapshot={snapshotView(
          rendered({
            valueBridges: [{ key: "strategic_advisory", eyebrow: "beeside can help", heading: "Strategic Advisory", body: "Strategic Advisory supports the bigger decisions." }],
          }),
        )}
        locale="en"
        t={t}
      />,
    );
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    const standOutIndex = headings.indexOf("What stands out");
    const advisoryIndex = headings.indexOf("Strategic Advisory");
    const reconcileIndex = headings.indexOf("Something to reconcile");
    expect(standOutIndex).toBeLessThan(advisoryIndex);
    expect(advisoryIndex).toBeLessThan(reconcileIndex);
  });

  it("threads beeside Sherpa inside the Next Decisions context block, with the large badge treatment, before What's next", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } })));
    render(
      <VirtualSnapshot
        snapshot={snapshotView(
          rendered({
            valueBridges: [{ key: "sherpa", eyebrow: "beeside can help", heading: "beeside Sherpa", body: "Your Sherpa guides and coordinates the path to service activation." }],
          }),
        )}
        locale="en"
        t={t}
      />,
    );
    const sherpaHeading = screen.getByText("beeside Sherpa");
    const badge = sherpaHeading.closest(".value-bridge-card")?.querySelector(".value-bridge-icon-badge-lg");
    expect(badge).not.toBeNull();
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    const reconcileIndex = headings.indexOf("Something to reconcile");
    const sherpaIndex = headings.indexOf("beeside Sherpa");
    const whatsNextIndex = headings.indexOf("What's next");
    expect(reconcileIndex).toBeLessThan(sherpaIndex);
    expect(sherpaIndex).toBeLessThan(whatsNextIndex);
  });
});
