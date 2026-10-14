import { isLiveKey, stripeConfigFromEnv } from "./config";
import { DEFAULT_PREMIUM_POLICY, premiumPolicyFromEnv } from "../premium-policy";

const base = {
  STRIPE_SECRET_KEY: "sk_test_ABCDEF0123456789",
  STRIPE_WEBHOOK_SECRET: "whsec_one,whsec_two",
  STRIPE_PRICE_ID: "price_123ABC",
  STRIPE_SUCCESS_URL: "https://app.example.test/premium/return",
  STRIPE_CANCEL_URL: "https://app.example.test/premium",
};

describe("Stripe configuration", () => {
  it("reads a complete sandbox configuration; the API base URL is overridable outside production", () => {
    const c = stripeConfigFromEnv({ ...base, STRIPE_API_BASE_URL: "http://127.0.0.1:9999" } as NodeJS.ProcessEnv);
    expect(c.webhookSecrets).toEqual(["whsec_one", "whsec_two"]);
    expect(c.apiBaseUrl).toBe("http://127.0.0.1:9999");
    expect(c.priceId).toBe("price_123ABC");
  });

  it("billing mode defaults to the one-time payment and accepts only payment or subscription", () => {
    expect(stripeConfigFromEnv(base as NodeJS.ProcessEnv).billingMode).toBe("payment");
    expect(stripeConfigFromEnv({ ...base, STRIPE_BILLING_MODE: "subscription" } as NodeJS.ProcessEnv).billingMode).toBe("subscription");
    expect(() => stripeConfigFromEnv({ ...base, STRIPE_BILLING_MODE: "monthly" } as NodeJS.ProcessEnv)).toThrow(/STRIPE_BILLING_MODE/);
  });

  it("refuses missing or malformed values without echoing them", () => {
    expect(() => stripeConfigFromEnv({ ...base, STRIPE_SECRET_KEY: undefined } as unknown as NodeJS.ProcessEnv)).toThrow(/STRIPE_SECRET_KEY is required/);
    expect(() => stripeConfigFromEnv({ ...base, STRIPE_SECRET_KEY: "pk_test_nope" } as NodeJS.ProcessEnv)).toThrow(/not a Stripe secret/);
    expect(() => stripeConfigFromEnv({ ...base, STRIPE_WEBHOOK_SECRET: "nope" } as NodeJS.ProcessEnv)).toThrow(/whsec_/);
    expect(() => stripeConfigFromEnv({ ...base, STRIPE_PRICE_ID: "prod_x" } as NodeJS.ProcessEnv)).toThrow(/price_/);
    expect(() => stripeConfigFromEnv({ ...base, STRIPE_SUCCESS_URL: "javascript:alert(1)" } as NodeJS.ProcessEnv)).toThrow(/http/);
    try {
      stripeConfigFromEnv({ ...base, STRIPE_SECRET_KEY: "sk_test_ok", STRIPE_WEBHOOK_SECRET: "leaky-secret-value" } as NodeJS.ProcessEnv);
    } catch (e) {
      expect(String(e)).not.toContain("leaky-secret-value");
    }
  });

  it("accepts a live key only in production and never lets production redirect the API base URL", () => {
    const live = { ...base, STRIPE_SECRET_KEY: "sk_live_ABCDEF0123456789" };
    expect(isLiveKey(live.STRIPE_SECRET_KEY)).toBe(true);
    expect(() => stripeConfigFromEnv(live as NodeJS.ProcessEnv)).toThrow(/NODE_ENV=production/);
    expect(stripeConfigFromEnv({ ...live, NODE_ENV: "production" } as NodeJS.ProcessEnv).secretKey).toBe(live.STRIPE_SECRET_KEY);
    expect(() => stripeConfigFromEnv({ ...live, NODE_ENV: "production", STRIPE_API_BASE_URL: "http://evil.test" } as NodeJS.ProcessEnv)).toThrow(/production/);
  });
});

describe("Core Premium policy (Stripe does not own the duration)", () => {
  it("defaults, overrides and rejects out-of-range values", () => {
    expect(premiumPolicyFromEnv({} as NodeJS.ProcessEnv)).toEqual(DEFAULT_PREMIUM_POLICY);
    expect(premiumPolicyFromEnv({ PREMIUM_ACCESS_PERIOD_DAYS: "180", PRECISION_READONLY_GRACE_DAYS: "30" } as unknown as NodeJS.ProcessEnv)).toEqual({ accessPeriodDays: 180, readonlyGraceDays: 30, renewalSafetyDays: 14 });
    expect(premiumPolicyFromEnv({ PREMIUM_RENEWAL_SAFETY_DAYS: "7" } as unknown as NodeJS.ProcessEnv).renewalSafetyDays).toBe(7);
    expect(() => premiumPolicyFromEnv({ PREMIUM_RENEWAL_SAFETY_DAYS: "91" } as unknown as NodeJS.ProcessEnv)).toThrow();
    expect(premiumPolicyFromEnv({ PRECISION_READONLY_GRACE_DAYS: "0" } as unknown as NodeJS.ProcessEnv).readonlyGraceDays).toBe(0);
    expect(() => premiumPolicyFromEnv({ PREMIUM_ACCESS_PERIOD_DAYS: "0" } as unknown as NodeJS.ProcessEnv)).toThrow();
    expect(() => premiumPolicyFromEnv({ PREMIUM_ACCESS_PERIOD_DAYS: "abc" } as unknown as NodeJS.ProcessEnv)).toThrow();
  });
});
