import { CoreEntitlementProvider } from "../precision/adapters/core-entitlement";
import {
  activateProgram, addEligibleCompany, closeProgram, createProgram, createSponsor, entitlementCoveredUntil, issueGrant, recordPrivacyEvent, redeemProgram,
  syncEntitlementSources, terminateGrant,
} from "../premium/entitlement-grants";
import { sweepPrecisionAccess } from "../premium/precision-access";
import { PremiumPolicy } from "../premium/premium-policy";
import { processSubscriptionEvent } from "../premium/subscription-events";
import { MANUFACTURER, describeWithDb, identity, runJourney, useHarness } from "./fa-harness";

const DAY = 86_400_000;
const POLICY: PremiumPolicy = { accessPeriodDays: 120, readonlyGraceDays: 30 };

describeWithDb("Premium entitlement sources -> Core -> Precision (PostgreSQL, rolled back; Stripe is NOT involved)", () => {
  const h = useHarness();
  const provider = () => new CoreEntitlementProvider(h.deps.db, { policy: POLICY, now: () => h.clock.now });

  let seq = 0;
  async function lockedProject(): Promise<{ id: string; companyId: string }> {
    seq += 1;
    const start = await h.api().post("/api/fa/identity").send(identity({ email: `ent.source${seq}@northwind-test.example` }));
    expect(start.status).toBe(201);
    const token = start.body.sessionToken as string;
    expect((await runJourney(h, token, MANUFACTURER)).status).toBe("COMPLETED_LOCKED");
    const { rows } = await h.client.query(
      `SELECT p.project_id, p.company_id FROM project p JOIN project_access_token t ON t.project_id = p.project_id
        WHERE t.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [token],
    );
    return { id: rows[0].project_id, companyId: rows[0].company_id };
  }

  async function admin(label: string, role: "ADMIN" | "SUPER_ADMIN"): Promise<string> {
    const { rows } = await h.client.query("INSERT INTO admin_user (role, auth_identity) VALUES ($1, $2) RETURNING admin_user_id", [role, `${label}-${Date.now()}-${Math.random()}@beeside.internal`]);
    return rows[0].admin_user_id;
  }

  const simulatedActivation = (projectId: string, key: string, start: Date, days: number) =>
    h.deps.db.transaction((tx) =>
      processSubscriptionEvent(tx, h.deps.bundles, {
        projectId, eventType: "premium_activated", occurredAt: start, source: "dev_simulated", providerReference: key, idempotencyKey: key,
        periodStart: start, periodEnd: new Date(start.getTime() + days * DAY),
      }),
    );

  it("the same entitlement answer whichever source opened it: paid simulation, exception, promotion program, sponsored program", async () => {
    const [a, b, c, d] = [await lockedProject(), await lockedProject(), await lockedProject(), await lockedProject()];
    const adm = await admin("approver", "ADMIN");
    const sup = await admin("elevated", "SUPER_ADMIN");
    const now = h.clock.now;

    await simulatedActivation(a.id, "sim-ent-1", now, POLICY.accessPeriodDays);
    await issueGrant(h.deps.db, { scope: { projectId: b.id }, source: "complimentary", startsAt: now, endsAt: new Date(now.getTime() + 60 * DAY), reason: "design partner", approvedBy: adm, actor: `admin:${adm}`, now });

    // a promotion program (a rule): needs an elevated approver, an active status and its window
    const promo = await createProgram(h.deps.db, { code: "mx-launch", name: "Mexico launch", kind: "promotion", marketScope: ["MX"], grantDays: 45, startsAt: new Date(now.getTime() - DAY), endsAt: new Date(now.getTime() + 30 * DAY), maxRedemptions: 10, reason: "market opening", createdBy: adm });
    await expect(redeemProgram(h.deps.db, { programId: promo.program_id, projectId: c.id, market: "MX", now, actor: "system:redeem" })).rejects.toMatchObject({ code: "NOT_APPLICABLE" });
    await expect(activateProgram(h.deps.db, promo.program_id, adm)).rejects.toMatchObject({ code: "NOT_APPLICABLE" }); // a plain ADMIN cannot approve a program
    await activateProgram(h.deps.db, promo.program_id, sup);
    await expect(redeemProgram(h.deps.db, { programId: promo.program_id, projectId: c.id, market: "CO", now, actor: "system:redeem" })).rejects.toMatchObject({ code: "NOT_APPLICABLE" });
    const g = await redeemProgram(h.deps.db, { programId: promo.program_id, projectId: c.id, market: "mx", now, actor: "system:redeem" });
    expect((await redeemProgram(h.deps.db, { programId: promo.program_id, projectId: c.id, market: "MX", now, actor: "system:redeem" })).grant_id).toBe(g.grant_id); // idempotent retry

    // a sponsored program: the payer is an institution, the beneficiary keeps its own project, only listed companies qualify
    const sponsor = await createSponsor(h.deps.db, { name: "Scottish Development Agency", kind: "agency", country: "GB", createdBy: sup });
    await expect(createSponsor(h.deps.db, { name: "Not allowed", kind: "agency", createdBy: adm })).rejects.toMatchObject({ code: "NOT_APPLICABLE" });
    const program = await createProgram(h.deps.db, { code: "scot-export", name: "Scottish export programme", kind: "sponsored", sponsorId: sponsor.sponsor_id, agreementRef: "AGR-2026-014", grantDays: 365, startsAt: new Date(now.getTime() - DAY), endsAt: new Date(now.getTime() + 90 * DAY), maxRedemptions: 1, eligibility: "listed", reason: "economic development programme", createdBy: adm });
    await addEligibleCompany(h.deps.db, { programId: program.program_id, companyId: d.companyId, createdBy: sup });
    await activateProgram(h.deps.db, program.program_id, sup);
    await expect(redeemProgram(h.deps.db, { programId: program.program_id, projectId: a.id, now, actor: "system:redeem" })).rejects.toMatchObject({ code: "NOT_APPLICABLE" }); // not on the list
    await redeemProgram(h.deps.db, { programId: program.program_id, projectId: d.id, now, actor: "system:redeem" });

    for (const p of [a, b, c, d]) expect(await provider().get(p.id)).toMatchObject({ projectId: p.id, premiumActive: true, accessMode: "FULL" });
    expect((await h.client.query("SELECT count(*)::int AS n FROM subscription WHERE project_id = ANY($1)", [[b.id, c.id, d.id]])).rows[0].n).toBe(0);
    await closeProgram(h.deps.db, promo.program_id, now);
    expect((await provider().get(c.id)).accessMode).toBe("FULL"); // closing a program revokes nothing already issued
  });

  it("governance: a plain ADMIN approves only individual, bounded exceptions; broad grants need an elevated approver", async () => {
    const a = await lockedProject();
    const adm = await admin("approver", "ADMIN");
    const sup = await admin("elevated", "SUPER_ADMIN");
    const now = h.clock.now;
    const base = { source: "manual" as const, startsAt: now, reason: "support exception", actor: "admin", now };
    // longer than the configurable ADMIN limit -> needs an elevated approver
    await expect(issueGrant(h.deps.db, { ...base, scope: { projectId: a.id }, endsAt: new Date(now.getTime() + 400 * DAY), approvedBy: adm })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    // a company-level grant approved by an ADMIN is refused by the database too
    await expect(issueGrant(h.deps.db, { ...base, scope: { companyId: a.companyId, companyScope: "current_projects" }, endsAt: new Date(now.getTime() + 30 * DAY), approvedBy: adm })).rejects.toMatchObject({ code: "NOT_APPLICABLE" });
    await issueGrant(h.deps.db, { ...base, scope: { projectId: a.id }, endsAt: new Date(now.getTime() + 400 * DAY), approvedBy: sup });
    expect((await provider().get(a.id)).accessMode).toBe("FULL");
  });

  it("project first: a company agreement covers only its explicit scope, never projects created later by default", async () => {
    const a = await lockedProject();
    const sup = await admin("elevated", "SUPER_ADMIN");
    const now = h.clock.now;
    await h.client.query("UPDATE project SET created_at = $2 WHERE project_id = $1", [a.id, new Date(now.getTime() - 5 * DAY)]);
    await issueGrant(h.deps.db, { scope: { companyId: a.companyId, companyScope: "current_projects" }, source: "partner", startsAt: now, endsAt: new Date(now.getTime() + 30 * DAY), reason: "channel partner agreement", approvedBy: sup, actor: `admin:${sup}`, now });
    expect(await provider().get(a.id)).toMatchObject({ premiumActive: true, accessMode: "FULL" });
    // a second project of the same company, created AFTER the agreement, is not covered
    const { rows } = await h.client.query(
      `INSERT INTO project (company_id, created_by_person_id, responsible_person_id, question_bank_version, rules_engine_version, snapshot_template_version, created_at, assessment_state)
       SELECT company_id, created_by_person_id, responsible_person_id, question_bank_version, rules_engine_version, snapshot_template_version, $2, 'COMPLETED_LOCKED' FROM project WHERE project_id = $1 RETURNING project_id`,
      [a.id, new Date(now.getTime() + DAY)],
    );
    expect((await provider().get(rows[0].project_id as string)).accessMode).toBe("REVOKED");
  });

  it("a grant ends by the clock: READ_ONLY (derived, even before the sync), then settled window, then REVOKED; a chained extension continues FULL", async () => {
    const a = await lockedProject();
    const b = await lockedProject();
    const adm = await admin("approver", "ADMIN");
    const t0 = h.clock.now;

    const first = await issueGrant(h.deps.db, { scope: { projectId: a.id }, source: "trial", startsAt: t0, endsAt: new Date(t0.getTime() + 20 * DAY), reason: "trial", approvedBy: adm, actor: `admin:${adm}`, now: t0 });
    const gb = await issueGrant(h.deps.db, { scope: { projectId: b.id }, source: "partner", startsAt: t0, endsAt: new Date(t0.getTime() + 20 * DAY), reason: "partner", approvedBy: adm, actor: `admin:${adm}`, now: t0 });
    await issueGrant(h.deps.db, { scope: { projectId: b.id }, source: "partner", startsAt: new Date(t0.getTime() + 20 * DAY), endsAt: new Date(t0.getTime() + 50 * DAY), reason: "extension", approvedBy: adm, actor: `admin:${adm}`, extendsGrantId: gb.grant_id, now: t0 });

    h.advanceDays(21);
    expect(await provider().get(a.id)).toMatchObject({ premiumActive: false, accessMode: "READ_ONLY" });
    const sync = await syncEntitlementSources(h.deps.db, { now: h.clock.now });
    expect(sync.ended).toBeGreaterThanOrEqual(1);
    await sweepPrecisionAccess(h.deps.db, h.deps.bundles, { now: h.clock.now, policy: POLICY });
    const ea = (await h.client.query("SELECT * FROM entitlement WHERE project_id = $1", [a.id])).rows[0];
    expect(ea).toMatchObject({ precision_access_mode: "READ_ONLY", premium_access_active: false, grace_days_applied: 30 });
    expect(new Date(ea.premium_ended_at).getTime()).toBe(first.ends_at.getTime());
    expect(await provider().get(b.id)).toMatchObject({ premiumActive: true, accessMode: "FULL" });
    expect((await h.client.query("SELECT precision_access_mode FROM entitlement WHERE project_id = $1", [b.id])).rows[0].precision_access_mode).toBe("FULL");

    h.advanceDays(31);
    await syncEntitlementSources(h.deps.db, { now: h.clock.now });
    await sweepPrecisionAccess(h.deps.db, h.deps.bundles, { now: h.clock.now, policy: POLICY });
    expect((await provider().get(a.id)).accessMode).toBe("REVOKED");
    expect(await syncEntitlementSources(h.deps.db, { now: h.clock.now })).toEqual({ activated: 0, ended: 0 });
  });

  it("a future-dated grant opens at its start through the sync; early termination ends it", async () => {
    const a = await lockedProject();
    const adm = await admin("approver", "ADMIN");
    const t0 = h.clock.now;
    const g = await issueGrant(h.deps.db, { scope: { projectId: a.id }, source: "manual", startsAt: new Date(t0.getTime() + 5 * DAY), endsAt: new Date(t0.getTime() + 25 * DAY), reason: "scheduled", approvedBy: adm, actor: `admin:${adm}`, now: t0 });
    expect((await provider().get(a.id)).accessMode).toBe("REVOKED"); // no Core record yet
    h.advanceDays(6);
    expect((await syncEntitlementSources(h.deps.db, { now: h.clock.now })).activated).toBe(1);
    expect((await provider().get(a.id)).accessMode).toBe("FULL");
    await terminateGrant(h.deps.db, { grantId: g.grant_id, terminatedBy: adm, reason: "mistake", now: h.clock.now });
    expect((await provider().get(a.id)).accessMode).toBe("READ_ONLY");
    await expect(terminateGrant(h.deps.db, { grantId: g.grant_id, terminatedBy: adm, reason: "again", now: h.clock.now })).rejects.toMatchObject({ code: "NOT_APPLICABLE" });
  });

  it("STACKING RULE: a paid term begins when the access already held ends; free days are kept; the source of activation does not matter", async () => {
    const a = await lockedProject();
    const b = await lockedProject();
    const adm = await admin("approver", "ADMIN");
    const t0 = h.clock.now;
    // a has 20 free days and then pays (simulated activation, same boundary Stripe will use)
    await issueGrant(h.deps.db, { scope: { projectId: a.id }, source: "trial", startsAt: t0, endsAt: new Date(t0.getTime() + 20 * DAY), reason: "trial", approvedBy: adm, actor: `admin:${adm}`, now: t0 });
    expect((await entitlementCoveredUntil(h.deps.db, a.id, t0)).getTime()).toBe(t0.getTime() + 20 * DAY);
    await simulatedActivation(a.id, "sim-stack-a", t0, 120);
    const sub = (await h.client.query("SELECT current_period_start, current_period_end FROM subscription WHERE project_id = $1", [a.id])).rows[0];
    expect(new Date(sub.current_period_start).getTime()).toBe(t0.getTime() + 20 * DAY);
    expect(new Date(sub.current_period_end).getTime()).toBe(t0.getTime() + 140 * DAY);
    expect(await provider().get(a.id)).toMatchObject({ premiumActive: true, accessMode: "FULL" });
    // b has no other access: the term starts now (no behaviour change for paid-only projects)
    await simulatedActivation(b.id, "sim-stack-b", t0, 120);
    const subB = (await h.client.query("SELECT current_period_start FROM subscription WHERE project_id = $1", [b.id])).rows[0];
    expect(new Date(subB.current_period_start).getTime()).toBe(t0.getTime());
  });

  it("PRIVACY OVERRIDES COMMERCE: a blocked or anonymized project is REVOKED for Precision even while the entitlement is valid", async () => {
    const a = await lockedProject();
    const adm = await admin("approver", "ADMIN");
    const t0 = h.clock.now;
    await issueGrant(h.deps.db, { scope: { projectId: a.id }, source: "manual", startsAt: t0, endsAt: new Date(t0.getTime() + 300 * DAY), reason: "r", approvedBy: adm, actor: "admin", now: t0 });
    expect(await provider().get(a.id)).toMatchObject({ premiumActive: true, accessMode: "FULL" });
    await recordPrivacyEvent(h.deps.db, { projectId: a.id, event: "access_blocked", reasonCode: "erasure_request", actor: `admin:${adm}` });
    expect(await provider().get(a.id)).toMatchObject({ premiumActive: false, accessMode: "REVOKED" });
    // the commercial record is intact (separate concerns) and nothing new can be granted
    expect((await h.client.query("SELECT premium_access_active FROM entitlement WHERE project_id = $1", [a.id])).rows[0].premium_access_active).toBe(true);
    await expect(issueGrant(h.deps.db, { scope: { projectId: a.id }, source: "manual", startsAt: t0, endsAt: new Date(t0.getTime() + 5 * DAY), reason: "r", approvedBy: adm, actor: "admin", now: t0 })).rejects.toMatchObject({ code: "NOT_APPLICABLE" });
    await recordPrivacyEvent(h.deps.db, { projectId: a.id, event: "access_restored", reasonCode: "other", actor: `admin:${adm}` });
    expect((await provider().get(a.id)).accessMode).toBe("FULL");
    await recordPrivacyEvent(h.deps.db, { projectId: a.id, event: "anonymized", reasonCode: "erasure_request", actor: `admin:${adm}` });
    expect((await provider().get(a.id)).accessMode).toBe("REVOKED");
    await expect(recordPrivacyEvent(h.deps.db, { projectId: a.id, event: "access_restored", reasonCode: "other", actor: "x" })).rejects.toMatchObject({ code: "NOT_APPLICABLE" });
  });
});
