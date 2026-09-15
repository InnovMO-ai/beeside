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
 */
export interface BillingDeps {
  db: Db;
  bundles: BundleStore;
  secret: string;
}

export const BILLING_SIGNATURE_HEADER = "x-beeside-signature";

export function signBillingPayload(secret: string, rawBody: string | Buffer): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

export function verifyBillingSignature(secret: string, rawBody: Buffer, header: string | undefined): boolean {
  if (!header) return false;
  const expected = Buffer.from(signBillingPayload(secret, rawBody));
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
  const router = Router();
  router.post("/events", express.raw({ type: "application/json", limit: "32kb" }), (req: Request, res: Response) => {
    void (async () => {
      try {
        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (!verifyBillingSignature(deps.secret, raw, req.header(BILLING_SIGNATURE_HEADER))) {
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
