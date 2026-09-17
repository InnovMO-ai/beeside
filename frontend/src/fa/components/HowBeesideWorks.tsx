import { T } from "../copy";

/**
 * HowBeesideWorks (Design Specification, build-order item ~17; Level 2 MVP §3.7 "How beeside Works
 * With You"). Reusable across the Virtual Snapshot and the PDF Snapshot.
 *
 * Static product copy describing the working relationship — never a sales pitch or a list of
 * providers/capabilities (that's Capability Landscape's job); this beat is about beeside itself.
 */
export function HowBeesideWorks({ t }: { t: T }) {
  return (
    <section className="snapshot-section how-beeside-works" aria-labelledby="how-beeside-works-title">
      <h2 className="section-title" id="how-beeside-works-title">
        {t("virtual_snapshot", "works_title")}
      </h2>
      <p className="helper">{t("virtual_snapshot", "works_intro")}</p>
      <ul className="plain-list">
        <li>{t("virtual_snapshot", "works_point_1")}</li>
        <li>{t("virtual_snapshot", "works_point_2")}</li>
        <li>{t("virtual_snapshot", "works_point_3")}</li>
      </ul>
    </section>
  );
}
