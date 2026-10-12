import { useEffect, useId, useRef, useState } from 'react';
import type { Locale } from '@beeside/fa-public-engine';
import { UI, fill } from '../copy/ui';
import { CANONICAL_URLS, CONTACT_EMAIL } from '../brand';

/**
 * Presentation RC — persistent "Necesito ayuda" (external Help Center, new tab, D-137) and "Hablar con beeside" (D-138…D-140).
 * Help is a plain external link: no internal help page. Contact is a human request, visually separate from marketing:
 * it never touches marketingConsent. `onSend` is wired by Code to the CONTACT_REQUEST endpoint (CONTACT-4); until it is,
 * the dialog shows the honest error state — it never claims a message was sent.
 */
export const HELP_URL: Record<Locale, string> = {
  es: (import.meta.env.VITE_FA4_HELP_URL_ES as string | undefined) || CANONICAL_URLS.help,
  en: (import.meta.env.VITE_FA4_HELP_URL_EN as string | undefined) || CANONICAL_URLS.help,
};

export interface ContactPrefill { name: string; company: string; email: string }
export type ContactSend = (p: ContactPrefill & { message: string; shareProgress: boolean }) => Promise<boolean>;

const HelpIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6" /><path d="M12 17h.01" /></svg>;
const TalkIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 5h16v11H9l-5 4z" /></svg>;
const Ext = () => <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5" /></svg>;

/** Top-bar actions. Desktop: three text actions. Phone: Save stays visible; Help + Talk sit behind one compact "?" button. */
export function TopActions({ locale, onSave, prefill, onSend, saveSlot = true }: { locale: Locale; onSave?: () => void; prefill: ContactPrefill; onSend?: ContactSend; saveSlot?: boolean }) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  return (
    <div className="top-actions">
      <a className="ta-link ta-wide" href={HELP_URL[locale]} target="_blank" rel="noopener noreferrer"><HelpIcon />{UI.help[locale]}<Ext /><span className="sr-only"> {UI.helpNewTab[locale]}</span></a>
      <button type="button" className="ta-link ta-wide" onClick={() => setOpen(true)}><TalkIcon />{UI.talk[locale]}</button>
      {saveSlot && onSave && <button type="button" className="linkbtn ta-save" onClick={onSave}>{UI.saveLater[locale]}</button>}
      <div className="ta-narrow">
        <button type="button" className="ta-icon" aria-expanded={menu} aria-label={UI.menu[locale]} onClick={() => setMenu((x) => !x)}><HelpIcon /></button>
        {menu && (
          <div className="ta-menu" role="menu">
            <a role="menuitem" href={HELP_URL[locale]} target="_blank" rel="noopener noreferrer" onClick={() => setMenu(false)}><HelpIcon />{UI.help[locale]}<Ext /><span className="sr-only"> {UI.helpNewTab[locale]}</span></a>
            <button role="menuitem" type="button" onClick={() => { setMenu(false); setOpen(true); }}><TalkIcon />{UI.talk[locale]}</button>
          </div>
        )}
      </div>
      {open && <ContactDialog locale={locale} prefill={prefill} onSend={onSend} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function ContactDialog({ locale, prefill, onSend, onClose, initial = 'idle' }: { locale: Locale; prefill: ContactPrefill; onSend?: ContactSend; onClose: () => void; initial?: 'idle' | 'busy' | 'sent' | 'error' }) {
  const [f, setF] = useState(prefill); const [msg, setMsg] = useState(''); const [share, setShare] = useState(false);
  const [st, setSt] = useState(initial);
  const ref = useRef<HTMLDialogElement>(null); const tid = useId();
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal?.(); }, []);
  const ok = f.name.trim() && f.email.includes('@') && msg.trim();
  async function send() { setSt('busy'); setSt((await onSend?.({ ...f, message: msg, shareProgress: share })) ? 'sent' : 'error'); }
  return (
    <dialog ref={ref} className="sheet" aria-labelledby={tid} onClose={onClose} onCancel={onClose}>
      <div className="sheet-head"><h2 id={tid}>{UI.talkTitle[locale]}</h2><button type="button" className="ta-icon" aria-label={UI.close[locale]} onClick={onClose}>×</button></div>
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
