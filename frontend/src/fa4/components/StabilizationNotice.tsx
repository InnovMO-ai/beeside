import { useEffect, useId, useRef, useState } from 'react';
import type { Locale } from '@beeside/fa-public-engine';
import { UI } from '../copy/ui';

// DSC-14: the focus ring of the notice is for KEYBOARD use. Opened with a click/tap the page's own heuristics still draw it on the first button, so the last input
// modality is tracked: the ring shows when the notice was opened from the keyboard, or as soon as a key is pressed inside it (Tab, Enter…).
let lastInputWasKeyboard = false;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', () => { lastInputWasKeyboard = true; }, true);
  window.addEventListener('pointerdown', () => { lastInputWasKeyboard = false; }, true);
}

/**
 * Stabilization notice (closed test only): a MODAL the visitor must confirm before entering project information. It cannot be dismissed any other way (no close button,
 * no Escape, no backdrop click). Native <dialog>.showModal(): focus is trapped in the dialog, the page behind is inert, and the confirm button receives focus.
 */
export function StabilizationNotice({ locale, onConfirm }: { locale: Locale; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null); const tid = useId(); const did = useId(); const [kbd, setKbd] = useState(() => lastInputWasKeyboard);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal?.(); }, []);
  return (
    <dialog ref={ref} className="sheet stab-notice" aria-labelledby={tid} aria-describedby={did} onCancel={(e) => e.preventDefault()} onKeyDown={() => setKbd(true)} data-kbd={kbd ? 'true' : undefined} data-testid="stabilization-notice">
      <div className="sheet-head"><h2 id={tid}>{UI.stabTitle[locale]}</h2></div>
      <div className="sheet-body" id={did}>
        {[UI.stabP1, UI.stabP2, UI.stabP3, UI.stabP4, UI.stabP5].map((p, i) => <p key={i} className={i === 4 ? 'stab-confirm' : undefined}>{p[locale]}</p>)}
        <div className="sheet-actions"><button type="button" className="btn primary" autoFocus onClick={onConfirm}>{UI.stabConfirm[locale]}</button></div>
      </div>
    </dialog>
  );
}
