import { useEffect } from 'react';
import type { Locale } from '@beeside/fa-public-engine';
import type { ReactNode } from 'react';
import type { YourExpansionViewModel } from '@beeside/fa-public-engine';
import { BeesideValueSection } from './BeesideValueSection';
import { LegalFooter } from './LegalFooter';
import { PremiumContinuation } from './PremiumContinuation';
import { YourExpansionView } from './YourExpansionView';
import { UI } from '../copy/ui';

/** Canonical order (D-120): YourExpansionView → BeesideValueSection → PremiumContinuation. Three independent components. */
export function ResultScreen({ model, locale, onEdit, onContinue, onEmail, onRestart, email, footer, delivered }: {
  model: YourExpansionViewModel; locale: Locale; onEdit?: () => void; email?: string; footer?: ReactNode; delivered?: boolean;
  onContinue?: () => Promise<boolean>; onEmail?: () => Promise<boolean | 'unauthorized'>; onRestart?: () => void;
}) {
  // The result is ready: announce it politely and move focus to its title (screen-reader and keyboard users do not lose their place).
  useEffect(() => { const h = document.getElementById('yev-title'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } }, [model]);
  return (
    <div data-testid="result-screen" className="result">
      <p className="sr-only" role="status" aria-live="polite">{UI.ready[locale]}</p>
      <YourExpansionView model={model} locale={locale} onEdit={onEdit} />
      {/* Discovery v1.0: Value of Continuing = one composed zone on the warm page (same two components, same order, D-120) */}
      <div className={`continue-zone ${model.premium.shown ? 'with-premium' : 'without-premium'}`}>
        <BeesideValueSection locale={locale} />
        <PremiumContinuation delivered={delivered} premium={model.premium} locale={locale} onContinue={onContinue} onEmail={onEmail} email={email} />
      </div>
      {onRestart && <div className="sec restart"><button className="linkbtn subtle" onClick={onRestart}>{UI.backToStart[locale]}</button></div>}
      {footer && <div className="sec res-footer">{footer}</div>}
      <LegalFooter locale={locale} />
    </div>
  );
}
