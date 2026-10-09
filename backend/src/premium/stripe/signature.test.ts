import { computeStripeSignature, parseStripeSignatureHeader, signStripePayload, verifyStripeSignature } from "./signature";

const SECRET = "whsec_unit_test_secret_0123456789";
const NOW = new Date("2026-10-09T12:00:00Z");
const ts = Math.floor(NOW.getTime() / 1000);
const body = Buffer.from('{"id":"evt_1","type":"checkout.session.completed"}');

describe("Stripe-Signature verification", () => {
  it("accepts a valid signature over the raw body", () => {
    expect(verifyStripeSignature([SECRET], body, signStripePayload(SECRET, ts, body), NOW)).toBe(true);
  });

  it("rejects a wrong secret, a tampered body and a re-serialised body", () => {
    expect(verifyStripeSignature([SECRET], body, signStripePayload("whsec_other", ts, body), NOW)).toBe(false);
    expect(verifyStripeSignature([SECRET], Buffer.from('{"id":"evt_2"}'), signStripePayload(SECRET, ts, body), NOW)).toBe(false);
    // Same JSON, different bytes (whitespace): the signature is over the RAW body, so it must fail.
    expect(verifyStripeSignature([SECRET], Buffer.from('{ "id":"evt_1","type":"checkout.session.completed"}'), signStripePayload(SECRET, ts, body), NOW)).toBe(false);
  });

  it("enforces the 300 s tolerance in both directions and allows the boundary", () => {
    expect(verifyStripeSignature([SECRET], body, signStripePayload(SECRET, ts - 300, body), NOW)).toBe(true);
    expect(verifyStripeSignature([SECRET], body, signStripePayload(SECRET, ts - 301, body), NOW)).toBe(false);
    expect(verifyStripeSignature([SECRET], body, signStripePayload(SECRET, ts + 301, body), NOW)).toBe(false);
  });

  it("a stale signature cannot be fixed by changing only the timestamp in the header", () => {
    const old = ts - 3600;
    const sig = computeStripeSignature(SECRET, old, body);
    expect(verifyStripeSignature([SECRET], body, `t=${ts},v1=${sig}`, NOW)).toBe(false);
  });

  it("accepts any matching v1 among several, and any configured secret (rotation)", () => {
    const good = computeStripeSignature(SECRET, ts, body);
    const bad = "0".repeat(64);
    expect(verifyStripeSignature([SECRET], body, `t=${ts},v1=${bad},v1=${good}`, NOW)).toBe(true);
    expect(verifyStripeSignature(["whsec_old", SECRET], body, `t=${ts},v1=${good}`, NOW)).toBe(true);
    expect(verifyStripeSignature(["whsec_old"], body, `t=${ts},v1=${good}`, NOW)).toBe(false);
  });

  it("ignores v0 schemes and refuses malformed or missing headers", () => {
    const good = computeStripeSignature(SECRET, ts, body);
    expect(verifyStripeSignature([SECRET], body, `t=${ts},v0=${good}`, NOW)).toBe(false);
    for (const header of [undefined, "", "garbage", `t=abc,v1=${good}`, `v1=${good}`, `t=${ts}`, `t=${ts},v1=short`, `t=${ts},v1=${"z".repeat(64)}`]) {
      expect(verifyStripeSignature([SECRET], body, header, NOW)).toBe(false);
    }
    expect(verifyStripeSignature([], body, signStripePayload(SECRET, ts, body), NOW)).toBe(false);
    expect(parseStripeSignatureHeader(`t=${ts},v1=${good},v1=${good}`)?.signatures).toHaveLength(2);
  });

  it("matches the documented Stripe construction (HMAC-SHA256 over `${t}.${payload}`)", () => {
    // Independent re-computation with node:crypto, not through the module under test.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const expected = require("node:crypto").createHmac("sha256", SECRET).update(`${ts}.`).update(body).digest("hex");
    expect(computeStripeSignature(SECRET, ts, body)).toBe(expected);
  });
});
