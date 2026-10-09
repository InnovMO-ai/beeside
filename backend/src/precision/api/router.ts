/**
 * The Precision HTTP API (`/api/precision/*`). Returns a router whose paths are absolute (`/api/precision/...`) so that
 * DOMAIN-B's CRP/preview/send router, whose paths are absolute too, mounts beside it behind the same authentication.
 *
 * Request pipeline: request id -> JSON body (100 kB cap) -> [internal status | session exchange] -> Bearer session ->
 * entitlement (evaluated on EVERY request) -> locale -> access gating -> rate limits -> handler. Every failure becomes an
 * `ApiErrorDto` (stable code, localized sentence, `retryable`); nothing technical reaches the client.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { clientAddress, type RateLimiter, type RateLimitPolicy } from "../../security/rate-limit";
import { describeError } from "../../security/redact";
import { accessPermits } from "../ports/entitlement";
import { createCrpRouter } from "../domain/crp/router";
import type { Actor } from "../domain/center";
import { supportContact } from "../domain/config";
import { requirePrecision, type PrecisionDomainDeps } from "../domain/deps";
import type { PrecisionDomain } from "../domain";
import { DEFAULT_SESSION_TTL_MS, authenticateSession, exchangeLinkToken } from "../domain/tokens";
import type { ModelProvider } from "../conversation";
import { integrationStatus } from "../ports/registry";
import type { InternalStatusDto, Locale } from "./dto";
import { ApiError, classifyError, errorBody } from "./errors";

const policy = (name: string, limit: number, windowSeconds: number): RateLimitPolicy => ({ name, limit, windowSeconds });
export const PRECISION_RATE_LIMITS = {
  /** Link exchange per client address: guessing a 256-bit code is infeasible, flooding is not. */
  exchange: policy("precision_exchange_address", 30, 600),
  /** Any authenticated request, per client address. */
  address: policy("precision_address", 1200, 600),
  /** Conversation turns (each costs model calls), per project. */
  turns: policy("precision_turns_project", 90, 600),
} as const;

export const MAX_BODY = "100kb";
const LOCALES: readonly Locale[] = ["en", "es"];
const localeHeader = (req: Request): Locale | null => {
  const v = String(req.header("x-precision-locale") ?? "").toLowerCase().slice(0, 2);
  return (LOCALES as readonly string[]).includes(v) ? (v as Locale) : null;
};

export interface PrecisionRouterOptions {
  limiter?: RateLimiter;
  /** Described on the internal status page only. */
  modelProvider?: ModelProvider;
  env?: Record<string, string | undefined>;
}

export function createPrecisionRouter(deps: PrecisionDomainDeps, domain: PrecisionDomain, options: PrecisionRouterOptions = {}): Router {
  const env = options.env ?? process.env;
  const root = express.Router();
  const api = express.Router();

  const wrap =
    (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
    (req, res, next) => {
      fn(req, res).catch(next);
    };

  /** Middleware that either throws (-> error mapper) or lets the request continue. */
  const mw =
    (fn: (req: Request) => Promise<void>): RequestHandler =>
    (req, _res, next) => {
      fn(req).then(() => next(), next);
    };

  const limit = (p: RateLimitPolicy, subjectOf: (req: Request) => string | null): RequestHandler =>
    mw(async (req) => {
      if (!options.limiter) return;
      const subject = subjectOf(req);
      if (!subject) return;
      const d = await options.limiter.consume(p, subject);
      if (!d.allowed) throw new ApiError("RATE_LIMITED", true, { retryAfterSeconds: d.retryAfterSeconds });
    });

  // ---- pipeline start
  api.use((_req, res, next) => {
    if (!res.get("X-Request-Id")) res.set("X-Request-Id", randomUUID());
    next();
  });
  api.use(express.json({ limit: MAX_BODY, strict: true }));

  // ---- internal review status: guarded by a key, invisible (404) without it; not part of the client journey
  api.get(
    "/internal/status",
    wrap(async (req, res) => {
      const expected = deps.internalKey;
      const given = String(req.header("x-precision-internal-key") ?? "");
      const ok = !!expected && expected.length > 0 && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
      if (!ok) throw new ApiError("NOT_FOUND");
      const report = integrationStatus(deps.integrations);
      const integrations = [...report.integrations, ...(options.modelProvider ? [options.modelProvider.describe()] : [])].map((d) => ({
        port: d.port, implementation: d.implementation, mode: d.mode, verification: d.verification, ...(d.note ? { note: d.note } : {}),
      }));
      const project = await deps.registry.getProjectManifest();
      const cats = (await deps.db.query<{ category_key: string; version: string }>("SELECT category_key, version FROM category_manifest_version WHERE is_current ORDER BY category_key")).rows;
      const body: InternalStatusDto & { manifests: { project: string | null; categories: Record<string, string> } } = {
        integrations,
        dataset: env.PRECISION_DATASET === "CUSTOMER" ? "CUSTOMER" : "SYNTHETIC",
        build: { sha: env.BUILD_SHA ?? null, releaseLabel: env.PRECISION_RELEASE_LABEL ?? "Embassy RC" },
        manifests: { project: project?.version ?? null, categories: Object.fromEntries(cats.map((c) => [c.category_key, c.version])) },
      };
      res.json(body);
    }),
  );

  // ---- session exchange (public)
  api.post(
    "/session/exchange",
    limit(PRECISION_RATE_LIMITS.exchange, clientAddress),
    wrap(async (req, res) => {
      const locale = localeHeader(req) ?? "en";
      const code = (req.body as { code?: unknown } | undefined)?.code;
      const invalid = async (): Promise<never> => {
        const support = await supportContact(deps.db, locale);
        throw new ApiError("UNAUTHENTICATED", false, support ? { support } : {});
      };
      if (typeof code !== "string" || code.length < 16 || code.length > 200 || !/^[A-Za-z0-9_-]+$/.test(code)) return invalid();
      const issued = await exchangeLinkToken(deps.db, code, deps.now(), DEFAULT_SESSION_TTL_MS);
      if (!issued) return invalid();
      res.json({ sessionToken: issued.token, expiresAt: issued.expiresAt.toISOString() });
    }),
  );

  // ---- authenticated pipeline
  api.use(
    mw(async (req) => {
      const m = /^Bearer ([A-Za-z0-9_-]{16,200})$/.exec(req.header("authorization") ?? "");
      if (!m) throw new ApiError("UNAUTHENTICATED");
      const session = await authenticateSession(deps.db, m[1] as string, deps.now());
      if (!session) throw new ApiError("UNAUTHENTICATED");
      // Entitlement on every request; if it cannot be determined the request fails closed (retryable), never open.
      const entitlement = await deps.integrations.entitlement.get(session.projectId);
      const locale = localeHeader(req) ?? (await domain.fa.read(session.projectId))?.context.locale ?? "en";
      req.precision = { projectId: session.projectId, entitlement, locale };
      const mode = entitlement.accessMode;
      const path = req.path;
      if (mode === "REVOKED" && !(req.method === "GET" && path === "/entry")) throw new ApiError("PRECISION_REVOKED");
      if (mode === "READ_ONLY" && req.method !== "GET" && !(req.method === "POST" && (path === "/cover/seen" || path === "/help/contact"))) throw new ApiError("PRECISION_READ_ONLY");
    }),
  );
  api.use(limit(PRECISION_RATE_LIMITS.address, clientAddress));
  api.post(["/understanding/turns", "/add-service/turns", "/categories/:id/turns"], limit(PRECISION_RATE_LIMITS.turns, (req) => req.precision?.projectId ?? null));

  const actorOf = (req: Request): Actor => {
    const p = requirePrecision(req);
    return { projectId: p.projectId, locale: p.locale, entitlement: p.entitlement, canWrite: accessPermits(p.entitlement.accessMode, "write") };
  };
  const get = (path: string, fn: (a: Actor, req: Request) => Promise<unknown>): void => {
    api.get(path, wrap(async (req, res) => void res.json(await fn(actorOf(req), req))));
  };
  const post = (path: string, fn: (a: Actor, req: Request) => Promise<unknown>): void => {
    api.post(path, wrap(async (req, res) => void res.json(await fn(actorOf(req), req))));
  };
  const idOf = (req: Request): string => String(req.params.id ?? "");

  get("/entry", (a) => domain.center.entry(a));
  post("/cover/seen", (a) => domain.center.coverSeen(a));
  get("/center", (a) => domain.center.center(a));
  get("/help", (a) => domain.center.help(a));
  post("/help/contact", (a, req) => domain.center.contact(a, (req.body as { message?: unknown } | undefined)?.message));
  get("/understanding", (a) => domain.threads.understanding.get(a));
  post("/understanding/turns", (a, req) => domain.threads.understanding.turn(a, req.body));
  get("/service-map", (a) => domain.serviceMap.get(a));
  post("/service-map/confirm", (a, req) => domain.serviceMap.confirm(a, (req.body as { requestKey?: unknown } | undefined)?.requestKey as string));
  get("/add-service", (a) => domain.threads.addService.get(a));
  post("/add-service/turns", (a, req) => domain.threads.addService.turn(a, req.body));
  get("/categories/:id", (a, req) => domain.threads.category.get(a, idOf(req)));
  post("/categories/:id/turns", (a, req) => domain.threads.category.turn(a, idOf(req), req.body));

  root.use("/api/precision", api);
  // CRP / preview / send (DOMAIN-B): absolute paths, reached only after the pipeline above has authenticated the request
  root.use(createCrpRouter(deps));
  root.use("/api/precision", (_req, _res, next) => next(new ApiError("NOT_FOUND")));

  // ---- one error mapper for the whole surface
  root.use("/api/precision", (err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const apiErr = classifyError(err);
    if (!(err instanceof ApiError) && apiErr.code === "TEMPORARILY_UNAVAILABLE") {
      deps.log("error", "precision request failed", { requestId: String(res.get("X-Request-Id") ?? ""), method: req.method, path: req.path.slice(0, 120), error: describeError(err) });
    }
    if (apiErr.extra.retryAfterSeconds) res.set("Retry-After", String(apiErr.extra.retryAfterSeconds));
    const locale = req.precision?.locale ?? localeHeader(req) ?? "en";
    return void res.status(apiErr.status).json(errorBody(apiErr, locale));
  });
  return root;
}
