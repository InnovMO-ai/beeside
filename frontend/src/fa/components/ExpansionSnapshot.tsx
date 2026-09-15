import { useEffect, useRef } from "react";
import { track } from "../analytics";
import { Locale, SnapshotTone, SnapshotView } from "../types";

/**
 * The client Expansion Snapshot (Functional Specification v1 §6). Everything shown comes from the
 * immutable Snapshot generated at completion; this component only lays it out. Status color is
 * never the only signal: every status carries its icon and its label.
 */

function StatusIcon({ tone }: { tone: SnapshotTone | "reconcile" }) {
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
    default:
      return (
        <svg {...common}>
          <path d="M10 14a4.5 4.5 0 006.4 0l3-3a4.5 4.5 0 00-6.4-6.4l-1 1M14 10a4.5 4.5 0 00-6.4 0l-3 3a4.5 4.5 0 006.4 6.4l1-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
  }
}

export function ExpansionSnapshot({ snapshot, locale }: { snapshot: SnapshotView; locale: Locale }) {
  const view = snapshot.content.locales[locale] ?? snapshot.content.locales[snapshot.content.deliverable_locale];
  const tracked = useRef(false);

  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    track({ type: "snapshot_viewed", interfaceLanguage: locale });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <article className="snapshot" aria-labelledby="snapshot-title">
      <header className="snapshot-hero">
        <p className="eyebrow">{view.eyebrow}</p>
        <h1 className="display" id="snapshot-title">
          {view.headline}
        </h1>
        {view.summary.map((sentence) => (
          <p className="lead snapshot-summary" key={sentence}>
            {sentence}
          </p>
        ))}
        <p className="helper">{view.generatedOn}</p>
      </header>

      <dl className="snapshot-facts">
        {view.facts.map((fact) => (
          <div className="snapshot-fact" key={fact.key}>
            <dt>{fact.label}</dt>
            <dd>
              {fact.value}
              {fact.detail && <span className="snapshot-fact-detail">{fact.detail}</span>}
            </dd>
          </div>
        ))}
      </dl>

      <ul className="snapshot-counts">
        {view.counts.map((count) => (
          <li key={count.tone} className={`status-chip tone-${count.tone}`}>
            <StatusIcon tone={count.tone} />
            <span className="status-count">{count.count}</span>
            <span>{count.label}</span>
          </li>
        ))}
      </ul>

      {view.panels.length > 0 && (
        <div className="snapshot-panels">
          {view.panels.map((panel) => (
            <section key={panel.tone} className={`snapshot-panel tone-${panel.tone}`} aria-labelledby={`panel-${panel.tone}`}>
              <h2 className="panel-title" id={`panel-${panel.tone}`}>
                <StatusIcon tone={panel.tone} />
                <span>{panel.title}</span>
              </h2>
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

      {(view.immediatePriority || view.reconcile) && (
        <div className="snapshot-row">
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
          {view.reconcile && (
            <section className="snapshot-card reconcile-card" aria-labelledby="snapshot-reconcile">
              <h2 className="card-title" id="snapshot-reconcile">
                <StatusIcon tone="reconcile" />
                <span>{view.reconcile.title}</span>
              </h2>
              <p>{view.reconcile.text}</p>
            </section>
          )}
        </div>
      )}

      {view.capabilities && (
        <section className="snapshot-section" aria-labelledby="snapshot-capabilities">
          <h2 className="section-title" id="snapshot-capabilities">
            {view.capabilities.title}
          </h2>
          <p className="helper">{view.capabilities.intro}</p>
          <ul className="capability-tags">
            {view.capabilities.items.map((capability) => (
              <li key={capability.categoryId} className="capability-tag">
                <span className="capability-label">{capability.label}</span>
                <span className="capability-description">{capability.description}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(view.decisionAhead || view.shapePlan || view.oneThing) && (
        <div className="snapshot-context">
          {view.decisionAhead && (
            <section className="snapshot-card" aria-labelledby="snapshot-decision">
              <h2 className="card-title" id="snapshot-decision">
                {view.decisionAhead.title}
              </h2>
              <p className="verbatim">“{view.decisionAhead.text}”</p>
            </section>
          )}
          {view.shapePlan && (
            <section className="snapshot-card" aria-labelledby="snapshot-shape">
              <h2 className="card-title" id="snapshot-shape">
                {view.shapePlan.title}
              </h2>
              <ul className="plain-list">
                {view.shapePlan.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
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

      <footer className="snapshot-disclosure">
        <h2 className="card-title">{view.disclosure.title}</h2>
        <p>{view.disclosure.text}</p>
      </footer>
    </article>
  );
}
