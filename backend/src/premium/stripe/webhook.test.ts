import { handleStripeWebhook } from "./webhook";
import { signStripePayload } from "./signature";
import { stripeEvent } from "../../__tests__/helpers/fake-stripe";

const SECRET = "whsec_unit_webhook_secret_0123456789";
const NOW = new Date("2026-10-09T12:00:00Z");
const ts = Math.floor(NOW.getTime() / 1000);

/** Any database access in these tests is a bug: unverified requests must be refused before touching it. */
const untouchableDb = {
  query: () => { throw new Error("db touched"); },
  transaction: () => { throw new Error("db touched"); },
};
const deps = () => ({
  db: untouchableDb, bundles: {} as never, webhookSecrets: [SECRET], livemode: false, policy: { accessPeriodDays: 365, readonlyGraceDays: 90 }, now: () => NOW, log: jest.fn(),
});

describe("Stripe webhook: refusals happen before any database access", () => {
  const ev = stripeEvent("checkout.session.completed", { object: "checkout.session", id: "cs_test_1" });

  it("wrong secret -> 400, no detail", async () => {
    const r = await handleStripeWebhook(deps(), Buffer.from(ev.raw), signStripePayload("whsec_wrong", ts, ev.raw));
    expect(r).toEqual({ status: 400, body: { error: "invalid_request" } });
  });

  it("stale timestamp (replay of an old, once-valid delivery) -> 400", async () => {
    const r = await handleStripeWebhook(deps(), Buffer.from(ev.raw), signStripePayload(SECRET, ts - 301, ev.raw));
    expect(r.status).toBe(400);
  });

  it("missing signature header / empty body -> 400", async () => {
    expect((await handleStripeWebhook(deps(), Buffer.from(ev.raw), undefined)).status).toBe(400);
    expect((await handleStripeWebhook(deps(), Buffer.alloc(0), signStripePayload(SECRET, ts, ""))).status).toBe(400);
  });

  it("validly signed but not a Stripe event -> 400", async () => {
    const raw = JSON.stringify({ hello: "world" });
    expect((await handleStripeWebhook(deps(), Buffer.from(raw), signStripePayload(SECRET, ts, raw))).status).toBe(400);
  });

  it("an unexpected failure after verification is a bare 500 (Stripe retries) and never echoes the cause", async () => {
    const log = jest.fn();
    const r = await handleStripeWebhook({ ...deps(), log }, Buffer.from(ev.raw), signStripePayload(SECRET, ts, ev.raw));
    expect(r).toEqual({ status: 500, body: { error: "internal" } });
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET);
  });
});
