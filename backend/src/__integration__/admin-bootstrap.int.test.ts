import type { Pool } from "pg";
import { bootstrapFirstAdmin, domainAllowed } from "../scripts/admin-bootstrap";
import { describeWithDb, useHarness } from "./fa-harness";

/** A Pool whose transactions are savepoints of the harness client, so everything is rolled back at the end of each test. */
function savepointPool(client: { query: (t: string, v?: unknown[]) => Promise<unknown> }): Pool {
  let n = 0;
  const map = (text: string, stack: string[]): string => {
    if (text === "BEGIN") { const name = `bs_${++n}`; stack.push(name); return `SAVEPOINT ${name}`; }
    if (text === "COMMIT") return `RELEASE SAVEPOINT ${stack.pop()}`;
    if (text === "ROLLBACK") { const name = stack.pop(); return `ROLLBACK TO SAVEPOINT ${name}`; }
    return text;
  };
  const stack: string[] = [];
  const wrapped = { query: (text: string, values?: unknown[]) => client.query(map(text, stack), values), release: () => undefined };
  return { connect: async () => wrapped, query: wrapped.query } as unknown as Pool;
}

describe("first SUPER_ADMIN bootstrap: domain check", () => {
  it("accepts only an email on an allowed domain", () => {
    expect(domainAllowed("mike@beeside.you", "beeside.you")).toBe(true);
    expect(domainAllowed("Mike@Beeside.You", "beeside.you, other.test")).toBe(true);
    expect(domainAllowed("mike@evil.test", "beeside.you")).toBe(false);
    expect(domainAllowed("mike@beeside.you.evil.test", "beeside.you")).toBe(false);
    expect(domainAllowed("mike", "beeside.you")).toBe(false);
    expect(domainAllowed("mike@beeside.you", "")).toBe(false);
  });
});

describeWithDb("first SUPER_ADMIN bootstrap (PostgreSQL, rolled back)", () => {
  const h = useHarness();
  const now = new Date();

  it("creates one SUPER_ADMIN with an audit record, creates no credential, and refuses a second one", async () => {
    await h.client.query("UPDATE admin_user SET active = false WHERE role = 'SUPER_ADMIN'"); // an environment with no active SUPER_ADMIN yet (rolled back)
    const pool = savepointPool(h.client);
    const id = await bootstrapFirstAdmin(pool, "First.Admin@beeside.you", "beeside.you", now);
    const row = await h.client.query("SELECT role, auth_identity, active, login_enabled, auth_subject FROM admin_user WHERE admin_user_id = $1", [id]);
    expect(row.rows[0]).toMatchObject({ role: "SUPER_ADMIN", auth_identity: "first.admin@beeside.you", active: true, login_enabled: true, auth_subject: null });
    const audit = await h.client.query("SELECT outcome FROM admin_audit_event WHERE action = 'admin_user.bootstrapped' AND target_id = $1", [id]);
    expect(audit.rows).toHaveLength(1);
    await expect(bootstrapFirstAdmin(pool, "second@beeside.you", "beeside.you", now)).rejects.toThrow(/already exists/);
  });

  it("refuses an email outside the allowed domains before touching the database", async () => {
    const pool = savepointPool(h.client);
    await expect(bootstrapFirstAdmin(pool, "intruder@evil.test", "beeside.you", now)).rejects.toThrow(/allowed domain/);
    const count = await h.client.query("SELECT count(*)::int AS n FROM admin_user WHERE auth_identity = 'intruder@evil.test'");
    expect(count.rows[0].n).toBe(0);
  });
});
