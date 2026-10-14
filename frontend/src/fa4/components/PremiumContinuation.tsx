import { useState } from 'react';
import type { Locale } from '@beeside/fa-public-engine';
import { UI, fill } from '../copy/ui';
import type { YourExpansionViewModel } from '@beeside/fa-public-engine';

/** PremiumContinuation — next-step conversion. Shown with a CTA only when the result has real value (D-050); otherwise understanding is the deliverable. */
export function PremiumContinuation({ premium, locale, onContinue, onEmail, email, delivered }: {
  premium: YourExpansionViewModel['premium']; locale: Locale; email?: string; delivered?: boolean;
  onContinue?: () => Promise<boolean>; onEmail?: () => Promise<boolean>;
}) {
  const [cont, setCont] = useState<'idle' | 'confirm' | 'busy' | 'done' | 'err'>('idle');
  const [mail, setMail] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');
  return (
    <section className="sec" aria-labelledby="pc-title" data-testid="premium-continuation">
      {premium.shown ? (
        <div className="premium">
          <div>
            <p style={{ color: '#cfc5f1', fontSize: 13, fontWeight: 600 }}>{UI.nextStep[locale]}</p>
            <h2 id="pc-title" style={{ fontSize: 24, margin: '6px 0 8px' }}>{premium.headline[locale]}</h2>
            <p style={{ color: '#e5e0f7' }}>{UI.premiumBody[locale]}</p>
          </div>
          {cont === 'done'
            ? <p role="status">{UI.continued[locale]}</p>
            : cont === 'confirm' || cont === 'busy'
              ? <div role="group" aria-labelledby="pc-confirm-title" data-testid="start-confirm">
                  <h3 id="pc-confirm-title" style={{ fontSize: 17, margin: '0 0 6px' }}>{UI.confirmTitle[locale]}</h3>
                  <p style={{ color: '#e5e0f7', marginBottom: 12 }}>{UI.confirmBody[locale]}</p>
                  <div className="sheet-actions">
                    <button className="btn" disabled={cont === 'busy'} onClick={() => setCont('idle')}>{UI.confirmNo[locale]}</button>
                    <button className="btn primary" disabled={cont === 'busy'} aria-busy={cont === 'busy'} onClick={async () => { setCont('busy'); setCont((await onContinue?.()) ? 'done' : 'err'); }}>{UI.confirmYes[locale]}</button>
                  </div>
                </div>
              : <button className="btn" onClick={() => setCont('confirm')}>{UI.continueWith[locale]}</button>}
          {cont === 'err' && <><p className="state err on-dark" role="alert">{UI.saveError[locale]}</p><button className="btn" onClick={() => setCont('confirm')}>{UI.tryAgain[locale]}</button></>}
        </div>
      ) : (
        <div className="card soft"><h2 id="pc-title" style={{ fontSize: 20, marginBottom: 6 }}>{UI.noPremiumTitle[locale]}</h2><p>{UI.noPremiumBody[locale]}</p></div>
      )}
      <div className="pc-secondary">
        {mail === 'err' && <p className="state err" role="alert">{UI.emailFailed[locale]}</p>}
        {mail === 'done'
          ? <p className="state ok" role="status">{fill(UI.emailSent, locale, { email: email ?? '' })}</p>
          : <button className="btn ghost" disabled={mail === 'busy'} aria-busy={mail === 'busy'} onClick={async () => { setMail('busy'); setMail((await onEmail?.()) ? 'done' : 'err'); }}>{mail === 'busy' ? UI.emailSending[locale] : mail === 'err' ? UI.tryAgain[locale] : UI.emailResult[locale]}</button>}
        {!delivered && mail !== 'done' && <p className="hint">{UI.emailFinalNote[locale]}</p>}
        {delivered && <p className="hint" role="status">{UI.deliveredNote[locale]}</p>}
        <p className="hint pc-privacy">{UI.privacyNotice[locale]}</p>
      </div>
    </section>
  );
}
