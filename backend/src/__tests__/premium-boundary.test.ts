import request from "supertest";
import { Db } from "../db/database";
import { BundleStore } from "../fa/services/bundle-store";
import { createApp, faDepsFromEnv } from "../index";
import { BILLING_SIGNATURE_HEADER, BILLING_TIMESTAMP_HEADER, signBillingPayload, verifyBillingSignature } from "../premium/billing-router";
import { DevSimulatedCheckout, ManualConfirmationCheckout } from "../premium/checkout";
import { PREMIUM_COPY, PREVIEW_ROOM_URL } from "../premium/content";

const SECRET = "unit-billing-secret-0123456789abcdef012345";

describe("billing event signature", () => {
  const body = Buffer.from('{"event_type":"premium_activated"}');
  const now = new Date("2026-09-15T12:00:00.000Z");
  const timestamp = Math.floor(now.getTime() / 1000);
  const verify = (signature: string | undefined, ts: string | null = String(timestamp), at: Date = now, raw: Buffer = body) =>
    verifyBillingSignature(SECRET, raw, signature, ts ?? undefined, at);

  it("accepts only the HMAC-SHA256 of the timestamp and the exact raw body", () => {
    const signature = signBillingPayload(SECRET, timestamp, body);
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verify(signature)).toBe(true);
    expect(verify(signature, String(timestamp), now, Buffer.from('{"event_type":"premium_reactivated"}'))).toBe(false);
    expect(verifyBillingSignature("another-secret-0123456789abcdef0123456", body, signature, String(timestamp), now)).toBe(false);
    expect(verify(undefined)).toBe(false);
    expect(verify("sha256=short")).toBe(false);
    // The timestamp is part of the signature and must be present and well formed.
    expect(verify(signature, null)).toBe(false);
    expect(verify(signature, "not-a-timestamp")).toBe(false);
    expect(verify(signBillingPayload(SECRET, timestamp + 1, body))).toBe(false);
  });

  it("refuses a delivery replayed outside the tolerance window", () => {
    const signature = signBillingPayload(SECRET, timestamp, body);
    expect(verify(signature, String(timestamp), new Date(now.getTime() + 299_000))).toBe(true);
    expect(verify(signature, String(timestamp), new Date(now.getTime() + 301_000))).toBe(false);
    expect(verify(signature, String(timestamp), new Date(now.getTime() - 301_000))).toBe(false);
  });
});

describe("billing event endpoint (no database reached)", () => {
  const untouchedDb = {
    query: () => Promise.reject(new Error("database must not be reached")),
    transaction: () => Promise.reject(new Error("database must not be reached")),
  } as unknown as Db;
  const now = new Date("2026-09-15T12:00:00.000Z");
  const timestamp = Math.floor(now.getTime() / 1000);
  const app = () => request(createApp({ billing: { db: untouchedDb, bundles: {} as BundleStore, secret: SECRET, now: () => now } }));
  const post = (raw: string, signature?: string) =>
    app()
      .post("/api/billing/events")
      .set("Content-Type", "application/json")
      .set(BILLING_TIMESTAMP_HEADER, String(timestamp))
      .set(BILLING_SIGNATURE_HEADER, signature ?? signBillingPayload(SECRET, timestamp, raw))
      .send(raw);

  it("rejects unsigned, forged or replayed deliveries before parsing them", async () => {
    const raw = JSON.stringify({ event_type: "premium_activated" });
    expect((await app().post("/api/billing/events").set("Content-Type", "application/json").send(raw)).status).toBe(401);
    expect((await post(raw, signBillingPayload("wrong-secret-0123456789abcdef0123456789", timestamp, raw))).status).toBe(401);
    const stale = Math.floor(now.getTime() / 1000) - 3600;
    expect(
      (
        await app()
          .post("/api/billing/events")
          .set("Content-Type", "application/json")
          .set(BILLING_TIMESTAMP_HEADER, String(stale))
          .set(BILLING_SIGNATURE_HEADER, signBillingPayload(SECRET, stale, raw))
          .send(raw)
      ).status,
    ).toBe(401);
  });

  it("validates the provider-agnostic contract", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post(JSON.stringify({ event_type: "invoice_paid", project_id: "7d8e0f1a-2b3c-4d5e-8f90-1a2b3c4d5e6f" }))).body.details).toEqual({ fields: ["event_type"] });
    expect((await post(JSON.stringify({ event_type: "premium_activated", project_id: "nope" }))).body.details).toEqual({ fields: ["project_id"] });
    const base = { event_type: "premium_activated", project_id: "7d8e0f1a-2b3c-4d5e-8f90-1a2b3c4d5e6f" };
    expect((await post(JSON.stringify(base))).body.details).toEqual({ fields: ["idempotency_key"] });
    expect((await post(JSON.stringify({ ...base, idempotency_key: "evt-000001" }))).body.details).toEqual({ fields: ["occurred_at"] });
    expect((await post(JSON.stringify({ ...base, idempotency_key: "evt-000001", occurred_at: "yesterday" }))).body.details).toEqual({ fields: ["occurred_at"] });
  });

  it("is not mounted unless billing dependencies are provided", async () => {
    expect((await request(createApp()).post("/api/billing/events").send({})).status).toBe(404);
  });
});

describe("checkout adapters", () => {
  const checkoutRequest = { requestId: "11111111-1111-4111-8111-111111111111", projectId: "22222222-2222-4222-8222-222222222222", kind: "activation" as const, now: new Date() };

  it("manual confirmation never activates and selects no provider", async () => {
    const adapter = new ManualConfirmationCheckout();
    expect(adapter.name).toBe("manual_confirmation");
    expect(await adapter.begin()).toEqual({ outcome: { kind: "pending_confirmation" }, reference: null });
  });

  it("development simulation confirms through the injected event processor", async () => {
    const confirm = jest.fn().mockResolvedValue(undefined);
    const adapter = new DevSimulatedCheckout(confirm);
    const tx = {} as Db;
    expect(await adapter.begin(tx, checkoutRequest)).toEqual({ outcome: { kind: "activated" }, reference: `dev-sim-${checkoutRequest.requestId}` });
    expect(confirm).toHaveBeenCalledWith(tx, checkoutRequest);
  });

  it("is enabled only by PREMIUM_DEV_SIMULATION outside production", () => {
    const env = { FA_API_ENABLED: "true", DATABASE_URL: "postgres://localhost:1/none", APP_BASE_URL: "http://localhost:5173" };
    expect(faDepsFromEnv({ ...env })?.premium).toBeUndefined();
    expect(faDepsFromEnv({ ...env, PREMIUM_DEV_SIMULATION: "true" })?.premium?.checkout.name).toBe("dev_simulated");
    expect(faDepsFromEnv({ ...env, PREMIUM_DEV_SIMULATION: "true", NODE_ENV: "production" })?.premium).toBeUndefined();
  });
});

describe("Premium transition copy", () => {
  const shape = (value: unknown): unknown =>
    Array.isArray(value) ? value.map(shape) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)])) : typeof value;
  const strings = (value: unknown): string[] =>
    typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(strings) : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];

  it("has the same structure in English and Spanish", () => {
    expect(shape(PREMIUM_COPY.es)).toEqual(shape(PREMIUM_COPY.en));
    expect(strings(PREMIUM_COPY.en).every((s) => s.trim().length > 0)).toBe(true);
    expect(strings(PREMIUM_COPY.es).every((s) => s.trim().length > 0)).toBe(true);
  });

  it("invents no price or payment terms and never frames Premium as revealing hidden results", () => {
    const all = [...strings(PREMIUM_COPY.en), ...strings(PREMIUM_COPY.es)].join("\n");
    expect(all).not.toMatch(/\$|USD|MXN|€|\bprice\b|\bprecio\b|per month|al mes|refund|reembolso|free trial|prueba gratis/i);
    expect(all).not.toMatch(/unlock|reveal|hidden|desbloque|revela|ocult/i);
    expect(PREVIEW_ROOM_URL).toBe("https://www.beeside.you/preview");
  });
});
