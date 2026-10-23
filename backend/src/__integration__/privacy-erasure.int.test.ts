import { randomUUID } from "node:crypto";
import { tablesWithResidue } from "../__tests__/helpers/privacy-canary";
import { CoreEntitlementProvider } from "../precision/adapters/core-entitlement";
import { recordPrivacyEvent } from "../premium/entitlement-grants";
import { PremiumPolicy } from "../premium/premium-policy";
import { processSubscriptionEvent } from "../premium/subscription-events";
import { approvePolicy, currentPolicy, erasureRuns, executeErasure, planErasure } from "../privacy/erasure";
import { MANUFACTURER, describeWithDb, identity, runJourney, useHarness } from "./fa-harness";

const DAY = 86_400_000;
const POLICY: PremiumPolicy = { accessPeriodDays: 120, readonlyGraceDays: 30 };

describeWithDb("Privacy erasure — First Assessment + Premium side (PostgreSQL, rolled back)", () => {
  const h = useHarness();
  const provider = () => new CoreEntitlementProvider(h.deps.db, { policy: POLICY, now: () => h.clock.now });

  /** A completed First Assessment whose every client-entered value carries a unique canary. */
  async function canaryProject(): Promise<{ id: string; companyId: string; personId: string; canaries: string[]; email: string }> {
    const c = randomUUID().replace(/-/g, "").slice(0, 10);
    const email = `canary.${c}@erase-test.example`;
    const canaries = [c, `Zorro${c}`, `Quimbaya${c}`];
    const start = await h.api().post("/api/fa/identity").send(identity({ email, firstName: `Zorro${c}`, lastName: `Quimbaya${c}`, company: `Canaria ${c} S.A. de C.V.`, website: `www.canary-${c}.example` }));
    expect(start.status).toBe(201);
    const token = start.body.sessionToken as string;
    const journey = { ...MANUFACTURER, STORY: `We make industrial valves in Texas (${c}) and need to start assembling in Mexico.`, G2: `Deliver the first contract volumes ${c} on time.` };
    expect((await runJourney(h, token, journey)).status).toBe("COMPLETED_LOCKED");
    const { rows } = await h.client.query(
      `SELECT p.project_id, p.company_id, p.created_by_person_id FROM project p JOIN project_access_token t ON t.project_id = p.project_id WHERE t.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [token],
    );
    return { id: rows[0].project_id, companyId: rows[0].company_id, personId: rows[0].created_by_person_id, canaries, email };
  }

  async function superAdmin(): Promise<string> {
    const { rows } = await h.client.query("INSERT INTO admin_user (role, auth_identity) VALUES ('SUPER_ADMIN', $1) RETURNING admin_user_id", [`priv-${Date.now()}-${Math.random()}@beeside.internal`]);
    return rows[0].admin_user_id;
  }

  const activate = (projectId: string, at: Date, days = 120) =>
    h.deps.db.transaction((tx) =>
      processSubscriptionEvent(tx, h.deps.bundles, {
        projectId, eventType: "premium_activated", occurredAt: at, source: "dev_simulated", providerReference: `sim-${projectId}`, idempotencyKey: `sim-${projectId}`,
        periodStart: at, periodEnd: new Date(at.getTime() + days * DAY),
      }),
    );
  const endSubscription = (projectId: string, at: Date) =>
    h.deps.db.transaction((tx) =>
      processSubscriptionEvent(tx, h.deps.bundles, { projectId, eventType: "subscription_period_ended", occurredAt: at, source: "dev_simulated", providerReference: `end-${projectId}`, idempotencyKey: `end-${projectId}` }),
    );
  const count = async (sql: string, params: unknown[]) => Number((await h.client.query(sql, params)).rows[0].n);

  beforeEach(async () => {
    // other suites may have committed an approved policy; this test controls its own
    await h.client.query("UPDATE privacy_policy SET status = 'retired', retired_at = now() WHERE status = 'approved'");
  });

  it("REGISTRY: every table of the database is classified, and every classified table exists (a new table cannot slip past the erasure)", async () => {
    const tables = (await h.client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")).rows.map((r) => r.table_name as string);
    const registered = (await h.client.query("SELECT table_name FROM privacy_erasure_registry")).rows.map((r) => r.table_name as string);
    expect(tables.filter((t) => !registered.includes(t)).sort()).toEqual([]);
    expect(registered.filter((t) => !tables.includes(t)).sort()).toEqual([]);
    // the erase order is a strict, gap-free-enough sequence and the registry itself cannot be edited at runtime
    await expect(h.client.query("SAVEPOINT s1").then(() => h.client.query("UPDATE privacy_erasure_registry SET action = 'keep' WHERE table_name = 'answer'"))).rejects.toMatchObject({ code: "BV409" });
    await h.client.query("ROLLBACK TO SAVEPOINT s1");
  });

  it("POLICY GATE: no approved policy -> refused; the SUPER_ADMIN approves the terms; the window, the block and a running subscription each hold the erasure back", async () => {
    const p = await canaryProject();
    const sup = await superAdmin();
    const t0 = h.clock.now;
    expect(await currentPolicy(h.deps.db)).toBeNull();
    expect(await planErasure(h.deps.db, p.id, "admin:test", t0)).toMatchObject({ eligible: false, reason: "no_approved_policy" });
    // a refused execution is evidence, not a side effect on the data
    expect(await executeErasure(h.deps.db, p.id, "admin:test", t0)).toMatchObject({ eligible: false, reason: "no_approved_policy" });
    expect((await erasureRuns(h.deps.db, p.id)).map((r) => [r.outcome, r.refusal_reason])).toEqual([["refused", "no_approved_policy"]]);
    expect(await count("SELECT count(*)::int AS n FROM answer WHERE project_id = $1", [p.id])).toBeGreaterThan(0);

    // only an elevated approver can approve a policy, in the database too
    const plain = (await h.client.query("INSERT INTO admin_user (role, auth_identity) VALUES ('ADMIN', $1) RETURNING admin_user_id", [`plain-${Math.random()}@beeside.internal`])).rows[0].admin_user_id;
    await expect(approvePolicy(h.deps.db, { minDaysAfterBlock: 30, retainLegalAcceptance: false, approvedBy: plain, now: t0 })).rejects.toMatchObject({ code: "NOT_APPLICABLE" });
    const policy = await approvePolicy(h.deps.db, { minDaysAfterBlock: 30, retainLegalAcceptance: false, approvedBy: sup, now: t0 });
    expect(policy).toMatchObject({ min_days_after_block: 30, retain_legal_acceptance: false });
    // terms never change in place; a new approval retires the previous one
    await expect(h.client.query("SAVEPOINT s2").then(() => h.client.query("UPDATE privacy_policy SET min_days_after_block = 0 WHERE status = 'approved'"))).rejects.toMatchObject({ code: "BV409" });
    await h.client.query("ROLLBACK TO SAVEPOINT s2");

    await activate(p.id, t0);
    expect(await planErasure(h.deps.db, p.id, "admin:test", t0)).toMatchObject({ eligible: false, reason: "not_blocked" });
    await recordPrivacyEvent(h.deps.db, { projectId: p.id, event: "access_blocked", reasonCode: "erasure_request", actor: `admin:${sup}` });
    expect(await planErasure(h.deps.db, p.id, "admin:test", t0)).toMatchObject({ eligible: false, reason: "retention_window_open" });
    const later = new Date(t0.getTime() + 31 * DAY);
    expect(await planErasure(h.deps.db, p.id, "admin:test", later)).toMatchObject({ eligible: false, reason: "subscription_running" });
    expect(await executeErasure(h.deps.db, p.id, "admin:test", later)).toMatchObject({ eligible: false, reason: "subscription_running" });
    expect(await count("SELECT count(*)::int AS n FROM answer WHERE project_id = $1", [p.id])).toBeGreaterThan(0); // nothing was touched
    await endSubscription(p.id, later);
    expect(await planErasure(h.deps.db, p.id, "admin:test", later)).toMatchObject({ eligible: true });
  });

  it("EXECUTION: client content and credentials are gone, identity anonymised, commercial/audit/analytics kept, nothing of the client left ANYWHERE (canary scan)", async () => {
    const p = await canaryProject();
    const sup = await superAdmin();
    const t0 = h.clock.now;
    await approvePolicy(h.deps.db, { minDaysAfterBlock: 30, retainLegalAcceptance: false, approvedBy: sup, now: t0 });
    await activate(p.id, t0);
    // the legacy handoff package (still stored for projects activated before F5) carries client text too
    await h.client.query("UPDATE project SET precision_state = 'STARTED' WHERE project_id = $1", [p.id]);
    await h.client.query(
      `INSERT INTO precision_handoff_package (project_id, content, contract_version, source_snapshot_id, source_internal_assessment_id, generated_by_event_id)
       SELECT $1, jsonb_build_object('note', $2::text), 1, (SELECT snapshot_id FROM snapshot WHERE project_id = $1), (SELECT internal_assessment_id FROM internal_assessment WHERE project_id = $1),
              (SELECT event_id FROM subscription_event WHERE project_id = $1 AND event_type = 'premium_activated')`,
      [p.id, `handoff ${p.canaries[0]}`],
    );
    await h.client.query("INSERT INTO snapshot_feedback (project_id, question_version, usefulness, comment, channel, interface_language) VALUES ($1, (SELECT question_bank_version FROM project WHERE project_id = $1), 4, $2, 'session', 'es')", [p.id, `muy util ${p.canaries[0]}`]);

    // sanity: the canaries really are spread over the database before the erasure
    const before = await tablesWithResidue(h.client, p.canaries);
    expect(before).toEqual(expect.arrayContaining(["answer", "person", "company", "snapshot", "internal_assessment", "snapshot_feedback", "email_event"]));

    await recordPrivacyEvent(h.deps.db, { projectId: p.id, event: "access_blocked", reasonCode: "erasure_request", actor: `admin:${sup}` });
    const later = new Date(t0.getTime() + 31 * DAY);
    await endSubscription(p.id, later);
    const plan = await planErasure(h.deps.db, p.id, `admin:${sup}`, later);
    expect(plan.eligible).toBe(true);
    expect(plan.would_delete).toMatchObject({ answer: expect.any(Number), snapshot: 1, internal_assessment: 1, precision_handoff_package: 1, legal_acceptance: expect.any(Number) });
    expect(await tablesWithResidue(h.client, p.canaries)).toEqual(before); // a dry run changes nothing

    const subs = await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1", [p.id]);
    const events = await count("SELECT count(*)::int AS n FROM subscription_event WHERE project_id = $1", [p.id]);
    const journey = await count("SELECT count(*)::int AS n FROM fa_journey_event WHERE project_id = $1", [p.id]);

    const result = await executeErasure(h.deps.db, p.id, `admin:${sup}`, later);
    expect(result).toMatchObject({ eligible: true, executed: true, person_anonymized: true, company_anonymized: true });
    expect((result as { deleted_rows: Record<string, number> }).deleted_rows).toEqual(plan.would_delete); // the plan was the truth

    expect(await tablesWithResidue(h.client, p.canaries)).toEqual([]);
    for (const t of ["answer", "finding", "priority_alignment", "capability_rank", "snapshot", "internal_assessment", "precision_handoff_package", "snapshot_feedback", "project_access_token", "email_event", "email_delivery", "legal_acceptance"]) {
      expect(await count(`SELECT count(*)::int AS n FROM ${t} WHERE project_id = $1`, [p.id])).toBe(0);
    }
    // kept by design
    expect(await count("SELECT count(*)::int AS n FROM subscription WHERE project_id = $1", [p.id])).toBe(subs);
    expect(await count("SELECT count(*)::int AS n FROM subscription_event WHERE project_id = $1", [p.id])).toBe(events);
    expect(await count("SELECT count(*)::int AS n FROM fa_journey_event WHERE project_id = $1", [p.id])).toBeGreaterThanOrEqual(journey);
    expect(await count("SELECT count(*)::int AS n FROM project WHERE project_id = $1", [p.id])).toBe(1);
    const person = (await h.client.query("SELECT first_name, last_name, primary_email FROM person WHERE person_id = $1", [p.personId])).rows[0];
    expect(person).toEqual({ first_name: "Deleted", last_name: "Deleted", primary_email: `deleted-${p.personId}@deleted.invalid` });
    expect((await h.client.query("SELECT name, website FROM company WHERE company_id = $1", [p.companyId])).rows[0]).toEqual({ name: "Deleted company", website: null });
    // the ledger ends at anonymized, written by the erasure itself, and access stays REVOKED
    expect((await h.client.query("SELECT state FROM project_privacy_state WHERE project_id = $1", [p.id])).rows[0].state).toBe("anonymized");
    expect((await provider().get(p.id)).accessMode).toBe("REVOKED");
    // evidence: one completed run with ids and counts only; a second request is a no-op
    expect(await executeErasure(h.deps.db, p.id, `admin:${sup}`, later)).toMatchObject({ eligible: false, reason: "already_erased" });
    const runs = await erasureRuns(h.deps.db, p.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ outcome: "completed", person_anonymized: true, company_anonymized: true, policy_version: expect.any(Number) });
    expect(JSON.stringify(runs)).not.toMatch(new RegExp(p.canaries[0] as string));
    // analytics: an opaque event, codes only
    const ev = (await h.client.query("SELECT properties FROM fa_journey_event WHERE event_type = 'privacy_block_applied' AND project_id = $1 ORDER BY ctid", [p.id])).rows.map((r) => r.properties);
    expect(ev.at(-1)).toEqual({ privacy_event: "anonymized", reason_code: "erasure_request" });
  });

  it("SHARED IDENTITY: a person/company that still belongs to another live project is NOT anonymised; legal acceptance survives when the policy keeps it", async () => {
    const p = await canaryProject();
    const sup = await superAdmin();
    const t0 = h.clock.now;
    await approvePolicy(h.deps.db, { minDaysAfterBlock: 0, retainLegalAcceptance: true, approvedBy: sup, now: t0 });
    // a second live project of the same person and company
    await h.client.query(
      `INSERT INTO project (company_id, created_by_person_id, responsible_person_id, question_bank_version, rules_engine_version, snapshot_template_version)
       SELECT company_id, created_by_person_id, responsible_person_id, question_bank_version, rules_engine_version, snapshot_template_version FROM project WHERE project_id = $1`,
      [p.id],
    );
    await recordPrivacyEvent(h.deps.db, { projectId: p.id, event: "access_blocked", reasonCode: "legal_order", actor: `admin:${sup}` });
    const legal = await count("SELECT count(*)::int AS n FROM legal_acceptance WHERE project_id = $1", [p.id]);
    expect(legal).toBeGreaterThan(0);
    const out = await executeErasure(h.deps.db, p.id, `admin:${sup}`, new Date(t0.getTime() + 60_000));
    expect(out).toMatchObject({ eligible: true, executed: true, person_anonymized: false, company_anonymized: false, retained_by_policy: { legal_acceptance: legal } });
    expect(await count("SELECT count(*)::int AS n FROM legal_acceptance WHERE project_id = $1", [p.id])).toBe(legal);
    expect((await h.client.query("SELECT first_name FROM person WHERE person_id = $1", [p.personId])).rows[0].first_name).toBe(`Zorro${p.canaries[0]}`);
  });

  it("GUARDS STAY SHUT: the erasure flag does not open anything it was not given — other projects, kept tables, other statements", async () => {
    const a = await canaryProject();
    const b = await canaryProject();
    const adm = await superAdmin();
    await activate(a.id, h.clock.now);
    await recordPrivacyEvent(h.deps.db, { projectId: a.id, event: "access_blocked", reasonCode: "other", actor: `admin:${adm}` });
    await h.client.query("INSERT INTO admin_audit_event (actor_type, action, outcome, project_id) VALUES ('SYSTEM', 'test.guard', 'ALLOWED', $1)", [a.id]);
    for (const t of ["subscription_event", "project_privacy_event", "fa_journey_event", "admin_audit_event"]) expect(await count(`SELECT count(*)::int AS n FROM ${t} WHERE project_id = $1`, [a.id])).toBeGreaterThan(0); // the deletes below would otherwise touch no row and prove nothing
    await h.client.query("SELECT set_config('app.privacy_erasure_project', $1, true)", [a.id]);
    await h.client.query("SAVEPOINT g1");
    await expect(h.client.query("DELETE FROM answer WHERE project_id = $1", [b.id])).rejects.toMatchObject({ code: expect.stringMatching(/BV409|P0001/) }); // another project
    await h.client.query("ROLLBACK TO SAVEPOINT g1");
    for (const t of ["subscription_event", "project_privacy_event", "fa_journey_event", "admin_audit_event"]) {
      await h.client.query("SAVEPOINT g2");
      await expect(h.client.query(`DELETE FROM ${t} WHERE project_id = $1`, [a.id])).rejects.toBeTruthy(); // a kept table, even for the flagged project
      await h.client.query("ROLLBACK TO SAVEPOINT g2");
    }
    await h.client.query("SAVEPOINT g3");
    await expect(h.client.query("UPDATE answer SET field_key = 'x' WHERE project_id = $1", [a.id])).rejects.toBeTruthy(); // only DELETE is ever exempt
    await h.client.query("ROLLBACK TO SAVEPOINT g3");
    await h.client.query("SELECT set_config('app.privacy_erasure_project', '', true)");
    expect(await count("SELECT count(*)::int AS n FROM answer WHERE project_id = ANY($1)", [[a.id, b.id]])).toBeGreaterThan(0);
  });
});
