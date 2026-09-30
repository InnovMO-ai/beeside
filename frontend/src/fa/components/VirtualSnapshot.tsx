import { useEffect, useRef } from "react";
import { track } from "../analytics";
import { T } from "../copy";
import { Locale, RenderedValueBridge, SnapshotView } from "../types";
import { OpeningRecap } from "./OpeningRecap";
import { RadarProfile } from "./RadarProfile";
import { StandOutPanels } from "./StandOutPanels";
import { PriorityList } from "./PriorityList";
import { PathwayDiagram } from "./PathwayDiagram";
import { CapabilityLandscapeGrid } from "./CapabilityLandscapeGrid";
import { PrecisionTransition } from "./PrecisionTransition";
import { ValueBridgeCard } from "./ValueBridgeCard";
import { SnapshotValueCase } from "./SnapshotValueCase";
import { NightShiftToggle } from "./NightShiftToggle";

function findBridge(bridges: RenderedValueBridge[], key: RenderedValueBridge["key"]): RenderedValueBridge | undefined {
  return bridges.find((b) => b.key === key);
}

/**
 * VirtualSnapshot (Level 2 MVP §3): the narrative Virtual Snapshot — specific → general → specific →
 * action — assembling the storyboard beats built across this build-order phase.
 *
 * Section order (2026-09-30 Product Owner authorization, "FINAL PRE-DEPLOY IMPLEMENTATION PASS", item
 * 1 — converges exactly to the frozen `snapshot_etapa4_FROZEN_v8.1-contrast-cta-fix.html`'s own
 * macro-flow, superseding the 2026-09-28 Macroblock 7 ordering note this docblock previously carried):
 *   1. Opening (OpeningRecap)                          — frozen "project-profile"
 *   2. Dual Expansion Profile (RadarProfile)            — frozen "radar"
 *   3. Key Reading                                      — frozen "key-reading"
 *   4. What Matters Now (PriorityList)                  — frozen "what-matters"
 *   5. Market Evidence narrative                        — frozen "market-evidence"
 *   6. Capability Landscape (CapabilityLandscapeGrid)   — frozen "capability-footprint"
 *      + threaded bridges: The Hive / beeside Verified, paired side by side (frozen `.bridge-pair`)
 *   7. Your Initial Path (PathwayDiagram)               — frozen "project-path"
 *      + threaded bridge: Operation Hub
 *   8. Execution Pressure narrative                     — frozen "execution-pressure"
 *   9. What Stands Out (StandOutPanels)                 — frozen "what-deserves-definition"
 *      + threaded bridge: Strategic Advisory
 *  10. Next decisions (reconcile/priority/decision/oneThing cards) — frozen "next-decisions"
 *      + threaded bridge: beeside Sherpa (large badge, `.bridge-icon-badge-lg`)
 *  11. What to Expect in Precision — "What's next" 3-icon grid (PrecisionTransition) — frozen
 *      "precision-transition"
 *  12. Why continue with beeside — What beeside gives you / gain strip / A-D comparison / banner /
 *      final CTA (SnapshotValueCase) — frozen "beeside-value". Coexists with the pre-existing,
 *      separate PremiumTransition (rendered as a sibling afterward by SnapshotScreen, unchanged) — see
 *      SnapshotValueCase's own docblock for how the two relate.
 *
 * HowBeesideWorks (a general "how it works" block with no frozen-artifact counterpart) is retired —
 * removed entirely per item 1 ("remove or reconcile any extra non-canonical Snapshot sections").
 *
 * The five Value Bridges are no longer a single end-of-page grid (the pre-2026-09-30 `ValueBridges`
 * component): each of the (at most 3, per the approved Etapa 2 selection rule in
 * `value-bridges.ts` — unchanged by this pass) triggered bridges now renders inline via
 * `ValueBridgeCard` at the exact point in the story its trigger concerns, matching the frozen
 * artifact's threading exactly. A bridge whose trigger did not fire for this project simply does not
 * render at that spot — nothing is invented to fill a slot.
 *
 * Night Shift (`NightShiftToggle`): a purely additive dark-mode toggle for this screen, matching the
 * frozen artifact's `.night-toggle` — see that component's own docblock.
 *
 * Key Reading / Market Evidence / Execution Pressure (Macroblock 7 — Final Gap Closure) render only
 * when the narrative engine returns text (it always does in practice — every branch, including the
 * "not enough data yet" ones, has approved copy) — never a raw radar/track number restated as prose.
 *
 * Replaces ExpansionSnapshot's role for the respondent-facing SnapshotScreen. ExpansionSnapshot.tsx
 * itself is untouched and stays in use by the admin Control Center's reviewer preview (AdminApp.tsx) —
 * a separate, internal-facing view this change does not touch.
 *
 * `capabilities` (rules-engine category recommendations, distinct from the client's own declared
 * Capability Landscape) is deliberately left unrendered here, the same way the radar sat unrendered
 * before its own beat existed — surfacing it risks reading as a provider/purchase recommendation,
 * which Level 2 MVP explicitly reserves against for this screen.
 */
export function VirtualSnapshot({
  snapshot,
  locale,
  t,
  recordView = true,
}: {
  snapshot: SnapshotView;
  locale: Locale;
  t: T;
  recordView?: boolean;
}) {
  const view = snapshot.content.locales[locale] ?? snapshot.content.locales[snapshot.content.deliverable_locale];
  const tracked = useRef(false);

  useEffect(() => {
    // A Control Center reviewer opening the Snapshot is not a respondent view: no journey event.
    if (tracked.current || !recordView) return;
    tracked.current = true;
    track({ type: "snapshot_viewed", interfaceLanguage: locale });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bridges = view.valueBridges;
  const hiveBridge = findBridge(bridges, "the_hive");
  const verifiedBridge = findBridge(bridges, "beeside_verified");
  const operationHubBridge = findBridge(bridges, "operation_hub_secure") ?? findBridge(bridges, "operation_hub_productivity");
  const strategicAdvisoryBridge = findBridge(bridges, "strategic_advisory");
  const sherpaBridge = findBridge(bridges, "sherpa");

  return (
    <article className="snapshot virtual-snapshot" aria-labelledby="opening-headline">
      <NightShiftToggle t={t} />

      <OpeningRecap
        eyebrow={view.eyebrow}
        headline={view.headline}
        generatedOn={view.generatedOn}
        summary={view.summary}
        facts={view.facts}
        shapePlan={view.shapePlan}
        t={t}
      />

      <RadarProfile dimensions={view.expansionProfile} dualProfile={view.dualProfile} t={t} />

      {view.keyReading && (
        <section className="snapshot-section key-reading-section" aria-labelledby="key-reading-title">
          <h2 className="section-title" id="key-reading-title">
            {t("virtual_snapshot", "key_reading_title")}
          </h2>
          <p className="lead">{view.keyReading}</p>
        </section>
      )}

      {view.needsPriorities && <PriorityList priorities={view.needsPriorities} />}

      {view.marketEvidenceNarrative && (
        <section className="snapshot-section market-evidence-section" aria-labelledby="market-evidence-title">
          <h2 className="section-title" id="market-evidence-title">
            {t("virtual_snapshot", "market_evidence_title")}
          </h2>
          <p className="helper">{view.marketEvidenceNarrative}</p>
        </section>
      )}

      {view.needsLandscape && <CapabilityLandscapeGrid landscape={view.needsLandscape} />}
      {(hiveBridge || verifiedBridge) && (
        <div className="value-bridge-pair">
          {hiveBridge && <ValueBridgeCard bridge={hiveBridge} />}
          {verifiedBridge && <ValueBridgeCard bridge={verifiedBridge} />}
        </div>
      )}

      {view.pathway && <PathwayDiagram pathway={view.pathway} t={t} />}
      {operationHubBridge && <ValueBridgeCard bridge={operationHubBridge} />}

      {view.executionPressureNarrative && (
        <section className="snapshot-section execution-pressure-section" aria-labelledby="execution-pressure-title">
          <h2 className="section-title" id="execution-pressure-title">
            {t("virtual_snapshot", "execution_pressure_title")}
          </h2>
          <p className="helper">{view.executionPressureNarrative}</p>
        </section>
      )}

      <StandOutPanels counts={view.counts} panels={view.panels} t={t} />
      {strategicAdvisoryBridge && <ValueBridgeCard bridge={strategicAdvisoryBridge} />}

      {(view.reconcile || view.immediatePriority || view.decisionAhead || view.oneThing || sherpaBridge) && (
        <div className="snapshot-context">
          {view.reconcile && (
            <section className="snapshot-card reconcile-card" aria-labelledby="snapshot-reconcile">
              <h2 className="card-title" id="snapshot-reconcile">
                <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path
                    d="M10 14a4.5 4.5 0 006.4 0l3-3a4.5 4.5 0 00-6.4-6.4l-1 1M14 10a4.5 4.5 0 00-6.4 0l-3 3a4.5 4.5 0 006.4 6.4l1-1"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                <span>{view.reconcile.title}</span>
              </h2>
              <p>{view.reconcile.text}</p>
            </section>
          )}

          {view.immediatePriority && (
            <section className="snapshot-card priority-card" aria-labelledby="snapshot-priority">
              <h2 className="card-title" id="snapshot-priority">
                {view.immediatePriority.title}
              </h2>
              <p className="priority-value">{view.immediatePriority.value}</p>
              {view.immediatePriority.timing && <p className="helper">{view.immediatePriority.timing}</p>}
              {view.immediatePriority.reason && <blockquote className="verbatim">"{view.immediatePriority.reason}"</blockquote>}
            </section>
          )}

          {view.decisionAhead && (
            <section className="snapshot-card" aria-labelledby="snapshot-decision">
              <h2 className="card-title" id="snapshot-decision">
                {view.decisionAhead.title}
              </h2>
              <p className="verbatim">"{view.decisionAhead.text}"</p>
            </section>
          )}
          {view.oneThing && (
            <section className="snapshot-card" aria-labelledby="snapshot-one-thing">
              <h2 className="card-title" id="snapshot-one-thing">
                {view.oneThing.title}
              </h2>
              <p className="verbatim">"{view.oneThing.text}"</p>
            </section>
          )}

          {sherpaBridge && <ValueBridgeCard bridge={sherpaBridge} large />}
        </div>
      )}

      <PrecisionTransition t={t} />
      <SnapshotValueCase t={t} />

      <footer className="snapshot-disclosure">
        <h2 className="card-title">{view.disclosure.title}</h2>
        <p>{view.disclosure.text}</p>
      </footer>
    </article>
  );
}
