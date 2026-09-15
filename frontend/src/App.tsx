import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flush as flushAnalytics, track } from "./fa/analytics";
import { api, ApiError, sessionStore } from "./fa/api";
import { SaveStatus } from "./fa/autosave";
import { PremiumSource } from "./fa/components/PremiumTransition";
import { Shell } from "./fa/components/Shell";
import { makeT } from "./fa/copy";
import { Identity } from "./fa/screens/Identity";
import { Journey } from "./fa/screens/Journey";
import { ResumeLink } from "./fa/screens/ResumeLink";
import { ExistingEmail, FinishLaterConfirmation, RequestLink } from "./fa/screens/SimpleScreens";
import { SnapshotScreen } from "./fa/screens/SnapshotScreen";
import { Welcome } from "./fa/screens/Welcome";
import { Bundle, Locale, SessionView, StageId } from "./fa/types";

type Screen =
  | { name: "loading" }
  | { name: "welcome" }
  | { name: "identity" }
  | { name: "existing_email" }
  | { name: "journey" }
  | { name: "finish_later"; accessUntil: string | null }
  | { name: "completion" }
  | { name: "resume"; token: string }
  | { name: "expired" }
  | { name: "unavailable" };

const RESUME_PATH = /^\/resume\/([A-Za-z0-9_-]{20,})\/?$/;
const TOKEN = /^[A-Za-z0-9_-]{20,}$/;
const SESSION_PREMIUM: PremiumSource = { loadStatus: api.sessionPremium, activate: api.sessionPremiumActivation };
const SESSION_FEEDBACK = { load: api.sessionFeedback, submit: api.submitSessionFeedback };

/**
 * Private links carry their token in the URL fragment (/resume#token), which browsers never send to
 * a server, so it cannot appear in access logs. Links issued before that change used /resume/<token>
 * and keep working.
 */
function resumeTokenFromLocation(): string | null {
  if (!window.location.pathname.startsWith("/resume")) return null;
  const fragment = window.location.hash.replace(/^#/, "");
  if (TOKEN.test(fragment)) return fragment;
  return RESUME_PATH.exec(window.location.pathname)?.[1] ?? null;
}
const LOCALE_KEY = "beeside.fa.locale";

function initialLocale(): Locale {
  try {
    const stored = sessionStorage.getItem(LOCALE_KEY);
    if (stored === "en" || stored === "es") return stored;
  } catch {
    // storage unavailable
  }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("es") ? "es" : "en";
}

/** First Assessment application controller (Phases 4–6). Snapshot rendering arrives with Phase 8. */
export function App() {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [screen, setScreen] = useState<Screen>(() => {
    const token = resumeTokenFromLocation();
    return token ? { name: "resume", token } : { name: "loading" };
  });
  const [view, setView] = useState<SessionView | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const [stage, setStage] = useState<StageId | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [countries, setCountries] = useState<string[]>([]);
  const flushRef = useRef<(() => Promise<void>) | null>(null);
  const started = useRef(false);
  const t = useMemo(() => (bundle ? makeT(bundle, locale) : null), [bundle, locale]);

  const applyLocale = useCallback((next: Locale) => {
    setLocale(next);
    try {
      sessionStorage.setItem(LOCALE_KEY, next);
    } catch {
      // storage unavailable
    }
  }, []);

  const ensureCurrentBundle = useCallback(async () => {
    const { bundle: current } = await api.currentBundle();
    setBundle((existing) => existing ?? current);
  }, []);

  const handleSessionLost = useCallback(
    async (error: unknown) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 410)) {
        sessionStore.clear();
        setView(null);
        setSaveStatus("idle");
        try {
          await ensureCurrentBundle();
          setScreen(error.code === "ACCESS_EXPIRED" ? { name: "expired" } : { name: "welcome" });
        } catch {
          setScreen({ name: "unavailable" });
        }
        return;
      }
      setScreen({ name: "unavailable" });
    },
    [ensureCurrentBundle],
  );

  const loadSession = useCallback(async () => {
    try {
      const session = await api.session();
      const { bundle: pinned } = await api.bundle(session.questionBankVersion);
      setBundle(pinned);
      setView(session);
      setSessionKey((k) => k + 1);
      setSaveStatus("idle");
      if (session.interfaceLanguage === "en" || session.interfaceLanguage === "es") applyLocale(session.interfaceLanguage);
      setScreen(session.status === "COMPLETED_LOCKED" ? { name: "completion" } : { name: "journey" });
    } catch (error) {
      await handleSessionLost(error);
    }
  }, [applyLocale, handleSessionLost]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        if (screen.name === "resume") {
          // The private token never stays in the address bar or browser history.
          window.history.replaceState(null, "", "/");
          await ensureCurrentBundle();
          return;
        }
        if (sessionStore.get()) {
          await loadSession();
          return;
        }
        await ensureCurrentBundle();
        setScreen({ name: "welcome" });
        track({ type: "assessment_entered", interfaceLanguage: locale });
      } catch {
        setScreen({ name: "unavailable" });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (screen.name !== "journey" || countries.length > 0) return;
    api
      .countries()
      .then((result) => setCountries(result.codes))
      .catch(() => undefined);
  }, [screen.name, countries.length]);

  useEffect(() => {
    const onHide = () => void flushAnalytics();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  const startSession = useCallback(
    async (sessionToken: string) => {
      sessionStore.set(sessionToken);
      setScreen({ name: "loading" });
      await loadSession();
    },
    [loadSession],
  );

  const changeLocale = async (next: Locale) => {
    if (next === locale) return;
    applyLocale(next);
    track({ type: "language_changed", properties: { to: next } });
    if (view && (screen.name === "journey" || screen.name === "completion")) {
      try {
        setView(await api.setInterfaceLanguage(next));
      } catch {
        // The interface still switches; the stored preference is retried on the next change.
      }
    }
  };

  const finishLater = async () => {
    await flushRef.current?.();
    try {
      const result = await api.finishLater();
      setScreen({ name: "finish_later", accessUntil: result.accessUntil });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 410)) await handleSessionLost(error);
      else setSaveStatus("failed");
    }
  };

  const onStageChange = useCallback((next: StageId | null) => setStage(next), []);

  if (!bundle || !t) {
    return (
      <Shell bundle={null} t={null} locale={locale} onLocaleChange={applyLocale} screenKey={screen.name}>
        {screen.name === "unavailable" ? (
          <p role="alert">{locale === "es" ? "No pudimos cargar la evaluación. Inténtalo de nuevo más tarde." : "We couldn’t load the assessment. Please try again later."}</p>
        ) : (
          <p role="status">{locale === "es" ? "Cargando…" : "Loading…"}</p>
        )}
      </Shell>
    );
  }

  const inJourney = screen.name === "journey" && view !== null;
  return (
    <Shell
      bundle={bundle}
      t={t}
      locale={locale}
      onLocaleChange={(next) => void changeLocale(next)}
      currentStage={inJourney ? stage : screen.name === "completion" ? "snapshot" : null}
      saveStatus={inJourney ? saveStatus : "idle"}
      onFinishLater={inJourney && view.finishLaterAvailable ? () => void finishLater() : undefined}
      screenKey={screen.name === "journey" ? `journey-${stage}` : screen.name}
    >
      {screen.name === "loading" && <p role="status">{t("common", "loading")}</p>}
      {screen.name === "unavailable" && <p role="alert">{t("common", "generic_error")}</p>}
      {screen.name === "welcome" && (
        <Welcome
          t={t}
          onStart={() => {
            track({ type: "assessment_started", interfaceLanguage: locale });
            setScreen({ name: "identity" });
          }}
        />
      )}
      {screen.name === "identity" && (
        <Identity bundle={bundle} t={t} locale={locale} onStarted={(token) => void startSession(token)} onExistingEmail={() => setScreen({ name: "existing_email" })} />
      )}
      {screen.name === "existing_email" && <ExistingEmail t={t} onUseOtherEmail={() => setScreen({ name: "identity" })} />}
      {inJourney && (
        <Journey
          key={sessionKey}
          bundle={bundle}
          t={t}
          locale={locale}
          view={view}
          countries={countries}
          flushRef={flushRef}
          onView={setView}
          onSaveStatus={setSaveStatus}
          onStageChange={onStageChange}
          onCompleted={(completed) => {
            setView(completed);
            setScreen({ name: "completion" });
          }}
          onSessionLost={(error) => void handleSessionLost(error)}
        />
      )}
      {screen.name === "finish_later" && <FinishLaterConfirmation t={t} locale={locale} accessUntil={screen.accessUntil} onKeepGoing={() => setScreen({ name: "journey" })} />}
      {screen.name === "completion" && (
        <SnapshotScreen
          key={sessionKey}
          bundle={bundle}
          t={t}
          locale={locale}
          load={api.sessionSnapshot}
          onLocale={applyLocale}
          anotherProjectInMind={view?.anotherProjectInMind === "yes"}
          onStartAnother={async () => startSession((await api.anotherProject(true)).sessionToken)}
          premium={SESSION_PREMIUM}
          feedback={SESSION_FEEDBACK}
        />
      )}
      {screen.name === "resume" && <ResumeLink bundle={bundle} t={t} locale={locale} token={screen.token} onLocale={applyLocale} onSession={startSession} />}
      {screen.name === "expired" && <RequestLink t={t} title={t("access", "expired_title")} body={t("access", "expired_body")} />}
    </Shell>
  );
}
