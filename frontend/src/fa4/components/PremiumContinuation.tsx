import { useState } from 'react';
import type { Locale } from '@beeside/fa-public-engine';
import { UI, fill } from '../copy/ui';
import { PREMIUM_PURCHASE_URL, PURCHASE_FALLBACK_ALLOWED } from '../brand';
import type { YourExpansionViewModel } from '@beeside/fa-public-engine';

/** PremiumContinuation — next-step conversion. Shown with a CTA only when the result has real value (D-050); otherwise understanding is the deliverable. */
export function PremiumContinuation({ premium, locale, onContinue, onEmail, email, delivered, purchaseUrl = PREMIUM_PURCHASE_URL, fallbackAllowed = PURCHASE_FALLBACK_ALLOWED }: {
  purchaseUrl?: string | null; fallbackAllowed?: boolean;
  premium: YourExpansionViewModel['premium']; locale: Locale; email?: string; delivered?: boolean;
  onContinue?: () => Promise<boolean>; onEmail?: () => Promise<boolean | 'unauthorized'>;
}) {
  const [cont, setCont] = useState<'idle' | 'confirm' | 'busy' | 'done' | 'err'>('idle');
  const [mail, setMail] = useState<'idle' | 'busy' | 'done' | 'err' | 'unauth'>('idle');
  return (
    <section className="sec" aria-labelledby="pc-title" data-testid="premium-continuation">
      {premium.shown ? (
        <div className="premium">
          <div>
            <p className="pc-eyebrow">{UI.nextStep[locale]}</p>
            <h2 id="pc-title" className="pc-title">{UI.premiumTitle[locale]}</h2>
            <p className="pc-body">{UI.premiumBody[locale]}</p>
          </div>
          {!purchaseUrl && !fallbackAllowed ? null : cont === 'done'
            ? <p role="status">{purchaseUrl ? UI.continuedPay[locale] : UI.continued[locale]}</p>
            : cont === 'confirm' || cont === 'busy'
              ? <div role="group" aria-labelledby="pc-confirm-title" data-testid="start-confirm">
                  <h3 id="pc-confirm-title" className="pc-confirm-title">{UI.confirmTitle[locale]}</h3>
                  <p className="pc-confirm-body">{purchaseUrl ? UI.confirmBodyPay[locale] : UI.confirmBody[locale]}</p>
                  <div className="sheet-actions">
                    <button className="btn" disabled={cont === 'busy'} onClick={() => setCont('idle')}>{UI.confirmNo[locale]}</button>
                    <button className="btn primary" disabled={cont === 'busy'} aria-busy={cont === 'busy'} onClick={async () => { setCont('busy'); const ok = await onContinue?.(); if (ok && purchaseUrl) { setCont('done'); window.location.assign(purchaseUrl); } else setCont(ok ? 'done' : 'err'); }}>{purchaseUrl ? UI.confirmGo[locale] : UI.confirmYes[locale]}</button>
                  </div>
                </div>
              : <button className="btn pc-cta" onClick={() => setCont('confirm')}>{UI.continueWith[locale]}<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>}
          {cont === 'err' && <><p className="state err on-dark" role="alert">{UI.saveError[locale]}</p><button className="btn" onClick={() => setCont('confirm')}>{UI.tryAgain[locale]}</button></>}
        </div>
      ) : (
        <div className="card soft"><h2 id="pc-title" style={{ fontSize: 20, marginBottom: 6 }}>{UI.noPremiumTitle[locale]}</h2><p>{UI.noPremiumBody[locale]}</p></div>
      )}
      <div className="pc-secondary">
        {mail === 'err' && <p className="state err" role="alert">{UI.emailFailed[locale]}</p>}
        {mail === 'unauth' && <p className="state" role="status" data-testid="email-not-authorized">{UI.emailNotAuthorized[locale]}</p>}
        {mail === 'done'
          ? <p className="state ok" role="status">{fill(UI.emailSent, locale, { email: email ?? '' })}</p>
          : mail === 'unauth' ? null : <button className="btn ghost" disabled={mail === 'busy'} aria-busy={mail === 'busy'} onClick={async () => { setMail('busy'); const r = await onEmail?.(); setMail(r === 'unauthorized' ? 'unauth' : r ? 'done' : 'err'); }}>{mail === 'busy' ? UI.emailSending[locale] : mail === 'err' ? UI.tryAgain[locale] : UI.emailResult[locale]}</button>}
        {!delivered && mail !== 'done' && <p className="hint">{UI.emailFinalNote[locale]}</p>}
        {delivered && <p className="hint" role="status">{UI.deliveredNote[locale]}</p>}
        <p className="hint pc-privacy">{UI.privacyNotice[locale]}</p>
      </div>
    </section>
  );
}
