import { useState, type ReactNode } from 'react';
import type { Answers, ProjectComponent } from '@beeside/fa-public-engine';
import { frontKey, OPEN_DEST, proxyFor } from '@beeside/fa-public-engine';
import type { Activity, ClientResolution, FrontKey, Locale, PublicCatalog } from '@beeside/fa-public-engine';
import { BRAND } from '../brand';
import { activatorFields, isValidEmail, lastProjectStep } from '@beeside/fa-public-engine';
import { plansFor } from '@beeside/fa-public-engine';
import { mapTextWithIndex } from '@beeside/fa-public-engine';
import { buildNotApplicable, formatKeyDate } from '@beeside/fa-public-engine';
import { countryName, STATE_MESSAGES, visibleStateKey } from '@beeside/fa-public-engine';
import { UI, becauseText, fill } from '../copy/ui';
import { CheckGroup, ChipGroup, ChipMulti, CountryPicker, Label, RadioGroup, Segmented, TextField } from './controls';
import { Req } from './required';

export interface StepCtx { a: Answers; set: (fn: (a: Answers) => Answers) => void; locale: Locale; catalog: PublicCatalog; res: ClientResolution; goTo: (step: string) => void }
const T = (l: { es: string; en: string }, loc: Locale) => l[loc];

function Head({ eyebrow, title, lead, tint }: { eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode; tint?: boolean }) {
  return <header style={tint ? undefined : undefined}>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1 className="h1">{title}</h1>{lead && <p className="lead">{lead}</p>}</header>;
}
const compName = (c: ProjectComponent, loc: Locale) => c.destinations.map((d) => (d === OPEN_DEST ? UI.countryYouChoose[loc] : countryName(d, loc))).join(` ${UI.and[loc]} `);
const frontName = (cat: PublicCatalog, f: FrontKey, loc: Locale) => { const d = cat.fronts.find((x) => x.key === f); return d ? { es: d.nameEs, en: d.nameEn }[loc] : f; };
const CT = (l: { es: string; en: string }, loc: Locale, c: ProjectComponent) => fill(l, loc, { country: compName(c, loc) });
const upd = (s: StepCtx, id: string, fn: (c: ProjectComponent) => ProjectComponent) => s.set((a) => ({ ...a, components: a.components.map((c) => (c.id === id ? fn(c) : c)) }));

// ---------------- identity ----------------
export function IdentityStep({ a, set, locale }: StepCtx) {
  const id = a.identity; const [touched, setTouched] = useState(false);
  const setId = (p: Partial<Answers['identity']>) => set((x) => ({ ...x, identity: { ...x.identity, ...p } }));
  return (
    <div className="narrow">
      <Head title={UI.idTitle[locale]} lead={UI.idLead[locale]} />
      <div className="fgrid">
        <Req k="identity.name" label={UI.name[locale]}><TextField label={UI.name[locale]} value={id.name} onChange={(v) => setId({ name: v })} autoComplete="name" /></Req>
        <Req k="identity.company" label={UI.company[locale]}><TextField label={UI.company[locale]} value={id.company} onChange={(v) => setId({ company: v })} autoComplete="organization" /></Req>
      </div>
      <div className="fgrid">
        <Req k="identity.email" label={UI.email[locale]}><div onBlur={() => setTouched(true)}>
          <TextField label={UI.email[locale]} type="email" value={id.email} onChange={(v) => setId({ email: v })} autoComplete="email" help={UI.emailHelp[locale]} invalid={touched && id.email && !isValidEmail(id.email) ? UI.emailInvalid[locale] : undefined} />
        </div></Req>
        <TextField label={<>{UI.role[locale]} <span className="hint">({UI.optional[locale]})</span></>} value={id.role} onChange={(v) => setId({ role: v })} />
      </div>
      <RadioGroup req={{ k: "identity.decider", label: UI.decider[locale] }} three legend={UI.decider[locale]} value={id.decider} onChange={(v) => setId({ decider: v })} options={(['me', 'other', 'shared'] as const).map((v) => ({ value: v, label: T(UI.deciderOpts[v], locale) }))} />
      {/* Closing section of Identity: separated from "who decides" by space + a divider; required acceptances only; these two alone enable «Aceptar y continuar». */}
      <section className="id-legal" aria-labelledby="id-legal-title">
        <h2 id="id-legal-title">{UI.idBeforeTitle[locale]}</h2>
        <p className="hint">{UI.idBeforeLead[locale]}</p>
        <div className="choices">
          <Req k="identity.terms" label={UI.terms[locale]}><label className={`choice ${id.termsAccepted ? 'on' : ''}`}><input type="checkbox" checked={id.termsAccepted} onChange={(e) => setId({ termsAccepted: e.target.checked })} /><span>{linkIn(UI.terms[locale], UI.termsLink[locale], BRAND.legal.termsUrl[locale], UI.openInNewTab[locale])}</span></label></Req>
          <Req k="identity.privacy" label={UI.privacy[locale]}><label className={`choice ${id.privacyAcknowledged ? 'on' : ''}`}><input type="checkbox" checked={id.privacyAcknowledged} onChange={(e) => setId({ privacyAcknowledged: e.target.checked })} /><span>{linkIn(UI.privacy[locale], UI.privacyLink[locale], BRAND.legal.privacyUrl[locale], UI.openInNewTab[locale])}</span></label></Req>
        </div>
      </section>
      {/* OPTIONAL and independent (D-144): own block, unchecked by default, never implied, does not gate "Accept and continue". */}
      <section className="id-optional" aria-labelledby="id-opt-title">
        <h2 id="id-opt-title">{UI.idOptionalTitle[locale]}</h2>
        <label className={`choice optional ${id.marketingConsent ? 'on' : ''}`}><input type="checkbox" checked={id.marketingConsent === true} onChange={(e) => setId({ marketingConsent: e.target.checked })} /><span>{UI.marketingConsent[locale]}</span></label>
      </section>
      <p className="trust">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3l7 3v5c0 4.4-2.9 8.3-7 10-4.1-1.7-7-5.6-7-10V6z" /><path d="M9 12l2 2 4-4" /></svg>
        <span>{UI.privacyNotice[locale]}</span>
      </p>
    </div>
  );
}

/** Turns the document name inside the sentence into the link (no duplicated text): «Acepto los [Términos y Condiciones]». */
function linkIn(sentence: string, doc: string, href: string, newTab: string): ReactNode {
  const i = sentence.indexOf(doc);
  const a = <a href={href} target="_blank" rel="noopener noreferrer">{doc}<span className="sr-only"> {newTab}</span></a>;
  return i < 0 ? <>{sentence} · {a}</> : <>{sentence.slice(0, i)}{a}{sentence.slice(i + doc.length)}</>;
}

// ---------------- 1. company ----------------
export function CompanyStep({ a, set, locale }: StepCtx) {
  const c = a.company; const setC = (p: Partial<Answers['company']>) => set((x) => ({ ...x, company: { ...x.company, ...p } }));
  return (
    <div className="narrow">
      <Head eyebrow={UI.stages[0]![locale]} title={UI.hasBiz[locale]} />
      <RadioGroup req={{ k: "company.hasBiz", label: UI.hasBiz[locale] }} value={c.hasExistingBusiness === null ? null : c.hasExistingBusiness ? 'yes' : 'no'} onChange={(v) => setC(v === 'yes' ? { hasExistingBusiness: true } : { hasExistingBusiness: false, sector: '', size: null, operatesIn: [] })} options={[{ value: 'yes', label: UI.yes[locale] }, { value: 'no', label: UI.no[locale] }]} />
      {c.hasExistingBusiness && (<>
        <Req k="company.sector" label={UI.sector[locale]}><TextField label={UI.sector[locale]} value={c.sector} onChange={(v) => setC({ sector: v })} placeholder={UI.sectorPh[locale]} /></Req>
        <RadioGroup req={{ k: "company.size", label: UI.size[locale] }} legend={UI.size[locale]} value={c.size} onChange={(v) => setC({ size: v })} options={(Object.keys(UI.sizes) as Array<keyof typeof UI.sizes>).map((v) => ({ value: v, label: T(UI.sizes[v], locale) }))} three />
        <Req k="company.operatesIn" label={UI.operatesIn[locale]}><Label>{UI.operatesIn[locale]}</Label>
        <CountryPicker locale={locale} selected={c.operatesIn} onChange={(iso) => setC({ operatesIn: iso })} /></Req>
      </>)}
    </div>
  );
}

// ---------------- 2. project ----------------
export function DestinationsStep({ a, set, locale }: StepCtx) {
  const d = a.destinations;
  const setD = (fn: (x: Answers['destinations']) => Answers['destinations']) => set((x) => ({ ...x, destinations: fn(x.destinations) }));
  return (
    <div className="narrow">
      <Head eyebrow={UI.stages[1]![locale]} title={UI.destTitle[locale]} lead={UI.destLead[locale]} />
      <Req k="dest.list" label={UI.destTitle[locale]}><Label>{UI.destLabel[locale]}</Label>
      <CountryPicker locale={locale} selected={d.list.map((x) => x.iso)} disabledOpen={d.open}
        onChange={(iso) => setD((x) => ({ ...x, open: false, list: iso.map((i) => x.list.find((y) => y.iso === i) ?? { iso: i }) }))} />
      {d.list.length > 0 && (
        <div className="fgrid country-rows">
          {d.list.map((x) => (
            <TextField key={x.iso} label={`${UI.region[locale]} — ${countryName(x.iso, locale)}`} value={x.region ?? ''} onChange={(v) => setD((y) => ({ ...y, list: y.list.map((z) => (z.iso === x.iso ? { ...z, region: v || undefined } : z)) }))} />
          ))}
        </div>
      )}
      <div className="choices" style={{ marginTop: 12 }}>
        {/* «not decided» and chosen countries are mutually exclusive: with countries selected the option is unavailable, so a stray click can never wipe the selection */}
        <label className={`choice ${d.open ? 'on' : ''} ${!d.open && d.list.length > 0 ? 'is-disabled' : ''}`}><input type="checkbox" checked={d.open} disabled={!d.open && d.list.length > 0} onChange={(e) => setD((x) => ({ ...x, open: e.target.checked, list: e.target.checked ? [] : x.list, sameInAll: null }))} /><span>{UI.destOpen[locale]}</span></label>
      </div></Req>
      {/* Final Design Delta (A): «same project in all these countries?» is part of the destinations block; only with 2+ destinations. */}
      {!d.open && d.list.length >= 2 && (
        <Req k="dest.same" label={UI.sameTitle[locale]}><section className="blk" aria-labelledby="same-title">
          <h2 id="same-title" className="qtitle">{UI.sameTitle[locale]}</h2>
          <p className="help">{`${joinNames(d.list.map((x) => countryName(x.iso, locale)), locale)}. ${UI.sameLead[locale]}.`}</p>
          <RadioGroup value={d.sameInAll === null ? null : d.sameInAll ? 'yes' : 'no'} onChange={(v) => setD((x) => ({ ...x, sameInAll: v === 'yes' }))}
            options={[{ value: 'yes', label: (d.list.length === 2 ? UI.sameYes : UI.sameYesMany)[locale] }, { value: 'no', label: UI.sameNo[locale] }]} />
        </section></Req>
      )}
    </div>
  );
}
const joinNames = (names: string[], loc: Locale) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} ${UI.and[loc]} ${names[names.length - 1]}` : names.join(''));
/** "Only invest, without operating" is exclusive: choosing it clears the rest; choosing anything else drops it. */
export function nextActivities(next: Activity[], prev: Activity[]): Activity[] {
  if (next.includes('invest_only') && !prev.includes('invest_only')) return ['invest_only'];
  if (next.includes('invest_only') && prev.includes('invest_only')) return next.filter((x) => x !== 'invest_only');
  return next;
}
const eyebrowFor = (a: Answers, c: ProjectComponent, loc: Locale) => (a.components.length > 1 ? compName(c, loc) : UI.stages[1]![loc]);
export function ActivityStep(s: StepCtx & { compId: string }) {
  const { a, locale, compId } = s; const c = a.components.find((x) => x.id === compId); if (!c) return null;
  const needsWith = c.activities.some((x) => x === 'sell' || x === 'produce' || x === 'source');
  const acts: Activity[] = ['sell', 'produce', 'source', 'operate', 'hire', 'invest_only'];
  return (
    <div className="narrow">
      <Head eyebrow={eyebrowFor(a, c, locale)} title={CT(UI.actTitle, locale, c)} lead={UI.actHelp[locale]} />
      <CheckGroup req={{ k: "act.acts", label: CT(UI.actTitle, locale, c) }} values={c.activities} onChange={(v) => upd(s, compId, (x) => ({ ...x, activities: nextActivities(v, x.activities) }))}
        options={acts.map((v) => ({ value: v, label: T(UI.acts[v], locale) }))} />
      {needsWith && <CheckGroup req={{ k: "act.with", label: CT(UI.withTitle, locale, c) }} legend={CT(UI.withTitle, locale, c)} values={c.withWhat} onChange={(v) => upd(s, compId, (x) => ({ ...x, withWhat: v }))} options={(['goods', 'services', 'digital'] as const).map((v) => ({ value: v, label: T(UI.withs[v], locale) }))} />}
      <TextField label={UI.descPh[locale]} value={c.description ?? ''} onChange={(v) => upd(s, compId, (x) => ({ ...x, description: v || undefined }))} />
      {isLastProjectScreen(a, 'activity', compId) && <ClarityQuestion a={a} set={s.set} locale={locale} />}
    </div>
  );
}
/**
 * The canonical clarity question (QB 15, D-079) — asked at the end of the LAST project screen (the old «this is what we understand» checkpoint is gone).
 * YES → the «mark the topics» shortcut; NO → the diagnostic path. Unanswered behaves as NO (as confirming the old checkpoint did).
 */
function ClarityQuestion({ a, set, locale }: Pick<StepCtx, 'a' | 'set' | 'locale'>) {
  return (
    <section className="blk" data-testid="clarity-question">
      <RadioGroup legend={UI.r1Know[locale]} value={a.knowsNeeds === null ? null : a.knowsNeeds ? 'yes' : 'no'} onChange={(v) => set((x) => ({ ...x, knowsNeeds: v === 'yes' }))}
        options={[{ value: 'yes', label: UI.yes[locale] }, { value: 'no', label: UI.no[locale] }]} three />
      <p className="help">{UI.r1KnowHelp[locale]}</p>
    </section>
  );
}
const isLastProjectScreen = (a: Answers, id: string, comp: string) => { const l = lastProjectStep(a); return l.id === id && l.comp === comp; };

/** Presence + permanence + what you have there today — one screen per country/component (Final Design Delta B). Every question names its country. */
export function PresenceStep(s: StepCtx & { compId: string }) {
  const { locale, compId } = s; const c = s.a.components.find((x) => x.id === compId); if (!c) return null;
  return (
    <div className="narrow">
      <Head eyebrow={eyebrowFor(s.a, c, locale)} title={CT(UI.presTitle, locale, c)} />
      <RadioGroup req={{ k: "pres.how", label: CT(UI.presTitle, locale, c) }} two value={c.presence} onChange={(v) => upd(s, compId, (x) => ({ ...x, presence: v }))} options={(Object.keys(UI.pres) as Array<keyof typeof UI.pres>).map((v) => ({ value: v, label: T(UI.pres[v], locale) }))} />
      <section className="blk">
        <RadioGroup req={{ k: "pres.perm", label: CT(UI.perm, locale, c) }} three legend={CT(UI.perm, locale, c)} help={UI.permHelp[locale]} value={c.permanence} onChange={(v) => upd(s, compId, (x) => ({ ...x, permanence: v, durationMonths: v === 'temporary' ? x.durationMonths : undefined }))} options={(['permanent', 'temporary', 'open'] as const).map((v) => ({ value: v, label: T(UI.permOpts[v], locale) }))} />
        {c.permanence === 'temporary' && <TextField label={UI.months[locale]} type="number" value={c.durationMonths ? String(c.durationMonths) : ''} onChange={(v) => upd(s, compId, (x) => ({ ...x, durationMonths: v ? Math.max(1, Math.min(600, Math.round(+v))) : undefined }))} />}
      </section>
      <section className="blk">
        <RadioGroup req={{ k: "pres.exist", label: CT(UI.existTitle, locale, c) }} legend={CT(UI.existTitle, locale, c)} value={c.existing === 'via_third' ? 'commercial_traction' : c.existing} onChange={(v) => upd(s, compId, (x) => ({ ...x, existing: v }))} options={(['nothing', 'commercial_traction', 'own'] as const).map((v) => ({ value: v, label: T(UI.exist[v], locale) }))} />
        {c.existing !== null && c.existing !== 'nothing' && <TextField label={UI.existNote[locale]} help={UI.existNoteHelp[locale]} value={c.existingNote ?? ''} onChange={(v) => upd(s, compId, (x) => ({ ...x, existingNote: v || undefined }))} />}
      </section>
      {isLastProjectScreen(s.a, 'presence', compId) && <ClarityQuestion a={s.a} set={s.set} locale={locale} />}
    </div>
  );
}

// ---------------- 3. why & when ----------------
export function ReasonStep({ a, set, locale }: StepCtx) {
  return (
    <div className="narrow">
      <Head eyebrow={UI.reasonEyebrow[locale]} title={UI.reasonTitle[locale]} />
      <CheckGroup req={{ k: "reason", label: UI.reasonTitle[locale] }} values={a.reasons} onChange={(v) => set((x) => ({ ...x, reasons: v }))} options={(Object.keys(UI.reasons) as Array<keyof typeof UI.reasons>).map((v) => ({ value: v, label: T(UI.reasons[v], locale) }))} two />
      <TextField multiline label={UI.reasonWords[locale]} help={UI.reasonWordsHelp[locale]} value={a.reasonText} onChange={(v) => set((x) => ({ ...x, reasonText: v }))} />
    </div>
  );
}
export function DecisionStep(s: StepCtx) {
  const { a, set, locale } = s; const dec = a.decision;
  return (
    <div className="narrow">
      <Head eyebrow={UI.stages[2]![locale]} title={UI.decTitle[locale]} />
      <RadioGroup req={{ k: "dec.state", label: UI.decTitle[locale] }} value={dec} onChange={(v) => set((x) => ({ ...x, decision: v }))} options={(['exploring', 'decided', 'in_progress'] as const).map((v) => ({ value: v, label: T(UI.dec[v], locale) }))} />
      <TextField label={<>{UI.dependsOn[locale]} <span className="hint">({UI.optional[locale]})</span></>} help={UI.dependsOnHelp[locale]} value={a.dependsOn} onChange={(v) => set((x) => ({ ...x, dependsOn: v }))} />
      <ChipGroup req={{ k: "dec.start", label: UI.startQ[locale] }} legend={UI.startQ[locale]} value={a.startWhen} onChange={(v) => set((x) => ({ ...x, startWhen: v }))} options={(Object.keys(UI.starts) as Array<keyof typeof UI.starts>).map((v) => ({ value: v, label: T(UI.starts[v], locale) }))} />
      <Req k="dec.ext" label={UI.extDate[locale]}><Label>{UI.extDate[locale]}</Label><p className="help">{UI.extDateHelp[locale]}</p>
      <div className="chips" role="radiogroup" aria-label={UI.extDate[locale]}>
        {[false, true].map((v) => <button key={String(v)} type="button" role="radio" aria-checked={a.externalDate.has === v} className={`chip ${a.externalDate.has === v ? 'on' : ''}`} onClick={() => set((x) => ({ ...x, externalDate: v ? { ...x.externalDate, has: true } : { has: false } }))}>{v ? UI.yes[locale] : UI.no[locale]}</button>)}
      </div></Req>
      {a.externalDate.has && (<>
        <DatePick locale={locale} value={a.externalDate.date ?? ''} onChange={(v) => set((x) => ({ ...x, externalDate: { ...x.externalDate, date: v } }))} />
        <TextField label={UI.dateWhat[locale]} value={a.externalDate.what ?? ''} onChange={(v) => set((x) => ({ ...x, externalDate: { ...x.externalDate, what: v } }))} />
      </>)}
      {/* Final Design Delta: the project size (D-149) is the last block of this screen; the shortcut path (D-079) skips it, as before. */}
      {a.knowsNeeds !== true && (
        <section className="blk">
          <h2 className="qtitle">{UI.scaleTitle[locale]}</h2>
          <p className="help">{UI.scaleWhy[locale]}</p>
          {a.components.filter((c) => !c.activities.includes('invest_only')).map((c) => <ScaleField key={c.id} s={s} c={c} />)}
        </section>
      )}
    </div>
  );
}
/** Presentation RC: month or quarter — no day precision (FA does not need it). Stores the same values as before: "YYYY-MM" or "YYYY-Qn". */
function DatePick({ locale, value, onChange }: { locale: Locale; value: string; onChange: (v: string) => void }) {
  const m = /^(\d{4})-(Q[1-4]|\d{2})$/.exec(value);
  const [mode, setMode] = useState<'month' | 'quarter'>(m && m[2]!.startsWith('Q') ? 'quarter' : 'month');
  const year = m ? m[1]! : ''; const part = m ? m[2]! : '';
  const y0 = new Date().getFullYear(); const years = Array.from({ length: 6 }, (_, i) => String(y0 + i));
  const emit = (y: string, p: string) => onChange(y && p ? `${y}-${p}` : '');
  return (
    <div className="datepick">
      <span className="label">{UI.dateLabel[locale]}</span>
      <div className="seg two" role="radiogroup" aria-label={UI.datePrecision[locale]}>
        {(['month', 'quarter'] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={mode === k} className={mode === k ? 'on' : ''} onClick={() => { setMode(k); onChange(''); }}>{k === 'month' ? UI.byMonth[locale] : UI.byQuarter[locale]}</button>)}
      </div>
      <div className="date-row">
        <label><span className="sr-only">{mode === 'month' ? UI.dateMonth[locale] : UI.dateQuarter[locale]}</span>
          <select className="field" value={part} onChange={(e) => emit(year || years[0]!, e.target.value)}>
            <option value="">{mode === 'month' ? UI.dateMonth[locale] : UI.dateQuarter[locale]}</option>
            {mode === 'month' ? UI.monthNames.map((n, i) => <option key={i} value={String(i + 1).padStart(2, '0')}>{n[locale]}</option>) : UI.quarterNames.map((n, i) => <option key={i} value={`Q${i + 1}`}>{n[locale]}</option>)}
          </select></label>
        <label><span className="sr-only">{UI.dateYear[locale]}</span>
          <select className="field" value={year} onChange={(e) => emit(e.target.value, part)}>
            <option value="">{UI.dateYear[locale]}</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select></label>
      </div>
    </div>
  );
}
/** One size question per component (D-149 decides which). «Aún no lo sé» and an empty answer both store "not yet defined"; «Prefiero no decirlo» stores the explicit decline. */
function ScaleField({ s, c }: { s: StepCtx; c: ProjectComponent }) {
  const { a, set, locale } = s;
  const proxy = proxyFor(c); const cur = a.scale[c.id] ?? { proxy, text: '', declined: false };
  const [unsure, setUnsure] = useState(false);
  const setS = (p: Partial<typeof cur>) => set((x) => ({ ...x, scale: { ...x.scale, [c.id]: { ...(x.scale[c.id] ?? { proxy, text: '', declined: false }), proxy, ...p } } }));
  return (
    <div>
      <TextField label={`${UI.scaleQ[proxy][locale]} ${compName(c, locale)}?`} value={cur.declined ? '' : cur.text} onChange={(v) => { setUnsure(false); setS({ text: v, declined: false }); }} />
      <div className="chips" style={{ marginTop: 8 }}>
        <button type="button" className={`chip ${unsure && !cur.declined ? 'on' : ''}`} aria-pressed={unsure && !cur.declined} onClick={() => { setUnsure(true); setS({ declined: false, text: '' }); }}>{UI.scaleUnknown[locale]}</button>
        <button type="button" className={`chip ${cur.declined ? 'on' : ''}`} aria-pressed={cur.declined} onClick={() => { setUnsure(false); setS({ declined: !cur.declined, text: '' }); }}>{UI.scaleDecline[locale]}</button>
      </div>
    </div>
  );
}
// ---------------- 4. what the project needs ----------------
export function ActivatorsStep(s: StepCtx & { mode: 'all' | 'sell' | 'site' }) {
  const { a, set, locale, mode } = s;
  const f = activatorFields(a);
  const showReg = mode !== 'site' && f.regulated; const showSell = mode !== 'site'; const showSite = mode !== 'sell';
  const destNames = a.destinations.open || !a.destinations.list.length ? [UI.countryYouChoose[locale]] : a.destinations.list.map((d) => countryName(d.iso, locale));
  const destList = destNames.length > 1 ? `${destNames.slice(0, -1).join(', ')} ${UI.and[locale]} ${destNames[destNames.length - 1]}` : destNames.join('');
  const sellComps = showSell ? a.components.filter((c) => f.sells.includes(c.id)) : [];
  const siteComps = showSite ? a.components.filter((c) => f.location.includes(c.id)) : [];
  const blocks: Array<{ key: string; q: string; node: ReactNode }> = [];
  if (showReg) blocks.push({ key: 'reg', q: fill(UI.regulated, locale, { destinations: destList }), node: <><p className="help">{UI.regulatedHelp[locale]}</p><RadioGroup value={a.regulated} onChange={(v) => set((x) => ({ ...x, regulated: v }))} options={(['yes', 'no', 'unknown'] as const).map((v) => ({ value: v, label: T(UI[v], locale) }))} /></> });
  for (const c of sellComps) {
    blocks.push({ key: `to-${c.id}`, q: CT(UI.sellsTo, locale, c), node: <RadioGroup value={c.sellsTo} onChange={(v) => upd(s, c.id, (x) => ({ ...x, sellsTo: v }))} options={(['companies', 'government', 'consumers', 'mixed'] as const).map((v) => ({ value: v, label: T(UI.sellsToOpts[v], locale) }))} two /> });
    blocks.push({ key: `br-${c.id}`, q: CT(UI.ownBrand, locale, c), node: <RadioGroup value={c.ownBrand} onChange={(v) => upd(s, c.id, (x) => ({ ...x, ownBrand: v }))} options={(['yes', 'no'] as const).map((v) => ({ value: v, label: T(UI[v], locale) }))} two /> });
  }
  for (const c of siteComps) {
    const regions = c.destinations.map((d) => a.destinations.list.find((x) => x.iso === d)?.region).filter((x): x is string => !!x);
    blocks.push({ key: `lo-${c.id}`, q: CT(c.presence === 'own_onsite' ? UI.locationSite : UI.location, locale, c), node: <>{regions.length > 0 && <p className="help">{fill(UI.locationRegion, locale, { region: regions.join(', ') })}</p>}<RadioGroup value={c.location} onChange={(v) => upd(s, c.id, (x) => ({ ...x, location: v }))} options={(['defined', 'region_only', 'undecided'] as const).map((v) => ({ value: v, label: T(UI.locOpts[v], locale) }))} /></> });
    blocks.push({ key: `ca-${c.id}`, q: CT(UI.carries, locale, c), node: <CheckGroup values={c.carries} onChange={(v) => upd(s, c.id, (x) => ({ ...x, carries: v.includes('nothing') && !x.carries.includes('nothing') ? ['nothing'] : v.filter((y) => y !== 'nothing') }))} options={(['people', 'equipment', 'nothing'] as const).map((v) => ({ value: v, label: T(UI.carryOpts[v], locale) }))} /> });
  }
  // Presentation RC (VT-03): A = several questions → thematic title + intro; B = one question → the question itself is the title (neutral);
  // C = no question → the screen must not exist (flow, Code). Nothing here changes which questions are asked.
  const themeTitle = mode === 'sell' ? UI.sellTitle[locale] : mode === 'site' ? fill(UI.siteTitle, locale, { country: siteComps.length === 1 ? compName(siteComps[0]!, locale) : '' }).replace(/ en $| in $/, '') : UI.actTitle1[locale];
  if (blocks.length === 1) {
    const b = blocks[0]!;
    return <div className="narrow theme single"><Head eyebrow={UI.stages[3]![locale]} title={b.q} /><div className="qblock"><Req k={b.key} label={b.q}>{b.node}</Req></div></div>;
  }
  return (
    <div className="narrow theme">
      <Head eyebrow={UI.stages[3]![locale]} title={themeTitle} lead={mode === 'all' ? undefined : UI.actTitle1[locale]} />
      <ul className="qlist">{blocks.map((b) => <li key={b.key} className="qblock"><h2 className="qtitle">{b.q}</h2><Req k={b.key} label={b.q}>{b.node}</Req></li>)}</ul>
    </div>
  );
}

/** Rules 6 + 9: canonical Front Catalog names, max 3 groups, reasons only from declared negatives (shared with the result). */
function NotApplicable({ a, catalog, locale, dest }: { a: Answers; catalog: PublicCatalog; locale: Locale; dest: string }) {
  const plans = plansFor(a); const plan = plans.find((x) => x.destination === dest); if (!plan) return null;
  const groups = buildNotApplicable(plan, (front) => ({ front, name: { es: frontName(catalog, front, 'es'), en: frontName(catalog, front, 'en') } }), plans.length);
  if (!groups.length) return null;
  return <div style={{ marginTop: 12 }}><b style={{ fontSize: 14 }}>{UI.notApply[locale]}</b>{groups.map((g, i) => <p key={i} className="hint">{g.fronts.map((f) => f.name[locale]).join(' · ')} — {g.reason[locale]}</p>)}</div>;
}
function DependsBlock({ s, dest }: { s: StepCtx; dest: string }) {
  const plan = plansFor(s.a).find((p) => p.destination === dest); if (!plan?.depends.length) return null;
  const loc = s.locale; const country = countryName(dest, loc);
  return (
    <div className="dep"><b>{UI.dependsTitle[loc]} {UI.causes[plan.dependsCause ?? 'presence'][loc]}{plan.dependsCause === 'hire' ? '' : ` ${country}`}.</b> {UI.dependsLead[loc]}
      <ul>{plan.depends.map((d) => <li key={d.front}><span>{frontName(s.catalog, d.front, loc)}</span><span className="tag">{UI.dependsTag[loc]}</span></li>)}</ul></div>
  );
}
function AddNeed({ s, dest }: { s: StepCtx; dest: string }) {
  const [text, setText] = useState('');
  const mine = s.a.addedNeeds.filter((n) => n.destination === dest || (!n.destination && dest !== OPEN_DEST));
  const loc = s.locale;
  const premiumShown = s.res.premiumShown;
  const add = () => { const v = text.trim(); if (!v) return; s.set((x) => ({ ...x, addedNeeds: [...x.addedNeeds, { id: `n${Date.now()}${x.addedNeeds.length}`, text: v.slice(0, 500), destination: dest }] })); setText(''); };
  return (
    <div style={{ marginTop: 16 }}>
      <label className="label" htmlFor={`add-${dest}`}>{s.a.knowsNeeds ? UI.concreteQ[loc] : UI.missing[loc]}</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input id={`add-${dest}`} className="field" value={text} placeholder={s.a.knowsNeeds ? UI.concretePh[loc] : UI.missingPh[loc]} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" className="btn outline" onClick={add}>{UI.add[loc]}</button>
      </div>
      {mine.map((n) => {
        const m = mapTextWithIndex(n.text, s.catalog.textIndex);
        return (
          <div key={n.id} className="card soft" style={{ marginTop: 8 }}>
            <p className="quote">«{n.text}»</p>
            <p className="hint">{m.front ? <>{UI.related[loc]} <b>{frontName(s.catalog, m.front, loc)}</b></> : STATE_MESSAGES[visibleStateKey('UNMAPPED_NEED', premiumShown)][loc]}.</p>
            <button type="button" className="linkbtn" onClick={() => s.set((x) => ({ ...x, addedNeeds: x.addedNeeds.filter((y) => y.id !== n.id) }))}>{UI.remove[loc]}</button>
          </div>
        );
      })}
    </div>
  );
}

export function FrontsStatusStep(s: StepCtx) {
  const { a, locale: loc } = s; const plans = plansFor(a);
  const setFront = (dest: string, f: FrontKey, p: Partial<Answers['fronts'][string]>) => s.set((x) => ({ ...x, fronts: { ...x.fronts, [frontKey(dest, f)]: { ...x.fronts[frontKey(dest, f)], ...p } } }));
  return (
    <div>
      <Head eyebrow={UI.stages[3]![loc]} title={UI.topicsTitle[loc]} lead={`${UI.topicsLead[loc]}${a.externalDate.has ? UI.topicsLeadDate[loc] : ''}.`} />
      {plans.map((p) => (
        <section key={p.destination} aria-label={countryName(p.destination, loc)}>
          <div className="dest-head"><h2>{countryName(p.destination, loc)}{a.destinations.list.find((d) => d.iso === p.destination)?.region ? ` · ${a.destinations.list.find((d) => d.iso === p.destination)!.region}` : ''}</h2><span className="hint">{p.applies.length} {UI.topics[loc]}</span></div>
          {p.applies.map((t) => {
            const cur = a.fronts[frontKey(p.destination, t.front)]?.status;
            return (
              <div className="topic" key={t.front}>
                <div className="name">{frontName(s.catalog, t.front, loc)} {t.verdict.possible && <span className="tag">{UI.possible[loc]}</span>}</div>
                <div className="why">{becauseText(t.verdict.because, loc)}</div>
                <div className="seg-wrap"><Segmented label={frontName(s.catalog, t.front, loc)} value={cur} onChange={(v) => setFront(p.destination, t.front, { status: v })}
                  options={(['resolved', 'in_progress', 'pending', 'unknown'] as const).map((v) => ({ value: v, label: UI.statuses[v][loc] }))} /></div>
              </div>
            );
          })}
          <DependsBlock s={s} dest={p.destination} />
          <NotApplicable a={a} catalog={s.catalog} locale={loc} dest={p.destination} />
          <AddNeed s={s} dest={p.destination} />
        </section>
      ))}
    </div>
  );
}

/** Desktop (frozen Design): ONE table — topic, status, support and (when there is an external date) critical date, per row. */
export function FrontsTableStep(s: StepCtx) {
  const { a, locale: loc } = s; const plans = plansFor(a);
  const setFront = (dest: string, f: FrontKey, p: Partial<Answers['fronts'][string]>) => s.set((x) => ({ ...x, fronts: { ...x.fronts, [frontKey(dest, f)]: { ...x.fronts[frontKey(dest, f)], ...p } } }));
  const raw = a.externalDate.date; const when = raw ? formatKeyDate(raw, loc) : '';
  const critLabel = `${UI.readyBefore[loc]} ${when}?`;
  const yn = (v: boolean | undefined) => (v === undefined ? undefined : v ? 'yes' : 'no');
  return (
    <div>
      <Head eyebrow={UI.stages[3]![loc]} title={UI.topicsTitle[loc]} lead={`${UI.topicsLead[loc]}${a.externalDate.has ? UI.topicsLeadDate[loc] : ''}.`} />
      <CargoBlock {...s} />
      {plans.map((p) => (
        <section key={p.destination} aria-label={countryName(p.destination, loc)}>
          <div className="dest-head"><h2>{countryName(p.destination, loc)}{a.destinations.list.find((d) => d.iso === p.destination)?.region ? ` · ${a.destinations.list.find((d) => d.iso === p.destination)!.region}` : ''}</h2><span className="hint">{p.applies.length} {UI.topics[loc]}</span></div>
          <div className="ftable" role="table" aria-label={countryName(p.destination, loc)}>
            <div className="ftable-head" role="row"><span role="columnheader">{UI.colTopic[loc]}</span><span role="columnheader">{UI.colStatus[loc]}</span><span role="columnheader">{UI.colSupport[loc]}</span></div>
            {p.applies.map((t) => {
              const fk = frontKey(p.destination, t.front); const cur = a.fronts[fk];
              const showSupport = cur?.status !== 'resolved';
              const name = frontName(s.catalog, t.front, loc);
              return (
                <div className="ftable-row" role="row" key={t.front}>
                  <div role="cell"><div className="name">{name} {t.verdict.possible && <span className="tag">{UI.possible[loc]}</span>}</div><div className="why">{becauseText(t.verdict.because, loc)}</div></div>
                  <div role="cell"><Segmented label={`${name} — ${UI.colStatus[loc]}`} value={cur?.status} onChange={(v) => setFront(p.destination, t.front, { status: v })}
                    options={(['resolved', 'in_progress', 'pending', 'unknown'] as const).map((v) => ({ value: v, label: UI.statuses[v][loc] }))} /></div>
                  <div role="cell">
                    {showSupport && <Segmented cols={3} label={`${name} — ${UI.colSupport[loc]}`} value={cur?.support} onChange={(v) => setFront(p.destination, t.front, { support: v })}
                      options={[{ value: 'yes', label: UI.yes[loc] }, { value: 'no', label: UI.no[loc] }, { value: 'unknown', label: UI.unknown[loc] }]} />}
                    {a.externalDate.has && showSupport && (<><div className="crit-label">{critLabel}</div>
                      <Segmented cols={3} label={`${name} — ${critLabel}`} value={yn(cur?.critical) as 'yes' | 'no' | undefined} onChange={(v) => setFront(p.destination, t.front, { critical: v === 'yes' })}
                        options={[{ value: 'yes', label: UI.yes[loc] }, { value: 'no', label: UI.no[loc] }]} /></>)}
                  </div>
                </div>
              );
            })}
          </div>
          <DependsBlock s={s} dest={p.destination} />
          <NotApplicable a={a} catalog={s.catalog} locale={loc} dest={p.destination} />
          <AddNeed s={s} dest={p.destination} />
        </section>
      ))}
    </div>
  );
}

export function FrontsSupportStep(s: StepCtx) {
  const { a, locale: loc } = s; const plans = plansFor(a);
  const setSupport = (dest: string, f: FrontKey, v: 'yes' | 'no' | 'unknown') => s.set((x) => ({ ...x, fronts: { ...x.fronts, [frontKey(dest, f)]: { ...x.fronts[frontKey(dest, f)], support: v } } }));
  return (
    <div>
      <Head eyebrow={UI.stages[3]![loc]} title={UI.supportTitle[loc]} lead={UI.supportLead[loc]} />
      <CargoBlock {...s} />
      {plans.map((p) => {
        const rows = p.applies.filter((t) => a.fronts[frontKey(p.destination, t.front)]?.status !== 'resolved');
        if (!rows.length) return null;
        return (
          <section key={p.destination}>
            <div className="dest-head"><h2>{countryName(p.destination, loc)}</h2><span className="hint">{rows.length} {UI.topics[loc]}</span></div>
            {rows.map((t) => (
              <div className="topic" key={t.front}>
                <div className="name" style={{ marginBottom: 8 }}>{frontName(s.catalog, t.front, loc)}</div>
                <div className="seg-wrap"><Segmented cols={3} label={frontName(s.catalog, t.front, loc)} value={a.fronts[frontKey(p.destination, t.front)]?.support}
                  onChange={(v) => setSupport(p.destination, t.front, v)} options={[{ value: 'yes', label: UI.yes[loc] }, { value: 'no', label: UI.no[loc] }, { value: 'unknown', label: UI.unknown[loc] }]} /></div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

export function FrontsMarkStep(s: StepCtx) {
  const { a, locale: loc } = s; const plans = plansFor(a);
  const res = s.res;
  const marked = res.destinations.flatMap((d) => d.topics).filter((t) => t.kind === 'applies' && !t.notIndicated).length;
  const total = res.destinations.flatMap((d) => d.topics).filter((t) => t.kind === 'applies').length;
  const setMark = (dest: string, f: FrontKey, v: boolean) => s.set((x) => ({ ...x, fronts: { ...x.fronts, [frontKey(dest, f)]: { ...x.fronts[frontKey(dest, f)], marked: v } } }));
  return (
    <div>
      <Head eyebrow={`${UI.stages[3]![loc]} · 1 ${UI.of[loc]} 2`} title={UI.markTitle[loc]} lead={UI.markLead[loc]} />
      <CargoBlock {...s} />
      <p className="hint" role="status">{UI.markedCount[loc]} {marked} · {UI.notIndicated[loc]} {total - marked}</p>
      {plans.map((p) => (
        <section key={p.destination}>
          <div className="dest-head"><h2>{UI.applyHere[loc]} — {countryName(p.destination, loc)}</h2></div>
          <div className="choices">
            {p.applies.map((t) => {
              const decl = a.addedNeeds.some((n) => n.destination === p.destination && mapTextWithIndex(n.text, s.catalog.textIndex).front === t.front);
              const on = a.fronts[frontKey(p.destination, t.front)]?.marked === true || decl;
              return (
                <label key={t.front} className={`choice ${on ? 'on' : ''}`}>
                  <input type="checkbox" checked={on} disabled={decl} onChange={(e) => setMark(p.destination, t.front, e.target.checked)} />
                  <span>{t.verdict.possible && <span className="tag" style={{ marginRight: 8 }}>{UI.possible[loc]}</span>}{frontName(s.catalog, t.front, loc)}<span className="sub">{becauseText(t.verdict.because, loc)}</span></span>
                </label>
              );
            })}
          </div>
          <DependsBlock s={s} dest={p.destination} />
          <NotApplicable a={a} catalog={s.catalog} locale={loc} dest={p.destination} />
          <AddNeed s={s} dest={p.destination} />
        </section>
      ))}
    </div>
  );
}

export function FrontsCriticalStep(s: StepCtx) {
  const { a, locale: loc } = s; const res = s.res;
  // the checkbox reflects the user's own (just-typed) answer immediately; the server-resolved value only fills in what was never touched
  const crit = (dest: string, f: FrontKey, fromServer: boolean) => a.fronts[frontKey(dest, f)]?.critical ?? fromServer;
  const setCrit = (dest: string, f: FrontKey, v: boolean) => s.set((x) => ({ ...x, fronts: { ...x.fronts, [frontKey(dest, f)]: { ...x.fronts[frontKey(dest, f)], critical: v } } }));
  const raw = a.externalDate.date;
  const when = raw ? formatKeyDate(raw, loc) : '';
  const quarter = !!raw && /^\d{4}-Q[1-4]$/.test(raw);
  const title = raw ? `${(quarter ? UI.criticalTitleQuarter : UI.criticalTitleDate)[loc]} ${when}?` : UI.criticalTitle[loc];
  return (
    <div>
      <Head eyebrow={`${UI.stages[3]![loc]}`} title={title} lead={UI.criticalLead[loc]} />
      {res.destinations.map((d) => d.needs.filter((n) => !n.dependent).length === 0 ? null : (
        <section key={d.destination}>
          <div className="dest-head"><h2>{countryName(d.destination, loc)}</h2></div>
          <div className="choices">
            {d.needs.filter((n) => !n.dependent).map((n) => (
              <label key={n.front} className={`choice ${crit(d.destination, n.front, n.critical) ? 'on' : ''}`}><input type="checkbox" checked={crit(d.destination, n.front, n.critical)} onChange={(e) => setCrit(d.destination, n.front, e.target.checked)} /><span>{frontName(s.catalog, n.front, loc)}</span></label>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The cargo-route question (I-26, D-119) as a block at the start of the topics screen; shown only where the server-side resolution says it is relevant. */
export function CargoBlock(s: StepCtx) {
  const { a, locale: loc } = s; const dests = s.res.cargoRouteDestinations.filter((d) => a.cargoRoute[d] === undefined);
  const all = [...new Set([...dests, ...Object.keys(a.cargoRoute)])];
  if (!all.length) return null;
  return (
    <section className="blk cargo" data-testid="topics-cargo" aria-labelledby="cargo-title">
      <h2 id="cargo-title" className="qtitle">{UI.cargoTitle[loc]}</h2>
      {all.map((d) => {
        const opts = UI.cargo(countryName(d, loc));
        return <RadioGroup key={d} two legend={all.length > 1 ? countryName(d, loc) : undefined} value={a.cargoRoute[d] ?? null} onChange={(v) => s.set((x) => ({ ...x, cargoRoute: { ...x.cargoRoute, [d]: v } }))}
          options={(['within', 'into_from_abroad', 'both', 'unknown'] as const).map((v) => ({ value: v, label: T(opts[v], loc) }))} />;
      })}
    </section>
  );
}

// ---------------- 5. more ----------------
/** PO: no free-text «in your words» here (the «Algo más» screen has the one open question). `supportWords` stays in the model and the result for answers saved earlier; no screen collects it. */
export function SupportValuesStep({ a, set, locale }: StepCtx) {
  return (
    <div className="narrow">
      <Head eyebrow={UI.stages[4]![locale]} title={UI.valuesTitle[locale]} lead={UI.valuesLead[locale]} />
      <ChipMulti values={a.supportValues} onChange={(v) => set((x) => ({ ...x, supportValues: v }))} options={(Object.keys(UI.values) as Array<keyof typeof UI.values>).map((v) => ({ value: v, label: T(UI.values[v], locale) }))} />
      <TextField label={UI.keepQ[locale]} value={a.keepWords} onChange={(v) => set((x) => ({ ...x, keepWords: v }))} />
    </div>
  );
}
export function ExtraStep({ a, set, locale }: StepCtx) {
  const ctx = a.context; const setC = (p: Partial<Answers['context']>) => set((x) => ({ ...x, context: { ...x.context, ...p } }));
  return (
    <div className="narrow">
      <Head eyebrow={UI.stages[4]![locale]} title={UI.extraTitle[locale]} lead={UI.extraLead[locale]} />
      <TextField multiline label={UI.success[locale]} help={UI.successHelp[locale]} value={ctx.success} onChange={(v) => setC({ success: v })} />
      <TextField multiline label={UI.constraints[locale]} help={UI.constraintsHelp[locale]} value={ctx.constraints} onChange={(v) => setC({ constraints: v })} />
      <TextField multiline label={UI.descr[locale]} value={ctx.description} onChange={(v) => setC({ description: v })} />
      <TextField multiline label={UI.experience[locale]} help={UI.experienceHelp[locale]} value={ctx.experience} onChange={(v) => setC({ experience: v })} />
      <fieldset className="qblock" style={{ border: 0, padding: 0, margin: '8px 0 0' }}><legend className="label">{UI.personal[locale]}</legend><p className="help">{UI.personalHelp[locale]}</p><div className="choices"><label className={`choice ${ctx.personalNeed ? 'on' : ''}`}><input type="checkbox" checked={ctx.personalNeed} onChange={(e) => setC({ personalNeed: e.target.checked })} /><span>{UI.yes[locale]}</span></label></div></fieldset>
    </div>
  );
}
