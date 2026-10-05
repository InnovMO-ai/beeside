import { useState, type ReactNode } from 'react';
import type { Answers, ProjectComponent, ScaleProxy } from '@beeside/fa-public-engine';
import { frontKey, OPEN_DEST } from '@beeside/fa-public-engine';
import type { Activity, ClientResolution, FrontKey, Locale, PublicCatalog } from '@beeside/fa-public-engine';
import { BRAND } from '../brand';
import { activatorFields, isValidEmail } from '@beeside/fa-public-engine';
import { plansFor } from '@beeside/fa-public-engine';
import { mapTextWithIndex } from '@beeside/fa-public-engine';
import { buildNotApplicable, formatKeyDate, reflectionParagraphs, type Seg } from '@beeside/fa-public-engine';
import { countryName, STATE_MESSAGES, visibleStateKey } from '@beeside/fa-public-engine';
import { UI, becauseText } from '../copy/ui';
import { CheckGroup, ChipGroup, ChipMulti, CountryPicker, Label, RadioGroup, Segmented, TextField } from './controls';

export interface StepCtx { a: Answers; set: (fn: (a: Answers) => Answers) => void; locale: Locale; catalog: PublicCatalog; res: ClientResolution; goTo: (step: string) => void }
const T = (l: { es: string; en: string }, loc: Locale) => l[loc];

function Head({ eyebrow, title, lead, tint }: { eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode; tint?: boolean }) {
  return <header style={tint ? undefined : undefined}>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1 className="h1">{title}</h1>{lead && <p className="lead">{lead}</p>}</header>;
}
const compName = (c: ProjectComponent, loc: Locale) => c.destinations.map((d) => (d === OPEN_DEST ? UI.countryYouChoose[loc] : countryName(d, loc))).join(` ${UI.and[loc]} `);
const frontName = (cat: PublicCatalog, f: FrontKey, loc: Locale) => { const d = cat.fronts.find((x) => x.key === f); return d ? { es: d.nameEs, en: d.nameEn }[loc] : f; };
const upd = (s: StepCtx, id: string, fn: (c: ProjectComponent) => ProjectComponent) => s.set((a) => ({ ...a, components: a.components.map((c) => (c.id === id ? fn(c) : c)) }));

// ---------------- identity ----------------
export function IdentityStep({ a, set, locale }: StepCtx) {
  const id = a.identity; const [touched, setTouched] = useState(false);
  const setId = (p: Partial<Answers['identity']>) => set((x) => ({ ...x, identity: { ...x.identity, ...p } }));
  return (
    <div className="narrow">
      <Head title={UI.idTitle[locale]} lead={UI.idLead[locale]} />
      <TextField label={UI.name[locale]} value={id.name} onChange={(v) => setId({ name: v })} autoComplete="name" />
      <TextField label={UI.company[locale]} value={id.company} onChange={(v) => setId({ company: v })} autoComplete="organization" />
      <div onBlur={() => setTouched(true)}>
        <TextField label={UI.email[locale]} type="email" value={id.email} onChange={(v) => setId({ email: v })} autoComplete="email" help={UI.emailHelp[locale]} invalid={touched && id.email && !isValidEmail(id.email) ? UI.emailInvalid[locale] : undefined} />
      </div>
      <TextField label={<>{UI.role[locale]} <span className="hint">({UI.optional[locale]})</span></>} value={id.role} onChange={(v) => setId({ role: v })} />
      <RadioGroup legend={UI.decider[locale]} value={id.decider} onChange={(v) => setId({ decider: v })} options={(['me', 'other', 'shared'] as const).map((v) => ({ value: v, label: T(UI.deciderOpts[v], locale) }))} />
      {/* Closing section of Identity: separated from "who decides" by space + a divider; required acceptances only (optional marketing consent is NOT rendered until LEGAL-1 defines its basis). */}
      <section className="id-legal" aria-labelledby="id-legal-title">
        <h2 id="id-legal-title">{UI.idBeforeTitle[locale]}</h2>
        <p className="hint">{UI.idBeforeLead[locale]}</p>
        <div className="choices">
        <label className="choice"><input type="checkbox" checked={id.termsAccepted} onChange={(e) => setId({ termsAccepted: e.target.checked })} /><span>{UI.terms[locale]} — <a href={BRAND.legal.termsUrl[locale]} target="_blank" rel="noopener noreferrer">{UI.termsLink[locale]}<span className="sr-only"> {UI.openInNewTab[locale]}</span></a></span></label>
        <label className="choice"><input type="checkbox" checked={id.privacyAcknowledged} onChange={(e) => setId({ privacyAcknowledged: e.target.checked })} /><span>{UI.privacy[locale]} — <a href={BRAND.legal.privacyUrl[locale]} target="_blank" rel="noopener noreferrer">{UI.privacyLink[locale]}<span className="sr-only"> {UI.openInNewTab[locale]}</span></a></span></label>
        </div>
        {/* OPTIONAL and independent: unchecked by default, never implied by Terms / Privacy, does not gate "Accept and continue". */}
        <div className="id-optional">
          <p className="id-optional-cap">{UI.idOptionalComms[locale]}</p>
          <label className="choice soft"><input type="checkbox" checked={id.marketingConsent === true} onChange={(e) => setId({ marketingConsent: e.target.checked })} /><span>{UI.marketingConsent[locale]}</span></label>
        </div>
        <p className="trust">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3l7 3v5c0 4.4-2.9 8.3-7 10-4.1-1.7-7-5.6-7-10V6z" /><path d="M9 12l2 2 4-4" /></svg>
          <span>{UI.privacyNotice[locale]}</span>
        </p>
      </section>
    </div>
  );
}

// ---------------- 1. company ----------------
export function CompanyStep({ a, set, locale }: StepCtx) {
  const c = a.company; const setC = (p: Partial<Answers['company']>) => set((x) => ({ ...x, company: { ...x.company, ...p } }));
  return (
    <div className="narrow">
      <Head eyebrow={UI.stages[0]![locale]} title={UI.coTitle[locale]} />
      <RadioGroup legend={UI.hasBiz[locale]} value={c.hasExistingBusiness === null ? null : c.hasExistingBusiness ? 'yes' : 'no'} onChange={(v) => setC({ hasExistingBusiness: v === 'yes' })} options={[{ value: 'yes', label: UI.yes[locale] }, { value: 'no', label: UI.no[locale] }]} />
      {c.hasExistingBusiness && (<>
        <TextField label={UI.sector[locale]} value={c.sector} onChange={(v) => setC({ sector: v })} placeholder={UI.sectorPh[locale]} />
        <RadioGroup legend={UI.size[locale]} value={c.size} onChange={(v) => setC({ size: v })} options={(Object.keys(UI.sizes) as Array<keyof typeof UI.sizes>).map((v) => ({ value: v, label: T(UI.sizes[v], locale) }))} two />
        <Label>{UI.operatesIn[locale]}</Label>
        <CountryPicker locale={locale} selected={c.operatesIn} onChange={(iso) => setC({ operatesIn: iso })} />
      </>)}
    </div>
  );
}
export function ExitStep({ locale }: StepCtx) { return <div className="narrow"><Head title={UI.exitTitle[locale]} lead={UI.exitBody[locale]} /></div>; }

// ---------------- 2. project ----------------
export function DestinationsStep({ a, set, locale }: StepCtx) {
  const d = a.destinations;
  const setD = (fn: (x: Answers['destinations']) => Answers['destinations']) => set((x) => ({ ...x, destinations: fn(x.destinations) }));
  return (
    <div className="narrow">
      <Head eyebrow={UI.stages[1]![locale]} title={UI.destTitle[locale]} lead={UI.destLead[locale]} />
      <Label>{UI.destLabel[locale]}</Label>
      <CountryPicker locale={locale} selected={d.list.map((x) => x.iso)} disabledOpen={d.open}
        onChange={(iso) => setD((x) => ({ ...x, open: false, list: iso.map((i) => x.list.find((y) => y.iso === i) ?? { iso: i }) }))} />
      {d.list.map((x) => (
        <TextField key={x.iso} label={`${UI.region[locale]} — ${countryName(x.iso, locale)}`} value={x.region ?? ''} onChange={(v) => setD((y) => ({ ...y, list: y.list.map((z) => (z.iso === x.iso ? { ...z, region: v || undefined } : z)) }))} />
      ))}
      <div className="choices" style={{ marginTop: 16 }}>
        <label className={`choice ${d.open ? 'on' : ''}`}><input type="checkbox" checked={d.open} onChange={(e) => setD((x) => ({ ...x, open: e.target.checked, list: e.target.checked ? [] : x.list, sameInAll: null }))} /><span>{UI.destOpen[locale]}</span></label>
      </div>
    </div>
  );
}
export function SameInAllStep({ a, set, locale }: StepCtx) {
  const names = a.destinations.list.map((x) => countryName(x.iso, locale));
  const joined = names.length > 1 ? `${names.slice(0, -1).join(', ')} ${UI.and[locale]} ${names[names.length - 1]}` : names.join('');
  return (
    <div className="narrow">
      <Head eyebrow={UI.stages[1]![locale]} title={`${UI.sameTitle[locale]} ${joined}?`} lead={UI.sameLead[locale]} />
      <RadioGroup value={a.destinations.sameInAll === null ? null : a.destinations.sameInAll ? 'yes' : 'no'} onChange={(v) => set((x) => ({ ...x, destinations: { ...x.destinations, sameInAll: v === 'yes' } }))}
        options={[{ value: 'yes', label: (a.destinations.list.length === 2 ? UI.sameYes : UI.sameYesMany)[locale] }, { value: 'no', label: UI.sameNo[locale] }]} />
    </div>
  );
}
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
      <Head eyebrow={eyebrowFor(a, c, locale)} title={UI.actTitle[locale]} />
      <CheckGroup values={c.activities} onChange={(v) => upd(s, compId, (x) => ({ ...x, activities: nextActivities(v, x.activities) }))}
        options={acts.map((v) => ({ value: v, label: T(UI.acts[v], locale) }))} />
      {needsWith && <CheckGroup legend={UI.withTitle[locale]} values={c.withWhat} onChange={(v) => upd(s, compId, (x) => ({ ...x, withWhat: v }))} options={(['goods', 'services', 'digital'] as const).map((v) => ({ value: v, label: T(UI.withs[v], locale) }))} />}
      <TextField label={UI.descPh[locale]} value={c.description ?? ''} onChange={(v) => upd(s, compId, (x) => ({ ...x, description: v || undefined }))} />
    </div>
  );
}
export function PresenceStep(s: StepCtx & { compId: string }) {
  const { locale, compId } = s; const c = s.a.components.find((x) => x.id === compId); if (!c) return null;
  return (
    <div className="narrow">
      <Head eyebrow={eyebrowFor(s.a, c, locale)} title={UI.presTitle[locale]} />
      <RadioGroup value={c.presence} onChange={(v) => upd(s, compId, (x) => ({ ...x, presence: v }))} options={(Object.keys(UI.pres) as Array<keyof typeof UI.pres>).map((v) => ({ value: v, label: T(UI.pres[v], locale) }))} />
      <RadioGroup legend={UI.perm[locale]} value={c.permanence} onChange={(v) => upd(s, compId, (x) => ({ ...x, permanence: v, durationMonths: v === 'temporary' ? x.durationMonths : undefined }))} options={(['permanent', 'temporary', 'open'] as const).map((v) => ({ value: v, label: T(UI.permOpts[v], locale) }))} />
      {c.permanence === 'temporary' && <TextField label={UI.months[locale]} type="number" value={c.durationMonths ? String(c.durationMonths) : ''} onChange={(v) => upd(s, compId, (x) => ({ ...x, durationMonths: v ? Math.max(1, Math.min(600, Math.round(+v))) : undefined }))} />}
    </div>
  );
}
export function ExistingStep(s: StepCtx & { compId: string }) {
  const { locale, compId } = s; const c = s.a.components.find((x) => x.id === compId); if (!c) return null;
  return (
    <div className="narrow">
      <Head eyebrow={eyebrowFor(s.a, c, locale)} title={UI.existTitle[locale]} />
      <RadioGroup value={c.existing} onChange={(v) => upd(s, compId, (x) => ({ ...x, existing: v }))} options={(['nothing', 'via_third', 'own'] as const).map((v) => ({ value: v, label: T(UI.exist[v], locale) }))} />
      {(c.existing === 'via_third' || c.existing === 'own') && <TextField label={UI.existNote[locale]} value={c.existingNote ?? ''} onChange={(v) => upd(s, compId, (x) => ({ ...x, existingNote: v || undefined }))} />}
    </div>
  );
}
export function ReflectionStep({ a, set, locale, goTo }: StepCtx) {
  // Frozen R1: lavender band, the company sentence as headline, one white card per destination, every fragment editable in place.
  const [lead, ...cards] = reflectionParagraphs(a);
  const frags = (segs: Seg[]) => segs.map((g, i) => {
    const text = g.text[locale];
    const br = g.br ? <br /> : null;
    if (!g.edit) return <span key={i}>{br}{text}</span>;
    const [, pre = '', core = '', post = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? [];   // boundary spaces stay outside the button so the sentence reads naturally
    return <span key={i}>{br}{pre}<button type="button" className="frag" onClick={() => goTo(g.edit!)}>{core}</button>{post}</span>;
  });
  return (
    <div className="r1">
      <div className="r1-main">
        <p className="eyebrow">{a.identity.name.trim() ? `${a.identity.name.trim().split(/\s+/)[0]}, ${UI.r1EyebrowNamed[locale]}` : UI.r1Eyebrow[locale]}</p>
        <p className="r1-lead">{lead && lead.length ? frags(lead) : null}</p>
        <div className="r1-cards">{cards.map((c, i) => <div className="r1-card" key={i}><p>{frags(c)}</p></div>)}</div>
        <p className="hint r1-fix">{UI.r1Fix[locale]}</p>
      </div>
      <aside className="r1-aside">
        <b>{UI.r1Know[locale]}</b><p className="hint">{UI.r1KnowHelp[locale]}</p>
        <button type="button" className="btn outline" style={{ flex: 'none' }} onClick={() => { set((x) => ({ ...x, projectConfirmed: true, knowsNeeds: true })); goTo('reason'); }}>{UI.r1Direct[locale]}</button>
      </aside>
    </div>
  );
}

// ---------------- 3. why & when ----------------
export function ReasonStep({ a, set, locale }: StepCtx) {
  return (
    <div className="narrow">
      <Head eyebrow={UI.reasonEyebrow[locale]} title={UI.reasonTitle[locale]} />
      <CheckGroup values={a.reasons} onChange={(v) => set((x) => ({ ...x, reasons: v }))} options={(Object.keys(UI.reasons) as Array<keyof typeof UI.reasons>).map((v) => ({ value: v, label: T(UI.reasons[v], locale) }))} two />
      <TextField multiline label={UI.reasonWords[locale]} value={a.reasonText} onChange={(v) => set((x) => ({ ...x, reasonText: v }))} />
      {a.reasonText.trim() && <div className="card soft" style={{ marginTop: 12 }}><p className="hint">{UI.reasonMirror[locale]}</p><p className="quote">“{a.reasonText.trim()}”</p></div>}
    </div>
  );
}
export function DecisionStep({ a, set, locale }: StepCtx) {
  const dec = a.decision;
  return (
    <div className="narrow">
      <Head eyebrow={UI.stages[2]![locale]} title={UI.decTitle[locale]} />
      <RadioGroup value={dec} onChange={(v) => set((x) => ({ ...x, decision: v }))} options={(['exploring', 'decided', 'in_progress'] as const).map((v) => ({ value: v, label: T(UI.dec[v], locale) }))} />
      <TextField label={<>{UI.dependsOn[locale]} <span className="hint">({UI.optional[locale]})</span></>} value={a.dependsOn} onChange={(v) => set((x) => ({ ...x, dependsOn: v }))} />
      <ChipGroup legend={UI.startQ[locale]} value={a.startWhen} onChange={(v) => set((x) => ({ ...x, startWhen: v }))} options={(Object.keys(UI.starts) as Array<keyof typeof UI.starts>).map((v) => ({ value: v, label: T(UI.starts[v], locale) }))} />
      <Label>{UI.extDate[locale]}</Label><p className="help">{UI.extDateHelp[locale]}</p>
      <div className="chips" role="radiogroup" aria-label={UI.extDate[locale]}>
        {[false, true].map((v) => <button key={String(v)} type="button" role="radio" aria-checked={a.externalDate.has === v} className={`chip ${a.externalDate.has === v ? 'on' : ''}`} onClick={() => set((x) => ({ ...x, externalDate: v ? { ...x.externalDate, has: true } : { has: false } }))}>{v ? UI.yes[locale] : UI.no[locale]}</button>)}
      </div>
      {a.externalDate.has && (<>
        <TextField label={UI.dateLabel[locale]} value={a.externalDate.date ?? ''} placeholder={UI.datePh[locale]} onChange={(v) => set((x) => ({ ...x, externalDate: { ...x.externalDate, date: v } }))} />
        <TextField label={UI.dateWhat[locale]} value={a.externalDate.what ?? ''} onChange={(v) => set((x) => ({ ...x, externalDate: { ...x.externalDate, what: v } }))} />
      </>)}
    </div>
  );
}
const proxyFor = (c: ProjectComponent): ScaleProxy => c.permanence === 'temporary' ? 'duration' : c.activities.includes('produce') ? 'investment' : c.activities.includes('hire') && c.activities.length === 1 ? 'people' : c.activities.includes('sell') ? 'products' : c.activities.includes('source') ? 'purchase' : c.activities.includes('hire') ? 'people' : 'investment';
export function ScaleStep({ a, set, locale }: StepCtx) {
  return (
    <div className="narrow">
      <Head eyebrow={UI.stages[2]![locale]} title={UI.scaleTitle[locale]} lead={UI.scaleWhy[locale]} />
      {a.components.filter((c) => !c.activities.includes('invest_only')).map((c) => {
        const proxy = proxyFor(c); const cur = a.scale[c.id] ?? { proxy, text: '', declined: false };
        const setS = (p: Partial<typeof cur>) => set((x) => ({ ...x, scale: { ...x.scale, [c.id]: { ...cur, proxy, ...p } } }));
        return (
          <div key={c.id}>
            <TextField label={`${UI.scaleQ[proxy][locale]} ${compName(c, locale)}?`} value={cur.declined ? '' : cur.text} onChange={(v) => setS({ text: v, declined: false })} />
            <div className="chips" style={{ marginTop: 8 }}>
              <button type="button" className={`chip ${cur.declined ? 'on' : ''}`} aria-pressed={cur.declined} onClick={() => setS({ declined: !cur.declined, text: '' })}>{UI.scaleDecline[locale]}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------- 4. what the project needs ----------------
export function ActivatorsStep(s: StepCtx & { mode: 'all' | 'sell' | 'site' }) {
  const { a, set, locale, mode } = s;
  const f = activatorFields(a);
  const showReg = mode !== 'site' && f.regulated; const showSell = mode !== 'site'; const showSite = mode !== 'sell';
  const title = mode === 'sell' ? UI.sellTitle[locale] : mode === 'site' ? UI.siteTitle[locale] : UI.actTitle1[locale];
  return (
    <div className="narrow">
      <Head eyebrow={UI.stages[3]![locale]} title={title} />
      {showReg && <RadioGroup legend={UI.regulated[locale]} value={a.regulated} onChange={(v) => set((x) => ({ ...x, regulated: v }))} options={(['yes', 'no', 'unknown'] as const).map((v) => ({ value: v, label: T(UI[v], locale) }))} />}
      {showSell && a.components.filter((c) => f.sells.includes(c.id)).map((c) => (
        <div key={c.id}>
          <RadioGroup legend={`${UI.sellsTo[locale]} (${compName(c, locale)})`} value={c.sellsTo} onChange={(v) => upd(s, c.id, (x) => ({ ...x, sellsTo: v }))} options={(['companies', 'government', 'consumers', 'mixed'] as const).map((v) => ({ value: v, label: T(UI.sellsToOpts[v], locale) }))} two />
          <RadioGroup legend={UI.ownBrand[locale]} value={c.ownBrand} onChange={(v) => upd(s, c.id, (x) => ({ ...x, ownBrand: v }))} options={(['yes', 'no'] as const).map((v) => ({ value: v, label: T(UI[v], locale) }))} />
        </div>
      ))}
      {showSite && a.components.filter((c) => f.location.includes(c.id)).map((c) => (
        <div key={c.id}>
          <RadioGroup legend={`${(c.presence === 'own_onsite' ? UI.locationSite : UI.location)[locale]}${f.location.length > 1 ? ` (${compName(c, locale)})` : ''}`} value={c.location} onChange={(v) => upd(s, c.id, (x) => ({ ...x, location: v }))} options={(['defined', 'region_only', 'undecided'] as const).map((v) => ({ value: v, label: T(UI.locOpts[v], locale) }))} />
          <CheckGroup legend={UI.carries[locale]} values={c.carries} onChange={(v) => upd(s, c.id, (x) => ({ ...x, carries: v.includes('nothing') && !x.carries.includes('nothing') ? ['nothing'] : v.filter((y) => y !== 'nothing') }))} options={(['people', 'equipment', 'nothing'] as const).map((v) => ({ value: v, label: T(UI.carryOpts[v], locale) }))} />
        </div>
      ))}
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
  const markAllPending = () => s.set((x) => { const fr = { ...x.fronts }; for (const p of plans) for (const t of p.applies) fr[frontKey(p.destination, t.front)] = { ...fr[frontKey(p.destination, t.front)], status: 'pending' }; return { ...x, fronts: fr }; });
  return (
    <div>
      <Head eyebrow={UI.stages[3]![loc]} title={UI.topicsTitle[loc]} lead={`${UI.topicsLead[loc]}${a.externalDate.has ? UI.topicsLeadDate[loc] : ''}.`} />
      <button type="button" className="btn outline" style={{ width: '100%', borderStyle: 'dashed', maxWidth: 420 }} onClick={markAllPending}>{UI.notStarted[loc]}</button>
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
  const markAllPending = () => s.set((x) => { const fr = { ...x.fronts }; for (const p of plans) for (const t of p.applies) fr[frontKey(p.destination, t.front)] = { ...fr[frontKey(p.destination, t.front)], status: 'pending' }; return { ...x, fronts: fr }; });
  const raw = a.externalDate.date; const when = raw ? formatKeyDate(raw, loc) : '';
  const critLabel = `${UI.readyBefore[loc]} ${when}?`;
  const yn = (v: boolean | undefined) => (v === undefined ? undefined : v ? 'yes' : 'no');
  return (
    <div>
      <Head eyebrow={UI.stages[3]![loc]} title={UI.topicsTitle[loc]} lead={`${UI.topicsLead[loc]}${a.externalDate.has ? UI.topicsLeadDate[loc] : ''}.`} />
      <button type="button" className="btn outline" style={{ width: '100%', borderStyle: 'dashed', maxWidth: 420 }} onClick={markAllPending}>{UI.notStarted[loc]}</button>
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

export function CargoRouteStep(s: StepCtx) {
  const { a, locale: loc } = s; const dests = s.res.cargoRouteDestinations.filter((d) => a.cargoRoute[d] === undefined);
  const all = [...new Set([...dests, ...Object.keys(a.cargoRoute)])];
  return (
    <div className="narrow">
      <Head eyebrow={UI.stages[3]![loc]} title={UI.cargoTitle[loc]} />
      {all.map((d) => {
        const opts = UI.cargo(countryName(d, loc));
        return <RadioGroup key={d} legend={all.length > 1 ? countryName(d, loc) : undefined} value={a.cargoRoute[d] ?? null} onChange={(v) => s.set((x) => ({ ...x, cargoRoute: { ...x.cargoRoute, [d]: v } }))}
          options={(['within', 'into_from_abroad', 'both', 'unknown'] as const).map((v) => ({ value: v, label: T(opts[v], loc) }))} />;
      })}
    </div>
  );
}

// ---------------- 5. more ----------------
export function SupportValuesStep({ a, set, locale }: StepCtx) {
  return (
    <div className="narrow">
      <Head eyebrow={UI.stages[4]![locale]} title={UI.valuesTitle[locale]} lead={UI.valuesLead[locale]} />
      <ChipMulti values={a.supportValues} onChange={(v) => set((x) => ({ ...x, supportValues: v }))} options={(Object.keys(UI.values) as Array<keyof typeof UI.values>).map((v) => ({ value: v, label: T(UI.values[v], locale) }))} />
      <TextField label={UI.valueWords[locale]} value={a.supportWords} onChange={(v) => set((x) => ({ ...x, supportWords: v }))} />
      <TextField label={UI.keepQ[locale]} value={a.keepWords} onChange={(v) => set((x) => ({ ...x, keepWords: v }))} />
    </div>
  );
}
export function ExtraStep({ a, set, locale }: StepCtx) {
  const ctx = a.context; const setC = (p: Partial<Answers['context']>) => set((x) => ({ ...x, context: { ...x.context, ...p } }));
  return (
    <div className="narrow">
      <Head eyebrow={UI.stages[4]![locale]} title={UI.extraTitle[locale]} lead={UI.extraLead[locale]} />
      <TextField multiline label={UI.success[locale]} value={ctx.success} onChange={(v) => setC({ success: v })} />
      <TextField multiline label={UI.constraints[locale]} value={ctx.constraints} onChange={(v) => setC({ constraints: v })} />
      <TextField multiline label={UI.descr[locale]} value={ctx.description} onChange={(v) => setC({ description: v })} />
      <TextField multiline label={UI.experience[locale]} value={ctx.experience} onChange={(v) => setC({ experience: v })} />
      <TextField multiline label={UI.unknowns[locale]} value={ctx.unknowns} onChange={(v) => setC({ unknowns: v })} />
      <div className="choices" style={{ marginTop: 16 }}><label className="choice"><input type="checkbox" checked={ctx.personalNeed} onChange={(e) => setC({ personalNeed: e.target.checked })} /><span>{UI.personal[locale]}</span></label></div>
    </div>
  );
}
