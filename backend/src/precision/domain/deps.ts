/**
 * Shared contract between the two DOMAIN owners (F5 phase 2). Do not change signatures without
 * telling the lead: DOMAIN-A (auth/session/entry/center/cover/config/events, Understanding, My Service Map, category conversations, Add a Service, router, createApp wiring) and
 * DOMAIN-B (CRP lifecycle, preview/payload builder, send, synthetic-project seed + route A–J, SQL guard tests) compile against this file.
 */
import type { Request, Router } from "express";
import type { Db } from "../../db/database";
import type { Logger } from "../../security/redact";
import type { PrecisionIntegrations } from "../ports/registry";
import type { EntitlementState } from "../ports/entitlement";
import type { OhDeliveryService } from "../delivery/oh-delivery-service";
import type { createManifestRegistry } from "../manifest";
import type { createConversationEngine } from "../conversation";
import type { Locale } from "../api/dto";

export interface PrecisionDomainDeps {
  db: Db;
  integrations: PrecisionIntegrations;
  delivery: OhDeliveryService;
  registry: ReturnType<typeof createManifestRegistry>;
  conversation: ReturnType<typeof createConversationEngine>;
  now: () => Date;
  log: Logger;
  /** Env-derived knobs; missing values degrade gracefully (link hidden), never throw. */
  internalKey?: string;
}

/** Set by DOMAIN-A's auth middleware on every authenticated request. */
export interface PrecisionRequestContext {
  projectId: string;
  entitlement: EntitlementState;
  locale: Locale;
}

declare module "express-serve-static-core" {
  interface Request {
    precision?: PrecisionRequestContext;
  }
}

export function requirePrecision(req: Request): PrecisionRequestContext {
  if (!req.precision) throw new Error("precision context missing: auth middleware not applied");
  return req.precision;
}

export type RouterFactory = (deps: PrecisionDomainDeps) => Router;
