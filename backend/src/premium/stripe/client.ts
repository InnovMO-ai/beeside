import { StripeConfig } from "./config";

/**
 * Minimal Stripe REST client (no SDK): fetch, form-encoded bodies, injectable `fetch` and configuration.
 * Only the calls the adapter needs. Errors never carry the secret key or the response body: a failure is
 * reduced to a status code and Stripe's machine-readable type/code.
 */
export type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export class StripeApiError extends Error {
  constructor(
    readonly status: number,
    readonly type: string | null,
    readonly code: string | null,
    /** True for network failures and 5xx/429: the call may be retried. */
    readonly retryable: boolean,
  ) {
    super(`stripe request failed (status ${status}${type ? `, ${type}` : ""}${code ? `, ${code}` : ""})`);
    this.name = "StripeApiError";
  }
}

export interface StripeCheckoutSession {
  id: string;
  object: "checkout.session";
  mode?: string;
  /** open | complete | expired */
  status?: string | null;
  /** paid | unpaid | no_payment_required */
  payment_status?: string | null;
  url?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
  amount_total?: number | null;
  currency?: string | null;
  payment_intent?: string | { id?: string } | null;
  /** Subscription mode: the id of the subscription the session created (set once the session completes). */
  subscription?: string | { id?: string } | null;
  expires_at?: number | null;
  created?: number;
  livemode?: boolean;
}

export interface StripePrice {
  id: string;
  object: "price";
  active?: boolean;
  type?: string;
  currency?: string;
  unit_amount?: number | null;
  product?: string | { id?: string };
  livemode?: boolean;
}

/** A Stripe subscription, reduced to the fields Core reads. `current_period_*` are unix seconds. */
export interface StripeSubscription {
  id: string;
  object: "subscription";
  /** trialing | active | past_due | unpaid | canceled | incomplete | incomplete_expired | paused */
  status: string;
  current_period_start?: number;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  canceled_at?: number | null;
  ended_at?: number | null;
  trial_end?: number | null;
  metadata?: Record<string, string> | null;
  created?: number;
  livemode?: boolean;
}

/** A Stripe invoice, reduced to the fields Core reads. */
export interface StripeInvoice {
  id: string;
  object: "invoice";
  subscription?: string | { id?: string } | null;
  subscription_details?: { metadata?: Record<string, string> | null } | null;
  /** subscription_create | subscription_cycle | subscription_update | manual | ... */
  billing_reason?: string | null;
  status?: string | null;
  amount_paid?: number | null;
  currency?: string | null;
  lines?: { data?: Array<{ period?: { start?: number; end?: number } | null }> } | null;
  livemode?: boolean;
}

export interface StripeList<T> {
  object: "list";
  data: T[];
  has_more: boolean;
}

/** Stripe form encoding: nested keys as a[b][c], arrays as a[0][b]. */
export function formEncode(params: Record<string, unknown>): string {
  const pairs: string[] = [];
  const add = (key: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => add(`${key}[${i}]`, item));
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) add(`${key}[${k}]`, v);
    } else {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  };
  for (const [k, v] of Object.entries(params)) add(k, v);
  return pairs.join("&");
}

export interface CreateCheckoutInput {
  projectId: string;
  /** Subscription mode only: unix seconds. The first charge happens then, so access already held is never paid for twice. */
  trialEnd?: number;
  /** es | en: Stripe's hosted page language. */
  locale: "es" | "en";
  idempotencyKey: string;
}

export class StripeClient {
  constructor(
    private readonly config: StripeConfig,
    private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  ) {}

  private async request<T>(method: "GET" | "POST", path: string, options: { body?: Record<string, unknown>; query?: Record<string, unknown>; idempotencyKey?: string; retry: boolean }): Promise<T> {
    const query = options.query ? formEncode(options.query) : "";
    const url = `${this.config.apiBaseUrl.replace(/\/$/, "")}${path}${query ? `?${query}` : ""}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.secretKey}`,
      "Stripe-Version": this.config.apiVersion,
    };
    let body: string | undefined;
    if (options.body) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = formEncode(options.body);
    }
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

    const attempts = options.retry ? this.config.maxRetries + 1 : 1;
    let last: StripeApiError | null = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
      try {
        const response = await this.fetchImpl(url, { method, headers, ...(body !== undefined ? { body } : {}), signal: controller.signal });
        const text = await response.text();
        if (response.ok) return JSON.parse(text) as T;
        let type: string | null = null;
        let code: string | null = null;
        try {
          const parsed = JSON.parse(text) as { error?: { type?: unknown; code?: unknown } };
          type = typeof parsed.error?.type === "string" ? parsed.error.type : null;
          code = typeof parsed.error?.code === "string" ? parsed.error.code : null;
        } catch {
          /* non-JSON error body: status only */
        }
        last = new StripeApiError(response.status, type, code, response.status >= 500 || response.status === 429);
      } catch (error) {
        if (error instanceof StripeApiError) throw error;
        last = new StripeApiError(0, "network_error", null, true);
      } finally {
        clearTimeout(timer);
      }
      if (!last.retryable) throw last;
    }
    throw last ?? new StripeApiError(0, "network_error", null, true);
  }

  get billingMode(): "payment" | "subscription" {
    return this.config.billingMode ?? "payment";
  }

  /**
   * Hosted Checkout. client_reference_id and metadata.project_id carry the explicit project mapping (never an e-mail address).
   * mode=payment: one-time payment. mode=subscription: recurring; the mapping is repeated on the subscription itself so that
   * invoices and subscription events can be mapped back without trusting any other field.
   */
  createCheckoutSession(input: CreateCheckoutInput): Promise<StripeCheckoutSession> {
    if (this.billingMode === "subscription") {
      return this.request<StripeCheckoutSession>("POST", "/v1/checkout/sessions", {
        idempotencyKey: input.idempotencyKey,
        retry: true,
        body: {
          mode: "subscription",
          line_items: [{ price: this.config.priceId, quantity: 1 }],
          success_url: this.config.successUrl,
          cancel_url: this.config.cancelUrl,
          client_reference_id: input.projectId,
          locale: input.locale,
          metadata: { project_id: input.projectId },
          subscription_data: { metadata: { project_id: input.projectId }, ...(input.trialEnd ? { trial_end: input.trialEnd } : {}) },
        },
      });
    }
    return this.request<StripeCheckoutSession>("POST", "/v1/checkout/sessions", {
      idempotencyKey: input.idempotencyKey,
      retry: true,
      body: {
        mode: "payment",
        line_items: [{ price: this.config.priceId, quantity: 1 }],
        success_url: this.config.successUrl,
        cancel_url: this.config.cancelUrl,
        client_reference_id: input.projectId,
        locale: input.locale,
        metadata: { project_id: input.projectId },
        // Refund / dispute events are mapped back to the project through the payment intent as well.
        payment_intent_data: { metadata: { project_id: input.projectId } },
      },
    });
  }

  retrieveCheckoutSession(sessionId: string): Promise<StripeCheckoutSession> {
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return Promise.reject(new StripeApiError(0, "invalid_request_error", "invalid_session_id", false));
    return this.request<StripeCheckoutSession>("GET", `/v1/checkout/sessions/${sessionId}`, { retry: true });
  }

  /** Used by the sandbox verification script to check that the configured price is a usable one-time price. */
  retrievePrice(priceId: string): Promise<StripePrice> {
    if (!/^price_[A-Za-z0-9]+$/.test(priceId)) return Promise.reject(new StripeApiError(0, "invalid_request_error", "invalid_price_id", false));
    return this.request<StripePrice>("GET", `/v1/prices/${priceId}`, { retry: true });
  }

  retrieveSubscription(subscriptionId: string): Promise<StripeSubscription> {
    if (!/^sub_[A-Za-z0-9_]+$/.test(subscriptionId)) return Promise.reject(new StripeApiError(0, "invalid_request_error", "invalid_subscription_id", false));
    return this.request<StripeSubscription>("GET", `/v1/subscriptions/${subscriptionId}`, { retry: true });
  }

  /** One page of subscriptions of any status (newest first). */
  listSubscriptions(input: { createdGte: number; limit?: number; startingAfter?: string }): Promise<StripeList<StripeSubscription>> {
    return this.request<StripeList<StripeSubscription>>("GET", "/v1/subscriptions", {
      retry: true,
      query: { status: "all", limit: input.limit ?? 100, "created[gte]": input.createdGte, ...(input.startingAfter ? { starting_after: input.startingAfter } : {}) },
    });
  }

  /** One page of recent sessions (newest first). `createdGte` is a unix timestamp in seconds. */
  listCheckoutSessions(input: { createdGte: number; limit?: number; startingAfter?: string }): Promise<StripeList<StripeCheckoutSession>> {
    return this.request<StripeList<StripeCheckoutSession>>("GET", "/v1/checkout/sessions", {
      retry: true,
      query: { limit: input.limit ?? 100, "created[gte]": input.createdGte, ...(input.startingAfter ? { starting_after: input.startingAfter } : {}) },
    });
  }
}

export function subscriptionId(value: { subscription?: string | { id?: string } | null }): string | null {
  const sub = value.subscription;
  if (typeof sub === "string") return sub;
  if (sub && typeof sub === "object" && typeof sub.id === "string") return sub.id;
  return null;
}

export function paymentIntentId(session: Pick<StripeCheckoutSession, "payment_intent">): string | null {
  const pi = session.payment_intent;
  if (typeof pi === "string") return pi;
  if (pi && typeof pi === "object" && typeof pi.id === "string") return pi.id;
  return null;
}
