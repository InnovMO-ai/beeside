import { useEffect, useId, useRef, useState } from 'react';
import type { Locale } from '@beeside/fa-public-engine';
import { UI, fill } from '../copy/ui';
import { CONTACT_EMAIL } from '../brand';
import type { HelpFlags, HelpScreen } from '../copy/help';
import { HELP_URL } from './helpUrl';
import { HelpMenu } from './HelpMenu';

/**
 * Help and contact. DSC-37 (Product, 2026-10-21): ONE help menu replaces the loose desktop links and the phone «?» menu (see HelpMenu). «Talk to beeside» exists only in the YEV and is a
 * plain mailto: link to contact@beeside.you (D14, PD-31); in the form there is no contact option. The contact DIALOG below is no longer reachable from any menu; it is KEPT because the
 * «Talk to beeside» link of the e-mailed YEV (`contact=open`) still opens it, and it is not deleted (handoff).
 */
export { HELP_URL };

export interface ContactPrefill { name: string; company: string; email: string }
export type ContactSend = (p: ContactPrefill & { message: string; shareProgress: boolean; clientRequestId: string }) => Promise<boolean>;

const Ext = () => <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5" /></svg>;

/** YEV footer: «I need help» (external, new tab) and «Talk to beeside» as a mailto: link (no dialog). */
export function HelpTalkLinks({ locale, onHelp }: { locale: Locale; onHelp?: () => void }) {
  return (
    <div className="help-talk">
      <a className="linkbtn" href={HELP_URL[locale]} target="_blank" rel="noopener noreferrer" onClick={onHelp}>{UI.help[locale]}<Ext /><span className="sr-only"> {UI.helpNewTab[locale]}</span></a>
      <a className="linkbtn" href={`mailto:${CONTACT_EMAIL}`}>{UI.talk[locale]}</a>
    </div>
  );
}

/** Top-bar actions of the FORM screens: «Save and continue later» (when the project exists) + the help menu. */
export function TopActions({ locale, onSave, saveSlot = true, helpScreen, helpFlags, resetKey, onHelp, withHelp = true }: { locale: Locale; onSave?: () => void; saveSlot?: boolean; helpScreen: HelpScreen; helpFlags: HelpFlags; resetKey?: string; onHelp?: () => void; withHelp?: boolean }) {
  return (
    <div className="top-actions">
      {saveSlot && onSave && <button type="button" className="linkbtn ta-save" onClick={onSave}>{UI.saveLater[locale]}</button>}
      {withHelp && <HelpMenu locale={locale} variant="form" screen={helpScreen} flags={helpFlags} resetKey={resetKey} onHelpLink={onHelp} />}
    </div>
  );
}

export function ContactDialog({ locale, prefill, onSend, onClose, initial = 'idle' }: { locale: Locale; prefill: ContactPrefill; onSend?: ContactSend; onClose: () => void; initial?: 'idle' | 'busy' | 'sent' | 'error' }) {
  const [f, setF] = useState(prefill); const [msg, setMsg] = useState(''); const [share, setShare] = useState(false);
  const [st, setSt] = useState(initial);
  const ref = useRef<HTMLDialogElement>(null); const tid = useId();
  const requestId = useRef(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);   // same form → same id: a retry / double click is idempotent
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal?.(); }, []);
  const ok = f.name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim()) && msg.trim().length >= 3;
  async function send() {
    if (st === 'busy') return;   // duplicate clicks while a send is in flight do nothing
    setSt('busy'); setSt((await onSend?.({ ...f, message: msg, shareProgress: share, clientRequestId: requestId.current })) ? 'sent' : 'error');
  }
  return (
    <dialog ref={ref} className="sheet" aria-labelledby={tid} onClose={onClose} onCancel={onClose}>
      <div className="sheet-head"><h2 id={tid}>{UI.talkTitle[locale]}</h2><button type="button" className="ha-x" aria-label={UI.close[locale]} onClick={onClose}>×</button></div>
      {st === 'sent' ? (
        <div className="sheet-body"><p className="state ok" role="status">{fill(UI.talkSent, locale, { email: f.email })}</p><button type="button" className="btn" onClick={onClose}>{UI.close[locale]}</button></div>
      ) : (
        <div className="sheet-body">
          <p className="lead">{fill(UI.talkLead, locale, { contact: CONTACT_EMAIL })}</p>
          <div className="two-f">
            <label><span className="label">{UI.name[locale]}</span><input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></label>
            <label><span className="label">{UI.company[locale]}</span><input className="field" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} autoComplete="organization" /></label>
          </div>
          <label><span className="label">{UI.email[locale]}</span><input className="field" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></label>
          <label><span className="label">{UI.talkMessage[locale]}</span><textarea className="field" value={msg} onChange={(e) => setMsg(e.target.value)} /></label>
          <label className={`choice ${share ? 'on' : ''}`} style={{ marginTop: 14 }}><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /><span>{UI.talkShare[locale]}</span></label>
          {st === 'error' && <p className="state err" role="alert">{UI.talkError[locale]}</p>}
          <div className="sheet-actions"><button type="button" className="btn" onClick={onClose}>{UI.close[locale]}</button><button type="button" className="btn primary" disabled={!ok || st === 'busy'} onClick={send}>{st === 'busy' ? UI.talkSending[locale] : UI.talkSend[locale]}</button></div>
          <p className="hint">{UI.talkNote[locale]}</p>
        </div>
      )}
    </dialog>
  );
}
