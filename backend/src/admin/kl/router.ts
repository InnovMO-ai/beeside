import { randomUUID } from "node:crypto";
import express, { NextFunction, Request, Response, Router } from "express";
import { Pool } from "pg";
import { Db } from "../../db/database";
import { AuditOutcome, recordAudit } from "../../operations/audit";
import { RATE_LIMITS, RateLimiter, rateLimit } from "../../security/rate-limit";
import { ADMIN_SESSION_COOKIE, AdminPrincipal, AdminSessionConfig, parseCookies, resolveAdminSession } from "../admin-session";
import { AttestedPrincipal, KlTx, withAttestation } from "../../kl/db/attested-tx";
import { KlError, translateDbError } from "../../kl/db/errors";
import { correlateAudit, CorrelationIncomplete } from "../../kl/audit/correlation";
import { ObjectStore } from "../../kl/ingest/object-store";
import { submitEdition } from "../../kl/products/manifest";
import { FontFamily } from "../../kl/products/render/compose";
import { createHash } from "node:crypto";
import { CADENCES, FREQUENCIES, KL_ROLES, KlCadence, KlRole, klAdmin } from "../../kl/service/admin-service";

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
  /** Almacén de PDF para la descarga autenticada de vistas previas de revisión (no es distribución). */
  store?: ObjectStore;
  /** Tipografía que se fija en el manifiesto al enviar una edición a aprobación (Lato por defecto; Public Sans como respaldo). */
  pdfFont?: FontFamily;
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
  products: { view: "kl.v_admin_products", order: "key" },
  validators: { view: "kl.v_admin_validators", order: "display_name, id" },
  "validation-queue": { view: "kl.v_admin_validation_queue", order: "approved_at, unit_version_id" },
  "audit-correlation": { view: "kl.v_admin_audit_correlation", order: "report_id DESC" },
  schedule: { view: "kl.v_admin_publication_schedule", order: "key" },
  editions: { view: "kl.v_admin_editions", order: "product_key, code DESC" },
  composition: { view: "kl.v_admin_composition", order: "product_key, section_key, unit_key" },
  "change-notices": { view: "kl.v_admin_change_notices", order: "created_at DESC, id" },
  "fixed-blocks": { view: "kl.v_admin_fixed_blocks", order: "block_id, version, locale" },
  "edition-previews": { view: "kl.v_admin_edition_previews", order: "created_at DESC, id" },
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

  router.get("/:resource(principals|role-grants|jobs|audit|publications|unit-versions|batches|demand-groups|packages|products|validators|validation-queue|audit-correlation|schedule|editions|composition|change-notices|fixed-blocks|edition-previews)", op("kl.read", async (req, tx) => {
    const resource = String(req.params.resource);
    const spec = READ_VIEWS[resource] as { view: string; order: string };
    // La cola de validación filtra por dominio en la propia vista (un SPECIALIST_VALIDATOR solo ve la suya).
    if (resource !== "validation-queue") {
      const allowed = await tx.query<{ ok: boolean }>("SELECT kl.can_read() AS ok");
      if (!allowed.rows[0]?.ok) throw new KlError("FORBIDDEN", "kl.read permission required");
    }
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

  // ------------------------------------------------------------------ R2 · periodicidad y acciones manuales (PO-6)
  const cadence = (v: unknown): KlCadence => {
    if (typeof v !== "string" || !(CADENCES as readonly string[]).includes(v)) throw new KlError("INVALID", "unknown cadence (there is no daily value)");
    return v as KlCadence;
  };
  const reasonOf = (req: Request, required: boolean): string | undefined => {
    const r = text(body(req).reason, 300);
    if (required && (!r || r.length < 3)) throw new KlError("INVALID", "reason is required");
    return r;
  };

  router.post("/products", op("kl.product.create", async (req, tx) => {
    const b = body(req);
    const key = text(b.key, 60);
    const country = text(b.country, 2);
    if (!key || !/^[a-z0-9_]{2,60}$/.test(key) || !country || !/^[A-Z]{2}$/.test(country)) throw new KlError("INVALID", "key and country are required");
    const id = await klAdmin.createProduct(tx, key, country, b.reviewPeriodicity === undefined ? "semiannual" : cadence(b.reviewPeriodicity));
    return { status: 201, body: { id }, target: { type: "kl_product", id: key } };
  }));

  router.patch("/products/:key", op("kl.product.periodicity", async (req, tx) => {
    const key = param(req, "key", KEY);
    const nextCycleAt = await klAdmin.setProductPeriodicity(tx, key, cadence(body(req).reviewPeriodicity), reasonOf(req, false));
    return { body: { nextCycleAt }, target: { type: "kl_product", id: key } };
  }));

  router.patch("/publications/:key", op("kl.publication.frequency", async (req, tx) => {
    const key = param(req, "key", KEY);
    const f = body(req).checkFrequency;
    if (typeof f !== "string" || !(FREQUENCIES as readonly string[]).includes(f)) throw new KlError("INVALID", "unknown frequency (there is no daily value)");
    const nextCheckAt = await klAdmin.setPublicationFrequency(tx, key, f as (typeof FREQUENCIES)[number], reasonOf(req, false));
    return { body: { nextCheckAt }, target: { type: "kl_publication", id: key } };
  }));

  router.put("/settings/ram-cadence", op("kl.ram.cadence", async (req, tx) => {
    const version = await klAdmin.setRamCadence(tx, cadence(body(req).cadence), reasonOf(req, false));
    return { body: { version }, target: { type: "kl_setting", id: "kl.ram.check_cadence" } };
  }));

  // «Revisar ahora» (KL_EDITOR o KL_ADMIN) y «Edición extraordinaria» (KL_ADMIN): siempre con motivo y auditadas.
  router.post("/publications/:key/check-now", op("kl.check_now", async (req, tx) => {
    const key = param(req, "key", KEY);
    const jobs = await klAdmin.checkNow(tx, "publication", key, reasonOf(req, true) as string);
    return { status: 202, body: { jobs }, target: { type: "kl_publication", id: key } };
  }));
  router.post("/products/:key/check-now", op("kl.check_now", async (req, tx) => {
    const key = param(req, "key", KEY);
    const jobs = await klAdmin.checkNow(tx, "product", key, reasonOf(req, true) as string);
    return { status: 202, body: { jobs }, target: { type: "kl_product", id: key } };
  }));
  router.post("/products/:key/extraordinary-edition", op("kl.extraordinary_edition", async (req, tx) => {
    const key = param(req, "key", KEY);
    const code = text(body(req).reasonCode, 40);
    if (!code) throw new KlError("INVALID", "reasonCode is required");
    const jobId = await klAdmin.extraordinaryEdition(tx, key, code, reasonOf(req, true) as string);
    return { status: 202, body: { jobId }, target: { type: "kl_product", id: key } };
  }));

  // ------------------------------------------------------------------ R2 · validadores y validación especializada
  router.post("/validators", op("kl.validator.register", async (req, tx) => {
    const b = body(req);
    const kind = b.kind === "internal" || b.kind === "external" ? b.kind : null;
    const displayName = text(b.displayName, 120);
    const domains = Array.isArray(b.domains) ? b.domains.filter((d): d is string => typeof d === "string" && /^[a-z0-9_.]{2,60}$/.test(d)) : [];
    if (!kind || !displayName || domains.length === 0) throw new KlError("INVALID", "kind, displayName and domains are required");
    let adminUserId: string | null = null;
    if (kind === "internal") {
      adminUserId = text(b.adminUserId, 40) ?? null;
      if (!adminUserId || !UUID.test(adminUserId)) throw new KlError("INVALID", "an internal validator is an admin user");
      const found = await deps.platform.query<{ active: boolean; login_enabled: boolean }>("SELECT active, login_enabled FROM admin_user WHERE admin_user_id = $1", [adminUserId]);
      if (!found.rows[0]?.active || !found.rows[0].login_enabled) throw new KlError("INVALID", "the admin user is not eligible");
    }
    const id = await klAdmin.registerValidator(tx, { kind, adminUserId, displayName, organization: text(b.organization, 120) ?? null, domains, engagementRef: text(b.engagementRef, 120) ?? null });
    return { status: 201, body: { id }, target: { type: "kl_validator", id } };
  }));

  router.patch("/validators/:id", op("kl.validator.status", async (req, tx) => {
    const id = param(req, "id", UUID);
    const status = body(req).status;
    if (status !== "active" && status !== "inactive") throw new KlError("INVALID", "status must be active or inactive");
    await klAdmin.setValidatorStatus(tx, id, status, reasonOf(req, false));
    return { body: { status }, target: { type: "kl_validator", id } };
  }));

  router.post("/unit-versions/:id/validations", op("kl.validation.record", async (req, tx) => {
    const id = param(req, "id", UUID);
    const b = body(req);
    const validatorId = text(b.validatorId, 40);
    const domain = text(b.domain, 60);
    const scope = text(b.scopeStatement, 500);
    const verdict = b.verdict;
    const locale = b.locale === "en" ? "en" : b.locale === "es" ? "es" : null;
    const validatedAt = typeof b.validatedAt === "string" ? b.validatedAt : "";
    const expiresAt = typeof b.expiresAt === "string" ? b.expiresAt : "";
    if (!validatorId || !UUID.test(validatorId) || !domain || !scope || !locale || (verdict !== "approved" && verdict !== "approved_with_changes_required" && verdict !== "rejected") || Number.isNaN(Date.parse(validatedAt)) || Number.isNaN(Date.parse(expiresAt))) {
      throw new KlError("INVALID", "validatorId, domain, scopeStatement, locale, verdict, validatedAt and expiresAt are required");
    }
    const result = await klAdmin.recordValidation(tx, { versionId: id, validatorId, locale, domain, scopeStatement: scope, verdict, validatedAt, expiresAt });
    return { status: 201, body: { result }, target: { type: "kl_unit_version", id } };
  }));

  // ------------------------------------------------------------------ R2 · correlación de auditoría (B5)
  router.post("/audit-correlation/run", op("kl.audit_correlation.run", async (_req, tx) => {
    await klAdmin.beginCorrelationRun(tx);
    try {
      const r = await correlateAudit({ platform: deps.platform, kl: deps.klApp, now });
      return { status: r.skipped ? 202 : 201, body: { skipped: r.skipped, reportId: r.reportId ?? null, status: r.status ?? null, klOnly: r.klOnly.length, adminOnly: r.adminOnly.length }, target: { type: "kl_audit_correlation", id: r.reportId ?? "none" } };
    } catch (error) {
      if (error instanceof CorrelationIncomplete) throw new KlError("UNAVAILABLE", `audit correlation incomplete (${error.side})`);
      throw error;
    }
  }));

  // ------------------------------------------------------------------ R3 · Knowledge Products
  const strArr = (v: unknown, pattern: RegExp): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && pattern.test(x)) : []);

  router.put("/products/:key/config", op("kl.product.config", async (req, tx) => {
    const key = param(req, "key", KEY);
    const b = body(req);
    const fixedBlocks = Array.isArray(b.fixedBlocks) ? b.fixedBlocks.filter((x): x is { blockId: string; version: string } => typeof x === "object" && x !== null && typeof (x as { blockId?: unknown }).blockId === "string" && typeof (x as { version?: unknown }).version === "string") : [];
    const version = await klAdmin.setProductConfig(tx, key, { fixedBlocks, links: strArr(b.links, /^kl\.links\.[a-z0-9_]{2,60}$/) });
    return { body: { version }, target: { type: "kl_product", id: key } };
  }));
  router.post("/catalog", op("kl.catalog.register", async (req, tx) => {
    const b = body(req);
    const kind = b.kind === "category" || b.kind === "service" || b.kind === "industry" ? b.kind : null;
    const version = text(b.catalogVersion, 60);
    const keys = strArr(b.keys, /^[a-z0-9_.:-]{1,120}$/);
    if (!kind || !version || keys.length === 0) throw new KlError("INVALID", "catalogVersion, kind and keys are required");
    const added = await klAdmin.registerCatalogEntries(tx, version, kind, keys);
    return { status: 201, body: { added }, target: { type: "kl_catalog", id: version } };
  }));
  router.post("/private-terms", op("kl.private_term.add", async (req, tx) => {
    const b = body(req);
    const term = text(b.term, 120);
    if (!term || (b.kind !== "client" && b.kind !== "partner")) throw new KlError("INVALID", "term and kind are required");
    const id = await klAdmin.addPrivateTerm(tx, term, b.kind);
    return { status: 201, body: { id }, target: { type: "kl_private_term", id } };
  }));
  router.post("/fixed-blocks", op("kl.fixed_block.register", async (req, tx) => {
    const b = body(req);
    const blockId = text(b.blockId, 60);
    const version = text(b.version, 20);
    if (!blockId || !version || (b.locale !== "es" && b.locale !== "en") || typeof b.content !== "object" || b.content === null) throw new KlError("INVALID", "blockId, version, locale and content are required");
    const id = await klAdmin.registerFixedBlock(tx, blockId, version, b.locale, b.content);
    return { status: 201, body: { id }, target: { type: "kl_fixed_block", id } };
  }));
  router.post("/fixed-blocks/:id/approve", op("kl.fixed_block.approve", async (req, tx) => {
    const id = param(req, "id", UUID);
    await klAdmin.approveFixedBlock(tx, id);
    return { body: { approved: true }, target: { type: "kl_fixed_block", id } };
  }));
  router.post("/products/:key/sections", op("kl.section.add", async (req, tx) => {
    const key = param(req, "key", KEY);
    const b = body(req);
    const s = { sectionKey: text(b.sectionKey, 60), chapter: text(b.chapter, 10), slot: text(b.slot, 20), titleEs: text(b.titleEs, 200), titleEn: text(b.titleEn, 200), contentType: text(b.contentType, 20) };
    if (!s.sectionKey || !s.chapter || !s.slot || !s.titleEs || !s.titleEn || !s.contentType) throw new KlError("INVALID", "sectionKey, chapter, slot, titles and contentType are required");
    const id = await klAdmin.addSection(tx, { productKey: key, sectionKey: s.sectionKey, chapter: s.chapter, part: text(b.part, 60) ?? null, slot: s.slot, sort: Number.isInteger(b.order) ? (b.order as number) : 0, titleEs: s.titleEs, titleEn: s.titleEn, contentType: s.contentType, categoryKeys: strArr(b.categoryKeys, /^[a-z0-9_.:-]{1,120}$/), validationDomain: text(b.validationDomain, 60) ?? null });
    return { status: 201, body: { id }, target: { type: "kl_product", id: key } };
  }));
  router.post("/products/:key/composition", op("kl.composition.add", async (req, tx) => {
    const key = param(req, "key", KEY);
    const b = body(req);
    const sectionKey = text(b.sectionKey, 60);
    const unitKey = text(b.unitKey, 160);
    if (!sectionKey || !unitKey) throw new KlError("INVALID", "sectionKey and unitKey are required");
    const id = await klAdmin.composeUnit(tx, key, sectionKey, unitKey, Number.isInteger(b.order) ? (b.order as number) : 0);
    return { status: 201, body: { id }, target: { type: "kl_product", id: key } };
  }));
  router.post("/change-notices/:id/decision", op("kl.change_notice.decide", async (req, tx) => {
    const id = param(req, "id", UUID);
    const decision = body(req).decision;
    if (decision !== "approved_for_next" && decision !== "dismissed") throw new KlError("INVALID", "decision must be approved_for_next or dismissed");
    await klAdmin.decideChangeNotice(tx, id, decision, reasonOf(req, false));
    return { body: { decision }, target: { type: "kl_change_notice", id } };
  }));
  router.post("/editions", op("kl.edition.open", async (req, tx) => {
    const b = body(req);
    const productKey = text(b.productKey, 60);
    const code = text(b.code, 10);
    const cutoff = text(b.cutoffDate, 10);
    if (!productKey || !code || !cutoff || !/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) throw new KlError("INVALID", "productKey, code and cutoffDate (YYYY-MM-DD) are required");
    const id = await klAdmin.openEdition(tx, productKey, code, cutoff);
    return { status: 201, body: { id }, target: { type: "kl_edition", id } };
  }));
  router.get("/editions/:id/controls", op("kl.edition.controls.read", async (req, tx) => {
    const id = param(req, "id", UUID);
    const controls = await klAdmin.editionControls(tx, id);
    return { body: { ready: controls.every((c) => c.ok), controls } };
  }));
  router.post("/editions/:id/refresh-pins", op("kl.edition.refresh", async (req, tx) => {
    const id = param(req, "id", UUID);
    return { body: { pinned: await klAdmin.refreshPins(tx, id) }, target: { type: "kl_edition", id } };
  }));
  router.post("/editions/:id/submit", op("kl.edition.submit", async (req, tx) => {
    const id = param(req, "id", UUID);
    const sha = await submitEdition(tx, id, deps.pdfFont ?? "lato");
    return { body: { manifestSha256: sha }, target: { type: "kl_edition", id } };
  }));
  router.post("/editions/:id/return", op("kl.edition.return", async (req, tx) => {
    const id = param(req, "id", UUID);
    await klAdmin.returnEdition(tx, id, reasonOf(req, true) as string);
    return { body: { status: "composing" }, target: { type: "kl_edition", id } };
  }));
  router.post("/editions/:id/approve", op("kl.edition.approve", async (req, tx) => {
    const id = param(req, "id", UUID);
    const jobId = await klAdmin.approveEdition(tx, id);
    return { status: 202, body: { renderJobId: jobId }, target: { type: "kl_edition", id } };
  }));
  router.post("/editions/:id/preview", op("kl.edition.preview", async (req, tx) => {
    const id = param(req, "id", UUID);
    const jobId = await klAdmin.requestPreview(tx, id);
    return { status: 202, body: { renderJobId: jobId }, target: { type: "kl_edition", id } };
  }));
  router.post("/editions/:id/unpublish", op("kl.edition.unpublish", async (req, tx) => {
    const id = param(req, "id", UUID);
    await klAdmin.unpublishEdition(tx, id, reasonOf(req, true) as string);
    return { body: { status: "unpublished" }, target: { type: "kl_edition", id } };
  }));
  router.post("/editions/:id/revoke", op("kl.edition.revoke", async (req, tx) => {
    const id = param(req, "id", UUID);
    await klAdmin.revokeEdition(tx, id, reasonOf(req, true) as string);
    return { body: { status: "revoked" }, target: { type: "kl_edition", id } };
  }));

  // Descarga autenticada de una vista previa de revisión (PDF de PRUEBA con marca visible; no cuenta como distribución).
  router.get("/editions/:id/preview/:locale/pdf", (req, res, next) => {
    const r = req as KlRequest;
    void (async () => {
      let file: { storage_key: string; sha256: string; byte_length: string } | undefined;
      try {
        const id = param(req, "id", UUID);
        const locale = param(req, "locale", /^(es|en)$/);
        file = await withAttestation(deps.klApp, attested(r), r.requestId as string, async (tx) => (await tx.query<{ storage_key: string; sha256: string; byte_length: string }>("SELECT * FROM kl.preview_file($1, $2)", [id, locale])).rows[0]);
        if (!file || !deps.store) throw new KlError("NOT_FOUND", "no preview available");
        const bytes = await deps.store.get(file.storage_key);
        if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new KlError("UNAVAILABLE", "stored preview failed its integrity check");
        await audit(r, "kl.edition.preview.read", "ALLOWED", {}, { type: "kl_edition", id });
        res.set({ "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="preview.pdf"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Length": String(bytes.length) });
        res.send(bytes);
      } catch (raw) {
        const error = raw instanceof KlError ? raw : translateDbError(raw);
        if (!(error instanceof KlError)) throw error;
        if (error.code === "FORBIDDEN") await audit(r, "kl.edition.preview.read", "DENIED", { reason: "permission" });
        res.status(error.status).json({ error: error.code, message: error.message });
      }
    })().catch(next);
  });

  return router;
}
