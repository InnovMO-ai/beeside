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
export function ResultScreen({ model, locale, onEdit, onContinue, onEmail, onRestart, email, actions }: {
  model: YourExpansionViewModel; locale: Locale; onEdit?: () => void; email?: string; actions?: ReactNode;
  onContinue?: () => Promise<boolean>; onEmail?: () => Promise<boolean>; onRestart?: () => void;
}) {
  // The result is ready: announce it politely and move focus to its title (screen-reader and keyboard users do not lose their place).
  useEffect(() => { const h = document.getElementById('yev-title'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } }, [model]);
  return (
    <div data-testid="result-screen" className="result">
      <p className="sr-only" role="status" aria-live="polite">{UI.ready[locale]}</p>
      {actions && <div className="res-actions">{actions}</div>}
      <YourExpansionView model={model} locale={locale} onEdit={onEdit} />
      <BeesideValueSection locale={locale} />
      <PremiumContinuation premium={model.premium} locale={locale} onContinue={onContinue} onEmail={onEmail} email={email} />
      {onRestart && <div className="sec restart"><button className="linkbtn subtle" onClick={onRestart}>{UI.backToStart[locale]}</button></div>}
      <LegalFooter locale={locale} />
    </div>
  );
}
