/**
 * THE ENTITLEMENT-GATED CONTINUITY BRIDGE — acceptance A–D (+ convergence, identity, concurrency).
 *
 * Frozen rule: Discovery completion is NOT the trigger. Precision exists for a project only when the SAME project_id obtains a valid entitlement,
 * from ANY governed source; the entitlement boundary promotes the project into Core (same UUID) in the same transaction. Stripe is just one
 * producer: here the producer is a simulated/manual governed grant, and the paid-type source goes through the very same promotion function.
 *
 * Run: TEST_DATABASE_URL=... npm run test:integration -- continuity-bridge
 */
import { randomUUID } from "node:crypto";
import { Fa4DiscoveryContextReader, SUPPORTED_CONTRACT } from "../../adapters/fa4-discovery-context-reader";
import { CoreEntitlementProvider } from "../../adapters/core-entitlement";
import { createLinkToken } from "../../domain/tokens";
import { ensureCoreProjectFromDiscovery } from "../../../continuity/discovery-promotion";
import { terminateGrant } from "../../../premium/entitlement-grants";
import { premiumPolicyFromEnv } from "../../../premium/premium-policy";
import { deliverDiscovery, portugueseEnergyAnswers } from "../../../__tests__/helpers/discovery-real";
import { activateSimulatedEntitlement, testApprover } from "../../../__tests__/helpers/simulated-entitlement";
import { setupHarness, TEST_DATABASE_URL, type Harness } from "./harness";

const d = TEST_DATABASE_URL ? describe : describe.skip;
const DAY = 86_400_000;

d("Discovery -> Core continuity, gated by a valid entitlement", () => {
  let h: Harness;
  let clock = (): Date => new Date();
  beforeAll(async () => { h = await setupHarness({ engine: "core", faReader: (db) => new Fa4DiscoveryContextReader(db), coreEntitlement: { now: () => clock() } }); });
  afterAll(async () => { await h.close(); });
  beforeEach(() => { clock = () => new Date(); });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = (sql: string, params: unknown[] = []) => h.db.query<any>(sql, params);
  const count = async (sql: string, params: unknown[]): Promise<number> => Number((await h.db.query<{ n: string }>(sql, params)).rows[0]!.n);
  const coreProject = (id: string) => count("SELECT count(*) AS n FROM project WHERE project_id = $1", [id]);
  const provider = () => new CoreEntitlementProvider(h.db, { policy: premiumPolicyFromEnv(), now: () => clock() });

  // ------------------------------------------------------------------------------------------------------------------ A
  it("A. Discovery completed, NO entitlement: the result exists, nothing is promoted, Precision is closed", async () => {
    const { projectId, resultId } = await deliverDiscovery(h.db, portugueseEnergyAnswers());

    expect(await count("SELECT count(*) AS n FROM fa4_result WHERE result_id = $1 AND project_id = $2 AND NOT legacy_unsealed", [resultId, projectId])).toBe(1);
    // the canonical context is readable (the result is real and sealed) ...
    expect((await new Fa4DiscoveryContextReader(h.db).read(projectId))?.sourceResultId).toBe(resultId);
    // ... but Core knows nothing of the project: no project, no origin, no person/company created for it, no entitlement
    expect(await coreProject(projectId)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM project_origin WHERE project_id = $1", [projectId])).toBe(0);
    expect(await count("SELECT count(*) AS n FROM entitlement WHERE project_id = $1", [projectId])).toBe(0);
    expect(await count("SELECT count(*) AS n FROM outbox_event WHERE project_id = $1", [projectId])).toBe(0);
    // Precision access: the entitlement answer is REVOKED, no link or session can be created, no pin, no instance
    expect(await provider().get(projectId)).toMatchObject({ premiumActive: false, accessMode: "REVOKED" });
    await expect(createLinkToken(h.db, projectId, undefined, new Date())).rejects.toThrow();
    expect(await count("SELECT count(*) AS n FROM context_pin WHERE project_id = $1", [projectId])).toBe(0);
    // the continuation REQUEST is not the trigger either: even a request recorded for this project promotes nothing (it is a Discovery-side intent)
    await q("INSERT INTO fa4_continuation_request (project_id, result_id) VALUES ($1, $2)", [projectId, resultId]);
    expect(await coreProject(projectId)).toBe(0);
    expect(await provider().get(projectId)).toMatchObject({ accessMode: "REVOKED" });
  });

  // ------------------------------------------------------------------------------------------------------------------ B
  it("B. completed + valid entitlement: the SAME project_id is promoted, Precision opens, the pinned Discovery result is consumed", async () => {
    const tag = randomUUID().slice(0, 8);
    const answers = portugueseEnergyAnswers(`ines@lusa-${tag}.example`);
    const unique = `Empresa Portuguesa ${tag}`; // the database is shared across runs: a repeated name or corporate domain would (correctly) be a probable match
    answers.identity.company = unique;
    const { projectId, resultId } = await deliverDiscovery(h.db, answers);
    const r = await activateSimulatedEntitlement(h.db, projectId);
    expect(r.created).toBe(true);

    // same UUID, a locked (completed) first assessment, governed Persona/Company linkage
    const p = (await q("SELECT * FROM project WHERE project_id = $1", [projectId])).rows[0];
    expect(p).toMatchObject({ project_id: projectId, assessment_state: "COMPLETED_LOCKED", question_bank_version: "fa4-public-v1", rules_engine_version: "fa4-public-v1", snapshot_template_version: "fa4-public-v1" });
    expect(p.created_by_person_id).toBe(p.responsible_person_id);
    const person = (await q("SELECT primary_email, first_name, interface_language FROM person WHERE person_id = $1", [p.created_by_person_id])).rows[0];
    expect(person).toMatchObject({ primary_email: portugueseEmail(await emailOf(projectId)), interface_language: "es" });
    const company = (await q("SELECT name, status, normalized_name FROM company WHERE company_id = $1", [p.company_id])).rows[0];
    expect(company).toMatchObject({ name: unique, status: "ACTIVE", normalized_name: unique.toLowerCase() });
    expect((await q("SELECT status, role FROM company_person WHERE company_id = $1 AND person_id = $2", [p.company_id, p.created_by_person_id])).rows).toEqual([{ status: "ACTIVE", role: "OWNER" }]);

    // the exact sealed Discovery result and contract version are retained (and nothing of Discovery's content is copied)
    const origin = (await q("SELECT * FROM project_origin WHERE project_id = $1", [projectId])).rows[0];
    expect(origin).toMatchObject({ origin: "DISCOVERY_FA4", discovery_result_id: resultId, contract_version: SUPPORTED_CONTRACT, promoted_by_source: "manual", identity_evidence: "new_person" });

    // a valid entitlement, from the governed ledger, and an outbox event for the asynchronous consumers
    expect(await provider().get(projectId)).toMatchObject({ premiumActive: true, accessMode: "FULL" });
    expect((await q("SELECT precision_access_mode, premium_access_active FROM entitlement WHERE project_id = $1", [projectId])).rows[0]).toEqual({ precision_access_mode: "FULL", premium_access_active: true });
    const ob = (await q("SELECT payload FROM outbox_event WHERE project_id = $1 AND event_type = 'project.promoted_from_discovery'", [projectId])).rows;
    expect(ob).toHaveLength(1);
    expect(ob[0].payload).toMatchObject({ project_id: projectId, result_id: resultId, source: "manual" });
    expect(JSON.stringify(ob[0].payload)).not.toMatch(/@|Inês|Empresa|Portuguesa/); // no e-mail, no name, no content travels in the event

    // Precision now opens for that same project_id and consumes the PINNED Discovery result through the canonical contract
    const api = h.api(await h.session(projectId), "es");
    expect((await api.get("/understanding")).status).toBe(200);
    const pins = (await q("SELECT source_project_id, source_result_id, contract_version, status FROM context_pin WHERE project_id = $1", [projectId])).rows;
    expect(pins).toEqual([{ source_project_id: projectId, source_result_id: origin.discovery_result_id, contract_version: SUPPORTED_CONTRACT, status: "current" }]);
  });

  // ------------------------------------------------------------------------------------------------------------------ C
  it("C. duplicate / replayed / concurrent entitlement events: no second project, no second grant, no second Precision activation", async () => {
    const { projectId } = await deliverDiscovery(h.db, portugueseEnergyAnswers());
    const approvedBy = await testApprover(h.db);
    const key = `replay:${randomUUID()}`;
    const first = await activateSimulatedEntitlement(h.db, projectId, { approvedBy, key });
    const replay = await activateSimulatedEntitlement(h.db, projectId, { approvedBy, key });
    expect([first.created, replay.created]).toEqual([true, false]);
    expect(replay.grant.grant_id).toBe(first.grant.grant_id);

    // the same event, delivered 6 times AT THE SAME TIME (a webhook retried by two workers), on a fresh project
    const other = await deliverDiscovery(h.db, portugueseEnergyAnswers());
    const k2 = `race:${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 6 }, () => activateSimulatedEntitlement(h.db, other.projectId, { approvedBy, key: k2 })));
    expect(results.filter((x) => x.created)).toHaveLength(1);
    expect(new Set(results.map((x) => x.grant.grant_id)).size).toBe(1);

    for (const id of [projectId, other.projectId]) {
      expect(await coreProject(id)).toBe(1);
      expect(await count("SELECT count(*) AS n FROM project_origin WHERE project_id = $1", [id])).toBe(1);
      expect(await count("SELECT count(*) AS n FROM entitlement_grant WHERE project_id = $1", [id])).toBe(1);
      expect(await count("SELECT count(*) AS n FROM entitlement WHERE project_id = $1", [id])).toBe(1);
      expect(await count("SELECT count(*) AS n FROM outbox_event WHERE project_id = $1 AND event_type = 'project.promoted_from_discovery'", [id])).toBe(1);
      expect(await count("SELECT count(*) AS n FROM company_person cp JOIN project p ON p.company_id = cp.company_id WHERE p.project_id = $1", [id])).toBe(1);
    }
    // Precision is activated exactly once even when it is opened repeatedly
    const api = h.api(await h.session(projectId), "es");
    for (let i = 0; i < 3; i += 1) expect((await api.get("/understanding")).status).toBe(200);
    expect(await count("SELECT count(*) AS n FROM context_pin WHERE project_id = $1", [projectId])).toBe(1);
    expect(await count("SELECT count(*) AS n FROM precision_instance WHERE project_id = $1 AND scope = 'project'", [projectId])).toBe(1);

    // a second, DIFFERENT grant (an extension granted later) is a legitimate new entitlement on the same project: still one project
    const extra = await activateSimulatedEntitlement(h.db, projectId, { approvedBy });
    expect(extra.created).toBe(false);
    expect(await coreProject(projectId)).toBe(1);
    // an idempotency key can never hand back another project's grant
    await expect(activateSimulatedEntitlement(h.db, other.projectId, { approvedBy, key })).rejects.toThrow(/idempotency key/);
  });

  // ------------------------------------------------------------------------------------------------------------------ D
  it("D. entitlement revoked / expired: the frozen read-only -> revoked behaviour applies and the project identity is never deleted or recreated", async () => {
    const { projectId, resultId } = await deliverDiscovery(h.db, portugueseEnergyAnswers());
    const approvedBy = await testApprover(h.db);
    const r = await activateSimulatedEntitlement(h.db, projectId, { approvedBy, days: 30 });
    const api = h.api(await h.session(projectId), "es");
    expect((await api.get("/understanding")).status).toBe(200);
    expect((await api.post("/understanding/turns", { turnKey: `t-${randomUUID()}`, text: "Quiero constituir una entidad en México" })).status).toBe(200);
    const before = (await q("SELECT created_at, company_id, created_by_person_id FROM project WHERE project_id = $1", [projectId])).rows[0];

    // revoked early by an operator -> READ_ONLY: everything stays readable, every write is refused with the frozen answer
    await terminateGrant(h.db, { grantId: r.grant.grant_id, terminatedBy: approvedBy, reason: "acceptance: revoked", now: new Date() });
    expect(await provider().get(projectId)).toMatchObject({ premiumActive: false, accessMode: "READ_ONLY" });
    expect((await api.get("/understanding")).status).toBe(200);
    const ro = await api.post("/understanding/turns", { turnKey: `t-${randomUUID()}`, text: "otra cosa que necesitamos" });
    expect([ro.status, ro.body.error]).toEqual([403, "PRECISION_READ_ONLY"]);

    // the read-only window closes -> REVOKED (the clock decides; nothing is deleted)
    clock = () => new Date(Date.now() + 3650 * DAY);
    expect(await provider().get(projectId)).toMatchObject({ premiumActive: false, accessMode: "REVOKED" });
    const gone = await api.get("/understanding");
    expect([gone.status, gone.body.error]).toEqual([403, "PRECISION_REVOKED"]);

    // identity retained: same project row, same origin and pin, same person/company, no delete
    const after = (await q("SELECT created_at, company_id, created_by_person_id FROM project WHERE project_id = $1", [projectId])).rows[0];
    expect(after).toEqual(before);
    expect((await q("SELECT discovery_result_id FROM project_origin WHERE project_id = $1", [projectId])).rows[0].discovery_result_id).toBe(resultId);
    expect(await count("SELECT count(*) AS n FROM context_pin WHERE project_id = $1", [projectId])).toBe(1);

    // a later valid entitlement REOPENS the same project (no delete/recreate): created=false, FULL again, Precision reads continue
    clock = () => new Date();
    const again = await activateSimulatedEntitlement(h.db, projectId, { approvedBy });
    expect(again.created).toBe(false);
    expect(await coreProject(projectId)).toBe(1);
    expect(await provider().get(projectId)).toMatchObject({ premiumActive: true, accessMode: "FULL" });
    expect((await api.get("/understanding")).status).toBe(200);

    // expiry by date (no operator action): a short entitlement simply runs out
    const short = await deliverDiscovery(h.db, portugueseEnergyAnswers());
    await activateSimulatedEntitlement(h.db, short.projectId, { approvedBy, days: 10 });
    expect(await provider().get(short.projectId)).toMatchObject({ accessMode: "FULL" });
    clock = () => new Date(Date.now() + 11 * DAY);
    expect(await provider().get(short.projectId)).toMatchObject({ premiumActive: false, accessMode: "READ_ONLY" });
  });

  // ------------------------------------------------------------------------------------------------------------------ one boundary
  it("every source converges on the SAME boundary: complimentary, partner, trial, manual and a paid-type event produce the same downstream behaviour", async () => {
    const approvedBy = await testApprover(h.db);
    const shape = async (projectId: string) => ({
      project: (await q("SELECT assessment_state FROM project WHERE project_id = $1", [projectId])).rows[0],
      origin: Object.keys((await q("SELECT * FROM project_origin WHERE project_id = $1", [projectId])).rows[0]).sort(),
      access: await provider().get(projectId).then((s) => ({ premiumActive: s.premiumActive, accessMode: s.accessMode })),
      outbox: await count("SELECT count(*) AS n FROM outbox_event WHERE project_id = $1 AND event_type = 'project.promoted_from_discovery'", [projectId]),
    });
    const out: unknown[] = [];
    for (const source of ["complimentary", "partner", "trial", "manual"] as const) {
      const x = await deliverDiscovery(h.db, portugueseEnergyAnswers());
      await activateSimulatedEntitlement(h.db, x.projectId, { approvedBy, source });
      out.push(await shape(x.projectId));
    }
    // the paid producer (a verified payment, whatever provider): it calls the SAME promotion inside its own transaction, then the lifecycle event
    const paid = await deliverDiscovery(h.db, portugueseEnergyAnswers());
    await h.db.transaction(async (tx) => {
      await ensureCoreProjectFromDiscovery(tx, { projectId: paid.projectId, source: "paid:simulated-provider", now: new Date(), verifiedBy: "payment" });
      const { processSubscriptionEvent } = await import("../../../premium/subscription-events");
      await processSubscriptionEvent(tx, await bundlesOf(h), {
        projectId: paid.projectId, eventType: "premium_activated", occurredAt: new Date(), source: "simulated-provider", providerReference: "sim_1",
        idempotencyKey: `paid:${paid.projectId}`, periodEnd: new Date(Date.now() + 365 * DAY),
      });
    });
    out.push(await shape(paid.projectId));
    for (const s of out) expect(s).toEqual(out[0]);
    expect((await q("SELECT promoted_by_source FROM project_origin WHERE project_id = $1", [paid.projectId])).rows[0].promoted_by_source).toBe("paid:simulated-provider");
  });

  // ------------------------------------------------------------------------------------------------------------------ identity rules
  it("identity: never attaches an unverified requester to an existing person; a verified one is reused; probable company matches never merge", async () => {
    const approvedBy = await testApprover(h.db);
    const tag = randomUUID().slice(0, 8);
    const mk = async (email: string, company: string) => {
      const a = portugueseEnergyAnswers(email); a.identity.company = company;
      return deliverDiscovery(h.db, a);
    };
    // first project of ana@acme: a new person and company
    const p1 = await mk(`ana.${tag}@acme-${tag}.example`, `Acme ${tag} S.A. de C.V.`);
    await activateSimulatedEntitlement(h.db, p1.projectId, { approvedBy });
    const c1 = (await q("SELECT company_id, created_by_person_id AS person FROM project WHERE project_id = $1", [p1.projectId])).rows[0];

    // a second Discovery project with the SAME e-mail but no proof the requester controls the mailbox: fails closed, nothing is written
    const p2 = await mk(`ana.${tag}@acme-${tag}.example`, `Acme ${tag}`);
    const before = await count("SELECT count(*) AS n FROM person", []);
    await expect(activateSimulatedEntitlement(h.db, p2.projectId, { approvedBy })).rejects.toMatchObject({ details: { reason: "PERSON_UNVERIFIED" } });
    expect(await coreProject(p2.projectId)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM person", [])).toBe(before);
    expect(await count("SELECT count(*) AS n FROM entitlement_grant WHERE project_id = $1", [p2.projectId])).toBe(0);

    // with the operator's explicit confirmation (or a verified payment / an opened e-mail link) the person is reused, and the STRONG match reuses the company
    await activateSimulatedEntitlement(h.db, p2.projectId, { approvedBy, verifiedBy: "operator" });
    const c2 = (await q("SELECT company_id, created_by_person_id AS person FROM project WHERE project_id = $1", [p2.projectId])).rows[0];
    expect(c2).toEqual(c1);
    expect((await q("SELECT identity_evidence FROM project_origin WHERE project_id = $1", [p2.projectId])).rows[0].identity_evidence).toBe("operator");

    // a DIFFERENT person at the same corporate domain and the same company name is only a PROBABLE match: a provisional company + a review, never a merge
    const p3 = await mk(`bruno.${tag}@acme-${tag}.example`, `ACME ${tag}`);
    await activateSimulatedEntitlement(h.db, p3.projectId, { approvedBy });
    const c3 = (await q("SELECT p.company_id, c.status FROM project p JOIN company c ON c.company_id = p.company_id WHERE p.project_id = $1", [p3.projectId])).rows[0];
    expect(c3.company_id).not.toBe(c1.company_id);
    expect(c3.status).toBe("PROVISIONAL");
    expect((await q("SELECT candidate_company_id, signal, status FROM company_match_review WHERE company_id = $1", [c3.company_id])).rows).toEqual([{ candidate_company_id: c1.company_id, signal: "NAME_AND_DOMAIN", status: "OPEN" }]);
    expect((await q("SELECT status FROM company WHERE company_id = $1", [c1.company_id])).rows[0].status).toBe("ACTIVE");
    // the entitlement was never blocked by the resolution
    expect(await provider().get(p3.projectId)).toMatchObject({ accessMode: "FULL" });
  });

  it("safety: refuses an undelivered project, a project id already taken by something else, and a promotion outside the entitlement transaction's rules", async () => {
    const approvedBy = await testApprover(h.db);
    // not delivered
    const draft = (await h.db.query<{ project_id: string }>("INSERT INTO fa4_project (email, locale, step_key, answers) VALUES ($1, 'es', 'identity', '{}'::jsonb) RETURNING project_id", [`d.${randomUUID()}@x.example`])).rows[0]!.project_id;
    await expect(activateSimulatedEntitlement(h.db, draft, { approvedBy })).rejects.toMatchObject({ details: { reason: "NOT_DELIVERED" } });
    expect(await coreProject(draft)).toBe(0);
    // unknown id
    await expect(activateSimulatedEntitlement(h.db, randomUUID(), { approvedBy })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // an id that already exists in Core with a different origin is a hard error and is never overwritten
    const taken = await deliverDiscovery(h.db, portugueseEnergyAnswers());
    await h.newProject({ projectId: taken.projectId, context: null });
    await expect(activateSimulatedEntitlement(h.db, taken.projectId, { approvedBy })).rejects.toMatchObject({ details: { reason: "PROJECT_ID_CONFLICT" } });
    expect(await count("SELECT count(*) AS n FROM project_origin WHERE project_id = $1", [taken.projectId])).toBe(0);
    // the origin record is append-only, and only valid against its own delivered project and sealed result
    const ok = await deliverDiscovery(h.db, portugueseEnergyAnswers());
    await activateSimulatedEntitlement(h.db, ok.projectId, { approvedBy });
    await expect(q("UPDATE project_origin SET promoted_by_source = 'x' WHERE project_id = $1", [ok.projectId])).rejects.toThrow();
    await expect(q("DELETE FROM project_origin WHERE project_id = $1", [ok.projectId])).rejects.toThrow();
    await expect(q(
      "INSERT INTO project_origin (project_id, origin, discovery_result_id, contract_version, promoted_by_source, identity_evidence) VALUES ($1, 'DISCOVERY_FA4', $2, 'x', 'x', 'operator')",
      [taken.projectId, ok.resultId])).rejects.toThrow();
  });
});

async function emailOf(projectId: string): Promise<string> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try { return (await pool.query<{ email: string }>("SELECT email FROM fa4_project WHERE project_id = $1", [projectId])).rows[0]!.email; } finally { await pool.end(); }
}
function portugueseEmail(e: string): string { return e.trim().toLowerCase(); }
async function bundlesOf(h: Harness): Promise<import("../../../fa/services/bundle-store").BundleStore> {
  const { BundleStore } = await import("../../../fa/services/bundle-store");
  return new BundleStore(h.db);
}
