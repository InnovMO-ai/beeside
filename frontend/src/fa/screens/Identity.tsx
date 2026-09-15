import { FormEvent, useState } from "react";
import { anonymousSessionId } from "../analytics";
import { api, ApiError } from "../api";
import { LegalConsent } from "../components/LegalConsent";
import { isPersonalEmail, T } from "../copy";
import { Bundle, Locale } from "../types";

type FieldName = "firstName" | "lastName" | "company" | "email" | "website" | "acceptLegal";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WEBSITE_PATTERN = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i;

interface IdentityProps {
  bundle: Bundle;
  t: T;
  locale: Locale;
  onStarted: (sessionToken: string) => void;
  onExistingEmail: () => void;
}

export function Identity({ bundle, t, locale, onStarted, onExistingEmail }: IdentityProps) {
  const [values, setValues] = useState({ firstName: "", lastName: "", company: "", email: "", website: "" });
  const [acceptLegal, setAcceptLegal] = useState(false);
  const [personalAck, setPersonalAck] = useState(false);
  const [errors, setErrors] = useState<Set<FieldName>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState(false);

  const personal = EMAIL_PATTERN.test(values.email.trim()) && isPersonalEmail(bundle, values.email);

  function validate(): Set<FieldName> {
    const found = new Set<FieldName>();
    if (!values.firstName.trim()) found.add("firstName");
    if (!values.lastName.trim()) found.add("lastName");
    if (!values.company.trim()) found.add("company");
    if (!EMAIL_PATTERN.test(values.email.trim())) found.add("email");
    if (values.website.trim() && !WEBSITE_PATTERN.test(values.website.trim())) found.add("website");
    if (!acceptLegal) found.add("acceptLegal");
    return found;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(false);
    const found = validate();
    setErrors(found);
    if (found.size > 0) {
      const first = ["firstName", "lastName", "company", "email", "website", "acceptLegal"].find((f) => found.has(f as FieldName));
      document.getElementById(`identity-${first}`)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.submitIdentity({
        ...values,
        interfaceLanguage: locale,
        acceptLegal,
        personalEmailAcknowledged: personal && personalAck,
        anonymousSessionId: anonymousSessionId(),
      });
      if (result.status === "started") onStarted(result.sessionToken);
      else onExistingEmail();
    } catch (error) {
      const fields = error instanceof ApiError ? (error.details?.fields as FieldName[] | undefined) : undefined;
      if (fields?.length) setErrors(new Set(fields));
      else setFailure(true);
      setSubmitting(false);
    }
  }

  const input = (name: Exclude<FieldName, "acceptLegal">, label: string, options: { type?: string; autoComplete?: string; optional?: boolean; helper?: string; error?: string } = {}) => {
    const describedBy = [options.helper ? `identity-${name}-helper` : "", errors.has(name) ? `identity-${name}-error` : ""].filter(Boolean).join(" ");
    return (
      <div className="field">
        <label htmlFor={`identity-${name}`}>
          {label}
          {options.optional && <span className="optional-tag"> · {t("common", "optional")}</span>}
        </label>
        <input
          id={`identity-${name}`}
          className="input"
          type={options.type ?? "text"}
          autoComplete={options.autoComplete}
          value={values[name]}
          required={!options.optional}
          aria-invalid={errors.has(name) || undefined}
          aria-describedby={describedBy || undefined}
          onChange={(e) => setValues({ ...values, [name]: e.target.value })}
        />
        {options.helper && (
          <p className="helper" id={`identity-${name}-helper`}>
            {options.helper}
          </p>
        )}
        {errors.has(name) && (
          <p className="field-error" id={`identity-${name}-error`}>
            {options.error ?? t("common", "required_error")}
          </p>
        )}
      </div>
    );
  };

  return (
    <form className="content" onSubmit={submit} noValidate aria-labelledby="identity-title">
      <h1 className="display" id="identity-title">
        {t("identity", "title")}
      </h1>
      <p className="lead">{t("identity", "intro")}</p>
      <div className="two-col">
        {input("firstName", t("identity", "first_name"), { autoComplete: "given-name" })}
        {input("lastName", t("identity", "last_name"), { autoComplete: "family-name" })}
      </div>
      {input("company", t("identity", "company"), { autoComplete: "organization" })}
      {input("email", t("identity", "email"), {
        type: "email",
        autoComplete: "email",
        helper: `${t("identity", "email_helper")} ${t("identity", "email_usage")}`,
        error: t("identity", "email_invalid"),
      })}
      {personal && (
        <div className="field">
          <p className="note">{t("identity", "personal_email_note")}</p>
          <div className="check">
            <input id="identity-personal-ack" type="checkbox" checked={personalAck} onChange={(e) => setPersonalAck(e.target.checked)} />
            <label htmlFor="identity-personal-ack" style={{ fontWeight: 400, margin: 0 }}>
              {t("identity", "personal_email_ack")}
            </label>
          </div>
        </div>
      )}
      {input("website", t("identity", "website"), { type: "url", autoComplete: "url", optional: true, error: t("identity", "website_invalid") })}
      <LegalConsent id="identity-acceptLegal" bundle={bundle} t={t} checked={acceptLegal} onChange={setAcceptLegal} error={errors.has("acceptLegal")} />
      {failure && (
        <p className="field-error" role="alert">
          {t("common", "generic_error")}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={submitting}>
          {t("common", "continue")}
        </button>
      </div>
    </form>
  );
}
