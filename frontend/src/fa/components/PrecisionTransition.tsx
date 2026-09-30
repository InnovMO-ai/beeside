import pnextPrecision from "../../assets/next-precision-assessment.png";
import pnextOperationHub from "../../assets/next-operation-hub.png";
import pnextSherpa from "../../assets/next-sherpa.png";
import { T } from "../copy";

/**
 * PrecisionTransition (2026-09-30 Product Owner authorization, item 1: converge to the frozen
 * Snapshot's `#precision-transition` — the "What's next" 3-icon grid — exactly, replacing this
 * component's previous plain-bullet-list rendering).
 *
 * Static product copy — sets expectations for the next stage without pricing, without a purchase
 * framing, and without promising a specific outcome or timeline beyond what the copy itself says. The
 * outline CTA ("See what Premium unlocks") is a preview/anchor, not the conversion moment — it scrolls
 * to the value case (`SnapshotValueCase`) that leads into the real Premium activation flow, mirroring
 * the frozen file's own distinction between this lighter preview CTA and the solid final ask there.
 */
export function PrecisionTransition({ t }: { t: T }) {
  const scrollToValueCase = () => {
    document.querySelector<HTMLElement>(".snapshot-value-case")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section className="snapshot-section precision-transition" aria-labelledby="precision-transition-title">
      <div className="precision-route" aria-hidden="true">
        <span className="pt" />
        <span className="ln" />
        <span className="pt dest" />
      </div>
      <h2 className="next-heading" id="precision-transition-title">
        {t("virtual_snapshot", "precision_next_heading")}
      </h2>
      <div className="next-grid">
        <div className="next-item">
          <div className="next-icon">
            <img className="next-logo" alt="Precision Assessment" src={pnextPrecision} />
          </div>
          <p>{t("virtual_snapshot", "precision_next_item_1")}</p>
        </div>
        <div className="next-item">
          <div className="next-icon">
            <img className="next-logo" alt="Operation Hub" src={pnextOperationHub} />
          </div>
          <p>{t("virtual_snapshot", "precision_next_item_2")}</p>
        </div>
        <div className="next-item">
          <div className="next-icon">
            <img className="next-logo" alt="Sherpa" src={pnextSherpa} />
          </div>
          <p>{t("virtual_snapshot", "precision_next_item_3")}</p>
        </div>
      </div>
      <div className="precision-cta">
        <button type="button" className="cta-btn precision-cta-btn" onClick={scrollToValueCase}>
          {t("virtual_snapshot", "precision_next_cta")}
        </button>
      </div>
    </section>
  );
}
