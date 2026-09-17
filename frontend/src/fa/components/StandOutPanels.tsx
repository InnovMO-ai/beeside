import { T } from "../copy";
import { RenderedSnapshot, SnapshotTone } from "../types";

/**
 * StandOutPanels (Design Specification, build-order item ~14; Level 2 MVP §3.2 "What Stands Out").
 * Reusable across the Virtual Snapshot and the PDF Snapshot.
 *
 * No new derivation happens here — every count and panel already comes fully formed from the rules
 * engine via RenderedSnapshot.counts/panels (unchanged by Level 2). This component only gives that
 * existing data the Virtual Snapshot's narrative frame: the overview counts first (general), then
 * each tone's specific findings (specific) — a beat within the story, not a bare, unframed grid.
 * Status color is never the only signal here either: every count and panel carries its own icon and
 * label alongside its tone.
 */

function StatusIcon({ tone }: { tone: SnapshotTone }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", "aria-hidden": true, focusable: false } as const;
  switch (tone) {
    case "well_defined":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "needs_attention":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <path d="M12 6.5v7" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="12" cy="17" r="1.4" fill="#fff" />
        </svg>
      );
    case "resolve_early":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <path d="M12 7v5.2l3.4 2" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}

export function StandOutPanels({
  counts,
  panels,
  t,
}: {
  counts: RenderedSnapshot["counts"];
  panels: RenderedSnapshot["panels"];
  t: T;
}) {
  if (counts.length === 0 && panels.length === 0) return null;

  return (
    <section className="stand-out-panels" aria-labelledby="stand-out-title">
      <h2 className="section-title" id="stand-out-title">
        {t("virtual_snapshot", "stand_out_title")}
      </h2>
      <p className="helper">{t("virtual_snapshot", "stand_out_intro")}</p>

      {counts.length > 0 && (
        <ul className="snapshot-counts">
          {counts.map((count) => (
            <li key={count.tone} className={`status-chip tone-${count.tone}`}>
              <StatusIcon tone={count.tone} />
              <span className="status-count">{count.count}</span>
              <span>{count.label}</span>
            </li>
          ))}
        </ul>
      )}

      {panels.length > 0 && (
        <div className="snapshot-panels">
          {panels.map((panel) => (
            <section key={panel.tone} className={`snapshot-panel tone-${panel.tone}`} aria-labelledby={`stand-out-panel-${panel.tone}`}>
              <h3 className="panel-title" id={`stand-out-panel-${panel.tone}`}>
                <StatusIcon tone={panel.tone} />
                <span>{panel.title}</span>
              </h3>
              <p className="panel-intro">{panel.intro}</p>
              <ul className="panel-items">
                {panel.items.map((item) => (
                  <li key={item.areaId}>
                    <span className="panel-item-label">{item.label}</span>
                    {item.reason && <span className="panel-item-reason">{item.reason}</span>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
