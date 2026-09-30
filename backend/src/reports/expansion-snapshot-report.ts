import type { RenderedSnapshot } from "../snapshot/compose";
import type { ReportCopy } from "./report-copy";
import { ReportCalloutBlock, ReportDocument, ReportSection } from "./report-model";
import type { Locale } from "../fa/engine/bundle-types";

function fill(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, name: string) => variables[name] ?? match);
}

/**
 * Builds the Expansion Snapshot report — the first document on the beeside Strategic Report System
 * (see report-model.ts for the rendering-boundary rationale). Pure function: every input is already
 * resolved (the same immutable `RenderedSnapshot` the web Virtual Snapshot renders, plus the report's
 * own bilingual chrome copy and the caller's already-known `generatedAt`/`companyName`) — no clock
 * access, no new business derivation. Section order mirrors the Virtual Snapshot's 9 narrative beats
 * (specific → general → specific → action), adapted for a standalone executive document:
 *
 *   Cover → Opening → The Big Picture → What Stands Out → What Matters Now → Your Initial Path →
 *   Capability Landscape → specific notes (decision ahead / one thing) → What to Expect in Precision →
 *   How beeside Works With You → Disclosure
 *
 * `pageBreakBefore` hints are a starting point for a ~6–8 page document; the eventual renderer is free
 * to repaginate against real content length and typography — see report-model.ts's module doc comment.
 *
 * `RenderedSnapshot.capabilities` (the rules engine's category-level recommendations, distinct from
 * the client's own declared `needsLandscape`) is deliberately left out of this report, for the same
 * reason it is left out of the web Virtual Snapshot (VirtualSnapshot.tsx's own doc comment): showing
 * it here risks reading as a provider/purchase recommendation, which Capability Landscape explicitly
 * avoids elsewhere in the same document. Revisit both together if this changes.
 */
export function buildExpansionSnapshotReport(
  rendered: RenderedSnapshot,
  locale: Locale,
  copy: ReportCopy,
  params: { companyName: string; generatedAt: string }
): ReportDocument {
  const sections: ReportSection[] = [];

  sections.push({
    id: "cover",
    blocks: [
      {
        type: "cover",
        eyebrow: copy.cover_eyebrow,
        headline: rendered.headline,
        subtitle: copy.cover_subtitle,
        companyName: params.companyName,
        generatedOn: rendered.generatedOn,
        confidentialNote: fill(copy.cover_confidential, { company_name: params.companyName }),
      },
    ],
  });

  const objectiveFacts = rendered.facts.filter((f) => f.key === "launch" || f.key === "priority");
  const requirementParagraphs = rendered.shapePlan && rendered.shapePlan.items.length > 0 ? rendered.shapePlan.items : [copy.opening_requirements_empty];
  sections.push({
    id: "opening",
    pageBreakBefore: true,
    blocks: [
      { type: "narrative" as const, heading: copy.opening_project_label, paragraphs: rendered.summary },
      ...(objectiveFacts.length > 0
        ? [{ type: "narrative" as const, heading: copy.opening_objectives_label, paragraphs: objectiveFacts.map((f) => (f.detail ? `${f.label}: ${f.value} (${f.detail})` : `${f.label}: ${f.value}`)) }]
        : []),
      { type: "narrative" as const, heading: copy.opening_requirements_label, paragraphs: requirementParagraphs },
    ],
  });

  if (rendered.expansionProfile.length > 0) {
    sections.push({
      id: "big_picture",
      pageBreakBefore: true,
      blocks: [
        {
          type: "radar_chart",
          title: copy.big_picture_title,
          intro: copy.big_picture_intro,
          accessibleSummaryLabel: copy.radar_accessible_summary,
          axes: rendered.expansionProfile.map((d) => ({ key: d.key, label: d.label, value: d.value, tier: d.tier, tierLabel: d.tierLabel })),
        },
      ],
    });
  }

  if (rendered.counts.length > 0 || rendered.panels.length > 0) {
    sections.push({
      id: "stand_out",
      pageBreakBefore: true,
      blocks: [{ type: "findings", title: copy.stand_out_title, intro: copy.stand_out_intro, counts: rendered.counts, panels: rendered.panels, reconcile: rendered.reconcile }],
    });
  }

  if (rendered.needsPriorities) {
    sections.push({ id: "matters_now", pageBreakBefore: true, blocks: [{ type: "priority_list", ...rendered.needsPriorities }] });
  }

  if (rendered.pathway) {
    sections.push({ id: "initial_path", pageBreakBefore: false, blocks: [{ type: "pathway", ...rendered.pathway }] });
  }

  if (rendered.needsLandscape) {
    sections.push({ id: "capability_landscape", pageBreakBefore: true, blocks: [{ type: "capability_landscape", ...rendered.needsLandscape }] });
  }

  const callouts: ReportCalloutBlock[] = [];
  if (rendered.decisionAhead) callouts.push({ type: "callout", title: rendered.decisionAhead.title, text: rendered.decisionAhead.text, emphasis: "quote" });
  if (rendered.oneThing) callouts.push({ type: "callout", title: rendered.oneThing.title, text: rendered.oneThing.text, emphasis: "quote" });
  if (callouts.length > 0) {
    sections.push({ id: "specific_notes", pageBreakBefore: false, blocks: callouts });
  }

  sections.push({ id: "precision_transition", pageBreakBefore: true, blocks: [{ type: "points", title: copy.precision_title, intro: copy.precision_intro, points: [...copy.precision_points] }] });
  sections.push({ id: "operating_model", pageBreakBefore: false, blocks: [{ type: "points", title: copy.works_title, intro: copy.works_intro, points: [...copy.works_points] }] });

  sections.push({ id: "disclosure", pageBreakBefore: false, blocks: [{ type: "disclosure", title: rendered.disclosure.title, text: rendered.disclosure.text }] });

  return { schemaVersion: 1, kind: "expansion_snapshot_report", locale, generatedAt: params.generatedAt, sections };
}
