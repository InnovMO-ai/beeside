import { T } from "../copy";
import { PathwayStage, RenderedPathwayItem } from "../types";

/**
 * PathwayDiagram (Design Specification, build-order item ~12; Level 2 MVP §3.4 "Your Initial Path").
 * Reusable across the Virtual Snapshot and the PDF Snapshot.
 *
 * Renders the four-stage NOW → DEFINE → ENABLE → LAUNCH sequence as parallel columns, not a single
 * forced line: items sharing a stage are parallel paths, and a stage can be empty. The bucketing
 * itself is computed on the backend (dependency depth over the client's own declared graph, capped at
 * LAUNCH) — this component only lays out the result. Every stage carries its own always-visible
 * ordinal (1–4) alongside its label, so stage identity never depends on color alone, and every item
 * inherits the same immediate-priority / blocker wording used in "What Matters Now" rather than
 * inventing separate copy for the same two facts.
 */

const STAGE_ORDER: readonly PathwayStage[] = ["now", "define", "enable", "launch"];

type Pathway = {
  title: string;
  intro: string;
  stageLabels: Record<PathwayStage, string>;
  immediateLabel: string;
  blockerLabel: string;
  items: RenderedPathwayItem[];
};

export function PathwayDiagram({ pathway, t }: { pathway: Pathway; t: T }) {
  if (pathway.items.length === 0) return null;
  const byStage = new Map<PathwayStage, RenderedPathwayItem[]>(STAGE_ORDER.map((s) => [s, []]));
  for (const item of pathway.items) byStage.get(item.stage)?.push(item);

  return (
    <section className="pathway-diagram" aria-labelledby="pathway-diagram-title">
      <h2 className="section-title" id="pathway-diagram-title">
        {pathway.title}
      </h2>
      <p className="helper">{pathway.intro}</p>

      <ol className="pathway-stages">
        {STAGE_ORDER.map((stage, index) => {
          const items = byStage.get(stage) ?? [];
          return (
            <li className="pathway-stage" key={stage} data-empty={items.length === 0}>
              <h3 className="pathway-stage-title">
                <span className="pathway-stage-ordinal" aria-hidden="true">
                  {index + 1}
                </span>
                {pathway.stageLabels[stage]}
              </h3>
              {items.length === 0 ? (
                <p className="pathway-stage-empty helper">{t("virtual_snapshot", "pathway_stage_empty")}</p>
              ) : (
                <ul className="pathway-items">
                  {items.map((item) => (
                    <li className="pathway-item" key={item.key}>
                      <span className="pathway-item-label">{item.label}</span>
                      <span className="pathway-item-flags">
                        {item.isImmediatePriority && <span className="status-chip priority-badge-immediate">{pathway.immediateLabel}</span>}
                        {item.isBlocker && <span className="status-chip priority-badge-blocker">{pathway.blockerLabel}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
