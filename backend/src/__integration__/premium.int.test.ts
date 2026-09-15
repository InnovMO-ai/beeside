import request from "supertest";
import { createApp } from "../index";
import { BILLING_SIGNATURE_HEADER, BILLING_TIMESTAMP_HEADER, signBillingPayload } from "../premium/billing-router";
import { linkOperationHub, operationHubAccess } from "../premium/operation-hub";
import { getPrecisionStartContext } from "../premium/precision-handoff";
import { devSimulatedCheckout } from "../premium/premium-service";
import { temporaryRetentionCandidates } from "../premium/retention";
import { processSubscriptionEvent } from "../premium/subscription-events";
import { MANUFACTURER, describeWithDb, identity, lastLinkToken, runJourney, useHarness } from "./fa-harness";

const SECRET = "integration-billing-secret-0123456789abcdef";
const DAY = 86_400_000;

describeWithDb("Premium transition, Precision handoff and subscription boundary (PostgreSQL, rolled back)", () => {
  const h = useHarness();

  const billing = () =>
    request(
      createApp({ fa: h.deps, billing: { db: h.deps.db, bundles: h.deps.bundles, secret: SECRET, now: () => h.clock.now } }),
    ) as unknown as request.SuperTest<request.Test>;

  // Phase 13: the signature covers a timestamp as well as the body, so a captured delivery cannot
  // be replayed later.
  async function sendEvent(payload: Record<string, unknown>, signature?: string) {
    const raw = JSON.stringify(payload);
    const timestamp = Math.floor(h.clock.now.getTime() / 1000);
    return billing()
      .post("/api/billing/events")
      .set("Content-Type", "application/json")
      .set(BILLING_TIMESTAMP_HEADER, String(timestamp))
      .set(BILLING_SIGNATURE_HEADER, signature ?? signBillingPayload(SECRET, timestamp, raw))
      .send(raw);
  }

  function event(projectId: string, eventType: string, key: string, periodDays?: number) {
    const now = h.clock.now;
    return {
      event_type: eventType,
      project_id: projectId,
      idempotency_key: key,
      occurred_at: now.toISOString(),
      ...(periodDays ? { current_period_start: now.toISOString(), current_period_end: new Date(now.getTime() + periodDays * DAY).toISOString() } : {}),
    };
  }

  async function projectForToken(token: string) {
    const { rows } = await h.client.query(
      `SELECT p.* FROM project p JOIN project_access_token t ON t.project_id = p.project_id
        WHERE t.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [token],
    );
    return rows[0];
  }

  async function completedProject(email = "ana.rivera@northwind-test.example", finishLaterFirst = false) {
    const start = await h.api().post("/api/fa/identity").send(identity({ email }));
    expect(start.status).toBe(201);
    const token = start.body.sessionToken as string;
    // Finish Later emits the private link, which starts the temporary access/retention lifecycle.
    if (finishLaterFirst) expect((await h.api().post("/api/fa/session/finish-later").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    expect((await runJourney(h, token, MANUFACTURER)).status).toBe("COMPLETED_LOCKED");
    return { token, project: await projectForToken(token) };
  }

  /** Everything First Assessment produced; Premium must never change any of it. */
  async function firstAssessmentRecords(projectId: string) {
    const q = async (sql: string) => (await h.client.query(sql, [projectId])).rows;
    return {
      project: await q("SELECT assessment_state, question_bank_version, rules_engine_version, snapshot_template_version, company_id, created_by_person_id FROM project WHERE project_id = $1"),
      snapshot: await q("SELECT snapshot_id, generated_at, content FROM snapshot WHERE project_id = $1"),
      internal: await q("SELECT internal_assessment_id, generated_at, content FROM internal_assessment WHERE project_id = $1"),
      findings: await q("SELECT area_id, status, reason_client, rule_triggered, evidence FROM finding WHERE project_id = $1 ORDER BY area_id"),
      alignment: await q("SELECT alignment, tension_area_id FROM priority_alignment WHERE project_id = $1"),
      capabilities: await q("SELECT category_id, rank, included_in_snapshot FROM capability_rank WHERE project_id = $1 ORDER BY rank"),
      answers: await q("SELECT answer_id, field_key, value FROM answer WHERE project_id = $1 ORDER BY answer_id"),
      lifecycle: await q("SELECT completed_at, retention_until FROM fa_project_lifecycle WHERE project_id = $1"),
    };
  }

  const count = async (sql: string, params: unknown[]) => (await h.client.query<{ n: number }>(sql, params)).rows[0]?.n;

  it("activates, cancels, lapses and reactivates one project with exactly one Precision handoff", async () => {
    const { token, project } = await completedProject();
    const id = project.project_id as string;
    const auth = { Authorization: `Bearer ${token}` };
    const before = await firstAssessmentRecords(id);
    const emailsBefore = h.email.messages.length;

    const initial = await h.api().get("/api/fa/session/premium").set(auth);
    expect(initial.body).toMatchObject({
      available: true, everActivated: false, accessActive: false, subscriptionStatus: null, canActivate: true, canReactivate: false,
      previewRoomUrl: "https://www.beeside.you/preview", termsUrl: "https://www.beeside.you/termsandconditions",
    });

    // Continue with Premium: Terms must be accepted; the default checkout records the request and waits.
    expect((await h.api().post("/api/fa/session/premium/activation").set(auth).send({})).status).toBe(400);
    const requested = await h.api().post("/api/fa/session/premium/activation").set(auth).send({ acceptTerms: true });
    expect(requested.status).toBe(201);
    expect(requested.body.outcome).toEqual({ kind: "pending_confirmation" });
    expect(requested.body.status).toMatchObject({ pendingRequest: { kind: "activation" }, accessActive: false, canActivate: false });
    expect((await h.api().post("/api/fa/session/premium/activation").set(auth).send({ acceptTerms: true })).body.outcome.kind).toBe("pending_confirmation");
    expect(await count("SELECT count(*)::int AS n FROM premium_activation_request WHERE project_id = $1", [id])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM precision_handoff_package WHERE project_id = $1", [id])).toBe(0);

    // premium_activated arrives through the signed, provider-agnostic contract.
    const activationPayload = { ...event(id, "premium_activated", "evt-activation-0001", 30), provider_reference: "manual-confirmation-1" };
    const activated = await sendEvent(activationPayload);
    expect(activated.status).toBe(201);
    expect(activated.body).toMatchObject({
      duplicate: false, subscriptionStatus: "PREMIUM_ACTIVE", premiumAccessActive: true, premiumEverActivated: true, precisionState: "STARTED", handoffGenerated: true,
    });
    const activationEventId = activated.body.eventId as string;
    const request1 = await h.client.query("SELECT status, fulfilled_by_event_id FROM premium_activation_request WHERE project_id = $1", [id]);
    expect(request1.rows[0]).toMatchObject({ status: "FULFILLED", fulfilled_by_event_id: activationEventId });
    const milestones = (await h.client.query("SELECT premium_first_activated_at, precision_started_at FROM project WHERE project_id = $1", [id])).rows[0];

    // A redelivered event is acknowledged, never re-applied; a forged one is refused.
    const replay = await sendEvent(activationPayload);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ duplicate: true, eventId: activationEventId, handoffGenerated: false });
    expect((await sendEvent(event(id, "cancellation_requested", "evt-forged-0001"), `sha256=${"0".repeat(64)}`)).status).toBe(401);
    expect((await sendEvent(event(id, "premium_activated", "evt-activation-0002", 30))).status).toBe(409);

    // Cancellation keeps access until the end of the paid period. Days later the working session has
    // expired, so the client returns through the private link sent with the Snapshot.
    const link = lastLinkToken(h);
    h.advanceDays(10);
    const cancelled = await sendEvent(event(id, "cancellation_requested", "evt-cancel-0001"));
    expect(cancelled.status).toBe(201);
    expect(cancelled.body).toMatchObject({ subscriptionStatus: "CANCELLATION_SCHEDULED", premiumAccessActive: true });
    const scheduled = await h.api().post("/api/fa/links/premium").send({ token: link });
    expect(scheduled.body).toMatchObject({ accessActive: true, subscriptionStatus: "CANCELLATION_SCHEDULED", accessUntil: activationPayload.current_period_end, canReactivate: false });
    await h.deps.db.transaction((tx) => linkOperationHub(tx, id, "clickup", "workspace-1"));

    // The period ends: current access stops, history stays.
    h.advanceDays(20);
    const ended = await sendEvent(event(id, "subscription_period_ended", "evt-period-end-0001"));
    expect(ended.body).toMatchObject({ subscriptionStatus: "PREMIUM_INACTIVE", premiumAccessActive: false, premiumEverActivated: true, precisionState: "STARTED" });
    const lapsed = await h.api().post("/api/fa/links/premium").send({ token: link });
    expect(lapsed.body).toMatchObject({ everActivated: true, accessActive: false, canActivate: false, canReactivate: true });
    expect(await operationHubAccess(h.deps.db, id)).toMatchObject({ accessActive: false, links: [{ externalSystem: "clickup", externalWorkspaceId: "workspace-1" }] });
    await expect(h.deps.db.transaction((tx) => linkOperationHub(tx, id, "future_system", null))).rejects.toMatchObject({ code: "NOT_APPLICABLE" });
    expect((await sendEvent(event(id, "cancellation_requested", "evt-cancel-0002"))).status).toBe(409);

    // Same-email return through the private link: routed by Premium history, reactivation on the same project.
    expect((await h.api().post("/api/fa/links/open").send({ token: link })).body).toMatchObject({ completed: true, premium: { everActivated: true, accessActive: false } });
    expect((await h.api().post("/api/fa/links/premium").send({ token: link })).body).toMatchObject({ canReactivate: true });
    const reactivationRequest = await h.api().post("/api/fa/links/premium/activation").send({ token: link, acceptTerms: true });
    expect(reactivationRequest.status).toBe(201);
    expect(reactivationRequest.body.status.pendingRequest).toMatchObject({ kind: "reactivation" });

    h.advanceDays(5);
    const reactivated = await sendEvent(event(id, "premium_reactivated", "evt-reactivation-0001", 30));
    expect(reactivated.status).toBe(201);
    expect(reactivated.body).toMatchObject({ projectId: id, subscriptionStatus: "PREMIUM_ACTIVE", premiumAccessActive: true, handoffGenerated: false });
    expect(reactivated.body.subscriptionId).not.toBe(activated.body.subscriptionId);
    expect((await h.api().post("/api/fa/links/open").send({ token: link })).body.premium).toEqual({ everActivated: true, accessActive: true });
    expect((await operationHubAccess(h.deps.db, id)).accessActive).toBe(true);

    // Invariants of the whole lifecycle.
    expect(await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1", [id])).toBe(2);
    const packages = await h.client.query("SELECT generated_by_event_id, source_snapshot_id, source_internal_assessment_id FROM precision_handoff_package WHERE project_id = $1", [id]);
    expect(packages.rows).toEqual([
      { generated_by_event_id: activationEventId, source_snapshot_id: before.snapshot[0].snapshot_id, source_internal_assessment_id: before.internal[0].internal_assessment_id },
    ]);
    expect((await h.client.query("SELECT premium_first_activated_at, precision_started_at FROM project WHERE project_id = $1", [id])).rows[0]).toEqual(milestones);
    expect(await count("SELECT count(*)::int AS n FROM outbox_event WHERE project_id = $1 AND event_type = 'precision.handoff_package_generated'", [id])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM outbox_event WHERE project_id = $1 AND event_type LIKE 'subscription.%'", [id])).toBe(4);
    const transitions = await h.client.query("SELECT from_state, to_state FROM subscription_state_transition WHERE project_id = $1 ORDER BY occurred_at, to_state", [id]);
    expect(transitions.rows).toHaveLength(4);
    expect(await firstAssessmentRecords(id)).toEqual(before);
    // No provider/client contact is triggered by the handoff (no messages sent by any subscription event).
    expect(h.email.messages.length).toBe(emailsBefore);
  });

  it("starts Precision from the frozen handoff and the canonical First Assessment context, adding only precision.* data", async () => {
    const { project } = await completedProject();
    const id = project.project_id as string;
    await expect(getPrecisionStartContext(h.deps.db, h.deps.bundles, id)).rejects.toMatchObject({ code: "NOT_APPLICABLE" });
    const now = h.clock.now;
    await h.deps.db.transaction((tx) =>
      processSubscriptionEvent(tx, h.deps.bundles, {
        projectId: id, eventType: "premium_activated", occurredAt: now, source: "manual_admin_injection", idempotencyKey: "manual-precision-0001", periodStart: now, periodEnd: new Date(now.getTime() + 30 * DAY),
      }),
    );

    const internal = (await h.client.query("SELECT internal_assessment_id, content FROM internal_assessment WHERE project_id = $1", [id])).rows[0];
    const snapshot = (await h.client.query("SELECT snapshot_id FROM snapshot WHERE project_id = $1", [id])).rows[0];
    const start = await getPrecisionStartContext(h.deps.db, h.deps.bundles, id);
    const pkg = start.handoffPackage.content;
    expect(pkg).toMatchObject({
      contractVersion: 1, projectId: id, personId: project.created_by_person_id, companyId: project.company_id,
      source: { snapshotId: snapshot.snapshot_id, internalAssessmentId: internal.internal_assessment_id, rulesEngineVersion: "re-1.0.0", snapshotTemplateVersion: "st-1.0.0" },
      guardrails: { findingsAreNotContractedServices: true, clientProviderDirectContact: "not_authorized", precisionNamespace: "precision.*", regeneratedOnReactivation: false },
    });
    expect(pkg.instruction).toMatch(/^Do not restart discovery/);
    expect(pkg.precisionFocus).toEqual(internal.content.precision_focus);
    expect(pkg.findings).toEqual(internal.content.findings);
    expect(pkg.executiveSummary).toEqual(internal.content.executive_summary);
    // Known structured information is declared as known, so Precision validates instead of re-asking.
    expect(pkg.knownInformation.structuredFieldKeys).toEqual(Object.keys(start.firstAssessment.structuredAnswers).sort());
    expect(pkg.knownInformation.structuredFieldKeys.length).toBeGreaterThan(10);
    expect(start.firstAssessment).toMatchObject({ projectId: id, personId: project.created_by_person_id, companyId: project.company_id });
    expect(start.precisionAnswers).toEqual([]);

    // Precision writes under its own namespace on the same project; First Assessment answers stay frozen.
    await h.client.query("SELECT field_registry_sync('precision', $1::jsonb)", [
      JSON.stringify([{ field_key: "precision.validation.target_market_confirmed", data_type: "boolean", source: "precision", module: "precision" }]),
    ]);
    await h.client.query(
      "INSERT INTO answer (project_id, field_key, value, value_type, question_bank_version) VALUES ($1, 'precision.validation.target_market_confirmed', 'true', 'boolean', $2)",
      [id, project.question_bank_version],
    );
    await h.client.query("SAVEPOINT fa_frozen");
    await expect(
      h.client.query("INSERT INTO answer (project_id, field_key, value, value_type, question_bank_version) VALUES ($1, 'fa.goal.primary_goal', '\"expand\"', 'string', $2)", [id, project.question_bank_version]),
    ).rejects.toMatchObject({ code: "BV409" });
    await h.client.query("ROLLBACK TO SAVEPOINT fa_frozen");

    const later = await getPrecisionStartContext(h.deps.db, h.deps.bundles, id);
    expect(later.precisionAnswers).toEqual([expect.objectContaining({ fieldKey: "precision.validation.target_market_confirmed", value: true })]);
    expect(later.handoffPackage).toEqual(start.handoffPackage);
  });

  it("activates immediately through the development-only simulated checkout, on the same processor", async () => {
    const { token, project } = await completedProject();
    h.deps.premium = { checkout: devSimulatedCheckout(h.deps) };
    try {
      const res = await h.api().post("/api/fa/session/premium/activation").set("Authorization", `Bearer ${token}`).send({ acceptTerms: true });
      expect(res.status).toBe(201);
      expect(res.body.outcome).toEqual({ kind: "activated" });
      expect(res.body.status).toMatchObject({ everActivated: true, accessActive: true, subscriptionStatus: "PREMIUM_ACTIVE", pendingRequest: null });
      const req = (await h.client.query("SELECT status, checkout_adapter, checkout_reference FROM premium_activation_request WHERE project_id = $1", [project.project_id])).rows[0];
      expect(req).toMatchObject({ status: "FULFILLED", checkout_adapter: "dev_simulated", checkout_reference: expect.stringMatching(/^dev-sim-/) });
      expect((await h.client.query("SELECT source FROM subscription_event WHERE project_id = $1", [project.project_id])).rows).toEqual([{ source: "dev_simulated" }]);
      expect(await count("SELECT count(*)::int AS n FROM precision_handoff_package WHERE project_id = $1", [project.project_id])).toBe(1);
    } finally {
      delete h.deps.premium;
    }
  });

  it("refuses subscription events and requests that do not follow the lifecycle", async () => {
    const inProgress = await h.api().post("/api/fa/identity").send(identity({ email: "still.answering@northwind-test.example" }));
    const openToken = inProgress.body.sessionToken as string;
    const openProject = await projectForToken(openToken);
    const status = await h.api().get("/api/fa/session/premium").set("Authorization", `Bearer ${openToken}`);
    expect(status.body).toMatchObject({ available: false, canActivate: false, canReactivate: false });
    expect((await h.api().post("/api/fa/session/premium/activation").set("Authorization", `Bearer ${openToken}`).send({ acceptTerms: true })).status).toBe(409);
    expect((await sendEvent(event(openProject.project_id, "premium_activated", "evt-open-activation", 30))).status).toBe(409);

    const { project } = await completedProject();
    const id = project.project_id as string;
    expect((await sendEvent(event(id, "cancellation_requested", "evt-early-cancel"))).status).toBe(409);
    expect((await sendEvent(event(id, "premium_reactivated", "evt-early-reactivation", 30))).status).toBe(409);
    expect((await sendEvent(event(id, "premium_activated", "evt-no-period"))).body).toMatchObject({ error: "INVALID_INPUT", details: { fields: ["current_period_end"] } });
    expect((await sendEvent({ ...event(id, "premium_activated", "evt-unknown-type", 30), event_type: "payment_succeeded" })).status).toBe(400);
    expect((await sendEvent({ ...event(id, "premium_activated", "short", 30) })).status).toBe(400);
    expect((await sendEvent(event("7d8e0f1a-2b3c-4d5e-8f90-1a2b3c4d5e6f", "premium_activated", "evt-unknown-project", 30))).status).toBe(404);

    expect((await sendEvent(event(id, "premium_activated", "evt-shared-key-0001", 30))).status).toBe(201);
    expect((await sendEvent(event(openProject.project_id, "cancellation_requested", "evt-shared-key-0001"))).status).toBe(400);
    expect(await count("SELECT count(*)::int AS n FROM subscription_event WHERE project_id = $1", [id])).toBe(1);
    expect((await h.client.query("SELECT assessment_state FROM project WHERE project_id = $1", [openProject.project_id])).rows[0].assessment_state).toBe("IN_PROGRESS");
  });

  it("never selects a project that entered Premium for the temporary retention lifecycle, even when activated on day 59", async () => {
    const { project } = await completedProject(undefined, true);
    const premiumId = project.project_id as string;
    const other = await h.api().post("/api/fa/identity").send(identity({ email: "no.premium@northwind-test.example" }));
    expect((await h.api().post("/api/fa/session/finish-later").set("Authorization", `Bearer ${other.body.sessionToken}`)).status).toBe(200);
    const otherId = (await projectForToken(other.body.sessionToken)).project_id as string;
    const lifecycle = await h.client.query<{ project_id: string; retention_until: Date }>(
      "SELECT project_id, retention_until FROM fa_project_lifecycle WHERE project_id = ANY($1::uuid[])",
      [[premiumId, otherId]],
    );
    const retention = new Map(lifecycle.rows.map((r) => [r.project_id, r.retention_until]));
    const premiumRetention = retention.get(premiumId) as Date;
    expect(premiumRetention).toBeInstanceOf(Date);

    h.clock.now = new Date(premiumRetention.getTime() - DAY);
    const now = h.clock.now;
    await h.deps.db.transaction((tx) =>
      processSubscriptionEvent(tx, h.deps.bundles, {
        projectId: premiumId, eventType: "premium_activated", occurredAt: now, source: "manual_admin_injection", idempotencyKey: "manual-day59-0001", periodStart: now, periodEnd: new Date(now.getTime() + 30 * DAY),
      }),
    );

    const after = new Date(Math.max(premiumRetention.getTime(), (retention.get(otherId) as Date).getTime()) + DAY);
    const candidates = await h.deps.db.transaction((tx) => temporaryRetentionCandidates(tx, after));
    expect(candidates).not.toContain(premiumId);
    expect(candidates).toContain(otherId);
  });
});
