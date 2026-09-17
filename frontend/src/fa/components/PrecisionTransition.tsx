import { T } from "../copy";

/**
 * PrecisionTransition (Design Specification, build-order item ~16; Level 2 MVP §3.6 "What to Expect
 * in Precision Assessment"). Reusable across the Virtual Snapshot and the PDF Snapshot.
 *
 * Static product copy — sets expectations for the next stage without pricing, without a purchase
 * framing, and without promising a specific outcome or timeline beyond what the copy itself says.
 */
export function PrecisionTransition({ t }: { t: T }) {
  return (
    <section className="snapshot-section precision-transition" aria-labelledby="precision-transition-title">
      <h2 className="section-title" id="precision-transition-title">
        {t("virtual_snapshot", "precision_title")}
      </h2>
      <p className="helper">{t("virtual_snapshot", "precision_intro")}</p>
      <ul className="plain-list">
        <li>{t("virtual_snapshot", "precision_point_1")}</li>
        <li>{t("virtual_snapshot", "precision_point_2")}</li>
        <li>{t("virtual_snapshot", "precision_point_3")}</li>
      </ul>
    </section>
  );
}
