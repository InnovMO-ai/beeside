import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { LegalConsent } from "../components/LegalConsent";
import { formatDate, T } from "../copy";
import { Bundle, ExtensionReason, LinkChoices, Locale } from "../types";
import { RequestLink } from "./SimpleScreens";
import { SnapshotScreen } from "./SnapshotScreen";

type Mode =
  | { name: "opening" }
  | { name: "choices"; choices: LinkChoices }
  | { name: "recover"; choices: LinkChoices }
  | { name: "extended"; accessUntil: string }
  | { name: "new_project"; sameCompany: boolean; choices: LinkChoices }
  | { name: "invalid" };

const REASONS: ExtensionReason[] = ["missing_information", "project_not_structured", "unsure_market_timing", "something_else"];

interface ResumeLinkProps {
  bundle: Bundle;
  t: T;
  locale: Locale;
  token: string;
  onLocale: (locale: Locale) => void;
  onSession: (sessionToken: string) => Promise<void>;
}

/** Private resume link: continue, recover/extend (Handoff v1 §18), or start a new project. Opening never extends access. */
export function ResumeLink({ bundle, t, locale, token, onLocale, onSession }: ResumeLinkProps) {
  const [mode, setMode] = useState<Mode>({ name: "opening" });
  const [failure, setFailure] = useState(false);
  const [busy, setBusy] = useState(false);

  const open = async (applyLocale: boolean) => {
    try {
      const choices = await api.openLink(token);
      if (applyLocale && (choices.interfaceLanguage === "en" || choices.interfaceLanguage === "es")) onLocale(choices.interfaceLanguage);
      setMode({ name: "choices", choices });
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) setMode({ name: "invalid" });
      else setFailure(true);
    }
  };

  useEffect(() => {
    void open(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setFailure(false);
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiError && (error.code === "ACCESS_EXPIRED" || error.code === "NOT_RECOVERABLE" || error.code === "LOCKED")) await open(false);
      else if (error instanceof ApiError && error.code === "NOT_FOUND") setMode({ name: "invalid" });
      else setFailure(true);
    } finally {
      setBusy(false);
    }
  };

  const continueAssessment = () => run(async () => onSession((await api.continueLink(token)).sessionToken));
  const errorLine = failure && (
    <p className="field-error" role="alert">
      {t("common", "generic_error")}
    </p>
  );

  if (mode.name === "opening") {
    return (
      <section className="content">
        <p role="status">{t("resume", "opening")}</p>
        {errorLine}
      </section>
    );
  }
  if (mode.name === "invalid") {
    return <RequestLink t={t} title={t("resume", "invalid_title")} body={t("resume", "invalid_body")} />;
  }
  if (mode.name === "extended") {
    return (
      <section className="content" aria-labelledby="extended-title">
        <h1 className="display" id="extended-title">
          {t("access", "extended", { access_until: formatDate(mode.accessUntil, locale) })}
        </h1>
        {errorLine}
        <div className="actions">
          <button type="button" className="button button-primary" disabled={busy} onClick={() => void continueAssessment()}>
            {t("access", "continue_cta")}
          </button>
        </div>
      </section>
    );
  }
  if (mode.name === "recover") {
    return <RecoverForm t={t} busy={busy} errorLine={errorLine} onSubmit={(days, reason) => run(async () => setMode({ name: "extended", accessUntil: (await api.extendLink(token, days, reason)).accessUntil }))} />;
  }
  if (mode.name === "new_project") {
    return (
      <NewProjectForm
        bundle={bundle}
        t={t}
        busy={busy}
        errorLine={errorLine}
        sameCompany={mode.sameCompany}
        companyName={mode.choices.companyName}
        onBack={() => setMode({ name: "choices", choices: mode.choices })}
        onSubmit={(input) => run(async () => onSession((await api.newProjectFromLink(token, input)).sessionToken))}
      />
    );
  }

  const { choices } = mode;
  const newProjectActions = (
    <>
      <button type="button" className="button button-secondary" onClick={() => setMode({ name: "new_project", sameCompany: true, choices })}>
        {t("resume", "start_new_same_company", { company_name: choices.companyName })}
      </button>
      <button type="button" className="button button-text" onClick={() => setMode({ name: "new_project", sameCompany: false, choices })}>
        {t("resume", "start_new_other_company")}
      </button>
    </>
  );

  if (choices.canRecover) {
    return (
      <section className="content" aria-labelledby="recover-title">
        <h1 className="display" id="recover-title">
          {t("access", "expired_title")}
        </h1>
        <p className="lead">{t("access", "expired_body")}</p>
        {errorLine}
        <div className="actions">
          <button type="button" className="button button-primary" onClick={() => setMode({ name: "recover", choices })}>
            {t("access", "recover_cta")}
          </button>
        </div>
      </section>
    );
  }
  if (choices.closed) {
    return (
      <section className="content" aria-labelledby="closed-title">
        <h1 className="display" id="closed-title">
          {t("access", "closed_title")}
        </h1>
        <p className="lead">{t("access", "closed_body")}</p>
        <div className="actions">{newProjectActions}</div>
      </section>
    );
  }
  if (choices.completed) {
    // A completed assessment's private link opens its immutable Expansion Snapshot, then routes by
    // Premium history (Technical Architecture v1.1 §7): never → Premium offer plus a separate new
    // project; active → the Premium state; lapsed → reactivation of this same project, with no
    // new-project prompt for the same relationship.
    const premiumHistory = choices.premium?.everActivated === true;
    return (
      <>
        <SnapshotScreen
          bundle={bundle}
          t={t}
          locale={locale}
          load={() => api.linkSnapshot(token)}
          onLocale={onLocale}
          anotherProjectInMind={false}
          premium={{ loadStatus: () => api.linkPremium(token), activate: (acceptTerms) => api.linkPremiumActivation(token, acceptTerms) }}
        />
        {!premiumHistory && (
          <section className="content snapshot-next" aria-labelledby="choices-title">
            <h2 className="step-title" id="choices-title">
              {t("resume", "choose_title")}
            </h2>
            <div className="actions">{newProjectActions}</div>
          </section>
        )}
      </>
    );
  }
  return (
    <section className="content" aria-labelledby="choices-title">
      <h1 className="display" id="choices-title">
        {t("resume", "choose_title")}
      </h1>
      {errorLine}
      <div className="actions">
        {choices.canContinue && (
          <button type="button" className="button button-primary" disabled={busy} onClick={() => void continueAssessment()}>
            {t("resume", "continue_saved")}
          </button>
        )}
        {newProjectActions}
      </div>
    </section>
  );
}

function RecoverForm({ t, busy, errorLine, onSubmit }: { t: T; busy: boolean; errorLine: React.ReactNode; onSubmit: (days: 15 | 30, reason: ExtensionReason) => Promise<void> }) {
  const [days, setDays] = useState<15 | 30 | null>(null);
  const [reason, setReason] = useState<ExtensionReason | null>(null);
  const [missing, setMissing] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!days || !reason) {
      setMissing(true);
      return;
    }
    void onSubmit(days, reason);
  };

  return (
    <form className="content" onSubmit={submit} noValidate>
      <fieldset className="question">
        <legend style={{ padding: 0 }}>
          <h1 className="question-title">{t("access", "extend_title")}</h1>
        </legend>
        <div className="options">
          {([15, 30] as const).map((d) => (
            <label key={d} className="option" data-selected={days === d}>
              <input type="radio" name="extend-days" checked={days === d} onChange={() => setDays(d)} />
              <span>{t("access", `extend_${d}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="question" style={{ marginTop: "2.5rem" }}>
        <legend style={{ padding: 0 }}>
          <h2 className="question-title" style={{ fontSize: "1.5rem" }}>
            {t("access", "reason_title")}
          </h2>
        </legend>
        <div className="options">
          {REASONS.map((r) => (
            <label key={r} className="option" data-selected={reason === r}>
              <input type="radio" name="extend-reason" checked={reason === r} onChange={() => setReason(r)} />
              <span>{t("access", `reason_${r}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {missing && (!days || !reason) && (
        <p className="field-error" role="alert">
          {t("common", "required_error")}
        </p>
      )}
      {errorLine}
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          {t("access", "extend_submit")}
        </button>
      </div>
    </form>
  );
}

function NewProjectForm({
  bundle,
  t,
  busy,
  errorLine,
  sameCompany,
  companyName,
  onBack,
  onSubmit,
}: {
  bundle: Bundle;
  t: T;
  busy: boolean;
  errorLine: React.ReactNode;
  sameCompany: boolean;
  companyName: string;
  onBack: () => void;
  onSubmit: (input: { sameCompany: boolean; acceptLegal: boolean; companyName?: string; companyWebsite?: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [accept, setAccept] = useState(false);
  const [errors, setErrors] = useState({ name: false, legal: false });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = { name: !sameCompany && name.trim() === "", legal: !accept };
    setErrors(found);
    if (found.name || found.legal) return;
    void onSubmit(sameCompany ? { sameCompany, acceptLegal: true } : { sameCompany, acceptLegal: true, companyName: name.trim(), companyWebsite: website.trim() || undefined });
  };

  return (
    <form className="content" onSubmit={submit} noValidate aria-labelledby="new-project-title">
      <h1 className="display" id="new-project-title">
        {sameCompany ? t("resume", "start_new_same_company", { company_name: companyName }) : t("resume", "start_new_other_company")}
      </h1>
      {!sameCompany && (
        <>
          <div className="field">
            <label htmlFor="new-company">{t("identity", "company")}</label>
            <input
              id="new-company"
              className="input"
              autoComplete="organization"
              value={name}
              aria-invalid={errors.name || undefined}
              aria-describedby={errors.name ? "new-company-error" : undefined}
              onChange={(e) => setName(e.target.value)}
            />
            {errors.name && (
              <p className="field-error" id="new-company-error">
                {t("common", "required_error")}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="new-website">
              {t("identity", "website")}
              <span className="optional-tag"> · {t("common", "optional")}</span>
            </label>
            <input id="new-website" className="input" type="url" autoComplete="url" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
        </>
      )}
      <LegalConsent id="new-project-legal" bundle={bundle} t={t} checked={accept} onChange={setAccept} error={errors.legal} />
      {errorLine}
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          {t("common", "continue")}
        </button>
        <button type="button" className="button button-text" onClick={onBack}>
          {t("common", "back")}
        </button>
      </div>
    </form>
  );
}
