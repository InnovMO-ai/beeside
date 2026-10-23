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

  it("privacy erasure: SUPER_ADMIN only; policy first, dry run, typed confirmation, then executed once; `anonymized` cannot be recorded by hand; the audit keeps counts, never content", async () => {
    const { admin, superAdmin, supervisor } = await people();
    const p = await project();
    await h.client.query("UPDATE privacy_policy SET status = 'retired', retired_at = now() WHERE status = 'approved'");

    // roles: nobody below SUPER_ADMIN can read, approve, plan or execute
    for (const cookie of [admin, supervisor]) {
      expect((await get(cookie, "/privacy/policy")).status).toBe(403);
      expect((await post(cookie, "/privacy/policy", { minDaysAfterBlock: 0, retainLegalAcceptance: false })).status).toBe(403);
      expect((await get(cookie, `/projects/${p.id}/privacy/erasure`)).status).toBe(403);
      expect((await post(cookie, `/projects/${p.id}/privacy/erasure`, { confirmProjectId: p.id })).status).toBe(403);
    }
    // no policy: the dry run says so, the execution is refused (and recorded as refused)
    expect((await get(superAdmin, "/privacy/policy")).body.policy).toBeNull();
    expect((await get(superAdmin, `/projects/${p.id}/privacy/erasure`)).body.plan).toMatchObject({ eligible: false, reason: "no_approved_policy" });
    const refused = await post(superAdmin, `/projects/${p.id}/privacy/erasure`, { confirmProjectId: p.id });
    expect(refused.status).toBe(409);
    expect(refused.body.result).toMatchObject({ eligible: false, reason: "no_approved_policy" });

    // the policy is a decision with explicit terms
    expect((await post(superAdmin, "/privacy/policy", { minDaysAfterBlock: -1, retainLegalAcceptance: false })).status).toBe(400);
    expect((await post(superAdmin, "/privacy/policy", { minDaysAfterBlock: 0 })).status).toBe(400);
    const approved = await post(superAdmin, "/privacy/policy", { minDaysAfterBlock: 0, retainLegalAcceptance: false });
    expect(approved.status).toBe(201);
    expect((await get(superAdmin, "/privacy/policy")).body.policy).toMatchObject({ min_days_after_block: 0, retain_legal_acceptance: false, version: approved.body.policy.version });

    // not blocked yet; `anonymized` is never recorded by hand
    expect((await get(superAdmin, `/projects/${p.id}/privacy/erasure`)).body.plan).toMatchObject({ eligible: false, reason: "not_blocked" });
    expect((await post(superAdmin, `/projects/${p.id}/privacy`, { event: "anonymized", reasonCode: "erasure_request" })).status).toBe(400);
    expect((await post(superAdmin, `/projects/${p.id}/privacy`, { event: "access_blocked", reasonCode: "erasure_request" })).status).toBe(201);
    h.advanceMinutes(2);

    const dry = (await get(superAdmin, `/projects/${p.id}/privacy/erasure`)).body;
    expect(dry.plan).toMatchObject({ eligible: true });
    expect(dry.plan.would_delete.answer).toBeGreaterThan(0);
    // an irreversible action needs the project id typed back
    expect((await post(superAdmin, `/projects/${p.id}/privacy/erasure`, {})).status).toBe(400);
    expect((await post(superAdmin, `/projects/${p.id}/privacy/erasure`, { confirmProjectId: randomUUID() })).status).toBe(400);
    expect(await h.client.query("SELECT 1 FROM answer WHERE project_id = $1", [p.id]).then((r) => r.rows.length)).toBeGreaterThan(0);

    const done = await post(superAdmin, `/projects/${p.id}/privacy/erasure`, { confirmProjectId: p.id });
    expect(done.status).toBe(200);
    expect(done.body.result).toMatchObject({ eligible: true, executed: true, deleted_rows: dry.plan.would_delete });
    expect(await h.client.query("SELECT 1 FROM answer WHERE project_id = $1", [p.id]).then((r) => r.rows.length)).toBe(0);
    expect((await post(superAdmin, `/projects/${p.id}/privacy/erasure`, { confirmProjectId: p.id })).body.result).toMatchObject({ eligible: false, reason: "already_erased" });
    const state = (await get(admin, `/projects/${p.id}/entitlement`)).body;
    expect(state.privacy.state).toBe("anonymized");
    expect(state.entitlement?.precision_access_mode ?? "REVOKED").not.toBe("FULL");

    // the Admin read models still answer for an erased project (no 500s on missing content)
    for (const path of ["", "/answers", "/snapshot", "/internal-assessment", "/premium"]) expect((await get(admin, `/projects/${p.id}${path}`)).status).toBeLessThan(500);

    const audit = await h.client.query("SELECT action, outcome, details::text AS details FROM admin_audit_event WHERE action LIKE 'privacy.erasure%' OR action = 'privacy.policy_approved' ORDER BY occurred_at, audit_id");
    expect(audit.rows.map((r) => `${r.action}:${r.outcome}`)).toEqual(expect.arrayContaining(["privacy.policy_approved:ALLOWED", "privacy.erasure_executed:ALLOWED", "privacy.erasure_planned:ALLOWED"]));
    const executed = audit.rows.find((r) => r.action === "privacy.erasure_executed" && /executed/.test(r.details));
    expect(executed?.details).toMatch(/deleted_rows/);
    expect(audit.rows.map((r) => r.details).join()).not.toMatch(/Ana|Rivera|Northwind|@/);
  });

  it("Precision statistics: every role can read the canonical metrics (aggregates only); the audit records the view, not the data", async () => {
    const { supervisor } = await people();
    const catalog = await get(supervisor, "/analytics/precision/catalog");
    expect(catalog.status).toBe(200);
    expect(catalog.body.metrics.length).toBeGreaterThan(20);
    for (const [path, key] of [["funnel", "stages"], ["quality", "addService"], ["ai", "bySurface"], ["commercial", "period"]] as const) {
      const res = await get(supervisor, `/analytics/precision/${path}?from=2026-01-01&to=2026-12-31`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty(key);
    }
    expect((await get(supervisor, "/analytics/precision/funnel?from=2026-12-31&to=2026-01-01")).status).toBe(400);
    const audit = await h.client.query("SELECT details::text AS d FROM admin_audit_event WHERE action = 'analytics.viewed' AND details::text LIKE '%precision_%'");
    expect(audit.rows.length).toBeGreaterThanOrEqual(5);
  });
  it("Precision links and routes: effective value + source per audience, validated versioned writes, reset, role limits; the audit never carries the value", async () => {
    const { admin, supervisor } = await people();
    // other suites commit configuration rows; this test runs inside the rolled-back harness transaction and starts from a clean table
    await h.client.query("DELETE FROM precision_config");
    const put = (cookie: string, key: string, b: unknown) => app().put(`/api/admin/precision/config/${key}`).set("Cookie", cookie).set("X-Beeside-Admin", "1").send(b as object);
    const del = (cookie: string, key: string, locale: string) => app().delete(`/api/admin/precision/config/${key}?locale=${locale}`).set("Cookie", cookie).set("X-Beeside-Admin", "1");
    const entry = (body: { entries: Array<{ key: string; effective: Array<{ locale: string; value: string | null; source: string }> }> }, key: string, locale: string) =>
      body.entries.find((e) => e.key === key)?.effective.find((x) => x.locale === locale);

    const initial = await get(supervisor, "/precision/config");
    expect(initial.status).toBe(200);
    expect(entry(initial.body, "privacy_url", "es")?.source).toBe("default");
    expect(entry(initial.body, "operation_hub_url", "en")).toEqual({ locale: "en", value: null, source: "unset", });

    // read-only role cannot write
    expect((await put(supervisor, "operation_hub_url", { locale: "*", value: "https://hub.example.test/p", reason: "x" })).status).toBe(403);

    // validation: https or site-relative only, a reason is required, keys are a closed list
    expect((await put(admin, "operation_hub_url", { locale: "*", value: "http://insecure.example.test", reason: "x" })).status).toBe(400);
    expect((await put(admin, "operation_hub_url", { locale: "*", value: "javascript:alert(1)", reason: "x" })).status).toBe(400);
    expect((await put(admin, "operation_hub_url", { locale: "*", value: "https://hub.example.test/p" })).status).toBe(400);
    expect((await put(admin, "operation_hub_url", { locale: "fr", value: "https://hub.example.test/p", reason: "x" })).status).toBe(400);
    expect((await put(admin, "analytics.resume_gap_minutes", { locale: "*", value: "https://x.example.test", reason: "x" })).status).toBe(404);
    expect((await put(admin, "contact_beeside_email", { locale: "*", value: "not-an-email", reason: "x" })).status).toBe(400);

    // set -> effective in both audiences with source admin; a locale override wins over '*'
    expect((await put(admin, "operation_hub_url", { locale: "*", value: "https://hub.example.test/p", reason: "go live" })).body.version).toBe(1);
    expect((await put(admin, "operation_hub_url", { locale: "*", value: "https://hub.example.test/p2", reason: "new path" })).body.version).toBe(2);
    expect((await put(admin, "operation_hub_url", { locale: "es", value: "https://hub.example.test/es", reason: "spanish hub" })).status).toBe(200);
    const after = await get(admin, "/precision/config");
    expect(entry(after.body, "operation_hub_url", "en")).toEqual({ locale: "en", value: "https://hub.example.test/p2", source: "admin", adminLocale: "*" });
    expect(entry(after.body, "operation_hub_url", "es")).toMatchObject({ value: "https://hub.example.test/es", source: "admin", adminLocale: "es" });

    // the runtime resolver reads exactly what Admin wrote (same rows, no second path)
    const { configUrl } = await import("../precision/domain/config");
    expect(await configUrl(h.deps.db, "operation_hub_url", "en")).toBe("https://hub.example.test/p2");

    // history is kept: one active row per (key, locale), older versions inactive
    const rows = await h.client.query("SELECT version, is_active FROM precision_config WHERE key = 'operation_hub_url' AND locale = '*' ORDER BY version");
    expect(rows.rows).toEqual([{ version: 1, is_active: false }, { version: 2, is_active: true }]);

    // reset falls back to the layer below
    expect((await del(admin, "operation_hub_url", "es")).body.reset).toBe(true);
    expect((await del(admin, "operation_hub_url", "es")).body.reset).toBe(false);
    expect(entry((await get(admin, "/precision/config")).body, "operation_hub_url", "es")?.value).toBe("https://hub.example.test/p2");
    expect((await put(admin, "privacy_url", { locale: "en", value: "/legal/privacy", reason: "site-relative" })).status).toBe(200);
    expect(entry((await get(admin, "/precision/config")).body, "privacy_url", "en")?.value).toBe("/legal/privacy");

    const audit = await h.client.query("SELECT action, outcome, target_id, details::text AS d FROM admin_audit_event WHERE action LIKE 'precision_config.%'");
    expect(audit.rows.length).toBeGreaterThan(5);
    const text = JSON.stringify(audit.rows);
    expect(text).not.toContain("hub.example.test");
    expect(text).not.toContain("go live");
    expect(audit.rows.some((r) => r.action === "precision_config.set" && r.outcome === "DENIED")).toBe(true);
  });
  it("Precision deliveries to Operation Hub: read-only list by status for operations roles, ids and codes only", async () => {
    const { supervisor } = await people();
    const all = await get(supervisor, "/precision/deliveries");
    expect(all.status).toBe(200);
    expect(all.body).toHaveProperty("counts");
    expect(Array.isArray(all.body.deliveries)).toBe(true);
    expect((await get(supervisor, "/precision/deliveries?status=failed")).status).toBe(200);
    expect((await get(supervisor, "/precision/deliveries?status=bogus")).status).toBe(400);
    expect(JSON.stringify(all.body)).not.toMatch(/oh_reference|payload|structured/);
  });
  it("company search for program eligibility: read roles only, 2+ characters, names and domains (no people), wildcards are literal", async () => {
    const { supervisor } = await people();
    await h.client.query("INSERT INTO company (name) VALUES ('Zephyr Search Co'), ('Zephyr_Literal Co')");
    const found = await get(supervisor, "/companies/search?q=zephyr");
    expect(found.status).toBe(200);
    expect((found.body.companies as Array<{ name: string }>).map((c) => c.name)).toEqual(expect.arrayContaining(["Zephyr Search Co"]));
    for (const c of found.body.companies as Array<Record<string, unknown>>) expect(Object.keys(c).sort()).toEqual(["companyId", "domain", "name"]);
    expect(((await get(supervisor, "/companies/search?q=z")).body.companies as unknown[])).toEqual([]);
    const literal = await get(supervisor, "/companies/search?q=zephyr_l");
    expect((literal.body.companies as Array<{ name: string }>).map((c) => c.name)).toEqual(["Zephyr_Literal Co"]);
    expect(((await get(supervisor, "/companies/search?q=%25%25")).body.companies as unknown[])).toEqual([]);
  });
});
