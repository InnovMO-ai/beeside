import { useEffect, useId, useRef } from 'react';
import type { Locale } from '@beeside/fa-public-engine';
import { UI } from '../copy/ui';

/**
 * Stabilization notice (closed test only): a MODAL the visitor must confirm before entering project information. It cannot be dismissed any other way (no close button,
 * no Escape, no backdrop click). Native <dialog>.showModal(): focus is trapped in the dialog, the page behind is inert, and the confirm button receives focus.
 */
export function StabilizationNotice({ locale, onConfirm }: { locale: Locale; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null); const tid = useId(); const did = useId();
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal?.(); }, []);
  return (
    <dialog ref={ref} className="sheet stab-notice" aria-labelledby={tid} aria-describedby={did} onCancel={(e) => e.preventDefault()} data-testid="stabilization-notice">
      <div className="sheet-head"><h2 id={tid}>{UI.stabTitle[locale]}</h2></div>
      <div className="sheet-body" id={did}>
        {[UI.stabP1, UI.stabP2, UI.stabP3, UI.stabP4, UI.stabP5].map((p, i) => <p key={i} className={i === 4 ? 'stab-confirm' : undefined}>{p[locale]}</p>)}
        <div className="sheet-actions"><button type="button" className="btn primary" autoFocus onClick={onConfirm}>{UI.stabConfirm[locale]}</button></div>
      </div>
    </dialog>
  );
}
