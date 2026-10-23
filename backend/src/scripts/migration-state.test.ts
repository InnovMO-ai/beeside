import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { inspectMigrationState } from "./migration-state";

function folder(entries: Array<{ tag: string; when: number; sql: string }>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mig-"));
  mkdirSync(path.join(dir, "meta"));
  writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify({ entries: entries.map((e, i) => ({ idx: i, tag: e.tag, when: e.when })) }));
  for (const e of entries) writeFileSync(path.join(dir, `${e.tag}.sql`), e.sql);
  return dir;
}
const hash = (s: string): string => createHash("sha256").update(s).digest("hex");
const dbWith = (rows: Array<{ hash: string; created_at: number }> | null) => ({
  async query(sql: string) {
    if (sql.includes("to_regclass")) return { rows: [{ ok: rows !== null }] };
    return { rows: rows ?? [] };
  },
}) as never;

describe("migration state preflight", () => {
  const ent = [{ tag: "0000_a", when: 100, sql: "A" }, { tag: "0001_b", when: 200, sql: "B" }, { tag: "0002_c", when: 300, sql: "C" }];
  const dir = folder(ent);

  it("a database with nothing applied, or a prefix of this build applied identically, is safe and lists what is pending", async () => {
    expect(await inspectMigrationState(dbWith(null), dir)).toMatchObject({ safe: true, applied: 0, pending: ["0000_a", "0001_b", "0002_c"] });
    expect(await inspectMigrationState(dbWith([{ hash: hash("A"), created_at: 100 }, { hash: hash("B"), created_at: 200 }]), dir)).toMatchObject({ safe: true, applied: 2, pending: ["0002_c"] });
    expect(await inspectMigrationState(dbWith(ent.map((e) => ({ hash: hash(e.sql), created_at: e.when }))), dir)).toMatchObject({ safe: true, pending: [] });
  });

  it("refuses a database that applied another numbering: unknown hash, different timestamp, or a pending migration older than the last applied", async () => {
    const foreign = await inspectMigrationState(dbWith([{ hash: hash("A"), created_at: 100 }, { hash: hash("X"), created_at: 250 }]), dir);
    expect(foreign.safe).toBe(false);
    expect(foreign.problems.join(" ")).toMatch(/not part of this build/);
    const skewed = await inspectMigrationState(dbWith([{ hash: hash("A"), created_at: 100 }, { hash: hash("C"), created_at: 999 }]), dir);
    expect(skewed.safe).toBe(false);
    expect(skewed.problems.join(" ")).toMatch(/different timestamp/);
    expect(skewed.problems.join(" ")).toMatch(/0001_b is pending but older/);
  });
});
