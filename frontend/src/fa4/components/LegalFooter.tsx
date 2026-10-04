import type { Locale } from '@beeside/fa-public-engine';
import { BRAND } from '../brand';
import { UI } from '../copy/ui';

/** Legal footer: links to the pages already published on the beeside website (CHK-1); never duplicates the documents. */
export function LegalFooter({ locale }: { locale: Locale }) {
  return (
    <footer className="legal">
      <span>{UI.footerCopy[locale].replace('2026', String(BRAND.year))}</span>
      <a href={BRAND.legal.termsUrl[locale]} target="_blank" rel="noopener noreferrer">{UI.termsLink[locale]}</a>
      <a href={BRAND.legal.privacyUrl[locale]} target="_blank" rel="noopener noreferrer">{UI.privacyLink[locale]}</a>
    </footer>
  );
}
