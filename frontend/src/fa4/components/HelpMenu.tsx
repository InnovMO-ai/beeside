import { useEffect, useId, useRef, useState } from 'react';
import type { Locale } from '@beeside/fa-public-engine';
import { UI } from '../copy/ui';
import { HELP, helpIdsFor, type HelpFlags, type HelpId, type HelpScreen } from '../copy/help';
import { CONTACT_EMAIL } from '../brand';
import { HELP_URL } from './helpUrl';

/**
 * DSC-37 · the ONE help menu (replaces the loose desktop links and the phone «?» menu). A button that opens a NON-modal panel anchored to it:
 *  - «About this screen» (only when the screen has enabled entries): expandable questions, independent, all closed every time it opens;
 *  - «I need help» (external Help Center, new tab);
 *  - «Talk to beeside» ONLY in the YEV, as a plain mailto: link (never in the form, PD-31).
 * Closes with Escape (focus back to the trigger), the × button, a click outside, Tab leaving the panel, and when the screen changes (`resetKey`).
 * Accessibility: trigger aria-expanded/aria-controls; the panel is a named region (its title); title H2 → section H3 → each question an H4 button with aria-expanded/aria-controls.
 */
const Chev = () => <svg className="ha-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>;
const QIcon = () => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4M12 17h.01" /></svg>;
const Ext = () => <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5" /></svg>;

export function HelpMenu({ locale, variant, screen, flags, resetKey, onHelpLink }: { locale: Locale; variant: 'form' | 'yev'; screen: HelpScreen; flags: HelpFlags; resetKey?: string; onHelpLink?: () => void }) {
  const ids = helpIdsFor(screen, flags);
  const label = (variant === 'yev' ? UI.helpMenuYev : UI.helpMenuForm)[locale];
  const [open, setOpen] = useState(false); const [openQ, setOpenQ] = useState<ReadonlySet<HelpId>>(new Set());
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId(); const titleId = useId(); const qid = useId();
  const close = (refocus = false) => { setOpen(false); setOpenQ(new Set()); if (refocus) trigger.current?.focus(); };
  useEffect(() => { setOpen(false); setOpenQ(new Set()); }, [resetKey, screen]);                       // a new screen: the panel closes and its entries are recalculated
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) close(); };
    document.addEventListener('pointerdown', down); return () => document.removeEventListener('pointerdown', down);
  }, [open]);
  const toggleQ = (id: HelpId) => setOpenQ((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className={`help-menu hm-${variant}`} ref={root}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); close(true); } }}
      onBlur={(e) => { if (open && e.relatedTarget && !root.current?.contains(e.relatedTarget as Node)) close(); }}>
      <button type="button" ref={trigger} className="ha-trigger" aria-expanded={open} aria-controls={panelId} aria-label={label} onClick={() => (open ? close() : setOpen(true))}>
        <QIcon /><span className="ha-lbl" aria-hidden>{label}</span><Chev />
      </button>
      {open && (
        <section id={panelId} role="region" aria-labelledby={titleId} className="ha-panel" data-testid="help-panel">
          <div className="ha-head"><h2 id={titleId}>{label}</h2><button type="button" className="ha-x" aria-label={UI.close[locale]} onClick={() => close(true)}>×</button></div>
          <div className="ha-body">
            {ids.length > 0 && (<>
              <h3 className="ha-ctx">{UI.helpAbout[locale]}</h3>
              <ul className="ha-faq">
                {ids.map((id) => {
                  const e = HELP[id]; const isOpen = openQ.has(id); const aid = `${qid}-${id}`;
                  return (
                    <li key={id}>
                      <h4><button type="button" className="ha-q" aria-expanded={isOpen} aria-controls={aid} onClick={() => toggleQ(id)}><span>{e.q[locale]}</span><Chev /></button></h4>
                      <div id={aid} className="ha-ans" hidden={!isOpen}>
                        {e.a[locale].map((p, i) => typeof p === 'string'
                          ? <p key={i}>{p}</p>
                          : <p key={i}><a href={p.href} target="_blank" rel="noopener noreferrer">{p.link}<Ext /><span className="sr-only"> {UI.openInNewTab[locale]}</span></a></p>)}
                        {id === 'E' && flags.stabilization && e.stab && <p>{e.stab[locale]}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="ha-sep" aria-hidden />
            </>)}
            <div className="ha-fixed">
              <a className="ha-item" href={HELP_URL[locale]} target="_blank" rel="noopener noreferrer" onClick={onHelpLink}>{UI.help[locale]}<Ext /><span className="sr-only"> {UI.helpNewTab[locale]}</span></a>
              {variant === 'yev' && <a className="ha-item" href={`mailto:${CONTACT_EMAIL}`}>{UI.talk[locale]}</a>}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
