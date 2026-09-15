import { randomUUID } from "node:crypto";
import express, { NextFunction, Request, Response, Router } from "express";
import { createConfigVersioningRouter } from "../config-versioning/router";
import { ConfigVersioningService } from "../config-versioning/service";
import { FaError } from "../fa/services/errors";
import { resendPrivateLinkForProject } from "../fa/services/link-service";
import { FaDeps } from "../fa/services/repository";
import { AuditOutcome, recordAudit } from "../operations/audit";
import { cancelDelivery, dispatchEmails, retryDelivery } from "../operations/email-outbox";
import { isJobName, runJob } from "../operations/jobs";
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

/**
 * Admin/Supervisor Control Center API (Build Plan v1.1 Phase 10). Mounted only when the Admin API
 * is explicitly enabled with a configured identity provider and session secret. Every route below
 * /auth requires a valid Admin session; every route re-checks its permission server-side; every
 * sensitive read and every write (allowed, denied or failed) is audited. Customer tokens are never
 * accepted here, and Admin sessions are never accepted by the customer API.
 */
export function createAdminRouter(deps: AdminDeps): Router {
  const router = Router();
  const { db } = deps.fa;
  const now = () => deps.fa.config.now();

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
    const user = await provisionAdminUser(db, { email: b.email, role: b.role }, now());
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
