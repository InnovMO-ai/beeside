import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { buildProjectProfile } from "../analytics/project-profile";
import { EMPTY_SEGMENT, MIN_SEGMENT_SIZE, isSegmented, parseRange, parseSegment } from "../analytics/metrics";
import { FEEDBACK_COPY, FEEDBACK_QUESTION_VERSION, parseFeedbackInput } from "../feedback/feedback-service";
import { createApp, securityOptionsFromEnv } from "../index";
import { integrationsFromEnv } from "../integrations/config";
import { CaptureOperationHubAdapter, operationHubCommand } from "../integrations/operation-hub";
import { DESTINATION_ROUTES, integrationBackoffSeconds } from "../integrations/relay";
import { CaptureSmartSuiteClient, HttpSmartSuiteClient, SmartSuiteAdapter, developmentCaptureMapping, mapRecord, validateSmartSuiteMapping } from "../integrations/smartsuite";
import { IntegrationError } from "../integrations/types";
import { HONEYPOT_FIELD, MIN_FORM_FILL_MS, NoBotChallenge, readIdentitySignals, trustStateFor } from "../security/abuse";
import { normalizeOrigin } from "../security/http-hardening";
import { MemoryRateLimitStore, RATE_LIMITS, createRateLimiter } from "../security/rate-limit";
import { describeError, jsonLogger, redact } from "../security/redact";
import { allowedOrigins, integrationMode, trustProxyHops, validateRuntimeConfig } from "../security/runtime-config";

const PRODUCTION = { NODE_ENV: "production", FA_API_ENABLED: "true", APP_BASE_URL: "https://fa.beeside.you", DATABASE_URL: "postgres://runtime@db/beeside", SECURITY_HASH_SECRET: "x".repeat(32), TRUST_PROXY_HOPS: "1" };

describe("log redaction", () => {
  it("removes addresses, credentials, private links and connection passwords", () => {
    const line = redact(
      'failed for ana.rivera@northwind.example using Bearer abcdefghijklmnopqrstuvwxyz012345678901234567 at https://fa.test/resume#K7sW3nQ2pLd9vB1xR4tY6uI8oP0aS5dF7gH9jK1lZ3c and postgres://beeside_app:s3cr3t@10.0.0.1:5432/beeside',
    );
    expect(line).not.toMatch(/@northwind|abcdefghijk|K7sW3nQ2|s3cr3t/);
    expect(line).toContain("/resume/****");
    expect(line).toContain("postgres://beeside_app:****@");
    expect(describeError(new Error("token=abcdefghijklmnopqrstuvwxyz0123456789012345"))).not.toMatch(/abcdefghijk/);
  });

  it("writes one redacted JSON line per event", () => {
    const lines: string[] = [];
    const spy = jest.spyOn(console, "log").mockImplementation((line: unknown) => lines.push(String(line)));
    jsonLogger("info", "delivery sent", { to: "ana@example.com", attempt: 1 });
    spy.mockRestore();
    const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(entry).toMatchObject({ severity: "INFO", message: "delivery sent", attempt: 1 });
    expect(entry.to).toBe("****@****");
  });
});

describe("runtime configuration validation", () => {
  const errors = (env: Record<string, string>) => validateRuntimeConfig(env).filter((i) => i.level === "error").map((i) => i.message);

  it("accepts a complete production configuration", () => {
    expect(errors(PRODUCTION)).toEqual([]);
  });

  it("refuses development conveniences, the migration credential and missing secrets in production", () => {
    expect(errors({ ...PRODUCTION, DEV_LOG_EMAIL_LINKS: "true" })).toContainEqual(expect.stringContaining("DEV_LOG_EMAIL_LINKS"));
    expect(errors({ ...PRODUCTION, PREMIUM_DEV_SIMULATION: "true" })).toContainEqual(expect.stringContaining("PREMIUM_DEV_SIMULATION"));
    expect(errors({ ...PRODUCTION, MIGRATION_DATABASE_URL: "postgres://migrator@db/beeside" })).toContainEqual(expect.stringContaining("MIGRATION_DATABASE_URL"));
    expect(errors({ ...PRODUCTION, INTEGRATION_SMARTSUITE_MODE: "capture" })).toContainEqual(expect.stringContaining("capture"));
    const withoutSecrets: Record<string, string> = { ...PRODUCTION };
    delete withoutSecrets.SECURITY_HASH_SECRET;
    delete withoutSecrets.TRUST_PROXY_HOPS;
    expect(errors(withoutSecrets)).toEqual(expect.arrayContaining([expect.stringContaining("SECURITY_HASH_SECRET"), expect.stringContaining("TRUST_PROXY_HOPS")]));
    expect(errors({ ...PRODUCTION, APP_BASE_URL: "http://fa.beeside.you" })).toContainEqual(expect.stringContaining("https"));
  });

  it("reads proxy hops, origins and integration modes conservatively", () => {
    expect(trustProxyHops({})).toBe(0);
    expect(trustProxyHops({ TRUST_PROXY_HOPS: "2" })).toBe(2);
    expect(trustProxyHops({ TRUST_PROXY_HOPS: "9" })).toBe(0);
    expect([...allowedOrigins({ APP_BASE_URL: "https://fa.test/app", ALLOWED_ORIGINS: "https://admin.test, nonsense" })]).toEqual(["https://fa.test", "https://admin.test"]);
    expect(normalizeOrigin("javascript:alert(1)")).toBeNull();
    expect(integrationMode(undefined)).toBe("disabled");
    expect(integrationMode("live")).toBe("live");
    expect(integrationMode("whatever")).toBe("disabled");
  });
});

describe("rate limiting", () => {
  it("counts fixed windows per subject and policy and reports when to retry", async () => {
    let now = new Date("2026-09-15T12:00:00.000Z");
    const limiter = createRateLimiter({ store: new MemoryRateLimitStore(), secret: "unit-secret", now: () => now });
    const policy = { name: "unit_policy", limit: 2, windowSeconds: 600 };
    expect((await limiter.consume(policy, "a")).allowed).toBe(true);
    expect((await limiter.consume(policy, "a")).allowed).toBe(true);
    const refused = await limiter.consume(policy, "a");
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    // A different subject has its own budget, and the next window starts fresh.
    expect((await limiter.consume(policy, "b")).allowed).toBe(true);
    now = new Date(now.getTime() + 600_000);
    expect((await limiter.consume(policy, "a")).allowed).toBe(true);
  });

  it("stays available when the counter store fails", async () => {
    const limiter = createRateLimiter({
      store: { hit: () => Promise.reject(new Error("counter unavailable")) },
      secret: "unit-secret",
      now: () => new Date(),
      log: () => undefined,
    });
    expect((await limiter.consume(RATE_LIMITS.identityAddress, "a")).allowed).toBe(true);
  });

  it("keeps abuse-prevention budgets narrower than the shared one", () => {
    expect(RATE_LIMITS.identityAddress.limit).toBeLessThan(RATE_LIMITS.faAddress.limit);
    expect(RATE_LIMITS.linkRequestEmail.limit).toBeLessThanOrEqual(RATE_LIMITS.identityEmail.limit);
  });
});

describe("HTTP hardening", () => {
  const app = () => request(createApp({ security: { production: true, allowedOrigins: new Set(["https://fa.test"]) } }));

  it("sends security headers and no-store on every response", async () => {
    const response = await app().get("/health");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["strict-transport-security"]).toContain("max-age=31536000");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("refuses cross-origin state changes and answers unknown routes with JSON", async () => {
    expect((await app().post("/api/fa/identity").set("Origin", "https://evil.test").send({})).body).toEqual({ error: "ORIGIN_REJECTED" });
    const missing = await app().get("/api/fa/session");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "NOT_FOUND" });
  });

  it("refuses bodies larger than the limit before parsing them", async () => {
    const response = await app().post("/api/anything").set("Content-Type", "application/json").send("x".repeat(20));
    expect(response.status).toBe(404);
    const oversized = await app().post("/api/anything").set("Content-Type", "application/json").set("Content-Length", "3000000").send("{}");
    expect(oversized.status).toBe(413);
  });

  it("derives security options from the environment without a database", () => {
    const options = securityOptionsFromEnv({ ...PRODUCTION });
    expect(options.production).toBe(true);
    expect(options.trustProxyHops).toBe(1);
    expect(options.limiter).toBeDefined();
    expect(securityOptionsFromEnv({ NODE_ENV: "development", RATE_LIMITING_ENABLED: "false" }).limiter).toBeUndefined();
  });
});

describe("anti-abuse signals", () => {
  it("reads the honeypot and the form completion time, and never blocks on its own", () => {
    expect(readIdentitySignals({ [HONEYPOT_FIELD]: " " }).honeypotFilled).toBe(false);
    expect(readIdentitySignals({ [HONEYPOT_FIELD]: "bot" }).honeypotFilled).toBe(true);
    expect(readIdentitySignals({ formElapsedMs: MIN_FORM_FILL_MS - 1 }).tooFast).toBe(true);
    expect(readIdentitySignals({ formElapsedMs: MIN_FORM_FILL_MS }).tooFast).toBe(false);
    expect(readIdentitySignals({}).tooFast).toBe(false);
    expect(trustStateFor({ honeypotFilled: false, tooFast: true, challenge: "not_configured" })).toBe("REVIEW");
    expect(trustStateFor({ honeypotFilled: false, tooFast: false, challenge: "failed" })).toBe("REVIEW");
    expect(trustStateFor({ honeypotFilled: true, tooFast: false, challenge: "passed" })).toBe("NORMAL");
  });

  it("selects no bot-challenge provider", async () => {
    expect(await new NoBotChallenge().verify()).toBe("not_configured");
  });
});

describe("post-Snapshot feedback input", () => {
  it("keeps the frozen question and accepts only a 1–5 rating with an optional comment", () => {
    expect(FEEDBACK_QUESTION_VERSION).toBe("snapshot-feedback-v1");
    expect(FEEDBACK_COPY.en.question).toBe("How useful was this experience in helping you think more clearly about your project?");
    expect(FEEDBACK_COPY.en.scale_min).toBe("Not useful");
    expect(FEEDBACK_COPY.en.scale_max).toBe("Very useful");
    expect(FEEDBACK_COPY.en.comment_label).toBe("Anything you'd like us to know?");
    expect(Object.keys(FEEDBACK_COPY.es)).toEqual(Object.keys(FEEDBACK_COPY.en));

    expect(parseFeedbackInput({ usefulness: 5 })).toEqual({ usefulness: 5, comment: null });
    expect(parseFeedbackInput({ usefulness: 1, comment: "  useful  " })).toEqual({ usefulness: 1, comment: "useful" });
    expect(parseFeedbackInput({ usefulness: 3, comment: "   " }).comment).toBeNull();
    expect(parseFeedbackInput({ usefulness: 3, comment: "ab" }).comment).toBe("ab");
    for (const invalid of [{}, { usefulness: 0 }, { usefulness: 6 }, { usefulness: 2.5 }, { usefulness: "5" }, { usefulness: 3, comment: 7 }, { usefulness: 3, comment: "x".repeat(2001) }]) {
      expect(() => parseFeedbackInput(invalid)).toThrow();
    }
  });
});

describe("analytics segmentation and ranges", () => {
  it("keeps only enumerated values and country codes in a project profile", () => {
    const answers = new Map<string, unknown>([
      ["fa.goal.primary_goal", "set_up_local_operation"],
      ["fa.project.stage", "already_operating"],
      ["fa.project.destination_status", "know_country_location"],
      ["fa.business.type", "manufacturing"],
      ["fa.project.target_markets", ["MX", "mx", "Mexico", "US"]],
      ["fa.operation.expected_capabilities", ["legal_corporate", "Banking S.A."]],
      ["fa.operation.components", ["manufacturing"]],
      ["fa.project.story_raw", "We make valves in Monterrey for ACME"],
    ]);
    const profile = buildProjectProfile(answers);
    expect(profile).toEqual({
      primaryGoal: "set_up_local_operation",
      projectStage: "already_operating",
      entryMode: "already_operating",
      destinationStatus: "know_country_location",
      businessType: "manufacturing",
      targetMarkets: ["MX", "US"],
      expectedCapabilities: ["legal_corporate"],
      operationComponents: ["manufacturing"],
    });
    expect(JSON.stringify(profile)).not.toMatch(/Monterrey|ACME|valves/);
    expect(buildProjectProfile(new Map([["fa.project.stage", "preparing_entry"]])).entryMode).toBe("new_market");
    expect(buildProjectProfile(new Map()).entryMode).toBeNull();
  });

  it("validates ranges and segment filters", () => {
    const now = new Date("2026-09-15T10:00:00.000Z");
    const defaultRange = parseRange({}, now);
    expect(defaultRange.to.toISOString()).toBe("2026-09-16T00:00:00.000Z");
    expect(defaultRange.from.toISOString()).toBe("2026-08-17T00:00:00.000Z");
    expect(parseRange({ from: "2026-09-01", to: "2026-09-10" }, now).to.toISOString()).toBe("2026-09-11T00:00:00.000Z");
    expect(() => parseRange({ from: "01/09/2026" }, now)).toThrow();
    expect(() => parseRange({ from: "2026-09-10", to: "2026-09-01" }, now)).toThrow();
    expect(() => parseRange({ from: "2020-01-01" }, now)).toThrow();

    expect(parseSegment({})).toEqual(EMPTY_SEGMENT);
    expect(isSegmented(parseSegment({ market: "MX" }))).toBe(true);
    expect(() => parseSegment({ market: "Mexico" })).toThrow();
    expect(() => parseSegment({ entryMode: "anything" })).toThrow();
    expect(() => parseSegment({ primaryGoal: "Enter the US" })).toThrow();
    expect(MIN_SEGMENT_SIZE).toBe(5);
  });
});

describe("SmartSuite adapter", () => {
  const record = { "project.id": "11111111-1111-4111-8111-111111111111", "company.name": "Northwind", "person.email": "ana@northwind.example" };

  it("validates the mapping instead of inventing an external schema", () => {
    const valid = validateSmartSuiteMapping({ version: 1, applicationId: "app-123", events: ["assessment.completed"], fields: { "project.id": "s_project", "company.name": "title" } });
    expect(valid.errors).toEqual([]);
    expect(validateSmartSuiteMapping({ version: 2, applicationId: "app", events: [], fields: {} }).errors).toContain("mapping.version must be 1");
    expect(validateSmartSuiteMapping({ version: 1, applicationId: "app", events: ["assessment.completed"], fields: { "company.name": "title" } }).errors).toContainEqual(expect.stringContaining("project.id"));
    expect(validateSmartSuiteMapping({ version: 1, applicationId: "app", events: ["assessment.completed"], fields: { "project.id": "a", "person.secret": "b" } }).errors).toContainEqual(
      expect.stringContaining("unknown source key"),
    );
    expect(validateSmartSuiteMapping({ version: 1, applicationId: "app", events: ["precision.handoff_package_generated"], fields: { "project.id": "a" } }).errors).toContainEqual(
      expect.stringContaining("cannot be sent to SmartSuite"),
    );
    expect(validateSmartSuiteMapping({ version: 1, applicationId: "app", events: ["assessment.completed"], fields: { "project.id": "a", "company.name": "a" } }).errors).toContainEqual(
      expect.stringContaining("mapped twice"),
    );
    expect(mapRecord({ version: 1, applicationId: "app", events: [], fields: { "project.id": "s_project", "person.email": "s_email" } }, record)).toEqual({
      s_project: record["project.id"],
      s_email: record["person.email"],
    });
  });

  it("creates once and updates afterwards, and deletes the external copy on purge", async () => {
    const client = new CaptureSmartSuiteClient();
    const adapter = new SmartSuiteAdapter(developmentCaptureMapping(), client, "capture");
    const event = { eventId: "e1", eventType: "assessment.completed", projectId: record["project.id"], occurredAt: new Date(), payload: {} };
    const created = await adapter.deliver({ event, record, externalId: null });
    expect(created).toEqual({ kind: "upserted", externalId: "capture-1" });
    expect(await adapter.deliver({ event: { ...event, eventType: "subscription.premium_activated" }, record, externalId: "capture-1" })).toEqual({ kind: "upserted", externalId: "capture-1" });
    expect(client.operations.map((o) => o.operation)).toEqual(["create", "update"]);

    const purge = { ...event, eventType: "retention.project_purged" };
    expect(await adapter.deliver({ event: purge, record: null, externalId: "capture-1" })).toEqual({ kind: "deleted" });
    expect(await adapter.deliver({ event: purge, record: null, externalId: null })).toEqual({ kind: "skipped", reason: "no_external_record" });
    expect(await adapter.deliver({ event, record: null, externalId: null })).toEqual({ kind: "skipped", reason: "project_unavailable" });
    expect(adapter.routes("precision.handoff_package_generated")).toBe(false);
  });

  it("classifies HTTP failures as retryable or permanent and never logs the response", async () => {
    const respond = (status: number, body: unknown = {}) => async () => ({ status, ok: status < 400, json: async () => body });
    const client = (fetchImpl: never) => new HttpSmartSuiteClient({ apiToken: "token", accountId: "account", baseUrl: "https://app.smartsuite.test/api/v1" }, fetchImpl);
    await expect(client(respond(500) as never).create("app", {})).rejects.toMatchObject({ retryable: true });
    await expect(client(respond(429) as never).create("app", {})).rejects.toMatchObject({ retryable: true });
    await expect(client(respond(400) as never).create("app", {})).rejects.toMatchObject({ retryable: false });
    await expect(client(respond(201, { id: 42 }) as never).create("app", {})).rejects.toMatchObject({ retryable: false });
    await expect(
      client((() => Promise.reject(new Error("socket hang up"))) as never).create("app", {}),
    ).rejects.toBeInstanceOf(IntegrationError);
    expect(await client(respond(201, { id: "rec-1" }) as never).create("app", {})).toBe("rec-1");
    expect(await client(respond(404) as never).update("app", "rec-1", {})).toBe("not_found");
    expect(await client(respond(404) as never).remove("app", "rec-1")).toBeUndefined();
  });
});

describe("Operation Hub boundary", () => {
  it("is outbound only and sends ids and flags, never client content", async () => {
    const adapter = new CaptureOperationHubAdapter();
    const base = { eventId: "e1", projectId: "p1", occurredAt: new Date(), payload: {} };
    expect(operationHubCommand({ event: { ...base, eventType: "precision.handoff_package_generated", payload: { package_id: "pkg-1", contract_version: 1 } }, record: null, externalId: null })).toEqual({
      command: "handoff_ready",
      projectId: "p1",
      handoffPackageId: "pkg-1",
      contractVersion: 1,
    });
    expect(operationHubCommand({ event: { ...base, eventType: "subscription.premium_activated", payload: { premium_access_active: true, status: "PREMIUM_ACTIVE" } }, record: null, externalId: null })).toEqual({
      command: "access_changed",
      projectId: "p1",
      accessActive: true,
      subscriptionStatus: "PREMIUM_ACTIVE",
    });
    expect(operationHubCommand({ event: { ...base, eventType: "assessment.completed" }, record: null, externalId: null })).toBeNull();
    expect(await adapter.deliver({ event: { ...base, eventType: "assessment.completed" }, record: null, externalId: null })).toEqual({ kind: "skipped", reason: "not_routable" });
    expect(adapter.routes("assessment.completed")).toBe(false);
    expect(adapter.routes("subscription.cancellation_requested")).toBe(true);
  });

  it("never writes a canonical entity: no integration module contains a write to one", () => {
    const directory = path.resolve(__dirname, "../integrations");
    const protectedTables = [
      "person",
      "company",
      "project",
      "answer",
      "finding",
      "snapshot",
      "internal_assessment",
      "entitlement",
      "subscription",
      "subscription_event",
      "priority_alignment",
      "capability_rank",
      "precision_handoff_package",
      "fa_project_lifecycle",
      "legal_acceptance",
      "premium_activation_request",
    ];
    const writes = new RegExp(`(insert\\s+into|update|delete\\s+from)\\s+(${protectedTables.join("|")})\\b`, "i");
    for (const file of readdirSync(directory)) {
      const source = readFileSync(path.join(directory, file), "utf8");
      expect({ file, write: writes.test(source) }).toEqual({ file, write: false });
    }
  });
});

describe("integration configuration and routing", () => {
  it("enables nothing by default and refuses incomplete or production-unsafe destinations", () => {
    expect(integrationsFromEnv({}).adapters).toEqual({});
    expect(() => integrationsFromEnv({ INTEGRATION_OPERATION_HUB_MODE: "live" })).toThrow(/no Operation Hub workspace contract/);
    expect(() => integrationsFromEnv({ INTEGRATION_SMARTSUITE_MODE: "live" })).toThrow(/SMARTSUITE_MAPPING_JSON/);
    expect(() => integrationsFromEnv({ INTEGRATION_SMARTSUITE_MODE: "capture", NODE_ENV: "production" })).toThrow(/not allowed in production/);
    expect(() => integrationsFromEnv({ INTEGRATION_SMARTSUITE_MODE: "capture", SMARTSUITE_MAPPING_JSON: "{" })).toThrow(/valid JSON/);
    const development = integrationsFromEnv({ INTEGRATION_SMARTSUITE_MODE: "capture", INTEGRATION_OPERATION_HUB_MODE: "capture" });
    expect(development.adapters.smartsuite?.name).toBe("smartsuite_capture");
    expect(development.adapters.operation_hub?.name).toBe("operation_hub_capture");
    const live = integrationsFromEnv({
      INTEGRATION_SMARTSUITE_MODE: "live",
      SMARTSUITE_API_TOKEN: "token",
      SMARTSUITE_ACCOUNT_ID: "account",
      SMARTSUITE_MAPPING_JSON: JSON.stringify({ version: 1, applicationId: "app", events: ["assessment.completed"], fields: { "project.id": "s_project" } }),
    });
    expect(live.adapters.smartsuite?.name).toBe("smartsuite_live");
  });

  it("routes each event only to the destinations that may receive it, with bounded backoff", () => {
    expect(DESTINATION_ROUTES.smartsuite.has("precision.handoff_package_generated")).toBe(false);
    expect(DESTINATION_ROUTES.smartsuite.has("retention.project_purged")).toBe(true);
    expect(DESTINATION_ROUTES.operation_hub.has("assessment.completed")).toBe(false);
    expect(DESTINATION_ROUTES.operation_hub.has("precision.handoff_package_generated")).toBe(true);
    expect(integrationBackoffSeconds(1)).toBe(60);
    expect(integrationBackoffSeconds(99)).toBe(43_200);
  });
});
