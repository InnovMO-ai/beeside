/**
 * Stripe adapter configuration. Everything comes from the environment / secrets store — nothing is hard-coded and
 * nothing in this module is ever logged. Stripe is only a payment platform: it does not own the Premium duration
 * (see premium-policy.ts) and its identifiers never reach customer-facing surfaces.
 */
export interface StripeConfig {
  /** sk_test_... / rk_test_... in sandbox; the live key only in production. Never logged. */
  secretKey: string;
  /** Webhook signing secret(s) (whsec_...). More than one is accepted so a secret can be rotated without downtime. */
  webhookSecrets: string[];
  /** The price of Premium (price_...): a one-time price in `payment` mode, a recurring price in `subscription` mode. */
  priceId: string;
  /**
   * payment (default): one-time Checkout, Core grants the configured access period. subscription: recurring billing; Core's paid-through date
   * follows the collected invoices. Both converge on the same provider-agnostic subscription events.
   */
  billingMode?: "payment" | "subscription";
  /** Optional: the product the price belongs to (used by the sandbox verification script only). */
  productId?: string;
  successUrl: string;
  cancelUrl: string;
  /** Default https://api.stripe.com; a local fake server in tests. */
  apiBaseUrl: string;
  /** Pinned API version sent as Stripe-Version. */
  apiVersion: string;
  requestTimeoutMs: number;
  /** Retries for network errors / 5xx on calls that are idempotent (create uses its Idempotency-Key). */
  maxRetries: number;
}

export const DEFAULT_STRIPE_API_BASE_URL = "https://api.stripe.com";
export const DEFAULT_STRIPE_API_VERSION = "2024-06-20";

export function isLiveKey(secretKey: string): boolean {
  return /^(sk|rk)_live_/.test(secretKey);
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || value.trim() === "") throw new Error(`${name} is required when STRIPE_CHECKOUT_ENABLED=true`);
  return value.trim();
}

function httpUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${name} must be an absolute http(s) URL`);
  return value;
}

function billingMode(env: NodeJS.ProcessEnv): "payment" | "subscription" {
  const raw = env.STRIPE_BILLING_MODE?.trim();
  if (raw === undefined || raw === "") return "payment";
  if (raw !== "payment" && raw !== "subscription") throw new Error("STRIPE_BILLING_MODE must be payment or subscription");
  return raw;
}

/** Reads and validates the configuration. Throws (without echoing any value) when something is missing or malformed. */
export function stripeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StripeConfig {
  const secretKey = required(env, "STRIPE_SECRET_KEY");
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(secretKey)) throw new Error("STRIPE_SECRET_KEY is not a Stripe secret/restricted key");
  if (isLiveKey(secretKey) && env.NODE_ENV !== "production") throw new Error("a live Stripe key is only accepted with NODE_ENV=production");
  const webhookSecrets = required(env, "STRIPE_WEBHOOK_SECRET").split(",").map((s) => s.trim()).filter(Boolean);
  if (webhookSecrets.length === 0 || webhookSecrets.some((s) => !s.startsWith("whsec_"))) throw new Error("STRIPE_WEBHOOK_SECRET must hold one or more whsec_ signing secrets");
  const priceId = required(env, "STRIPE_PRICE_ID");
  if (!/^price_[A-Za-z0-9]+$/.test(priceId)) throw new Error("STRIPE_PRICE_ID must be a Stripe price id (price_...)");
  const apiBaseUrl = env.STRIPE_API_BASE_URL?.trim() || DEFAULT_STRIPE_API_BASE_URL;
  if (env.STRIPE_API_BASE_URL && env.NODE_ENV === "production" && apiBaseUrl !== DEFAULT_STRIPE_API_BASE_URL) throw new Error("STRIPE_API_BASE_URL may not be overridden in production");
  return {
    secretKey,
    webhookSecrets,
    priceId,
    billingMode: billingMode(env),
    ...(env.STRIPE_PRODUCT_ID ? { productId: env.STRIPE_PRODUCT_ID.trim() } : {}),
    successUrl: httpUrl(required(env, "STRIPE_SUCCESS_URL"), "STRIPE_SUCCESS_URL"),
    cancelUrl: httpUrl(required(env, "STRIPE_CANCEL_URL"), "STRIPE_CANCEL_URL"),
    apiBaseUrl: httpUrl(apiBaseUrl, "STRIPE_API_BASE_URL"),
    apiVersion: env.STRIPE_API_VERSION?.trim() || DEFAULT_STRIPE_API_VERSION,
    requestTimeoutMs: 10_000,
    maxRetries: 2,
  };
}

/** The webhook endpoint needs only the signing secrets (and the key mode to refuse events from the wrong mode). */
export function stripeLivemodeExpected(config: Pick<StripeConfig, "secretKey">): boolean {
  return isLiveKey(config.secretKey);
}
