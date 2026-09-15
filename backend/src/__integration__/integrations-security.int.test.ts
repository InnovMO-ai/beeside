import request from "supertest";
import { createApp } from "../index";
import { CaptureOperationHubAdapter } from "../integrations/operation-hub";
import { CaptureSmartSuiteClient, SmartSuiteAdapter, developmentCaptureMapping } from "../integrations/smartsuite";
import { listIntegrationDeliveries, retryIntegrationDelivery } from "../integrations/relay";
import { IntegrationError } from "../integrations/types";
import { runJob } from "../operations/jobs";
import { PostgresRateLimitStore, createRateLimiter } from "../security/rate-limit";
import { MANUFACTURER, describeWithDb, identity, runJourney, useHarness } from "./fa-harness";

describeWithDb("Outbound integrations and public-surface security (PostgreSQL, rolled back)", () => {
  const h = useHarness();
  let smartsuite: CaptureSmartSuiteClient;
  let hub: CaptureOperationHubAdapter;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const run = (job: "integration_outbox" | "temporary_retention" | "security_housekeeping") => runJob(h.deps, job, { trigger: "test" });

  beforeEach(() => {
    smartsuite = new CaptureSmartSuiteClient();
    hub = new CaptureOperationHubAdapter();
    h.deps.integrations = {
      adapters: { smartsuite: new SmartSuiteAdapter(developmentCaptureMapping(), smartsuite, "capture"), operation_hub: hub },
    };
  });

  async function completedProject(email: string) {
    const start = await h.api().post("/api/fa/identity").send(identity({ email }));
    const token = start.body.sessionToken as string;
    await runJourney(h, token, MANUFACTURER);
    const { rows } = await h.client.query(
      `SELECT p.project_id FROM project p JOIN project_access_token t ON t.project_id = p.project_id
        WHERE t.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [token],
    );
    return { token, projectId: rows[0].project_id as string };
  }

  it("relays each committed event once per routed destination and keeps one external record per project", async () => {
    const { token, projectId } = await completedProject("integrations@northwind-test.example");
    const events = await h.client.query("SELECT event_type, payload::text AS payload, relayed_at FROM outbox_event WHERE project_id = $1", [projectId]);
    expect(events.rows.map((r) => r.event_type)).toEqual(["assessment.completed"]);
    expect(events.rows[0].relayed_at).toBeNull();
    // Outbox payloads carry ids only.
    expect(events.rows.map((r) => r.payload).join(" ")).not.toMatch(/@|Northwind|Ana/);

    const first = await run("integration_outbox");
    expect(first).toMatchObject({ status: "SUCCEEDED", stats: { events_relayed: 1, deliveries_created: 1, delivered: 1 } });
    expect(smartsuite.operations.map((o) => o.operation)).toEqual(["create"]);
    // The mapping decides what leaves beeside; the record is read at delivery time, not copied into the outbox.
    expect(smartsuite.operations[0]?.fields?.project_id).toBe(projectId);
    expect((await h.client.query("SELECT external_id FROM integration_external_ref WHERE destination = 'smartsuite' AND project_id = $1", [projectId])).rows[0].external_id).toBe("capture-1");
    expect(hub.commands).toEqual([]); // completion is not an Operation Hub event

    // Running again relays nothing new and sends nothing again.
    expect(await run("integration_outbox")).toMatchObject({ status: "SUCCEEDED", stats: { events_relayed: 0, deliveries_created: 0, claimed: 0 } });
    expect(smartsuite.operations).toHaveLength(1);

    // A Premium request updates the same external record instead of creating a second one.
    await h.api().post("/api/fa/session/premium/activation").set(auth(token)).send({ acceptTerms: true });
    expect(await run("integration_outbox")).toMatchObject({ stats: { deliveries_created: 1, delivered: 1 } });
    expect(smartsuite.operations.map((o) => o.operation)).toEqual(["create", "update"]);
    expect((await h.client.query("SELECT count(*)::int AS n FROM integration_external_ref WHERE project_id = $1", [projectId])).rows[0].n).toBe(1);
    expect((await h.client.query("SELECT count(*)::int AS n FROM integration_delivery WHERE project_id = $1 AND status = 'DELIVERED'", [projectId])).rows[0].n).toBe(2);
  });

  it("retries a temporary failure, dead-letters a permanent one and delivers again after an admin retry", async () => {
    const { projectId } = await completedProject("integration-retry@northwind-test.example");
    smartsuite.failNext = [new IntegrationError("smartsuite request failed (network or timeout)", true)];
    expect(await run("integration_outbox")).toMatchObject({ stats: { failed: 1, delivered: 0 } });
    const failed = (await h.client.query("SELECT status, attempts, last_error FROM integration_delivery WHERE project_id = $1", [projectId])).rows[0];
    expect(failed).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(failed.last_error).toContain("smartsuite request failed");

    // A permanent failure is not retried in the background: it waits for a decision.
    h.advanceMinutes(5);
    smartsuite.failNext = [new IntegrationError("smartsuite create failed with HTTP 400", false)];
    expect(await run("integration_outbox")).toMatchObject({ stats: { dead: 1 } });
    const dead = (await h.client.query("SELECT delivery_id, status FROM integration_delivery WHERE project_id = $1", [projectId])).rows[0];
    expect(dead.status).toBe("DEAD");

    expect(await h.deps.db.transaction((tx) => retryIntegrationDelivery(tx, dead.delivery_id as string, h.clock.now))).toBe(true);
    expect(await run("integration_outbox")).toMatchObject({ stats: { delivered: 1 } });
    expect((await listIntegrationDeliveries(h.deps.db, { status: "DELIVERED", destination: "smartsuite" })).length).toBe(1);
  });

  it("sends the Operation Hub only outbound ids, and only for its own events", async () => {
    const { projectId } = await completedProject("integration-hub@northwind-test.example");
    await h.client.query(
      `INSERT INTO outbox_event (project_id, event_type, payload, occurred_at)
       VALUES ($1, 'precision.handoff_package_generated', jsonb_build_object('package_id', '00000000-0000-4000-8000-000000000001', 'contract_version', 1), $2)`,
      [projectId, h.clock.now],
    );
    await run("integration_outbox");
    expect(hub.commands).toEqual([{ command: "handoff_ready", projectId, handoffPackageId: "00000000-0000-4000-8000-000000000001", contractVersion: 1 }]);
    expect(JSON.stringify(hub.commands)).not.toMatch(/@|Northwind|Ana|valve/i);
    // SmartSuite is not a destination for the Precision handoff.
    const deliveries = await h.client.query("SELECT destination, event_type FROM integration_delivery WHERE project_id = $1 ORDER BY destination, event_type", [projectId]);
    expect(deliveries.rows).toEqual([
      { destination: "operation_hub", event_type: "precision.handoff_package_generated" },
      { destination: "smartsuite", event_type: "assessment.completed" },
    ]);
  });

  it("tells destinations to delete their copy when a free assessment is purged", async () => {
    const { projectId } = await completedProject("integration-purge@northwind-test.example");
    await run("integration_outbox");
    expect(smartsuite.operations.map((o) => o.operation)).toEqual(["create"]);

    h.advanceDays(61);
    expect(await run("temporary_retention")).toMatchObject({ status: "SUCCEEDED", stats: { purged: 1 } });
    expect((await h.client.query("SELECT count(*)::int AS n FROM integration_delivery WHERE project_id = $1", [projectId])).rows[0].n).toBe(0);

    expect(await run("integration_outbox")).toMatchObject({ stats: { delivered: 1 } });
    expect(smartsuite.operations.map((o) => o.operation)).toEqual(["create", "remove"]);
    expect((await h.client.query("SELECT count(*)::int AS n FROM integration_external_ref WHERE project_id = $1", [projectId])).rows[0].n).toBe(0);
  });

  it("limits abusive traffic on the public endpoints and answers refusals with JSON", async () => {
    const limited = () =>
      request(
        createApp({
          fa: h.deps,
          security: {
            allowedOrigins: new Set(["https://fa.test"]),
            limiter: createRateLimiter({ store: new PostgresRateLimitStore(h.deps.db), secret: "integration-rate-limit-secret", now: () => h.clock.now }),
          },
        }),
      );

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const response = await limited().post("/api/fa/identity").send(identity({ email: `flood-${i}@northwind-test.example` }));
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true);
    const refused = await limited().post("/api/fa/identity").send(identity({ email: "flood-last@northwind-test.example" }));
    expect(refused.status).toBe(429);
    expect(refused.body.error).toBe("RATE_LIMITED");
    expect(refused.headers["retry-after"]).toBeDefined();
    // The refusal is counted without storing the address itself.
    const counters = await h.client.query("SELECT bucket_key, policy, hits, max_hits FROM rate_limit_counter WHERE policy = 'fa_identity_address'");
    expect(counters.rows[0].bucket_key).toMatch(/^fa_identity_address:[0-9a-f]{64}$/);
    expect(Number(counters.rows[0].hits)).toBeGreaterThan(Number(counters.rows[0].max_hits));

    // Malformed, oversized and cross-origin requests never reach a handler, and never return HTML.
    const malformed = await limited().post("/api/fa/events").set("Content-Type", "application/json").send("{not json");
    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({ error: "INVALID_JSON" });
    const oversized = await limited().post("/api/fa/events").set("Content-Type", "application/json").send({ anonymousSessionId: "0b3c2f4e-8a1d-4f6b-9c2e-7d5a4b3c2e1f", events: Array.from({ length: 4000 }, () => ({ type: "step_viewed", stepId: "project_story" })) });
    expect(oversized.status).toBe(413);
    expect((await limited().post("/api/fa/links/open").set("Origin", "https://evil.test").send({ token: "x" })).body).toEqual({ error: "ORIGIN_REJECTED" });
    const unknown = await limited().get("/api/fa/does-not-exist");
    expect(unknown.status).toBe(404);
    expect(unknown.headers["content-type"]).toContain("application/json");
    expect(unknown.headers["referrer-policy"]).toBe("no-referrer");

    expect(await run("security_housekeeping")).toMatchObject({ status: "SUCCEEDED" });
  });

  it("answers automated submissions without storing anything and marks a suspiciously fast form for review", async () => {
    const before = (await h.client.query("SELECT count(*)::int AS n FROM person")).rows[0].n;
    const honeypot = await h.api().post("/api/fa/identity").send(identity({ email: "bot@northwind-test.example", referenceCode: "http://spam.example" }));
    expect(honeypot.status).toBe(202);
    expect(honeypot.body).toEqual({ status: "verification_required" });
    expect((await h.client.query("SELECT count(*)::int AS n FROM person")).rows[0].n).toBe(before);
    expect(h.email.messages).toHaveLength(0);
    const signal = await h.client.query("SELECT properties FROM fa_journey_event WHERE event_type = 'bot_signal_detected'");
    expect(signal.rows[0].properties).toEqual({ signal: "honeypot" });

    const fast = await h.api().post("/api/fa/identity").send(identity({ email: "fast@northwind-test.example", formElapsedMs: 200 }));
    expect(fast.status).toBe(201);
    const project = await h.client.query(
      `SELECT p.trust_state FROM project p JOIN project_access_token t ON t.project_id = p.project_id
        WHERE t.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [fast.body.sessionToken],
    );
    // Marked for review, never blocked: the respondent's experience is unchanged.
    expect(project.rows[0].trust_state).toBe("REVIEW");
    expect((await h.api().get("/api/fa/session").set(auth(fast.body.sessionToken))).status).toBe(200);
  });
});
