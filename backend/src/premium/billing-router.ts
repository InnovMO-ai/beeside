import { createHmac, timingSafeEqual } from "node:crypto";
import express, { Request, Response, Router } from "express";
import { Db } from "../db/database";
import { isUuid } from "../fa/services/analytics";
import { BundleStore } from "../fa/services/bundle-store";
import { FaError } from "../fa/services/errors";
import { isSubscriptionEventType, processSubscriptionEvent } from "./subscription-events";

/**
 * Provider-agnostic subscription event endpoint (Technical Architecture v1.1 §15). A future payment
 * provider adapter translates its webhooks into this signed contract; no provider is selected here.
 * Mounted only when BILLING_EVENTS_ENABLED=true with a server-side secret (never hard-coded).
 *
 * Phase 13: the signature covers a timestamp as well as the body, and a request whose timestamp is
 * outside the tolerance window is refused — a captured call cannot be replayed later. (Replaying an
 * event within the window still changes nothing: the idempotency key makes it a no-op.)
 */
export interface BillingDeps {
  db: Db;
  bundles: BundleStore;
  secret: string;
  /** Injected in tests; defaults to the wall clock. */
  now?: () => Date;
}

export const BILLING_SIGNATURE_HEADER = "x-beeside-signature";
export const BILLING_TIMESTAMP_HEADER = "x-beeside-timestamp";
export const BILLING_TIMESTAMP_TOLERANCE_SECONDS = 300;

export function signBillingPayload(secret: string, timestamp: number, rawBody: string | Buffer): string {
  const body = typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody;
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex")}`;
}

export function verifyBillingSignature(
  secret: string,
  rawBody: Buffer,
  header: string | undefined,
  timestampHeader: string | undefined,
  now: Date,
  toleranceSeconds = BILLING_TIMESTAMP_TOLERANCE_SECONDS,
): boolean {
  if (!header || !timestampHeader || !/^\d{1,12}$/.test(timestampHeader)) return false;
  const timestamp = Number(timestampHeader);
  if (Math.abs(Math.floor(now.getTime() / 1000) - timestamp) > toleranceSeconds) return false;
  const expected = Buffer.from(signBillingPayload(secret, timestamp, rawBody));
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function date(value: unknown, field: string, required: boolean): Date | null {
  if (value === undefined || value === null) {
    if (required) throw new FaError("INVALID_INPUT", `${field} is required`, { fields: [field] });
    return null;
  }
  const parsed = typeof value === "string" ? new Date(value) : new Date(NaN);
  if (Number.isNaN(parsed.getTime())) throw new FaError("INVALID_INPUT", `${field} must be an ISO timestamp`, { fields: [field] });
  return parsed;
}

export function createBillingRouter(deps: BillingDeps): Router {
  const clock = deps.now ?? (() => new Date());
  const router = Router();
  router.post("/events", express.raw({ type: "application/json", limit: "32kb" }), (req: Request, res: Response) => {
    void (async () => {
      try {
        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (!verifyBillingSignature(deps.secret, raw, req.header(BILLING_SIGNATURE_HEADER), req.header(BILLING_TIMESTAMP_HEADER), clock())) {
          throw new FaError("UNAUTHENTICATED", "invalid signature");
        }
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
        } catch {
          throw new FaError("INVALID_INPUT", "body must be JSON");
        }
        if (!isSubscriptionEventType(payload.event_type)) throw new FaError("INVALID_INPUT", "unknown event_type", { fields: ["event_type"] });
        if (!isUuid(payload.project_id)) throw new FaError("INVALID_INPUT", "project_id must be a UUID", { fields: ["project_id"] });
        const key = payload.idempotency_key;
        if (typeof key !== "string" || key.length < 8 || key.length > 200) throw new FaError("INVALID_INPUT", "idempotency_key is required", { fields: ["idempotency_key"] });
        const reference = typeof payload.provider_reference === "string" ? payload.provider_reference.slice(0, 200) : null;
        const source = typeof payload.source === "string" && /^[a-z0-9_]{2,40}$/.test(payload.source) ? payload.source : "billing_adapter";
        const input = {
          projectId: payload.project_id,
          eventType: payload.event_type,
          occurredAt: date(payload.occurred_at, "occurred_at", true) as Date,
          source,
          providerReference: reference,
          idempotencyKey: key,
          periodStart: date(payload.current_period_start, "current_period_start", false),
          periodEnd: date(payload.current_period_end, "current_period_end", false),
        };
        const result = await deps.db.transaction((tx) => processSubscriptionEvent(tx, deps.bundles, input));
        res.status(result.duplicate ? 200 : 201).json(result);
      } catch (error) {
        if (error instanceof FaError) {
          res.status(error.status).json({ error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
        } else {
          res.status(500).json({ error: "INTERNAL", message: "event could not be processed" });
        }
      }
    })();
  });
  return router;
}
