import type { Locale } from '@beeside/fa-public-engine';
import { UI, fill } from '../copy/ui';

/**
 * DSC-10: RETIRADO de la experiencia visible — rediseño pendiente (con claims validados, DSC-10b). Este componente se conserva a propósito, NO se renderiza en ningún
 * caso (sin flag de experimento ni visualización parcial): `ResultScreen` / `BeesideValueSection` no lo referencian. Sus tests se conservan (`valueComparison.test.tsx`).
 * Value of Continuing · 1 — rational argument (institutional, identical for every result; never project data).
 */
export function ValueComparison({ locale }: { locale: Locale }) {
  return (
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
  );
}
