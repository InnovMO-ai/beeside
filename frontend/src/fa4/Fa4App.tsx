import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildFlow, emptyAnswers, isStepComplete, nextStep, prevStep, STAGE_OF, stepKey, syncComponents,
  type Answers, type ClientResolution, type FlowContext, type Locale, type PublicCatalog, type StepRef, type YourExpansionViewModel,
} from '@beeside/fa-public-engine';
import { api, ApiError, sessionStore } from './api';
import { CoverScreen } from './components/CoverScreen';
import { EnvRibbon } from './components/EnvRibbon';
import { Logo } from './components/Logo';
import { ResultScreen } from './components/ResultScreen';
import * as S from './components/steps';
import { UI, fill } from './copy/ui';

const parseKey = (k: string): StepRef => { const [id, comp] = k.split(':'); return comp ? { id: id as StepRef['id'], comp } : { id: id as StepRef['id'] }; };
const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;

/** Resume links carry their token in the URL fragment (/fa4#r=<token>[&view=result]): never sent to a server, so never in access logs. */
function linkFromLocation(): { token: string; view: string | null } | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const token = params.get('r');
  return token && TOKEN.test(token) ? { token, view: params.get('view') } : null;
}

/** FA Public v1.0 application controller. Pure view over the deterministic engine; every conclusion comes from the server-stored answers + PUBLISHED catalog. */
export function Fa4App() {
  const [a, setA] = useState<Answers>(() => emptyAnswers('es'));
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [res, setRes] = useState<ClientResolution>(NO_RESOLUTION);
  const [step, setStep] = useState<StepRef>({ id: 'cover' });
  const [hasSession, setHasSession] = useState(false);
  const [model, setModel] = useState<YourExpansionViewModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const desktop = useDesktop();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locale = a.locale;
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);   // <html lang> follows the language chosen on the cover (a11y)

  // boot: catalog + resume (emailed link fragment, or this tab's working session)
  useEffect(() => {
    let alive = true;
    (async () => {
      let cat: PublicCatalog;
      try { cat = await api.catalog(); } catch { if (alive) { setCatalogError(true); setBooting(false); } return; }
      if (!alive) return;
      setCatalogError(false); setCatalog(cat);
      const link = linkFromLocation();
      try {
        if (link) {
          const { sessionToken } = await api.exchangeLink(link.token);
          sessionStore.set(sessionToken);
          window.history.replaceState({}, '', window.location.pathname);
        }
        if (sessionStore.get()) {
          const s = await api.session();
          if (!alive) return;
          setA(s.answers); setHasSession(true);
          if (link?.view === 'result' || s.step === 'result') {
            try { const r = await api.latestResult(); setModel(r.model); setStep({ id: 'result' }); } catch { setStep({ id: 'extra' }); }
          } else setStep(parseKey(s.step === 'cover' || s.step === 'identity' ? 'company' : s.step));
        }
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 404)) sessionStore.clear();
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
    saveTimer.current = setTimeout(() => { api.save(a, stepKey(step)).catch(() => setToast(UI.saveError[locale])); }, 500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [a, step, hasSession, locale]);

  const goTo = useCallback((k: string) => setStep(parseKey(k)), []);
  // Capability / coverage resolution is server-side (privacy boundary): the browser only receives the coarse facts for THIS project.
  const resSeq = useRef(0);
  useEffect(() => {
    if (!hasSession || step.id === 'result' || ['cover', 'identity', 'company', 'exit'].includes(step.id)) return;
    const seq = ++resSeq.current;
    const t = setTimeout(() => { api.resolution(a).then((r) => { if (seq === resSeq.current) setRes(r); }).catch(() => undefined); }, 200);
    return () => clearTimeout(t);
  }, [a, hasSession, step.id]);
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
      setModel((await api.generateResult()).model);
    } catch { setToast(UI.resultError[locale]); } finally { setBusy(false); }
  }

  async function onNext() {
    if (!catalog) return;
    if (step.id === 'identity' && !(await ensureSession())) return;
    const base = step.id === 'reflection' && a.knowsNeeds === null ? { ...a, projectConfirmed: true, knowsNeeds: false } : a;
    if (base !== a) setA(base);
    const n = skipCombined(nextStep, base, flow, step, desktop);
    if (n.id === 'result') await generate(); else setStep(n);
    window.scrollTo?.({ top: 0 });
  }
  function onBack() { if (catalog) { setStep(skipCombined(prevStep, a, flow, step, desktop)); window.scrollTo?.({ top: 0 }); } }

  async function saveLater() {
    if (!(await ensureSession())) return;
    try {
      await api.save(a, stepKey(step));
      const r = await api.finishLater();
      setToast(fill(UI.saved, locale, { email: r.email }));
    } catch { setToast(UI.saveError[locale]); }
  }
  const safely = (fn: () => Promise<unknown>) => async () => { try { await fn(); return true; } catch { return false; } };

  if (catalogError && !catalog) {
    return (
      <div className="fa4"><EnvRibbon /><div className="shell" lang={locale}><main className="main" role="alert">
        <h1 className="h1">{UI.catalogErrorTitle[locale]}</h1><p className="lead">{UI.catalogErrorBody[locale]}</p>
        <button className="btn primary" style={{ flex: 'none' }} onClick={() => { setBooting(true); setAttempt((n) => n + 1); }}>{UI.retry[locale]}</button>
      </main></div></div>
    );
  }
  if (booting || !catalog || !ctx) return <div className="fa4"><EnvRibbon /><div className="shell"><main className="main" aria-busy="true"><p className="hint">…</p></main></div></div>;

  if (step.id === 'result') {
    return (
      <div className="fa4"><EnvRibbon /><div className="shell" lang={locale}>
        {!model
          ? <main className="main" aria-live="polite"><p>{busy ? UI.generating[locale] : UI.resultError[locale]}</p>{!busy && <button className="btn" onClick={generate}>{UI.next[locale]}</button>}</main>
          : <ResultScreen model={model} locale={locale} onEdit={() => setStep({ id: 'reflection' })}
              onContinue={safely(api.continueWithBeeside)} onEmail={safely(api.emailResult)}
              onRestart={() => { sessionStore.clear(); setHasSession(false); setModel(null); setA(emptyAnswers(locale)); setStep({ id: 'cover' }); }} />}
        {toast && <div role="status" className="note" style={{ position: 'fixed', left: 16, right: 16, bottom: 16 }}>{toast}</div>}
      </div></div>
    );
  }

  if (step.id === 'cover') {
    return (
      <div className="fa4"><EnvRibbon /><CoverScreen locale={locale} setLocale={(l: Locale) => setA((x) => ({ ...x, locale: l }))} onStart={() => setStep({ id: 'identity' })} /></div>
    );
  }

  const stage = STAGE_OF[step.id];
  const complete = isStepComplete(step, a);
  const isLastBeforeResult = nextStep(a, flow, step).id === 'result';
  const label = step.id === 'identity' ? UI.acceptContinue[locale] : step.id === 'reflection' ? UI.r1Confirm[locale] : isLastBeforeResult ? UI.seeResult[locale] : UI.next[locale];
  const wide = ['fronts_status', 'fronts_support', 'fronts_mark', 'fronts_critical', 'reflection'].includes(step.id);

  return (
    <div className="fa4"><EnvRibbon /><div className={`shell ${step.id === 'reflection' ? 'tinted' : ''}`} lang={locale}>
      <div className="topbar"><Logo /><button className="linkbtn" onClick={saveLater}>{UI.saveLater[locale]}</button></div>
      {stage >= 1 && stage <= 6 && (
        <nav className="progress" aria-label={UI.progress[locale]}>
          <ol>{UI.stages.map((_, i) => <li key={i} className={i + 1 < stage ? 'done' : i + 1 === stage ? 'now' : ''} aria-current={i + 1 === stage ? 'step' : undefined} />)}</ol>
          <div className="labels"><span>{UI.stages[stage - 1]![locale]}</span><span>{stage} {UI.stepOf[locale]} 6</span></div>
          <div className="stage-names" aria-hidden>{UI.stages.map((s, i) => <span key={i} className={i + 1 === stage ? 'now' : ''}>{s[locale]}</span>)}</div>
        </nav>
      )}
      <main className={`main ${wide ? '' : 'with-deco'}`} id="main"><StepBody step={step} ctx={ctx}  desktop={desktop} />{!wide && <aside className="deco" aria-hidden />}</main>
      <div className="navbar"><div className={`inner ${wide ? 'wide' : ''}`}>
        <button className="btn" onClick={onBack}>{UI.back[locale]}</button>
        {step.id !== 'exit' && <button className="btn primary" disabled={!complete || busy} onClick={onNext}>{label}</button>}
      </div></div>
      {toast && <div role="status" className="note" style={{ position: 'fixed', left: 16, right: 16, bottom: 80 }} onClick={() => setToast(null)}>{toast}</div>}
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
    case 'same_in_all': return <S.SameInAllStep {...ctx} />;
    case 'activity': return <S.ActivityStep {...ctx} compId={c} />;
    case 'presence': return <S.PresenceStep {...ctx} compId={c} />;
    case 'existing': return <S.ExistingStep {...ctx} compId={c} />;
    case 'reflection': return <S.ReflectionStep {...ctx} />;
    case 'reason': return <S.ReasonStep {...ctx} />;
    case 'decision': return <S.DecisionStep {...ctx} />;
    case 'scale': return <S.ScaleStep {...ctx} />;
    case 'activators': return <S.ActivatorsStep {...ctx} mode="all" />;
    case 'activators_sell': return <S.ActivatorsStep {...ctx} mode="sell" />;
    case 'activators_site': return <S.ActivatorsStep {...ctx} mode="site" />;
    case 'fronts_status': return desktop ? <S.FrontsTableStep {...ctx} /> : <S.FrontsStatusStep {...ctx} />;
    case 'fronts_support': return <S.FrontsSupportStep {...ctx} />;
    case 'fronts_mark': return <S.FrontsMarkStep {...ctx} />;
    case 'fronts_critical': return <S.FrontsCriticalStep {...ctx} />;
    case 'cargo_route': return <S.CargoRouteStep {...ctx} />;
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
