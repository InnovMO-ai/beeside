import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { Pool } from "pg";
import { ADMIN_SESSION_COOKIE, AdminSessionConfig, createAdminSession } from "../../admin/admin-session";
import { provisionAdminUser, updateAdminUser } from "../../admin/admin-users";
import { Db, createPoolDb } from "../../db/database";
import { createApp } from "../../index";
import { bootstrapAdmin, BootstrapRefused } from "../identity/bootstrap-admin";
import { RECONCILE_LOCK_KEY, reconcilePrincipals } from "../identity/reconcile";
import { klPool } from "../db/pools";
import { describeKl, freshBeesideDatabase, freshKlDatabase, roleUrl, superUrl, connectAs } from "../testing/env";
import { Client } from "pg";

const SESSION: AdminSessionConfig = { sessionSecret: "s".repeat(40), sessionTtlMinutes: 480, idleTimeoutMinutes: 30, cookieSecure: false, appOrigin: "https://admin.test" };
const WRITE = { "x-beeside-admin": "1", origin: SESSION.appOrigin };

describeKl("KL Admin API · /api/admin/kl (sesión, certificación, auditoría, fallo seguro)", () => {
  let beeside: Pool;
  let platform: Db;
  let klApp: Pool;
  let owner: Client;
  let app: ReturnType<typeof createApp>;
  const now = () => new Date();
  const users: Record<string, { id: string; email: string; token: string; sessionId: string }> = {};

  const mkUser = async (label: string, role: "ADMIN" | "SUPERVISOR") => {
    const email = `${label}.${randomUUID().slice(0, 6)}@synthetic.test`;
    const u = await provisionAdminUser(platform, { email, role }, now());
    const s = await createAdminSession(platform, { adminUserId: u.adminUserId, role, issuer: "https://idp.synthetic.test", now: now(), config: SESSION });
    users[label] = { id: u.adminUserId, email, token: s.token, sessionId: s.sessionId };
    return users[label];
  };
  const as = (label: string) => ({ Cookie: `${ADMIN_SESSION_COOKIE}=${users[label]?.token}` });
  const get = (label: string, path: string) => request(app).get(`/api/admin/kl${path}`).set(as(label));
  const send = (method: "post" | "delete", label: string, path: string, body?: object) => request(app)[method](`/api/admin/kl${path}`).set(as(label)).set(WRITE).send(body ?? {});
  const attestations = async () => (await owner.query("SELECT count(*)::int AS n FROM kl.request_attestation")).rows[0].n as number;
  const adminAudit = async (action: string) => (await beeside.query("SELECT outcome, actor_type, request_id, details FROM admin_audit_event WHERE action = $1 ORDER BY occurred_at", [action])).rows;
  const klAudit = async (action: string) => (await owner.query("SELECT actor_principal_id, request_id, entity_id, reason FROM kl.audit_event WHERE action = $1 ORDER BY event_id", [action])).rows;

  beforeAll(async () => {
    await freshBeesideDatabase();
    await freshKlDatabase();
    beeside = new Pool({ connectionString: superUrl("beeside") });
    platform = createPoolDb(beeside);
    klApp = klPool(roleUrl("kl_app"), 3);
    owner = await connectAs("kl_owner");
    app = createApp({ kl: { platform, session: SESSION, klApp, now } });
  });
  afterAll(async () => {
    await klApp.end();
    await owner.end();
    await beeside.end();
  });

  describe("sin sesión no hay nada", () => {
    it("401 sin cookie o con una cookie inventada, y no se abre ninguna transacción de KL", async () => {
      const before = await attestations();
      await request(app).get("/api/admin/kl/me").expect(401);
      await request(app).get("/api/admin/kl/principals").set("Cookie", `${ADMIN_SESSION_COOKIE}=${"a".repeat(43)}`).expect(401);
      expect(await attestations()).toBe(before);
    });
  });

  describe("X14/X15 · arranque auditado de KL_ADMIN (B4)", () => {
    beforeAll(async () => {
      await mkUser("padmin", "ADMIN");
      await mkUser("pbackup", "ADMIN"); // un segundo ADMIN activo permite desactivar a otro
    });
    const boot = (email: string) => bootstrapAdmin({ beeside: platform, klOwnerUrl: roleUrl("kl_owner") }, email);
    const klWrites = async () => (await owner.query("SELECT (SELECT count(*) FROM kl.principal)::int AS p, (SELECT count(*) FROM kl.role_grant)::int AS g, (SELECT count(*) FROM kl.audit_event)::int AS a")).rows[0];

    it("X14: usuario inexistente, sin login, inactivo o con identidad técnica se rechaza antes de escribir", async () => {
      const before = await klWrites();
      const auditBefore = (await beeside.query("SELECT count(*)::int AS n FROM admin_audit_event")).rows[0].n;
      await expect(boot("nadie@synthetic.test")).rejects.toMatchObject({ reason: "not_found" });
      await expect(boot("no-correo")).rejects.toMatchObject({ reason: "invalid_email" });
      await expect(boot("kl-agent@beeside.internal")).rejects.toMatchObject({ reason: "technical_identity" });
      await beeside.query("INSERT INTO admin_user (role, auth_identity, active, login_enabled) VALUES ('ADMIN', 'sinlogin@synthetic.test', true, false)");
      await expect(boot("sinlogin@synthetic.test")).rejects.toMatchObject({ reason: "login_not_enabled" });
      const idle = await mkUser("pinactivo", "SUPERVISOR");
      await updateAdminUser(platform, users.pbackup?.id as string, idle.id, { active: false }, now());
      await expect(boot(idle.email)).rejects.toMatchObject({ reason: "inactive" });
      await expect(boot(idle.email)).rejects.toBeInstanceOf(BootstrapRefused);
      expect(await klWrites()).toEqual(before);
      expect((await beeside.query("SELECT count(*)::int AS n FROM admin_audit_event")).rows[0].n).toBe(auditBefore);
    });

    it("X15: arranque exitoso → principal, concesión, kl.audit_event y admin_audit_event (SYSTEM) con el mismo request_id", async () => {
      const r = await boot((users.padmin as { email: string }).email);
      const principal = (await owner.query("SELECT kind, active, auth_identity FROM kl.principal WHERE principal_id = $1", [r.adminUserId])).rows[0];
      expect(principal).toEqual({ kind: "admin_user", active: true, auth_identity: users.padmin?.email });
      expect((await owner.query("SELECT role, granted_by FROM kl.role_grant WHERE admin_user_id = $1", [r.adminUserId])).rows).toEqual([{ role: "KL_ADMIN", granted_by: "00000000-0000-4000-8000-0000000000a3" }]);
      const kl = await klAudit("kl.bootstrap_admin");
      expect(kl).toHaveLength(1);
      expect(kl[0]?.request_id).toBe(r.requestId);
      const ours = (await adminAudit("kl.bootstrap_admin"))[0];
      expect(ours).toMatchObject({ outcome: "ALLOWED", actor_type: "SYSTEM", request_id: r.requestId });
    });

    it("X13: un segundo arranque se niega mientras exista un KL_ADMIN no revocado", async () => {
      await expect(boot((users.pbackup as { email: string }).email)).rejects.toMatchObject({ reason: "admin_exists" });
    });
  });

  describe("certificación por petición y auditoría correlacionada (B3, B5)", () => {
    it("GET /me certifica la sesión (huella sha256 de session_id) y el acceso queda en las dos bases con el mismo request_id", async () => {
      const before = await attestations();
      const res = await get("padmin", "/me").expect(200);
      expect(res.body).toMatchObject({ email: users.padmin?.email, platformRole: "ADMIN", klRoles: [{ role: "KL_ADMIN" }] });
      expect(await attestations()).toBe(before + 1);
      const requestId = res.headers["x-request-id"] as string;
      const att = (await owner.query("SELECT principal_id, session_ref, platform_role FROM kl.request_attestation WHERE request_id = $1", [requestId])).rows[0];
      expect(att).toEqual({ principal_id: users.padmin?.id, session_ref: createHash("sha256").update(users.padmin?.sessionId as string).digest("hex"), platform_role: "ADMIN" });
      const ours = (await adminAudit("kl.me.read")).find((e) => e.request_id === requestId);
      expect(ours).toMatchObject({ outcome: "ALLOWED" });
    });

    it("las respuestas no se cachean y los errores no filtran detalles de la base", async () => {
      const res = await get("padmin", "/me").expect(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      const bad = await send("post", "padmin", "/jobs", { kind: "exfiltrar" }).expect(422);
      expect(JSON.stringify(bad.body)).not.toMatch(/kl\.|SELECT|BV\d{3}|postgres/i);
    });
  });

  describe("roles de KL: solo KL_ADMIN concede y revoca; CSRF y origen", () => {
    let editorGrant = "";
    beforeAll(async () => {
      await mkUser("peditor", "ADMIN");
      await mkUser("psup", "SUPERVISOR");
    });

    it("CSRF: sin cabecera x-beeside-admin o con otro origen se rechaza (y se audita DENIED)", async () => {
      await request(app).post("/api/admin/kl/role-grants").set(as("padmin")).set({ origin: SESSION.appOrigin }).send({}).expect(403, { error: "CSRF_REJECTED" });
      await request(app).post("/api/admin/kl/role-grants").set(as("padmin")).set({ "x-beeside-admin": "1", origin: "https://evil.example" }).send({}).expect(403, { error: "CSRF_REJECTED" });
      expect((await adminAudit("kl.csrf_rejected")).length).toBeGreaterThanOrEqual(2);
    });

    it("KL_ADMIN concede un rol a un admin_user elegible; la identidad sale de la base principal", async () => {
      const res = await send("post", "padmin", "/role-grants", { adminUserId: users.peditor?.id, role: "KL_EDITOR", email: "suplantado@synthetic.test" }).expect(201);
      editorGrant = res.body.grantId;
      const p = (await owner.query("SELECT auth_identity, active FROM kl.principal WHERE principal_id = $1", [users.peditor?.id])).rows[0];
      expect(p).toEqual({ auth_identity: users.peditor?.email, active: false }); // nace inactivo: la primera certificación válida lo activa
      expect((await klAudit("kl.role_grant.grant")).some((e) => e.entity_id === editorGrant)).toBe(true);
    });

    it("el editor no puede conceder (403, DENIED solo en la base principal, sin cambios en KL)", async () => {
      await get("peditor", "/me").expect(200); // activa su principal
      const grantsBefore = (await owner.query("SELECT count(*)::int AS n FROM kl.role_grant")).rows[0].n;
      const res = await send("post", "peditor", "/role-grants", { adminUserId: users.psup?.id, role: "KL_REVIEWER" }).expect(403);
      expect(res.body.error).toBe("FORBIDDEN");
      expect((await owner.query("SELECT count(*)::int AS n FROM kl.role_grant")).rows[0].n).toBe(grantsBefore);
      const denied = (await adminAudit("kl.role_grant.grant")).filter((e) => e.outcome === "DENIED");
      expect(denied.some((e) => e.request_id === res.headers["x-request-id"])).toBe(true);
    });

    it("destinos no elegibles o datos inválidos se rechazan con 422; nadie se concede un rol a sí mismo", async () => {
      await send("post", "padmin", "/role-grants", { adminUserId: randomUUID(), role: "KL_EDITOR" }).expect(422);
      await send("post", "padmin", "/role-grants", { adminUserId: users.pinactivo?.id, role: "KL_EDITOR" }).expect(422);
      await send("post", "padmin", "/role-grants", { adminUserId: users.psup?.id, role: "ROOT" }).expect(422);
      await send("post", "padmin", "/role-grants", { adminUserId: "no-uuid", role: "KL_EDITOR" }).expect(422);
      await send("post", "padmin", "/role-grants", { adminUserId: users.padmin?.id, role: "KL_EDITOR" }).expect(403);
    });

    it("«Revisar ahora»: el editor encola un job con payload de lista blanca; queda en las dos auditorías con el mismo request_id", async () => {
      const res = await send("post", "peditor", "/jobs", { kind: "review_now", payload: { publication_key: "inegi.enoe" } }).expect(202);
      const requestId = res.headers["x-request-id"] as string;
      expect((await klAudit("kl.job.enqueue")).some((e) => e.entity_id === res.body.jobId)).toBe(true);
      expect((await adminAudit("kl.job.enqueue")).some((e) => e.request_id === requestId && e.outcome === "ALLOWED")).toBe(true);
      const att = (await owner.query("SELECT 1 FROM kl.audit_event WHERE request_id = $1", [requestId])).rowCount;
      expect(att).toBeGreaterThan(0);
    });

    it("payload con texto libre o claves ajenas: 422 y FAILED en la base principal", async () => {
      const res = await send("post", "peditor", "/jobs", { kind: "review_now", payload: { publication_key: "una frase libre del cliente", nota: "x" } }).expect(422);
      expect((await adminAudit("kl.job.enqueue")).some((e) => e.request_id === res.headers["x-request-id"] && e.outcome === "FAILED")).toBe(true);
    });

    it("SUPERVISOR de plataforma lee pero no escribe; una concesión de KL no cambia su rol de plataforma", async () => {
      const list = await get("psup", "/principals").expect(200);
      expect(list.body.items.length).toBeGreaterThan(0);
      await send("post", "psup", "/jobs", { kind: "review_now", payload: { publication_key: "inegi.enoe" } }).expect(403);
      await send("post", "psup", "/role-grants", { adminUserId: users.peditor?.id, role: "KL_ADMIN" }).expect(403);
    });

    it("un usuario sin concesión ni rol de supervisor no lee nada", async () => {
      await mkUser("psin", "ADMIN");
      const res = await get("psin", "/audit").expect(403);
      expect(res.body.error).toBe("FORBIDDEN");
    });

    it("revocar: el editor deja de poder operar de inmediato (X12 de punta a punta)", async () => {
      await send("delete", "padmin", `/role-grants/${editorGrant}`, { reason: "baja" }).expect(200);
      await send("post", "peditor", "/jobs", { kind: "review_now", payload: { publication_key: "inegi.enoe" } }).expect(403);
      await send("delete", "padmin", `/role-grants/${editorGrant}`).expect(404);
      await send("delete", "padmin", "/role-grants/no-es-uuid").expect(404);
    });

    it("lecturas de administración con límite y orden", async () => {
      const audit = await get("padmin", "/audit?limit=3").expect(200);
      expect(audit.body.items).toHaveLength(3);
      expect(Number(audit.body.items[0].event_id)).toBeGreaterThan(Number(audit.body.items[1].event_id));
      for (const r of ["role-grants", "jobs", "publications", "unit-versions", "batches", "demand-groups", "packages"]) await get("padmin", `/${r}`).expect(200);
    });
  });

  describe("compuerta de afirmaciones por la API (CR-KL-001)", () => {
    it("sin referencia de aceptación: 422, FAILED y el evento de rechazo queda en KL; con referencia: 200; solo KL_ADMIN", async () => {
      const rejected = await send("post", "padmin", "/settings/r10-claims", { enabled: true }).expect(422);
      expect(rejected.body.error).toBe("REJECTED");
      expect((await klAudit("kl.r10_claims.rejected")).length).toBeGreaterThanOrEqual(1);
      expect((await adminAudit("kl.setting.r10_claims")).some((e) => e.request_id === rejected.headers["x-request-id"] && e.outcome === "FAILED")).toBe(true);
      await send("post", "psup", "/settings/r10-claims", { enabled: true, acceptanceRef: "CR-KL-001" }).expect(403);
      await send("post", "padmin", "/settings/r10-claims", { enabled: true, acceptanceRef: "CR-KL-001 aceptado 2026-10" }).expect(200);
      expect((await owner.query("SELECT r10_claims_enabled FROM kl.v_flags")).rows[0].r10_claims_enabled).toBe(true);
      await send("post", "padmin", "/settings/r10-claims", { enabled: false }).expect(200);
      expect((await owner.query("SELECT r10_claims_enabled FROM kl.v_flags")).rows[0].r10_claims_enabled).toBe(false);
      await send("post", "padmin", "/settings/r10-claims", {}).expect(422);
    });
  });

  describe("fuentes y retiro por la API", () => {
    it("KL_ADMIN decide la fuente y retira una unidad; nadie más", async () => {
      await mkUser("peditor2", "ADMIN");
      await send("post", "padmin", "/role-grants", { adminUserId: users.peditor2?.id, role: "KL_EDITOR" }).expect(201);
      await get("peditor2", "/me").expect(200);
      // el editor propone y crea contenido con las funciones de la base (la UI de edición llega en R2)
      const { withAttestation } = await import("../db/attested-tx");
      const { klAdmin } = await import("../service/admin-service");
      await withAttestation(klApp, { adminUserId: users.peditor2?.id as string, email: users.peditor2?.email as string, role: "ADMIN", sessionId: randomUUID() }, randomUUID(), async (tx) => {
        await klAdmin.proposeInstitution(tx, { key: "inst.api", name: "Inst", country: "MX", authorityClass: "A", kind: "public" });
        await klAdmin.proposePublication(tx, { key: "pub.api", institutionKey: "inst.api", title: "Pub", jurisdiction: "MX", officialUrl: "https://api.sintetico.example/x", permittedUse: "paraphrase_and_cite", defaultContentRisk: "low" });
      });
      await send("post", "peditor2", "/publications/pub.api/decision", { decision: "approve" }).expect(403);
      await send("post", "padmin", "/publications/pub.api/decision", { decision: "approve" }).expect(200, { status: "approved" });
      await send("post", "padmin", "/publications/pub.api/decision", { decision: "approve" }).expect(409);
      await send("post", "padmin", "/publications/pub.api/decision", { decision: "explotar" }).expect(422);
      await send("post", "padmin", "/publications/pub.api/decision", {}).expect(422);
      await send("post", "padmin", "/publications/NO%20VALE/decision", { decision: "approve" }).expect(404);
      await send("post", "padmin", "/units/no.existe/withdraw", { reason: "x" }).expect(404);
      await send("post", "padmin", "/units/no.existe/withdraw", {}).expect(422);
    });
  });

  describe("X06 · sesión y principal desactivados en el Control Center", () => {
    it("con admin_user.active = false la sesión no se resuelve, no se abre transacción en KL, la conciliación desactiva y solo una sesión válida reactiva", async () => {
      const u = users.peditor2 as { id: string; email: string };
      await get("peditor2", "/me").expect(200);
      expect((await owner.query("SELECT active FROM kl.principal WHERE principal_id = $1", [u.id])).rows[0].active).toBe(true);

      await updateAdminUser(platform, users.padmin?.id as string, u.id, { active: false }, now()); // revoca sus sesiones
      const before = await attestations();
      await get("peditor2", "/me").expect(401);
      expect(await attestations()).toBe(before); // no se abrió ninguna transacción certificada

      // X22 · la conciliación desactiva en el siguiente ciclo y nunca reactiva
      const r1 = await reconcilePrincipals({ beeside: platform, kl: klApp });
      expect(r1).toMatchObject({ skipped: false, deactivated: 1 });
      expect((await owner.query("SELECT active, deactivation_source FROM kl.principal WHERE principal_id = $1", [u.id])).rows[0]).toEqual({ active: false, deactivation_source: "reconciliation" });
      await updateAdminUser(platform, users.padmin?.id as string, u.id, { active: true }, now());
      const r2 = await reconcilePrincipals({ beeside: platform, kl: klApp });
      expect(r2.deactivated).toBe(0);
      expect((await owner.query("SELECT active FROM kl.principal WHERE principal_id = $1", [u.id])).rows[0].active).toBe(false); // sigue inactivo: la conciliación no reactiva

      // una sesión nueva y válida certifica y reactiva
      const s = await createAdminSession(platform, { adminUserId: u.id, role: "ADMIN", issuer: "https://idp.synthetic.test", now: now(), config: SESSION });
      users.peditor2 = { ...(users.peditor2 as object), token: s.token, sessionId: s.sessionId } as never;
      await get("peditor2", "/me").expect(200);
      expect((await owner.query("SELECT active, deactivated_at FROM kl.principal WHERE principal_id = $1", [u.id])).rows[0]).toEqual({ active: true, deactivated_at: null });
    });

    it("la conciliación corre en una sola instancia (bloqueo consultivo)", async () => {
      const holder = await klApp.connect();
      try {
        await holder.query("SELECT pg_advisory_lock($1)", [RECONCILE_LOCK_KEY]);
        expect(await reconcilePrincipals({ beeside: platform, kl: klApp })).toEqual({ skipped: true, checked: 0, deactivated: 0 });
      } finally {
        await holder.query("SELECT pg_advisory_unlock($1)", [RECONCILE_LOCK_KEY]);
        holder.release();
      }
    });
  });

  describe("fallo seguro (B8)", () => {
    it("X29: si la base principal no responde → 503 y no se abre la transacción de KL", async () => {
      const failing: Db = { query: (async () => { throw new Error("connect ECONNREFUSED beeside"); }) as Db["query"], transaction: (async () => { throw new Error("down"); }) as Db["transaction"] };
      const down = createApp({ kl: { platform: failing, session: SESSION, klApp, now } });
      const before = await attestations();
      const res = await request(down).get("/api/admin/kl/me").set(as("padmin")).expect(503);
      expect(res.body).toEqual({ error: "PLATFORM_UNAVAILABLE" });
      expect(await attestations()).toBe(before);
    });

    it("si beeside_kl no responde → 503 sin detalles; ni operación ni auditoría ALLOWED", async () => {
      const dead = klPool(roleUrl("kl_app").replace(/:\d+\//, ":1/"), 1);
      const down = createApp({ kl: { platform, session: SESSION, klApp: dead, now } });
      const auditBefore = (await beeside.query("SELECT count(*)::int AS n FROM admin_audit_event WHERE action = 'kl.me.read'")).rows[0].n;
      const res = await request(down).get("/api/admin/kl/me").set(as("padmin")).expect(503);
      expect(res.body.error).toBe("UNAVAILABLE");
      expect(JSON.stringify(res.body)).not.toMatch(/ECONN|5432|postgres/i);
      expect((await beeside.query("SELECT count(*)::int AS n FROM admin_audit_event WHERE action = 'kl.me.read'")).rows[0].n).toBe(auditBefore);
      await dead.end().catch(() => undefined);
    });

    it("identidad que no coincide con el principal registrado → 403, evento kl.identity_mismatch confirmado y nada se ejecuta", async () => {
      const tampering: Db = {
        transaction: (fn) => platform.transaction(fn),
        query: (async (text: string, values?: unknown[]) => {
          const r = await platform.query(text, values);
          if (/FROM admin_session s JOIN admin_user u/.test(text) && r.rows[0]) (r.rows[0] as Record<string, unknown>).auth_identity = "otra.persona@synthetic.test";
          return r;
        }) as Db["query"],
      };
      const spoof = createApp({ kl: { platform: tampering, session: SESSION, klApp, now } });
      const before = (await klAudit("kl.identity_mismatch")).length;
      const res = await request(spoof).get("/api/admin/kl/me").set(as("padmin")).expect(403);
      expect(res.body.error).toBe("IDENTITY_MISMATCH");
      expect((await klAudit("kl.identity_mismatch")).length).toBe(before + 1);
      expect((await adminAudit("kl.me.read")).some((e) => e.request_id === res.headers["x-request-id"] && e.outcome === "DENIED")).toBe(true);
    });
  });

  it("el router de administración genérico no se ve afectado: KL no comparte su montaje ni su sesión con otras rutas", async () => {
    await request(app).get("/api/admin/me").set(as("padmin")).expect(404);
  });
});
