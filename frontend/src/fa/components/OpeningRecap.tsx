import { T } from "../copy";
import { RenderedSnapshot } from "../types";

/**
 * OpeningRecap (Design Specification, build-order item ~15; Level 2 MVP §3.1 "Opening" beat — the
 * first, specific step of the Virtual Snapshot's specific → general → specific → action arc, ahead of
 * the Big Picture radar). Reusable across the Virtual Snapshot and the PDF Snapshot.
 *
 * A plain recap of what the client told us — their project, their objectives, their requirements —
 * built entirely from fields already on RenderedSnapshot (eyebrow/headline/summary/facts/shapePlan;
 * no new backend derivation). Deliberately no decorative photography or illustration: the content is
 * the client's own words and declared facts, not generic imagery.
 */

export function OpeningRecap({
  eyebrow,
  headline,
  generatedOn,
  summary,
  facts,
  shapePlan,
  t,
}: {
  eyebrow: string;
  headline: string;
  generatedOn: string;
  summary: string[];
  facts: RenderedSnapshot["facts"];
  shapePlan: RenderedSnapshot["shapePlan"];
  t: T;
}) {
  const factByKey = new Map(facts.map((f) => [f.key, f]));
  const launch = factByKey.get("launch");
  const priority = factByKey.get("priority");
  const requirements = shapePlan?.items ?? [];

  return (
    <header className="snapshot-opening" aria-labelledby="opening-headline">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="display" id="opening-headline">
        {headline}
      </h1>
      <p className="helper">{generatedOn}</p>

      <section className="opening-beat" aria-labelledby="opening-project-title">
        <h2 className="section-title" id="opening-project-title">
          {t("virtual_snapshot", "opening_project_label")}
        </h2>
        {summary.map((sentence) => (
          <p className="lead snapshot-summary" key={sentence}>
            {sentence}
          </p>
        ))}
      </section>

      {(launch || priority) && (
        <section className="opening-beat" aria-labelledby="opening-objectives-title">
          <h2 className="section-title" id="opening-objectives-title">
            {t("virtual_snapshot", "opening_objectives_label")}
          </h2>
          <dl className="snapshot-facts">
            {[launch, priority].map(
              (fact) =>
                fact && (
                  <div className="snapshot-fact" key={fact.key}>
                    <dt>{fact.label}</dt>
                    <dd>
                      {fact.value}
                      {fact.detail && <span className="snapshot-fact-detail">{fact.detail}</span>}
                    </dd>
                  </div>
                )
            )}
          </dl>
        </section>
      )}

      <section className="opening-beat" aria-labelledby="opening-requirements-title">
        <h2 className="section-title" id="opening-requirements-title">
          {t("virtual_snapshot", "opening_requirements_label")}
        </h2>
        {requirements.length > 0 ? (
          <ul className="plain-list">
            {requirements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="helper">{t("virtual_snapshot", "opening_requirements_empty")}</p>
        )}
      </section>
    </header>
  );
}
