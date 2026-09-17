import type { Locale } from "../fa/engine/bundle-types";
import type { NeedsMapStatus } from "../fa/engine/needs-map-types";
import type { PathwayStage, RenderedNeedsPriority, RenderedPathwayItem, RenderedSnapshot } from "../snapshot/compose";

/**
 * beeside Strategic Report System — renderer-agnostic report model.
 *
 * This module is the RENDERING BOUNDARY. Everything above this line (report builders such as
 * expansion-snapshot-report.ts) produces a fully resolved, fully localized `ReportDocument` — every
 * string already picked for the right locale, every number already a finished fact, no further
 * business logic left to run. Everything below this line (a future `render(document): Buffer` — HTML
 * for print, PDF bytes, or anything else) is presentation only and does not exist yet: the project has
 * no PDF-generation library installed and the npm registry is blocked by org egress policy (same block
 * already documented for test execution — see the Level 2 MVP status doc). That is the ONLY thing
 * blocked. Building the report model now, ahead of picking a renderer, means the renderer decision
 * (Puppeteer/Playwright driving print HTML, @react-pdf/renderer, pdfkit, or anything else) never has
 * to touch section order, content, copy, or data shape — only a translation from `ReportDocument` to
 * bytes, whenever a library can be installed.
 *
 * This model is deliberately generic, not Expansion-Snapshot-specific: `kind` on `ReportDocument`
 * already anticipates a Precision Assessment report and a "SOW by Category" report as the second and
 * third documents built on the same primitives (radar chart, findings, priority list, pathway,
 * capability landscape, points, callout, narrative, disclosure, cover). A new report type is a new
 * builder function producing this same shape — never a parallel model.
 *
 * Accessibility / readability, decided now rather than left to the renderer:
 *  - Every chart-like block carries its own text equivalent alongside the numbers a chart would need
 *    (RadarChartBlock.axes carries `tierLabel` next to `value`) — a renderer with no chart capability
 *    at all can still produce a fully meaningful document from the text fields alone.
 *  - Every block that would otherwise rely on color (FindingsBlock's tones, CapabilityLandscapeBlock's
 *    statuses) carries a stable, non-localized key (`tone`, `status`) alongside its label, exactly like
 *    the Virtual Snapshot's web components — so a renderer can use an icon or a text tag instead of, or
 *    in addition to, color. This matters even more for a printed document, which may be read in
 *    grayscale or black-and-white.
 *  - No block ever carries a raw score, percentage or pass/fail — the same product rule as the web
 *    Virtual Snapshot (owner-approved: the Expansion Profile radar is "degree of definition", never a
 *    probability or a readiness score).
 */

export interface ReportCoverBlock {
  type: "cover";
  eyebrow: string;
  headline: string;
  subtitle: string;
  companyName: string;
  generatedOn: string;
  confidentialNote: string;
}

/** Plain narrative prose — the Opening beat's three sub-sections, and anywhere else free text belongs. */
export interface ReportNarrativeBlock {
  type: "narrative";
  heading: string;
  paragraphs: string[];
}

/** The Expansion Profile radar. `axes[].value` (0..1) is for chart layout only — see the module doc
 *  comment above; `tierLabel` is the text a renderer with no charting capability falls back to. */
export interface ReportRadarChartBlock {
  type: "radar_chart";
  title: string;
  intro: string;
  accessibleSummaryLabel: string;
  axes: Array<{ key: string; label: string; value: number; tier: string; tierLabel: string }>;
}

/** "What Stands Out": the rules engine's own counts/panels output, reused as-is (no re-derivation),
 *  plus "Something to reconcile" when present. */
export interface ReportFindingsBlock {
  type: "findings";
  title: string;
  intro: string;
  counts: RenderedSnapshot["counts"];
  panels: RenderedSnapshot["panels"];
  reconcile: { title: string; text: string } | null;
}

/** "What Matters Now": the client's declared priority order, verbatim — never reordered by
 *  dependency data. Mirrors RenderedSnapshot["needsPriorities"] exactly (same source of truth). */
export interface ReportPriorityListBlock {
  type: "priority_list";
  title: string;
  intro: string;
  immediateLabel: string;
  nextLabel: string;
  blockerLabel: string;
  dependsOnLabel: string;
  ownerLabel: string;
  approvalLabel: string;
  items: RenderedNeedsPriority[];
}

/** "Your Initial Path": NOW/DEFINE/ENABLE/LAUNCH as parallel stages, never a forced single line.
 *  Mirrors RenderedSnapshot["pathway"] exactly. */
export interface ReportPathwayBlock {
  type: "pathway";
  title: string;
  intro: string;
  stageLabels: Record<PathwayStage, string>;
  immediateLabel: string;
  blockerLabel: string;
  items: RenderedPathwayItem[];
}

/** "Capability Landscape": every declared need with its coverage status — never a provider name,
 *  never framed as a purchase decision. Mirrors RenderedSnapshot["needsLandscape"] exactly. */
export interface ReportCapabilityLandscapeBlock {
  type: "capability_landscape";
  title: string;
  intro: string;
  items: Array<{ key: string; label: string; status: NeedsMapStatus; statusLabel: string }>;
}

/** A short list of plain statements — used by both "What to Expect in Precision Assessment" and
 *  "How beeside Works With You" (the beeside operating model section). */
export interface ReportPointsBlock {
  type: "points";
  title: string;
  intro: string;
  points: string[];
}

/** A single specific quote/insight standing on its own — "The decision ahead", "One thing you don't
 *  want to get wrong". `emphasis` is a rendering hint only (e.g. a pull-quote treatment). */
export interface ReportCalloutBlock {
  type: "callout";
  title: string;
  text: string;
  emphasis?: "quote" | "plain";
}

export interface ReportDisclosureBlock {
  type: "disclosure";
  title: string;
  text: string;
}

export type ReportBlock =
  | ReportCoverBlock
  | ReportNarrativeBlock
  | ReportRadarChartBlock
  | ReportFindingsBlock
  | ReportPriorityListBlock
  | ReportPathwayBlock
  | ReportCapabilityLandscapeBlock
  | ReportPointsBlock
  | ReportCalloutBlock
  | ReportDisclosureBlock;

export interface ReportSection {
  id: string;
  blocks: ReportBlock[];
  /** A pagination HINT only ("this section reads better starting on a fresh page") — never a hard
   *  requirement. The eventual renderer decides real pagination against actual content length; this
   *  is exactly the kind of decision left to the rendering boundary, not the report model. */
  pageBreakBefore?: boolean;
}

export interface ReportDocument {
  schemaVersion: 1;
  /** The first instance is "expansion_snapshot_report"; "precision_assessment_report" and
   *  "sow_by_category_report" are the next two documents planned on this same model. */
  kind: "expansion_snapshot_report" | "precision_assessment_report" | "sow_by_category_report";
  locale: Locale;
  /** ISO timestamp, passed in by the caller (already known from the immutable Snapshot/report record)
   *  — this module never reads the clock itself, so building a document stays a pure function. */
  generatedAt: string;
  sections: ReportSection[];
}
