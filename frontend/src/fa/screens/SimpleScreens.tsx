import { FormEvent, useState } from "react";
import { api } from "../api";
import { LegalConsent } from "../components/LegalConsent";
import { formatDate, T } from "../copy";
import { Bundle, Locale } from "../types";

export function ExistingEmail({ t, onUseOtherEmail }: { t: T; onUseOtherEmail: () => void }) {
  return (
    <section className="content" aria-labelledby="existing-title">
      <h1 className="display" id="existing-title">
        {t("existing_email", "title")}
      </h1>
      <p className="lead">{t("existing_email", "body")}</p>
      <p className="note" role="status">
        {t("existing_email", "sent")}
      </p>
      <div className="actions">
        <button type="button" className="button button-secondary" onClick={onUseOtherEmail}>
          {t("existing_email", "use_other_email")}
        </button>
      </div>
    </section>
  );
}

export function FinishLaterConfirmation({ t, locale, accessUntil, onKeepGoing }: { t: T; locale: Locale; accessUntil: string | null; onKeepGoing: () => void }) {
  return (
    <section className="content" aria-labelledby="finish-title">
      <h1 className="display" id="finish-title">
        {t("finish_later", "title")}
      </h1>
      <p className="lead">{t("finish_later", "body")}</p>
      {accessUntil && <p className="helper">{t("access", "extended", { access_until: formatDate(accessUntil, locale) })}</p>}
      <div className="actions">
        <button type="button" className="button button-secondary" onClick={onKeepGoing}>
          {t("finish_later", "keep_going")}
        </button>
      </div>
    </section>
  );
}

export function Completion({
  bundle,
  t,
  anotherProjectInMind,
  onStartAnother,
  intro = true,
}: {
  bundle: Bundle;
  t: T;
  anotherProjectInMind: boolean;
  onStartAnother: () => Promise<void>;
  /** False when rendered beneath the Snapshot, which already closes the assessment. */
  intro?: boolean;
}) {
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(false);

  async function start(event: FormEvent) {
    event.preventDefault();
    if (!accept) {
      setError(true);
      return;
    }
    setBusy(true);
    setFailure(false);
    try {
      await onStartAnother();
    } catch {
      setFailure(true);
      setBusy(false);
    }
  }

  return (
    <section className="content" aria-labelledby={intro ? "completion-title" : undefined}>
      {intro && (
        <>
          <h1 className="display" id="completion-title">
            {t("completion", "title")}
          </h1>
          <p className="lead">{t("completion", "body")}</p>
        </>
      )}
      {anotherProjectInMind && (
        <form onSubmit={start} noValidate style={{ marginTop: "3rem" }}>
          <h2 className="step-title">{t("completion", "another_title")}</h2>
          <p>{t("completion", "another_body")}</p>
          <LegalConsent id="another-legal" bundle={bundle} t={t} checked={accept} onChange={(v) => { setAccept(v); setError(false); }} error={error} />
          {failure && (
            <p className="field-error" role="alert">
              {t("common", "generic_error")}
            </p>
          )}
          <div className="actions">
            <button type="submit" className="button button-primary" disabled={busy}>
              {t("completion", "another_cta")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

export function RequestLink({ t, title, body }: { t: T; title: string; body: string }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [invalid, setInvalid] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    try {
      await api.requestLink(email.trim());
    } catch {
      // The answer is intentionally the same either way (no account enumeration).
    }
    setSent(true);
  }

  return (
    <section className="content" aria-labelledby="request-title">
      <h1 className="display" id="request-title">
        {title}
      </h1>
      <p className="lead">{body}</p>
      {sent ? (
        <p className="note" role="status">
          {t("resume", "sent")}
        </p>
      ) : (
        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="request-email">{t("resume", "email_label")}</label>
            <input
              id="request-email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? "request-email-error" : undefined}
              onChange={(e) => setEmail(e.target.value)}
            />
            {invalid && (
              <p className="field-error" id="request-email-error">
                {t("identity", "email_invalid")}
              </p>
            )}
          </div>
          <div className="actions">
            <button type="submit" className="button button-primary">
              {t("resume", "request_link")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
