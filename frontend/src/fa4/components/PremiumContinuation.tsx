import { useState } from 'react';
import type { Locale } from '@beeside/fa-public-engine';
import { UI } from '../copy/ui';
import type { YourExpansionViewModel } from '@beeside/fa-public-engine';

/** PremiumContinuation — next-step conversion. Shown with a CTA only when the result has real value (D-050); otherwise understanding is the deliverable. */
export function PremiumContinuation({ premium, locale, onContinue, onEmail }: {
  premium: YourExpansionViewModel['premium']; locale: Locale;
  onContinue?: () => Promise<boolean>; onEmail?: () => Promise<boolean>;
}) {
  const [cont, setCont] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');
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
            : <button className="btn" disabled={cont === 'busy'} onClick={async () => { setCont('busy'); setCont((await onContinue?.()) ? 'done' : 'err'); }}>{UI.continueWith[locale]}</button>}
          {cont === 'err' && <p role="alert">{UI.saveError[locale]}</p>}
        </div>
      ) : (
        <div className="card soft"><h2 id="pc-title" style={{ fontSize: 20, marginBottom: 6 }}>{UI.noPremiumTitle[locale]}</h2><p>{UI.noPremiumBody[locale]}</p></div>
      )}
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
        {mail === 'done' ? <p role="status">{UI.emailed[locale]}</p>
          : <button className="btn ghost" disabled={mail === 'busy'} onClick={async () => { setMail('busy'); setMail((await onEmail?.()) ? 'done' : 'err'); }}>{UI.emailResult[locale]}</button>}
        <p className="hint" style={{ flex: 1, minWidth: 220 }}>{UI.privacyNotice[locale]}</p>
      </div>
    </section>
  );
}
