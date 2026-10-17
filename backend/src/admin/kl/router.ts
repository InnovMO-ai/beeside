import { randomUUID } from "node:crypto";
import express, { NextFunction, Request, Response, Router } from "express";
import { Pool } from "pg";
import { Db } from "../../db/database";
import { AuditOutcome, recordAudit } from "../../operations/audit";
import { RATE_LIMITS, RateLimiter, rateLimit } from "../../security/rate-limit";
import { ADMIN_SESSION_COOKIE, AdminPrincipal, AdminSessionConfig, parseCookies, resolveAdminSession } from "../admin-session";
import { AttestedPrincipal, KlTx, withAttestation } from "../../kl/db/attested-tx";
import { KlError, translateDbError } from "../../kl/db/errors";
import { KL_ROLES, KlRole, klAdmin } from "../../kl/service/admin-service";

/**
 * KL Admin API (Contratos kl.v1 §7, CR-KL-002 §4): `/api/admin/kl/*`, con la misma sesión OIDC, origen y límite de tasa del
 * Control Center. Cada petición:
 *   1. resuelve la sesión en la base principal, SIN caché (si `beeside` no responde → 503 y no se abre transacción en KL);
 *   2. abre una transacción en `beeside_kl` y la certifica con kl.attest (misma transacción, misma petición);
 *   3. ejecuta la operación (kl.require + doble intervención + auditoría kl.audit_event viven en la base);
 *   4. confirma y DESPUÉS registra el acceso en `admin_audit_event` con el mismo request_id (ALLOWED / DENIED / FAILED).
 * Un fallo al escribir `admin_audit_event` tras confirmar se registra con el request_id; el job diario lo correlaciona.
 */
export interface KlAdminDeps {
  /** Base principal: solo para resolver la sesión, leer admin_user y registrar accesos. */
  platform: Db;
  session: AdminSessionConfig;
  klApp: Pool;
  now?: () => Date;
  log?: (level: "info" | "warn" | "error", message: string, fields?: Record<string, unknown>) => void;
}

type KlRequest = Request & { klPrincipal?: AdminPrincipal; requestId?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z0-9_.:-]{2,160}$/;

const READ_VIEWS: Record<string, { view: string; order: string }> = {
  principals: { view: "kl.v_admin_principals", order: "first_seen_at, principal_id" },
  "role-grants": { view: "kl.v_admin_role_grants", order: "granted_at, grant_id" },
  jobs: { view: "kl.v_admin_jobs", order: "created_at DESC, job_id" },
  audit: { view: "kl.v_admin_audit", order: "event_id DESC" },
  publications: { view: "kl.v_admin_publications", order: "key" },
  "unit-versions": { view: "kl.v_admin_unit_versions", order: "unit_key, version DESC" },
  batches: { view: "kl.v_admin_batches", order: "created_at DESC, id" },
  "demand-groups": { view: "kl.v_admin_demand_groups", order: "signal_count DESC, id" },
  packages: { view: "kl.v_admin_packages", order: "package_key, version DESC" },
};

export function createKlAdminRouter(deps: KlAdminDeps, security: { limiter?: RateLimiter } = {}): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);

  router.use((req: KlRequest, res, next) => {
    req.requestId = randomUUID();
    res.set("Cache-Control", "no-store");
    res.set("X-Request-Id", req.requestId);
    next();
  });
  router.use(express.json({ limit: "256kb" }));

  // 1 · sesión del Control Center, sin caché; si la base principal no responde no se abre ninguna transacción de KL (X29).
  router.use((req: KlRequest, res, next) => {
    void (async () => {
      let principal: AdminPrincipal | null;
      try {
        principal = await resolveAdminSession(deps.platform, parseCookies(req.header("cookie"))[ADMIN_SESSION_COOKIE], now(), deps.session);
      } catch {
        log("error", "kl.platform_unavailable", { request_id: req.requestId });
        res.status(503).json({ error: "PLATFORM_UNAVAILABLE" });
        return;
      }
      if (!principal) {
        res.status(401).json({ error: "UNAUTHENTICATED" });
        return;
      }
      req.klPrincipal = principal;
      if (req.method !== "GET" && req.method !== "HEAD") {
        const origin = req.header("origin");
        if (req.header("x-beeside-admin") !== "1" || (origin !== undefined && origin !== deps.session.appOrigin)) {
          await audit(req, "kl.csrf_rejected", "DENIED", { reason: "csrf" });
          res.status(403).json({ error: "CSRF_REJECTED" });
          return;
        }
      }
      next();
    })().catch((error: unknown) => next(error));
  });
  router.use(rateLimit(security.limiter, RATE_LIMITS.adminSession, (req) => (req as KlRequest).klPrincipal?.sessionId ?? null));

  async function audit(req: KlRequest, action: string, outcome: AuditOutcome, details: Record<string, unknown> = {}, target?: { type: string; id: string }): Promise<void> {
    try {
      await recordAudit(deps.platform, {
        actor: req.klPrincipal ? { type: "ADMIN_USER", adminUserId: req.klPrincipal.adminUserId } : { type: "SYSTEM" },
        action,
        outcome,
        targetType: target?.type ?? null,
        targetId: target?.id ?? null,
        requestId: req.requestId ?? null,
        details: { ...details, request_id: req.requestId },
        now: now(),
      });
    } catch {
      // KL ya confirmó (o rechazó): el desfase lo reporta el job de correlación con este request_id.
      log("error", "kl.admin_audit_write_failed", { request_id: req.requestId, action, outcome });
    }
  }

  const attested = (req: KlRequest): AttestedPrincipal => {
    const p = req.klPrincipal as AdminPrincipal;
    return { adminUserId: p.adminUserId, email: p.email, role: p.role === "SUPERVISOR" ? "SUPERVISOR" : "ADMIN", sessionId: p.sessionId };
  };

  /** Ejecuta `fn` en una transacción certificada, audita el acceso y traduce los errores a HTTP. */
  const op =
    (action: string, fn: (req: KlRequest, tx: KlTx, res: Response) => Promise<{ status?: number; body: unknown; target?: { type: string; id: string }; outcome?: AuditOutcome; reason?: string }>) =>
    (req: Request, res: Response, next: NextFunction) => {
      const r = req as KlRequest;
      void (async () => {
        try {
          const out = await withAttestation(deps.klApp, attested(r), r.requestId as string, (tx) => fn(r, tx, res));
          await audit(r, action, out.outcome ?? "ALLOWED", out.reason ? { reason: out.reason } : {}, out.target);
          res.status(out.status ?? 200).json(out.body);
        } catch (raw) {
          const error = raw instanceof KlError ? raw : translateDbError(raw);
          if (!(error instanceof KlError)) throw error;
          if (error.code === "FORBIDDEN" || error.code === "IDENTITY_MISMATCH") {
            // Los rechazos de permiso se registran solo en la base principal.
            await audit(r, action, "DENIED", { reason: error.code === "IDENTITY_MISMATCH" ? "identity_mismatch" : "permission" });
          } else if (error.code !== "UNAVAILABLE") {
            await audit(r, action, "FAILED", { reason: error.code.toLowerCase() });
          }
          res.status(error.status).json({ error: error.code, message: error.message });
        }
      })().catch((error: unknown) => next(error));
    };

  const param = (req: Request, name: string, pattern: RegExp): string => {
    const v = String(req.params[name] ?? "");
    if (!pattern.test(v)) throw new KlError("NOT_FOUND", `${name} not found`);
    return v;
  };
  const body = (req: Request): Record<string, unknown> => (typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {});
  const text = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : undefined);

  // ------------------------------------------------------------------ lectura
  router.get("/me", op("kl.me.read", async (req, tx) => {
    const p = attested(req);
    const grants = await tx.query("SELECT role, editorial, domains FROM kl.v_admin_role_grants WHERE admin_user_id = $1 AND revoked_at IS NULL", [p.adminUserId]);
    return { body: { email: p.email, platformRole: p.role, klRoles: grants.rows } };
  }));

  router.get("/:resource(principals|role-grants|jobs|audit|publications|unit-versions|batches|demand-groups|packages)", op("kl.read", async (req, tx) => {
    const spec = READ_VIEWS[String(req.params.resource)] as { view: string; order: string };
    const allowed = await tx.query<{ ok: boolean }>("SELECT kl.can_read() AS ok");
    if (!allowed.rows[0]?.ok) throw new KlError("FORBIDDEN", "kl.read permission required");
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? "100"), 10) || 100, 1), 500);
    const rows = await tx.query(`SELECT * FROM ${spec.view} ORDER BY ${spec.order} LIMIT $1`, [limit]);
    return { body: { items: rows.rows } };
  }));

  // ------------------------------------------------------------------ roles de KL (solo KL_ADMIN)
  router.post("/role-grants", op("kl.role_grant.grant", async (req, tx) => {
    const b = body(req);
    const adminUserId = text(b.adminUserId, 40);
    const role = b.role as KlRole;
    if (!adminUserId || !UUID.test(adminUserId) || !KL_ROLES.includes(role)) throw new KlError("INVALID", "adminUserId and role are required");
    const domains = Array.isArray(b.domains) ? b.domains.filter((d): d is string => typeof d === "string" && /^[a-z0-9_.]{2,60}$/.test(d)) : [];
    // La identidad sale de la base principal, nunca del cuerpo de la petición.
    const found = await deps.platform.query<{ auth_identity: string; active: boolean; login_enabled: boolean }>("SELECT auth_identity, active, login_enabled FROM admin_user WHERE admin_user_id = $1", [adminUserId]);
    const target = found.rows[0];
    if (!target || !target.active || !target.login_enabled || target.auth_identity.endsWith("@beeside.internal")) throw new KlError("INVALID", "the admin user is not eligible");
    const grantId = await klAdmin.grantRole(tx, { adminUserId, email: target.auth_identity, role, editorial: b.editorial === true, domains });
    return { status: 201, body: { grantId }, target: { type: "kl_role_grant", id: grantId } };
  }));

  router.delete("/role-grants/:grantId", op("kl.role_grant.revoke", async (req, tx) => {
    const id = param(req, "grantId", UUID);
    await klAdmin.revokeRole(tx, id, text(body(req).reason, 300));
    return { body: { revoked: true }, target: { type: "kl_role_grant", id } };
  }));

  // ------------------------------------------------------------------ cola, fuentes, retiro, compuerta
  router.post("/jobs", op("kl.job.enqueue", async (req, tx) => {
    const b = body(req);
    const kind = text(b.kind, 40);
    if (!kind) throw new KlError("INVALID", "kind is required");
    const payload = typeof b.payload === "object" && b.payload !== null && !Array.isArray(b.payload) ? (b.payload as Record<string, unknown>) : {};
    const jobId = await klAdmin.enqueueJob(tx, kind, payload);
    return { status: 202, body: { jobId }, target: { type: "kl_job", id: jobId } };
  }));

  router.post("/publications/:key/decision", op("kl.publication.decide", async (req, tx) => {
    const key = param(req, "key", KEY);
    const decision = text(body(req).decision, 20);
    if (!decision) throw new KlError("INVALID", "decision is required");
    const status = await klAdmin.decidePublication(tx, key, decision, text(body(req).reason, 300));
    return { body: { status }, target: { type: "kl_publication", id: key } };
  }));

  router.post("/units/:key/withdraw", op("kl.unit.withdraw", async (req, tx) => {
    const key = param(req, "key", KEY);
    const reason = text(body(req).reason, 300);
    if (!reason) throw new KlError("INVALID", "reason is required");
    const withdrawn = await klAdmin.withdrawUnit(tx, key, reason);
    return { body: { withdrawn }, target: { type: "kl_unit", id: key } };
  }));

  router.post("/settings/r10-claims", op("kl.setting.r10_claims", async (req, tx) => {
    const b = body(req);
    if (typeof b.enabled !== "boolean") throw new KlError("INVALID", "enabled is required");
    const result = await klAdmin.setR10Claims(tx, b.enabled, text(b.acceptanceRef, 200) ?? null);
    const target = { type: "kl_setting", id: "kl.r10_claims_enabled" };
    // La base ya dejó el evento de auditoría del rechazo: se confirma y se responde 422 (no se lanza, para no revertirlo).
    if (!result.ok) return { status: 422, body: { error: "REJECTED", message: "the acceptance reference of CR-KL-001 is required to enable approved claims" }, target, outcome: "FAILED", reason: result.reason };
    return { body: { enabled: b.enabled }, target };
  }));

  return router;
}
