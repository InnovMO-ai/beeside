import { useState } from 'react';
import type { Locale } from '@beeside/fa-public-engine';
import { api } from '../api';
import { UI } from '../copy/ui';

/** Calm full-page states for a used / expired / invalid resume link and for a working session that closed. No raw errors, no technical wording. */
export function RecoveryScreen({ kind, locale, onNew }: { kind: 'link' | 'stale'; locale: Locale; onNew: () => void }) {
  const [email, setEmail] = useState(''); const [st, setSt] = useState<'idle' | 'busy' | 'done'>('idle');
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  async function ask() {
    if (!valid || st === 'busy') return;
    setSt('busy');
    try { await api.requestLink(email.trim()); } catch { /* the answer is identical either way (no account enumeration) */ }
    setSt('done');
  }
  const title = kind === 'link' ? UI.linkInvalidTitle : UI.staleTitle;
  const body = kind === 'link' ? UI.linkInvalidBody : UI.staleBody;
  return (
    <main className="main narrow" role="alert" id="main">
      <h1 className="h1">{title[locale]}</h1>
      <p className="lead">{body[locale]}</p>
      {st === 'done' ? <p className="state ok" role="status">{UI.linkRequested[locale]}</p> : (
        <div className="recovery-form">
          <label><span className="label">{UI.email[locale]}</span>
            <input className="field" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void ask(); }} /></label>
          <div className="sheet-actions">
            <button type="button" className="btn primary" disabled={!valid || st === 'busy'} aria-busy={st === 'busy'} onClick={ask}>{UI.linkRequest[locale]}</button>
            <button type="button" className="btn" onClick={onNew}>{UI.startNew[locale]}</button>
          </div>
        </div>
      )}
    </main>
  );
}
