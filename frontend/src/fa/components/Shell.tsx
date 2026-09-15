import { ReactNode, useEffect, useRef } from "react";
import logoUrl from "../../assets/beeside-logo.png";
import { SaveStatus } from "../autosave";
import { T } from "../copy";
import { Bundle, Locale, StageId } from "../types";

interface ShellProps {
  bundle: Bundle | null;
  locale: Locale;
  t: T | null;
  onLocaleChange: (locale: Locale) => void;
  currentStage?: StageId | null;
  saveStatus?: SaveStatus;
  onFinishLater?: () => void;
  /** Changes whenever the screen changes, so focus moves to the new content for keyboard and screen-reader users. */
  screenKey: string;
  children: ReactNode;
}

const LOCALE_NAMES: Record<Locale, string> = { en: "English", es: "Español" };

export function Shell({ bundle, locale, t, onLocaleChange, currentStage, saveStatus, onFinishLater, screenKey, children }: ShellProps) {
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
    if (!/jsdom/i.test(navigator.userAgent)) window.scrollTo(0, 0);
  }, [screenKey]);

  const stages = bundle?.stages ?? [];
  const currentIndex = currentStage ? stages.findIndex((s) => s.id === currentStage) : -1;
  const label = (key: string, fallback: string) => (t ? t("common", key) : fallback);

  return (
    <>
      <a className="skip-link" href="#main">
        {locale === "es" ? "Saltar al contenido" : "Skip to content"}
      </a>
      <header className="shell-header">
        <img className="logo" src={logoUrl} alt="beeside" />
        <div className="header-actions">
          {onFinishLater && (
            <button type="button" className="button button-text" onClick={onFinishLater}>
              {label("finish_later", "Finish later")}
            </button>
          )}
          <label>
            <span className="visually-hidden">{label("language", "Language")}</span>
            <select className="language-select" value={locale} onChange={(e) => onLocaleChange(e.target.value as Locale)}>
              {(bundle?.locales ?? (["en", "es"] as Locale[])).map((l) => (
                <option key={l} value={l}>
                  {LOCALE_NAMES[l]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      {currentStage && stages.length > 0 && (
        <nav className="progress-rail" aria-label={label("progress_label", "Assessment progress")}>
          <ol>
            {stages.map((stage, index) => {
              const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming";
              return (
                <li key={stage.id} data-state={state} aria-current={state === "current" ? "step" : undefined}>
                  {stage.copy[locale].label}
                </li>
              );
            })}
          </ol>
        </nav>
      )}
      <main id="main" ref={mainRef} tabIndex={-1} style={{ outline: "none" }}>
        <div className="content-wrap">{children}</div>
        {saveStatus && saveStatus !== "idle" && t && (
          <p className="save-status" role="status" aria-live="polite" data-status={saveStatus}>
            {saveStatus === "saved" && t("common", "saved")}
            {saveStatus === "retrying" && t("common", "save_error")}
            {saveStatus === "failed" && t("common", "save_failed")}
          </p>
        )}
      </main>
    </>
  );
}
