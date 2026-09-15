import { FormEvent, useEffect, useRef, useState } from "react";
import { FeedbackInput, FeedbackStatus } from "../api";
import { Locale } from "../types";

/**
 * Post-Snapshot feedback (Functional Specification — Phase 12). It appears only after the Snapshot
 * has been delivered, asks one frozen question with a 1–5 scale plus an optional comment, and is
 * answered once. It never interrupts the Snapshot: if it cannot load, nothing is shown.
 */

export interface FeedbackSource {
  load: () => Promise<FeedbackStatus>;
  submit: (input: FeedbackInput) => Promise<FeedbackStatus>;
}

const SCALE = [1, 2, 3, 4, 5];
const COMMENT_MAX = 2000;

export function SnapshotFeedback({ locale, source }: { locale: Locale; source: FeedbackSource }) {
  const [status, setStatus] = useState<FeedbackStatus | null>(null);
  const [usefulness, setUsefulness] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const thanksRef = useRef<HTMLParagraphElement>(null);
  const submitted = useRef(false);

  useEffect(() => {
    let active = true;
    source
      .load()
      .then((result) => active && setStatus(result))
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (submitted.current && status?.submitted) thanksRef.current?.focus();
  }, [status?.submitted]);

  if (!status || !status.available) return null;
  const copy = status.copy[locale] ?? status.copy.en;

  if (status.submitted) {
    return (
      <section className="feedback" aria-labelledby="feedback-title">
        <h2 className="feedback-title" id="feedback-title">
          {copy.question}
        </h2>
        <p className="feedback-thanks" role="status" tabIndex={-1} ref={thanksRef}>
          {copy.thanks}
        </p>
      </section>
    );
  }

  const send = async (event: FormEvent) => {
    event.preventDefault();
    setFailed(false);
    if (usefulness === null) {
      setMissing(true);
      return;
    }
    setBusy(true);
    try {
      submitted.current = true;
      setStatus(await source.submit({ usefulness, comment: comment.trim() === "" ? null : comment.trim() }));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="feedback" aria-labelledby="feedback-title">
      <form onSubmit={(event) => void send(event)}>
        <fieldset className="feedback-scale">
          <legend className="feedback-title" id="feedback-title">
            {copy.question}
          </legend>
          <div className="feedback-options" role="radiogroup" aria-describedby="feedback-scale-hint" aria-invalid={missing || undefined}>
            {SCALE.map((value) => (
              <label key={value} className="feedback-option">
                <input
                  type="radio"
                  name="usefulness"
                  value={value}
                  checked={usefulness === value}
                  onChange={() => {
                    setUsefulness(value);
                    setMissing(false);
                  }}
                />
                <span aria-hidden="true">{value}</span>
                <span className="visually-hidden">
                  {value} {value === 1 ? copy.scale_min : value === 5 ? copy.scale_max : ""}
                </span>
              </label>
            ))}
          </div>
          <p className="helper feedback-hint" id="feedback-scale-hint">
            <span>1 {copy.scale_min}</span>
            <span aria-hidden="true"> → </span>
            <span>5 {copy.scale_max}</span>
          </p>
          {missing && (
            <p className="field-error" role="alert">
              {copy.rating_required}
            </p>
          )}
        </fieldset>
        <div className="field">
          <label htmlFor="feedback-comment">
            {copy.comment_label}
            <span className="optional-tag"> · {copy.optional}</span>
          </label>
          <textarea
            id="feedback-comment"
            className="input"
            rows={3}
            maxLength={COMMENT_MAX}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </div>
        {failed && (
          <p className="field-error" role="alert">
            {copy.error}
          </p>
        )}
        <div className="actions">
          <button type="submit" className="button button-secondary" disabled={busy}>
            {copy.submit}
          </button>
        </div>
      </form>
    </section>
  );
}
