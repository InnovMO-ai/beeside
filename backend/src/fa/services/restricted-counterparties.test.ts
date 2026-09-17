import { Db } from "../../db/database";
import { getRestrictedCounterpartiesForAdmin } from "./restricted-counterparties";

function fakeDb(answerRows: unknown[]): { db: Db; calls: Array<{ text: string; values: unknown[] | undefined }> } {
  const calls: Array<{ text: string; values: unknown[] | undefined }> = [];
  const db: Db = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      if (text.startsWith("SELECT value FROM answer")) return { rows: answerRows as never[], rowCount: answerRows.length };
      return { rows: [], rowCount: 0 };
    },
    async transaction(fn) {
      return fn(db);
    },
  };
  return { db, calls };
}

const NOW = new Date("2026-09-17T00:00:00Z");

describe("getRestrictedCounterpartiesForAdmin", () => {
  it("returns the current value and records an admin_audit_event with the right action", async () => {
    const entries = [{ name: "Acme Corp", restrictionType: "cannot_contract" }];
    const { db, calls } = fakeDb([{ value: entries }]);

    const result = await getRestrictedCounterpartiesForAdmin(db, "project-1", { type: "ADMIN_USER", adminUserId: "admin-1" }, NOW);

    expect(result).toEqual(entries);
    const auditCall = calls.find((c) => c.text.includes("INSERT INTO admin_audit_event"));
    expect(auditCall).toBeDefined();
    expect(auditCall?.values).toEqual([NOW, "ADMIN_USER", "admin-1", "project.restricted_counterparties.viewed", "ALLOWED", "project", "project-1", "project-1", null, JSON.stringify({ count: 1 })]);
  });

  it("returns an empty list (and still records the audit event) when nothing was ever answered", async () => {
    const { db, calls } = fakeDb([]);

    const result = await getRestrictedCounterpartiesForAdmin(db, "project-2", { type: "SYSTEM" }, NOW);

    expect(result).toEqual([]);
    const auditCall = calls.find((c) => c.text.includes("INSERT INTO admin_audit_event"));
    expect(auditCall?.values?.[2]).toBeNull(); // actor_admin_user_id is null for a SYSTEM actor
  });
});
