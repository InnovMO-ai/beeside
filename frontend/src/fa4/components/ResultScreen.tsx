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
  return (
    <div data-testid="result-screen" className="result">
      {actions && <div className="res-actions">{actions}</div>}
      <YourExpansionView model={model} locale={locale} onEdit={onEdit} />
      <BeesideValueSection locale={locale} />
      <PremiumContinuation premium={model.premium} locale={locale} onContinue={onContinue} onEmail={onEmail} email={email} />
      {onRestart && <div className="sec restart"><button className="linkbtn subtle" onClick={onRestart}>{UI.backToStart[locale]}</button></div>}
      <LegalFooter locale={locale} />
    </div>
  );
}
