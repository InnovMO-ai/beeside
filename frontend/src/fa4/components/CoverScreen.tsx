import type { Locale } from '@beeside/fa-public-engine';
import { BRAND } from '../brand';
import { UI } from '../copy/ui';
import clarity from '../assets/cover/benefit-clarity.svg';
import expert from '../assets/cover/benefit-expert.svg';
import globalIcon from '../assets/cover/benefit-global.svg';
import real from '../assets/cover/benefit-real.svg';
import globe900 from '../assets/cover/globe-900.webp';
import globe1672 from '../assets/cover/globe-1672.webp';

const BENEFITS = [
  { key: 'clarity', src: clarity, w: 161 }, { key: 'expert', src: expert, w: 138 },
  { key: 'global', src: globalIcon, w: 142 }, { key: 'real', src: real, w: 172 },
] as const;

/** First Assessment cover (PO design). Fixed brand elements (product name, side words, benefits) are English in both languages. */
export function CoverScreen({ locale, setLocale, onStart }: { locale: Locale; setLocale: (l: Locale) => void; onStart: () => void }) {
  const other = ({ es: 'en', en: 'es' } as const)[locale];
  return (
    <div className="cv" lang={locale}>
      <header className="cv-top">
        <div className="cv-brand">
          <img className="cv-logo" src={BRAND.logo.dark} alt={BRAND.logo.alt} />
          <span className="cv-sep" aria-hidden />
          <span className="cv-product">{UI.coverProduct[locale]}</span>
        </div>
        <button type="button" className="cv-lang" lang={other} aria-label={`${UI.switchLanguage[locale]} ${UI.languageNames[other]}`} onClick={() => setLocale(other)}>{UI.languageNames[other]}</button>
      </header>

      <div className="cv-stage">
      <main className="cv-main" id="main">
        <div className="cv-side" aria-hidden>{UI.coverSideTop.map((w, i) => <span key={i}>{w.en}</span>)}</div>
        <div className="cv-copy">
          <p className="cv-eyebrow">{UI.coverEyebrow[locale]}</p>
          <h1 className="cv-title">{UI.coverTitleLead[locale]} <em>{UI.coverTitleAccent[locale]}</em></h1>
          <p className="cv-lead">{UI.coverLead[locale]}</p>
          <button type="button" className="cv-cta" onClick={onStart}>
            <span>{UI.coverCta[locale]}</span>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 12h15M13 6l6 6-6 6" /></svg>
          </button>
          <p className="cv-note"><b>{UI.coverNoteStrong[locale]}</b><span>{UI.coverNote[locale]}</span></p>
        </div>
        <img className="cv-globe" src={globe1672} srcSet={`${globe900} 900w, ${globe1672} 1672w`} sizes="(min-width: 1024px) 56vw, 92vw" alt="" width={1672} height={1417} fetchPriority="high" />
      </main>

      <footer className="cv-foot">
        <ul className="cv-benefits">{BENEFITS.map((b) => <li key={b.key}><img src={b.src} alt={UI.benefits[b.key].en} height={50} /></li>)}</ul>
        <p className="cv-tagline" aria-hidden><i />{UI.coverSideBottom.map((w, i) => <span key={i}>{w.en}</span>)}</p>
      </footer>
      </div>
    </div>
  );
}
