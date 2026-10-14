import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildFlow, emptyAnswers, isStepComplete, lastProjectStep, nextStep, normalizeStepKey, prevStep, STAGE_OF, stepKey, syncComponents,
  type Answers, type ClientResolution, type FlowContext, type Locale, type PublicCatalog, type StepRef, type YourExpansionViewModel,
} from '@beeside/fa-public-engine';
import { api, ApiError, confirmSend, sessionStore, track } from './api';
import { CoverScreen } from './components/CoverScreen';
import { EnvRibbon } from './components/EnvRibbon';
import { Logo } from './components/Logo';
import { ResultScreen } from './components/ResultScreen';
import * as S from './components/steps';
import { UI, fill } from './copy/ui';
import { ContactDialog, HelpTalkLinks, TopActions } from './components/HelpContact';
import { RecoveryScreen } from './components/Recovery';

const parseKey = (k: string): StepRef => { const [id, comp] = k.split(':'); return comp ? { id: id as StepRef['id'], comp } : { id: id as StepRef['id'] }; };
const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;

/** Resume links carry their token in the URL fragment (/fa4#r=<token>[&view=result]): never sent to a server, so never in access logs. */
function linkFromLocation(): { token: string; view: string | null; contact: string | null } | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const token = params.get('r');
  return token && TOKEN.test(token) ? { token, view: params.get('view'), contact: params.get('contact') } : null;
}

/** A saved step of a screen that was merged/removed resolves to the surviving screen; on desktop the combined topics table stands in for support / critical date. */
function resolveSavedStep(saved: string, a: Answers): string {
  const base = saved === 'cover' || saved === 'identity' ? 'company' : normalizeStepKey(saved, a);
  const wide = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1024px)').matches;
  const id = base.split(':')[0];
  return wide && (id === 'fronts_support' || id === 'fronts_critical') && a.knowsNeeds !== true ? 'fronts_status' : base;
}

/** FA Public v1.0 application controller. Pure view over the deterministic engine; every conclusion comes from the server-stored answers + PUBLISHED catalog. */
export function Fa4App() {
  const [a, setA] = useState<Answers>(() => emptyAnswers('es'));
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [res, setRes] = useState<ClientResolution>(NO_RESOLUTION);
  const [step, setStep] = useState<StepRef>({ id: 'cover' });
  const [hasSession, setHasSession] = useState(false);
  const [model, setModel] = useState<YourExpansionViewModel | null>(null);
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [delivered, setDelivered] = useState(false);          // D-156: a delivered YEV is final (no «Corregir algo», no regeneration)
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastRetry, setToastRetry] = useState<null | (() => void)>(null);   // set only for a failed send: renders «Intentar de nuevo»
  const [booting, setBooting] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [recovery, setRecovery] = useState<null | 'link' | 'stale'>(null);   // invalid / used / expired link · working session lost
  const [resolveFailed, setResolveFailed] = useState(false);
  const online = useOnline();
  const [resolveTick, setResolveTick] = useState(0);
  const [contactOpen, setContactOpen] = useState(false);   // the contact dialog opened from the result footer / the YEV email's «Talk to beeside» link
  const [pendingResume, setPendingResume] = useState(false);   // an emailed single-use resume link is waiting for an explicit «continue» (scanner-safe)
  const resumeConfirmed = useRef(false);
  const openContactAfterBoot = useRef(false);
  const desktop = useDesktop();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locale = a.locale;
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);   // <html lang> follows the language chosen on the cover (a11y)

  // launch-day capture (anonymous before Identity; see docs/fa4/ANALYTICS_EVENTS.md). Never blocks the UI.
  useEffect(() => { track('visit'); }, []);
  useEffect(() => { if (!booting && !recovery) track('step_viewed', { step: step.id }); }, [step.id, booting, recovery]);

  // boot: catalog + resume (emailed link fragment, or this tab's working session)
  useEffect(() => {
    let alive = true;
    (async () => {
      let cat: PublicCatalog;
      try { cat = await api.catalog(); } catch { if (alive) { setCatalogError(true); setBooting(false); } return; }
      if (!alive) return;
      setCatalogError(false); setCatalog(cat);
      const link = linkFromLocation();
      // A passive visit (mail scanner, prefetch) must never spend the single-use resume link: it is redeemed only after an explicit user action.
      if (link && !link.view && !resumeConfirmed.current) { setPendingResume(true); setBooting(false); return; }
      if (link?.contact === 'open') openContactAfterBoot.current = true;
      try {
        if (link) {
          let exchanged: { sessionToken: string };
          try { exchanged = await api.exchangeLink(link.token); } catch (e) {
            // used, expired or unknown link: one generic screen, nothing about which (no enumeration); the fragment is dropped either way
            window.history.replaceState({}, '', window.location.pathname);
            if (e instanceof ApiError && e.status < 500) { if (alive) { setRecovery('link'); setBooting(false); } return; }
            throw e;
          }
          sessionStore.set(exchanged.sessionToken);
          window.history.replaceState({}, '', window.location.pathname);
        }
        if (sessionStore.get()) {
          const s = await api.session();
          if (!alive) return;
          setA(s.answers); setHasSession(true);
          if (link && !link.view) setToast(UI.resumed[s.answers.locale]);
          if (link?.view === 'result' || s.step === 'result') {
            try { const r = await api.latestResult(); setModel(r.model); setDelivered(true); setStep({ id: 'result' }); if (openContactAfterBoot.current) { openContactAfterBoot.current = false; setContactOpen(true); } } catch { setStep({ id: 'extra' }); }
          } else setStep(parseKey(resolveSavedStep(s.step, s.answers)));
        }
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 404)) { sessionStore.clear(); if (!link) setRecovery('stale'); }
      }
      if (alive) setBooting(false);
    })().catch(() => setBooting(false));
    return () => { alive = false; };
  }, [attempt]);

  const set = useCallback((fn: (x: Answers) => Answers) => setA((x) => {
    const y = fn(x);
    return y.destinations !== x.destinations ? syncComponents(y) : y;
  }), []);

  // debounced autosave once the project exists
  useEffect(() => {
    if (!hasSession || step.id === 'result') return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { api.save(a, stepKey(step)).catch((e) => { if (e instanceof ApiError && e.status === 401) setRecovery('stale'); else setToast(UI.saveError[locale]); }); }, 500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [a, step, hasSession, locale]);

  const goTo = useCallback((k: string) => setStep(parseKey(k)), []);
  // Capability / coverage resolution is server-side (privacy boundary): the browser only receives the coarse facts for THIS project.
  const resSeq = useRef(0);
  useEffect(() => {
    if (!hasSession || step.id === 'result' || ['cover', 'identity', 'company', 'exit'].includes(step.id)) return;
    const seq = ++resSeq.current;
    const t = setTimeout(() => { api.resolution(a).then((r) => { if (seq === resSeq.current) { setRes(r); setResolveFailed(false); } }).catch((e) => { if (seq !== resSeq.current) return; if (e instanceof ApiError && e.status === 401) setRecovery('stale'); else setResolveFailed(true); }); }, 200);
    return () => clearTimeout(t);
  }, [a, hasSession, step.id, resolveTick]);
  const flow = useMemo<FlowContext>(() => ({ cargoRouteDestinations: res.cargoRouteDestinations }), [res]);
  const ctx = useMemo<S.StepCtx | null>(() => (catalog ? { a, set, locale, catalog, res, goTo } : null), [a, set, locale, catalog, res, goTo]);

  async function ensureSession(): Promise<boolean> {
    if (hasSession) return true;
    setBusy(true);
    try {
      const { sessionToken } = await api.createSession(a, 'company');
      sessionStore.set(sessionToken); setHasSession(true); return true;
    } catch { setToast(UI.saveError[locale]); return false; } finally { setBusy(false); }
  }

  async function generate() {
    setBusy(true); setStep({ id: 'result' }); setModel(null);
    try {
      await api.save(a, 'result');
      const r = await api.generateResult(); setModel(r.model); setPreviewToken(r.previewToken); setDelivered(false); track('result_viewed');
    } catch { setToast(UI.resultError[locale]); } finally { setBusy(false); }
  }

  async function onNext() {
    if (!catalog) return;
    if (step.id === 'identity' && !(await ensureSession())) return;
    // leaving the LAST project screen confirms the project; an unanswered clarity question behaves as NO (what confirming the old checkpoint did)
    const lp = lastProjectStep(a);
    const base = stepKey(step) === stepKey(lp) && !a.projectConfirmed ? { ...a, projectConfirmed: true, knowsNeeds: a.knowsNeeds ?? false } : a;
    if (base !== a) setA(base);
    // The next step depends on the server-side resolution of THESE answers (e.g. the cargo-route question): never navigate on a stale one.
    let ctxFlow = flow;
    if (hasSession && !['cover', 'identity', 'company', 'exit'].includes(step.id)) {
      try { const fresh = await api.resolution(base); setRes(fresh); setResolveFailed(false); ctxFlow = { cargoRouteDestinations: fresh.cargoRouteDestinations }; }
      catch (e) { if (e instanceof ApiError && e.status === 401) setRecovery('stale'); else setResolveFailed(true); return; }   // stay on this step; the alert offers «Intentar de nuevo»
    }
    const n = skipCombined(nextStep, base, ctxFlow, step, desktop);
    if (n.id === 'result') await generate(); else setStep(n);
    window.scrollTo?.({ top: 0 });
  }
  function onBack() { if (catalog) { setStep(skipCombined(prevStep, a, flow, step, desktop)); window.scrollTo?.({ top: 0 }); } }

  // Save-for-later email states (VF): A sending → B confirmed (only on server success) · C failed → D retry. Never "sent" on click.
  async function saveLater() {
    if (!(await ensureSession())) return;
    setToastRetry(null); setToast(UI.linkSending[locale]);
    try { await api.save(a, stepKey(step)); } catch { setToast(UI.saveError[locale]); setToastRetry(() => saveLater); return; }
    try {
      const r = await confirmSend(api.finishLater(), 'resume');       // "sent" only once the mail server accepted it
      setToast(fill(UI.savedOk, locale, { email: r.email ?? a.identity.email }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setRecovery('stale'); return; }
      setToast(UI.linkFailed[locale]); setToastRetry(() => saveLater);
    }
  }
  const safely = (fn: () => Promise<unknown>) => async () => { try { await fn(); return true; } catch (e) { if (e instanceof ApiError && e.status === 401) setRecovery('stale'); return false; } };
  const sendResultEmail = safely(async () => { const r = await confirmSend(api.emailResult(previewToken ?? undefined), 'result'); setDelivered(true); return r; });
  const startExpansion = safely(async () => { await api.continueWithBeeside(previewToken ?? undefined); setDelivered(true); });
  // contact: pending after the server's wait is reported as "not confirmed" (the same form can be sent again: it is idempotent)
  const sendContact = async (p: { name: string; company: string; email: string; message: string; shareProgress: boolean; clientRequestId: string }) => {
    try { await confirmSend(api.contact({ ...p, stage: step.id === 'result' ? 'YEV' : 'FA' }), null); return true; } catch { return false; }
  };
  const contactPrefill = { name: a.identity.name, company: a.identity.company, email: a.identity.email };

  if (pendingResume) {
    const loc: Locale = typeof navigator !== 'undefined' && /^en/i.test(navigator.language) ? 'en' : 'es';
    return (
      <div className="fa4"><EnvRibbon />{!online && <OfflineBanner locale={loc} />}<div className="shell" lang={loc}>
        <div className="topbar"><Logo /></div>
        <main className="main narrow" id="main">
          <h1 className="h1">{UI.resumed[loc]}</h1>
          <button type="button" className="btn primary" style={{ flex: 'none', marginTop: 8 }} onClick={() => { resumeConfirmed.current = true; setPendingResume(false); setBooting(true); setAttempt((n) => n + 1); }}>{UI.resumeContinue[loc]}</button>
        </main>
      </div></div>
    );
  }
  if (recovery) {
    return (
      <div className="fa4"><EnvRibbon />{!online && <OfflineBanner locale={locale} />}<div className="shell" lang={locale}>
        <div className="topbar"><Logo /></div>
        <RecoveryScreen kind={recovery} locale={locale} onNew={() => { sessionStore.clear(); setHasSession(false); setModel(null); setA(emptyAnswers(locale)); setStep({ id: 'cover' }); setRecovery(null); setBooting(false); }} />
      </div></div>
    );
  }
  if (catalogError && !catalog) {
    return (
      <div className="fa4"><EnvRibbon />{!online && <OfflineBanner locale={locale} />}<div className="shell" lang={locale}><main className="main" role="alert">
        <h1 className="h1">{UI.catalogErrorTitle[locale]}</h1><p className="lead">{UI.catalogErrorBody[locale]}</p>
        <button className="btn primary" style={{ flex: 'none' }} onClick={() => { setBooting(true); setAttempt((n) => n + 1); }}>{UI.retry[locale]}</button>
      </main></div></div>
    );
  }
  if (booting || !catalog || !ctx) return <div className="fa4"><EnvRibbon />{!online && <OfflineBanner locale={locale} />}<div className="shell"><main className="main" aria-busy="true"><p className="hint">…</p></main></div></div>;

  if (step.id === 'result') {
    return (
      <div className="fa4"><EnvRibbon />{!online && <OfflineBanner locale={locale} />}<div className="shell" lang={locale}>
        {!model
          ? <main className="main" aria-live="polite" role={busy ? 'status' : 'alert'}>
              {busy ? <p>{UI.generating[locale]}</p> : <><h1 className="h1">{UI.resolveErrorTitle[locale]}</h1><p className="lead">{UI.resolveErrorBody[locale]}</p>
                <div className="sheet-actions"><button className="btn" onClick={() => setStep({ id: 'extra' })}>{UI.back[locale]}</button><button className="btn primary" onClick={generate}>{UI.tryAgain[locale]}</button></div></>}
            </main>
          : <ResultScreen model={model} locale={locale} onEdit={delivered ? undefined : () => setStep({ id: 'destinations' })}
              delivered={delivered} onContinue={startExpansion} onEmail={sendResultEmail} email={a.identity.email}
              footer={<HelpTalkLinks locale={locale} onHelp={() => track('help_clicked')} onTalk={() => { track('contact_opened'); setContactOpen(true); }} />}
              onRestart={() => { sessionStore.clear(); setHasSession(false); setModel(null); setA(emptyAnswers(locale)); setStep({ id: 'cover' }); }} />}
        {contactOpen && <ContactDialog locale={locale} prefill={contactPrefill} onSend={sendContact} onClose={() => setContactOpen(false)} />}
        {toast && <div role={toastRetry ? 'alert' : 'status'} className={`toast ${toastRetry ? 'err' : ''}`} onClick={() => { if (!toastRetry) setToast(null); }}><span>{toast}</span>{toastRetry && <button type="button" className="toast-btn" onClick={() => toastRetry()}>{UI.tryAgain[locale]}</button>}</div>}
      </div></div>
    );
  }

  if (step.id === 'cover') {
    return (
      <div className="fa4"><EnvRibbon />{!online && <OfflineBanner locale={locale} />}<CoverScreen locale={locale} setLocale={(l: Locale) => { track('language_selected', { props: { locale: l } }); setA((x) => ({ ...x, locale: l })); }} onStart={() => { track('start_clicked'); setStep({ id: 'identity' }); }}
        actions={<TopActions locale={locale} prefill={{ name: '', company: '', email: '' }} onSend={sendContact} onHelp={() => track('help_clicked')} onOpenContact={() => track('contact_opened')} saveSlot={false} />} /></div>
    );
  }

  const stage = STAGE_OF[step.id];
  const complete = isStepComplete(step, a);
  const isLastBeforeResult = nextStep(a, flow, step).id === 'result';
  const label = step.id === 'identity' ? UI.acceptContinue[locale] : isLastBeforeResult ? UI.seeResult[locale] : UI.next[locale];
  const wide = ['fronts_status', 'fronts_support', 'fronts_mark', 'fronts_critical'].includes(step.id);

  return (
    <div className="fa4"><EnvRibbon />{!online && <OfflineBanner locale={locale} />}<div className={`shell ${wide ? 'wide-shell' : 'has-deco'}`} lang={locale}>
      <div className="topbar"><Logo /><TopActions locale={locale} onSave={saveLater} prefill={{ name: a.identity.name, company: a.identity.company, email: a.identity.email }} onSend={sendContact} onHelp={() => track('help_clicked')} onOpenContact={() => track('contact_opened')} /></div>
      {stage >= 1 && stage <= 6 && (
        <nav className="progress" aria-label={UI.progress[locale]}>
          <ol>{UI.stages.map((_, i) => <li key={i} className={i + 1 < stage ? 'done' : i + 1 === stage ? 'now' : ''} aria-current={i + 1 === stage ? 'step' : undefined} />)}</ol>
          <div className="labels"><span>{UI.stages[stage - 1]![locale]}</span><span>{stage} {UI.stepOf[locale]} 6</span></div>
          <div className="stage-names" aria-hidden>{UI.stages.map((s, i) => <span key={i} className={i + 1 === stage ? 'now' : ''}>{s[locale]}</span>)}</div>
        </nav>
      )}
      <main className="main" id="main">
        {resolveFailed && (
          <div className="state err" role="alert"><b>{UI.topicsErrorTitle[locale]}</b> {UI.resolveErrorBody[locale]} <button type="button" className="toast-btn" onClick={() => { setResolveFailed(false); setResolveTick((n) => n + 1); }}>{UI.tryAgain[locale]}</button></div>
        )}
        <StepBody step={step} ctx={ctx}  desktop={desktop} />
      </main>
      <div className="navbar"><div className={`inner ${wide ? 'wide' : ''}`}>
        <button type="button" className="linkbtn nav-save" onClick={saveLater}>{UI.saveLater[locale]}</button>
        <button className="btn" onClick={onBack}>{UI.back[locale]}</button>
        {step.id !== 'exit' && <button className="btn primary" disabled={!complete || busy} onClick={onNext}>{label}</button>}
      </div></div>
      {!wide && <aside className="deco" aria-hidden />}
      {toast && <div role={toastRetry ? 'alert' : 'status'} className={`toast ${toastRetry ? 'err' : ''}`} onClick={() => { if (!toastRetry) setToast(null); }}><span>{toast}</span>{toastRetry && <button type="button" className="toast-btn" onClick={() => toastRetry()}>{UI.tryAgain[locale]}</button>}</div>}
      <span className="sr-only" data-testid="flow-length">{buildFlow(a, flow).length}</span>
    </div></div>
  );
}

function StepBody({ step, ctx, desktop }: { step: StepRef; ctx: S.StepCtx; desktop: boolean }) {
  const c = step.comp ?? '';
  switch (step.id) {
    case 'identity': return <S.IdentityStep {...ctx} />;
    case 'company': return <S.CompanyStep {...ctx} />;
    case 'exit': return <S.ExitStep {...ctx} />;
    case 'destinations': return <S.DestinationsStep {...ctx} />;
    case 'activity': return <S.ActivityStep {...ctx} compId={c} />;
    case 'presence': return <S.PresenceStep {...ctx} compId={c} />;
    case 'reason': return <S.ReasonStep {...ctx} />;
    case 'decision': return <S.DecisionStep {...ctx} />;
    case 'activators': return <S.ActivatorsStep {...ctx} mode="all" />;
    case 'activators_sell': return <S.ActivatorsStep {...ctx} mode="sell" />;
    case 'activators_site': return <S.ActivatorsStep {...ctx} mode="site" />;
    case 'fronts_status': return desktop ? <S.FrontsTableStep {...ctx} /> : <S.FrontsStatusStep {...ctx} />;
    case 'fronts_support': return <S.FrontsSupportStep {...ctx} />;
    case 'fronts_mark': return <S.FrontsMarkStep {...ctx} />;
    case 'fronts_critical': return <S.FrontsCriticalStep {...ctx} />;
    case 'support_values': return <S.SupportValuesStep {...ctx} />;
    case 'extra': return <S.ExtraStep {...ctx} />;
    default: return null;
  }
}

/** Desktop ≥ 1024 px (frozen Design: one combined table for status / support / critical date). */
function useDesktop(): boolean {
  const q = '(min-width: 1024px)';
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(q).matches : false);
  const [d, setD] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(q); const on = () => setD(m.matches);
    m.addEventListener?.('change', on); return () => m.removeEventListener?.('change', on);
  }, []);
  return d;
}

/** On desktop the support and critical-date questions live inside the combined fronts table, so those steps are skipped (not in the "mark what you need" path). */
function skipCombined(move: typeof nextStep, a: Answers, c: FlowContext, from: StepRef, desktop: boolean): StepRef {
  let n = move(a, c, from);
  if (!desktop || !buildFlow(a, c).some((x) => x.id === 'fronts_status')) return n;
  while (n.id === 'fronts_support' || n.id === 'fronts_critical') n = move(a, c, n);
  return n;
}

const NO_RESOLUTION: ClientResolution = { premiumShown: false, cargoRouteDestinations: [], destinations: [] };

/** Browser connectivity (the banner never blocks: answers stay on screen and are saved when the connection returns). */
function useOnline(): boolean {
  const [on, setOn] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const up = () => setOn(true), down = () => setOn(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return on;
}
function OfflineBanner({ locale }: { locale: Locale }) {
  return <div className="offline-banner" role="status"><b>{UI.offlineTitle[locale]}.</b> {UI.offlineBody[locale]}</div>;
}
