import { useEffect, useRef } from "react";
import { track } from "../analytics";
import { T } from "../copy";
import { Locale, SnapshotView } from "../types";
import { OpeningRecap } from "./OpeningRecap";
import { RadarProfile } from "./RadarProfile";
import { StandOutPanels } from "./StandOutPanels";
import { PriorityList } from "./PriorityList";
import { PathwayDiagram } from "./PathwayDiagram";
import { CapabilityLandscapeGrid } from "./CapabilityLandscapeGrid";
import { PrecisionTransition } from "./PrecisionTransition";
import { HowBeesideWorks } from "./HowBeesideWorks";

/**
 * VirtualSnapshot (Level 2 MVP §3): the narrative Virtual Snapshot — specific → general → specific →
 * action — assembling the storyboard beats built across this build-order phase:
 *   1. Opening (OpeningRecap)              5. Your Initial Path (PathwayDiagram)
 *   2. The Big Picture (RadarProfile)       6. Capability Landscape (CapabilityLandscapeGrid)
 *   3. What Stands Out (StandOutPanels)     7. What to Expect in Precision (PrecisionTransition)
 *   4. What Matters Now (PriorityList)      8. How beeside Works With You (HowBeesideWorks)
 * Beat 9, the Final CTA, is intentionally NOT rendered here — the caller (SnapshotScreen) renders
 * PremiumTransition as a sibling afterward, exactly as before, so this component owns the story only.
 *
 * Replaces ExpansionSnapshot's role for the respondent-facing SnapshotScreen. ExpansionSnapshot.tsx
 * itself is untouched and stays in use by the admin Control Center's reviewer preview (AdminApp.tsx) —
 * a separate, internal-facing view this change does not touch.
 *
 * `immediatePriority`, `reconcile`, `decisionAhead` and `oneThing` are richer, narrower cuts of facts
 * that are also carried by the beats above (the client's own declared priority, the rules engine's
 * findings) or that add specific color between beats; each is folded into the beat it belongs to
 * rather than given its own dashboard card. `capabilities` (rules-engine category recommendations,
 * distinct from the client's own declared Capability Landscape) is deliberately left unrendered here,
 * the same way the radar sat unrendered before its own beat existed — surfacing it risks reading as a
 * provider/purchase recommendation, which Level 2 MVP explicitly reserves against for this screen.
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

  return (
    <article className="snapshot virtual-snapshot" aria-labelledby="opening-headline">
      <OpeningRecap
        eyebrow={view.eyebrow}
        headline={view.headline}
        generatedOn={view.generatedOn}
        summary={view.summary}
        facts={view.facts}
        shapePlan={view.shapePlan}
        t={t}
      />

      <RadarProfile dimensions={view.expansionProfile} t={t} />

      <StandOutPanels counts={view.counts} panels={view.panels} t={t} />

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
          {view.immediatePriority.reason && <blockquote className="verbatim">“{view.immediatePriority.reason}”</blockquote>}
        </section>
      )}
      {view.needsPriorities && <PriorityList priorities={view.needsPriorities} />}

      {view.pathway && <PathwayDiagram pathway={view.pathway} t={t} />}

      {view.needsLandscape && <CapabilityLandscapeGrid landscape={view.needsLandscape} />}

      {(view.decisionAhead || view.oneThing) && (
        <div className="snapshot-context">
          {view.decisionAhead && (
            <section className="snapshot-card" aria-labelledby="snapshot-decision">
              <h2 className="card-title" id="snapshot-decision">
                {view.decisionAhead.title}
              </h2>
              <p className="verbatim">“{view.decisionAhead.text}”</p>
            </section>
          )}
          {view.oneThing && (
            <section className="snapshot-card" aria-labelledby="snapshot-one-thing">
              <h2 className="card-title" id="snapshot-one-thing">
                {view.oneThing.title}
              </h2>
              <p className="verbatim">“{view.oneThing.text}”</p>
            </section>
          )}
        </div>
      )}

      <PrecisionTransition t={t} />
      <HowBeesideWorks t={t} />

      <footer className="snapshot-disclosure">
        <h2 className="card-title">{view.disclosure.title}</h2>
        <p>{view.disclosure.text}</p>
      </footer>
    </article>
  );
}
