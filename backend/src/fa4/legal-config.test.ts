import { fa4LegalFromEnv } from "../index";

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
  it("env vars override the Terms defaults for a future version", () => {
    const l = fa4LegalFromEnv({ NODE_ENV: "development", FA4_TERMS_VERSION: "2.0", FA4_TERMS_URL_ES: "https://t/es", FA4_TERMS_URL_EN: "https://t/en" } as never);
    expect([l.termsVersion, l.termsUrl.es, l.termsUrl.en]).toEqual(["2.0", "https://t/es", "https://t/en"]);
  });
});
