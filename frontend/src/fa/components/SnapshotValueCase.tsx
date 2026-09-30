import { T } from "../copy";
import pillarSherpa from "../../assets/bridge-sherpa.png";
import pillarOperationHub from "../../assets/bridge-operation-hub.png";
import pillarTheHive from "../../assets/bridge-the-hive.png";
import pillarStrategicAdvisory from "../../assets/bridge-strategic-advisory.png";
import valueBannerPhoto from "../../assets/value-banner-photo.jpg";

/**
 * SnapshotValueCase — "Why continue with beeside" (2026-09-30 Product Owner authorization, item 1:
 * converge to the frozen Snapshot's `#beeside-value` section exactly). Static institutional content,
 * identical on every Snapshot — unlike the threaded ValueBridgeCards above it (evidence-triggered from
 * this project's own answers), the four-pillar strip, gain strip, A/B/C/D comparison, banner and final
 * CTA here are the same fixed value case for every respondent, verbatim from the frozen artifact.
 *
 * Coexistence with PremiumTransition (Product Owner authorization, same item): PremiumTransition
 * (rendered immediately after this by SnapshotScreen) is the separate, functional multi-stage Premium
 * activation flow (offer → consideration → activation → result) — a pre-existing, distinct concept
 * this pass does not touch or duplicate. This component is the informational value case that leads up
 * to that decision; its own CTA does not re-implement activation, it scrolls to and focuses the real
 * PremiumTransition flow already sitting right below it in the DOM.
 */
export function SnapshotValueCase({ t }: { t: T }) {
  const scrollToPremium = () => {
    const section = document.querySelector<HTMLElement>(".premium-transition");
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
    const focusTarget = section?.querySelector<HTMLElement>("[tabindex='-1'], .button-primary");
    focusTarget?.focus();
  };

  return (
    <section className="snapshot-section snapshot-value-case" aria-labelledby="snapshot-value-case-title">
      <p className="kicker">{t("virtual_snapshot", "value_case_kicker")}</p>
      <h2 className="display" id="snapshot-value-case-title">
        {t("virtual_snapshot", "value_case_title")}
      </h2>
      <p className="lead">{t("virtual_snapshot", "value_case_intro")}</p>

      <div className="value-shell">
        <p className="kicker value-shell-kicker">{t("virtual_snapshot", "value_case_pillars_kicker")}</p>
        <div className="pillar-grid">
          <div className="pillar-card">
            <div className="pillar-mark pillar-mark-mono">
              <img src={pillarSherpa} alt="" />
            </div>
            <div className="pillar-head">{t("virtual_snapshot", "value_case_pillar_sherpa_head")}</div>
            <p>{t("virtual_snapshot", "value_case_pillar_sherpa_body")}</p>
          </div>
          <div className="pillar-card">
            <div className="pillar-mark pillar-mark-mono">
              <img src={pillarOperationHub} alt="" />
            </div>
            <div className="pillar-head">{t("virtual_snapshot", "value_case_pillar_oh_head")}</div>
            <p>{t("virtual_snapshot", "value_case_pillar_oh_body")}</p>
          </div>
          <div className="pillar-card">
            <div className="pillar-mark pillar-mark-mono">
              <img src={pillarTheHive} alt="" />
            </div>
            <div className="pillar-head">{t("virtual_snapshot", "value_case_pillar_hive_head")}</div>
            <p>{t("virtual_snapshot", "value_case_pillar_hive_body")}</p>
          </div>
          <div className="pillar-card">
            <div className="pillar-mark">
              <img src={pillarStrategicAdvisory} alt="" />
            </div>
            <div className="pillar-head">{t("virtual_snapshot", "value_case_pillar_advisory_head")}</div>
            <p>{t("virtual_snapshot", "value_case_pillar_advisory_body")}</p>
          </div>
        </div>

        <div className="gain-strip">
          <div className="gain-item">{t("virtual_snapshot", "value_case_gain_1")}</div>
          <div className="gain-item">{t("virtual_snapshot", "value_case_gain_2")}</div>
          <div className="gain-item">{t("virtual_snapshot", "value_case_gain_3")}</div>
          <div className="gain-item">{t("virtual_snapshot", "value_case_gain_4")}</div>
        </div>

        <p className="compare-caption">{t("virtual_snapshot", "value_case_compare_caption")}</p>
        <div className="compare-table">
          <div className="compare-row">
            <div className="compare-row-top">
              <div className="compare-tier">
                <span className="tier-letter">A</span>
                <span>
                  <span className="tier-name">{t("virtual_snapshot", "value_case_tier_a_name")}</span>
                  <span className="tier-sub">{t("virtual_snapshot", "value_case_tier_a_sub")}</span>
                </span>
              </div>
              <div className="compare-bar-track">
                <div className="compare-bar-fill" data-tier="A" style={{ width: "8%" }} />
              </div>
            </div>
            <div className="compare-chips">
              <span className="compare-chip">{t("virtual_snapshot", "value_case_chip_multi_service")}</span>
              <span className="compare-chip">{t("virtual_snapshot", "value_case_chip_specialist_access")}</span>
              <span className="compare-chip">{t("virtual_snapshot", "value_case_chip_project_visibility")}</span>
              <span className="compare-chip">{t("virtual_snapshot", "value_case_chip_coordination")}</span>
              <span className="compare-chip">{t("virtual_snapshot", "value_case_chip_curated_ecosystem")}</span>
              <span className="compare-chip">{t("virtual_snapshot", "value_case_chip_continuity")}</span>
              <span className="compare-chip">{t("virtual_snapshot", "value_case_chip_digital_platform")}</span>
              <span className="compare-chip">{t("virtual_snapshot", "value_case_chip_centralized_docs")}</span>
            </div>
          </div>

          <div className="compare-row">
            <div className="compare-row-top">
              <div className="compare-tier">
                <span className="tier-letter">B</span>
                <span>
                  <span className="tier-name">{t("virtual_snapshot", "value_case_tier_b_name")}</span>
                  <span className="tier-sub">{t("virtual_snapshot", "value_case_tier_b_sub")}</span>
                </span>
              </div>
              <div className="compare-bar-track">
                <div className="compare-bar-fill" data-tier="B" style={{ width: "25%" }} />
              </div>
            </div>
            <div className="compare-chips">
              <span className="compare-chip">{t("virtual_snapshot", "value_case_chip_local_presence")}</span>
            </div>
          </div>

          <div className="compare-row">
            <div className="compare-row-top">
              <div className="compare-tier">
                <span className="tier-letter">C</span>
                <span>
                  <span className="tier-name">{t("virtual_snapshot", "value_case_tier_c_name")}</span>
                  <span className="tier-sub">{t("virtual_snapshot", "value_case_tier_c_sub")}</span>
                </span>
              </div>
              <div className="compare-bar-track">
                <div className="compare-bar-fill" data-tier="C" style={{ width: "70%" }} />
              </div>
            </div>
            <div className="compare-chips">
              <span className="compare-chip">{t("virtual_snapshot", "value_case_chip_local_presence")}</span>
              <span className="compare-chip">{t("virtual_snapshot", "value_case_chip_specialist_access")}</span>
            </div>
          </div>

          <div className="compare-row">
            <div className="compare-row-top">
              <div className="compare-tier">
                <span className="tier-letter">D</span>
                <span>
                  <span className="tier-name">{t("virtual_snapshot", "value_case_tier_d_name")}</span>
                  <span className="tier-sub">{t("virtual_snapshot", "value_case_tier_d_sub")}</span>
                </span>
              </div>
              <div className="compare-bar-track">
                <div className="compare-bar-fill" data-tier="D" style={{ width: "96%" }} />
              </div>
            </div>
            <div className="compare-chips">
              <span className="compare-chip">{t("virtual_snapshot", "value_case_chip_local_presence")}</span>
              <span className="compare-chip">{t("virtual_snapshot", "value_case_chip_direct_oversight")}</span>
            </div>
          </div>
        </div>

        <div className="value-banner">
          <img className="value-banner-photo" src={valueBannerPhoto} alt="" />
          <div className="value-banner-copy">
            <h3>{t("virtual_snapshot", "value_case_banner_title")}</h3>
            <p>{t("virtual_snapshot", "value_case_banner_body")}</p>
            <div className="value-banner-chips">
              <span>{t("virtual_snapshot", "value_case_chip_digital_platform")}</span>
              <span>{t("virtual_snapshot", "value_case_banner_chip_specialist")}</span>
              <span>{t("virtual_snapshot", "value_case_banner_chip_visibility")}</span>
              <span>{t("virtual_snapshot", "value_case_banner_chip_continuity")}</span>
            </div>
          </div>
        </div>

        <div className="pdf-block">
          <div>
            <h3>{t("virtual_snapshot", "value_case_pdf_title")}</h3>
            <p>{t("virtual_snapshot", "value_case_pdf_body")}</p>
          </div>
          <span className="pdf-tag">{t("virtual_snapshot", "value_case_pdf_tag")}</span>
        </div>

        <div className="value-cta">
          <h2>{t("virtual_snapshot", "value_case_cta_title")}</h2>
          <button type="button" className="cta-btn value-cta-btn" onClick={scrollToPremium}>
            {t("virtual_snapshot", "value_case_cta_button")}
          </button>
          <p className="cta-disclosure">{t("virtual_snapshot", "value_case_cta_disclosure")}</p>
        </div>
      </div>
    </section>
  );
}
