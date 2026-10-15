import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import request from "supertest";
import { provisionAdminUser } from "../admin/admin-users";
import { OidcIdentityProvider } from "../admin/oidc";
import { createConfigVersioningService } from "../config-versioning/service";
import { createApp } from "../index";
import { describeWithDb, useHarness } from "./fa-harness";
import { createPgDemandRepository } from "../precision/knowledge/pg-repo";
import { describeDemand } from "../precision/knowledge/demand";
import { emptyFrame } from "../precision/understanding/types";

const ISSUER = "https://idp.test";
const CLIENT_ID = "beeside-control-center";
const APP_ORIGIN = "https://admin.test";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: "jwk" }), kid: "test-key-1", use: "sig", alg: "RS256" };

function signIdToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key-1", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

describeWithDb("Admin Country Resource Library: roles, validation, versioned editions and audit (PostgreSQL, rolled back)", () => {
  const h = useHarness();
  let pending: Record<string, unknown> = {};
  const fakeFetch = async (url: string) => {
    const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b });
    if (url === `${ISSUER}/.well-known/openid-configuration`) return ok({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks` });
    if (url === `${ISSUER}/jwks`) return ok({ keys: [JWK] });
    if (url === `${ISSUER}/token`) {
      const nowSeconds = Math.floor(h.clock.now.getTime() / 1000);
      return ok({ id_token: signIdToken({ iss: ISSUER, aud: CLIENT_ID, iat: nowSeconds, exp: nowSeconds + 300, email_verified: true, ...pending }) });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const provider = new OidcIdentityProvider({ issuer: ISSUER, clientId: CLIENT_ID, clientSecret: "test-client-secret", redirectUri: "https://admin.test/api/admin/auth/callback" }, fakeFetch, () => h.clock.now);
  const session = { sessionSecret: "admin-integration-session-secret-0123456789", sessionTtlMinutes: 480, idleTimeoutMinutes: 30, cookieSecure: true, appOrigin: APP_ORIGIN };
  const app = () => request(createApp({ fa: h.deps, admin: { fa: h.deps, identity: provider, session, configService: createConfigVersioningService(h.deps.db) } })) as unknown as request.SuperTest<request.Test>;

  async function login(email: string, sub: string): Promise<string> {
    const start = await app().get("/api/admin/auth/login?returnTo=/admin/projects");
    const location = new URL(start.headers.location as string);
    const loginCookie = (start.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("beeside_admin_login="))?.split(";")[0] ?? "";
    pending = { sub, email, nonce: location.searchParams.get("nonce") };
    const callback = await app().get(`/api/admin/auth/callback?code=code-${randomUUID()}&state=${location.searchParams.get("state")}`).set("Cookie", loginCookie);
    const cookies = (callback.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
    const cookie = cookies.map((c) => c.split(";")[0] ?? "").find((c) => c.startsWith("beeside_admin_session=") && c !== "beeside_admin_session=");
    expect(cookie).toBeTruthy();
    return cookie as string;
  }
  const get = (cookie: string, path: string) => app().get(`/api/admin${path}`).set("Cookie", cookie);
  const post = (cookie: string, path: string, b: unknown = {}) => app().post(`/api/admin${path}`).set("Cookie", cookie).set("X-Beeside-Admin", "1").send(b as object);

  const put = (cookie: string, path: string, b: unknown = {}) => app().put(`/api/admin${path}`).set("Cookie", cookie).set("X-Beeside-Admin", "1").send(b as object);

  async function people() {
    await provisionAdminUser(h.deps.db, { email: "res.admin@beeside-ops.example", role: "ADMIN" }, h.clock.now);
    await provisionAdminUser(h.deps.db, { email: "res.supervisor@beeside-ops.example", role: "SUPERVISOR" }, h.clock.now);
    return { admin: await login("res.admin@beeside-ops.example", "sub-res-admin"), supervisor: await login("res.supervisor@beeside-ops.example", "sub-res-supervisor") };
  }

  it("ADMIN manages guides per country (https only, new edition supersedes, deactivation is reversible); SUPERVISOR only reads; audit keeps ids not URLs", async () => {
    const { admin, supervisor } = await people();
    const base = { countryCode: "mx", title: "Doing business in Mexico", language: "es", version: "2026.1", topic: "legal_entity", destination: { kind: "url", ref: "https://guides.example.test/mx-2026-1" } };

    expect((await post(supervisor, "/precision/country-resources", base)).status).toBe(403);
    expect((await post(admin, "/precision/country-resources", { ...base, destination: { kind: "url", ref: "http://insecure.example.test/x" } })).status).toBe(400);
    expect((await post(admin, "/precision/country-resources", { ...base, countryCode: "MEX" })).status).toBe(400);

    const first = await post(admin, "/precision/country-resources", base);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ countryCode: "MX", active: true, destination: { kind: "url" } });

    const second = await post(admin, "/precision/country-resources", { ...base, version: "2026.2", destination: { kind: "url", ref: "https://guides.example.test/mx-2026-2" } });
    expect(second.status).toBe(201);

    const listed = await get(supervisor, "/precision/country-resources?countryCode=MX");
    expect(listed.status).toBe(200);
    expect((listed.body.resources as Array<{ id: string }>).map((r) => r.id)).toEqual(expect.arrayContaining([first.body.id, second.body.id]));

    const off = await post(admin, `/precision/country-resources/${second.body.id}/deactivate`);
    expect(off.body.active).toBe(false);
    const on = await post(admin, `/precision/country-resources/${second.body.id}/activate`);
    expect(on.body.active).toBe(true);
    const edited = await put(admin, `/precision/country-resources/${first.body.id}`, { version: "2026.1b" });
    expect(edited.body).toMatchObject({ version: "2026.1b", title: base.title });
    expect((await put(admin, `/precision/country-resources/${randomUUID()}`, { version: "x" })).status).toBe(404);

    const { rows } = await h.client.query("SELECT details FROM admin_audit_event WHERE action LIKE 'country_resource.%' ORDER BY occurred_at");
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(rows)).not.toContain("guides.example.test");

    // V1 (no document management): a document without a URL is a draft; it can never be made active for customers
    const draft = await post(admin, "/precision/country-resources", { ...base, version: "draft", title: "Borrador sin URL", destination: { kind: "document", ref: "docs/borrador-mx" } });
    expect(draft.status).toBe(201);
    expect(draft.body.active).toBe(false);
    expect((await post(admin, `/precision/country-resources/${draft.body.id}/activate`)).status).toBe(400);
    expect((await post(admin, "/precision/country-resources", { ...base, version: "x1", title: "Otro borrador", active: true, destination: { kind: "document", ref: "docs/otro" } })).status).toBe(400);
    // once it has a resolvable https URL it can go live (same resource, new destination)
    const fixed = await put(admin, `/precision/country-resources/${draft.body.id}`, { destination: { kind: "url", ref: "https://guides.example.test/borrador-publicado" } });
    expect(fixed.status).toBe(200);
    expect((await post(admin, `/precision/country-resources/${draft.body.id}/activate`)).body.active).toBe(true);
    // the database enforces the same rule
    await h.client.query("SAVEPOINT raw_doc");
    await expect(h.client.query("INSERT INTO country_resource (id, country_code, title, language, version, destination_kind, destination_ref, active, updated_at) VALUES ('raw-doc','MX','raw','es','1','document','docs/raw',true,'2026-10-14')")).rejects.toThrow(/country_resource_active_resolvable/);
    await h.client.query("ROLLBACK TO SAVEPOINT raw_doc");

    const sources = await get(supervisor, "/precision/knowledge/sources");
    expect(sources.status).toBe(200);
    expect(Array.isArray(sources.body.sources)).toBe(true);
  });

  it("knowledge demand and KSeed status: readable by SUPERVISOR, decided only by ADMIN, audited; recurrence alone never changes the status", async () => {
    const { admin, supervisor } = await people();
    const repo = createPgDemandRepository(h.deps.db);
    const frame = emptyFrame("es");
    frame.countries.push({ code: "MX", role: "operation", provenance: "client_stated", at: "2026-10-15T10:00:00.000Z" } as never);
    const d = describeDemand(frame, "¿Qué requisitos tiene el IMMEX para una importación temporal?", { coverage: "none", reason: "no_hits" })!;
    const now = h.clock.now.toISOString();
    for (let i = 0; i < 3; i++) await repo.register(d, { projectId: `p${i}`, turnKey: "t1" }, now);

    const listed = await get(supervisor, "/precision/knowledge/demand?topic=customs&minOccurrences=2");
    expect(listed.status).toBe(200);
    const row = (listed.body.demand as Array<{ id: string; occurrences: number; projects: number; status: string; subtopic: string }>)[0]!;
    expect(row).toMatchObject({ occurrences: 3, projects: 3, status: "open", subtopic: "duty_regimes" });
    expect((await get(supervisor, "/precision/knowledge/demand?status=published")).status).toBe(400);

    expect((await post(supervisor, `/precision/knowledge/demand/${row.id}/decision`, { status: "accepted_for_curation" })).status).toBe(403);
    expect((await post(admin, `/precision/knowledge/demand/${row.id}/decision`, { status: "published" })).status).toBe(400);
    expect((await post(admin, `/precision/knowledge/demand/missing/decision`, { status: "declined" })).status).toBe(404);
    const decided = await post(admin, `/precision/knowledge/demand/${row.id}/decision`, { status: "accepted_for_curation", note: "Prioridad V1: aduanas" });
    expect(decided.status).toBe(200);
    expect(decided.body).toMatchObject({ status: "accepted_for_curation", decisionNote: "Prioridad V1: aduanas" });
    await repo.register(d, { projectId: "p9", turnKey: "t1" }, now);
    expect((await repo.get(row.id))!.status).toBe("accepted_for_curation");

    const kseed = await get(supervisor, "/precision/knowledge/kseed");
    expect(kseed.status).toBe(200);
    expect(kseed.body.assessment.length).toBeGreaterThanOrEqual(20);
    expect(kseed.body.report).toContain("# KSeed — estado y brechas");
    expect(kseed.body.report).toContain("Demanda de conocimiento observada");

    const { rows } = await h.client.query("SELECT action FROM admin_audit_event WHERE action LIKE 'knowledge_demand.%' OR action = 'kseed.viewed'");
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["knowledge_demand.viewed", "knowledge_demand.decided", "kseed.viewed"]));
  });
});
