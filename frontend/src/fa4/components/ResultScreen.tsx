import type { Locale } from '@beeside/fa-public-engine';
import type { YourExpansionViewModel } from '@beeside/fa-public-engine';
import { BeesideValueSection } from './BeesideValueSection';
import { LegalFooter } from './LegalFooter';
import { PremiumContinuation } from './PremiumContinuation';
import { YourExpansionView } from './YourExpansionView';
import { UI } from '../copy/ui';

/** Canonical order (D-120): YourExpansionView → BeesideValueSection → PremiumContinuation. Three independent components. */
export function ResultScreen({ model, locale, onEdit, onContinue, onEmail, onRestart }: {
  model: YourExpansionViewModel; locale: Locale; onEdit?: () => void;
  onContinue?: () => Promise<boolean>; onEmail?: () => Promise<boolean>; onRestart?: () => void;
}) {
  return (
    <div data-testid="result-screen">
      <YourExpansionView model={model} locale={locale} onEdit={onEdit} />
      <BeesideValueSection locale={locale} />
      <PremiumContinuation premium={model.premium} locale={locale} onContinue={onContinue} onEmail={onEmail} />
      {onRestart && <div className="sec" style={{ paddingTop: 0 }}><button className="linkbtn" onClick={onRestart}>{UI.backToStart[locale]}</button></div>}
      <LegalFooter locale={locale} />
    </div>
  );
}
