import type { Locale } from '@beeside/fa-public-engine';
import { Logo } from './Logo';
import { COUNTRY_MESSAGES, STATE_MESSAGES, numberWord, type L10n } from '@beeside/fa-public-engine';
import { UI } from '../copy/ui';
import type { YevDestination, YourExpansionViewModel } from '@beeside/fa-public-engine';

/**
 * YourExpansionView — dynamic, project-specific. Renders ONLY data from the stored model (self-contained stored record);
 * the fixed institutional block and the Premium continuation are separate components (D-121).
 */
export function YourExpansionView({ model, locale, onEdit }: { model: YourExpansionViewModel; locale: Locale; onEdit?: () => void }) {
  const t = (l: L10n) => l[locale];
  const m = model;
  const dependsCount = m.counts.depends;
  const headline = m.shortcut
    ? (locale === 'es' ? `${cap(numberWord(m.counts.applies, locale))} temas aplican. Marcaste ${numberWord(m.counts.marked, locale)}.` : `${cap(numberWord(m.counts.applies, locale))} topics apply. You marked ${numberWord(m.counts.marked, locale)}.`)
    : (locale === 'es'
      ? `${cap(numberWord(m.counts.applies, locale))} ${m.counts.applies === 1 ? 'tema aplica' : 'temas aplican'}${m.destinations.length > 1 ? ` en ${numberWord(m.destinations.length, locale)} países` : ' hoy'}.${dependsCount ? ` ${dependsCount === 1 ? 'Uno más depende' : `${cap(numberWord(dependsCount, locale))} más dependen`} de una decisión.` : ''}`
      : `${cap(numberWord(m.counts.applies, locale))} ${m.counts.applies === 1 ? 'topic applies' : 'topics apply'}${m.destinations.length > 1 ? ` across ${numberWord(m.destinations.length, locale)} countries` : ' today'}.${dependsCount ? ` ${cap(numberWord(dependsCount, locale))} more ${dependsCount === 1 ? 'depends' : 'depend'} on a decision.` : ''}`);

  return (
    <article aria-labelledby="yev-title">
      <section className="res-hero">
        <div className="in">
          <div>
            <Logo onDark />
            <p className="eyebrow" style={{ marginTop: 18 }}>{t(UI.yev)} · {m.company}</p>
            <h1 id="yev-title">{t(m.title)}</h1>
            <p className="sub">{t(m.subtitle)}</p>
          </div>
          <div aria-label={t(UI.glance)}>
            {m.destinations.map((d) => <GlanceCard key={d.destination} d={d} locale={locale} shortcut={m.shortcut} model={m} />)}
          </div>
        </div>
      </section>

      <section className="sec" aria-labelledby="yev-project">
        <div className="cols two">
          <div>
            <p className="eyebrow" id="yev-project">{t(UI.yourProject)}</p>
            {m.projectParagraphs.map((p, i) => <p key={i} style={{ fontSize: 19, marginBottom: 10 }}>{t(p)}</p>)}
            {m.whyNow.quote && (<><p className="hint" style={{ marginTop: 14 }}>{t(UI.whyNowWords)}</p><p className="quote">“{m.whyNow.quote}”</p></>)}
            {!m.whyNow.quote && m.whyNow.reasons.length > 0 && (<><p className="hint" style={{ marginTop: 14 }}>{t(UI.whyNow)}</p><p>{m.whyNow.reasons.map(t).join(' · ')}</p></>)}
            {m.projectSize.length > 0 && (<><p className="hint" style={{ marginTop: 14 }}>{t(UI.projectSize)}</p>{m.projectSize.map((s, i) => <p key={i}>{t(s)}</p>)}</>)}
            {m.successQuote && (<><p className="hint" style={{ marginTop: 14 }}>{t(UI.goodResult)}</p><p className="quote">“{m.successQuote}”</p></>)}
            {onEdit && <p style={{ marginTop: 14 }}><button className="linkbtn" onClick={onEdit}>{t(UI.fixSomething)}</button></p>}
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            {m.decided.length > 0 && <div className="box"><h3>{t(UI.decided)}</h3><ul>{m.decided.map((x, i) => <li key={i}>{t(x)}</li>)}</ul></div>}
            {m.stillOpen.length > 0 && <div className="box dashed"><h3>{t(UI.stillOpen)}</h3><ul>{m.stillOpen.map((x, i) => <li key={i}>{t(x)}</li>)}</ul></div>}
          </div>
        </div>
      </section>

      <section className="sec" style={{ paddingTop: 0 }} aria-labelledby="yev-involves">
        <p className="eyebrow" id="yev-involves">{t(UI.whatItInvolves)}</p>
        <h2 className="big">{headline}</h2>
        <div className="cols" style={{ gap: 24 }}>
          {m.destinations.map((d) => <InvolvesBlock key={d.destination} d={d} locale={locale} shortcut={m.shortcut} />)}
        </div>
      </section>

      <section className="sec" style={{ paddingTop: 0 }} aria-labelledby="yev-where">
        <div className="cols two">
          <div>
            <p className="eyebrow" id="yev-where">{t(UI.whereYouAre)}</p>
            {m.shortcut ? (
              <div className="stats"><div className="stat strong"><b>{m.whereYouAre.marked}</b>{locale === 'es' ? 'Marcados' : 'Marked'}</div><div className="stat"><b>{m.whereYouAre.notIndicated}</b>{t(UI.notIndicated)}</div></div>
            ) : (
              <div className="stats">
                <div className="stat"><b>{m.whereYouAre.resolved}</b>{t(UI.resolved)}</div>
                <div className="stat"><b>{m.whereYouAre.inProgress}</b>{t(UI.underWay)}</div>
                <div className="stat strong"><b>{m.whereYouAre.pending}</b>{t(UI.pendingL)}</div>
              </div>
            )}
            {m.whereYouAre.sentences.map((s, i) => <p key={i} style={{ marginTop: 10, color: 'var(--ink-2)' }}>{t(s)}</p>)}
          </div>
          {m.whereYouAre.alreadyHave.length > 0 && <div className="box"><h3>{t(UI.alreadyHave)}</h3><ul>{m.whereYouAre.alreadyHave.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
        </div>
      </section>

      <section className="band" aria-labelledby="yev-value">
        <div className="sec">
          <div className="cols two" style={{ marginBottom: 8 }}>
            <div>
              <p className="eyebrow" id="yev-value">{t(UI.whereValue)}</p>
              <h2 className="big">{t(UI.whereValueTitle)}</h2>
            </div>
            {(m.support.valued || m.support.keep) && (
              <div className="card">
                {m.support.valued && (<><p className="hint">{t(UI.valuedSupport)}</p><p className="quote">“{m.support.valued}”</p></>)}
                {m.support.keep && (<><p className="hint" style={{ marginTop: 8 }}>{t(UI.keptTeam)}</p><p className="quote">“{m.support.keep}”</p></>)}
              </div>
            )}
          </div>
          {m.destinations.map((d) => <ValueBlock key={d.destination} d={d} locale={locale} />)}
        </div>
      </section>
    </article>
  );
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

function destTitle(d: YevDestination, locale: Locale) { return d.region ? `${d.name[locale]} · ${d.region}` : d.name[locale]; }

function GlanceCard({ d, locale, shortcut, model }: { d: YevDestination; locale: Locale; shortcut: boolean; model: YourExpansionViewModel }) {
  return (
    <div className="glance">
      <h3><span>{destTitle(d, locale)}</span><span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>{shortcut ? `${locale === 'es' ? 'Marcados' : 'Marked'} ${d.marked.length} · ${UI.notIndicated[locale]} ${d.notIndicated.length}` : `${d.topicCount} ${UI.topics[locale]}`}</span></h3>
      {d.countryMessage ? (
        <div className="row"><span style={{ display: 'flex', alignItems: 'center' }}><span className="dot none" aria-hidden />{COUNTRY_MESSAGES[d.countryMessage][locale]}</span></div>
      ) : d.glance.map((g) => (
        <div className="row" key={g.key}><span style={{ display: 'flex', alignItems: 'center' }}><span className={`dot ${g.key}`} aria-hidden />{STATE_MESSAGES[g.key][locale]}</span><b>{g.count}</b></div>
      ))}
      {shortcut && d.notIndicated.length > 0 && model.destinations.length === 1 && <p className="hint" style={{ marginTop: 6 }}>{locale === 'es' ? `A los ${d.notIndicated.length} temas que no marcaste no les asignamos estado.` : `We don't assign a status to the ${d.notIndicated.length} topics you didn't mark.`}</p>}
    </div>
  );
}

function InvolvesBlock({ d, locale, shortcut }: { d: YevDestination; locale: Locale; shortcut: boolean }) {
  const t = (l: L10n) => l[locale];
  const causeText = d.depends ? `${UI.causes[d.depends.cause][locale]}${d.depends.cause === 'hire' ? '' : ` ${d.name[locale]}`}` : '';
  return (
    <div>
      <div className="dest-head"><h2>{destTitle(d, locale)}</h2><span className="hint">{d.applies.length} {UI.topics[locale]}</span></div>
      <div className="topics-grid">
        {d.applies.map((x) => <div className="topic" key={x.front}><span className="name">{t(x.name)}</span> {x.possible && <span className="tag">{UI.possible[locale]}</span>}</div>)}
      </div>
      {d.involvesNote && <p className="note" style={{ margin: '12px 0' }}>{t(d.involvesNote)}</p>}
      {d.depends && (
        <div className="dep"><b>{locale === 'es' ? 'Depende de' : 'Depends on'} {causeText}</b>
          <ul>{d.depends.topics.map((x) => <li key={x.front}><span>{t(x.name)}</span><span className="tag">{UI.dependsTag[locale]}</span></li>)}</ul>
        </div>
      )}
      {d.notApplicable.length > 0 && (
        <div style={{ marginTop: 12 }}><b style={{ fontSize: 14 }}>{UI.notApply[locale]}</b>
          {d.notApplicable.map((n, i) => <p key={i} style={{ color: 'var(--ink-2)', fontSize: 14 }}>{n.fronts.map((f) => t(f.name)).join(' · ')} — {t(n.reason)}</p>)}</div>
      )}
      {shortcut && d.notIndicated.length > 0 && (
        <div style={{ marginTop: 12 }}><b style={{ fontSize: 14 }}>{UI.notIndicated[locale]} · {d.notIndicated.length}</b>
          {d.notIndicated.map((x) => <p key={x.front} style={{ color: 'var(--ink-2)', fontSize: 14 }}>{t(x.name)}{x.possible ? ` (${UI.possible[locale].toLowerCase()})` : ''}</p>)}
          <p className="hint">{locale === 'es' ? '«No indicado» no significa resuelto: aplica a tu proyecto, pero no lo marcaste.' : "“Not indicated” doesn't mean resolved: it applies to your project, but you didn't mark it."}</p></div>
      )}
    </div>
  );
}

function ValueBlock({ d, locale }: { d: YevDestination; locale: Locale }) {
  const t = (l: L10n) => l[locale];
  return (
    <div style={{ marginBottom: 24 }}>
      <div className="dest-head"><h2>{destTitle(d, locale)}</h2><span className="hint">{d.topicCount} {UI.topics[locale]}</span></div>
      {d.countryMessage ? (
        <div className="country-msg" style={{ marginTop: 12 }}><span className="dot none" aria-hidden />{COUNTRY_MESSAGES[d.countryMessage][locale]}</div>
      ) : (
        <>
          <div className="cols values" style={{ marginTop: 12 }}>
            {d.valueGroups.map((g) => (
              <section className="vgroup" key={g.key}>
                <h3><span className="l"><span className={`dot ${g.key}`} aria-hidden />{STATE_MESSAGES[g.key][locale]}</span><span>{g.items.length + d.unmapped.filter((u) => u.stateKey === g.key).length}</span></h3>
                {g.items.map((it) => (
                  <div className="vitem" key={it.front}>
                    <div className="n">{t(it.name)} {it.possible && <span className="tag">{UI.possible[locale]}</span>} {it.critical && <span className="tag solid">{UI.criticalTag[locale]}</span>}</div>
                    {it.capabilities.length > 0 && <div className="d">{it.capabilities.map(t).join(' · ')}</div>}
                    {it.quotes.map((q, i) => <div className="d quote" key={i}>«{q}»</div>)}
                    {it.conditionalNotes.map((c, i) => <div className="d" key={i}>{t(c)}</div>)}
                  </div>
                ))}
                {d.unmapped.filter((u) => u.stateKey === g.key).map((u, i) => <div className="vitem" key={`u${i}`}><div className="n quote">«{u.text}»</div></div>)}
              </section>
            ))}
          </div>
          {d.valueFootnotes.map((f, i) => <p className="footnote" key={i}>{t(f)}</p>)}
        </>
      )}
    </div>
  );
}
