import type { Locale } from '@beeside/fa-public-engine';
import { BRAND } from '../brand';
import { UI } from '../copy/ui';
import { Logo } from './Logo';

/**
 * BeesideValueSection — fixed institutional content (Option A). Takes NO result data: identical for every result,
 * including Journey A (D-120/D-121). Logo and lifestyle image are placeholders until BRAND-1…3.
 */
export function BeesideValueSection({ locale }: { locale: Locale }) {
  const items = [
    { key: 'sherpa', t: UI.vsSherpa, d: UI.vsSherpaD }, { key: 'hive', t: UI.vsHive, d: UI.vsHiveD },
    { key: 'operation-hub', t: UI.vsHub, d: UI.vsHubD }, { key: 'strategic-advisory', t: UI.vsAdvisory, d: UI.vsAdvisoryD },
  ];
  return (
    <section className="night" aria-labelledby="bvs-title" data-testid="beeside-value-section">
      <div className="in">
        <div className="img" role="img" aria-label={BRAND.lifestyleImage.label[locale]}>
          {BRAND.lifestyleImage.src ? <img src={BRAND.lifestyleImage.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span>{BRAND.lifestyleImage.label[locale]}</span>}
        </div>
        <div className="copy">
          <Logo onDark />
          <p className="eyebrow" style={{ marginTop: 14 }}>{UI.aboutBeeside[locale]}</p>
          <h2 id="bvs-title">{UI.vsHeadline[locale]}</h2>
          <ul>{items.map((i) => <li key={i.key} data-component={i.key}><b>{i.t[locale]}</b><span>{i.d[locale]}</span></li>)}</ul>
        </div>
      </div>
    </section>
  );
}
