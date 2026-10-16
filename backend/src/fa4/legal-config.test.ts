import { validateRuntimeConfig } from "../security/runtime-config";
import { fa4ClosedTestFromEnv, fa4DepsFromEnv, fa4IsInternalStaging, fa4LegalFromEnv } from "../index";
import { closedTestRecipientAllowed } from "./email";

describe("FA4 legal configuration (CHK-1)", () => {
  it("Terms default to the official page and version for both languages", () => {
    const l = fa4LegalFromEnv({ NODE_ENV: "development" } as never);
    expect(l.termsVersion).toBe("1.0-2026-08-27");
    expect(l.termsUrl).toEqual({ es: "https://beeside.you/termsandconditions", en: "https://beeside.you/termsandconditions" });
    expect(l.privacyUrl).toEqual({ es: "https://www.beeside.you/privacy", en: "https://www.beeside.you/privacy" });   // canonical page
    expect(l.privacyVersion).toBe("UNSET-LEGAL-1");   // the document VERSION was not supplied: never invented
  });
  it("production refuses to start without Privacy configuration, and only Privacy is required", () => {
    expect(() => fa4LegalFromEnv({ NODE_ENV: "production" } as never)).toThrow(/requires FA4_PRIVACY_VERSION in production/);
    expect(() => fa4LegalFromEnv({ NODE_ENV: "production" } as never)).not.toThrow(/TERMS/);
    const ok = fa4LegalFromEnv({ NODE_ENV: "production", FA4_PRIVACY_VERSION: "p1", FA4_PRIVACY_URL_ES: "https://x/es", FA4_PRIVACY_URL_EN: "https://x/en" } as never);
    expect(ok.privacyUrl.en).toBe("https://x/en");
    expect(ok.termsVersion).toBe("1.0-2026-08-27");
  });
  it("one Privacy document / version configures both languages", () => {
    const l = fa4LegalFromEnv({ NODE_ENV: "production", FA4_PRIVACY_VERSION: "v", FA4_PRIVACY_URL: "https://doc" } as never);
    expect([l.privacyVersion, l.privacyUrl.es, l.privacyUrl.en]).toEqual(["v", "https://doc", "https://doc"]);
  });
  it("INTERNAL STAGING (explicit FA4_ENV=staging) records a visibly non-legal TEST Privacy value; public production still refuses", () => {
    const l = fa4LegalFromEnv({ NODE_ENV: "production", FA4_ENV: "staging", APP_BASE_URL: "https://fa-staging.internal.example" } as never);
    expect(l.privacyVersion).toBe("STAGING-TEST-NOT-LEGAL");
    expect(l.privacyUrl.es).toBe("https://fa-staging.internal.example/staging/privacy-test");
    expect(l.termsVersion).toBe("1.0-2026-08-27");
    expect(() => fa4LegalFromEnv({ NODE_ENV: "production", APP_BASE_URL: "https://fa-staging.internal.example" } as never)).toThrow(/LEGAL-1/);   // no FA4_ENV → guard intact
    expect(() => fa4LegalFromEnv({ NODE_ENV: "production", FA4_ENV: "production" } as never)).toThrow(/LEGAL-1/);
  });
  it("staging is refused on the public host, and a real Privacy value always wins", () => {
    expect(() => fa4IsInternalStaging({ FA4_ENV: "staging", APP_BASE_URL: "https://www.beeside.you" } as never)).toThrow(/public host/);
    expect(() => fa4IsInternalStaging({ FA4_ENV: "staging", APP_BASE_URL: "https://beeside.you/" } as never)).toThrow(/public host/);
    expect(fa4IsInternalStaging({ APP_BASE_URL: "https://www.beeside.you" } as never)).toBe(false);
    const l = fa4LegalFromEnv({ FA4_ENV: "staging", APP_BASE_URL: "https://s.internal", FA4_PRIVACY_VERSION: "p9", FA4_PRIVACY_URL: "https://real" } as never);
    expect([l.privacyVersion, l.privacyUrl.es]).toEqual(["p9", "https://real"]);
  });
  it("staging email is log-only and delivered inline; everything else is deferred to the worker", () => {
    const base = { FA4_API_ENABLED: "true", DATABASE_URL: "postgres://x@127.0.0.1:1/x", APP_BASE_URL: "https://s.internal", NODE_ENV: "production", FA4_PRIVACY_VERSION: "p", FA4_PRIVACY_URL: "https://p", SMTP_HOST: "smtp.example", SMTP_PASSWORD: "x", FA4_EMAIL_TRANSPORT: "smtp" };
    const st = fa4DepsFromEnv({ ...base, FA4_ENV: "staging", FA4_EMAIL_TRANSPORT: "log" } as never, {} as never)!;
    expect([st.email.name, st.emailDispatch]).toEqual(["log", "inline"]);
    const pr = fa4DepsFromEnv(base as never, {} as never)!;
    expect([pr.email.name, pr.emailDispatch]).toEqual(["smtp", "deferred"]);
    expect(pr.config.contactAddress).toBe("contact@beeside.you");
    expect(() => fa4DepsFromEnv({ ...base, FA4_EMAIL_TRANSPORT: "log" } as never, {} as never)).toThrow(/refused in production/);
  });
  it("FA4 is a public surface: production requires the rate-limit hash secret and an explicit proxy hop count", () => {
    const msgs = validateRuntimeConfig({ NODE_ENV: "production", FA4_API_ENABLED: "true", APP_BASE_URL: "https://fa.example" } as never).filter((i) => i.level === "error").map((i) => i.message).join(" | ");
    expect(msgs).toMatch(/SECURITY_HASH_SECRET/); expect(msgs).toMatch(/TRUST_PROXY_HOPS/);
    expect(validateRuntimeConfig({ NODE_ENV: "production", FA4_API_ENABLED: "true", APP_BASE_URL: "https://fa.example", SECURITY_HASH_SECRET: "x".repeat(32), TRUST_PROXY_HOPS: "1" } as never).filter((i) => i.level === "error")).toEqual([]);
  });
  it("env vars override the Terms defaults for a future version", () => {
    const l = fa4LegalFromEnv({ NODE_ENV: "development", FA4_TERMS_VERSION: "2.0", FA4_TERMS_URL_ES: "https://t/es", FA4_TERMS_URL_EN: "https://t/en" } as never);
    expect([l.termsVersion, l.termsUrl.es, l.termsUrl.en]).toEqual(["2.0", "https://t/es", "https://t/en"]);
  });
});

describe("CLOSED TEST mode (closed production, fictitious data, no final Privacy version)", () => {
  const closed = { NODE_ENV: "production", FA4_CLOSED_TEST_MODE: "true" } as never;
  it("lets a CLOSED deployment start without a Privacy version, records a visibly non-legal marker, and invents no legal value", () => {
    const l = fa4LegalFromEnv(closed);
    expect(l.privacyVersion).toBe("CLOSED-TEST-NOT-LEGAL");
    expect(l.termsVersion).toBe("1.0-2026-08-27"); expect(l.privacyUrl.es).toBe("https://www.beeside.you/privacy");
    expect(fa4ClosedTestFromEnv(closed)).toEqual({ emailDomains: ["beeside.you"], emailAddresses: [] });
  });
  it("is opt-in only: without the flag production still refuses (final legal requirement intact)", () => {
    expect(() => fa4LegalFromEnv({ NODE_ENV: "production" } as never)).toThrow(/requires FA4_PRIVACY_VERSION in production/);
    expect(() => fa4LegalFromEnv({ NODE_ENV: "production", FA4_CLOSED_TEST_MODE: "yes" } as never)).toThrow(/requires FA4_PRIVACY_VERSION/);   // only the literal "true"
  });
  it("a final FA4_PRIVACY_VERSION ends test mode: the combination is refused so nobody runs 'final' data under the test regime", () => {
    expect(() => fa4LegalFromEnv({ ...closed as object, FA4_PRIVACY_VERSION: "p1" } as never)).toThrow(/must be removed once the final FA4_PRIVACY_VERSION/);
  });
  it("is refused for internal staging and for commercial Premium content; e-mail domains are validated", () => {
    expect(() => fa4ClosedTestFromEnv({ ...closed as object, FA4_ENV: "staging" } as never)).toThrow(/not internal staging/);
    expect(() => fa4ClosedTestFromEnv({ ...closed as object, FA4_PREMIUM_COMMERCIAL_CONTENT_ALLOWED: "true" } as never)).toThrow(/forbids commercial/);
    expect(() => fa4ClosedTestFromEnv({ ...closed as object, FA4_CLOSED_TEST_EMAIL_DOMAINS: "not a domain" } as never)).toThrow(/domains/);
    expect(fa4ClosedTestFromEnv({ ...closed as object, FA4_CLOSED_TEST_EMAIL_DOMAINS: "Beeside.you, test.example" } as never)).toEqual({ emailDomains: ["beeside.you", "test.example"], emailAddresses: [] });
  });
  it("individual e-mail addresses: parsed (case, «,» «;» spaces), validated without echoing the value, combinable with or instead of domains, and fail closed when nothing is allowed", () => {
    const cfg = (x: Record<string, string>) => ({ ...closed as object, ...x } as never);
    expect(fa4ClosedTestFromEnv(cfg({ FA4_CLOSED_TEST_EMAIL_ADDRESSES: "Rev.One@Hive.example; rev.two@other.example  third@x.example" }))).toEqual({ emailDomains: ["beeside.you"], emailAddresses: ["rev.one@hive.example", "rev.two@other.example", "third@x.example"] });
    expect(fa4ClosedTestFromEnv(cfg({ FA4_CLOSED_TEST_EMAIL_DOMAINS: "", FA4_CLOSED_TEST_EMAIL_ADDRESSES: "rev.one@hive.example" }))).toEqual({ emailDomains: [], emailAddresses: ["rev.one@hive.example"] });
    let msg = ""; try { fa4ClosedTestFromEnv(cfg({ FA4_CLOSED_TEST_EMAIL_ADDRESSES: "good@x.example, secret.person@not valid" })); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/must be a list of e-mail addresses/); expect(msg).not.toMatch(/secret\.person|good@/);
    expect(() => fa4ClosedTestFromEnv(cfg({ FA4_CLOSED_TEST_EMAIL_DOMAINS: "" }))).toThrow(/fail closed/);
  });
  it("e-mail recipients are restricted to the allowed test domains (and unrestricted when not in test mode)", () => {
    const ct = { emailDomains: ["beeside.you"] };
    expect(closedTestRecipientAllowed("Ana@Beeside.you", ct)).toBe(true);
    for (const bad of ["prospect@gmail.com", "x@beeside.you.evil.test", "x@sub.beeside.you", "nobody"]) expect(closedTestRecipientAllowed(bad, ct)).toBe(false);
    expect(closedTestRecipientAllowed("anyone@gmail.com", undefined)).toBe(true);
  });
  it("an individually authorized address is mailed — exactly that one: no whole domain is opened, aliases and tricks are refused", () => {
    const ct = { emailDomains: [], emailAddresses: ["rev.one@hive.example"] };
    expect(closedTestRecipientAllowed("Rev.One@Hive.example", ct)).toBe(true);
    for (const bad of ["rev.two@hive.example", "rev.one+tag@hive.example", "x.rev.one@hive.example", "rev.one@hive.example.evil.test", "rev.one@sub.hive.example",
      "rev.one@hive.example, other@x.example", "rev.one@hive.example;other@x.example", "Rev <rev.one@hive.example>", "\"rev.one@hive.example\"", "other@x.example@hive.example", "rev.one@hive.example other@x.example", ""]) expect(closedTestRecipientAllowed(bad, ct)).toBe(false);
    expect(closedTestRecipientAllowed("anybody@beeside.you", { emailDomains: ["beeside.you"], emailAddresses: ["rev.one@hive.example"] })).toBe(true);   // domains still work
    expect(closedTestRecipientAllowed("anybody@hive.example", { emailDomains: [], emailAddresses: [] })).toBe(false);                                  // nothing allowed → nobody
    expect(closedTestRecipientAllowed("a@beeside.you@evil.test", { emailDomains: ["beeside.you"] })).toBe(false);                                      // the old «last @» trick
  });
});

describe("FA4_EDGE_DIAGNOSTIC (TRUST_PROXY_HOPS measurement aid)", () => {
  const base = { DATABASE_URL: "postgres://x@127.0.0.1:1/x", APP_BASE_URL: "https://x.example", FA4_API_ENABLED: "true", NODE_ENV: "production", FA4_EMAIL_TRANSPORT: "smtp", SMTP_HOST: "h", SMTP_PASSWORD: "p" };
  it("is allowed in CLOSED TEST production and refused in final production", () => {
    expect(fa4DepsFromEnv({ ...base, FA4_CLOSED_TEST_MODE: "true", FA4_EDGE_DIAGNOSTIC: "true" } as never)?.config.edgeDiagnostic).toBe(true);
    expect(() => fa4DepsFromEnv({ ...base, FA4_PRIVACY_VERSION: "v", FA4_EDGE_DIAGNOSTIC: "true" } as never)).toThrow(/only allowed in CLOSED TEST/);
    expect(fa4DepsFromEnv({ ...base, FA4_CLOSED_TEST_MODE: "true" } as never)?.config.edgeDiagnostic).toBeUndefined();
  });
});
