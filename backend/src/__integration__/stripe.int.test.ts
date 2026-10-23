import request from "supertest";
import { createApp } from "../index";
import { FakeStripe, sessionObject, signedHeaders, stripeEvent } from "../__tests__/helpers/fake-stripe";
import { CoreEntitlementProvider } from "../precision/adapters/core-entitlement";
import { sweepPrecisionAccess } from "../premium/precision-access";
import { PremiumPolicy } from "../premium/premium-policy";
import { StripeCheckout } from "../premium/stripe/checkout-adapter";
import { StripeClient } from "../premium/stripe/client";
import { StripeConfig } from "../premium/stripe/config";
import { reconcileStripe } from "../premium/stripe/reconcile";
import { StripeWebhookDeps } from "../premium/stripe/webhook";
import { Logger } from "../security/redact";
import { MANUFACTURER, describeWithDb, identity, lastLinkToken, runJourney, useHarness } from "./fa-harness";

const WHSEC = "whsec_integration_secret_0123456789abcdef";
const DAY = 86_400_000;
const POLICY: PremiumPolicy = { accessPeriodDays: 120, readonlyGraceDays: 30 };
/** Short cycle so a returning client's private link is still valid when the period has run out. */
const SHORT: PremiumPolicy = { accessPeriodDays: 20, readonlyGraceDays: 5 };
const PII = ["private.customer@example.invalid", "Private Customer"];

describeWithDb("Stripe adapter -> Core payment/entitlement (PostgreSQL, rolled back; Stripe is a local FAKE)", () => {
  const h = useHarness();
  const fake = new FakeStripe(undefined, () => h.clock.now.getTime());
  let config: StripeConfig;
  let policy: PremiumPolicy = POLICY;
  let logs: Array<{ level: string; message: string; fields: unknown }> = [];
  const log: Logger = (level, message, fields) => {
    logs.push({ level, message, fields: fields ?? {} });
  };

  beforeAll(async () => {
    const base = await fake.start();
    config = {
      secretKey: fake.secretKey, webhookSecrets: [WHSEC], priceId: "price_TEST123", successUrl: "https://app.example.test/premium/return",
      cancelUrl: "https://app.example.test/premium", apiBaseUrl: base, apiVersion: "2024-06-20", requestTimeoutMs: 3000, maxRetries: 1,
    };
  });
  afterAll(() => fake.stop());
  beforeEach(() => {
    fake.reset();
    logs = [];
    policy = POLICY;
  });

  const client = () => new StripeClient(config);
  const webhookDeps = (): StripeWebhookDeps => ({ db: h.deps.db, bundles: h.deps.bundles, webhookSecrets: [WHSEC], livemode: false, policy, now: () => h.clock.now, log });
  const app = () =>
    request(createApp({ fa: { ...h.deps, premium: { checkout: new StripeCheckout(client(), log) } }, stripe: webhookDeps() })) as unknown as request.SuperTest<request.Test>;
  const count = async (sql: string, params: unknown[] = []) => (await h.client.query<{ n: number }>(sql, params)).rows[0]?.n;

  async function projectForToken(token: string) {
    const { rows } = await h.client.query(
      `SELECT p.* FROM project p JOIN project_access_token t ON t.project_id = p.project_id WHERE t.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [token],
    );
    return rows[0];
  }
  async function completedProject(email = "ana.rivera@northwind-test.example") {
    const start = await h.api().post("/api/fa/identity").send(identity({ email }));
    expect(start.status).toBe(201);
    const token = start.body.sessionToken as string;
    expect((await h.api().post("/api/fa/session/finish-later").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    expect((await runJourney(h, token, MANUFACTURER)).status).toBe("COMPLETED_LOCKED");
    return { token, link: lastLinkToken(h), project: await projectForToken(token) };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const startViaLink = (link: string) => app().post("/api/fa/links/premium/activation").send({ token: link, acceptTerms: true });
  const startCheckout = (token: string) => app().post("/api/fa/session/premium/activation").set(auth(token)).send({ acceptTerms: true });
  const paymentState = async (token: string) => (await app().get("/api/fa/session/premium/payment-state").set(auth(token))).body.state as string;
  const lastSession = () => fake.createdSessions().slice(-1)[0] as NonNullable<ReturnType<FakeStripe["createdSessions"]>[number]>;

  async function send(type: string, object: Record<string, unknown>, options: { id?: string; at?: number } = {}) {
    const ts = options.at ?? Math.floor(h.clock.now.getTime() / 1000);
    const ev = stripeEvent(type, object, { ...(options.id ? { id: options.id } : {}), created: ts });
    const res = await app().post("/api/billing/stripe/webhook").set(signedHeaders(WHSEC, ev.raw, ts)).send(ev.raw);
    return { res, id: ev.id, raw: ev.raw };
  }
  const paidEvent = (sessionId: string, type = "checkout.session.completed", id?: string) => send(type, sessionObject(fake.pay(sessionId)), id ? { id } : {});
  const outcomeOf = async (eventId: string) => (await h.client.query("SELECT outcome FROM billing_inbound_event WHERE stripe_event_id = $1", [eventId])).rows[0]?.outcome as string;

  /** Adds a second open checkout row (as if a stale/second session existed) for the duplicate-payment cases. */
  async function addCheckoutRow(projectId: string, sessionId: string, status = "open") {
    await h.client.query(
      `INSERT INTO premium_checkout (project_id, stripe_session_id, status, idempotency_key, checkout_url, interface_language, expires_at)
       VALUES ($1, $2, 'open', $3, 'https://checkout.stripe.test/x', 'es', $4)`,
      [projectId, sessionId, `test:${sessionId}`, new Date(h.clock.now.getTime() + DAY)],
    );
    if (status !== "open") await h.client.query("UPDATE premium_checkout SET status = $2 WHERE stripe_session_id = $1", [sessionId, status]);
  }

  // ------------------------------------------------------------------------------------------------
  it("creates a hosted payment-mode session with the explicit project mapping; a redirect alone activates NOTHING", async () => {
    const { token, project } = await completedProject();
    const id = project.project_id as string;
    expect(await paymentState(token)).toBe("not_started");

    const started = await startCheckout(token);
    expect(started.status).toBe(201);
    const s = lastSession();
    expect(started.body.outcome).toEqual({ kind: "redirect", url: s.url });
    expect(s).toMatchObject({ mode: "payment", client_reference_id: id, metadata: { project_id: id }, locale: "es" });
    const req = fake.requests.find((r) => r.method === "POST");
    expect(req?.headers["idempotency-key"]).toMatch(/^checkout:[0-9a-f-]{36}:1$/);
    expect(JSON.stringify(req?.form)).not.toContain("ana.rivera");

    const row = (await h.client.query("SELECT * FROM premium_checkout WHERE project_id = $1", [id])).rows[0];
    expect(row).toMatchObject({ stripe_session_id: s.id, status: "open", amount_total: String(s.amount_total), currency: "mxn", interface_language: "es", checkout_url: s.url });
    expect((await h.client.query("SELECT checkout_adapter, checkout_reference FROM premium_activation_request WHERE project_id = $1", [id])).rows[0]).toEqual({ checkout_adapter: "stripe_hosted_checkout", checkout_reference: s.id });

    // The client "comes back from Stripe" without any webhook (or fakes the redirect): Core has confirmed nothing.
    expect(await paymentState(token)).toBe("confirming");
    expect(await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1", [id])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM entitlement WHERE project_id = $1", [id])).toBe(0);
    const provider = new CoreEntitlementProvider(h.deps.db, { policy: POLICY, now: () => h.clock.now });
    expect(await provider.get(id)).toMatchObject({ premiumActive: false, accessMode: "REVOKED" });
    expect((await app().get("/api/fa/session/premium").set(auth(token))).body).toMatchObject({ accessActive: false });
    expect((await app().get("/api/fa/session/premium/payment-state")).status).toBe(401);
  });

  it("one open session per project: coming back resumes the SAME session; a stale one is closed and replaced", async () => {
    const { token, link, project } = await completedProject();
    const id = project.project_id as string;
    const first = await startCheckout(token);
    const again = await startCheckout(token);
    expect(again.body.outcome).toEqual(first.body.outcome);
    expect(fake.createdSessions()).toHaveLength(1);
    expect(await count("SELECT count(*)::int AS n FROM premium_checkout WHERE project_id = $1 AND status = 'open'", [id])).toBe(1);

    // The partial unique index is the hard guarantee.
    await h.client.query("SAVEPOINT one_open");
    await expect(addCheckoutRow(id, "cs_test_second_open")).rejects.toMatchObject({ code: "23505" });
    await h.client.query("ROLLBACK TO SAVEPOINT one_open");

    h.advanceDays(2);
    const replaced = await startViaLink(link);
    expect(replaced.status).toBe(201);
    expect(fake.createdSessions()).toHaveLength(2);
    expect((await h.client.query("SELECT status FROM premium_checkout WHERE project_id = $1 ORDER BY created_at, status", [id])).rows.map((r) => r.status).sort()).toEqual(["expired", "open"]);
    const keys = fake.requests.filter((r) => r.method === "POST").map((r) => r.headers["idempotency-key"]);
    expect(new Set(keys).size).toBe(2);
  });

  it("a Stripe outage on create surfaces a neutral message and leaves no half-recorded attempt", async () => {
    const { token, project } = await completedProject();
    fake.failures.push({ status: 500 }, { status: 500 });
    const res = await startCheckout(token);
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toMatch(/stripe|api_error|boom|sk_test/i);
    expect(await count("SELECT count(*)::int AS n FROM premium_activation_request WHERE project_id = $1", [project.project_id])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM premium_checkout WHERE project_id = $1", [project.project_id])).toBe(0);
    expect((await startCheckout(token)).status).toBe(201);
  });

  // ------------------------------------------------------------------------------------------------
  it("a verified payment webhook activates Premium exactly once, with the Core-configured period and no legacy handoff", async () => {
    const { token, project } = await completedProject();
    const id = project.project_id as string;
    await startCheckout(token);
    const s = lastSession();

    const paid = await paidEvent(s.id);
    expect(paid.res.status).toBe(200);
    expect(await outcomeOf(paid.id)).toBe("ACTIVATED");

    const sub = (await h.client.query("SELECT status, current_period_start, current_period_end FROM subscription WHERE project_id = $1", [id])).rows;
    expect(sub).toHaveLength(1);
    expect(sub[0].status).toBe("PREMIUM_ACTIVE");
    expect(new Date(sub[0].current_period_end).getTime() - new Date(sub[0].current_period_start).getTime()).toBe(POLICY.accessPeriodDays * DAY);
    const ev = (await h.client.query("SELECT event_type, source, provider_reference, idempotency_key FROM subscription_event WHERE project_id = $1", [id])).rows;
    expect(ev).toEqual([{ event_type: "premium_activated", source: "stripe_webhook", provider_reference: s.id, idempotency_key: `stripe:session:${s.id}:paid` }]);
    expect((await h.client.query("SELECT precision_access_mode, premium_access_active FROM entitlement WHERE project_id = $1", [id])).rows[0]).toEqual({ precision_access_mode: "FULL", premium_access_active: true });
    expect((await h.client.query("SELECT status, outcome, stripe_payment_intent_id, paid_amount_total FROM premium_checkout WHERE project_id = $1", [id])).rows[0]).toMatchObject({ status: "completed", outcome: "ACTIVATED", stripe_payment_intent_id: s.payment_intent });
    expect((await h.client.query("SELECT status FROM premium_activation_request WHERE project_id = $1", [id])).rows[0].status).toBe("FULFILLED");
    expect(await paymentState(token)).toBe("active");
    expect(await new CoreEntitlementProvider(h.deps.db, { policy: POLICY, now: () => h.clock.now }).get(id)).toEqual({ projectId: id, premiumActive: true, accessMode: "FULL" });
    // Legacy FA-3.0 push is retired.
    expect(await count("SELECT count(*)::int AS n FROM precision_handoff_package WHERE project_id = $1", [id])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM outbox_event WHERE project_id = $1 AND event_type = 'precision.handoff_package_generated'", [id])).toBe(0);
  });

  it("duplicate / replayed / second-channel delivery of the same payment never activates twice", async () => {
    const { token, project } = await completedProject();
    const id = project.project_id as string;
    await startCheckout(token);
    const s = lastSession();
    const first = await paidEvent(s.id, "checkout.session.completed", "evt_test_dup_0001");
    const replay = await send("checkout.session.completed", sessionObject(s), { id: "evt_test_dup_0001" });
    expect(replay.res.status).toBe(200);
    expect(replay.res.body).toEqual({ received: true, duplicate: true });
    // The same payment announced again under a different event id (async_payment_succeeded) is a no-op.
    const other = await send("checkout.session.async_payment_succeeded", sessionObject(s));
    expect(other.res.status).toBe(200);
    expect(await outcomeOf(other.id)).toBe("ALREADY_APPLIED");
    expect(await outcomeOf(first.id)).toBe("ACTIVATED");

    expect(await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1", [id])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM subscription_event WHERE project_id = $1", [id])).toBe(1);
    const stored = (await h.client.query("SELECT attempts FROM billing_inbound_event WHERE stripe_event_id = 'evt_test_dup_0001'")).rows;
    expect(stored).toEqual([{ attempts: 2 }]);
  });

  it("D-3: a second payment while Premium is current -> NOT_APPLICABLE_DUPLICATE_PAYMENT (HTTP 200), alert, no second activation, access unchanged", async () => {
    const { token, project } = await completedProject();
    const id = project.project_id as string;
    await startCheckout(token);
    await paidEvent(lastSession().id);
    const before = (await h.client.query("SELECT * FROM entitlement WHERE project_id = $1", [id])).rows[0];

    const extra = await client().createCheckoutSession({ projectId: id, locale: "es", idempotencyKey: "test:second-payer" });
    await addCheckoutRow(id, extra.id);
    const dup = await paidEvent(extra.id);
    expect(dup.res.status).toBe(200);
    expect(await outcomeOf(dup.id)).toBe("NOT_APPLICABLE_DUPLICATE_PAYMENT");
    expect(await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1", [id])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM subscription_event WHERE project_id = $1", [id])).toBe(1);
    expect((await h.client.query("SELECT * FROM entitlement WHERE project_id = $1", [id])).rows[0]).toEqual(before);
    expect((await h.client.query("SELECT status, outcome FROM premium_checkout WHERE stripe_session_id = $1", [extra.id])).rows[0]).toEqual({ status: "completed", outcome: "NOT_APPLICABLE_DUPLICATE_PAYMENT" });
    expect((await h.client.query("SELECT kind, stripe_ref FROM billing_alert WHERE project_id = $1", [id])).rows).toEqual([{ kind: "duplicate_payment", stripe_ref: extra.id }]);
    expect(logs.some((l) => l.level === "error" && l.message.includes("duplicate_payment"))).toBe(true);
  });

  it("wrong secret, stale timestamp and replay outside the tolerance -> 400 with no detail and nothing stored", async () => {
    const { token } = await completedProject();
    await startCheckout(token);
    const s = lastSession();
    const ev = stripeEvent("checkout.session.completed", sessionObject(fake.pay(s.id)));
    const ts = Math.floor(h.clock.now.getTime() / 1000);

    const wrong = await app().post("/api/billing/stripe/webhook").set(signedHeaders("whsec_not_the_secret", ev.raw, ts)).send(ev.raw);
    expect(wrong.status).toBe(400);
    expect(wrong.body).toEqual({ error: "invalid_request" });
    const stale = await app().post("/api/billing/stripe/webhook").set(signedHeaders(WHSEC, ev.raw, ts - 301)).send(ev.raw);
    expect(stale.status).toBe(400);
    expect((await app().post("/api/billing/stripe/webhook").set("Content-Type", "application/json").send(ev.raw)).status).toBe(400);
    expect(await count("SELECT count(*)::int AS n FROM billing_inbound_event")).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM subscription")).toBe(0);

    // A captured valid delivery replayed ten minutes later is refused too.
    const good = await app().post("/api/billing/stripe/webhook").set(signedHeaders(WHSEC, ev.raw, ts)).send(ev.raw);
    expect(good.status).toBe(200);
    h.advanceMinutes(10);
    const replay = await app().post("/api/billing/stripe/webhook").set(signedHeaders(WHSEC, ev.raw, ts)).send(ev.raw);
    expect(replay.status).toBe(400);
    expect(await count("SELECT count(*)::int AS n FROM subscription")).toBe(1);
  });

  it("out-of-order delivery converges: success before 'completed', stale unpaid 'completed', late 'expired'/'failed' never undo a payment", async () => {
    const { token, project } = await completedProject();
    const id = project.project_id as string;
    await startCheckout(token);
    const s = lastSession();
    const unpaidSnapshot = { ...sessionObject(s), status: "complete", payment_status: "unpaid" };

    const succ = await paidEvent(s.id, "checkout.session.async_payment_succeeded");
    expect(await outcomeOf(succ.id)).toBe("ACTIVATED");
    const lateCompleted = await send("checkout.session.completed", unpaidSnapshot);
    expect(await outcomeOf(lateCompleted.id)).toBe("AWAITING_PAYMENT_CONFIRMATION");
    const lateExpired = await send("checkout.session.expired", { object: "checkout.session", id: s.id });
    expect(await outcomeOf(lateExpired.id)).toBe("NO_CHANGE");
    const lateFailed = await send("checkout.session.async_payment_failed", { object: "checkout.session", id: s.id });
    expect(await outcomeOf(lateFailed.id)).toBe("NO_CHANGE");
    expect((await h.client.query("SELECT status, outcome FROM premium_checkout WHERE project_id = $1", [id])).rows[0]).toEqual({ status: "completed", outcome: "ACTIVATED" });
    expect(await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1", [id])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM billing_alert WHERE project_id = $1", [id])).toBe(0);
  });

  it("delayed payment method: unpaid 'completed' waits; async failure -> failed_retry, no activation; a new attempt is possible", async () => {
    const { token, project } = await completedProject();
    const id = project.project_id as string;
    await startCheckout(token);
    const s = lastSession();
    const awaiting = await send("checkout.session.completed", { ...sessionObject(s), status: "complete", payment_status: "unpaid" });
    expect(await outcomeOf(awaiting.id)).toBe("AWAITING_PAYMENT_CONFIRMATION");
    expect(await paymentState(token)).toBe("confirming");

    const failed = await send("checkout.session.async_payment_failed", { object: "checkout.session", id: s.id });
    expect(await outcomeOf(failed.id)).toBe("CHECKOUT_FAILED");
    expect(await paymentState(token)).toBe("failed_retry");
    expect(await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1", [id])).toBe(0);

    h.advanceMinutes(1);
    const retry = await startCheckout(token);
    expect(retry.status).toBe(201);
    expect(fake.createdSessions()).toHaveLength(2);
    expect(await paymentState(token)).toBe("confirming");

    const expired = await send("checkout.session.expired", { object: "checkout.session", id: lastSession().id });
    expect(await outcomeOf(expired.id)).toBe("CHECKOUT_EXPIRED");
    expect(await paymentState(token)).toBe("not_started");
  });

  it("refunds and disputes are RECORDED + ALERTED only: access, subscription and entitlement are untouched", async () => {
    const { token, project } = await completedProject();
    const id = project.project_id as string;
    await startCheckout(token);
    const s = lastSession();
    await paidEvent(s.id);
    const snapshot = async () => ({
      sub: (await h.client.query("SELECT status, current_period_end, ended_at FROM subscription WHERE project_id = $1", [id])).rows,
      ent: (await h.client.query("SELECT premium_access_active, precision_access_mode, premium_ended_at, readonly_until, revoked_at FROM entitlement WHERE project_id = $1", [id])).rows,
      events: await count("SELECT count(*)::int AS n FROM subscription_event WHERE project_id = $1", [id]),
    });
    const before = await snapshot();

    const refund = await send("charge.refunded", { object: "charge", id: "ch_test_1", payment_intent: s.payment_intent, amount: 49900, currency: "mxn", amount_refunded: 49900 });
    const disputeOpen = await send("charge.dispute.created", { object: "dispute", id: "dp_test_1", charge: "ch_test_1", payment_intent: s.payment_intent, amount: 49900, currency: "mxn" });
    const disputeClosed = await send("charge.dispute.closed", { object: "dispute", id: "dp_test_1", charge: "ch_test_1", payment_intent: s.payment_intent, status: "lost" });
    for (const e of [refund, disputeOpen, disputeClosed]) {
      expect(e.res.status).toBe(200);
      expect(await outcomeOf(e.id)).toBe("RECORDED_ALERTED");
    }
    expect(await snapshot()).toEqual(before);
    expect((await h.client.query("SELECT kind FROM billing_alert WHERE project_id = $1 ORDER BY kind", [id])).rows.map((r) => r.kind)).toEqual(["charge_dispute_closed", "charge_dispute_created", "charge_refunded"]);
    expect(await new CoreEntitlementProvider(h.deps.db, { policy: POLICY, now: () => h.clock.now }).get(id)).toMatchObject({ premiumActive: true, accessMode: "FULL" });
    expect(await paymentState(token)).toBe("active");
  });

  it("unknown event types are stored and acknowledged; unmatched or mis-mapped payments never activate anything and raise an alert", async () => {
    const { token, project } = await completedProject();
    const id = project.project_id as string;
    const unknown = await send("customer.subscription.updated", { object: "subscription", id: "sub_x" });
    expect(unknown.res.status).toBe(200);
    // Subscription events are handled now (recurring billing); one that carries no mapping of ours is simply not ours.
    expect(await outcomeOf(unknown.id)).toBe("IGNORED_NOT_OURS");
    const stored = await send("customer.created", { object: "customer", id: "cus_x" });
    expect(await outcomeOf(stored.id)).toBe("STORED_UNHANDLED_TYPE");

    // A paid session of ours-looking metadata but not created by this adapter: no row -> no activation.
    const foreign = await client().createCheckoutSession({ projectId: id, locale: "en", idempotencyKey: "test:foreign" });
    const unmatched = await paidEvent(foreign.id);
    expect(await outcomeOf(unmatched.id)).toBe("UNMATCHED_SESSION");

    // A recorded session whose Stripe metadata names another project is rejected.
    await startCheckout(token);
    const s = lastSession();
    const other = "7d8e0f1a-2b3c-4d5e-8f90-1a2b3c4d5e6f";
    const mismatched = await send("checkout.session.completed", { ...sessionObject(fake.pay(s.id)), metadata: { project_id: other }, client_reference_id: other });
    expect(await outcomeOf(mismatched.id)).toBe("REJECTED_MAPPING");
    // And so is a session that carries only one of the two mapping fields.
    const half = await send("checkout.session.completed", { ...sessionObject(s), metadata: {} });
    expect(await outcomeOf(half.id)).toBe("REJECTED_MAPPING");

    expect(await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1", [id])).toBe(0);
    expect((await h.client.query("SELECT kind FROM billing_alert ORDER BY kind")).rows.map((r) => r.kind)).toEqual(["payment_mapping_rejected", "payment_unmatched_session"]);
    // Events from the other Stripe mode are stored and ignored.
    const live = stripeEvent("checkout.session.completed", sessionObject(s), { livemode: true });
    const liveRes = await app().post("/api/billing/stripe/webhook").set(signedHeaders(WHSEC, live.raw, Math.floor(h.clock.now.getTime() / 1000))).send(live.raw);
    expect(liveRes.status).toBe(200);
    expect(await outcomeOf(live.id)).toBe("IGNORED_LIVEMODE_MISMATCH");
  });

  it("money received for a project that cannot enter Premium (First Assessment not locked) is NOT_APPLICABLE_NOT_ELIGIBLE with an alert: HTTP 200, no retry storm, no activation", async () => {
    const start = await h.api().post("/api/fa/identity").send(identity({ email: "still.answering@northwind-test.example" }));
    const project = await projectForToken(start.body.sessionToken as string);
    const id = project.project_id as string;
    const s = await client().createCheckoutSession({ projectId: id, locale: "en", idempotencyKey: "test:not-eligible" });
    await addCheckoutRow(id, s.id);
    const paid = await paidEvent(s.id);
    expect(paid.res.status).toBe(200);
    expect(await outcomeOf(paid.id)).toBe("NOT_APPLICABLE_NOT_ELIGIBLE");
    expect(await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1", [id])).toBe(0);
    expect((await h.client.query("SELECT status, outcome FROM premium_checkout WHERE stripe_session_id = $1", [s.id])).rows[0]).toEqual({ status: "completed", outcome: "NOT_APPLICABLE_NOT_ELIGIBLE" });
    expect((await h.client.query("SELECT kind FROM billing_alert WHERE project_id = $1", [id])).rows).toEqual([{ kind: "payment_not_eligible" }]);
  });

  // ------------------------------------------------------------------------------------------------
  it("reconciliation recovers a payment whose webhook never arrived, and is safe to run repeatedly (also against a late webhook)", async () => {
    const { token, project } = await completedProject();
    const id = project.project_id as string;
    await startCheckout(token);
    const s = lastSession();
    fake.pay(s.id); // paid on Stripe; no webhook delivered
    expect(await paymentState(token)).toBe("confirming");
    expect(await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1", [id])).toBe(0);

    const deps = { db: h.deps.db, bundles: h.deps.bundles, client: client(), policy: POLICY, now: () => h.clock.now, log };
    const first = await reconcileStripe(deps);
    expect(first).toMatchObject({ listed: 1, activated: 1, alreadyApplied: 0, failures: 0 });
    expect(await paymentState(token)).toBe("active");
    expect((await h.client.query("SELECT source FROM subscription_event WHERE project_id = $1", [id])).rows).toEqual([{ source: "stripe_reconciliation" }]);

    const second = await reconcileStripe(deps);
    expect(second).toMatchObject({ activated: 0, failures: 0 });
    const late = await send("checkout.session.completed", sessionObject(s));
    expect(await outcomeOf(late.id)).toBe("ALREADY_APPLIED");
    expect(await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1", [id])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM subscription_event WHERE project_id = $1", [id])).toBe(1);
  });

  it("reconciliation also reaches sessions older than the list window by retrieving our open ones, and closes expired/stale sessions", async () => {
    const { token, project } = await completedProject();
    const id = project.project_id as string;
    await startCheckout(token);
    const s = lastSession();
    fake.pay(s.id);
    fake.must(s.id).created -= 30 * 24 * 3600; // outside a 1 h lookback window
    const deps = { db: h.deps.db, bundles: h.deps.bundles, client: client(), policy: POLICY, now: () => h.clock.now, log };
    expect(await reconcileStripe(deps, { lookbackHours: 1 })).toMatchObject({ listed: 0, activated: 1 });
    expect(await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1", [id])).toBe(1);

    const second = await completedProject("second.person@northwind-test.example");
    await startCheckout(second.token);
    const s2 = lastSession();
    fake.expire(s2.id);
    expect(await reconcileStripe(deps)).toMatchObject({ expired: 1, activated: 0 });
    expect((await h.client.query("SELECT status FROM premium_checkout WHERE stripe_session_id = $1", [s2.id])).rows[0].status).toBe("expired");
    expect(await paymentState(second.token)).toBe("not_started");
  });

  it("a payment discovered after we closed the session locally still activates (expired -> completed is the one allowed back-step)", async () => {
    const { token, link, project } = await completedProject();
    const id = project.project_id as string;
    await startCheckout(token);
    const s = lastSession();
    h.advanceDays(2);
    await startViaLink(link); // closes the stale session locally, opens another
    expect((await h.client.query("SELECT status FROM premium_checkout WHERE stripe_session_id = $1", [s.id])).rows[0].status).toBe("expired");
    await paidEvent(s.id);
    expect(await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1", [id])).toBe(1);
    expect((await h.client.query("SELECT status FROM premium_checkout WHERE stripe_session_id = $1", [s.id])).rows[0].status).toBe("completed");
  });

  // ------------------------------------------------------------------------------------------------
  it("end of Premium -> READ_ONLY -> REVOKED by the sweep (configurable window, idempotent, nothing deleted), and a new payment returns the same project to FULL", async () => {
    policy = SHORT;
    const { token, link, project } = await completedProject();
    const id = project.project_id as string;
    const provider = new CoreEntitlementProvider(h.deps.db, { policy: SHORT, now: () => h.clock.now });
    await startCheckout(token);
    await paidEvent(lastSession().id);
    const periodEnd = new Date((await h.client.query("SELECT current_period_end FROM subscription WHERE project_id = $1", [id])).rows[0].current_period_end);
    const sweep = () => sweepPrecisionAccess(h.deps.db, h.deps.bundles, { now: h.clock.now, policy: SHORT });
    const ent = async () => (await h.client.query("SELECT * FROM entitlement WHERE project_id = $1", [id])).rows[0];

    // Inside the period: nothing to do.
    h.advanceDays(SHORT.accessPeriodDays - 1);
    expect(await sweep()).toEqual({ periodsEnded: 0, windowsSettled: 0, revoked: 0 });
    expect((await provider.get(id)).accessMode).toBe("FULL");

    // The period ran out and the sweep has NOT run: the clock already closes writes.
    h.advanceDays(2);
    expect(await provider.get(id)).toMatchObject({ premiumActive: false, accessMode: "READ_ONLY", readonlyUntil: new Date(periodEnd.getTime() + SHORT.readonlyGraceDays * DAY).toISOString() });

    // Sweep: FULL -> READ_ONLY with a settled, configurable window (snapshotted in grace_days_applied).
    expect(await sweep()).toEqual({ periodsEnded: 1, windowsSettled: 1, revoked: 0 });
    expect(await ent()).toMatchObject({ premium_access_active: false, precision_access_mode: "READ_ONLY", grace_days_applied: SHORT.readonlyGraceDays, revoked_at: null });
    expect(new Date((await ent()).premium_ended_at).getTime()).toBe(periodEnd.getTime());
    expect(new Date((await ent()).readonly_until).getTime()).toBe(periodEnd.getTime() + SHORT.readonlyGraceDays * DAY);
    expect((await h.client.query("SELECT status FROM subscription WHERE project_id = $1", [id])).rows[0].status).toBe("PREMIUM_INACTIVE");
    // Idempotent.
    const settled = await ent();
    expect(await sweep()).toEqual({ periodsEnded: 0, windowsSettled: 0, revoked: 0 });
    expect(await ent()).toEqual(settled);
    expect((await provider.get(id)).accessMode).toBe("READ_ONLY");

    // Window ends -> REVOKED. Data is never deleted.
    const rowsBefore = await count("SELECT (SELECT count(*) FROM subscription WHERE project_id = $1) + (SELECT count(*) FROM subscription_event WHERE project_id = $1) + (SELECT count(*) FROM premium_checkout WHERE project_id = $1) + (SELECT count(*) FROM answer WHERE project_id = $1) AS n", [id]);
    h.advanceDays(SHORT.readonlyGraceDays);
    expect(await sweep()).toEqual({ periodsEnded: 0, windowsSettled: 0, revoked: 1 });
    expect(await ent()).toMatchObject({ precision_access_mode: "REVOKED", premium_access_active: false });
    expect((await ent()).revoked_at).not.toBeNull();
    expect(await provider.get(id)).toMatchObject({ premiumActive: false, accessMode: "REVOKED" });
    expect(await count("SELECT (SELECT count(*) FROM subscription WHERE project_id = $1) + (SELECT count(*) FROM subscription_event WHERE project_id = $1) + (SELECT count(*) FROM premium_checkout WHERE project_id = $1) + (SELECT count(*) FROM answer WHERE project_id = $1) AS n", [id])).toBe(rowsBefore);
    expect(await sweep()).toEqual({ periodsEnded: 0, windowsSettled: 0, revoked: 0 });

    // The same project pays again: automatic return to FULL, end-of-Premium fields cleared, a NEW subscription, no second handoff.
    const again = await startViaLink(link);
    expect(again.status).toBe(201);
    expect(again.body.outcome.kind).toBe("redirect");
    const second = lastSession();
    expect(second.metadata.project_id).toBe(id);
    await paidEvent(second.id);
    expect(await ent()).toMatchObject({ premium_access_active: true, precision_access_mode: "FULL", premium_ended_at: null, readonly_until: null, grace_days_applied: null, revoked_at: null });
    expect(await provider.get(id)).toEqual({ projectId: id, premiumActive: true, accessMode: "FULL" });
    expect((await h.client.query("SELECT event_type FROM subscription_event WHERE project_id = $1 ORDER BY occurred_at, event_type", [id])).rows.map((r) => r.event_type).sort()).toEqual(["premium_activated", "premium_reactivated", "subscription_period_ended"]);
    expect(await count("SELECT count(*)::int AS n FROM precision_handoff_package WHERE project_id = $1", [id])).toBe(0);
  });

  it("a payment that arrives after the period ran out but before the sweep renews instead of being called a duplicate", async () => {
    policy = SHORT;
    const { token, project } = await completedProject();
    const id = project.project_id as string;
    await startCheckout(token);
    await paidEvent(lastSession().id);
    h.advanceDays(SHORT.accessPeriodDays + 1);
    // (A checkout opened for this project before the period ran out; the sweep has not ended the old period yet.)
    const late = await client().createCheckoutSession({ projectId: id, locale: "es", idempotencyKey: "test:renewal" });
    await addCheckoutRow(id, late.id);
    const renewal = await paidEvent(late.id);
    expect(await outcomeOf(renewal.id)).toBe("ACTIVATED");
    expect((await h.client.query("SELECT event_type FROM subscription_event WHERE project_id = $1", [id])).rows.map((r) => r.event_type).sort()).toEqual(["premium_activated", "premium_reactivated", "subscription_period_ended"]);
    expect((await h.client.query("SELECT precision_access_mode FROM entitlement WHERE project_id = $1", [id])).rows[0].precision_access_mode).toBe("FULL");
  });

  it("the read-only window length is configuration: a different policy settles a different readonly_until", async () => {
    policy = SHORT;
    const { token, project } = await completedProject();
    const id = project.project_id as string;
    await startCheckout(token);
    await paidEvent(lastSession().id);
    h.advanceDays(SHORT.accessPeriodDays + 1);
    await sweepPrecisionAccess(h.deps.db, h.deps.bundles, { now: h.clock.now, policy: { accessPeriodDays: 20, readonlyGraceDays: 7 } });
    const e = (await h.client.query("SELECT grace_days_applied, premium_ended_at, readonly_until FROM entitlement WHERE project_id = $1", [id])).rows[0];
    expect(e.grace_days_applied).toBe(7);
    expect(new Date(e.readonly_until).getTime() - new Date(e.premium_ended_at).getTime()).toBe(7 * DAY);
  });

  // ------------------------------------------------------------------------------------------------
  it("no secret, signature or personal payload data reaches the logs or the stored audit rows", async () => {
    const { token } = await completedProject();
    await startCheckout(token);
    const s = lastSession();
    const paid = await paidEvent(s.id);
    await send("charge.refunded", { object: "charge", id: "ch_test_9", payment_intent: s.payment_intent, billing_details: { email: PII[0], name: PII[1] } });
    await send("checkout.session.async_payment_failed", { object: "checkout.session", id: "cs_test_unknown_session" });
    await app().post("/api/billing/stripe/webhook").set(signedHeaders("whsec_wrong", paid.raw)).send(paid.raw);
    await reconcileStripe({ db: h.deps.db, bundles: h.deps.bundles, client: client(), policy: POLICY, now: () => h.clock.now, log });

    expect(logs.length).toBeGreaterThan(0);
    const everything = JSON.stringify(logs);
    for (const secret of [fake.secretKey, WHSEC, "whsec_wrong", ...PII, paid.raw.slice(0, 60)]) expect(everything).not.toContain(secret);
    expect(everything).not.toMatch(/v1=[0-9a-f]{64}/);
    const audit = JSON.stringify((await h.client.query("SELECT summary FROM billing_inbound_event")).rows) + JSON.stringify((await h.client.query("SELECT detail FROM billing_alert")).rows);
    for (const secret of [fake.secretKey, WHSEC, ...PII]) expect(audit).not.toContain(secret);
  });

  it("the webhook endpoint is not the legacy provider-agnostic one: the Stripe signature scheme does not open /api/billing/events", async () => {
    const raw = JSON.stringify({ event_type: "premium_activated" });
    const res = await request(createApp({ fa: h.deps, stripe: webhookDeps() })).post("/api/billing/events").set(signedHeaders(WHSEC, raw)).send(raw);
    expect(res.status).toBe(404); // not mounted at all in this app: only /api/billing/stripe/webhook exists
  });
});
