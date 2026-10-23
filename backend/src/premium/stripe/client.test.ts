import { FakeStripe } from "../../__tests__/helpers/fake-stripe";
import { StripeApiError, StripeClient, formEncode } from "./client";
import { StripeConfig } from "./config";

const PROJECT = "7f1c1d2e-3b4a-4c5d-8e6f-0a1b2c3d4e5f";

describe("Stripe client against the local fake Stripe server", () => {
  const fake = new FakeStripe();
  let config: StripeConfig;
  beforeAll(async () => {
    const base = await fake.start();
    config = {
      secretKey: fake.secretKey,
      webhookSecrets: ["whsec_x"],
      priceId: "price_TEST123",
      successUrl: "https://app.example.test/premium/return",
      cancelUrl: "https://app.example.test/premium",
      apiBaseUrl: base,
      apiVersion: "2024-06-20",
      requestTimeoutMs: 2000,
      maxRetries: 2,
    };
  });
  afterAll(() => fake.stop());
  beforeEach(() => {
    fake.requests.length = 0;
    fake.failures.length = 0;
  });

  it("form-encodes nested keys and arrays the way Stripe expects", () => {
    expect(formEncode({ a: 1, b: { c: "x y", d: [{ e: "f" }] }, skip: undefined })).toBe("a=1&b%5Bc%5D=x%20y&b%5Bd%5D%5B0%5D%5Be%5D=f");
  });

  it("creates a hosted payment-mode Checkout Session with the explicit project mapping, locale and an idempotency key", async () => {
    const client = new StripeClient(config);
    const s = await client.createCheckoutSession({ projectId: PROJECT, locale: "es", idempotencyKey: "checkout:req-1:1" });
    expect(s.id).toMatch(/^cs_test_/);
    expect(s.url).toContain("checkout.stripe.test");
    const req = fake.requests[0];
    expect(req?.method).toBe("POST");
    expect(req?.headers.authorization).toBe(`Bearer ${fake.secretKey}`);
    expect(req?.headers["idempotency-key"]).toBe("checkout:req-1:1");
    expect(req?.headers["stripe-version"]).toBe("2024-06-20");
    expect(req?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(req?.form).toMatchObject({
      mode: "payment",
      "line_items[0][price]": "price_TEST123",
      "line_items[0][quantity]": "1",
      client_reference_id: PROJECT,
      "metadata[project_id]": PROJECT,
      "payment_intent_data[metadata][project_id]": PROJECT,
      locale: "es",
      success_url: config.successUrl,
      cancel_url: config.cancelUrl,
    });
    expect(Object.keys(req?.form ?? {}).some((k) => /email/i.test(k))).toBe(false);
  });

  it("the same idempotency key returns the same session (no second session)", async () => {
    const client = new StripeClient(config);
    const before = fake.createdSessions().length;
    const a = await client.createCheckoutSession({ projectId: PROJECT, locale: "en", idempotencyKey: "checkout:req-2:1" });
    const b = await client.createCheckoutSession({ projectId: PROJECT, locale: "en", idempotencyKey: "checkout:req-2:1" });
    expect(b.id).toBe(a.id);
    expect(fake.createdSessions().length).toBe(before + 1);
  });

  it("retries 5xx on create with the same idempotency key, then succeeds", async () => {
    const client = new StripeClient(config);
    fake.failures.push({ status: 500 }, { status: 502 });
    const s = await client.createCheckoutSession({ projectId: PROJECT, locale: "en", idempotencyKey: "checkout:req-3:1" });
    expect(s.id).toMatch(/^cs_test_/);
    const posts = fake.requests.filter((r) => r.method === "POST");
    expect(posts).toHaveLength(3);
    expect(new Set(posts.map((r) => r.headers["idempotency-key"]))).toEqual(new Set(["checkout:req-3:1"]));
  });

  it("does not retry a 4xx and never puts the secret key in the error", async () => {
    const client = new StripeClient({ ...config, secretKey: "sk_test_WRONGKEY0123456789" });
    const error = await client.createCheckoutSession({ projectId: PROJECT, locale: "en", idempotencyKey: "checkout:req-4:1" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StripeApiError);
    expect((error as StripeApiError).status).toBe(401);
    expect((error as StripeApiError).retryable).toBe(false);
    expect(String(error)).not.toContain("WRONGKEY");
    expect(fake.requests).toHaveLength(1);
  });

  it("turns an unreachable server into a retryable error, not a crash", async () => {
    const client = new StripeClient({ ...config, apiBaseUrl: "http://127.0.0.1:1", maxRetries: 1, requestTimeoutMs: 500 });
    const error = await client.retrieveCheckoutSession("cs_test_abc").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StripeApiError);
    expect((error as StripeApiError).retryable).toBe(true);
  });

  it("retrieves one session and lists recent sessions with pagination (created[gte], starting_after)", async () => {
    const client = new StripeClient(config);
    const made = [];
    for (let i = 0; i < 5; i++) made.push(await client.createCheckoutSession({ projectId: PROJECT, locale: "en", idempotencyKey: `checkout:list:${i}` }));
    const one = await client.retrieveCheckoutSession(made[0]?.id as string);
    expect(one.id).toBe(made[0]?.id);

    const since = Math.floor(Date.now() / 1000) - 3600;
    const seen = new Set<string>();
    let after: string | undefined;
    let pages = 0;
    for (;;) {
      const page = await client.listCheckoutSessions({ createdGte: since, limit: 2, ...(after ? { startingAfter: after } : {}) });
      pages += 1;
      page.data.forEach((s) => seen.add(s.id));
      const last = page.data[page.data.length - 1];
      if (!page.has_more || !last) break;
      after = last.id;
    }
    expect(pages).toBeGreaterThanOrEqual(3);
    for (const s of made) expect(seen.has(s.id)).toBe(true);
    await expect(client.retrieveCheckoutSession("not-a-session")).rejects.toBeInstanceOf(StripeApiError);
  });
});
