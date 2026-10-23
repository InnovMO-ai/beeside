import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe-Signature verification (https://stripe.com/docs/webhooks#verify-manually), against the RAW request body:
 * header `t=<unix>,v1=<hex>[,v1=<hex>...]`, expected = HMAC-SHA256(secret, `${t}.${rawBody}`) as hex, constant-time
 * comparison, timestamp tolerance (default 300 s, both directions). Any v1 value matching any configured secret passes.
 */
export const STRIPE_SIGNATURE_HEADER = "stripe-signature";
export const STRIPE_TIMESTAMP_TOLERANCE_SECONDS = 300;

export function parseStripeSignatureHeader(header: string | undefined): { timestamp: number; signatures: string[] } | null {
  if (!header || header.length > 2000) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t" && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    else if (key === "v1" && /^[0-9a-f]{64}$/i.test(value)) signatures.push(value.toLowerCase());
  }
  return timestamp === null || signatures.length === 0 ? null : { timestamp, signatures };
}

export function computeStripeSignature(secret: string, timestamp: number, rawBody: Buffer | string): string {
  const body = typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody;
  return createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
}

/** Builds a header value (tests and the sandbox script). */
export function signStripePayload(secret: string, timestamp: number, rawBody: Buffer | string): string {
  return `t=${timestamp},v1=${computeStripeSignature(secret, timestamp, rawBody)}`;
}

export function verifyStripeSignature(
  secrets: readonly string[],
  rawBody: Buffer,
  header: string | undefined,
  now: Date,
  toleranceSeconds = STRIPE_TIMESTAMP_TOLERANCE_SECONDS,
): boolean {
  const parsed = parseStripeSignatureHeader(header);
  if (!parsed || secrets.length === 0) return false;
  if (Math.abs(Math.floor(now.getTime() / 1000) - parsed.timestamp) > toleranceSeconds) return false;
  let ok = false;
  // No early exit: the work done does not depend on which secret or signature matched.
  for (const secret of secrets) {
    const expected = Buffer.from(computeStripeSignature(secret, parsed.timestamp, rawBody), "hex");
    for (const candidate of parsed.signatures) {
      const received = Buffer.from(candidate, "hex");
      if (received.length === expected.length && timingSafeEqual(received, expected)) ok = true;
    }
  }
  return ok;
}
