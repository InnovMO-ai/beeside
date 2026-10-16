import type { Locale } from '@beeside/fa-public-engine';
import { BRAND } from '../brand';
import { UI, fill } from '../copy/ui';
import { Logo } from './Logo';
// Official component identifiers: the PO-approved icons of the approved (`.bridge-icon-badge`, authorization 2026-09-30),
// used unmodified inside a white circle badge. They replace the generic line icons (BrandIcons.tsx), which are no longer used here.
import sherpaIcon from '../../assets/bridge-sherpa.png';
import hiveIcon from '../../assets/bridge-the-hive.png';
import hubIcon from '../../assets/bridge-operation-hub.png';
import advisoryIcon from '../../assets/bridge-strategic-advisory.png';

/**
 * BeesideValueSection — fixed institutional content (Option A). Takes NO result data: identical for every result,
 * including Journey A (D-120/D-121). Logo and lifestyle image are the official assets (BRAND-1 / BRAND-3).
 */
export function BeesideValueSection({ locale }: { locale: Locale }) {
  const items = [
    { key: 'sherpa', icon: sherpaIcon, t: UI.vsSherpa, d: UI.vsSherpaD }, { key: 'hive', icon: hiveIcon, t: UI.vsHive, d: UI.vsHiveD },
    { key: 'operation-hub', icon: hubIcon, t: UI.vsHub, d: UI.vsHubD }, { key: 'strategic-advisory', icon: advisoryIcon, t: UI.vsAdvisory, d: UI.vsAdvisoryD },
  ];
  return (
    <>
    {/* Value of Continuing · 1 — rational argument (institutional, identical for every result; never project data) */}
    <section className="vc-compare" aria-labelledby="cmp-title" data-testid="value-comparison">
      <div className="vc-head">
        <p className="eyebrow">{UI.cmpEyebrow[locale]}</p>
        <h2 id="cmp-title">{UI.cmpTitle[locale]}</h2>
        <p className="lead">{UI.cmpLead[locale]}</p>
      </div>
      <div className="vc-card">
        <table className="vc-table">
          <caption className="sr-only">{UI.cmpTitle[locale]}</caption>
          <thead>
            <tr>
              <th scope="col">{UI.cmpOption[locale]}</th>
              <th scope="col">{UI.cmpComplexity[locale]}</th>
              {UI.cmpDims.map((d, i) => <th scope="col" key={i} className="vc-dim"><abbr title={d[locale]}>{i + 1}</abbr></th>)}
              <th scope="col" className="vc-sum"><span className="sr-only">{UI.cmpIncluded[locale]}</span></th>
            </tr>
          </thead>
          <tbody>
            {UI.cmpOptions.map((o, r) => (
              <tr key={o.key} className={`vc-row vc-${o.key}`}>
                <th scope="row"><b>{String.fromCharCode(65 + r)} · {o.name[locale]}</b><span>{o.sub[locale]}</span></th>
                <td className="vc-cx"><span className="vc-cx-label" aria-hidden="true">{UI.cmpComplexity[locale]}</span><span className="vc-bar" aria-hidden="true"><i style={{ width: `${Math.round(o.complexity * 100)}%` }} /></span></td>
                {UI.cmpDims.map((d, i) => (
                  <td key={i} className="vc-dim">{i < o.covered
                    ? <svg viewBox="0 0 24 24" width="24" height="24" role="img" aria-label={`${d[locale]}: ${UI.cmpIncluded[locale]}`}><circle cx="12" cy="12" r="11" fill="currentColor" /><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    : <span className="vc-no" role="img" aria-label={`${d[locale]}: ${UI.cmpNotIncluded[locale]}`} />}</td>
                ))}
                <td className="vc-sum"><span className="vc-dots" aria-hidden="true">{UI.cmpDims.map((_, i) => <i key={i} className={i < o.covered ? 'on' : ''} />)}</span><span className="vc-count">{fill(UI.cmpOf, locale, { n: o.covered, total: UI.cmpDims.length })}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <ol className="vc-legend">{UI.cmpDims.map((d, i) => <li key={i}><b>{i + 1}</b> {d[locale]}</li>)}</ol>
        <p className="vc-note">{UI.cmpNote[locale]}</p>
      </div>
    </section>
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
