import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createPoolDb } from "../db/database";
import { deliverDiscovery, portugueseEnergyAnswers } from "../__tests__/helpers/discovery-real";
import { activateSimulatedEntitlement, testApprover } from "../__tests__/helpers/simulated-entitlement";

/**
 * The promotion bridge under the ACTUAL least-privilege runtime role (member of beeside_runtime_role: SELECT/INSERT/UPDATE, no DELETE, no DDL).
 * Discovery delivers and the approver is created with the owner connection (as in production, where Discovery and the operator console write
 * through their own paths); the PROMOTION and the entitlement run as the application's runtime login.
 *   TEST_RUNTIME_ADMIN_DATABASE_URL  owner / migration role
 *   TEST_RUNTIME_DATABASE_URL        LOGIN role, member of beeside_runtime_role
 */
const adminUrl = process.env.TEST_RUNTIME_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL;
const describeRt = adminUrl && runtimeUrl ? describe : describe.skip;

describeRt("Discovery -> Core promotion under the runtime role", () => {
  const admin = new Pool({ connectionString: adminUrl });
  const rt = new Pool({ connectionString: runtimeUrl, max: 8 });
  const adminDb = createPoolDb(admin);
  const rtDb = createPoolDb(rt);
  afterAll(async () => { await admin.end(); await rt.end(); });

  it("promotes with the SAME id, is idempotent and safe under concurrency, and cannot rewrite or delete its origin record", async () => {
    const tag = randomUUID().slice(0, 8);
    const a = portugueseEnergyAnswers(`rt.${tag}@rt-${tag}.example`);
    a.identity.company = `Runtime Role ${tag}`;
    const { projectId, resultId } = await deliverDiscovery(adminDb, a);
    const approvedBy = await testApprover(adminDb);
    const key = `rt:${tag}`;
    const results = await Promise.all(Array.from({ length: 5 }, () => activateSimulatedEntitlement(rtDb, projectId, { approvedBy, key })));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const q = async (sql: string) => (await admin.query(sql, [projectId])).rows;
    expect(await q("SELECT project_id, assessment_state FROM project WHERE project_id = $1")).toEqual([{ project_id: projectId, assessment_state: "COMPLETED_LOCKED" }]);
    expect((await q("SELECT discovery_result_id, identity_evidence FROM project_origin WHERE project_id = $1"))[0]).toEqual({ discovery_result_id: resultId, identity_evidence: "new_person" });
    expect(await q("SELECT precision_access_mode FROM entitlement WHERE project_id = $1")).toEqual([{ precision_access_mode: "FULL" }]);
    expect(await q("SELECT 1 FROM outbox_event WHERE project_id = $1 AND event_type = 'project.promoted_from_discovery'")).toHaveLength(1);
    await expect(rt.query("DELETE FROM project_origin WHERE project_id = $1", [projectId])).rejects.toThrow();
    await expect(rt.query("UPDATE project_origin SET promoted_by_source = 'x' WHERE project_id = $1", [projectId])).rejects.toThrow();
    await expect(rt.query("DELETE FROM company_person WHERE company_id IN (SELECT company_id FROM project WHERE project_id = $1)", [projectId])).rejects.toThrow();
  });
});
