import { useEffect, useRef, useState } from "react";
import { track } from "../analytics";
import { api } from "../api";
import { formatDate } from "../copy";
import { Locale, PremiumActivationResult, PremiumContent, PremiumStatus } from "../types";

/** Where the Premium state comes from: the working session, or a verified private link. */
export interface PremiumSource {
  loadStatus: () => Promise<PremiumStatus>;
  activate: (acceptTerms: boolean) => Promise<PremiumActivationResult>;
  loadContent?: () => Promise<PremiumContent>;
}

type Stage = "offer" | "consideration" | "activation" | "result";

/**
 * Post-Snapshot experience (Functional Specification v1 §16): two paths — the external Preview Room
 * and "Continue with Premium" on this same project. Premium adds validation, precision, definition
 * and accompaniment; it never hides or re-reveals Snapshot results, and no price is shown.
 */
export function PremiumTransition({ locale, source }: { locale: Locale; source: PremiumSource }) {
  const [content, setContent] = useState<PremiumContent | null>(null);
  const [status, setStatus] = useState<PremiumStatus | null>(null);
  const [stage, setStage] = useState<Stage>("offer");
  const [activated, setActivated] = useState(false);
  const [accept, setAccept] = useState(false);
  const [termsMissing, setTermsMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const interacted = useRef(false);

  useEffect(() => {
    let active = true;
    Promise.all([(source.loadContent ?? api.premiumContent)(), source.loadStatus()])
      .then(([loadedContent, loadedStatus]) => {
        if (!active) return;
        setContent(loadedContent);
        setStatus(loadedStatus);
      })
      // Premium is an optional next step: if it cannot load, the Snapshot stays exactly as it is.
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!interacted.current) return;
    headingRef.current?.focus();
    if (stage === "consideration") track({ type: "premium_consideration_viewed", interfaceLanguage: locale });
    if (stage === "activation") track({ type: "premium_activation_viewed", interfaceLanguage: locale });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  if (!content || !status || !status.available) return null;
  const copy = content.copy[locale];
  const reactivation = status.canReactivate;

  const go = (next: Stage) => {
    interacted.current = true;
    setFailed(false);
    setTermsMissing(false);
    setStage(next);
  };

  const activate = async () => {
    if (!accept) {
      setTermsMissing(true);
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      const result = await source.activate(true);
      setStatus(result.status);
      setActivated(result.outcome.kind === "activated" || result.status.accessActive);
      go("result");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const heading = (text: string) => (
    <h2 className="premium-headline" ref={headingRef} tabIndex={-1}>
      {text}
    </h2>
  );

  let body: React.ReactNode;
  if (stage === "result") {
    body = (
      <div className="premium-status" role="status">
        {heading(activated ? copy.result.active_title : copy.result.pending_title)}
        <p>{activated ? copy.result.active_body : copy.result.pending_body}</p>
      </div>
    );
  } else if (status.pendingRequest) {
    body = (
      <div className="premium-status">
        {heading(copy.status.pending_title)}
        <p>{copy.status.pending_body}</p>
      </div>
    );
  } else if (status.accessActive) {
    body = (
      <div className="premium-status">
        {heading(copy.status.active_title)}
        <p>{copy.status.active_body}</p>
        {status.accessUntil && <p>{copy.status.scheduled_body.replace("{{until}}", formatDate(status.accessUntil, locale))}</p>}
      </div>
    );
  } else if (stage === "activation") {
    body = (
      <>
        {heading(copy.activation.title)}
        <ul className="premium-points">
          {copy.activation.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <label className="check premium-terms" htmlFor="premium-terms">
          <input
            id="premium-terms"
            type="checkbox"
            checked={accept}
            aria-invalid={termsMissing || undefined}
            aria-describedby={termsMissing ? "premium-terms-error" : undefined}
            onChange={(e) => {
              setAccept(e.target.checked);
              if (e.target.checked) setTermsMissing(false);
            }}
          />
          <span>
            {copy.activation.terms_prefix}{" "}
            <a href={content.termsUrl} target="_blank" rel="noopener noreferrer">
              {copy.activation.terms_label}
              <span className="visually-hidden"> {copy.transition.new_tab}</span>
            </a>
          </span>
        </label>
        {termsMissing && (
          <p className="field-error" id="premium-terms-error" role="alert">
            {copy.activation.terms_required}
          </p>
        )}
        {failed && (
          <p className="field-error" role="alert">
            {copy.activation.error}
          </p>
        )}
        <div className="actions">
          <button type="button" className="button button-primary" disabled={busy} onClick={() => void activate()}>
            {reactivation ? copy.activation.reactivate_cta : copy.activation.activate_cta}
          </button>
          <button type="button" className="button button-text" onClick={() => go(reactivation ? "offer" : "consideration")}>
            {copy.activation.back}
          </button>
        </div>
      </>
    );
  } else if (reactivation) {
    body = (
      <div className="premium-status">
        {heading(copy.status.lapsed_title)}
        <p>{copy.status.lapsed_body}</p>
        <div className="actions">
          <button type="button" className="button button-primary" onClick={() => go("activation")}>
            {copy.activation.reactivate_cta}
          </button>
        </div>
      </div>
    );
  } else if (stage === "consideration") {
    body = (
      <>
        <p className="eyebrow">{copy.consideration.eyebrow}</p>
        {heading(copy.consideration.title)}
        <p className="premium-body">{copy.consideration.intro}</p>
        <ul className="premium-pillars">
          {copy.consideration.pillars.map((pillar) => (
            <li key={pillar.key} className="premium-pillar">
              <h3>{pillar.title}</h3>
              <p>{pillar.body}</p>
            </li>
          ))}
        </ul>
        <div className="premium-outcomes">
          <h3>{copy.consideration.outcomes_title}</h3>
          <ul>
            {copy.consideration.outcomes.map((outcome) => (
              <li key={outcome}>{outcome}</li>
            ))}
          </ul>
        </div>
        <p className="premium-line">{copy.consideration.candidate_line}</p>
        <div className="actions">
          <button type="button" className="button button-primary" onClick={() => go("activation")}>
            {copy.consideration.next_cta}
          </button>
          <button type="button" className="button button-text" onClick={() => go("offer")}>
            {copy.consideration.back}
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <p className="eyebrow">{copy.transition.eyebrow}</p>
        {heading(copy.transition.headline)}
        <p className="premium-body">{copy.transition.body}</p>
        <div className="actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              track({ type: "premium_continue_clicked", interfaceLanguage: locale });
              go("consideration");
            }}
          >
            {copy.transition.continue_cta}
          </button>
          <a
            className="button button-secondary"
            href={content.previewRoomUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track({ type: "preview_room_clicked", interfaceLanguage: locale })}
          >
            {copy.transition.explore_cta}
            <span className="visually-hidden"> {copy.transition.new_tab}</span>
          </a>
        </div>
        <p className="premium-helper">{copy.transition.explore_helper}</p>
      </>
    );
  }

  return (
    <section className="premium-transition" aria-label={copy.consideration.eyebrow} data-stage={stage}>
      {body}
    </section>
  );
}
