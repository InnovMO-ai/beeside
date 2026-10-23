import { useEffect, useId, useRef } from 'react';
import type { Locale } from '@beeside/fa-public-engine';
import { UI } from '../copy/ui';

/** Advisory warning (never a blocker): a personal e-mail address was typed. «Use another» returns to the field; «Continue» accepts it. Escape = use another. */
export function PersonalEmailDialog({ locale, onUseAnother, onContinue }: { locale: Locale; onUseAnother: () => void; onContinue: () => void }) {
  const ref = useRef<HTMLDialogElement>(null); const tid = useId(); const did = useId();
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal?.(); }, []);
  return (
    <dialog ref={ref} className="sheet personal-email" role="alertdialog" aria-labelledby={tid} aria-describedby={did} onCancel={(e) => { e.preventDefault(); onUseAnother(); }} data-testid="personal-email-warning">
      <div className="sheet-head"><h2 id={tid}>{UI.personalEmailTitle[locale]}</h2></div>
      <div className="sheet-body">
        <p id={did}>{UI.personalEmailBody[locale]}</p>
        <div className="sheet-actions">
          <button type="button" className="btn" autoFocus onClick={onUseAnother}>{UI.personalEmailOther[locale]}</button>
          <button type="button" className="btn primary" onClick={onContinue}>{UI.personalEmailKeep[locale]}</button>
        </div>
      </div>
    </dialog>
  );
}
