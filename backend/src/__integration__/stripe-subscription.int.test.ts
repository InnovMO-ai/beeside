import request from "supertest";
import { provisionAdminUser } from "../admin/admin-users";
import { createApp } from "../index";
import { FakeStripe, FakeSubscription, invoiceObject, sessionObject, signedHeaders, stripeEvent, subscriptionObject } from "../__tests__/helpers/fake-stripe";
import { CoreEntitlementProvider } from "../precision/adapters/core-entitlement";
import { issueGrant, recordPrivacyEvent } from "../premium/entitlement-grants";
import { sweepPrecisionAccess } from "../premium/precision-access";
import { PremiumPolicy } from "../premium/premium-policy";
import { StripeCheckout } from "../premium/stripe/checkout-adapter";
import { StripeClient } from "../premium/stripe/client";
import { StripeConfig } from "../premium/stripe/config";
import { reconcileStripe } from "../premium/stripe/reconcile";
import { StripeWebhookDeps } from "../premium/stripe/webhook";
import { Logger } from "../security/redact";
import { MANUFACTURER, describeWithDb, identity, runJourney, useHarness } from "./fa-harness";

const WHSEC = "whsec_integration_secret_0123456789abcdef";
const DAY = 86_400_000;
const POLICY: PremiumPolicy = { accessPeriodDays: 120, readonlyGraceDays: 30, renewalSafetyDays: 14 };
const PII = ["private.customer@example.invalid", "Private Customer"];

describeWithDb("Stripe RECURRING billing -> Core entitlement (PostgreSQL, rolled back; Stripe is a local FAKE, subscription mode)", () => {
  const h = useHarness();
  const fake = new FakeStripe(undefined, () => h.clock.now.getTime());
  let config: StripeConfig;
  let logs: Array<{ level: string; message: string; fields: unknown }> = [];
  const log: Logger = (level, message, fields) => {
    logs.push({ level, message, fields: fields ?? {} });
  };

  beforeAll(async () => {
    const base = await fake.start();
    config = {
      secretKey: fake.secretKey, webhookSecrets: [WHSEC], priceId: "price_TEST123", billingMode: "subscription", successUrl: "https://app.example.test/premium/return",
      cancelUrl: "https://app.example.test/premium", apiBaseUrl: base, apiVersion: "2024-06-20", requestTimeoutMs: 3000, maxRetries: 1,
    };
  });
  afterAll(() => fake.stop());
  beforeEach(() => {
    fake.reset();
    logs = [];
  });

  const client = () => new StripeClient(config);
  const webhookDeps = (): StripeWebhookDeps => ({ db: h.deps.db, bundles: h.deps.bundles, webhookSecrets: [WHSEC], livemode: false, policy: POLICY, now: () => h.clock.now, log });
  const app = () =>
    request(createApp({ fa: { ...h.deps, premium: { checkout: new StripeCheckout(client(), log) } }, stripe: webhookDeps() })) as unknown as request.SuperTest<request.Test>;
  const count = async (sql: string, params: unknown[] = []) => (await h.client.query<{ n: number }>(sql, params)).rows[0]?.n;
  const provider = () => new CoreEntitlementProvider(h.deps.db, { policy: POLICY, now: () => h.clock.now });
  const sweep = () => sweepPrecisionAccess(h.deps.db, h.deps.bundles, { now: h.clock.now, policy: POLICY });
  const reconcile = () => reconcileStripe({ db: h.deps.db, bundles: h.deps.bundles, client: client(), policy: POLICY, now: () => h.clock.now, log });

  let seq = 0;
  async function completedProject() {
    seq += 1;
    const start = await h.api().post("/api/fa/identity").send(identity({ email: `recurring.${seq}@northwind-test.example` }));
    expect(start.status).toBe(201);
    const token = start.body.sessionToken as string;
    expect((await h.api().post("/api/fa/session/finish-later").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    expect((await runJourney(h, token, MANUFACTURER)).status).toBe("COMPLETED_LOCKED");
    const { rows } = await h.client.query(
      `SELECT p.project_id FROM project p JOIN project_access_token t ON t.project_id = p.project_id WHERE t.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [token],
    );
    return { token, id: rows[0].project_id as string };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const startCheckout = (token: string) => app().post("/api/fa/session/premium/activation").set(auth(token)).send({ acceptTerms: true });
  const lastSession = () => fake.createdSessions().slice(-1)[0] as NonNullable<ReturnType<FakeStripe["createdSessions"]>[number]>;

  async function send(type: string, object: Record<string, unknown>) {
    const ts = Math.floor(h.clock.now.getTime() / 1000);
    const ev = stripeEvent(type, object, { created: ts });
    const res = await app().post("/api/billing/stripe/webhook").set(signedHeaders(WHSEC, ev.raw, ts)).send(ev.raw);
    expect(res.status).toBe(200);
    return { id: ev.id, raw: ev.raw };
  }
  const outcomeOf = async (eventId: string) => (await h.client.query("SELECT outcome FROM billing_inbound_event WHERE stripe_event_id = $1", [eventId])).rows[0]?.outcome as string;
  const invoicePaid = async (sub: FakeSubscription, options: Parameters<typeof invoiceObject>[1] = {}) => outcomeOf((await send("invoice.paid", invoiceObject(sub, options))).id);
  const subUpdated = async (sub: FakeSubscription, type = "customer.subscription.updated") => outcomeOf((await send(type, subscriptionObject(sub))).id);

  /** Customer completes the hosted page; the `checkout.session.completed` webhook arrives (and must only link). */
  async function subscribe(token: string) {
    const started = await startCheckout(token);
    expect(started.status).toBe(201);
    const { session, subscription } = fake.completeSubscriptionSession(lastSession().id);
    const linked = await outcomeOf((await send("checkout.session.completed", sessionObject(session))).id);
    return { session, subscription, linked };
  }
  /** The first invoice of an active (non-trial) subscription is paid. */
  const firstPayment = (sub: FakeSubscription) => invoicePaid(sub, { billingReason: "subscription_create" });

  const subRows = async (id: string) => (await h.client.query("SELECT status, current_period_start, current_period_end, auto_renews FROM subscription WHERE project_id = $1 ORDER BY created_at, current_period_start", [id])).rows;
  const eventTypes = async (id: string) => (await h.client.query("SELECT event_type FROM subscription_event WHERE project_id = $1 ORDER BY occurred_at, ctid", [id])).rows.map((r) => r.event_type as string);
  const alerts = async (kind: string) => count("SELECT count(*)::int AS n FROM billing_alert WHERE kind = $1", [kind]);
  const periodEndOf = async (id: string) => new Date((await subRows(id)).slice(-1)[0].current_period_end).getTime();
  const sec = (s: number) => s * 1000;

  // ------------------------------------------------------------------------------------------------
  it("creates a recurring Checkout session mapped to the project; nothing is held so there is no trial; a redirect alone activates NOTHING", async () => {
    const { token, id } = await completedProject();
    expect((await startCheckout(token)).status).toBe(201);
    const s = lastSession();
    expect(s).toMatchObject({ mode: "subscription", client_reference_id: id, metadata: { project_id: id }, trial_end: null });
    const req = fake.requests.find((r) => r.method === "POST");
    expect(req?.form["subscription_data[metadata][project_id]"]).toBe(id);
    expect(req?.form["subscription_data[trial_end]"]).toBeUndefined();
    expect(JSON.stringify(req?.form)).not.toContain("recurring.");
    expect((await h.client.query("SELECT billing_mode, status FROM premium_checkout WHERE project_id = $1", [id])).rows[0]).toEqual({ billing_mode: "subscription", status: "open" });
    expect(await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1", [id])).toBe(0);
    expect(await provider().get(id)).toMatchObject({ premiumActive: false, accessMode: "REVOKED" });
  });

  it("the completed session only LINKS the Stripe subscription; money collected (invoice.paid) activates, exactly once, however it is replayed", async () => {
    const { token, id } = await completedProject();
    const { subscription, linked } = await subscribe(token);
    expect(linked).toBe("CHECKOUT_LINKED");
    expect(await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1", [id])).toBe(0);
    expect((await provider().get(id)).accessMode).toBe("REVOKED");
    expect((await h.client.query("SELECT stripe_subscription_id, status FROM premium_checkout WHERE project_id = $1", [id])).rows[0]).toEqual({ stripe_subscription_id: subscription.id, status: "completed" });

    const raw = invoiceObject(subscription, { billingReason: "subscription_create" });
    expect(await outcomeOf((await send("invoice.paid", raw)).id)).toBe("ACTIVATED");
    // Same invoice redelivered under a new event id, and the same payment seen again: nothing new.
    expect(await outcomeOf((await send("invoice.paid", raw)).id)).toBe("ALREADY_APPLIED");
    expect(await subUpdated(subscription)).toBe("NO_CHANGE");

    expect(await subRows(id)).toEqual([expect.objectContaining({ status: "PREMIUM_ACTIVE", auto_renews: true })]);
    expect(await periodEndOf(id)).toBe(sec(subscription.current_period_end));
    expect(await eventTypes(id)).toEqual(["premium_activated"]);
    expect(await provider().get(id)).toEqual({ projectId: id, premiumActive: true, accessMode: "FULL" });
    expect((await h.client.query("SELECT outcome FROM premium_checkout WHERE project_id = $1", [id])).rows[0].outcome).toBe("ACTIVATED");
    expect(await count("SELECT count(*)::int AS n FROM precision_handoff_package WHERE project_id = $1", [id])).toBe(0);
  });

  it("a renewal moves the paid-through date forward once; replays and older invoices can never move it back", async () => {
    const { token, id } = await completedProject();
    const { subscription } = await subscribe(token);
    const first = invoiceObject(subscription, { billingReason: "subscription_create" });
    await send("invoice.paid", first);
    const firstEnd = await periodEndOf(id);

    h.advanceDays(30);
    fake.renew(subscription.id);
    const second = invoiceObject(subscription, { billingReason: "subscription_cycle" });
    expect(await outcomeOf((await send("invoice.paid", second)).id)).toBe("RENEWED");
    expect(await periodEndOf(id)).toBe(sec(subscription.current_period_end));
    expect(await periodEndOf(id)).toBe(firstEnd + 30 * DAY);

    // Replay of the renewal, then an out-of-order older invoice: neither changes anything.
    expect(await outcomeOf((await send("invoice.paid", second)).id)).toBe("ALREADY_APPLIED");
    expect(await outcomeOf((await send("invoice.paid", first)).id)).toBe("ALREADY_APPLIED");
    expect(await periodEndOf(id)).toBe(firstEnd + 30 * DAY);
    expect(await eventTypes(id)).toEqual(["premium_activated", "subscription_renewed"]);
    expect(await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1", [id])).toBe(1);
    expect((await provider().get(id)).accessMode).toBe("FULL");
  });

  it("cancel at period end keeps FULL until the paid-through date and can be withdrawn; if not withdrawn it ends exactly there", async () => {
    const { token, id } = await completedProject();
    const { subscription } = await subscribe(token);
    await firstPayment(subscription);
    const periodEnd = await periodEndOf(id);

    h.advanceDays(3);
    expect(await subUpdated(fake.setCancelAtPeriodEnd(subscription.id, true))).toBe("CANCELLATION_REQUESTED");
    expect((await subRows(id))[0].status).toBe("CANCELLATION_SCHEDULED");
    expect(await subUpdated(subscription)).toBe("NO_CHANGE"); // redelivery
    expect((await provider().get(id)).accessMode).toBe("FULL");

    h.advanceDays(1);
    expect(await subUpdated(fake.setCancelAtPeriodEnd(subscription.id, false))).toBe("CANCELLATION_WITHDRAWN");
    expect((await subRows(id))[0].status).toBe("PREMIUM_ACTIVE");

    h.advanceDays(1);
    expect(await subUpdated(fake.setCancelAtPeriodEnd(subscription.id, true))).toBe("CANCELLATION_REQUESTED");
    // A scheduled cancellation is final: the sweep ends it exactly at the period end (no renewal margin).
    h.clock.now = new Date(periodEnd - DAY);
    expect(await sweep()).toMatchObject({ periodsEnded: 0 });
    h.clock.now = new Date(periodEnd + 1000);
    expect((await provider().get(id)).accessMode).toBe("READ_ONLY");
    expect(await sweep()).toMatchObject({ periodsEnded: 1, windowsSettled: 1 });
    expect((await h.client.query("SELECT precision_access_mode, premium_ended_at FROM entitlement WHERE project_id = $1", [id])).rows[0]).toMatchObject({ precision_access_mode: "READ_ONLY" });
    expect(await eventTypes(id)).toEqual(["premium_activated", "cancellation_requested", "cancellation_withdrawn", "cancellation_requested", "subscription_period_ended"]);
  });

  it("a failed charge is an ALERT, not a lock-out: access continues through the provider's collection retries; the late payment renews", async () => {
    const { token, id } = await completedProject();
    const { subscription } = await subscribe(token);
    await firstPayment(subscription);

    h.advanceDays(30);
    const failed = invoiceObject(subscription, { amountPaid: 0, billingReason: "subscription_cycle" });
    expect(await outcomeOf((await send("invoice.payment_failed", failed)).id)).toBe("PAYMENT_FAILURE_RECORDED");
    expect(await subUpdated(fake.setSubscriptionStatus(subscription.id, "past_due"))).toBe("PAST_DUE_RECORDED");
    expect(await alerts("subscription_payment_failed")).toBe(1);
    expect(await alerts("subscription_past_due")).toBe(1);
    expect((await provider().get(id)).accessMode).toBe("FULL"); // inside the safety margin
    expect((await subRows(id))[0].status).toBe("PREMIUM_ACTIVE");

    h.advanceDays(2);
    fake.renew(subscription.id);
    expect(await invoicePaid(subscription)).toBe("RENEWED");
    expect(await periodEndOf(id)).toBe(sec(subscription.current_period_end));
  });

  it.each(["canceled", "unpaid"])("the provider ending the subscription (%s) ends Core's term immediately; replays change nothing", async (finalStatus) => {
    const { token, id } = await completedProject();
    const { subscription } = await subscribe(token);
    await firstPayment(subscription);

    h.advanceDays(10);
    const ended = fake.setSubscriptionStatus(subscription.id, finalStatus);
    const type = finalStatus === "canceled" ? "customer.subscription.deleted" : "customer.subscription.updated";
    expect(await subUpdated(ended, type)).toBe("PERIOD_ENDED");
    expect(await subUpdated(ended, type)).toBe("NO_CHANGE");
    expect((await subRows(id))[0].status).toBe("PREMIUM_INACTIVE");
    expect(await provider().get(id)).toMatchObject({ premiumActive: false, accessMode: "READ_ONLY" });
    expect(await eventTypes(id)).toEqual(["premium_activated", "subscription_period_ended"]);
    // Nothing is deleted: the window then closes by the clock.
    h.advanceDays(POLICY.readonlyGraceDays);
    await sweep();
    expect(await provider().get(id)).toMatchObject({ accessMode: "REVOKED" });
    expect(await count("SELECT count(*)::int AS n FROM premium_checkout WHERE project_id = $1", [id])).toBe(1);
  });

  it("THE STACKING RULE: held access is never paid twice — the first charge is scheduled where the held access ends, and Premium continues without a gap", async () => {
    const { token, id } = await completedProject();
    const adm = (await provisionAdminUser(h.deps.db, { email: "recurring.approver@beeside-ops.example", role: "ADMIN" }, h.clock.now)).adminUserId;
    const grantEnd = new Date(h.clock.now.getTime() + 60 * DAY);
    await issueGrant(h.deps.db, { scope: { projectId: id }, source: "complimentary", startsAt: h.clock.now, endsAt: grantEnd, reason: "design partner", approvedBy: adm, actor: `admin:${adm}`, now: h.clock.now });
    expect((await provider().get(id)).accessMode).toBe("FULL");

    expect((await startCheckout(token)).status).toBe(201);
    expect(lastSession().trial_end).toBe(Math.floor(grantEnd.getTime() / 1000));
    const { session, subscription } = fake.completeSubscriptionSession(lastSession().id);
    expect(subscription.status).toBe("trialing");
    expect(await outcomeOf((await send("checkout.session.completed", sessionObject(session))).id)).toBe("CHECKOUT_LINKED");
    // The $0 trial invoice collects nothing; Stripe says "trialing": no paid term exists yet and the held access is untouched.
    expect(await invoicePaid(subscription, { amountPaid: 0, billingReason: "subscription_create" })).toBe("NO_PAYMENT_DUE");
    expect(await subUpdated(subscription)).toBe("NO_PAID_PERIOD");
    expect(await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1", [id])).toBe(0);
    expect((await provider().get(id)).accessMode).toBe("FULL");

    // The trial ends: the first cycle is collected and the paid term starts exactly where the held access ended.
    h.clock.now = new Date(grantEnd.getTime() + 60_000);
    fake.collectFirstCycle(subscription.id);
    expect(await invoicePaid(subscription, { billingReason: "subscription_cycle" })).toBe("ACTIVATED");
    expect(await provider().get(id)).toEqual({ projectId: id, premiumActive: true, accessMode: "FULL" });
    const sources = (await h.client.query("SELECT source, starts_at, effective_end FROM entitlement_sources_for($1) ORDER BY starts_at", [id])).rows;
    expect(sources.map((s) => s.source)).toEqual(["complimentary", "paid"]);
    expect(await periodEndOf(id)).toBe(sec(subscription.current_period_end));
    expect(new Date(sources[1].starts_at).getTime()).toBe(sec(subscription.current_period_start));
  });

  it("RECONCILIATION heals what the webhooks missed: first charge, renewal, cancellation request, withdrawal and end — and is safe to repeat", async () => {
    const { token, id } = await completedProject();
    const started = await startCheckout(token);
    expect(started.status).toBe(201);
    const { subscription } = fake.completeSubscriptionSession(lastSession().id); // no webhook delivered at all

    expect(await reconcile()).toMatchObject({ subscriptionsChecked: 1, subscriptionsApplied: 1, failures: 0 });
    expect((await h.client.query("SELECT source FROM subscription_event WHERE project_id = $1", [id])).rows).toEqual([{ source: "stripe_reconciliation" }]);
    expect((await provider().get(id)).accessMode).toBe("FULL");
    expect(await reconcile()).toMatchObject({ subscriptionsApplied: 0, failures: 0 });
    // A late webhook for the same first payment adds nothing.
    expect(await firstPayment(subscription)).toBe("ALREADY_APPLIED");
    expect(await count("SELECT count(*)::int AS n FROM subscription_event WHERE project_id = $1", [id])).toBe(1);

    h.advanceDays(30);
    fake.renew(subscription.id);
    expect(await reconcile()).toMatchObject({ subscriptionsApplied: 1 });
    expect(await periodEndOf(id)).toBe(sec(subscription.current_period_end));

    h.advanceMinutes(10);
    fake.setCancelAtPeriodEnd(subscription.id, true);
    expect(await reconcile()).toMatchObject({ subscriptionsApplied: 1 });
    expect((await subRows(id))[0].status).toBe("CANCELLATION_SCHEDULED");

    h.advanceMinutes(10);
    fake.setCancelAtPeriodEnd(subscription.id, false);
    expect(await reconcile()).toMatchObject({ subscriptionsApplied: 1 });
    expect((await subRows(id))[0].status).toBe("PREMIUM_ACTIVE");

    h.advanceDays(2);
    fake.setSubscriptionStatus(subscription.id, "canceled");
    expect(await reconcile()).toMatchObject({ subscriptionsApplied: 1 });
    expect(await provider().get(id)).toMatchObject({ premiumActive: false, accessMode: "READ_ONLY" });
    expect(await reconcile()).toMatchObject({ subscriptionsApplied: 0, failures: 0 });
    expect(await eventTypes(id)).toEqual(["premium_activated", "subscription_renewed", "cancellation_requested", "cancellation_withdrawn", "subscription_period_ended"]);
  });

  it("RECONCILIATION recovers the first charge after a trial that the invoice webhook never reported", async () => {
    const { token, id } = await completedProject();
    const adm = (await provisionAdminUser(h.deps.db, { email: "recurring.approver2@beeside-ops.example", role: "ADMIN" }, h.clock.now)).adminUserId;
    const grantEnd = new Date(h.clock.now.getTime() + 20 * DAY);
    await issueGrant(h.deps.db, { scope: { projectId: id }, source: "complimentary", startsAt: h.clock.now, endsAt: grantEnd, reason: "pilot", approvedBy: adm, actor: `admin:${adm}`, now: h.clock.now });
    await startCheckout(token);
    const { subscription } = fake.completeSubscriptionSession(lastSession().id);
    expect(await reconcile()).toMatchObject({ subscriptionsApplied: 0, failures: 0 }); // still trialing: nothing to apply
    expect(await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1", [id])).toBe(0);

    h.clock.now = new Date(grantEnd.getTime() + 3_600_000);
    fake.collectFirstCycle(subscription.id);
    expect(await reconcile()).toMatchObject({ subscriptionsApplied: 1 });
    expect(await provider().get(id)).toMatchObject({ premiumActive: true, accessMode: "FULL" });
    expect(await periodEndOf(id)).toBe(sec(subscription.current_period_end));
  });

  it("the sweep waits the renewal safety margin for a recurring subscription (no flicker on a late renewal); a renewal after the margin starts a new term on the same project", async () => {
    const { token, id } = await completedProject();
    const { subscription } = await subscribe(token);
    await firstPayment(subscription);
    const periodEnd = await periodEndOf(id);

    h.clock.now = new Date(periodEnd + 13 * DAY);
    expect(await sweep()).toEqual({ periodsEnded: 0, windowsSettled: 0, revoked: 0 });
    expect((await provider().get(id)).accessMode).toBe("FULL"); // the clock also waits: same margin as the sweep

    h.clock.now = new Date(periodEnd + 15 * DAY);
    expect((await provider().get(id)).accessMode).toBe("READ_ONLY");
    expect(await sweep()).toMatchObject({ periodsEnded: 1, windowsSettled: 1 });
    expect((await h.client.query("SELECT premium_ended_at FROM entitlement WHERE project_id = $1", [id])).rows[0].premium_ended_at.getTime()).toBe(periodEnd);

    // The renewal finally lands (the provider's collection succeeded late): a new Core term, access back to FULL.
    fake.renew(subscription.id);
    expect(await invoicePaid(subscription)).toBe("ACTIVATED");
    expect(await provider().get(id)).toEqual({ projectId: id, premiumActive: true, accessMode: "FULL" });
    expect(await eventTypes(id)).toEqual(["premium_activated", "subscription_period_ended", "premium_reactivated"]);
    expect(await invoicePaid(subscription)).toBe("ALREADY_APPLIED");
    expect(await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1 AND status <> 'PREMIUM_INACTIVE'", [id])).toBe(1);
  });

  it("a SECOND paid subscription while Premium is current never creates a second term: recorded, alerted, access unchanged", async () => {
    const { token, id } = await completedProject();
    const { subscription } = await subscribe(token);
    await firstPayment(subscription);
    const before = await periodEndOf(id);

    // A second subscription-mode checkout for the same project (e.g. a second tab), paid.
    const second = await client().createCheckoutSession({ projectId: id, locale: "es", idempotencyKey: "test:second-subscription" });
    await h.client.query(
      `INSERT INTO premium_checkout (project_id, stripe_session_id, status, idempotency_key, checkout_url, interface_language, expires_at, billing_mode)
       VALUES ($1, $2, 'open', 'test:second', 'https://checkout.stripe.test/x', 'es', $3, 'subscription')`,
      [id, second.id, new Date(h.clock.now.getTime() + DAY)],
    );
    const other = fake.completeSubscriptionSession(second.id).subscription;
    expect(await outcomeOf((await send("checkout.session.completed", sessionObject(fake.must(second.id)))).id)).toBe("CHECKOUT_LINKED");
    expect(await firstPayment(other)).toBe("NOT_APPLICABLE_DUPLICATE_PAYMENT");
    expect(await alerts("duplicate_payment")).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1", [id])).toBe(1);
    expect(await periodEndOf(id)).toBe(before);
    expect((await provider().get(id)).accessMode).toBe("FULL");
  });

  it("mapping is explicit and never by e-mail: a subscription tied to another project is REJECTED with an alert; another product's subscriptions are simply not ours", async () => {
    const a = await completedProject();
    const b = await completedProject();
    const { subscription } = await subscribe(a.token);
    await firstPayment(subscription);

    // The same Stripe subscription now claims project B in its metadata: rejected, nothing changes for either project.
    h.advanceDays(30);
    fake.renew(subscription.id);
    expect(await invoicePaid(subscription, { subscriptionMetadata: { project_id: b.id } })).toBe("REJECTED_MAPPING");
    expect(await alerts("payment_mapping_rejected")).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1", [b.id])).toBe(0);
    expect(await eventTypes(a.id)).toEqual(["premium_activated"]);

    // A subscription of another product in the same Stripe account carries no Beeside project: ignored without noise.
    const foreign: FakeSubscription = { ...subscription, id: "sub_test_foreign_product", metadata: {} };
    expect(await subUpdated(foreign)).toBe("IGNORED_NOT_OURS");
    expect(await invoicePaid(foreign)).toBe("IGNORED_NOT_OURS");
    expect(await alerts("payment_mapping_rejected")).toBe(1);

    // An invoice for a project that never started a subscription checkout is rejected, never activated.
    const stray: FakeSubscription = { ...subscription, id: "sub_test_stray_claim", metadata: { project_id: b.id } };
    expect(await invoicePaid(stray, { billingReason: "subscription_create" })).toBe("REJECTED_MAPPING");
    expect(await provider().get(b.id)).toMatchObject({ premiumActive: false, accessMode: "REVOKED" });
  });

  it("privacy overrides commerce: a paying project whose access is blocked is REVOKED whatever Stripe says, and the commercial record stays intact", async () => {
    const { token, id } = await completedProject();
    const { subscription } = await subscribe(token);
    await firstPayment(subscription);
    expect((await provider().get(id)).accessMode).toBe("FULL");
    await recordPrivacyEvent(h.deps.db, { projectId: id, event: "access_blocked", reasonCode: "legal_order", actor: "system:test" });
    expect(await provider().get(id)).toMatchObject({ premiumActive: false, accessMode: "REVOKED" });
    h.advanceDays(30);
    fake.renew(subscription.id);
    expect(await invoicePaid(subscription)).toBe("RENEWED"); // the money is still recorded
    expect((await provider().get(id)).accessMode).toBe("REVOKED");
    await recordPrivacyEvent(h.deps.db, { projectId: id, event: "access_restored", reasonCode: "other", actor: "system:test" });
    expect((await provider().get(id)).accessMode).toBe("FULL");
  });

  it("no secret, signature or personal payload data reaches the logs or the stored webhook rows in subscription mode", async () => {
    const { token } = await completedProject();
    const { subscription } = await subscribe(token);
    await firstPayment(subscription);
    h.advanceDays(30);
    await send("invoice.payment_failed", invoiceObject(subscription, { amountPaid: 0 }));
    await reconcile();
    const stored = JSON.stringify((await h.client.query("SELECT * FROM billing_inbound_event")).rows) + JSON.stringify((await h.client.query("SELECT * FROM billing_alert")).rows);
    const logged = JSON.stringify(logs);
    for (const secret of [WHSEC, fake.secretKey, ...PII]) {
      expect(stored).not.toContain(secret);
      expect(logged).not.toContain(secret);
    }
  });
});
