import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Locale } from '@beeside/fa-public-engine';
import { api } from '../api';
import { UI } from '../copy/ui';

/** Calm full-page states for a used / expired / invalid resume link and for a working session that closed. No raw errors, no technical wording. */
type EmailRef = RefObject<HTMLInputElement>;
type MsgRef = RefObject<HTMLParagraphElement>;

/** E-mail + «send me a new link». The answer is the SAME neutral message for known and unknown addresses (no account enumeration). Shared by the recovery screen and the cover dialog (DSC-38). */
export function LinkRequestForm({ locale, secondary, emailRef, resultRef }: { locale: Locale; secondary: ReactNode; emailRef?: EmailRef; resultRef?: MsgRef }) {
  const [email, setEmail] = useState(''); const [st, setSt] = useState<'idle' | 'busy' | 'done'>('idle');
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const own = useRef<HTMLParagraphElement>(null); const msg = resultRef ?? own;
  useEffect(() => { if (st === 'done') msg.current?.focus(); }, [st, msg]);
  async function ask() {
    if (!valid || st === 'busy') return;
    setSt('busy');
    try { await api.requestLink(email.trim()); } catch { /* the answer is identical either way (no account enumeration) */ }
    setSt('done');
  }
  return st === 'done' ? <p className="state ok" role="status" tabIndex={-1} ref={msg}>{UI.linkRequested[locale]}</p> : (
    <div className="recovery-form">
      <label><span className="label">{UI.email[locale]}</span>
        <input ref={emailRef} className="field" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void ask(); }} /></label>
      <div className="sheet-actions">
        <button type="button" className="btn primary" disabled={!valid || st === 'busy'} aria-busy={st === 'busy'} onClick={ask}>{UI.linkRequest[locale]}</button>
        {secondary}
      </div>
    </div>
  );
}

/** DSC-38 — «Already started? Get a link to continue», a modal over the cover. Title = the link phrase; initial focus on the e-mail; Escape returns to the link. */
export function ContinueLinkDialog({ locale, open, onClose }: { locale: Locale; open: boolean; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const email = useRef<HTMLInputElement>(null);
  const result = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const d = dlg.current; if (!d) return;
    if (open && !d.open) { d.showModal(); email.current?.focus(); }
    if (!open && d.open) d.close();
  }, [open]);
  const titleId = useId();
  return (
    <dialog ref={dlg} className="sheet" aria-labelledby={titleId} onClose={onClose} onCancel={onClose} data-testid="continue-link-dialog">
      {open && (
        <>
          <div className="sheet-head"><h2 id={titleId}>{UI.continueLinkCta[locale]}</h2><button type="button" className="ha-x" aria-label={UI.close[locale]} onClick={onClose}>×</button></div>
          <div className="sheet-body">
            <LinkRequestForm locale={locale} emailRef={email} resultRef={result} secondary={<button type="button" className="btn" onClick={onClose}>{UI.close[locale]}</button>} />
          </div>
        </>
      )}
    </dialog>
  );
}

export function RecoveryScreen({ kind, locale, onNew }: { kind: 'link' | 'stale'; locale: Locale; onNew: () => void }) {
  const title = kind === 'link' ? UI.linkInvalidTitle : UI.staleTitle;
  const body = kind === 'link' ? UI.linkInvalidBody : UI.staleBody;
  return (
    <main className="main narrow" role="alert" id="main">
      <h1 className="h1">{title[locale]}</h1>
      <p className="lead">{body[locale]}</p>
      <LinkRequestForm locale={locale} secondary={<button type="button" className="btn" onClick={onNew}>{UI.startNew[locale]}</button>} />
    </main>
  );
}

export type IdlePhase = 'sending' | 'sent' | 'failed' | 'failedNoRetry' | 'unauthorized';

/**
 * DSC-36 — after 30 min of inactivity: the project is kept, ONE secure link is e-mailed to the registered address, and this screen says so with the REAL state of the delivery.
 * The address is never shown. No «continue here»: the tab no longer holds the project (continuing is only through the link).
 */
export function IdleContinuation({ phase, locale, onRetry, onNew }: { phase: IdlePhase; locale: Locale; onRetry: () => void; onNew: () => void }) {
  const h1 = useRef<HTMLHeadingElement>(null);
  useEffect(() => { h1.current?.focus({ preventScroll: true }); }, [phase]);
  const msg = phase === 'sent' ? UI.idleSent : phase === 'unauthorized' ? UI.idleNotAuthorized : phase === 'sending' ? null : UI.idleFailed;
  return (
    <main className="main narrow" id="main" data-testid="idle-continuation" data-phase={phase}>
      <h1 className="h1" tabIndex={-1} ref={h1}>{(phase === 'sending' ? UI.idleSending : UI.idleTitle)[locale]}</h1>
      {msg && <p className="lead" role="status" aria-live="polite">{msg[locale]}</p>}
      {phase === 'sending' && <p className="sr-only" role="status" aria-busy="true">{UI.idleSending[locale]}</p>}
      <div className="sheet-actions">
        {phase === 'failed' && <button type="button" className="btn primary" onClick={onRetry}>{UI.idleRetry[locale]}</button>}
        <button type="button" className="btn" onClick={onNew}>{UI.idleNewProject[locale]}</button>
      </div>
    </main>
  );
}
