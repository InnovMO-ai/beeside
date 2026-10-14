import { randomUUID } from "node:crypto";
import { METRIC_CATALOG, precisionAi, precisionCommercial, precisionFunnel, precisionQuality } from "../analytics/precision-metrics";
import { V1_EVENTS } from "../analytics/v1-events";
import { activateProgram, createProgram, issueGrant, redeemProgram, recordPrivacyEvent } from "../premium/entitlement-grants";
import { processSubscriptionEvent } from "../premium/subscription-events";
import { MANUFACTURER, describeWithDb, identity, runJourney, useHarness } from "./fa-harness";

const DAY = 86_400_000;

describeWithDb("Precision V1.0 analytics query layer (PostgreSQL, rolled back): one event layer, canonical metrics, no PII", () => {
  const h = useHarness();
  const range = () => ({ from: new Date(h.clock.now.getTime() - DAY), to: new Date(h.clock.now.getTime() + DAY) });

  let seq = 0;
  async function lockedProject(): Promise<string> {
    seq += 1;
    const start = await h.api().post("/api/fa/identity").send(identity({ email: `an.v1.${seq}.${randomUUID().slice(0, 6)}@northwind-test.example` }));
    const token = start.body.sessionToken as string;
    await runJourney(h, token, MANUFACTURER);
    const { rows } = await h.client.query("SELECT p.project_id FROM project p JOIN project_access_token t ON t.project_id = p.project_id WHERE t.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [token]);
    return rows[0].project_id;
  }
  async function admin(role: "ADMIN" | "SUPER_ADMIN"): Promise<string> {
    const { rows } = await h.client.query("INSERT INTO admin_user (role, auth_identity) VALUES ($1, $2) RETURNING admin_user_id", [role, `an-${role}-${Math.random()}@beeside.internal`]);
    return rows[0].admin_user_id;
  }
  const ev = (project: string, name: string, key: string, properties: object = {}, at = h.clock.now) =>
    h.client.query("INSERT INTO precision_journey_event (event_name, event_key, project_id, properties, occurred_at) VALUES ($1, $2, $3, $4::jsonb, $5)", [name, key, project, JSON.stringify(properties), at]);

  it("CATALOG: every metric names its source, statuses follow the event catalog, and nothing is approximated", () => {
    const ids = METRIC_CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of METRIC_CATALOG) expect(m.source.length).toBeGreaterThan(3);
    // the metrics that need Fase 1 behaviour say so instead of showing a number
    const pending = METRIC_CATALOG.filter((m) => m.status === "awaiting_product_layer").map((m) => m.id);
    expect(pending).toEqual(expect.arrayContaining(["quality.repeated_question_rate", "quality.correction_rate", "quality.clarification_loops", "quality.misunderstanding_repair", "quality.noise_filtered", "quality.client_priority_captured", "quality.understanding_depth"]));
    // once the product layer emits an event, its catalog status flips to `emitted` and the metric becomes live without code here
    expect(V1_EVENTS.client_priority_set.status).toBe("defined");
  });

  it("FUNNEL: a cohort by first Precision visit; each stage counted once per project; conversions are against the cohort and the previous stage", async () => {
    const before = await precisionFunnel(h.deps.db, range());
    const [a, b] = [await lockedProject(), await lockedProject()];
    const t = h.clock.now;
    for (const [p, stages] of [[a, ["precision_started", "understanding_started", "my_service_map_ready", "my_service_map_confirmed", "category_started", "crp_ready_for_review"]], [b, ["precision_started", "understanding_started"]]] as const) {
      for (const s of stages) await ev(p, s, `${s}:${p}`, {}, t);
      await ev(p, stages[0], `dup:${p}`, {}, t); // the same stage twice: still one project
    }
    await ev(a, "crp_ready_for_review", `second:${a}`, {}, t); // a second CRP: still one project
    const after = await precisionFunnel(h.deps.db, range());
    const delta = (id: string) => (after.stages.find((s) => s.id === id)?.projects ?? 0) - (before.stages.find((s) => s.id === id)?.projects ?? 0);
    expect([delta("funnel.opened"), delta("funnel.understanding_started"), delta("funnel.understanding_completed"), delta("funnel.service_map_confirmed"), delta("funnel.category_started"), delta("funnel.crp_ready"), delta("funnel.crp_confirmed"), delta("funnel.send")]).toEqual([2, 2, 1, 1, 1, 1, 0, 0]);
    for (const s of after.stages) expect(s.ofOpened === null || (s.ofOpened >= 0 && s.ofOpened <= 1)).toBe(true);
    // outside the range the project is not in the cohort
    const far = await precisionFunnel(h.deps.db, { from: new Date(t.getTime() + 10 * DAY), to: new Date(t.getTime() + 11 * DAY) });
    expect(far.stages[0]?.projects).toBe(0);
  });

  it("QUALITY + AI: process-question rate from turn kinds (never text), Add a Service, unknown needs, CRP change requests, AI outcomes by latency bucket", async () => {
    const p = await lockedProject();
    const t = h.clock.now;
    const base = await precisionQuality(h.deps.db, range());
    const baseAi = await precisionAi(h.deps.db, range());
    const instance = (await h.client.query("INSERT INTO precision_instance (project_id, scope) VALUES ($1, 'project') RETURNING id", [p])).rows[0].id;
    const canary = `canario-${randomUUID().slice(0, 8)}`;
    for (const [i, kind] of (["message", "message", "process_question", "message"] as const).entries()) {
      await h.client.query("INSERT INTO precision_turn (project_id, scope_instance_id, turn_key, role, surface, kind, locale, content) VALUES ($1, $2, $3, 'client', 'understanding', $4, 'en', $5)", [p, instance, `q${i}-${randomUUID().slice(0, 6)}`.padEnd(12, "x"), kind, `${canary} ${i}`]);
    }
    await ev(p, "add_service_started", `as1:${p}`); await ev(p, "add_service_started", `as2:${p}`); await ev(p, "add_service_completed", `ac1:${p}`);
    await ev(p, "possible_new_service_detected", `pn:${p}`); await ev(p, "crp_change_requested", `cc:${p}`);
    await ev(p, "critical_item_created", `ci1:${p}`); await ev(p, "critical_item_created", `ci2:${p}`); await ev(p, "critical_item_resolved", `cr1:${p}`);
    await ev(p, "ai_turn_completed", `ai1:${p}`, { surface: "understanding", status: "ok", latency_bucket: "2_5s" });
    await ev(p, "ai_turn_completed", `ai2:${p}`, { surface: "understanding", status: "ai_unavailable", latency_bucket: "gte_20s" });
    const q = await precisionQuality(h.deps.db, range());
    expect(q.clientTurns - base.clientTurns).toBe(4);
    expect(q.addService.started - base.addService.started).toBe(2);
    expect(q.addService.completed - base.addService.completed).toBe(1);
    expect(q.unknownLegitimateNeed - base.unknownLegitimateNeed).toBe(1);
    expect(q.crpChangeRequests - base.crpChangeRequests).toBe(1);
    expect(q.criticalItems.created - base.criticalItems.created).toBe(2);
    expect(q.awaitingProductLayer).toEqual(expect.arrayContaining(["quality.repeated_question_rate", "quality.clarification_loops"]));
    const ai = await precisionAi(h.deps.db, range());
    expect(ai.turns - baseAi.turns).toBe(2);
    expect(ai.bySurface.understanding?.latency["gte_20s"]).toBeGreaterThanOrEqual(1);
    expect(ai.fallback.status).toBe("awaiting_product_layer");
    // no conversation text anywhere in the views or the metric payloads
    const views = ["analytics_v1_events", "analytics_v1_project_funnel", "analytics_v1_commercial_tmp", "analytics_v1_entitlement_state", "analytics_v1_turns"].map((v) => v.replace("_tmp", "_events"));
    for (const v of views) expect((await h.client.query(`SELECT count(*)::int AS n FROM ${v} x WHERE x::text ILIKE $1`, [`%${canary}%`])).rows[0].n).toBe(0);
    expect(JSON.stringify([q, ai])).not.toContain(canary);
    expect(t).toBeTruthy();
  });

  it("COMMERCIAL: source, activation, renewal, read-only, revoked and reactivation are readable from the same layer; privacy shows apart from commerce", async () => {
    const [paid, comp, promo, sponsored] = [await lockedProject(), await lockedProject(), await lockedProject(), await lockedProject()];
    const adm = await admin("ADMIN");
    const sup = await admin("SUPER_ADMIN");
    const t = h.clock.now;
    const base = await precisionCommercial(h.deps.db, range());
    await h.deps.db.transaction((tx) => processSubscriptionEvent(tx, h.deps.bundles, { projectId: paid, eventType: "premium_activated", occurredAt: t, source: "dev_simulated", providerReference: "an-p", idempotencyKey: "an-p", periodStart: t, periodEnd: new Date(t.getTime() + 120 * DAY) }));
    await h.deps.db.transaction((tx) => processSubscriptionEvent(tx, h.deps.bundles, { projectId: paid, eventType: "subscription_renewed", occurredAt: t, source: "dev_simulated", providerReference: "an-r", idempotencyKey: "an-r", periodStart: new Date(t.getTime() + 120 * DAY), periodEnd: new Date(t.getTime() + 240 * DAY) }));
    await issueGrant(h.deps.db, { scope: { projectId: comp }, source: "complimentary", startsAt: t, endsAt: new Date(t.getTime() + 30 * DAY), reason: "demo", approvedBy: adm, actor: `admin:${adm}`, now: t });
    const program = await createProgram(h.deps.db, { code: `an-${Math.random().toString(36).slice(2, 8)}`, name: "an promo", kind: "promotion", grantDays: 30, startsAt: new Date(t.getTime() - DAY), endsAt: new Date(t.getTime() + 30 * DAY), maxRedemptions: 5, reason: "x", createdBy: adm });
    await activateProgram(h.deps.db, program.program_id, sup);
    await redeemProgram(h.deps.db, { programId: program.program_id, projectId: promo, now: t, actor: "system:redeem" });
    const sp = await createProgram(h.deps.db, { code: `an-s-${Math.random().toString(36).slice(2, 8)}`, name: "an sponsored", kind: "trial", grantDays: 14, startsAt: new Date(t.getTime() - DAY), endsAt: new Date(t.getTime() + 30 * DAY), maxRedemptions: 5, reason: "x", createdBy: adm });
    await activateProgram(h.deps.db, sp.program_id, sup);
    await redeemProgram(h.deps.db, { programId: sp.program_id, projectId: sponsored, now: t, actor: "system:redeem" });
    await recordPrivacyEvent(h.deps.db, { projectId: sponsored, event: "access_blocked", reasonCode: "other", actor: `admin:${sup}` });

    const c = await precisionCommercial(h.deps.db, range());
    expect(c.period.activations - base.period.activations).toBe(1);
    expect(c.period.renewals - base.period.renewals).toBe(1);
    expect(c.period.grantsIssued - base.period.grantsIssued).toBe(3); // complimentary + promotion + trial
    expect(c.period.programsRedeemed - base.period.programsRedeemed).toBe(2);
    expect(c.period.privacyBlocks - base.period.privacyBlocks).toBe(1);
    expect((c.now.bySource.paid ?? 0) - (base.now.bySource.paid ?? 0)).toBe(1);
    expect((c.now.bySource.complimentary ?? 0) - (base.now.bySource.complimentary ?? 0)).toBe(1);
    expect((c.now.byPrivacy.blocked ?? 0) - (base.now.byPrivacy.blocked ?? 0)).toBe(1);
    // privacy is a separate dimension: the blocked project keeps its commercial source
    const row = (await h.client.query("SELECT access_mode, privacy_state, sources FROM analytics_v1_entitlement_state WHERE project_id = $1", [sponsored])).rows[0];
    expect(row.privacy_state).toBe("blocked");
    expect(row.sources.length).toBeGreaterThan(0);
  });

  it("CONTRACT: the views expose no free-text column (names, e-mail, content, answers, comments, payloads)", async () => {
    const { rows } = await h.client.query(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name LIKE 'analytics\\_v1\\_%' ORDER BY 1, 2",
    );
    expect(rows.length).toBeGreaterThan(20);
    const forbidden = /(^|_)(content|structured|email|name_|first_name|last_name|comment|payload|answer|value|text|recipient|note)($|_)/;
    expect(rows.filter((r) => forbidden.test(r.column_name) && !["event_name"].includes(r.column_name)).map((r) => `${r.table_name}.${r.column_name}`)).toEqual([]);
    const reader = await h.client.query("SELECT has_table_privilege('beeside_analytics_reader', 'analytics_v1_events', 'SELECT') AS ok, has_table_privilege('beeside_analytics_reader', 'precision_turn', 'SELECT') AS raw, has_table_privilege('beeside_analytics_reader', 'person', 'SELECT') AS person");
    expect(reader.rows[0]).toEqual({ ok: true, raw: false, person: false }); // Tableau reaches the views, never the tables
  });
});
