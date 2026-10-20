import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkMigrationTarget, readTargetPolicy, TargetPolicy } from "./migration-target";
import { readJournal } from "./migration-state";

const tags = ["0000_a", "0001_b", "0002_c", "0003_d"];
const policy: TargetPolicy = { version: 1, targets: { discovery: { maxMigration: "0001_b" }, beeside: { maxMigration: null } } };

describe("migration target guard", () => {
  it("a capped database refuses pending migrations beyond its ceiling and accepts those up to it", () => {
    expect(checkMigrationTarget(policy, "discovery", tags, ["0002_c", "0003_d"], true)).toMatchObject({ ok: false });
    expect(checkMigrationTarget(policy, "discovery", tags, ["0002_c", "0003_d"], false)).toMatchObject({ ok: false });   // the ceiling applies outside production too
    expect(checkMigrationTarget(policy, "discovery", tags, ["0001_b"], true)).toMatchObject({ ok: true, ceiling: "0001_b" });
    expect(checkMigrationTarget(policy, "discovery", tags, [], true)).toMatchObject({ ok: true });
  });
  it("an uncapped database receives everything", () => {
    expect(checkMigrationTarget(policy, "beeside", tags, tags, true)).toMatchObject({ ok: true, ceiling: null });
  });
  it("fails closed in production for an undeclared database or a missing policy; allows both outside production", () => {
    expect(checkMigrationTarget(policy, "other", tags, tags, true)).toMatchObject({ ok: false });
    expect(checkMigrationTarget(null, "beeside", tags, tags, true)).toMatchObject({ ok: false });
    expect(checkMigrationTarget(policy, "rt_ci_suite", tags, tags, false)).toMatchObject({ ok: true });
    expect(checkMigrationTarget(null, "rt_ci_suite", tags, tags, false)).toMatchObject({ ok: true });
  });
  it("a ceiling that names a migration absent from the journal is refused", () => {
    expect(checkMigrationTarget({ version: 1, targets: { discovery: { maxMigration: "9999_x" } } }, "discovery", tags, [], true)).toMatchObject({ ok: false });
  });
  it("the shipped policy is valid against this build: legacy `discovery` is capped at an existing migration that is NOT the last one, `beeside` is uncapped", () => {
    const folder = path.resolve(__dirname, "../../db/migrations");
    const shipped = readTargetPolicy(folder)!;
    const journal = readJournal(folder).map((e) => e.tag);
    const cap = shipped.targets.discovery!.maxMigration!;
    expect(journal).toContain(cap);
    expect(journal.indexOf(cap)).toBe(23);                                   // 0000..0023 = the 24 migrations production `discovery` has
    expect(journal.indexOf(cap)).toBeLessThan(journal.length - 1);
    expect(shipped.targets.beeside!.maxMigration).toBeNull();
    // simulating production `discovery` (24 applied) with this build: refused, nothing would be applied
    expect(checkMigrationTarget(shipped, "discovery", journal, journal.slice(24), true).ok).toBe(false);
  });
  it("rejects an unsupported policy format", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tgt-"));
    writeFileSync(path.join(dir, "migration-targets.json"), JSON.stringify({ version: 2, targets: {} }));
    expect(() => readTargetPolicy(dir)).toThrow(/unsupported/);
  });
});
