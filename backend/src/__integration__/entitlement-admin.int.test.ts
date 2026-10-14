import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import request from "supertest";
import { provisionAdminUser } from "../admin/admin-users";
import { OidcIdentityProvider } from "../admin/oidc";
import { createConfigVersioningService } from "../config-versioning/service";
import { createApp } from "../index";
import { MANUFACTURER, describeWithDb, identity, runJourney, useHarness } from "./fa-harness";

const ISSUER = "https://idp.test";
const CLIENT_ID = "beeside-control-center";
const APP_ORIGIN = "https://admin.test";
const DAY = 86_400_000;
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: "jwk" }), kid: "test-key-1", use: "sig", alg: "RS256" };

function signIdToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key-1", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

describeWithDb("Admin entitlement API: grants, programs, sponsors, privacy — roles, governance and audit (PostgreSQL, rolled back)", () => {
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

  let seq = 0;
  async function project(): Promise<{ id: string; companyId: string }> {
    seq += 1;
    const start = await h.api().post("/api/fa/identity").send(identity({ email: `ent.admin${seq}@northwind-test.example` }));
    const token = start.body.sessionToken as string;
    await runJourney(h, token, MANUFACTURER);
    const { rows } = await h.client.query(
      "SELECT p.project_id, p.company_id FROM project p JOIN project_access_token t ON t.project_id = p.project_id WHERE t.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')",
      [token],
    );
    return { id: rows[0].project_id as string, companyId: rows[0].company_id as string };
  }

  async function people() {
    await provisionAdminUser(h.deps.db, { email: "ent.admin@beeside-ops.example", role: "ADMIN" }, h.clock.now);
    await provisionAdminUser(h.deps.db, { email: "ent.super@beeside-ops.example", role: "SUPER_ADMIN" }, h.clock.now);
    await provisionAdminUser(h.deps.db, { email: "ent.supervisor@beeside-ops.example", role: "SUPERVISOR" }, h.clock.now);
    return {
      admin: await login("ent.admin@beeside-ops.example", "sub-ent-admin"),
      superAdmin: await login("ent.super@beeside-ops.example", "sub-ent-super"),
      supervisor: await login("ent.supervisor@beeside-ops.example", "sub-ent-supervisor"),
    };
  }

  it("an ADMIN grants, extends and ends an individual exception; the status shows source, dates, approver and reason; the audit keeps codes only", async () => {
    const { admin, supervisor } = await people();
    const p = await project();

    const before = await get(admin, `/projects/${p.id}/entitlement`);
    expect(before.status).toBe(200);
    expect(before.body.sources).toEqual([]);
    expect(before.body.privacy.state).toBe("open");

    const requestId = randomUUID();
    const granted = await post(admin, `/projects/${p.id}/entitlement/grants`, { source: "complimentary", days: 30, reason: "design partner onboarding for Acme", requestId });
    expect(granted.status).toBe(201);
    // a retry of the same request is not a second grant
    const again = await post(admin, `/projects/${p.id}/entitlement/grants`, { source: "complimentary", days: 30, reason: "design partner onboarding for Acme", requestId });
    expect(again.body.grant.grant_id).toBe(granted.body.grant.grant_id);

    const status = await get(supervisor, `/projects/${p.id}/entitlement`); // a SUPERVISOR can review
    expect(status.body.entitlement).toMatchObject({ premium_access_active: true, precision_access_mode: "FULL" });
    expect(status.body.sources).toHaveLength(1);
    expect(status.body.sources[0]).toMatchObject({ source: "complimentary", closed: false });
    expect(status.body.grants).toHaveLength(1);
    expect(status.body.grants[0]).toMatchObject({ source: "complimentary", approved_by_identity: "ent.admin@beeside-ops.example", reason: "design partner onboarding for Acme" });
    expect(new Date(status.body.coveredUntil).getTime()).toBeGreaterThan(h.clock.now.getTime() + 29 * DAY);

    // extension chains from the end of the previous grant
    const ext = await post(admin, `/entitlement/grants/${granted.body.grant.grant_id}/extend`, { days: 15, reason: "needs the extra time" });
    expect(ext.status).toBe(201);
    expect(new Date(ext.body.grant.starts_at).getTime()).toBe(new Date(granted.body.grant.ends_at).getTime());
    const covered = (await get(admin, `/projects/${p.id}/entitlement`)).body.coveredUntil;
    expect(new Date(covered).getTime()).toBeGreaterThan(h.clock.now.getTime() + 44 * DAY);

    // ending: write-once, the access falls back (READ_ONLY) when nothing else is valid
    // the chained extension has not started yet: ending it voids it (it never grants a day)
    expect((await post(admin, `/entitlement/grants/${ext.body.grant.grant_id}/terminate`, { reason: "closed by request" })).status).toBe(200);
    expect(new Date((await get(admin, `/projects/${p.id}/entitlement`)).body.coveredUntil).getTime()).toBeLessThan(h.clock.now.getTime() + 31 * DAY);
    expect((await post(admin, `/entitlement/grants/${granted.body.grant.grant_id}/terminate`, { reason: "closed by request" })).status).toBe(200);
    expect((await get(admin, `/projects/${p.id}/entitlement`)).body.entitlement).toMatchObject({ premium_access_active: false, precision_access_mode: "READ_ONLY" });
    expect((await post(admin, `/entitlement/grants/${granted.body.grant.grant_id}/extend`, { days: 5, reason: "x" })).status).toBe(409);

    // audit: actions present, free-text reasons absent
    const audit = await h.client.query("SELECT action, outcome, details::text AS details FROM admin_audit_event WHERE action LIKE 'entitlement.%' ORDER BY occurred_at");
    const actions = audit.rows.map((r) => `${r.action}:${r.outcome}`);
    expect(actions).toEqual(expect.arrayContaining(["entitlement.grant_issued:ALLOWED", "entitlement.grant_extended:ALLOWED", "entitlement.grant_terminated:ALLOWED", "entitlement.grant_extended:FAILED"]));
    for (const row of audit.rows) expect(row.details).not.toMatch(/Acme|design partner|extra time|closed by request/);
    expect(audit.rows.find((r) => r.action === "entitlement.grant_issued")?.details).toMatch(/complimentary/);
  });

  it("refuses by role and by rule: SUPERVISOR is read-only; ADMIN cannot do company-level, program, sponsor or privacy decisions; long grants need an elevated approver", async () => {
    const { admin, superAdmin, supervisor } = await people();
    const p = await project();

    for (const [path, payload] of [
      [`/projects/${p.id}/entitlement/grants`, { source: "manual", days: 10, reason: "r" }],
      [`/companies/${p.companyId}/entitlement/grants`, { source: "manual", companyScope: "current_projects", days: 10, reason: "r" }],
      ["/entitlement/sponsors", { name: "Cámara", kind: "chamber" }],
      [`/projects/${p.id}/privacy`, { event: "access_blocked", reasonCode: "legal_order" }],
    ] as Array<[string, unknown]>) {
      const res = await post(supervisor, path, payload);
      expect([path, res.status, res.body.error]).toEqual([path, 403, "FORBIDDEN"]);
    }
    for (const [path, payload] of [
      [`/companies/${p.companyId}/entitlement/grants`, { source: "manual", companyScope: "current_projects", days: 10, reason: "r" }],
      ["/entitlement/sponsors", { name: "Cámara Nacional", kind: "chamber" }],
      ["/entitlement/programs", { code: "mx-test", name: "t", kind: "promotion", grantDays: 10, startsAt: new Date(h.clock.now.getTime() - DAY).toISOString(), endsAt: new Date(h.clock.now.getTime() + DAY).toISOString(), reason: "r" }],
      [`/projects/${p.id}/privacy`, { event: "access_blocked", reasonCode: "legal_order" }],
    ] as Array<[string, unknown]>) {
      const res = await post(admin, path, payload);
      expect([path, res.status, res.body.error]).toEqual([path, 403, "FORBIDDEN"]);
    }
    // source "sponsored"/"promotion" cannot be issued directly: it must come from a program
    expect((await post(admin, `/projects/${p.id}/entitlement/grants`, { source: "sponsored", days: 10, reason: "r" })).status).toBe(400);
    // a long exception is an elevated decision: refused for ADMIN, accepted for SUPER_ADMIN
    const longByAdmin = await post(admin, `/projects/${p.id}/entitlement/grants`, { source: "manual", days: 500, reason: "long" });
    expect(longByAdmin.status).toBe(400);
    expect((await post(superAdmin, `/projects/${p.id}/entitlement/grants`, { source: "manual", days: 500, reason: "long" })).status).toBe(201);
    // no CSRF header, no write
    expect((await app().post(`/api/admin/projects/${p.id}/entitlement/grants`).set("Cookie", admin).send({ source: "manual", days: 5, reason: "r" })).status).toBe(403);

    const denied = await h.client.query("SELECT count(*)::int AS n FROM admin_audit_event WHERE outcome = 'DENIED' AND action LIKE ANY (ARRAY['entitlement.%','privacy.%'])");
    expect(denied.rows[0].n).toBeGreaterThanOrEqual(8);
  });

  it("a SUPER_ADMIN runs a sponsored program end to end: sponsor, listed eligibility, activation, redemption by quota and eligibility, then closes it", async () => {
    const { admin, superAdmin } = await people();
    const eligible = await project();
    const outsider = await project();

    const sponsor = await post(superAdmin, "/entitlement/sponsors", { name: "Secretaría de Economía", kind: "government", country: "mx" });
    expect(sponsor.status).toBe(201);
    expect(sponsor.body.sponsor.country).toBe("MX");
    expect((await post(superAdmin, "/entitlement/sponsors", { name: "secretaría de economía", kind: "government" })).status).toBe(409);

    const programBody = {
      code: "mx-export-2026", name: "Exportadores MX", kind: "sponsored", sponsorId: sponsor.body.sponsor.sponsor_id, agreementRef: "AGR-2026-001",
      marketScope: ["mx"], grantDays: 90, startsAt: new Date(h.clock.now.getTime() - DAY).toISOString(), endsAt: new Date(h.clock.now.getTime() + 60 * DAY).toISOString(),
      maxRedemptions: 1, eligibility: "listed", reason: "sponsored export programme",
    };
    // a sponsored program without a sponsor is refused (data rule)
    expect((await post(superAdmin, "/entitlement/programs", { ...programBody, code: "mx-nosponsor", sponsorId: undefined })).status).toBe(400);
    const program = await post(superAdmin, "/entitlement/programs", programBody);
    expect(program.status).toBe(201);
    const programId = program.body.program.program_id as string;

    // not active yet
    expect((await post(admin, `/entitlement/programs/${programId}/redeem`, { projectId: eligible.id, market: "MX" })).status).toBe(409);
    expect((await post(superAdmin, `/entitlement/programs/${programId}/eligibility`, { companyId: eligible.companyId })).status).toBe(201);
    expect((await post(admin, `/entitlement/programs/${programId}/activate`)).status).toBe(403);
    expect((await post(superAdmin, `/entitlement/programs/${programId}/activate`)).status).toBe(200);

    // the operator does not choose terms: market, eligibility and quota come from the rule
    expect((await post(admin, `/entitlement/programs/${programId}/redeem`, { projectId: eligible.id, market: "CO" })).status).toBe(409);
    expect((await post(admin, `/entitlement/programs/${programId}/redeem`, { projectId: outsider.id, market: "MX" })).status).toBe(409);
    const redeemed = await post(admin, `/entitlement/programs/${programId}/redeem`, { projectId: eligible.id, market: "MX" });
    expect(redeemed.status).toBe(201);
    expect(redeemed.body.grant).toMatchObject({ source: "sponsored", program_id: programId });
    // a repeated redemption of the same project is a retry, not a second grant
    const retry = await post(admin, `/entitlement/programs/${programId}/redeem`, { projectId: eligible.id, market: "MX" });
    expect(retry.body.grant.grant_id).toBe(redeemed.body.grant.grant_id);

    // the beneficiary sees a sponsored source; the sponsor is visible to Admin only through the program, never as data access
    const status = (await get(admin, `/projects/${eligible.id}/entitlement`)).body;
    expect(status.entitlement.precision_access_mode).toBe("FULL");
    expect(status.grants[0]).toMatchObject({ source: "sponsored", program_code: "mx-export-2026" });
    const detail = (await get(admin, `/entitlement/programs/${programId}`)).body;
    expect(detail.program).toMatchObject({ status: "active", sponsor_name: "Secretaría de Economía", redemptions: 1, eligible_companies: 1 });

    expect((await post(superAdmin, `/entitlement/programs/${programId}/close`)).status).toBe(200);
    expect((await get(admin, "/entitlement/programs")).body.programs[0].status).toBe("closed");
  });

  it("company-level grants are explicit and capped; privacy blocks override any entitlement and show in the status", async () => {
    const { admin, superAdmin } = await people();
    const p = await project();

    const company = await post(superAdmin, `/companies/${p.companyId}/entitlement/grants`, { source: "partner", companyScope: "current_projects", maxProjects: 1, days: 30, reason: "partner agreement" });
    expect(company.status).toBe(201);
    expect(company.body.grant).toMatchObject({ company_scope: "current_projects", max_projects: 1 });
    // no scope, no company grant
    expect((await post(superAdmin, `/companies/${p.companyId}/entitlement/grants`, { source: "partner", days: 30, reason: "no scope" })).status).toBe(400);
    expect((await get(admin, `/projects/${p.id}/entitlement`)).body.entitlement.precision_access_mode).toBe("FULL");

    expect((await post(admin, `/projects/${p.id}/privacy`, { event: "access_blocked", reasonCode: "legal_order" })).status).toBe(403);
    expect((await post(superAdmin, `/projects/${p.id}/privacy`, { event: "access_blocked", reasonCode: "erasure_request" })).status).toBe(201);
    const blocked = (await get(admin, `/projects/${p.id}/entitlement`)).body;
    expect(blocked.privacy).toMatchObject({ state: "blocked", reason_code: "erasure_request" });
    // a grant cannot be issued over a blocked project
    expect((await post(admin, `/projects/${p.id}/entitlement/grants`, { source: "manual", days: 5, reason: "x" })).status).toBe(409);
    expect((await post(superAdmin, `/projects/${p.id}/privacy`, { event: "access_restored", reasonCode: "other" })).status).toBe(201);
    expect((await get(admin, `/projects/${p.id}/entitlement`)).body.privacy.state).toBe("open");
    const audit = await h.client.query("SELECT details::text AS details FROM admin_audit_event WHERE action = 'privacy.event_recorded' AND outcome = 'ALLOWED'");
    expect(audit.rows).toHaveLength(2);
    for (const row of audit.rows) expect(row.details).toMatch(/reason_code/);
    expect(audit.rows.map((r) => r.details).join()).toMatch(/erasure_request/);
  });
});
