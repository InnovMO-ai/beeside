import { CoreEntitlementProvider } from "../precision/adapters/core-entitlement";
import { activateCampaign, closeCampaign, createCampaign, issueGrant, redeemCampaign, syncEntitlementSources, terminateGrant } from "../premium/entitlement-grants";
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

  async function admin(label: string): Promise<string> {
    const { rows } = await h.client.query("INSERT INTO admin_user (role, auth_identity) VALUES ('ADMIN', $1) RETURNING admin_user_id", [`${label}-${Date.now()}-${Math.random()}@beeside.internal`]);
    return rows[0].admin_user_id;
  }

  it("the same entitlement answer whichever source opened it: paid simulation, grant, campaign redemption", async () => {
    const a = await lockedProject();
    const b = await lockedProject();
    const c = await lockedProject();
    const adm = await admin("approver");
    const now = h.clock.now;

    // 1) paid, through the SAME provider-agnostic boundary Stripe uses (simulated activation, no Stripe)
    await h.deps.db.transaction((tx) =>
      processSubscriptionEvent(tx, h.deps.bundles, {
        projectId: a.id, eventType: "premium_activated", occurredAt: now, source: "dev_simulated", providerReference: "sim-1",
        idempotencyKey: "sim-ent-1", periodStart: now, periodEnd: new Date(now.getTime() + POLICY.accessPeriodDays * DAY),
      }),
    );
    // 2) a complimentary exception
    await issueGrant(h.deps.db, {
      scope: { projectId: b.id }, source: "complimentary", startsAt: now, endsAt: new Date(now.getTime() + 60 * DAY),
      reason: "design partner", approvedBy: adm, actor: `admin:${adm}`, now,
    });
    // 3) a campaign (rule) redeemed
    const campaign = await createCampaign(h.deps.db, {
      code: "mx-launch", name: "Mexico launch", kind: "promotion", marketScope: ["MX"], grantDays: 45, startsAt: new Date(now.getTime() - DAY),
      endsAt: new Date(now.getTime() + 30 * DAY), maxRedemptions: 10, reason: "market opening", createdBy: adm,
    });
    await expect(redeemCampaign(h.deps.db, { campaignId: campaign.campaign_id, projectId: c.id, market: "MX", now, actor: "system:redeem" })).rejects.toMatchObject({ code: "NOT_APPLICABLE" });
    await activateCampaign(h.deps.db, campaign.campaign_id, adm);
    await expect(redeemCampaign(h.deps.db, { campaignId: campaign.campaign_id, projectId: c.id, market: "CO", now, actor: "system:redeem" })).rejects.toMatchObject({ code: "NOT_APPLICABLE" });
    const g = await redeemCampaign(h.deps.db, { campaignId: campaign.campaign_id, projectId: c.id, market: "mx", now, actor: "system:redeem" });
    // retry is idempotent
    expect((await redeemCampaign(h.deps.db, { campaignId: campaign.campaign_id, projectId: c.id, market: "MX", now, actor: "system:redeem" })).grant_id).toBe(g.grant_id);

    for (const p of [a, b, c]) {
      expect(await provider().get(p.id)).toMatchObject({ projectId: p.id, premiumActive: true, accessMode: "FULL" });
    }
    // Nothing paid exists for b / c
    expect((await h.client.query("SELECT count(*)::int AS n FROM subscription WHERE project_id = ANY($1)", [[b.id, c.id]])).rows[0].n).toBe(0);
    // Closing the campaign does not revoke issued grants
    await closeCampaign(h.deps.db, campaign.campaign_id, now);
    expect((await provider().get(c.id)).accessMode).toBe("FULL");
  });

  it("a grant ends by the clock: READ_ONLY (derived, even before the sync), then settled window, then REVOKED; a chained extension continues FULL", async () => {
    const a = await lockedProject();
    const b = await lockedProject();
    const adm = await admin("approver");
    const t0 = h.clock.now;

    const first = await issueGrant(h.deps.db, { scope: { projectId: a.id }, source: "trial", startsAt: t0, endsAt: new Date(t0.getTime() + 20 * DAY), reason: "trial", approvedBy: adm, actor: `admin:${adm}`, now: t0 });
    const ga = await issueGrant(h.deps.db, { scope: { projectId: b.id }, source: "partner", startsAt: t0, endsAt: new Date(t0.getTime() + 20 * DAY), reason: "partner", approvedBy: adm, actor: `admin:${adm}`, now: t0 });
    // b gets a chained extension that starts exactly when the first ends
    await issueGrant(h.deps.db, { scope: { projectId: b.id }, source: "partner", startsAt: new Date(t0.getTime() + 20 * DAY), endsAt: new Date(t0.getTime() + 50 * DAY), reason: "extension", approvedBy: adm, actor: `admin:${adm}`, extendsGrantId: ga.grant_id, now: t0 });

    h.advanceDays(21);
    // not synced yet: the clock already closes a
    expect(await provider().get(a.id)).toMatchObject({ premiumActive: false, accessMode: "READ_ONLY" });
    // sync + sweep
    const sync = await syncEntitlementSources(h.deps.db, { now: h.clock.now });
    expect(sync.ended).toBeGreaterThanOrEqual(1);
    await sweepPrecisionAccess(h.deps.db, h.deps.bundles, { now: h.clock.now, policy: POLICY });
    const ea = (await h.client.query("SELECT * FROM entitlement WHERE project_id = $1", [a.id])).rows[0];
    expect(ea).toMatchObject({ precision_access_mode: "READ_ONLY", premium_access_active: false, grace_days_applied: 30 });
    expect(new Date(ea.premium_ended_at).getTime()).toBe(first.ends_at.getTime());
    // b continues without ever dropping
    expect(await provider().get(b.id)).toMatchObject({ premiumActive: true, accessMode: "FULL" });
    expect((await h.client.query("SELECT precision_access_mode FROM entitlement WHERE project_id = $1", [b.id])).rows[0].precision_access_mode).toBe("FULL");

    h.advanceDays(31);
    await syncEntitlementSources(h.deps.db, { now: h.clock.now });
    await sweepPrecisionAccess(h.deps.db, h.deps.bundles, { now: h.clock.now, policy: POLICY });
    expect((await provider().get(a.id)).accessMode).toBe("REVOKED");
    // idempotent
    expect(await syncEntitlementSources(h.deps.db, { now: h.clock.now })).toEqual({ activated: 0, ended: 0 });
  });

  it("a future-dated grant opens at its start through the sync; early termination ends it; company grants cover the company's locked projects", async () => {
    const a = await lockedProject();
    const adm = await admin("approver");
    const t0 = h.clock.now;
    const g = await issueGrant(h.deps.db, { scope: { projectId: a.id }, source: "manual", startsAt: new Date(t0.getTime() + 5 * DAY), endsAt: new Date(t0.getTime() + 25 * DAY), reason: "scheduled", approvedBy: adm, actor: `admin:${adm}`, now: t0 });
    expect((await provider().get(a.id)).accessMode).toBe("REVOKED"); // no Core record yet
    h.advanceDays(6);
    expect((await syncEntitlementSources(h.deps.db, { now: h.clock.now })).activated).toBe(1);
    expect((await provider().get(a.id)).accessMode).toBe("FULL");
    await terminateGrant(h.deps.db, { grantId: g.grant_id, terminatedBy: adm, reason: "mistake", now: h.clock.now });
    expect((await provider().get(a.id)).accessMode).toBe("READ_ONLY");
    await expect(terminateGrant(h.deps.db, { grantId: g.grant_id, terminatedBy: adm, reason: "again", now: h.clock.now })).rejects.toMatchObject({ code: "NOT_APPLICABLE" });

    const co = await lockedProject();
    await issueGrant(h.deps.db, { scope: { companyId: co.companyId }, source: "partner", startsAt: h.clock.now, endsAt: new Date(h.clock.now.getTime() + 30 * DAY), reason: "channel partner", approvedBy: adm, actor: `admin:${adm}`, now: h.clock.now });
    expect((await provider().get(co.id)).accessMode).toBe("FULL");
  });

  it("a payment during free access keeps FULL and Precision cannot tell; ending the free grant leaves paid access intact", async () => {
    const a = await lockedProject();
    const adm = await admin("approver");
    const t0 = h.clock.now;
    const g = await issueGrant(h.deps.db, { scope: { projectId: a.id }, source: "trial", startsAt: t0, endsAt: new Date(t0.getTime() + 10 * DAY), reason: "trial", approvedBy: adm, actor: `admin:${adm}`, now: t0 });
    await h.deps.db.transaction((tx) =>
      processSubscriptionEvent(tx, h.deps.bundles, {
        projectId: a.id, eventType: "premium_activated", occurredAt: t0, source: "dev_simulated", idempotencyKey: "sim-ent-pay", periodStart: t0, periodEnd: new Date(t0.getTime() + 120 * DAY),
      }),
    );
    h.advanceDays(11);
    await syncEntitlementSources(h.deps.db, { now: h.clock.now });
    expect(await provider().get(a.id)).toMatchObject({ premiumActive: true, accessMode: "FULL" });
    expect(g.grant_id).toBeTruthy();
  });
});
