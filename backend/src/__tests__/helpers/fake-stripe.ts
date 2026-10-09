import http from "node:http";
import { AddressInfo } from "node:net";
import { signStripePayload } from "../../premium/stripe/signature";

/**
 * A local FAKE Stripe API (node http) for contract tests: Checkout Session create / retrieve / list with Idempotency-Key
 * replay, bearer-key check, form-encoded bodies. It is a fake of the contract this adapter uses — NOT Stripe. Passing
 * against it proves the adapter honours its own reading of the contract, not that Stripe behaves like this fake.
 */
export interface FakeSession {
  id: string;
  object: "checkout.session";
  mode: string;
  status: "open" | "complete" | "expired";
  payment_status: "paid" | "unpaid" | "no_payment_required";
  url: string | null;
  client_reference_id: string | null;
  metadata: Record<string, string>;
  amount_total: number;
  currency: string;
  payment_intent: string | null;
  expires_at: number;
  created: number;
  livemode: boolean;
  locale: string | null;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  form: Record<string, string>;
  query: Record<string, string>;
}

export class FakeStripe {
  readonly sessions = new Map<string, FakeSession>();
  readonly requests: RecordedRequest[] = [];
  /** Responses to inject for the next N create calls: e.g. { status: 500 }. */
  readonly failures: Array<{ status: number; body?: unknown }> = [];
  amountTotal = 49_900;
  currency = "mxn";
  private counter = 0;
  private readonly idempotent = new Map<string, string>();
  private server: http.Server | null = null;

  constructor(
    readonly secretKey = "sk_test_FAKEKEYFORCONTRACTTESTS0123456789",
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Forget every session, request and injected failure (between tests). */
  reset(): void {
    this.sessions.clear();
    this.idempotent.clear();
    this.requests.length = 0;
    this.failures.length = 0;
  }

  async start(): Promise<string> {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(this.server?.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  /** Simulates the customer paying on the hosted page (webhook NOT sent: tests send events themselves). */
  pay(sessionId: string): FakeSession {
    const s = this.must(sessionId);
    s.status = "complete";
    s.payment_status = "paid";
    s.payment_intent = `pi_test_${sessionId.slice(-8)}`;
    s.url = null;
    return s;
  }

  expire(sessionId: string): FakeSession {
    const s = this.must(sessionId);
    s.status = "expired";
    s.url = null;
    return s;
  }

  must(sessionId: string): FakeSession {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`fake stripe: unknown session ${sessionId}`);
    return s;
  }

  createdSessions(): FakeSession[] {
    return [...this.sessions.values()];
  }

  private json(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const url = new URL(req.url ?? "/", "http://fake");
    const form = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
    const query = Object.fromEntries(url.searchParams);
    this.requests.push({ method: req.method ?? "", path: url.pathname, headers: req.headers, form, query });
    if (req.headers.authorization !== `Bearer ${this.secretKey}`) {
      this.json(res, 401, { error: { type: "invalid_request_error", code: "api_key_invalid", message: "Invalid API Key provided" } });
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
      const failure = this.failures.shift();
      if (failure) {
        this.json(res, failure.status, failure.body ?? { error: { type: "api_error", message: "boom" } });
        return;
      }
      const key = String(req.headers["idempotency-key"] ?? "");
      const existing = key ? this.idempotent.get(key) : undefined;
      if (existing) {
        this.json(res, 200, this.sessions.get(existing));
        return;
      }
      const id = `cs_test_${String(++this.counter).padStart(6, "0")}${Math.random().toString(36).slice(2, 10)}`;
      const metadata: Record<string, string> = {};
      for (const [k, v] of Object.entries(form)) {
        const m = /^metadata\[(.+)\]$/.exec(k);
        if (m?.[1]) metadata[m[1]] = v;
      }
      const created = Math.floor(this.clock() / 1000);
      const session: FakeSession = {
        id,
        object: "checkout.session",
        mode: form.mode ?? "",
        status: "open",
        payment_status: "unpaid",
        url: `https://checkout.stripe.test/c/pay/${id}`,
        client_reference_id: form.client_reference_id ?? null,
        metadata,
        amount_total: this.amountTotal,
        currency: this.currency,
        payment_intent: null,
        expires_at: created + 24 * 3600,
        created,
        livemode: false,
        locale: form.locale ?? null,
      };
      this.sessions.set(id, session);
      if (key) this.idempotent.set(key, id);
      this.json(res, 200, session);
      return;
    }
    const one = /^\/v1\/checkout\/sessions\/(cs_[A-Za-z0-9_]+)$/.exec(url.pathname);
    if (req.method === "GET" && one?.[1]) {
      const s = this.sessions.get(one[1]);
      if (s) this.json(res, 200, s);
      else this.json(res, 404, { error: { type: "invalid_request_error", code: "resource_missing" } });
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/checkout/sessions") {
      const gte = Number(query["created[gte]"] ?? 0);
      const limit = Math.min(Number(query.limit ?? 10), 100);
      const all = [...this.sessions.values()].filter((s) => s.created >= gte).sort((a, b) => b.created - a.created || (a.id < b.id ? 1 : -1));
      const start = query.starting_after ? all.findIndex((s) => s.id === query.starting_after) + 1 : 0;
      const page = all.slice(start, start + limit);
      this.json(res, 200, { object: "list", data: page, has_more: start + limit < all.length });
      return;
    }
    this.json(res, 404, { error: { type: "invalid_request_error", code: "resource_missing" } });
  }
}

let eventCounter = 0;

/** A Stripe event envelope around an object. */
export function stripeEvent(type: string, object: Record<string, unknown>, options: { id?: string; livemode?: boolean; created?: number } = {}): { id: string; raw: string } {
  const id = options.id ?? `evt_test_${String(++eventCounter).padStart(6, "0")}`;
  const raw = JSON.stringify({ id, object: "event", api_version: "2024-06-20", created: options.created ?? Math.floor(Date.now() / 1000), livemode: options.livemode ?? false, type, data: { object } });
  return { id, raw };
}

/** The webhook-facing view of a fake session (what Stripe would put in the event). */
export function sessionObject(s: FakeSession, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...s, customer_details: { email: "private.customer@example.invalid", name: "Private Customer" }, ...extra };
}

export function signedHeaders(secret: string, raw: string, timestampSeconds: number = Math.floor(Date.now() / 1000)): { "Stripe-Signature": string; "Content-Type": string } {
  return { "Stripe-Signature": signStripePayload(secret, timestampSeconds, raw), "Content-Type": "application/json" };
}
