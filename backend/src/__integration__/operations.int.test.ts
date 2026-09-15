import { ensureDevBootstrapAdmin } from "../fa/admin/publish-config";
import { buildQuestionBankBundle } from "../fa/content/question-bank";
import { formatDate } from "../fa/services/repository";
import { enqueueEmail, retryDelivery } from "../operations/email-outbox";
import { JobName, runJob } from "../operations/jobs";
import { processSubscriptionEvent } from "../premium/subscription-events";
import { MANUFACTURER, describeWithDb, identity, lastLinkToken, runJourney, useHarness } from "./fa-harness";

const DAY = 86_400_000;

describeWithDb("Operations & lifecycle control: outbox, jobs, reminders, recovery and retention (PostgreSQL, rolled back)", () => {
  const h = useHarness();
  const run = (job: JobName) => runJob(h.deps, job, { trigger: "test" });

  async function projectForToken(token: string) {
    const { rows } = await h.client.query(
      `SELECT p.* FROM project p JOIN project_access_token t ON t.project_id = p.project_id
        WHERE t.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [token],
    );
    return rows[0];
  }
  const lifecycle = async (projectId: string) => (await h.client.query("SELECT * FROM fa_project_lifecycle WHERE project_id = $1", [projectId])).rows[0];
  const count = async (sql: string, params: unknown[]) => (await h.client.query<{ n: number }>(sql, params)).rows[0]?.n;
  const templates = () => h.email.messages.map((m) => m.template);

  async function startWithLink(email: string) {
    const start = await h.api().post("/api/fa/identity").send(identity({ email }));
    expect(start.status).toBe(201);
    const token = start.body.sessionToken as string;
    await h.api().put("/api/fa/session/answers/STORY").set("Authorization", `Bearer ${token}`).send({ value: "Our story" });
    expect((await h.api().post("/api/fa/session/finish-later").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    const project = await projectForToken(token);
    return { token, projectId: project.project_id as string, link: lastLinkToken(h) };
  }

  it("runs the 15-day calendar: day-10 reminder with the exact date, one expiry record, one day-21 recovery, then silence — and purges on day 60", async () => {
    const day0 = h.clock.now.getTime();
    const { projectId, link } = await startWithLink("calendar@northwind-test.example");
    const l = await lifecycle(projectId);
    expect(l.retention_basis).toBe("ACCESS_WINDOW");
    expect(new Date(l.retention_until).getTime()).toBe(day0 + 60 * DAY);
    expect(templates()).toEqual(["resume_link"]);

    h.advanceDays(9);
    expect((await run("access_lifecycle")).status).toBe("SUCCEEDED");
    await run("email_outbox");
    expect(templates()).toEqual(["resume_link"]);

    h.advanceDays(1);
    const reminder = await run("access_lifecycle");
    expect(reminder).toMatchObject({ status: "SUCCEEDED", stats: { reminders: 1, recoveries: 0 } });
    expect(await run("access_lifecycle")).toMatchObject({ stats: { reminders: 0 } });
    await run("email_outbox");
    const reminderMail = h.email.messages[h.email.messages.length - 1];
    expect(reminderMail?.template).toBe("access_reminder_day10");
    expect(reminderMail?.subject).toBe("Tu First Assessment estará guardado 5 días más");
    expect(reminderMail?.body).toContain(`disponible hasta el ${formatDate(new Date(day0 + 15 * DAY), "es")}`);
    // The newest private link replaces the Finish Later link.
    expect((await h.api().post("/api/fa/links/open").send({ token: link })).status).toBe(404);
    const reminderLink = lastLinkToken(h);
    expect((await h.api().post("/api/fa/links/open").send({ token: reminderLink })).body).toMatchObject({ canContinue: true });
    // Opening the link never extends access.
    expect(new Date((await lifecycle(projectId)).access_expires_at).getTime()).toBe(day0 + 15 * DAY);

    h.advanceDays(5.1);
    expect(await run("access_lifecycle")).toMatchObject({ stats: { expiries_recorded: 1 } });
    expect(await run("access_lifecycle")).toMatchObject({ stats: { expiries_recorded: 0 } });
    expect(await count("SELECT count(*)::int AS n FROM fa_journey_event WHERE project_id = $1 AND event_type = 'assessment_expired'", [projectId])).toBe(1);

    h.clock.now = new Date(day0 + 21 * DAY);
    expect(await run("access_lifecycle")).toMatchObject({ stats: { recoveries: 1 } });
    await run("email_outbox");
    const recoveryMail = h.email.messages[h.email.messages.length - 1];
    expect(recoveryMail).toMatchObject({ template: "access_recovery_day21", ctaLabel: "Recuperar mi evaluación" });
    expect(recoveryMail?.body).toContain(formatDate(new Date(day0 + 45 * DAY), "es"));
    const sentSoFar = h.email.messages.length;

    h.clock.now = new Date(day0 + 30 * DAY);
    expect(await run("access_lifecycle")).toMatchObject({ stats: { reminders: 0, recoveries: 0 } });
    await run("email_outbox");
    expect(h.email.messages).toHaveLength(sentSoFar);

    // Recovery: immediate, structured, capped; the contextual help comes the next day, not now.
    const recoveryLink = lastLinkToken(h);
    const recovered = await h.api().post("/api/fa/links/extend").send({ token: recoveryLink, days: 15, reason: "missing_information" });
    expect(new Date(recovered.body.accessUntil).getTime()).toBe(day0 + 45 * DAY);
    expect(h.email.messages).toHaveLength(sentSoFar);
    h.advanceDays(1);
    await run("email_outbox");
    const followup = h.email.messages[h.email.messages.length - 1];
    expect(followup).toMatchObject({ template: "access_followup_missing_information", ctaLabel: "Continuar First Assessment", secondaryCtaUrl: "https://www.beeside.you/preview" });
    // No further automated reminder after the recovery email, even as the recovered window nears its end.
    h.clock.now = new Date(day0 + 41 * DAY);
    expect(await run("access_lifecycle")).toMatchObject({ stats: { reminders: 0, recoveries: 0 } });

    h.clock.now = new Date(day0 + 46 * DAY);
    expect((await h.api().post("/api/fa/links/open").send({ token: lastLinkToken(h) })).body).toMatchObject({ closed: true, canRecover: false });

    h.clock.now = new Date(day0 + 60 * DAY + 60_000);
    const purge = await run("temporary_retention");
    expect(purge).toMatchObject({ status: "SUCCEEDED", stats: { purged: 1 } });
    const project = (await h.client.query("SELECT assessment_state FROM project WHERE project_id = $1", [projectId])).rows[0];
    expect(project.assessment_state).toBe("DELETED");
    const transitions = await h.client.query("SELECT to_state FROM assessment_state_transition WHERE project_id = $1 ORDER BY occurred_at, to_state", [projectId]);
    expect(transitions.rows.map((r) => r.to_state).slice(-2)).toEqual(["EXPIRED", "DELETED"]);
    for (const table of ["answer", "project_access_token", "legal_acceptance", "fa_access_extension", "email_delivery", "email_event"]) {
      expect(await count(`SELECT count(*)::int AS n FROM ${table} WHERE project_id = $1`, [projectId])).toBe(0);
    }
    expect(await count("SELECT count(*)::int AS n FROM fa_journey_event WHERE project_id = $1", [projectId])).toBeGreaterThan(0);
    expect((await h.client.query("SELECT primary_email, first_name FROM person p JOIN project pr ON pr.created_by_person_id = p.person_id WHERE pr.project_id = $1", [projectId])).rows[0]).toMatchObject({ first_name: "Deleted" });
    expect(await count("SELECT count(*)::int AS n FROM retention_purge_record WHERE project_id = $1", [projectId])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM admin_audit_event WHERE project_id = $1 AND action = 'retention.project_purged' AND actor_type = 'SYSTEM'", [projectId])).toBe(1);
    expect((await h.api().post("/api/fa/links/open").send({ token: lastLinkToken(h) })).status).toBe(404);
    // After DELETED, the same email behaves as if no prior project existed.
    expect((await h.api().post("/api/fa/identity").send(identity({ email: "calendar@northwind-test.example" }))).status).toBe(201);
  });

  it("gives a completed First Assessment that never emitted a private link a deterministic retention date, and purges it", async () => {
    const start = await h.api().post("/api/fa/identity").send(identity({ email: "one.sitting@northwind-test.example" }));
    const day0 = h.clock.now.getTime();
    const token = start.body.sessionToken as string;
    expect((await runJourney(h, token, MANUFACTURER)).status).toBe("COMPLETED_LOCKED");
    const project = await projectForToken(token);
    const l = await lifecycle(project.project_id);
    expect(l).toMatchObject({ access_window_started_at: null, access_expires_at: null, retention_basis: "LIFECYCLE_ORIGIN" });
    expect(new Date(l.retention_until).getTime()).toBe(day0 + 60 * DAY);
    expect(templates()).toContain("snapshot_ready");

    h.clock.now = new Date(day0 + 59 * DAY);
    expect(await run("temporary_retention")).toMatchObject({ stats: { purged: 0 } });
    h.clock.now = new Date(day0 + 60 * DAY + 60_000);
    expect(await run("temporary_retention")).toMatchObject({ stats: { purged: 1 } });
    expect((await h.client.query("SELECT assessment_state FROM project WHERE project_id = $1", [project.project_id])).rows[0].assessment_state).toBe("DELETED");
    for (const table of ["snapshot", "internal_assessment", "finding", "capability_rank", "priority_alignment", "answer"]) {
      expect(await count(`SELECT count(*)::int AS n FROM ${table} WHERE project_id = $1`, [project.project_id])).toBe(0);
    }
  });

  it("never purges a project that entered Premium — activated on day 59, then cancelled and lapsed — nor one with a pending Premium request", async () => {
    const a = await h.api().post("/api/fa/identity").send(identity({ email: "premium.day59@northwind-test.example" }));
    const day0 = h.clock.now.getTime();
    await runJourney(h, a.body.sessionToken, MANUFACTURER);
    const premiumProject = (await projectForToken(a.body.sessionToken)).project_id as string;
    const b = await h.api().post("/api/fa/identity").send(identity({ email: "pending.request@northwind-test.example" }));
    await runJourney(h, b.body.sessionToken, MANUFACTURER);
    const pendingProject = (await projectForToken(b.body.sessionToken)).project_id as string;
    expect((await h.api().post("/api/fa/session/premium/activation").set("Authorization", `Bearer ${b.body.sessionToken}`).send({ acceptTerms: true })).status).toBe(201);

    h.clock.now = new Date(day0 + 59 * DAY);
    const at = h.clock.now;
    await h.deps.db.transaction((tx) =>
      processSubscriptionEvent(tx, h.deps.bundles, { projectId: premiumProject, eventType: "premium_activated", occurredAt: at, source: "manual_admin_injection", idempotencyKey: "ops-day59", periodStart: at, periodEnd: new Date(at.getTime() + 30 * DAY) }),
    );
    h.clock.now = new Date(day0 + 61 * DAY);
    expect(await run("temporary_retention")).toMatchObject({ stats: { purged: 0 } });
    const cancelAt = h.clock.now;
    await h.deps.db.transaction((tx) => processSubscriptionEvent(tx, h.deps.bundles, { projectId: premiumProject, eventType: "cancellation_requested", occurredAt: cancelAt, source: "manual_admin_injection", idempotencyKey: "ops-cancel" }));
    h.clock.now = new Date(day0 + 90 * DAY);
    const endAt = h.clock.now;
    await h.deps.db.transaction((tx) => processSubscriptionEvent(tx, h.deps.bundles, { projectId: premiumProject, eventType: "subscription_period_ended", occurredAt: endAt, source: "manual_admin_injection", idempotencyKey: "ops-end" }));
    h.clock.now = new Date(day0 + 400 * DAY);
    expect(await run("temporary_retention")).toMatchObject({ stats: { purged: 0 } });
    for (const id of [premiumProject, pendingProject]) {
      expect((await h.client.query("SELECT assessment_state FROM project WHERE project_id = $1", [id])).rows[0].assessment_state).toBe("COMPLETED_LOCKED");
      expect(await count("SELECT count(*)::int AS n FROM snapshot WHERE project_id = $1", [id])).toBe(1);
    }
  });

  it("delivers email only after commit, retries with backoff, gives up after the cap, and lets an ADMIN retry", async () => {
    h.email.failNext = [new Error("provider refused mail for ana@northwind-test.example")];
    const start = await h.api().post("/api/fa/identity").send(identity({ email: "retry@northwind-test.example" }));
    await h.api().post("/api/fa/session/finish-later").set("Authorization", `Bearer ${start.body.sessionToken}`);
    const projectId = (await projectForToken(start.body.sessionToken)).project_id as string;
    const failed = (await h.client.query("SELECT delivery_id, status, attempts, last_error FROM email_delivery WHERE project_id = $1", [projectId])).rows[0];
    expect(failed).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(failed.last_error).toContain("[address]");
    expect(failed.last_error).not.toContain("@");
    expect(h.email.messages).toHaveLength(0);
    // The link issued for the failed attempt is revoked, so no working link exists without an email.
    expect(await count("SELECT count(*)::int AS n FROM project_access_token WHERE project_id = $1 AND kind = 'RESUME' AND revoked_at IS NULL", [projectId])).toBe(0);

    expect(await run("email_outbox")).toMatchObject({ stats: { claimed: 0 } });
    h.advanceMinutes(2);
    expect(await run("email_outbox")).toMatchObject({ stats: { sent: 1 } });
    expect(h.email.idempotencyKeys).toEqual([failed.delivery_id]);

    // Five consecutive failures → DEAD; an ADMIN retry restarts the budget and delivers.
    const other = await h.api().post("/api/fa/identity").send(identity({ email: "dead@northwind-test.example" }));
    h.email.failNext = Array.from({ length: 5 }, () => new Error("provider down"));
    await h.api().post("/api/fa/session/finish-later").set("Authorization", `Bearer ${other.body.sessionToken}`);
    const deadProject = (await projectForToken(other.body.sessionToken)).project_id as string;
    for (let i = 0; i < 5; i++) {
      h.advanceDays(1);
      await run("email_outbox");
    }
    const dead = (await h.client.query("SELECT delivery_id, status, attempts FROM email_delivery WHERE project_id = $1", [deadProject])).rows[0];
    expect(dead).toMatchObject({ status: "DEAD", attempts: 5 });
    expect(await h.deps.db.transaction((tx) => retryDelivery(tx, dead.delivery_id, h.clock.now))).toBe(true);
    expect(await run("email_outbox")).toMatchObject({ stats: { sent: 1 } });

    // A crashed sender's lease is taken over; an enqueue with the same dedupe key is ignored.
    const personId = (await projectForToken(other.body.sessionToken)).created_by_person_id as string;
    const again = await h.deps.db.transaction((tx) =>
      enqueueEmail(tx, { dedupeKey: `test-lease-${deadProject}`, projectId: deadProject, personId, template: "existing_assessment_link", enqueuedBy: "test", now: h.clock.now }),
    );
    expect(again).toBeTruthy();
    const duplicate = await h.deps.db.transaction((tx) => enqueueEmail(tx, { dedupeKey: `test-lease-${deadProject}`, projectId: deadProject, personId, template: "existing_assessment_link", enqueuedBy: "test", now: h.clock.now }));
    expect(duplicate).toBeNull();
    await h.client.query("UPDATE email_delivery SET status = 'SENDING', attempts = attempts + 1, lease_until = $2 WHERE delivery_id = $1", [again, new Date(h.clock.now.getTime() + 300_000)]);
    expect(await run("email_outbox")).toMatchObject({ stats: { claimed: 0 } });
    h.advanceMinutes(6);
    expect(await run("email_outbox")).toMatchObject({ stats: { sent: 1 } });
    expect((await h.client.query("SELECT status, attempts FROM email_delivery WHERE delivery_id = $1", [again])).rows[0]).toEqual({ status: "SENT", attempts: 2 });
  });

  it("skips a duplicate runner and continues after a crashed run", async () => {
    await h.client.query("INSERT INTO job_run (job_name, trigger, started_at, heartbeat_at) VALUES ('access_lifecycle', 'test', $1, $1)", [h.clock.now]);
    expect(await run("access_lifecycle")).toEqual({ status: "SKIPPED", reason: "already_running" });
    h.advanceMinutes(16);
    expect((await run("access_lifecycle")).status).toBe("SUCCEEDED");
    const runs = await h.client.query("SELECT status FROM job_run WHERE job_name = 'access_lifecycle' ORDER BY started_at");
    expect(runs.rows.map((r) => r.status)).toEqual(["ABANDONED", "SUCCEEDED"]);
  });

  it("changes the access calendar through a published configuration version — no migration, no code change", async () => {
    const adminId = await ensureDevBootstrapAdmin(h.client);
    const bundle = buildQuestionBankBundle();
    bundle.lifecycle = { ...bundle.lifecycle!, initial_access_days: 21, reminder_day: 16, recovery_email_day: 27 };
    const version = "fa-qb-ops-21-days";
    await h.client.query("SELECT config_create_draft('QUESTION_BANK', $1, $2::jsonb, $3)", [version, JSON.stringify(bundle), adminId]);
    await h.client.query("SELECT config_submit_for_preview('QUESTION_BANK', $1, $2)", [version, adminId]);
    await h.client.query("SELECT config_record_review('QUESTION_BANK', $1, $2, 'APPROVED', true, 'ops test')", [version, adminId]);
    await h.client.query("SELECT config_publish('QUESTION_BANK', $1, $2)", [version, adminId]);

    const day0 = h.clock.now.getTime();
    const { projectId } = await startWithLink("twentyone@northwind-test.example");
    const l = await lifecycle(projectId);
    expect(new Date(l.access_expires_at).getTime()).toBe(day0 + 21 * DAY);
    expect(new Date(l.access_max_until).getTime()).toBe(day0 + 45 * DAY);
    h.clock.now = new Date(day0 + 15 * DAY);
    expect(await run("access_lifecycle")).toMatchObject({ stats: { reminders: 0 } });
    h.clock.now = new Date(day0 + 16 * DAY);
    expect(await run("access_lifecycle")).toMatchObject({ stats: { reminders: 1 } });
    await run("email_outbox");
    expect(h.email.messages[h.email.messages.length - 1]?.body).toContain(formatDate(new Date(day0 + 21 * DAY), "es"));
    h.clock.now = new Date(day0 + 27 * DAY);
    expect(await run("access_lifecycle")).toMatchObject({ stats: { recoveries: 1 } });
  });

  it("records which configuration supplied the legal documents; the Privacy Policy URL is never invented", async () => {
    const start = await h.api().post("/api/fa/identity").send(identity({ email: "legal@northwind-test.example" }));
    const projectId = (await projectForToken(start.body.sessionToken)).project_id as string;
    const rows = (await h.client.query("SELECT document, document_url, question_bank_version FROM legal_acceptance WHERE project_id = $1 ORDER BY document", [projectId])).rows;
    expect(rows).toEqual([
      { document: "PRIVACY_POLICY", document_url: null, question_bank_version: "fa-qb-1.1.0" },
      { document: "TERMS", document_url: "https://www.beeside.you/termsandconditions", question_bank_version: "fa-qb-1.1.0" },
    ]);
  });
});
