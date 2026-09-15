import { T } from "../copy";
import { Bundle } from "../types";

interface LegalConsentProps {
  bundle: Bundle;
  t: T;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: boolean;
  id: string;
}

/**
 * Privacy Policy + Terms acceptance (Handoff v1 §6). Documents open in a new tab so progress is
 * never lost. The Privacy Policy renders as plain text until its canonical URL is published.
 */
export function LegalConsent({ bundle, t, checked, onChange, error, id }: LegalConsentProps) {
  const newTab = t("identity", "legal_opens_new_tab");
  const privacyUrl = bundle.links.privacy_policy_url;
  return (
    <div className="field">
      <div className="check">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <label htmlFor={id} style={{ fontWeight: 400, margin: 0 }}>
          {t("identity", "legal_prefix")}{" "}
          {privacyUrl ? (
            <a href={privacyUrl} target="_blank" rel="noopener noreferrer">
              {t("identity", "privacy_policy")}
              <span className="visually-hidden"> {newTab}</span>
            </a>
          ) : (
            t("identity", "privacy_policy")
          )}{" "}
          {t("identity", "legal_and")}{" "}
          <a href={bundle.links.terms_url} target="_blank" rel="noopener noreferrer">
            {t("identity", "terms")}
            <span className="visually-hidden"> {newTab}</span>
          </a>
        </label>
      </div>
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {t("identity", "legal_required")}
        </p>
      )}
    </div>
  );
}
