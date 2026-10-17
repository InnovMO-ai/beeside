import { randomUUID } from "node:crypto";
import request from "supertest";
import { Client, Pool } from "pg";
import { ADMIN_SESSION_COOKIE, AdminSessionConfig, createAdminSession } from "../../admin/admin-session";
import { provisionAdminUser } from "../../admin/admin-users";
import { Db, createPoolDb } from "../../db/database";
import { createApp } from "../../index";
import { klPool } from "../db/pools";
import { bootstrapAdmin } from "../identity/bootstrap-admin";
import { connectAs, freshBeesideDatabase, freshKlDatabase, roleUrl, superUrl } from "./env";

/** Escenario HTTP: beeside efímera (sesiones del Control Center), beeside_kl efímera y la app con el router de KL montado. */
export const SESSION: AdminSessionConfig = { sessionSecret: "s".repeat(40), sessionTtlMinutes: 480, idleTimeoutMinutes: 30, cookieSecure: false, appOrigin: "https://admin.test" };
export const WRITE_HEADERS = { "x-beeside-admin": "1", origin: SESSION.appOrigin };

export interface ApiUser {
  id: string;
  email: string;
  token: string;
  sessionId: string;
}

export interface ApiHarness {
  beeside: Pool;
  platform: Db;
  klApp: Pool;
  owner: Client;
  app: ReturnType<typeof createApp>;
  users: Record<string, ApiUser>;
  mkUser(label: string, role: "ADMIN" | "SUPERVISOR"): Promise<ApiUser>;
  get(label: string, path: string): request.Test;
  send(method: "post" | "delete" | "patch" | "put", label: string, path: string, body?: object): request.Test;
  adminAudit(action: string): Promise<{ outcome: string; request_id: string | null; actor_type: string }[]>;
  klAudit(action: string): Promise<{ actor_principal_id: string; request_id: string | null; entity_id: string | null; reason: string | null }[]>;
  close(): Promise<void>;
}

export async function startApiHarness(adminLabel = "padmin"): Promise<ApiHarness> {
  await freshBeesideDatabase();
  await freshKlDatabase();
  const beeside = new Pool({ connectionString: superUrl("beeside") });
  const platform = createPoolDb(beeside);
  const klApp = klPool(roleUrl("kl_app"), 3);
  const owner = await connectAs("kl_owner");
  const now = () => new Date();
  const users: Record<string, ApiUser> = {};
  const mkUser = async (label: string, role: "ADMIN" | "SUPERVISOR") => {
    const email = `${label}.${randomUUID().slice(0, 6)}@synthetic.test`;
    const u = await provisionAdminUser(platform, { email, role }, now());
    const s = await createAdminSession(platform, { adminUserId: u.adminUserId, role, issuer: "https://idp.synthetic.test", now: now(), config: SESSION });
    users[label] = { id: u.adminUserId, email, token: s.token, sessionId: s.sessionId };
    return users[label] as ApiUser;
  };
  const app = createApp({ kl: { platform, session: SESSION, klApp, now } });
  const cookie = (label: string) => ({ Cookie: `${ADMIN_SESSION_COOKIE}=${users[label]?.token}` });
  const h: ApiHarness = {
    beeside, platform, klApp, owner, app, users, mkUser,
    get: (label, path) => request(app).get(`/api/admin/kl${path}`).set(cookie(label)),
    send: (method, label, path, body) => request(app)[method](`/api/admin/kl${path}`).set(cookie(label)).set(WRITE_HEADERS).send(body ?? {}),
    adminAudit: async (action) => (await beeside.query("SELECT outcome, actor_type, request_id FROM admin_audit_event WHERE action = $1 ORDER BY occurred_at", [action])).rows,
    klAudit: async (action) => (await owner.query("SELECT actor_principal_id, request_id::text AS request_id, entity_id, reason FROM kl.audit_event WHERE action = $1 ORDER BY event_id", [action])).rows,
    close: async () => {
      await klApp.end();
      await owner.end();
      await beeside.end();
    },
  };
  // El primer KL_ADMIN nace por el arranque auditado (B4), nunca por migración.
  await mkUser(adminLabel, "ADMIN");
  await bootstrapAdmin({ beeside: platform, klOwnerUrl: roleUrl("kl_owner") }, users[adminLabel]?.email as string);
  return h;
}
