import { RenderedNeedsPriority } from "../types";

/**
 * PriorityList (Design Specification, build-order item ~11; Level 2 MVP §3.3 "What Matters Now").
 * Reusable across the Virtual Snapshot and the PDF Snapshot.
 *
 * Renders the client's own declared priority order (index 0 = Immediate Priority) exactly as
 * declared — this list is never resequenced by dependency data. Dependency, owner and approval
 * context are shown alongside each item as plain accessible metadata, not folded into the ordering.
 * A blocker is its own separate, always-visible flag — it never displaces or reorders an item either.
 */

type NeedsPriorities = {
  title: string;
  intro: string;
  immediateLabel: string;
  nextLabel: string;
  blockerLabel: string;
  dependsOnLabel: string;
  ownerLabel: string;
  approvalLabel: string;
  items: RenderedNeedsPriority[];
};

export function PriorityList({ priorities }: { priorities: NeedsPriorities }) {
  if (priorities.items.length === 0) return null;

  return (
    <section className="priority-list" aria-labelledby="priority-list-title">
      <h2 className="section-title" id="priority-list-title">
        {priorities.title}
      </h2>
      <p className="helper">{priorities.intro}</p>

      <ol className="priority-items">
        {priorities.items.map((item) => {
          const hasMeta = item.dependsOnLabel !== null || item.owner !== null || item.approvalRequired;
          return (
            <li className="priority-item" key={item.key}>
              <div className="priority-item-header">
                <span className="priority-item-label">{item.label}</span>
                <span className={`status-chip priority-badge-${item.isImmediatePriority ? "immediate" : "next"}`}>
                  {item.isImmediatePriority ? priorities.immediateLabel : priorities.nextLabel}
                </span>
                {item.isBlocker && <span className="status-chip priority-badge-blocker">{priorities.blockerLabel}</span>}
              </div>
              {hasMeta && (
                <dl className="priority-item-meta">
                  {item.dependsOnLabel !== null && (
                    <div className="priority-item-meta-row">
                      <dt>{priorities.dependsOnLabel}</dt>
                      <dd>{item.dependsOnLabel}</dd>
                    </div>
                  )}
                  {item.owner !== null && (
                    <div className="priority-item-meta-row">
                      <dt>{priorities.ownerLabel}</dt>
                      <dd>{item.owner}</dd>
                    </div>
                  )}
                  {item.approvalRequired && (
                    <div className="priority-item-meta-row">
                      <dt>{priorities.approvalLabel}</dt>
                      <dd>{item.approvalFrom ?? ""}</dd>
                    </div>
                  )}
                </dl>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
