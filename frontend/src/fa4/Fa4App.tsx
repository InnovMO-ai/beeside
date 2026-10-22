import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildFlow, emptyAnswers, lastProjectStep, missingRequired, nextStep, normalizeStepKey, prevStep, STAGE_OF, stepKey, syncComponents,
  type Answers, type ClientResolution, type FlowContext, type Locale, type PublicCatalog, type StepRef, type YourExpansionViewModel, isLikelyPersonalEmail } from '@beeside/fa-public-engine';
import { api, ApiError, confirmSend, RESUME_IDLE_MS, sessionStore, track, visitLocale } from './api';
import { CoverScreen } from './components/CoverScreen';
import { EnvRibbon } from './components/EnvRibbon';
import { PersonalEmailDialog } from './components/PersonalEmailDialog';
import { StabilizationNotice } from './components/StabilizationNotice';
import { loadRuntimeConfig } from './runtimeConfig';
import { Logo } from './components/Logo';
import { ResultScreen } from './components/ResultScreen';
import * as S from './components/steps';
import { UI, fill } from './copy/ui';
import { ContactDialog, HelpTalkLinks, TopActions } from './components/HelpContact';
import { HelpMenu } from './components/HelpMenu';
import { helpScreenOf } from './components/helpScreen';
import { HELP_FLAGS, recoveryHasHelp, type HelpFlags } from './copy/help';
import { ContinueLinkDialog, IdleContinuation, RecoveryScreen, type IdlePhase } from './components/Recovery';
import { focusBlock, ReqContext } from './components/required';

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
  // Stabilization (closed test): the deployment says so at runtime; the visitor must confirm the notice once per browser session before entering project information.
  const [closedTest, setClosedTest] = useState(false);
  const [stabAck, setStabAck] = useState(() => { try { return sessionStorage.getItem('beeside.fa4.stabilization-ack') === '1'; } catch { return false; } });
  useEffect(() => { let live = true; void loadRuntimeConfig().then((c) => { if (live) setClosedTest(c.closedTest); }); return () => { live = false; }; }, []);
  const confirmStabilization = () => { try { sessionStorage.setItem('beeside.fa4.stabilization-ack', '1'); } catch { /* the notice simply shows again */ } setStabAck(true); };
  // Personal e-mail: advisory warning once per address (never a blocker).
  const [personalWarn, setPersonalWarn] = useState(false);
  // «Continue» pressed with required answers missing: which screen, and the labels of what is missing (the blocks themselves show the message and take the focus).
  const [reqAttempt, setReqAttempt] = useState<{ key: string; n: number } | null>(null);
  const [reqLabels, setReqLabels] = useState<string[]>([]);
  useEffect(() => {
    if (!reqAttempt) { setReqLabels([]); return; }
    const bad = [...document.querySelectorAll<HTMLElement>('[data-req-bad="true"]')];
    setReqLabels(bad.map((b) => b.getAttribute('data-req-label') ?? '').filter(Boolean));
    if (bad[0]) focusBlock(bad[0]);
  }, [reqAttempt]);
  const personalOk = useRef('');
  const [toast, setToast] = useState<string | null>(null);
  const [toastRetry, setToastRetry] = useState<null | (() => void)>(null);   // set only for a failed send: renders «Intentar de nuevo»
  // Notices never trap the screen: they close by themselves (a failed send with a retry action stays a little longer) and by a click anywhere except their own button.
  const dismissToast = (e: React.MouseEvent) => { if ((e.target as HTMLElement).closest('button')) return; setToast(null); setToastRetry(null); };
  useEffect(() => { if (!toast) return; const t = setTimeout(() => { setToast(null); setToastRetry(null); }, toastRetry ? 12000 : 6000); return () => clearTimeout(t); }, [toast, toastRetry]);
  const [booting, setBooting] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [recovery, setRecovery] = useState<null | 'link' | 'stale'>(null);   // invalid / used / expired link · working session lost
  // DSC-36: the continuity screen shown after 30 min of inactivity (and the in-memory token used ONLY to retry the same delivery; the tab's own token is already gone)
  const [idle, setIdle] = useState<IdlePhase | null>(null);
  const idleToken = useRef<string | null>(null);
  const [resolveFailed, setResolveFailed] = useState(false);
  const online = useOnline();
  const [resolveTick, setResolveTick] = useState(0);
  const [continueOpen, setContinueOpen] = useState(false);   // DSC-38 · «Already started?» dialog on the cover
  const continueLink = useRef<HTMLButtonElement>(null);
  const [contactOpen, setContactOpen] = useState(false);   // the contact dialog opened from the result footer / the YEV email's «Talk to beeside» link
  const [pendingResume, setPendingResume] = useState(false);   // an emailed single-use resume link is waiting for an explicit «continue» (scanner-safe)
  const resumeConfirmed = useRef(false);
  const openContactAfterBoot = useRef(false);
  const desktop = useDesktop();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locale = a.locale;
  useEffect(() => { document.documentElement.lang = locale; if (hasSession) visitLocale.set(locale); }, [locale, hasSession]);   // <html lang> follows the language chosen on the cover (a11y)

  // launch-day capture (anonymous before Identity; see docs/fa4/ANALYTICS_EVENTS.md). Never blocks the UI.
  useEffect(() => { track('visit'); }, []);
  useEffect(() => { if (!booting && !recovery) track('step_viewed', { step: step.id }); }, [step.id, booting, recovery]);

  // DSC-36 · ONE continuation link for this (idle) tab's project. The answer says what really happened; the tab's token is dropped as soon as the answer arrives.
  const runIdle = useCallback(async (token: string, retry = false) => {
    idleToken.current = token; setIdle('sending');
    const toCover = () => { idleToken.current = null; sessionStore.clear(); setIdle(null); setHasSession(false); setModel(null); setA(emptyAnswers(a.locale)); setStep({ id: 'cover' }); setBooting(false); };
    try {
      const r = await api.idleContinuation(token, retry); sessionStore.clear();
      if (r.state === 'sent') { setIdle('sent'); return; }
      for (const deadline = Date.now() + 40_000; Date.now() < deadline;) {            // «pending»: wait for the real outcome
        await new Promise((res) => setTimeout(res, 2_000));
        const st = await api.emailStatus('resume', token).catch(() => null);
        if (st?.state === 'sent') { setIdle('sent'); return; }
        if (st?.state === 'failed' || st?.state === 'none') { setIdle('failed'); return; }
      }
      setIdle('failed');
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401 || e.code === 'NOT_APPLICABLE' || e.code === 'RECIPIENT_NOT_AUTHORIZED' || e.status === 429) sessionStore.clear();   // a transient failure (5xx / network) keeps the token so a reload can still retry
        if (e.status === 401) { idleToken.current = null; setIdle(null); setRecovery('stale'); return; }          // expired (> 24 h) or unknown: the «stale» screen with the link request
        if (e.code === 'NOT_APPLICABLE') { toCover(); return; }                                                    // delivered / closed project: nothing to continue
        if (e.code === 'RECIPIENT_NOT_AUTHORIZED') { setIdle('unauthorized'); return; }
        if (e.status === 429) { setIdle('failedNoRetry'); return; }                                                // the daily quota: a retry would answer 429 again
      }
      setIdle('failed');
    }
  }, [a.locale]);
  const startNewFromIdle = useCallback(() => { idleToken.current = null; sessionStore.clear(); setIdle(null); setHasSession(false); setModel(null); setDelivered(false); setPreviewToken(null); setA(emptyAnswers(a.locale)); setStep({ id: 'cover' }); setBooting(false); }, [a.locale]);

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
        // DSC-36 (supersedes «30 min → cover»): a token whose visit is IDLE is never re-opened; the tab asks for ONE continuation link and shows the continuity screen
        const stale = link ? null : sessionStore.idleToken();
        if (stale) { setA(emptyAnswers(visitLocale.get())); void runIdle(stale); if (alive) setBooting(false); return; }
        if (sessionStore.resumable()) {          // DSC-01: only a recent visit of THIS tab is resumed
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

  // DSC-37: publication flags of the contextual help (E/F wait for DSC-36 / DSC-38 to be validated; J, P are met) + the Stabilization line of entry E
  const helpFlags: HelpFlags = { ...HELP_FLAGS, stabilization: closedTest };
  // DSC-37 (D6): when the screen changes the focus goes to its title (H1); never while a modal is open and never on the very first screen of the visit
  const lastFocusedStep = useRef<string | null>(null);
  useEffect(() => {
    if (booting) return; const k = stepKey(step);
    if (lastFocusedStep.current !== null && lastFocusedStep.current !== k && !document.querySelector('dialog[open]')) {
      const h = document.querySelector<HTMLElement>('main h1, .cv-title'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }
    lastFocusedStep.current = k;
  }, [step, booting]);

  // DSC-36 · case A — 30 min without interaction (keyboard, pointer, scroll, touch; a hidden tab counts as inactive): ask for the continuation link and replace the screen.
  // The check runs on a timer AND when the tab becomes visible again (timers of hidden tabs are throttled). Never for a delivered result or before the project exists.
  const lastActive = useRef(Date.now());
  const idleGuard = useRef({ on: false, token: null as string | null });
  const idleFired = useRef(false);          // one trigger per project: the timer can tick again before React has re-rendered
  idleGuard.current = { on: hasSession && !idle && !recovery && !delivered && !booting && step.id !== 'cover', token: sessionStore.get() };
  useEffect(() => {
    const bump = () => { lastActive.current = Date.now(); };
    const opts = { capture: true, passive: true } as const;
    const evs = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel', 'input'] as const;
    for (const e of evs) window.addEventListener(e, bump, opts);
    const check = () => {
      const g = idleGuard.current; if (!g.on || !g.token) return;
      if (idleFired.current || Date.now() - lastActive.current < RESUME_IDLE_MS) return;
      idleFired.current = true;
      setHasSession(false); setModel(null); setA(emptyAnswers(locale)); setPreviewToken(null);        // nothing of the project stays on this screen
      void runIdle(g.token);
    };
    const t = setInterval(check, 15_000); document.addEventListener('visibilitychange', check);
    return () => { for (const e of evs) window.removeEventListener(e, bump, opts); clearInterval(t); document.removeEventListener('visibilitychange', check); };
  }, [runIdle, locale]);
  useEffect(() => { lastActive.current = Date.now(); if (hasSession) idleFired.current = false; }, [hasSession]);

  const goTo = useCallback((k: string) => setStep(parseKey(k)), []);
  // Capability / coverage resolution is server-side (privacy boundary): the browser only receives the coarse facts for THIS project.
  const resSeq = useRef(0);
  useEffect(() => {
    if (!hasSession || step.id === 'result' || ['cover', 'identity', 'company'].includes(step.id)) return;
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
    if (missingRequired(step, a, { cargoRouteDestinations: res.cargoRouteDestinations, desktop }).length) { setReqAttempt((p) => ({ key: stepKey(step), n: (p?.n ?? 0) + 1 })); return; }
    if (step.id === 'identity') {
      const email = a.identity.email.trim().toLowerCase();
      if (isLikelyPersonalEmail(email) && personalOk.current !== email) { setPersonalWarn(true); return; }
      if (!(await ensureSession())) return;
    }
    // leaving the LAST project screen confirms the project; an unanswered clarity question behaves as NO (what confirming the old checkpoint did)
    const lp = lastProjectStep(a);
    const base = stepKey(step) === stepKey(lp) && !a.projectConfirmed ? { ...a, projectConfirmed: true, knowsNeeds: a.knowsNeeds ?? false } : a;
    if (base !== a) setA(base);
    // The next step depends on the server-side resolution of THESE answers (e.g. the cargo-route question): never navigate on a stale one.
    let ctxFlow = flow;
    if (hasSession && !['cover', 'identity', 'company'].includes(step.id)) {
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
  // DSC-33: only the closed-test recipient refusal gets its own message (the result IS delivered server-side); any other failure stays the generic, real error.
  const sendResultEmail = async (): Promise<boolean | 'unauthorized'> => {
    try { await confirmSend(api.emailResult(previewToken ?? undefined), 'result'); setDelivered(true); return true; }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) { setRecovery('stale'); return false; }
      if (e instanceof ApiError && e.code === 'RECIPIENT_NOT_AUTHORIZED') { setDelivered(true); return 'unauthorized'; }
      return false;
    }
  };
  const startExpansion = safely(async () => { await api.continueWithBeeside(previewToken ?? undefined); setDelivered(true); });
  // contact: pending after the server's wait is reported as "not confirmed" (the same form can be sent again: it is idempotent)
  const sendContact = async (p: { name: string; company: string; email: string; message: string; shareProgress: boolean; clientRequestId: string }) => {
    try { await confirmSend(api.contact({ ...p, stage: step.id === 'result' ? 'YEV' : 'FA' }), null); return true; } catch { return false; }
  };
  const contactPrefill = { name: a.identity.name, company: a.identity.company, email: a.identity.email };

  const focusEmailField = () => (document.querySelector('input[type=email]') as HTMLInputElement | null)?.focus();
  const stabNotice = closedTest && !stabAck ? <StabilizationNotice locale={locale} onConfirm={confirmStabilization} /> : null;
  const personalDialog = personalWarn ? (
    <PersonalEmailDialog locale={locale}
      onUseAnother={() => { setPersonalWarn(false); setTimeout(focusEmailField, 0); }}
      onContinue={() => { personalOk.current = a.identity.email.trim().toLowerCase(); setPersonalWarn(false); void onNext(); }} />
  ) : null;

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
  if (idle) {
    return (
      <div className="fa4"><EnvRibbon />{!online && <OfflineBanner locale={locale} />}<div className="shell" lang={locale}>
        <div className="topbar"><Logo />{recoveryHasHelp(helpFlags) && <HelpMenu locale={locale} variant="form" screen="recovery" flags={helpFlags} onHelpLink={() => track('help_clicked')} />}</div>
        <IdleContinuation phase={idle} locale={locale} onRetry={() => { if (idleToken.current) void runIdle(idleToken.current, true); }} onNew={startNewFromIdle} />
      </div></div>
    );
  }
  if (recovery) {
    return (
      <div className="fa4"><EnvRibbon />{!online && <OfflineBanner locale={locale} />}<div className="shell" lang={locale}>
        <div className="topbar"><Logo />{recoveryHasHelp(helpFlags) && <HelpMenu locale={locale} variant="form" screen="recovery" flags={helpFlags} onHelpLink={() => track('help_clicked')} />}</div>
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
              footer={<HelpTalkLinks locale={locale} onHelp={() => track('help_clicked')} />}
              helpSlot={<HelpMenu locale={locale} variant="yev" screen={delivered ? 'yevDelivered' : 'yevPreview'} flags={helpFlags} resetKey={delivered ? 'delivered' : 'preview'} onHelpLink={() => track('help_clicked')} />}
              onRestart={() => { sessionStore.clear(); setHasSession(false); setModel(null); setA(emptyAnswers(locale)); setStep({ id: 'cover' }); }} />}
        {contactOpen && <ContactDialog locale={locale} prefill={contactPrefill} onSend={sendContact} onClose={() => setContactOpen(false)} />}
        {stabNotice}
        {toast && <div role={toastRetry ? 'alert' : 'status'} className={`toast ${toastRetry ? 'err' : ''}`} onClick={dismissToast}><span>{toast}</span>{toastRetry && <button type="button" className="toast-btn" onClick={() => toastRetry()}>{UI.tryAgain[locale]}</button>}</div>}
      </div></div>
    );
  }

  if (step.id === 'cover') {
    return (
      <div className="fa4"><EnvRibbon />{!online && <OfflineBanner locale={locale} />}<CoverScreen locale={locale} setLocale={(l: Locale) => { track('language_selected', { props: { locale: l } }); setA((x) => ({ ...x, locale: l })); }} onStart={() => { track('start_clicked'); setStep({ id: 'identity' }); }}
        actions={<TopActions locale={locale} helpScreen="cover" helpFlags={helpFlags} onHelp={() => track('help_clicked')} saveSlot={false} />}
        belowNote={<><button type="button" ref={continueLink} className="cv-continue" onClick={() => setContinueOpen(true)}>{UI.continueLinkCta[locale]}</button><ContinueLinkDialog locale={locale} open={continueOpen} onClose={() => { setContinueOpen(false); continueLink.current?.focus(); }} /></>} /></div>
    );
  }

  const stage = STAGE_OF[step.id];
  const missing = new Set(missingRequired(step, a, { cargoRouteDestinations: res.cargoRouteDestinations, desktop }));
  const showReq = reqAttempt?.key === stepKey(step) && missing.size > 0;
  const reqState = { show: showReq, missing, message: UI.reqField[locale] };
  const isLastBeforeResult = nextStep(a, flow, step).id === 'result';
  const label = step.id === 'identity' ? UI.acceptContinue[locale] : isLastBeforeResult ? UI.seeResult[locale] : UI.next[locale];
  const wide = ['fronts_status', 'fronts_support', 'fronts_mark', 'fronts_critical'].includes(step.id);

  return (
    <div className="fa4"><EnvRibbon />{!online && <OfflineBanner locale={locale} />}<div className={`shell ${wide ? 'wide-shell' : 'has-deco'}`} lang={locale}>
      <div className="topbar"><Logo /><TopActions locale={locale} onSave={saveLater} helpScreen={helpScreenOf(step, a)} helpFlags={helpFlags} resetKey={stepKey(step)} onHelp={() => track('help_clicked')} /></div>
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
        {showReq && reqLabels.length > 0 && <div className="req-summary" role="alert"><b>{UI.reqSummary[locale]}</b> {reqLabels.join(' · ')}</div>}
        <ReqContext.Provider value={reqState}><StepBody step={step} ctx={ctx}  desktop={desktop} /></ReqContext.Provider>
      </main>
      <div className="navbar"><div className={`inner ${wide ? 'wide' : ''}`}>
        <button type="button" className="linkbtn nav-save" onClick={saveLater}>{UI.saveLater[locale]}</button>
        <button className="btn" onClick={onBack}>{UI.back[locale]}</button>
        <button className="btn primary" disabled={busy} onClick={onNext}>{label}</button>
      </div></div>
      {!wide && <aside className="deco" aria-hidden />}
      {toast && <div role={toastRetry ? 'alert' : 'status'} className={`toast ${toastRetry ? 'err' : ''}`} onClick={dismissToast}><span>{toast}</span>{toastRetry && <button type="button" className="toast-btn" onClick={() => toastRetry()}>{UI.tryAgain[locale]}</button>}</div>}
      {stabNotice}{personalDialog}
      <span className="sr-only" data-testid="flow-length">{buildFlow(a, flow).length}</span>
    </div></div>
  );
}

function StepBody({ step, ctx, desktop }: { step: StepRef; ctx: S.StepCtx; desktop: boolean }) {
  const c = step.comp ?? '';
  switch (step.id) {
    case 'identity': return <S.IdentityStep {...ctx} />;
    case 'company': return <S.CompanyStep {...ctx} />;
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
