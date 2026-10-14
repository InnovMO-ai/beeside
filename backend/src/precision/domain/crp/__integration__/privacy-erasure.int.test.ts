import { randomUUID } from "node:crypto";
import request from "supertest";
import { tablesWithResidue } from "../../../../__tests__/helpers/privacy-canary";
import { recordPrivacyEvent } from "../../../../premium/entitlement-grants";
import { approvePolicy, executeErasure, planErasure } from "../../../../privacy/erasure";
import { createHarness, describeWithDb, type Harness } from "./harness";

const auth = (projectId: string): Record<string, string> => ({ "x-test-project": projectId });
const count = async (h: Harness, sql: string, args: unknown[]): Promise<number> => Number((await h.db.query<{ n: string }>(sql, args)).rows[0]!.n);

describeWithDb("Privacy erasure — Precision side (PostgreSQL, committed rows, simulated Operation Hub)", () => {
  let h: Harness;
  let sup: string;
  beforeAll(async () => {
    h = await createHarness();
    sup = (await h.db.query<{ id: string }>("INSERT INTO admin_user (role, auth_identity) VALUES ('SUPER_ADMIN', $1) RETURNING admin_user_id AS id", [`priv-prec-${randomUUID()}@beeside.internal`])).rows[0]!.id;
  });
  afterAll(async () => {
    await h.db.query("UPDATE privacy_policy SET status = 'retired', retired_at = now() WHERE status = 'approved'"); // leave no approved policy behind for other suites
    await h.close();
  });

  it("a Premium project that worked in Precision (conversation, facts, map, confirmed + sent CRP) is erased completely; another project is untouched", async () => {
    const other = await h.newProject({ strategicReady: true });
    const p = await h.newProject({ strategicReady: true });
    const id = p.id("logistics");
    const canary = `canario${randomUUID().replace(/-/g, "").slice(0, 10)}`;

    // work that leaves every kind of Precision row: CRP confirmed, previewed and sent (pack, confirmation, OH delivery)
    expect((await request(h.app).post(`/api/precision/categories/${id}/crp/confirm`).set(auth(p.projectId)).send({})).status).toBe(200);
    const pv = await request(h.app).get(`/api/precision/categories/${id}/preview`).set(auth(p.projectId));
    expect(pv.status).toBe(200);
    expect((await request(h.app).post(`/api/precision/categories/${id}/send`).set(auth(p.projectId)).send({ previewChecksum: pv.body.previewChecksum })).status).toBe(200);
    // client text in a conversation turn and in a fact
    await h.db.query(
      `INSERT INTO precision_turn (project_id, scope_instance_id, turn_key, role, surface, kind, locale, content) VALUES ($1, $2, $3, 'client', 'category', 'message', 'en', $4)`,
      [p.projectId, id, `canary-turn-${canary}`.slice(0, 60).padEnd(12, "x"), `we ship ${canary} pallets`],
    );
    await h.db.query(
      `INSERT INTO fact (project_id, scope_instance_id, field_key, value, value_type, answer_state, source, provenance_stage)
       SELECT project_id, scope_instance_id, field_key || '_canary', to_jsonb($2::text), value_type, answer_state, source, provenance_stage FROM fact WHERE project_id = $1 AND scope_instance_id = $3 LIMIT 1`,
      [p.projectId, `note ${canary}`, id],
    );
    const tables = ["precision_instance", "category_assessment", "pack", "crp_confirmation", "oh_delivery", "fact", "precision_turn", "context_pin", "service_map_snapshot", "precision_assessment"];
    const rowsOf = async (project: string): Promise<Record<string, number>> => {
      const out: Record<string, number> = {};
      for (const t of tables) {
        const where =
          t === "pack" ? "category_assessment_instance_id IN (SELECT instance_id FROM category_assessment WHERE project_id = $1)"
          : t === "service_map_snapshot" ? "precision_instance_id IN (SELECT id FROM precision_instance WHERE project_id = $1)"
          : t === "precision_assessment" ? "instance_id IN (SELECT id FROM precision_instance WHERE project_id = $1)"
          : "project_id = $1";
        out[t] = await count(h, `SELECT count(*) AS n FROM ${t} WHERE ${where}`, [project]);
      }
      return out;
    };
    const before = await rowsOf(p.projectId);
    for (const t of ["precision_instance", "category_assessment", "pack", "crp_confirmation", "oh_delivery", "fact", "precision_turn"]) expect(before[t]).toBeGreaterThan(0);
    const otherBefore = await rowsOf(other.projectId);
    expect(await tablesWithResidue(h.db, [canary])).toEqual(expect.arrayContaining(["fact", "precision_turn"]));

    await approvePolicy(h.db, { minDaysAfterBlock: 0, retainLegalAcceptance: false, approvedBy: sup, now: new Date() });
    await recordPrivacyEvent(h.db, { projectId: p.projectId, event: "access_blocked", reasonCode: "erasure_request", actor: `admin:${sup}` });
    const when = new Date(Date.now() + 60_000);
    const plan = await planErasure(h.db, p.projectId, `admin:${sup}`, when);
    expect(plan.eligible).toBe(true);
    expect(plan.would_delete).toMatchObject(before);
    expect(plan.external_followups).toEqual({ external_references: expect.any(Number) });

    const out = await executeErasure(h.db, p.projectId, `admin:${sup}`, when);
    expect(out).toMatchObject({ eligible: true, executed: true });
    expect(await rowsOf(p.projectId)).toEqual(Object.fromEntries(tables.map((t) => [t, 0])));
    expect(await tablesWithResidue(h.db, [canary])).toEqual([]);
    expect(await rowsOf(other.projectId)).toEqual(otherBefore); // the rest of the platform is untouched
    expect((await h.db.query<{ state: string }>("SELECT state FROM project_privacy_state WHERE project_id = $1", [p.projectId])).rows[0]!.state).toBe("anonymized");
    // analytics survive (anonymous, closed contract) and the outbound notice asks destinations to erase their copy
    expect(await count(h, "SELECT count(*) AS n FROM precision_journey_event WHERE project_id = $1", [p.projectId])).toBeGreaterThan(0);
    // idempotent
    expect(await executeErasure(h.db, p.projectId, `admin:${sup}`, when)).toMatchObject({ eligible: false, reason: "already_erased" });
  }, 120_000);
});
