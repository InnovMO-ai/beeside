import type { Db } from "../db/database";
import { auditStabilizationData } from "./stabilization-audit";

/** An in-memory stand-in for the three queries the audit makes (registry, catalog, counts). */
function fakeDb(registry: Array<[string, string]>, existing: string[], counts: Record<string, number>): Db {
  const db: Db = {
    async query(text: string) {
      if (/FROM privacy_erasure_registry/.test(text)) return { rows: registry.map(([table_name, data_class]) => ({ table_name, data_class })) as never, rowCount: registry.length };
      if (/information_schema\.tables/.test(text)) return { rows: existing.map((table_name) => ({ table_name })) as never, rowCount: existing.length };
      const m = /count\(\*\)::text AS n FROM "([^"]+)"/.exec(text);
      if (m) return { rows: [{ n: String(counts[m[1]!] ?? 0) }] as never, rowCount: 1 };
      throw new Error(`unexpected query ${text}`);
    },
    transaction: async (fn) => fn(db),
  };
  return db;
}

const REGISTRY: Array<[string, string]> = [["person", "identity"], ["precision_content_x", "precision_content"], ["subscription", "commercial"], ["country_resource", "global"], ["knowledge_passage", "global"], ["admin_user", "global"], ["admin_audit_event", "audit"]];
const TABLES = [...REGISTRY.map(([t]) => t), "__drizzle_migrations"];

describe("stabilization data audit (read-only gate before PRODUCCIÓN)", () => {
  it("is clean when only system data remains: governed config/knowledge and the operator side are kept, not counted as test data", async () => {
    const r = await auditStabilizationData(fakeDb(REGISTRY, TABLES, { country_resource: 3, knowledge_passage: 900, admin_user: 1, admin_audit_event: 12 }));
    expect(r.clean).toBe(true);
    expect(r.testData).toEqual([]);
    expect(r.keptGlobal).toEqual({ tables: 2, rows: 903 });
    expect(r.operatorSide.map((t) => t.table).sort()).toEqual(["admin_audit_event", "admin_user"]);
  });

  it("is NOT clean while any customer/project table holds rows, and names the tables (counts only, never content)", async () => {
    const r = await auditStabilizationData(fakeDb(REGISTRY, TABLES, { person: 2, subscription: 1, country_resource: 3 }));
    expect(r.clean).toBe(false);
    expect(r.testData).toEqual([{ table: "person", dataClass: "identity", rows: 2 }, { table: "subscription", dataClass: "commercial", rows: 1 }]);
    expect(JSON.stringify(r)).not.toMatch(/@|password|secret/i);
  });

  it("does not guess: an unclassified table, or a registry entry whose table is gone, is not clean", async () => {
    const extra = await auditStabilizationData(fakeDb(REGISTRY, [...TABLES, "brand_new_table"], {}));
    expect(extra.unregistered).toEqual(["brand_new_table"]);
    expect(extra.clean).toBe(false);
    const gone = await auditStabilizationData(fakeDb(REGISTRY, TABLES.filter((t) => t !== "subscription"), {}));
    expect(gone.missing).toEqual(["subscription"]);
    expect(gone.clean).toBe(false);
  });
});
