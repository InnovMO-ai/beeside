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

describeWithDb("Admin/Supervisor Control Center: sign-in, RBAC, operations and audit (PostgreSQL, rolled back)", () => {
  const h = useHarness();
  let pending: Record<string, unknown> = {};
  const fakeFetch = async (url: string) => {
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return ok({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks` });
    }
    if (url === `${ISSUER}/jwks`) return ok({ keys: [JWK] });
    if (url === `${ISSUER}/token`) {
      const nowSeconds = Math.floor(h.clock.now.getTime() / 1000);
      return ok({ id_token: signIdToken({ iss: ISSUER, aud: CLIENT_ID, iat: nowSeconds, exp: nowSeconds + 300, email_verified: true, ...pending }) });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const provider = new OidcIdentityProvider(
    { issuer: ISSUER, clientId: CLIENT_ID, clientSecret: "test-client-secret", redirectUri: "https://admin.test/api/admin/auth/callback" },
    fakeFetch,
    () => h.clock.now,
  );
  const session = { sessionSecret: "admin-integration-session-secret-0123456789", sessionTtlMinutes: 480, idleTimeoutMinutes: 30, cookieSecure: true, appOrigin: APP_ORIGIN };
  const app = () =>
    request(createApp({ fa: h.deps, admin: { fa: h.deps, identity: provider, session, configService: createConfigVersioningService(h.deps.db) } })) as unknown as request.SuperTest<request.Test>;

  async function login(email: string, sub: string, overrides: Record<string, unknown> = {}) {
    const start = await app().get("/api/admin/auth/login?returnTo=/admin/projects");
    expect(start.status).toBe(302);
    const location = new URL(start.headers.location as string);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    const loginCookie = (start.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("beeside_admin_login="))?.split(";")[0] ?? "";
    const { state: forgedState, ...claims } = overrides;
    pending = { sub, email, nonce: location.searchParams.get("nonce"), ...claims };
    const state = typeof forgedState === "string" ? forgedState : location.searchParams.get("state");
    const callback = await app().get(`/api/admin/auth/callback?code=code-${randomUUID()}&state=${state}`).set("Cookie", loginCookie);
    const cookies = (callback.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
    const sessionCookie = cookies.map((c) => c.split(";")[0] ?? "").find((c) => c.startsWith("beeside_admin_session=") && c !== "beeside_admin_session=");
    return { location: callback.headers.location as string, cookie: sessionCookie ?? null };
  }

  const get = (cookie: string, path: string) => app().get(`/api/admin${path}`).set("Cookie", cookie);
  const post = (cookie: string, path: string, body: unknown = {}) => app().post(`/api/admin${path}`).set("Cookie", cookie).set("X-Beeside-Admin", "1").send(body as object);

  async function completedProject(email: string) {
    const start = await h.api().post("/api/fa/identity").send(identity({ email }));
    const token = start.body.sessionToken as string;
    await runJourney(h, token, MANUFACTURER);
    const { rows } = await h.client.query(
      "SELECT p.project_id FROM project p JOIN project_access_token t ON t.project_id = p.project_id WHERE t.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')",
      [token],
    );
    return { token, projectId: rows[0].project_id as string };
  }

  it("signs in only provisioned people with a verified identity, binds their subject and expires idle sessions", async () => {
    await provisionAdminUser(h.deps.db, { email: "ops.admin@beeside-ops.example", role: "ADMIN" }, h.clock.now);

    expect((await login("stranger@beeside-ops.example", "sub-stranger")).location).toBe(`${APP_ORIGIN}/admin?login=denied`);
    expect((await login("ops.admin@beeside-ops.example", "sub-admin", { email_verified: false })).location).toBe(`${APP_ORIGIN}/admin?login=failed`);
    expect((await login("ops.admin@beeside-ops.example", "sub-admin", { nonce: "replayed-nonce" })).location).toBe(`${APP_ORIGIN}/admin?login=failed`);
    expect((await login("ops.admin@beeside-ops.example", "sub-admin", { state: "forged-state" })).location).toBe(`${APP_ORIGIN}/admin?login=failed`);
    expect((await login("dev-bootstrap-admin@beeside.internal", "sub-bootstrap")).location).toBe(`${APP_ORIGIN}/admin?login=denied`);

    const ok = await login("ops.admin@beeside-ops.example", "sub-admin");
    expect(ok.location).toBe(`${APP_ORIGIN}/admin/projects`);
    expect(ok.cookie).toBeTruthy();
    const cookie = ok.cookie as string;
    const me = await get(cookie, "/me");
    expect(me.body).toMatchObject({ email: "ops.admin@beeside-ops.example", role: "ADMIN" });
    expect(me.body.permissions).toContain("config.publish");
    expect((await h.client.query("SELECT auth_issuer, auth_subject FROM admin_user WHERE auth_identity = 'ops.admin@beeside-ops.example'")).rows[0]).toEqual({ auth_issuer: ISSUER, auth_subject: "sub-admin" });
    // A re-assigned mailbox (different subject) cannot inherit access.
    expect((await login("ops.admin@beeside-ops.example", "sub-someone-else")).location).toBe(`${APP_ORIGIN}/admin?login=denied`);

    // Customer and admin credentials never cross.
    const customer = await h.api().post("/api/fa/identity").send(identity({ email: "customer@northwind-test.example" }));
    expect((await app().get("/api/admin/me")).status).toBe(401);
    expect((await app().get("/api/admin/me").set("Authorization", `Bearer ${customer.body.sessionToken}`)).status).toBe(401);
    expect((await app().get("/api/fa/session").set("Cookie", cookie)).status).toBe(401);

    const denied = await h.client.query("SELECT details->>'reason' AS reason FROM admin_audit_event WHERE action = 'admin.login' AND outcome = 'DENIED' ORDER BY occurred_at");
    expect(denied.rows.map((r) => r.reason).sort()).toEqual(["email_unverified", "invalid_login_state", "login_not_enabled", "nonce_mismatch", "not_provisioned", "subject_mismatch"].sort());

    h.advanceMinutes(31);
    expect((await get(cookie, "/me")).status).toBe(401);
    expect((await h.client.query("SELECT revoke_reason FROM admin_session ORDER BY created_at DESC LIMIT 1")).rows[0].revoke_reason).toBe("idle_timeout");
  });

  it("lets a SUPERVISOR review everything and refuses every ADMIN-only action at the API, with an audit trail", async () => {
    await provisionAdminUser(h.deps.db, { email: "ops.admin@beeside-ops.example", role: "ADMIN" }, h.clock.now);
    await provisionAdminUser(h.deps.db, { email: "ops.supervisor@beeside-ops.example", role: "SUPERVISOR" }, h.clock.now);
    const { projectId } = await completedProject("reviewed@northwind-test.example");
    const supervisor = (await login("ops.supervisor@beeside-ops.example", "sub-supervisor")).cookie as string;

    const search = await get(supervisor, "/projects?q=northwind");
    expect(search.body.results.map((r: { project_id: string }) => r.project_id)).toContain(projectId);
    for (const section of ["", "/answers", "/snapshot", "/internal-assessment", "/premium", "/lifecycle"]) {
      expect((await get(supervisor, `/projects/${projectId}${section}`)).status).toBe(200);
    }
    const internal = await get(supervisor, `/projects/${projectId}/internal-assessment`);
    expect(internal.body.findings).toHaveLength(14);
    expect(internal.body.precisionFocus.length).toBeGreaterThan(0);
    expect((await get(supervisor, `/projects/${projectId}/snapshot`)).body.snapshot.content.kind).toBe("expansion_snapshot");
    expect((await get(supervisor, `/projects/${projectId}/answers`)).body.readOnly).toBe(true);
    expect((await get(supervisor, "/config/current")).status).toBe(200);

    const forbidden: Array<[string, string, unknown?]> = [
      ["post", `/projects/${projectId}/private-link`],
      ["post", `/projects/${projectId}/premium/events`, { eventType: "premium_activated", periodEnd: new Date(h.clock.now.getTime() + 30 * DAY).toISOString() }],
      ["post", "/config/question-bank/versions", { version: "supervisor-draft", config: { schema_version: 1 } }],
      ["post", "/config/question-bank/versions/fa-qb-1.1.0/publish"],
      ["post", "/operations/jobs/email_outbox/run"],
      ["get", "/audit"],
      ["get", "/admin-users"],
      ["post", "/admin-users", { email: "someone@beeside-ops.example", role: "ADMIN" }],
    ];
    for (const [method, path, payload] of forbidden) {
      const res = method === "get" ? await get(supervisor, path) : await post(supervisor, path, payload);
      expect([path, res.status, res.body.error]).toEqual([path, 403, "FORBIDDEN"]);
    }
    expect((await h.client.query("SELECT count(*)::int AS n FROM admin_audit_event a JOIN admin_user u ON u.admin_user_id = a.actor_admin_user_id WHERE u.auth_identity = 'ops.supervisor@beeside-ops.example' AND a.outcome = 'DENIED'")).rows[0].n).toBe(8);
    expect((await h.client.query("SELECT count(*)::int AS n FROM admin_audit_event WHERE project_id = $1 AND action = 'project.viewed'", [projectId])).rows[0].n).toBeGreaterThanOrEqual(6);

    // No role can edit client answers or historical records: there is no such endpoint.
    const admin = (await login("ops.admin@beeside-ops.example", "sub-admin")).cookie as string;
    for (const cookie of [supervisor, admin]) {
      expect((await app().put(`/api/admin/projects/${projectId}/answers/STORY`).set("Cookie", cookie).set("X-Beeside-Admin", "1").send({ value: "tampered" })).status).toBe(404);
      expect((await app().put(`/api/admin/projects/${projectId}/snapshot`).set("Cookie", cookie).set("X-Beeside-Admin", "1").send({})).status).toBe(404);
    }
    // Cross-site writes are refused even with a valid session.
    expect((await app().post("/api/admin/operations/jobs/email_outbox/run").set("Cookie", admin)).body.error).toBe("CSRF_REJECTED");
    expect((await app().post("/api/admin/operations/jobs/email_outbox/run").set("Cookie", admin).set("X-Beeside-Admin", "1").set("Origin", "https://evil.example")).body.error).toBe("CSRF_REJECTED");
  });

  it("lets an ADMIN resend links, confirm Premium manually, publish content, run jobs and manage people — all audited", async () => {
    await provisionAdminUser(h.deps.db, { email: "ops.admin@beeside-ops.example", role: "ADMIN" }, h.clock.now);
    const admin = (await login("ops.admin@beeside-ops.example", "sub-admin")).cookie as string;

    const started = await h.api().post("/api/fa/identity").send(identity({ email: "resend@northwind-test.example" }));
    const inProgress = (await h.client.query("SELECT p.project_id FROM project p JOIN project_access_token t ON t.project_id = p.project_id WHERE t.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [started.body.sessionToken])).rows[0].project_id as string;
    expect((await post(admin, `/projects/${inProgress}/private-link`)).status).toBe(202);
    expect(h.email.messages[h.email.messages.length - 1]).toMatchObject({ template: "existing_assessment_link", to: "resend@northwind-test.example" });
    expect((await post(admin, `/projects/${inProgress}/private-link`)).status).toBe(409);

    const { token, projectId } = await completedProject("manual.premium@northwind-test.example");
    expect((await h.api().post("/api/fa/session/premium/activation").set("Authorization", `Bearer ${token}`).send({ acceptTerms: true })).body.outcome.kind).toBe("pending_confirmation");
    const requestId = (await get(admin, `/projects/${projectId}/premium`)).body.activationRequests[0].request_id as string;
    const confirmed = await post(admin, `/projects/${projectId}/premium/events`, {
      eventType: "premium_activated",
      requestId,
      periodStart: h.clock.now.toISOString(),
      periodEnd: new Date(h.clock.now.getTime() + 30 * DAY).toISOString(),
    });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body).toMatchObject({ subscriptionStatus: "PREMIUM_ACTIVE", handoffGenerated: true });
    expect((await post(admin, `/projects/${projectId}/premium/events`, { eventType: "premium_activated", requestId, periodEnd: new Date(h.clock.now.getTime() + 30 * DAY).toISOString() })).status).toBe(200);
    expect((await get(admin, `/projects/${projectId}/premium`)).body.activationRequests[0].status).toBe("FULFILLED");

    // A copy-only change to the question bank is published through review, and new assessments
    // pinned to it still complete (the rules engine recognizes the unchanged question schema).
    const current = (await get(admin, "/config/question-bank/versions/fa-qb-1.1.0")).body.config;
    current.ui.common.copy.en.continue = "Continue →";
    expect((await post(admin, "/config/question-bank/versions", { version: "fa-qb-admin-copy", config: current })).status).toBe(201);
    expect((await post(admin, "/config/question-bank/versions/fa-qb-admin-copy/preview")).body).toMatchObject({ change_kind: "CONTENT" });
    expect((await post(admin, "/config/question-bank/versions/fa-qb-admin-copy/publish")).body.error).toBe("GATE_REFUSED");
    expect((await post(admin, "/config/question-bank/versions/fa-qb-admin-copy/reviews", { decision: "APPROVED", diffReviewed: false, notes: "copy only" })).status).toBe(201);
    expect((await post(admin, "/config/question-bank/versions/fa-qb-admin-copy/publish")).status).toBe(200);
    expect((await get(admin, "/config/current")).body.QUESTION_BANK).toBe("fa-qb-admin-copy");
    const later = await completedProject("after.copy.change@northwind-test.example");
    expect((await h.client.query("SELECT question_bank_version, assessment_state FROM project WHERE project_id = $1", [later.projectId])).rows[0]).toEqual({ question_bank_version: "fa-qb-admin-copy", assessment_state: "COMPLETED_LOCKED" });

    expect((await post(admin, "/operations/jobs/access_lifecycle/run")).body.status).toBe("SUCCEEDED");
    expect((await get(admin, "/operations/jobs")).body.runs[0]).toMatchObject({ job_name: "access_lifecycle", trigger: "admin" });
    const deliveries = (await get(admin, "/operations/email-deliveries")).body.deliveries;
    expect(deliveries.length).toBeGreaterThan(0);
    expect(JSON.stringify(deliveries)).not.toContain("@");

    const created = await post(admin, "/admin-users", { email: "New.Supervisor@beeside-ops.example", role: "SUPERVISOR" });
    expect(created.body).toMatchObject({ email: "new.supervisor@beeside-ops.example", role: "SUPERVISOR", loginEnabled: true, identityBound: false });
    expect((await app().patch(`/api/admin/admin-users/${created.body.adminUserId}`).set("Cookie", admin).set("X-Beeside-Admin", "1").send({ role: "ADMIN" })).body.role).toBe("ADMIN");
    const self = (await h.client.query("SELECT admin_user_id FROM admin_user WHERE auth_identity = 'ops.admin@beeside-ops.example'")).rows[0].admin_user_id;
    expect((await app().patch(`/api/admin/admin-users/${self}`).set("Cookie", admin).set("X-Beeside-Admin", "1").send({ active: false })).status).toBe(409);
    expect((await post(admin, "/admin-users", { email: "robot@beeside.internal", role: "ADMIN" })).status).toBe(400);

    const audit = (await get(admin, "/audit")).body.events as Array<{ action: string; details: unknown }>;
    const actions = new Set(audit.map((e) => e.action));
    for (const action of ["project.private_link_resent", "premium.subscription_event_recorded", "config.publish", "config.reviews", "job.run_requested", "admin_user.provisioned", "admin_user.updated", "admin.login"]) {
      expect(actions).toContain(action);
    }
    expect(JSON.stringify(audit.map((e) => e.details))).not.toContain("@");

    expect((await post(admin, "/auth/logout")).status).toBe(200);
    expect((await get(admin, "/me")).status).toBe(401);
  });
});
