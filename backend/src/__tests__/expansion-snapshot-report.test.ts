import { buildExpansionSnapshotReport } from "../reports/expansion-snapshot-report";
import { buildReportCopyBundle } from "../reports/report-copy";
import type { RenderedSnapshot } from "../snapshot/compose";

const copy = buildReportCopyBundle();

function rendered(overrides: Partial<RenderedSnapshot> = {}): RenderedSnapshot {
  return {
    eyebrow: "Your Expansion Snapshot",
    headline: "Northwind, in perspective.",
    generatedOn: "Generated on September 17, 2026",
    summary: ["Northwind is looking to set up a local operation in Mexico."],
    expansionProfile: [
      { key: "market_customer_clarity", label: "Market & Customer Clarity", value: 0.7, tier: "well_defined", tierLabel: "Well defined" },
      { key: "commercial_validation", label: "Commercial Validation", value: 0.4, tier: "partially_defined", tierLabel: "Partially defined" },
    ],
    facts: [
      { key: "company", label: "Company", value: "Northwind", detail: "Manufacturing" },
      { key: "launch", label: "Target launch", value: "Q1 2027", detail: null },
      { key: "priority", label: "Your immediate priority", value: "Local entity & legal setup", detail: null },
    ],
    counts: [{ tone: "well_defined", label: "Well defined", count: 1 }],
    panels: [{ tone: "well_defined", title: "Well defined", intro: "You have a solid foundation in these areas.", items: [{ areaId: 1, label: "Target market", reason: null }] }],
    immediatePriority: { title: "Your immediate priority", value: "Local entity & legal setup", timing: "Within 30 days", reason: null },
    reconcile: null,
    decisionAhead: { title: "The decision ahead", text: "Choose between Monterrey and Saltillo." },
    shapePlan: null,
    oneThing: { title: "One thing you don't want to get wrong", text: "Don't sign a lease before the entity exists." },
    capabilities: { title: "Relevant capabilities for your expansion", intro: "…", items: [{ categoryId: 1, label: "Trade & customs", description: "Getting goods across borders" }] },
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

describe("buildExpansionSnapshotReport", () => {
  it("orders sections cover → opening → big picture → what stands out → what matters now → initial path → capability landscape → specific notes → precision → operating model → disclosure", () => {
    const doc = buildExpansionSnapshotReport(rendered(), "en", copy.en, { companyName: "Northwind", generatedAt: "2026-09-17T12:00:00Z" });
    expect(doc.sections.map((s) => s.id)).toEqual([
      "cover",
      "opening",
      "big_picture",
      "stand_out",
      "matters_now",
      "initial_path",
      "capability_landscape",
      "specific_notes",
      "precision_transition",
      "operating_model",
      "disclosure",
    ]);
  });

  it("is a pure function — never reads the clock, uses only the generatedAt/companyName it was given", () => {
    const doc1 = buildExpansionSnapshotReport(rendered(), "en", copy.en, { companyName: "Northwind", generatedAt: "2026-09-17T12:00:00Z" });
    const doc2 = buildExpansionSnapshotReport(rendered(), "en", copy.en, { companyName: "Northwind", generatedAt: "2026-09-17T12:00:00Z" });
    expect(doc1).toEqual(doc2);
    expect(doc1.generatedAt).toBe("2026-09-17T12:00:00Z");
  });

  it("carries the company name into the cover's confidentiality note without hardcoding it in copy", () => {
    const doc = buildExpansionSnapshotReport(rendered(), "en", copy.en, { companyName: "Northwind", generatedAt: "2026-09-17T12:00:00Z" });
    const cover = doc.sections[0].blocks[0] as { type: "cover"; confidentialNote: string };
    expect(cover.confidentialNote).toBe("Confidential — prepared exclusively for Northwind.");
  });

  it("never carries a raw score or percentage on the radar chart block — only value (for layout) and tierLabel", () => {
    const doc = buildExpansionSnapshotReport(rendered(), "en", copy.en, { companyName: "Northwind", generatedAt: "2026-09-17T12:00:00Z" });
    const radar = doc.sections.find((s) => s.id === "big_picture")!.blocks[0] as { type: "radar_chart"; axes: Array<{ tierLabel: string }> };
    const serialized = JSON.stringify(radar.axes.map((a) => a.tierLabel));
    expect(serialized).not.toMatch(/%|\bscore\b|\bpass\b|\bfail\b/i);
  });

  it("never renders the rules-engine capability recommendations, for the same reason as the web Virtual Snapshot", () => {
    const doc = buildExpansionSnapshotReport(rendered(), "en", copy.en, { companyName: "Northwind", generatedAt: "2026-09-17T12:00:00Z" });
    const serialized = JSON.stringify(doc);
    expect(serialized).not.toMatch(/Relevant capabilities for your expansion/);
  });

  it("folds decisionAhead and oneThing into a single specific_notes section instead of separate cards", () => {
    const doc = buildExpansionSnapshotReport(rendered(), "en", copy.en, { companyName: "Northwind", generatedAt: "2026-09-17T12:00:00Z" });
    const notes = doc.sections.find((s) => s.id === "specific_notes")!;
    expect(notes.blocks).toHaveLength(2);
    expect(notes.blocks.map((b) => (b as { title: string }).title)).toEqual(["The decision ahead", "One thing you don't want to get wrong"]);
  });

  it("omits the specific_notes section entirely when there is nothing to put in it", () => {
    const doc = buildExpansionSnapshotReport(rendered({ decisionAhead: null, oneThing: null }), "en", copy.en, { companyName: "Northwind", generatedAt: "2026-09-17T12:00:00Z" });
    expect(doc.sections.map((s) => s.id)).not.toContain("specific_notes");
  });

  it("falls back to a plain empty-requirements statement when no shapePlan items were declared", () => {
    const doc = buildExpansionSnapshotReport(rendered({ shapePlan: null }), "en", copy.en, { companyName: "Northwind", generatedAt: "2026-09-17T12:00:00Z" });
    const opening = doc.sections.find((s) => s.id === "opening")!;
    const requirements = opening.blocks.find((b) => (b as { heading?: string }).heading === "Your requirements") as { paragraphs: string[] };
    expect(requirements.paragraphs).toEqual(["No fixed constraints or commitments were flagged at the time of this report."]);
  });

  it("builds the same document shape in Spanish from the Spanish copy bundle", () => {
    const doc = buildExpansionSnapshotReport(rendered(), "es", copy.es, { companyName: "Northwind", generatedAt: "2026-09-17T12:00:00Z" });
    expect(doc.locale).toBe("es");
    const cover = doc.sections[0].blocks[0] as { type: "cover"; subtitle: string; confidentialNote: string };
    expect(cover.subtitle).toBe("Evaluación Estratégica de Expansión");
    expect(cover.confidentialNote).toBe("Confidencial — preparado exclusivamente para Northwind.");
  });
});
