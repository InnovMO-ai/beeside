import { T } from "../copy";
import { RenderedExpansionDimension } from "../types";

/**
 * RadarProfile (Design Specification, build-order item 10; Level 2 MVP §3.1 "The Big Picture").
 * Reusable across the Virtual Snapshot and the PDF Snapshot.
 *
 * The six-dimension Expansion Profile radar. `value` (0..1) exists only to place each axis point —
 * it is never rendered as a number, percentage or score, and the component throws away nothing else
 * it could be tempted to compute (no average, no "overall readiness"). The only wording shown is each
 * dimension's qualitative `tierLabel`. The visual polygon is decorative (aria-hidden): the definition
 * list beside it is the real accessible content, so the information never depends on sight or color
 * alone (Level 2 MVP §10 accessibility requirement, and §3.1's "accessible textual interpretation").
 */

const SIZE = 280;
const CENTER = SIZE / 2;
const MAX_RADIUS = SIZE / 2 - 48;
const RINGS = [0.25, 0.5, 0.75, 1];

function axisPoint(index: number, count: number, radius: number): { x: number; y: number } {
  const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
  return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
}

function polygonPoints(values: number[]): string {
  return values.map((value, i) => axisPoint(i, values.length, MAX_RADIUS * Math.max(0, Math.min(1, value)))).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

export function RadarProfile({ dimensions, t }: { dimensions: RenderedExpansionDimension[]; t: T }) {
  if (dimensions.length === 0) return null;
  const count = dimensions.length;
  const outline = polygonPoints(dimensions.map(() => 1));
  const shape = polygonPoints(dimensions.map((d) => d.value));

  return (
    <section className="radar-profile" aria-labelledby="radar-profile-title">
      <h2 className="display" id="radar-profile-title">
        {t("virtual_snapshot", "big_picture_title")}
      </h2>
      <p className="lead">{t("virtual_snapshot", "big_picture_intro")}</p>

      <div className="radar-profile-body">
        {/* Purely decorative — aria-hidden removes it from the accessibility tree entirely, so it
            carries no role (role="img" alongside aria-hidden is a contradiction: a role announces
            an element that aria-hidden then hides). The <dl> below is the one real accessible
            alternative for this chart's data. */}
        <svg className="radar-profile-chart" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" focusable="false">
          {RINGS.map((ring) => (
            <polygon key={ring} className="radar-ring" points={polygonPoints(dimensions.map(() => ring))} />
          ))}
          {dimensions.map((_, i) => {
            const p = axisPoint(i, count, MAX_RADIUS);
            return <line key={i} className="radar-axis" x1={CENTER} y1={CENTER} x2={p.x} y2={p.y} />;
          })}
          <polygon className="radar-outline" points={outline} />
          <polygon className="radar-shape" points={shape} />
          {dimensions.map((d, i) => {
            const point = axisPoint(i, count, MAX_RADIUS * Math.max(0, Math.min(1, d.value)));
            return <circle key={d.key} className="radar-point" cx={point.x} cy={point.y} r={4} />;
          })}
        </svg>

        <dl className="radar-profile-legend" aria-label={t("virtual_snapshot", "radar_accessible_summary")}>
          {dimensions.map((d) => (
            <div className="radar-legend-row" key={d.key}>
              <dt>{d.label}</dt>
              <dd className={`radar-tier radar-tier-${d.tier.replace(/_/g, "-")}`}>{d.tierLabel}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
