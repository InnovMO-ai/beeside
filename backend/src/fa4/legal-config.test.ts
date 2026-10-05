import { validateRuntimeConfig } from "../security/runtime-config";
import { fa4DepsFromEnv, fa4IsInternalStaging, fa4LegalFromEnv } from "../index";

describe("FA4 legal configuration (CHK-1)", () => {
  it("Terms default to the official page and version for both languages", () => {
    const l = fa4LegalFromEnv({ NODE_ENV: "development" } as never);
    expect(l.termsVersion).toBe("1.0-2026-08-27");
    expect(l.termsUrl).toEqual({ es: "https://www.beeside.you/termsandconditions", en: "https://www.beeside.you/termsandconditions" });
    expect(l.privacyVersion).toBe("UNSET-LEGAL-1");   // Privacy stays an explicit placeholder until its URL / version are provided
  });
  it("production refuses to start without Privacy configuration, and only Privacy is required", () => {
    expect(() => fa4LegalFromEnv({ NODE_ENV: "production" } as never)).toThrow(/FA4_PRIVACY_VERSION, FA4_PRIVACY_URL_ES \(or FA4_PRIVACY_URL\), FA4_PRIVACY_URL_EN \(or FA4_PRIVACY_URL\)/);
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
    const base = { FA4_API_ENABLED: "true", DATABASE_URL: "postgres://x@127.0.0.1:1/x", APP_BASE_URL: "https://s.internal", NODE_ENV: "production", FA4_PRIVACY_VERSION: "p", FA4_PRIVACY_URL: "https://p" };
    const st = fa4DepsFromEnv({ ...base, FA4_ENV: "staging" } as never, {} as never)!;
    expect([st.email.name, st.emailDispatch]).toEqual(["log", "inline"]);
    const pr = fa4DepsFromEnv(base as never, {} as never)!;
    expect(pr.emailDispatch).toBe("deferred");
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
