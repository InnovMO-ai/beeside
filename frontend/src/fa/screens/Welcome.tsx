import { T } from "../copy";

export function Welcome({ t, onStart }: { t: T; onStart: () => void }) {
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <div>
        <p className="eyebrow">{t("welcome", "eyebrow")}</p>
        <h1 className="display" id="welcome-title">
          {t("welcome", "headline")}
        </h1>
        <p className="lead">{t("welcome", "body")}</p>
        <div className="actions" style={{ marginTop: 0 }}>
          <button type="button" className="button button-primary" onClick={onStart}>
            {t("welcome", "cta")}
          </button>
        </div>
        <p className="helper">{t("welcome", "support")}</p>
        <p className="helper" style={{ marginTop: "2.5rem", color: "var(--ink)" }}>
          {t("welcome", "brand_statement")}
        </p>
      </div>
      <div className="welcome-visual" aria-hidden="true" />
    </section>
  );
}
