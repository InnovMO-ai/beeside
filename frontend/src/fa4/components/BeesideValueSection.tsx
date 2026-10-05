import type { Locale } from '@beeside/fa-public-engine';
import { BRAND } from '../brand';
import { UI } from '../copy/ui';
import { Logo } from './Logo';
import { AdvisoryIcon, HiveIcon, HubIcon, SherpaIcon } from './BrandIcons';

/**
 * BeesideValueSection — fixed institutional content (Option A). Takes NO result data: identical for every result,
 * including Journey A (D-120/D-121). Logo and lifestyle image are the official assets (BRAND-1 / BRAND-3).
 */
export function BeesideValueSection({ locale }: { locale: Locale }) {
  const items = [
    { key: 'sherpa', icon: <SherpaIcon />, t: UI.vsSherpa, d: UI.vsSherpaD }, { key: 'hive', icon: <HiveIcon />, t: UI.vsHive, d: UI.vsHiveD },
    { key: 'operation-hub', icon: <HubIcon />, t: UI.vsHub, d: UI.vsHubD }, { key: 'strategic-advisory', icon: <AdvisoryIcon />, t: UI.vsAdvisory, d: UI.vsAdvisoryD },
  ];
  return (
    <section className="night" aria-labelledby="bvs-title" data-testid="beeside-value-section">
      <div className="in">
        <div className="img"><img src={BRAND.lifestyleImage.src} alt="" loading="lazy" /></div>
        <div className="copy">
          <Logo onDark />
          <p className="eyebrow" style={{ marginTop: 14 }}>{UI.aboutBeeside[locale]}</p>
          <h2 id="bvs-title">{UI.vsHeadline[locale]}</h2>
          <ul>{items.map((i) => <li key={i.key} data-component={i.key}><span className="ico">{i.icon}</span><div><b>{i.t[locale]}</b><span>{i.d[locale]}</span></div></li>)}</ul>
        </div>
      </div>
    </section>
  );
}
