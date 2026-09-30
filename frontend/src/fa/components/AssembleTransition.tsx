import { T } from "../copy";

/**
 * AssembleTransition (Design Specification component table, build-order item 9): "the non-spinner
 * motion sequence into the Snapshot" — copy fixed by the spec's own Screen/Composition Map:
 * "Putting the pieces together." Shown while the locked assessment's Snapshot is being generated
 * (SnapshotScreen's loading state — see screens/SnapshotScreen.tsx).
 *
 * Deliberately not a spinner: a small set of tiles animate into a settled, aligned row, echoing
 * "assembling" without implying indeterminate waiting. Pure CSS (no animation library, per the
 * owner's "no heavy libraries" constraint elsewhere in this same macroblock) — the keyframes live in
 * styles.css under `.assemble-*`, gated by `prefers-reduced-motion` there (Design Spec's own QA
 * checklist: "reduced-motion fallback verified on the Assemble transition"). With reduced motion,
 * the tiles simply render in their final, settled position — same markup, no animation.
 */
export function AssembleTransition({ t }: { t: T }) {
  return (
    <section className="assemble-transition" role="status" aria-live="polite">
      <div className="assemble-tiles" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="assemble-tile" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
      <h1 className="display assemble-headline">{t("assemble", "headline")}</h1>
      <p className="lead">{t("assemble", "body")}</p>
    </section>
  );
}
