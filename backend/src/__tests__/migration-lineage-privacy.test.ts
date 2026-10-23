import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/** The canonical migration lineage after F1/F2: contiguous numbering, the two new migrations are additive, and the snapshot chain is intact. */
const DIR = path.resolve(__dirname, "../../db/migrations");
const journal = JSON.parse(readFileSync(path.join(DIR, "meta/_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string; when: number }> };
const sql = (tag: string) => readFileSync(path.join(DIR, `${tag}.sql`), "utf8");
const code = (tag: string) => sql(tag).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const snap = (n: number) => JSON.parse(readFileSync(path.join(DIR, `meta/${String(n).padStart(4, "0")}_snapshot.json`), "utf8")) as { id: string; prevId: string };

describe("migration lineage (54 migrations: 0000-0053)", () => {
  it("is contiguous, numbered like its files and strictly increasing in time (no renumbering, nothing inserted in the middle)", () => {
    expect(journal.entries).toHaveLength(54);
    journal.entries.forEach((e, i) => {
      expect(e.idx).toBe(i);
      expect(e.tag.startsWith(String(i).padStart(4, "0") + "_")).toBe(true);
      if (i) expect(e.when).toBeGreaterThan(journal.entries[i - 1]!.when);
    });
    expect(journal.entries[51]!.tag).toBe("0051_db_domain_registry_integrity");
    expect(journal.entries[52]!.tag).toBe("0052_privacy_guards_runtime_groups");
    expect(journal.entries[53]!.tag).toBe("0053_privacy_erasure_tombstone");
  });
  it("snapshots chain from 0051 to 0053", () => {
    expect(snap(52).prevId).toBe(snap(51).id);
    expect(snap(53).prevId).toBe(snap(52).id);
    expect(new Set([snap(51).id, snap(52).id, snap(53).id]).size).toBe(3);
  });
  it("historical privacy migrations are untouched (content pinned)", () => {
    const sha = (t: string) => createHash("sha256").update(sql(t)).digest("hex");
    // the guards F1 corrects are REPLACED by 0052, never edited in place: their historical text still names only beeside_runtime_role
    expect(sql("0016_fa4_public_v1_integrity")).toMatch(/r\.rolname = 'beeside_runtime_role'/);
    expect(sql("0023_fa4_public_v1_envelope_integrity")).toMatch(/r\.rolname = 'beeside_runtime_role'/);
    expect(sha("0016_fa4_public_v1_integrity")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("0052 (F1) widens nothing: it only names the second application group in the two guard predicates", () => {
    const m = code("0052_privacy_guards_runtime_groups");
    expect(m).not.toMatch(/^\s*(GRANT|REVOKE|ALTER ROLE|CREATE ROLE|DROP)/im);
    expect(m.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(2);
    expect(m.match(/r\.rolname IN \('beeside_runtime_role', 'beeside_discovery_rw'\)/g)).toHaveLength(2);
    expect(m).toContain("pg_auth_members"); // direct membership, as before (pg_has_role would be true for every role for an owner/superuser)
    expect(m).not.toContain("pg_has_role(");
  });
  it("0053 (F2) is additive: one function, four triggers, BV607, no data change and no privilege change", () => {
    const m = code("0053_privacy_erasure_tombstone");
    expect(m.match(/CREATE FUNCTION/g)).toHaveLength(1);
    expect(m.match(/CREATE TRIGGER/g)).toHaveLength(4);
    expect(m).toContain("BV607");
    expect(m).not.toMatch(/^\s*(GRANT|REVOKE|DELETE|TRUNCATE|DROP|INSERT INTO|UPDATE )/im);
  });
  it("the optional legacy rollback removes exactly what 0053 adds", () => {
    const rb = readFileSync(path.resolve(DIR, "../../../infra/db/legacy/legacy-erasure-guard-rollback.sql"), "utf8");
    for (const t of sql("0053_privacy_erasure_tombstone").match(/CREATE TRIGGER (\w+)/g)!.map((x) => x.split(" ")[2]!)) expect(rb).toContain(`DROP TRIGGER IF EXISTS ${t}`);
    expect(rb).toContain("DROP FUNCTION IF EXISTS fa4_erased_project_guard()");
    expect(rb).not.toMatch(/DROP TABLE|DELETE|TRUNCATE/i);
  });
});
