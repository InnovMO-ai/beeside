import { checksumSql, orderTables, quote, upsertSql, type TablePlan } from "../db/domain-data-sync";

describe("domain data sync (pure parts)", () => {
  it("orders parents before children and ignores self references and tables outside the set", () => {
    const out = orderTables(["c", "b", "a", "z"], [{ child: "b", parent: "a" }, { child: "c", parent: "b" }, { child: "a", parent: "a" }, { child: "a", parent: "outside" }]);
    expect(out.indexOf("a")).toBeLessThan(out.indexOf("b"));
    expect(out.indexOf("b")).toBeLessThan(out.indexOf("c"));
    expect(out).toHaveLength(4);
  });
  it("is deterministic", () => {
    const fks = [{ child: "b", parent: "a" }];
    expect(orderTables(["b", "a", "d", "c"], fks)).toEqual(orderTables(["c", "d", "a", "b"], fks));
  });
  it("refuses a cycle", () => {
    expect(() => orderTables(["a", "b"], [{ child: "a", parent: "b" }, { child: "b", parent: "a" }])).toThrow(/cycle/);
  });
  const base: TablePlan = { table: "fa4_project", pk: ["project_id"], columns: ["project_id", "email", "updated_at"], policy: "append-only", sequences: [] };
  it("append-only tables never update", () => {
    const sql = upsertSql(base);
    expect(sql).toContain('ON CONFLICT ("project_id") DO NOTHING');
    expect(sql).not.toMatch(/DO UPDATE/);
    expect(sql).toContain("json_populate_recordset");
  });
  it("mutable tables update only when the source row is newer, never the primary key", () => {
    const sql = upsertSql({ ...base, policy: "upsert-by-updated_at" });
    expect(sql).toContain('DO UPDATE SET "email" = EXCLUDED."email", "updated_at" = EXCLUDED."updated_at"');
    expect(sql).toContain('WHERE public."fa4_project"."updated_at" < EXCLUDED."updated_at"');
    expect(sql).not.toContain('"project_id" = EXCLUDED');
  });
  it("mutable tables without updated_at are insert-only (a divergence is reported, not resolved)", () => {
    expect(upsertSql({ ...base, columns: ["project_id", "email"], policy: "insert-only-report" })).toContain("DO NOTHING");
  });
  it("checksums are order independent (ordered by the primary key) and cover exactly the given columns", () => {
    const sql = checksumSql("t", ["id", "v"], ["id"]);
    expect(sql).toContain("ORDER BY t.\"id\"");
    expect(sql).toContain("'v', t.\"v\"");
  });
  it("quotes identifiers", () => { expect(quote('a"b')).toBe('"a""b"'); });
});
