import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ExpansionSnapshot } from "./components/ExpansionSnapshot";
import { makeT } from "./copy";
import { SnapshotScreen } from "./screens/SnapshotScreen";
import { TEST_BUNDLE } from "./test-fixtures";
import { RenderedSnapshot, SnapshotView } from "./types";

function rendered(overrides: Partial<RenderedSnapshot> = {}): RenderedSnapshot {
  return {
    eyebrow: "Your Expansion Snapshot",
    headline: "Your project, in perspective.",
    generatedOn: "Generated on September 15, 2026",
    summary: ["Northwind is looking to set up a local operation in Mexico."],
    facts: [
      { key: "company", label: "Company", value: "Northwind", detail: "Manufacturing" },
      { key: "priority", label: "Your immediate priority", value: "Local entity & legal setup", detail: null },
    ],
    counts: [
      { tone: "well_defined", label: "Well defined", count: 1 },
      { tone: "needs_attention", label: "Needs attention", count: 0 },
      { tone: "resolve_early", label: "Resolve early", count: 2 },
    ],
    panels: [
      { tone: "well_defined", title: "Well defined", intro: "You have a solid foundation in these areas.", items: [{ areaId: 1, label: "Target market", reason: null }] },
      {
        tone: "resolve_early",
        title: "Resolve early",
        intro: "Addressing these early helps avoid delays later.",
        items: [
          { areaId: 2, label: "Customs & trade structure", reason: "The import structure is still undefined." },
          { areaId: 7, label: "Local workforce", reason: "Scale hasn't been defined, and your timing is already firm." },
        ],
      },
    ],
    immediatePriority: { title: "Your immediate priority", value: "Local entity & legal setup", timing: "Within 30 days", reason: null },
    reconcile: null,
    decisionAhead: { title: "The decision ahead", text: "Choose between Monterrey and Saltillo." },
    shapePlan: null,
    oneThing: null,
    capabilities: {
      title: "Relevant capabilities for your expansion",
      intro: "Based on what you shared, these capabilities are relevant to your project.",
      items: [{ categoryId: 1, label: "Trade & customs", description: "Getting goods across borders" }],
    },
    disclosure: { title: "About this Snapshot", text: "This initial interpretation is based on the information you shared with us." },
    ...overrides,
  };
}

function snapshot(en: RenderedSnapshot, es: RenderedSnapshot = rendered({ headline: "Tu proyecto, en perspectiva." }), deliverable: "en" | "es" = "en"): SnapshotView {
  return {
    snapshotId: "snap-1",
    generatedAt: "2026-09-15T12:00:00Z",
    content: { schema_version: 1, kind: "expansion_snapshot", generated_at: "2026-09-15T12:00:00Z", deliverable_locale: deliverable, locales: { en, es } },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ExpansionSnapshot", () => {
  it("shows only non-empty panels, each status with its icon, label and count", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } })));
    render(<ExpansionSnapshot snapshot={snapshot(rendered())} locale="en" />);
    expect(screen.getByRole("heading", { level: 1, name: "Your project, in perspective." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Well defined" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Resolve early" })).toBeInTheDocument();
    // "Needs attention" has no findings: it appears only as a zero count, never as an empty panel.
    expect(screen.queryByRole("heading", { level: 2, name: "Needs attention" })).not.toBeInTheDocument();
    expect(screen.getByText("Needs attention").closest("li")).toHaveTextContent("0Needs attention");

    const early = screen.getByRole("region", { name: "Resolve early" });
    expect(within(early).getAllByRole("listitem")).toHaveLength(2);
    expect(within(early).getByText("Scale hasn't been defined, and your timing is already firm.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Something to reconcile" })).not.toBeInTheDocument();
    expect(screen.getByText("Trade & customs")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/CRITICAL_GAP|NEEDS_ATTENTION|Hive|score/i);
  });

  it("renders Something to reconcile as a single line when present, in the selected language", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } })));
    const es = rendered({ headline: "Tu proyecto, en perspectiva.", reconcile: { title: "Algo por conciliar", text: "Tu prioridad es constituir tu entidad local, pero para lograrlo todavía falta resolver la planeación del personal local." } });
    render(<ExpansionSnapshot snapshot={snapshot(rendered(), es)} locale="es" />);
    const reconcile = screen.getByRole("region", { name: "Algo por conciliar" });
    expect(within(reconcile).getAllByRole("paragraph", { hidden: true }).length).toBeLessThanOrEqual(1);
    expect(reconcile).toHaveTextContent("todavía falta resolver la planeación del personal local");
  });
});

describe("SnapshotScreen", () => {
  it("loads the immutable Snapshot and switches to the respondent's deliverable language", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } })));
    const onLocale = vi.fn();
    const load = vi.fn(async () => snapshot(rendered(), rendered({ headline: "Tu proyecto, en perspectiva." }), "es"));
    render(<SnapshotScreen bundle={TEST_BUNDLE} t={makeT(TEST_BUNDLE, "en")} locale="en" load={load} onLocale={onLocale} anotherProjectInMind={false} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Your project, in perspective." })).toBeInTheDocument();
    await waitFor(() => expect(onLocale).toHaveBeenCalledWith("es"));
  });

  it("reports a calm error when the Snapshot cannot be loaded", async () => {
    const load = vi.fn(async () => {
      throw new Error("offline");
    });
    render(<SnapshotScreen bundle={TEST_BUNDLE} t={makeT(TEST_BUNDLE, "en")} locale="en" load={load} onLocale={() => undefined} anotherProjectInMind={false} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
