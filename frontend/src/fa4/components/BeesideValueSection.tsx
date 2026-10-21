import type { Locale } from '@beeside/fa-public-engine';
import { BRAND } from '../brand';
import { UI } from '../copy/ui';
import { Logo } from './Logo';
// Official component identifiers: the PO-approved icons of the approved (`.bridge-icon-badge`, authorization 2026-09-30),
// used unmodified inside a white circle badge. They replace the generic line icons (BrandIcons.tsx), which are no longer used here.
import sherpaIcon from '../../assets/bridge-sherpa.png';
import hiveIcon from '../../assets/bridge-the-hive.png';
import hubIcon from '../../assets/bridge-operation-hub.png';
import advisoryIcon from '../../assets/bridge-strategic-advisory.png';

/**
 * BeesideValueSection — fixed institutional content (Option A). DSC-10: the comparison table was removed from this composition (kept in ValueComparison.tsx, not rendered). Takes NO result data: identical for every result,
 * including Journey A (D-120/D-121). Logo and lifestyle image are the official assets (BRAND-1 / BRAND-3).
 */
export function BeesideValueSection({ locale }: { locale: Locale }) {
  const items = [
    { key: 'sherpa', icon: sherpaIcon, t: UI.vsSherpa, d: UI.vsSherpaD }, { key: 'hive', icon: hiveIcon, t: UI.vsHive, d: UI.vsHiveD },
    { key: 'operation-hub', icon: hubIcon, t: UI.vsHub, d: UI.vsHubD }, { key: 'strategic-advisory', icon: advisoryIcon, t: UI.vsAdvisory, d: UI.vsAdvisoryD },
  ];
  return (
    <>
    {/* Value of Continuing · 2 — photography + brand message */}
    <section className="night" aria-labelledby="bvs-title" data-testid="beeside-value-section">
      <div className="in">
        <div className="img"><img src={BRAND.lifestyleImage.src} alt="" loading="lazy" /></div>
        <div className="copy">
          <Logo onDark />
          <p className="eyebrow" style={{ marginTop: 14 }}>{UI.aboutBeeside[locale]}</p>
          <h2 id="bvs-title">{UI.vsHeadline[locale]}</h2>
          <ul>{items.map((i) => <li key={i.key} data-component={i.key}><span className={`ico badge ${i.key}`}><img src={i.icon} alt="" /></span><div><b>{i.t[locale]}</b><span>{i.d[locale]}</span></div></li>)}</ul>
        </div>
      </div>
    </section>
    </>
  );
}
