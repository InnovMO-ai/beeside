import { T } from "../copy";
import { RenderedExpansionDimension } from "../types";

/**
 * RadarProfile (Design Specification, build-order item 10; Level 2 MVP §3.1 "The Big Picture";
 * extended Macroblock 7, Snapshot Runtime Convergence, into the Dual Expansion Profile). Reusable
 * across the Virtual Snapshot and the PDF Snapshot.
 *
 * The six-dimension Expansion Profile, now carrying BOTH series together — Definition & Evidence
 * (the original single series) and Execution Demand (Macroblock 7) — per the corrected frozen
 * decision that both a dumbbell "track" view and a radar view render together, never one replacing
 * the other. `value`/`demand.value` (0..1) exist only to place points on the track/radar — never
 * rendered as a number, percentage or score; `tierLabel`/`demand.tierLabel` are the only wording
 * shown. The visual track and polygon are decorative (aria-hidden): the definition list at the end
 * is the real accessible content, so nothing here depends on sight or color alone (Level 2 MVP §10).
 *
 * NOT_EVALUABLE handling (a dimension whose Execution Demand has no defensible signal, e.g.
 * Commercial Ambition & Differentiation, or not enough evidence yet): the track view shows a plain
 * "Not yet evaluable" note instead of a demand marker, and the axis's `demandNote` (one line of
 * client-facing context) renders underneath. The radar view reuses that axis's Definition & Evidence
 * value for the Execution Demand polygon vertex — geometry only, never displayed as a number — and
 * marks that one point with a distinct hollow/dashed style, the same non-fabrication treatment the
 * frozen artifact itself uses (`.radar-dot.dem.unevaluable` sharing its `def` sibling's coordinates)
 * so the shape never reads as a fabricated low-demand score.
 */

const SIZE = 280;
const CENTER = SIZE / 2;
const MAX_RADIUS = SIZE / 2 - 48;
const RINGS = [0.25, 0.5, 0.75, 1];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function axisPoint(index: number, count: number, radius: number): { x: number; y: number } {
  const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
  return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
}

function polygonPoints(values: number[]): string {
  return values.map((value, i) => axisPoint(i, values.length, MAX_RADIUS * clamp01(value))).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

export function RadarProfile({
  dimensions,
  dualProfile,
  t,
}: {
  dimensions: RenderedExpansionDimension[];
  dualProfile: { title: string; intro: string; definitionLabel: string; demandLabel: string };
  t: T;
}) {
  if (dimensions.length === 0) return null;
  const count = dimensions.length;
  const outline = polygonPoints(dimensions.map(() => 1));
  const definitionShape = polygonPoints(dimensions.map((d) => d.value));
  // NOT_EVALUABLE vertices reuse the Definition & Evidence value for geometry only — see docblock.
  const demandShape = polygonPoints(dimensions.map((d) => (d.demand ? d.demand.value : d.value)));

  return (
    <section className="radar-profile" aria-labelledby="radar-profile-title">
      <h2 className="display" id="radar-profile-title">
        {dualProfile.title}
      </h2>
      <p className="lead">{dualProfile.intro}</p>

      {/* Dumbbell "track" view — one horizontal track per dimension, both series' markers on it. */}
      <div className="dual-profile-track" aria-hidden="true">
        <div className="dual-profile-legend">
          <span className="dual-profile-legend-item">
            <span className="dual-profile-legend-dot dual-profile-legend-dot-definition" />
            {dualProfile.definitionLabel}
          </span>
          <span className="dual-profile-legend-item">
            <span className="dual-profile-legend-dot dual-profile-legend-dot-demand" />
            {dualProfile.demandLabel}
          </span>
        </div>
        {dimensions.map((d) => {
          const defPct = clamp01(d.value) * 100;
          const demPct = d.demand ? clamp01(d.demand.value) * 100 : null;
          const connectorLeft = demPct === null ? defPct : Math.min(defPct, demPct);
          const connectorWidth = demPct === null ? 0 : Math.abs(demPct - defPct);
          return (
            <div className="dual-profile-row" key={d.key}>
              <div className="dual-profile-axis-label">{d.label}</div>
              <div className="dual-profile-track-line">
                {demPct !== null && <div className="dual-profile-connector" style={{ left: `${connectorLeft}%`, width: `${connectorWidth}%` }} />}
                <div className="dual-profile-marker dual-profile-marker-definition" style={{ left: `${defPct}%` }} />
                <div className="dual-profile-marker-tag dual-profile-tag-definition" style={{ left: `${defPct}%` }}>
                  {d.tierLabel}
                </div>
                {demPct !== null && d.demand ? (
                  <>
                    <div className="dual-profile-marker dual-profile-marker-demand" style={{ left: `${demPct}%` }} />
                    <div className="dual-profile-marker-tag dual-profile-tag-demand" style={{ left: `${demPct}%` }}>
                      {d.demand.tierLabel}
                    </div>
                  </>
                ) : (
                  <div className="dual-profile-not-evaluable">{t("virtual_snapshot", "dual_profile_not_evaluable")}</div>
                )}
              </div>
              {d.demandNote && <p className="dual-profile-axis-note">{d.demandNote}</p>}
            </div>
          );
        })}
        <div className="dual-profile-scale-ends">
          <span>{t("virtual_snapshot", "dual_profile_scale_less")}</span>
          <span>{t("virtual_snapshot", "dual_profile_scale_more")}</span>
        </div>
      </div>

      {/* Radar view — the same six dimensions, one shape per series. */}
      <p className="dual-profile-radar-eyebrow">{t("virtual_snapshot", "dual_profile_radar_eyebrow")}</p>
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
          <polygon className="radar-shape radar-shape-definition" points={definitionShape} />
          <polygon className="radar-shape radar-shape-demand" points={demandShape} />
          {dimensions.map((d, i) => {
            const point = axisPoint(i, count, MAX_RADIUS * clamp01(d.value));
            return <circle key={`def-${d.key}`} className="radar-point radar-point-definition" cx={point.x} cy={point.y} r={4} />;
          })}
          {dimensions.map((d, i) => {
            const demandValue = d.demand ? d.demand.value : d.value;
            const point = axisPoint(i, count, MAX_RADIUS * clamp01(demandValue));
            const className = d.demand ? "radar-point radar-point-demand" : "radar-point radar-point-demand radar-point-not-evaluable";
            return <circle key={`dem-${d.key}`} className={className} cx={point.x} cy={point.y} r={d.demand ? 4 : 5} />;
          })}
        </svg>

        <dl className="radar-profile-legend" aria-label={t("virtual_snapshot", "dual_profile_accessible_summary")}>
          {dimensions.map((d) => (
            <div className="radar-legend-row" key={d.key}>
              <dt>{d.label}</dt>
              <dd className={`radar-tier radar-tier-${d.tier.replace(/_/g, "-")}`}>
                {dualProfile.definitionLabel}: {d.tierLabel}
              </dd>
              <dd className={d.demand ? `radar-demand-tier radar-demand-tier-${d.demand.tier.replace(/_/g, "-")}` : "radar-demand-tier radar-demand-tier-not-evaluable"}>
                {dualProfile.demandLabel}: {d.demand ? d.demand.tierLabel : t("virtual_snapshot", "dual_profile_not_evaluable")}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
