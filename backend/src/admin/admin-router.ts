import { randomUUID } from "node:crypto";
import express, { NextFunction, Request, Response, Router } from "express";
import { feedbackComments, feedbackMetrics, friction, funnel, isSegmented, journeyHealth, operationalMetrics, parseRange, parseSegment, segmentBreakdown } from "../analytics/metrics";
import { DELIVERY_STATUSES, listPrecisionDeliveries } from "./precision-deliveries";
import { MANAGED_LOCALES, configOverview, resetConfig, setConfig } from "./precision-config-admin";
import { METRIC_CATALOG, precisionAi, precisionCommercial, precisionFunnel, precisionQuality } from "../analytics/precision-metrics";
import { listIntegrationDeliveries, retryIntegrationDelivery } from "../integrations/relay";
import { RATE_LIMITS, RateLimiter, rateLimit } from "../security/rate-limit";
import { createConfigVersioningRouter } from "../config-versioning/router";
import { ConfigVersioningError, ConfigVersioningErrorCode, ConfigVersioningService } from "../config-versioning/service";
import { FaError } from "../fa/services/errors";
import { resendPrivateLinkForProject } from "../fa/services/link-service";
import { FaDeps } from "../fa/services/repository";
import { AuditOutcome, recordAudit } from "../operations/audit";
import { cancelDelivery, dispatchEmails, retryDelivery } from "../operations/email-outbox";
import { isJobName, runJob } from "../operations/jobs";
import {
  CompanyScope,
  GrantSource,
  PrivacyEventName,
  PrivacyReason,
  ProgramKind,
  SponsorKind,
  activateProgram,
  addEligibleCompany,
  closeProgram,
  createProgram,
  createSponsor,
  issueGrant,
  recordPrivacyEvent,
  redeemProgram,
  terminateGrant,
} from "../premium/entitlement-grants";
import { ErasurePlan, ErasureResult, approvePolicy, currentPolicy, erasureRuns, executeErasure, planErasure } from "../privacy/erasure";
import { isSubscriptionEventType, processSubscriptionEvent } from "../premium/subscription-events";
import {
  ADMIN_LOGIN_COOKIE,
  ADMIN_SESSION_COOKIE,
  AdminPrincipal,
  AdminSessionConfig,
  authorizeAdminLogin,
  cookieHeader,
  createAdminSession,
  openLoginState,
  parseCookies,
  resolveAdminSession,
  revokeAdminSession,
  safeReturnTo,
  sealLoginState,
} from "./admin-session";
import { listAdminUsers, provisionAdminUser, updateAdminUser } from "./admin-users";
import { listPrograms, listSponsors, programDetail, projectEntitlement } from "./entitlement-admin";
import { communicationsOverview, saveAndPublishTemplate } from "./communications-service";
import { AdminAuthError, AdminIdentityProvider, pkceChallenge, randomUrlToken } from "./oidc";
import {
  listAuditEvents,
  listEmailDeliveries,
  listJobRuns,
  projectAnswers,
  projectInternalAssessment,
  projectLifecycle,
  projectOverview,
  projectPremium,
  projectSnapshot,
  searchProjects,
} from "./project-service";
import { Permission, can, permissionsFor } from "./rbac";

export interface AdminDeps {
  fa: FaDeps;
  identity: AdminIdentityProvider;
  session: AdminSessionConfig;
  configService: ConfigVersioningService;
}

type AdminRequest = Request & { admin?: AdminPrincipal; requestId?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const API_PATH = "/api/admin";

const CONFIG_VERSIONING_HTTP_STATUS: Record<ConfigVersioningErrorCode, number> = {
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  GATE_REFUSED: 409,
  CONFLICT: 409,
  VALIDATION_FAILED: 422,
};

/**
 * Admin/Supervisor Control Center API (Build Plan v1.1 Phase 10). Mounted only when the Admin API
 * is explicitly enabled with a configured identity provider and session secret. Every route below
 * /auth requires a valid Admin session; every route re-checks its permission server-side; every
 * sensitive read and every write (allowed, denied or failed) is audited. Customer tokens are never
 * accepted here, and Admin sessions are never accepted by the customer API.
 */
export function createAdminRouter(deps: AdminDeps, security: { limiter?: RateLimiter } = {}): Router {
  const router = Router();
  const { db } = deps.fa;
  const now = () => deps.fa.config.now();
  // Sign-in attempts are limited per client address; authenticated traffic per session.
  router.use("/auth", rateLimit(security.limiter, RATE_LIMITS.adminAuthAddress));

  router.use((req: AdminRequest, res, next) => {
    req.requestId = randomUUID();
    res.set("Cache-Control", "no-store");
    res.set("X-Request-Id", req.requestId);
    next();
  });
  router.use(express.json({ limit: "2mb" }));

  const audit = (req: AdminRequest, action: string, outcome: AuditOutcome, extra: { targetType?: string; targetId?: string; projectId?: string | null; details?: Record<string, unknown> } = {}) =>
    recordAudit(db, {
      actor: req.admin ? { type: "ADMIN_USER", adminUserId: req.admin.adminUserId } : { type: "SYSTEM" },
      action,
      outcome,
      targetType: extra.targetType ?? null,
      targetId: extra.targetId ?? null,
      projectId: extra.projectId ?? null,
      requestId: req.requestId ?? null,
      details: extra.details,
      now: now(),
    });

  const sendError = (res: Response, error: unknown, next: NextFunction) => {
    if (error instanceof FaError) {
      res.status(error.status).json({ error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
    } else if (error instanceof ConfigVersioningError) {
      // Communications' write path (saveAndPublishTemplate) throws the same error type the generic
      // /config/* router already translates — mirrored here rather than imported so this route's
      // error mapping doesn't depend on that router's internal, unexported table.
      res.status(CONFIG_VERSIONING_HTTP_STATUS[error.code]).json({ error: error.code, message: error.message });
    } else {
      next(error);
    }
  };

  const loginRedirect = (res: Response, outcome: string) => res.redirect(302, `${deps.session.appOrigin}/admin?login=${outcome}`);

  // ------------------------------------------------------------------ authentication
  router.get("/auth/login", (req: AdminRequest, res, next) => {
    void (async () => {
      const state = randomUrlToken();
      const nonce = randomUrlToken();
      const verifier = randomUrlToken(48);
      const sealed = sealLoginState(deps.session.sessionSecret, { state, nonce, verifier, returnTo: safeReturnTo(req.query.returnTo), exp: now().getTime() + 10 * 60_000 });
      const url = await deps.identity.authorizationUrl({ state, nonce, codeChallenge: pkceChallenge(verifier) });
      res.set("Set-Cookie", cookieHeader(ADMIN_LOGIN_COOKIE, sealed, { secure: deps.session.cookieSecure, maxAgeSeconds: 600, path: `${API_PATH}/auth` }));
      res.redirect(302, url);
    })().catch((error: unknown) => {
      if (error instanceof AdminAuthError) loginRedirect(res, "unavailable");
      else next(error);
    });
  });

  router.get("/auth/callback", (req: AdminRequest, res, next) => {
    void (async () => {
      const clearLogin = cookieHeader(ADMIN_LOGIN_COOKIE, "", { secure: deps.session.cookieSecure, maxAgeSeconds: 0, path: `${API_PATH}/auth` });
      const cookies = parseCookies(req.header("cookie"));
      const pending = openLoginState(deps.session.sessionSecret, cookies[ADMIN_LOGIN_COOKIE], now());
      const code = typeof req.query.code === "string" ? req.query.code : null;
      if (!pending || typeof req.query.state !== "string" || req.query.state !== pending.state || !code) {
        res.set("Set-Cookie", clearLogin);
        await audit(req, "admin.login", "DENIED", { details: { reason: "invalid_login_state" } });
        loginRedirect(res, "failed");
        return;
      }
      let claimsReason = "unknown";
      try {
        const claims = await deps.identity.exchangeCode({ code, codeVerifier: pending.verifier, nonce: pending.nonce });
        const decision = await authorizeAdminLogin(db, claims, now());
        if (!decision.ok) {
          res.set("Set-Cookie", clearLogin);
          await recordAudit(db, {
            actor: { type: "SYSTEM" },
            action: "admin.login",
            outcome: "DENIED",
            targetType: decision.adminUserId ? "admin_user" : null,
            targetId: decision.adminUserId,
            requestId: req.requestId ?? null,
            details: { reason: decision.reason },
            now: now(),
          });
          loginRedirect(res, "denied");
          return;
        }
        const session = await createAdminSession(db, { adminUserId: decision.adminUserId, role: decision.role, issuer: claims.issuer, now: now(), config: deps.session });
        res.set("Set-Cookie", [
          clearLogin,
          cookieHeader(ADMIN_SESSION_COOKIE, session.token, { secure: deps.session.cookieSecure, maxAgeSeconds: deps.session.sessionTtlMinutes * 60, path: API_PATH }),
        ]);
        await recordAudit(db, {
          actor: { type: "ADMIN_USER", adminUserId: decision.adminUserId },
          action: "admin.login",
          outcome: "ALLOWED",
          targetType: "admin_session",
          targetId: session.sessionId,
          requestId: req.requestId ?? null,
          details: { role: decision.role },
          now: now(),
        });
        res.redirect(302, `${deps.session.appOrigin}${pending.returnTo}`);
      } catch (error) {
        if (!(error instanceof AdminAuthError)) throw error;
        claimsReason = error.reason;
        res.set("Set-Cookie", clearLogin);
        await audit(req, "admin.login", "DENIED", { details: { reason: claimsReason } });
        loginRedirect(res, "failed");
      }
    })().catch((error: unknown) => next(error));
  });

  // ------------------------------------------------------------------ session + CSRF
  router.use((req: AdminRequest, res, next) => {
    void (async () => {
      const token = parseCookies(req.header("cookie"))[ADMIN_SESSION_COOKIE];
      const principal = await resolveAdminSession(db, token, now(), deps.session);
      if (!principal) {
        res.status(401).json({ error: "UNAUTHENTICATED" });
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        const origin = req.header("origin");
        if (req.header("x-beeside-admin") !== "1" || (origin !== undefined && origin !== deps.session.appOrigin)) {
          req.admin = principal;
          await audit(req, "admin.csrf_rejected", "DENIED", { details: { method: req.method, path: req.path.slice(0, 120) } });
          res.status(403).json({ error: "CSRF_REJECTED" });
          return;
        }
      }
      req.admin = principal;
      next();
    })().catch((error: unknown) => next(error));
  });
  router.use(rateLimit(security.limiter, RATE_LIMITS.adminSession, (req) => (req as AdminRequest).admin?.sessionId ?? null));

  /** Permission gate: a denied attempt is audited and answered 403 before any work happens. */
  const allow =
    (permission: Permission, action: string) =>
    (req: AdminRequest, res: Response, next: NextFunction): void => {
      const principal = req.admin as AdminPrincipal;
      if (can(principal.role, permission)) {
        next();
        return;
      }
      void audit(req, action, "DENIED", { details: { permission, role: principal.role } })
        .then(() => res.status(403).json({ error: "FORBIDDEN", permission }))
        .catch((error: unknown) => next(error));
    };

  type Handler = (req: AdminRequest, res: Response) => Promise<void>;
  const handle = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
    fn(req as AdminRequest, res).catch((error: unknown) => sendError(res, error, next));
  };
  const projectId = (req: Request): string => {
    const id = req.params.projectId ?? "";
    if (!UUID.test(id)) throw new FaError("NOT_FOUND", "project not found");
    return id;
  };
  const body = (req: Request): Record<string, unknown> => (typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {});

  router.post("/auth/logout", handle(async (req, res) => {
    const principal = req.admin as AdminPrincipal;
    await revokeAdminSession(db, principal.sessionId, "logout", now());
    await audit(req, "admin.logout", "ALLOWED", { targetType: "admin_session", targetId: principal.sessionId });
    res.set("Set-Cookie", cookieHeader(ADMIN_SESSION_COOKIE, "", { secure: deps.session.cookieSecure, maxAgeSeconds: 0, path: API_PATH }));
    res.json({ signedOut: true });
  }));

  router.get("/me", handle(async (req, res) => {
    const principal = req.admin as AdminPrincipal;
    res.json({ email: principal.email, role: principal.role, permissions: permissionsFor(principal.role) });
  }));

  // ------------------------------------------------------------------ projects (read-only)
  router.get("/projects", allow("projects.read", "projects.searched"), handle(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const results = await searchProjects(db, q);
    // The query text itself may be personal data: only its length and the result count are audited.
    await audit(req, "projects.searched", "ALLOWED", { details: { query_length: q.trim().length, results: results.length } });
    res.json({ results });
  }));

  const section = (name: string, load: (id: string) => Promise<unknown>) =>
    handle(async (req, res) => {
      const id = projectId(req);
      const data = await load(id);
      await audit(req, "project.viewed", "ALLOWED", { targetType: "project", targetId: id, projectId: id, details: { section: name } });
      res.json(data);
    });

  router.get("/projects/:projectId", allow("projects.read", "project.viewed"), section("overview", (id) => projectOverview(db, deps.fa.bundles, id, now())));
  router.get("/projects/:projectId/answers", allow("projects.read", "project.viewed"), section("answers", (id) => projectAnswers(db, deps.fa.bundles, id)));
  router.get("/projects/:projectId/snapshot", allow("projects.read", "project.viewed"), section("snapshot", (id) => projectSnapshot(db, id)));
  router.get("/projects/:projectId/internal-assessment", allow("projects.read", "project.viewed"), section("internal_assessment", (id) => projectInternalAssessment(db, id)));
  router.get("/projects/:projectId/premium", allow("projects.read", "project.viewed"), section("premium", (id) => projectPremium(db, deps.fa.bundles, id)));
  router.get("/projects/:projectId/lifecycle", allow("projects.read", "project.viewed"), section("lifecycle", (id) => projectLifecycle(db, deps.fa.bundles, id, now())));

  // ------------------------------------------------------------------ project operations (ADMIN)
  router.post("/projects/:projectId/private-link", allow("operations.execute", "project.private_link_resent"), handle(async (req, res) => {
    const id = projectId(req);
    const enqueued = await db.transaction((tx) => resendPrivateLinkForProject(deps.fa, tx, id, now()));
    await dispatchEmails(deps.fa);
    await audit(req, "project.private_link_resent", enqueued ? "ALLOWED" : "FAILED", {
      targetType: "project",
      targetId: id,
      projectId: id,
      details: { result: enqueued ? "enqueued" : "not_enqueued" },
    });
    res.status(enqueued ? 202 : 409).json(enqueued ? { enqueued: true } : { error: "NOT_APPLICABLE", message: "a link was sent recently or the project is closed" });
  }));

  router.post("/projects/:projectId/premium/events", allow("premium.manage", "premium.subscription_event_recorded"), handle(async (req, res) => {
    const id = projectId(req);
    const b = body(req);
    const eventType = b.eventType;
    if (!isSubscriptionEventType(eventType)) throw new FaError("INVALID_INPUT", "unknown subscription event type", { fields: ["eventType"] });
    const date = (value: unknown, field: string): Date | null => {
      if (value === undefined || value === null || value === "") return null;
      const parsed = typeof value === "string" ? new Date(value) : new Date(NaN);
      if (Number.isNaN(parsed.getTime())) throw new FaError("INVALID_INPUT", `${field} must be a date`, { fields: [field] });
      return parsed;
    };
    const requestId = typeof b.requestId === "string" && UUID.test(b.requestId) ? b.requestId : null;
    const occurredAt = now();
    try {
      const result = await db.transaction((tx) =>
        processSubscriptionEvent(tx, deps.fa.bundles, {
          projectId: id,
          eventType,
          occurredAt,
          source: "admin_manual_confirmation",
          idempotencyKey: requestId ? `admin-request-${requestId}-${eventType}` : `admin-${randomUUID()}`,
          periodStart: date(b.periodStart, "periodStart"),
          periodEnd: date(b.periodEnd, "periodEnd"),
        }),
      );
      await audit(req, "premium.subscription_event_recorded", "ALLOWED", {
        targetType: "project",
        targetId: id,
        projectId: id,
        details: { event_type: eventType, subscription_status: result.subscriptionStatus, result: result.duplicate ? "duplicate" : "applied" },
      });
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch (error) {
      if (error instanceof FaError) {
        await audit(req, "premium.subscription_event_recorded", "FAILED", { targetType: "project", targetId: id, projectId: id, details: { event_type: eventType, reason: error.code } });
      }
      throw error;
    }
  }));

  // ------------------------------------------------------------------ entitlement (grants, programs, sponsors, privacy)
  // Authority is layered: the route permission is the first gate, the database guards (role of the approver, scope, window,
  // quota, eligibility) are the second and cannot be bypassed by any caller. Audit details carry codes and counts, never the
  // operator's free-text reason.
  const asUuid = (value: unknown, field: string): string => {
    if (typeof value !== "string" || !UUID.test(value)) throw new FaError("INVALID_INPUT", `${field} must be an id`, { fields: [field] });
    return value;
  };
  const asText = (value: unknown, field: string, max = 500): string => {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new FaError("INVALID_INPUT", `${field} is required`, { fields: [field] });
    return value.trim();
  };
  const asInt = (value: unknown, field: string, min: number, max: number): number => {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new FaError("INVALID_INPUT", `${field} must be a whole number between ${min} and ${max}`, { fields: [field] });
    return value;
  };
  const asDate = (value: unknown, field: string): Date => {
    const parsed = typeof value === "string" ? new Date(value) : new Date(NaN);
    if (Number.isNaN(parsed.getTime())) throw new FaError("INVALID_INPUT", `${field} must be a date`, { fields: [field] });
    return parsed;
  };
  const oneOf = <T extends string>(value: unknown, allowed: readonly T[], field: string): T => {
    if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) throw new FaError("INVALID_INPUT", `${field} is not valid`, { fields: [field] });
    return value as T;
  };
  const optionalRequestKey = (b: Record<string, unknown>, prefix: string): string | undefined =>
    typeof b.requestId === "string" && UUID.test(b.requestId) ? `${prefix}-${b.requestId}` : undefined;
  const adminId = (req: AdminRequest): string => (req.admin as AdminPrincipal).adminUserId;
  const actorOf = (req: AdminRequest): string => `admin:${adminId(req)}`;

  /** A write that is audited whether it succeeds or is refused. `fn` returns the HTTP status, the body and audit details. */
  const mutation = (
    action: string,
    target: (req: AdminRequest) => { targetType: string; targetId: string; projectId?: string | null },
    fn: (req: AdminRequest) => Promise<{ status: number; body: unknown; details?: Record<string, unknown>; projectId?: string | null }>,
  ) =>
    handle(async (req, res) => {
      const t = target(req);
      try {
        const out = await fn(req);
        await audit(req, action, "ALLOWED", { targetType: t.targetType, targetId: t.targetId, projectId: out.projectId ?? t.projectId ?? null, details: out.details });
        res.status(out.status).json(out.body);
      } catch (error) {
        if (error instanceof FaError) await audit(req, action, "FAILED", { targetType: t.targetType, targetId: t.targetId, projectId: t.projectId ?? null, details: { reason: error.code } });
        throw error;
      }
    });

  const DIRECT_SOURCES = ["complimentary", "manual"] as const satisfies readonly GrantSource[];
  const DAY_MS = 86_400_000;

  router.get("/projects/:projectId/entitlement", allow("projects.read", "project.viewed"), section("entitlement", (id) => projectEntitlement(db, id, now())));

  // An individual exception for one project (ADMIN). Programs and sponsorship go through /entitlement/programs.
  router.post(
    "/projects/:projectId/entitlement/grants",
    allow("entitlement.manage", "entitlement.grant_issued"),
    mutation("entitlement.grant_issued", (req) => ({ targetType: "project", targetId: projectId(req), projectId: projectId(req) }), async (req) => {
      const id = projectId(req);
      const b = body(req);
      const source = oneOf(b.source, DIRECT_SOURCES, "source");
      const days = asInt(b.days, "days", 1, 3650);
      const startsAt = b.startsAt === undefined ? now() : asDate(b.startsAt, "startsAt");
      const grant = await issueGrant(db, {
        scope: { projectId: id },
        source,
        startsAt,
        endsAt: new Date(startsAt.getTime() + days * DAY_MS),
        reason: asText(b.reason, "reason"),
        approvedBy: adminId(req),
        actor: actorOf(req),
        ...(optionalRequestKey(b, "admin-grant") ? { idempotencyKey: optionalRequestKey(b, "admin-grant") as string } : {}),
        now: now(),
      });
      return { status: 201, body: { grant }, details: { source, days, grant_id: grant.grant_id } };
    }),
  );

  // A company-level grant needs an explicit scope and is an elevated decision (SUPER_ADMIN): never unlimited by default.
  router.post(
    "/companies/:companyId/entitlement/grants",
    allow("entitlement.programs.manage", "entitlement.company_grant_issued"),
    mutation("entitlement.company_grant_issued", (req) => ({ targetType: "company", targetId: String(req.params.companyId ?? "") }), async (req) => {
      const companyId = asUuid(req.params.companyId, "companyId");
      const b = body(req);
      const source = oneOf(b.source, ["complimentary", "manual", "partner"] as const satisfies readonly GrantSource[], "source");
      const companyScope = oneOf(b.companyScope, ["current_projects", "projects_created_in_period"] as const satisfies readonly CompanyScope[], "companyScope");
      const days = asInt(b.days, "days", 1, 3650);
      const startsAt = b.startsAt === undefined ? now() : asDate(b.startsAt, "startsAt");
      const maxProjects = b.maxProjects === undefined ? undefined : asInt(b.maxProjects, "maxProjects", 1, 10_000);
      const grant = await issueGrant(db, {
        scope: { companyId, companyScope, ...(maxProjects ? { maxProjects } : {}) },
        source,
        startsAt,
        endsAt: new Date(startsAt.getTime() + days * DAY_MS),
        reason: asText(b.reason, "reason"),
        approvedBy: adminId(req),
        actor: actorOf(req),
        ...(optionalRequestKey(b, "admin-company-grant") ? { idempotencyKey: optionalRequestKey(b, "admin-company-grant") as string } : {}),
        now: now(),
      });
      return { status: 201, body: { grant }, details: { source, days, company_scope: companyScope, max_projects: maxProjects ?? null, grant_id: grant.grant_id } };
    }),
  );

  // Extending = a chained grant that starts exactly when the previous one ends (nothing is rewritten; the history stays whole).
  router.post(
    "/entitlement/grants/:grantId/extend",
    allow("entitlement.manage", "entitlement.grant_extended"),
    mutation("entitlement.grant_extended", (req) => ({ targetType: "entitlement_grant", targetId: String(req.params.grantId ?? "") }), async (req) => {
      const grantId = asUuid(req.params.grantId, "grantId");
      const b = body(req);
      const days = asInt(b.days, "days", 1, 3650);
      const { rows } = await db.query<{ project_id: string | null; company_id: string | null; company_scope: CompanyScope | null; max_projects: number | null; source: GrantSource; ends_at: Date; program_id: string | null; terminated_at: Date | null }>(
        "SELECT project_id, company_id, company_scope, max_projects, source, ends_at, program_id, terminated_at FROM entitlement_grant WHERE grant_id = $1",
        [grantId],
      );
      const g = rows[0];
      if (!g) throw new FaError("NOT_FOUND", "grant not found");
      if (g.terminated_at) throw new FaError("NOT_APPLICABLE", "a terminated grant cannot be extended");
      if (g.program_id) throw new FaError("NOT_APPLICABLE", "a program grant follows its program terms; issue a direct exception instead");
      const source = oneOf(g.source, ["complimentary", "manual", "partner"] as const satisfies readonly GrantSource[], "source");
      const startsAt = g.ends_at;
      const grant = await issueGrant(db, {
        scope: g.project_id ? { projectId: g.project_id } : { companyId: g.company_id as string, companyScope: g.company_scope as CompanyScope, ...(g.max_projects ? { maxProjects: g.max_projects } : {}) },
        source,
        startsAt,
        endsAt: new Date(startsAt.getTime() + days * DAY_MS),
        reason: asText(b.reason, "reason"),
        approvedBy: adminId(req),
        actor: actorOf(req),
        extendsGrantId: grantId,
        ...(optionalRequestKey(b, "admin-extend") ? { idempotencyKey: optionalRequestKey(b, "admin-extend") as string } : {}),
        now: now(),
      });
      return { status: 201, body: { grant }, details: { days, extends_grant_id: grantId, grant_id: grant.grant_id }, projectId: g.project_id };
    }),
  );

  router.post(
    "/entitlement/grants/:grantId/terminate",
    allow("entitlement.manage", "entitlement.grant_terminated"),
    mutation("entitlement.grant_terminated", (req) => ({ targetType: "entitlement_grant", targetId: String(req.params.grantId ?? "") }), async (req) => {
      const grantId = asUuid(req.params.grantId, "grantId");
      const grant = await terminateGrant(db, { grantId, terminatedBy: adminId(req), reason: asText(body(req).reason, "reason"), now: now() });
      return { status: 200, body: { grant }, details: { grant_id: grantId }, projectId: grant.project_id };
    }),
  );

  // ---- sponsors and programs (SUPER_ADMIN to change; any admin role may read)
  router.get("/entitlement/sponsors", allow("projects.read", "entitlement.sponsors_listed"), handle(async (_req, res) => {
    res.json({ sponsors: await listSponsors(db) });
  }));
  router.post(
    "/entitlement/sponsors",
    allow("entitlement.programs.manage", "entitlement.sponsor_created"),
    mutation("entitlement.sponsor_created", () => ({ targetType: "sponsor", targetId: "new" }), async (req) => {
      const b = body(req);
      const kind = oneOf(b.kind, ["government", "agency", "chamber", "accelerator", "corporate", "other"] as const satisfies readonly SponsorKind[], "kind");
      const sponsor = await createSponsor(db, {
        name: asText(b.name, "name", 200),
        kind,
        ...(typeof b.country === "string" && b.country ? { country: b.country.toUpperCase() } : {}),
        createdBy: adminId(req),
      });
      return { status: 201, body: { sponsor }, details: { sponsor_id: sponsor.sponsor_id, kind } };
    }),
  );

  router.get("/entitlement/programs", allow("projects.read", "entitlement.programs_listed"), handle(async (_req, res) => {
    res.json({ programs: await listPrograms(db) });
  }));
  router.get("/entitlement/programs/:programId", allow("projects.read", "entitlement.programs_listed"), handle(async (req, res) => {
    res.json(await programDetail(db, asUuid(req.params.programId, "programId")));
  }));
  router.post(
    "/entitlement/programs",
    allow("entitlement.programs.manage", "entitlement.program_created"),
    mutation("entitlement.program_created", () => ({ targetType: "entitlement_program", targetId: "new" }), async (req) => {
      const b = body(req);
      const kind = oneOf(b.kind, ["promotion", "trial", "partner", "sponsored"] as const satisfies readonly ProgramKind[], "kind");
      const markets = Array.isArray(b.marketScope) ? b.marketScope.filter((m): m is string => typeof m === "string").map((m) => m.toUpperCase()) : undefined;
      const program = await createProgram(db, {
        code: asText(b.code, "code", 41),
        name: asText(b.name, "name", 200),
        kind,
        ...(b.sponsorId !== undefined ? { sponsorId: asUuid(b.sponsorId, "sponsorId") } : {}),
        ...(typeof b.agreementRef === "string" && b.agreementRef ? { agreementRef: b.agreementRef.slice(0, 200) } : {}),
        ...(markets && markets.length > 0 ? { marketScope: markets } : {}),
        grantDays: asInt(b.grantDays, "grantDays", 1, 3650),
        startsAt: asDate(b.startsAt, "startsAt"),
        endsAt: asDate(b.endsAt, "endsAt"),
        ...(b.maxRedemptions !== undefined ? { maxRedemptions: asInt(b.maxRedemptions, "maxRedemptions", 1, 1_000_000) } : {}),
        eligibility: b.eligibility === undefined ? "open" : oneOf(b.eligibility, ["open", "listed"] as const, "eligibility"),
        reason: asText(b.reason, "reason"),
        createdBy: adminId(req),
      });
      return { status: 201, body: { program }, details: { program_id: program.program_id, kind, grant_days: program.grant_days } };
    }),
  );
  router.post(
    "/entitlement/programs/:programId/eligibility",
    allow("entitlement.programs.manage", "entitlement.program_eligibility_added"),
    mutation("entitlement.program_eligibility_added", (req) => ({ targetType: "entitlement_program", targetId: String(req.params.programId ?? "") }), async (req) => {
      const programId = asUuid(req.params.programId, "programId");
      const companyId = asUuid(body(req).companyId, "companyId");
      await addEligibleCompany(db, { programId, companyId, createdBy: adminId(req) });
      return { status: 201, body: { programId, companyId }, details: { program_id: programId } };
    }),
  );
  router.post(
    "/entitlement/programs/:programId/activate",
    allow("entitlement.programs.manage", "entitlement.program_activated"),
    mutation("entitlement.program_activated", (req) => ({ targetType: "entitlement_program", targetId: String(req.params.programId ?? "") }), async (req) => {
      const program = await activateProgram(db, asUuid(req.params.programId, "programId"), adminId(req));
      return { status: 200, body: { program }, details: { program_id: program.program_id, kind: program.kind } };
    }),
  );
  router.post(
    "/entitlement/programs/:programId/close",
    allow("entitlement.programs.manage", "entitlement.program_closed"),
    mutation("entitlement.program_closed", (req) => ({ targetType: "entitlement_program", targetId: String(req.params.programId ?? "") }), async (req) => {
      const program = await closeProgram(db, asUuid(req.params.programId, "programId"), now());
      return { status: 200, body: { program }, details: { program_id: program.program_id } };
    }),
  );
  // Redeeming applies the program's own rule to one project (window, market, quota, eligibility): the operator does not choose terms.
  router.post(
    "/entitlement/programs/:programId/redeem",
    allow("entitlement.manage", "entitlement.program_redeemed"),
    mutation("entitlement.program_redeemed", (req) => ({ targetType: "entitlement_program", targetId: String(req.params.programId ?? "") }), async (req) => {
      const programId = asUuid(req.params.programId, "programId");
      const b = body(req);
      const id = asUuid(b.projectId, "projectId");
      const grant = await redeemProgram(db, {
        programId,
        projectId: id,
        ...(typeof b.market === "string" && b.market ? { market: b.market } : {}),
        now: now(),
        actor: actorOf(req),
      });
      return { status: 201, body: { grant }, details: { program_id: programId, grant_id: grant.grant_id }, projectId: id };
    }),
  );

  // ---- privacy / data lifecycle: overrides any commercial entitlement (the legal rules themselves live with Privacy)
  router.post(
    "/projects/:projectId/privacy",
    allow("privacy.manage", "privacy.event_recorded"),
    mutation("privacy.event_recorded", (req) => ({ targetType: "project", targetId: projectId(req), projectId: projectId(req) }), async (req) => {
      const id = projectId(req);
      const b = body(req);
      if (b.event === "anonymized") throw new FaError("INVALID_INPUT", "anonymization is executed through /privacy/erasure, never recorded by hand", { fields: ["event"] });
      const event = oneOf(b.event, ["access_blocked", "access_restored"] as const satisfies readonly PrivacyEventName[], "event");
      const reasonCode = oneOf(b.reasonCode, ["erasure_request", "legal_order", "contract_closure", "security_action", "other"] as const satisfies readonly PrivacyReason[], "reasonCode");
      await recordPrivacyEvent(db, { projectId: id, event, reasonCode, actor: actorOf(req) });
      return { status: 201, body: { projectId: id, event, reasonCode }, details: { event, reason_code: reasonCode } };
    }),
  );

  // ---- privacy erasure: SUPER_ADMIN only. The policy gate, the window and the registry are enforced by the database; these routes
  // only ask, show the dry run and record who confirmed. Nothing here is scheduled.
  router.get(
    "/privacy/policy",
    allow("privacy.manage", "privacy.policy_viewed"),
    handle(async (req, res) => {
      const policy = await currentPolicy(db);
      await audit(req, "privacy.policy_viewed", "ALLOWED", { targetType: "privacy_policy", targetId: policy?.policy_id ?? "none" });
      res.json({ policy });
    }),
  );
  router.post(
    "/privacy/policy",
    allow("privacy.manage", "privacy.policy_approved"),
    mutation("privacy.policy_approved", () => ({ targetType: "privacy_policy", targetId: "new" }), async (req) => {
      const b = body(req);
      if (typeof b.retainLegalAcceptance !== "boolean") throw new FaError("INVALID_INPUT", "retainLegalAcceptance must be true or false", { fields: ["retainLegalAcceptance"] });
      const policy = await approvePolicy(db, {
        minDaysAfterBlock: asInt(b.minDaysAfterBlock, "minDaysAfterBlock", 0, 3650),
        retainLegalAcceptance: b.retainLegalAcceptance,
        approvedBy: adminId(req),
        now: now(),
      });
      return { status: 201, body: { policy }, details: { days: policy.min_days_after_block, result: policy.retain_legal_acceptance ? "legal_acceptance_kept" : "legal_acceptance_erased" } };
    }),
  );
  router.get(
    "/projects/:projectId/privacy/erasure",
    allow("privacy.manage", "privacy.erasure_planned"),
    handle(async (req, res) => {
      const id = projectId(req);
      const plan = await planErasure(db, id, actorOf(req as AdminRequest), now());
      const runs = await erasureRuns(db, id);
      await audit(req as AdminRequest, "privacy.erasure_planned", "ALLOWED", { targetType: "project", targetId: id, projectId: id, details: { result: plan.eligible ? "eligible" : (plan.reason ?? "refused") } });
      res.json({ plan, runs });
    }),
  );
  router.post(
    "/projects/:projectId/privacy/erasure",
    allow("privacy.manage", "privacy.erasure_executed"),
    mutation("privacy.erasure_executed", (req) => ({ targetType: "project", targetId: projectId(req), projectId: projectId(req) }), async (req) => {
      const id = projectId(req);
      // The operator types the project id back: an irreversible action is never one click or one stray request.
      if (body(req).confirmProjectId !== id) throw new FaError("INVALID_INPUT", "confirmProjectId must repeat the project id", { fields: ["confirmProjectId"] });
      const result = await executeErasure(db, id, actorOf(req), now());
      const executed = "executed" in result && result.executed;
      return {
        status: executed ? 200 : 409,
        body: { result },
        details: executed
          ? { result: "executed", deleted_rows: (result as ErasureResult).deleted_rows, person_anonymized: (result as ErasureResult).person_anonymized, company_anonymized: (result as ErasureResult).company_anonymized }
          : { result: (result as ErasurePlan).reason ?? "refused" },
        projectId: id,
      };
    }),
  );

  // ------------------------------------------------------------------ Precision deliveries to Operation Hub (read-only)
  router.get(
    "/precision/deliveries",
    allow("operations.read", "precision_deliveries.viewed"),
    handle(async (req, res) => {
      const status = typeof req.query.status === "string" && req.query.status ? oneOf(req.query.status, DELIVERY_STATUSES, "status") : null;
      const out = await listPrecisionDeliveries(db, status);
      await audit(req, "precision_deliveries.viewed", "ALLOWED", { details: { count: out.deliveries.length } });
      res.json(out);
    }),
  );

  // ------------------------------------------------------------------ Precision links and routes (Admin-managed)
  // Effective value + source per audience, versioned writes, reset to the layer below. Audit keeps key/locale/version, never the value or reason text.
  router.get(
    "/precision/config",
    allow("config.read", "precision_config.viewed"),
    handle(async (req, res) => {
      const entries = await configOverview(db, process.env);
      await audit(req, "precision_config.viewed", "ALLOWED", { details: { count: entries.length } });
      res.json({ entries, locales: MANAGED_LOCALES });
    }),
  );
  router.put(
    "/precision/config/:key",
    allow("config.write", "precision_config.set"),
    mutation("precision_config.set", (req) => ({ targetType: "precision_config", targetId: `${req.params.key}:${String(body(req).locale ?? "")}` }), async (req) => {
      const b = body(req);
      const out = await setConfig(db, { key: req.params.key ?? "", locale: b.locale, value: b.value, reason: b.reason, now: now() });
      return { status: 200, body: out, details: { version: out.version, result: "set" } };
    }),
  );
  router.delete(
    "/precision/config/:key",
    allow("config.write", "precision_config.reset"),
    mutation("precision_config.reset", (req) => ({ targetType: "precision_config", targetId: `${req.params.key}:${String(req.query.locale ?? "")}` }), async (req) => {
      const out = await resetConfig(db, { key: req.params.key ?? "", locale: req.query.locale });
      return { status: 200, body: out, details: { result: out.reset ? "reset" : "nothing_to_reset" } };
    }),
  );

  // ------------------------------------------------------------------ versioned configuration
  const configPermission = (req: Request): Permission => {
    if (req.method === "GET") return "config.read";
    return /\/(reviews|publish|set-current)$/.test(req.path) ? "config.publish" : "config.write";
  };
  router.use("/config", (req: AdminRequest, res, next) => {
    const permission = configPermission(req);
    const action = req.method === "GET" ? "config.viewed" : `config.${(/\/([a-z-]+)$/.exec(req.path)?.[1] ?? "change").replace(/-/g, "_")}`;
    if (!can((req.admin as AdminPrincipal).role, permission)) {
      void audit(req, action, "DENIED", { details: { permission, role: (req.admin as AdminPrincipal).role } })
        .then(() => res.status(403).json({ error: "FORBIDDEN", permission }))
        .catch((error: unknown) => next(error));
      return;
    }
    if (req.method !== "GET") {
      const registry = /^\/([a-z-]+)\//.exec(req.path)?.[1] ?? null;
      const version = /\/versions\/([^/]+)/.exec(req.path)?.[1] ?? (typeof body(req).version === "string" ? (body(req).version as string) : null);
      // The audit row is written before the response leaves (every configuration response is JSON).
      const sendJson = res.json.bind(res);
      res.json = ((payload: unknown) => {
        audit(req, action, res.statusCode < 400 ? "ALLOWED" : "FAILED", {
          targetType: "config_version",
          targetId: version ? `${registry}:${version}` : (registry ?? undefined),
          details: { registry, version, status: res.statusCode, decision: typeof body(req).decision === "string" ? body(req).decision : null, diff_reviewed: body(req).diffReviewed === true },
        })
          .catch(() => undefined)
          .finally(() => sendJson(payload));
        return res;
      }) as typeof res.json;
    }
    next();
  });
  router.use(
    createConfigVersioningRouter({
      service: deps.configService,
      resolveAdminActor: async (req) => (req as AdminRequest).admin?.adminUserId ?? null,
    }),
  );

  // ------------------------------------------------------------------ operations
  router.get("/operations/email-deliveries", allow("operations.read", "operations.viewed"), handle(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : null;
    res.json({ deliveries: await listEmailDeliveries(db, status) });
  }));

  const deliveryAction = (kind: "retry" | "cancel") =>
    handle(async (req, res) => {
      const id = req.params.deliveryId ?? "";
      if (!UUID.test(id)) throw new FaError("NOT_FOUND", "delivery not found");
      const ok = await db.transaction((tx) => (kind === "retry" ? retryDelivery(tx, id, now()) : cancelDelivery(tx, id, `cancelled by admin`, now())));
      await audit(req, `email_delivery.${kind}`, ok ? "ALLOWED" : "FAILED", { targetType: "email_delivery", targetId: id, details: { delivery_id: id } });
      if (!ok) throw new FaError("NOT_APPLICABLE", `this delivery cannot be ${kind === "retry" ? "retried" : "cancelled"}`);
      if (kind === "retry") await dispatchEmails(deps.fa);
      res.json({ [kind === "retry" ? "retried" : "cancelled"]: true });
    });
  router.post("/operations/email-deliveries/:deliveryId/retry", allow("operations.execute", "email_delivery.retry"), deliveryAction("retry"));
  router.post("/operations/email-deliveries/:deliveryId/cancel", allow("operations.execute", "email_delivery.cancel"), deliveryAction("cancel"));

  router.get("/operations/jobs", allow("operations.read", "operations.viewed"), handle(async (_req, res) => {
    res.json({ runs: await listJobRuns(db) });
  }));

  router.post("/operations/jobs/:job/run", allow("operations.execute", "job.run_requested"), handle(async (req, res) => {
    const job = req.params.job;
    if (!isJobName(job)) throw new FaError("NOT_FOUND", "unknown job");
    const principal = req.admin as AdminPrincipal;
    const result = await runJob(deps.fa, job, { trigger: "admin", adminUserId: principal.adminUserId });
    await audit(req, "job.run_requested", result.status === "FAILED" ? "FAILED" : "ALLOWED", {
      targetType: "job",
      targetId: job,
      details: { job, status: result.status, stats: result.status === "SUCCEEDED" ? result.stats : null },
    });
    res.status(result.status === "SKIPPED" ? 409 : 200).json(result);
  }));

  router.get("/operations/integration-deliveries", allow("operations.read", "operations.viewed"), handle(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const destination = typeof req.query.destination === "string" ? req.query.destination : null;
    res.json({ deliveries: await listIntegrationDeliveries(db, { status, destination }) });
  }));

  router.post("/operations/integration-deliveries/:deliveryId/retry", allow("operations.execute", "integration_delivery.retry"), handle(async (req, res) => {
    const id = req.params.deliveryId ?? "";
    if (!UUID.test(id)) throw new FaError("NOT_FOUND", "delivery not found");
    const ok = await db.transaction((tx) => retryIntegrationDelivery(tx, id, now()));
    await audit(req, "integration_delivery.retry", ok ? "ALLOWED" : "FAILED", { targetType: "integration_delivery", targetId: id });
    if (!ok) throw new FaError("NOT_APPLICABLE", "this delivery cannot be retried");
    res.json({ retried: true });
  }));

  // ------------------------------------------------------------------ communications
  // Governed template management for email content, not a general-purpose CMS: every template lives
  // inside the versioned question-bank/snapshot-template bundles, and the write route below is a
  // scoped surface onto the SAME draft/preview/review/publish flow Configuration uses generically —
  // it can only ever change a template's copy/active flag, never questions, scoring, canonical field
  // definitions or branching (see communications-service.ts for exactly how that's enforced).
  router.get("/communications/templates", allow("operations.read", "communications.viewed"), handle(async (req, res) => {
    const overview = await communicationsOverview(db, deps.fa.bundles, deps.configService);
    await audit(req, "communications.viewed", "ALLOWED", { details: { question_bank_version: overview.questionBankVersion, snapshot_template_version: overview.snapshotTemplateVersion, count: overview.templates.length } });
    res.json(overview);
  }));

  // ADMIN only (Supervisor stays read-only, matching the rest of Configuration): saves and
  // immediately publishes a new bundle version carrying just this one template's edit. Every
  // governed step (draft, preview, content review, publish) still runs — see saveAndPublishTemplate.
  router.put("/communications/templates/:source/:key", allow("config.write", "communications.updated"), handle(async (req, res) => {
    const source = req.params.source;
    if (source !== "question_bank" && source !== "snapshot_template") throw new FaError("NOT_FOUND", "unknown template source");
    const key = req.params.key ?? "";
    const principal = req.admin as AdminPrincipal;
    const requestBody = body(req);
    const result = await saveAndPublishTemplate(db, deps.fa.bundles, deps.configService, principal.adminUserId, source, key, {
      locale: requestBody.locale as "en" | "es",
      subject: requestBody.subject as string,
      body: requestBody.body as string,
      cta: requestBody.cta as string,
      secondaryCta: typeof requestBody.secondaryCta === "string" ? requestBody.secondaryCta : undefined,
      active: typeof requestBody.active === "boolean" ? requestBody.active : undefined,
    });
    await audit(req, "communications.updated", "ALLOWED", { targetType: "email_template", targetId: `${source}:${key}`, details: { version: result.version, locale: requestBody.locale } });
    res.json(result);
  }));

  // ------------------------------------------------------------------ analytics (read-only, both roles)
  // Aggregates only: journey events, the anonymous segmentation profile and operational tables.
  // No answer content, name, email or company reaches these responses, and small segments are
  // suppressed instead of shown.
  const analyticsView = (view: string, load: (req: AdminRequest) => Promise<unknown>) =>
    handle(async (req, res) => {
      const range = parseRange(req.query as Record<string, unknown>, now());
      const data = await load(req);
      await audit(req, "analytics.viewed", "ALLOWED", {
        details: { view, from: range.from.toISOString(), to: range.to.toISOString(), segmented: isSegmented(parseSegment(req.query as Record<string, unknown>)) },
      });
      res.json(data);
    });
  const rangeOf = (req: AdminRequest) => parseRange(req.query as Record<string, unknown>, now());
  const segmentOf = (req: AdminRequest) => parseSegment(req.query as Record<string, unknown>);

  router.get("/analytics/funnel", allow("analytics.read", "analytics.viewed"), analyticsView("funnel", (req) => funnel(db, rangeOf(req), segmentOf(req))));
  router.get("/analytics/journey-health", allow("analytics.read", "analytics.viewed"), analyticsView("journey_health", (req) => journeyHealth(db, rangeOf(req), segmentOf(req), now())));
  router.get("/analytics/friction", allow("analytics.read", "analytics.viewed"), analyticsView("friction", (req) => friction(db, rangeOf(req), segmentOf(req), now())));
  router.get("/analytics/feedback", allow("analytics.read", "analytics.viewed"), analyticsView("feedback", (req) => feedbackMetrics(db, rangeOf(req), segmentOf(req))));
  router.get("/analytics/segments", allow("analytics.read", "analytics.viewed"), analyticsView("segments", (req) => segmentBreakdown(db, rangeOf(req))));
  router.get("/analytics/operations", allow("analytics.read", "analytics.viewed"), analyticsView("operations", (req) => operationalMetrics(db, rangeOf(req), now())));

  // Precision V1.0 metrics: the canonical catalog and the four families, computed from the same analytics_v1_* views Tableau reads.
  router.get("/analytics/precision/catalog", allow("analytics.read", "analytics.viewed"), analyticsView("precision_catalog", async () => ({ metrics: METRIC_CATALOG })));
  router.get("/analytics/precision/funnel", allow("analytics.read", "analytics.viewed"), analyticsView("precision_funnel", (req) => precisionFunnel(db, rangeOf(req))));
  router.get("/analytics/precision/quality", allow("analytics.read", "analytics.viewed"), analyticsView("precision_quality", (req) => precisionQuality(db, rangeOf(req))));
  router.get("/analytics/precision/ai", allow("analytics.read", "analytics.viewed"), analyticsView("precision_ai", (req) => precisionAi(db, rangeOf(req))));
  router.get("/analytics/precision/commercial", allow("analytics.read", "analytics.viewed"), analyticsView("precision_commercial", (req) => precisionCommercial(db, rangeOf(req))));

  // The optional comments are client content, not analytics: reading them is audited on its own.
  router.get("/analytics/feedback/comments", allow("analytics.read", "analytics.feedback_comments_viewed"), handle(async (req, res) => {
    const range = parseRange(req.query as Record<string, unknown>, now());
    const comments = await feedbackComments(db, range);
    await audit(req, "analytics.feedback_comments_viewed", "ALLOWED", { details: { count: comments.length, from: range.from.toISOString(), to: range.to.toISOString() } });
    res.json({ comments });
  }));

  // ------------------------------------------------------------------ audit + admin users (ADMIN)
  router.get("/audit", allow("audit.read", "audit.viewed"), handle(async (req, res) => {
    const filterProject = typeof req.query.projectId === "string" && UUID.test(req.query.projectId) ? req.query.projectId : null;
    res.json({ events: await listAuditEvents(db, filterProject) });
  }));

  router.get("/admin-users", allow("admin_users.manage", "admin_users.viewed"), handle(async (_req, res) => {
    res.json({ users: await listAdminUsers(db) });
  }));

  router.post("/admin-users", allow("admin_users.manage", "admin_user.provisioned"), handle(async (req, res) => {
    const b = body(req);
    const user = await provisionAdminUser(db, { email: b.email, role: b.role }, now(), (req.admin as AdminPrincipal).role);
    await audit(req, "admin_user.provisioned", "ALLOWED", { targetType: "admin_user", targetId: user.adminUserId, details: { role: user.role } });
    res.status(201).json(user);
  }));

  router.patch("/admin-users/:adminUserId", allow("admin_users.manage", "admin_user.updated"), handle(async (req, res) => {
    const principal = req.admin as AdminPrincipal;
    const id = req.params.adminUserId ?? "";
    if (!UUID.test(id)) throw new FaError("NOT_FOUND", "admin user not found");
    const b = body(req);
    try {
      const { user, before, sessionsRevoked } = await db.transaction((tx) => updateAdminUser(tx, principal.adminUserId, id, { role: b.role, active: b.active }, now()));
      await audit(req, "admin_user.updated", "ALLOWED", {
        targetType: "admin_user",
        targetId: id,
        details: { from_role: before.role, to_role: user.role, active: user.active, count: sessionsRevoked },
      });
      res.json(user);
    } catch (error) {
      if (error instanceof FaError) await audit(req, "admin_user.updated", "FAILED", { targetType: "admin_user", targetId: id, details: { reason: error.code } });
      throw error;
    }
  }));

  // Anything else under /api/admin (including any attempt to edit answers or historical records) does not exist.
  router.use((_req, res) => {
    res.status(404).json({ error: "NOT_FOUND" });
  });
  return router;
}
