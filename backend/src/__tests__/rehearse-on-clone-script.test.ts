import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * infra/db/rehearsal/rehearse-on-clone.sh (SQL side of the clone rehearsal). The behaviour against a database is rehearsed on the local PostgreSQL simulator (see the README);
 * these tests need no database: they pin the fixed target (no redirection), the evidence it requires from clone-rehearsal.sh, that stopping never deletes anything, and — by
 * reading the script — that every destructive or irreversible step sits behind the identity gate and that critical steps stop the run.
 */
const ROOT = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(ROOT, "infra/db/rehearsal/rehearse-on-clone.sh");
const base = mkdtempSync(path.join(tmpdir(), "rh-onclone-"));
const CLONE = "discovery-db-rehearsal-t1";
const DIR = path.join(base, ".beeside-rehearsal", CLONE);
mkdirSync(DIR, { recursive: true });
writeFileSync(path.join(DIR, "marker"), "rehearsal_marker_0123456789abcdef");
writeFileSync(path.join(DIR, "pw_postgres"), "x");
const CONN = `beeside-discovery-prod:northamerica-south1:${CLONE}`;
const evidence = (epoch: number, conn = CONN) => writeFileSync(path.join(DIR, "netcheck_ok"), `${epoch} ${conn}\n`);
const now = () => Math.floor(Date.now() / 1000);

function run(env: Record<string, string> = {}) {
  const r = spawnSync("bash", [SCRIPT], { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: base, TAG: "t1", EVIDENCE_DIR: path.join(base, "ev"), ...env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const text = readFileSync(SCRIPT, "utf8");
const at = (needle: string) => { const i = text.indexOf(needle); if (i < 0) throw new Error(`not found in the script: ${needle}`); return i; };

describe("rehearse-on-clone.sh — fixed target", () => {
  it.each(["CLONE_HOST", "LEGACY_DB", "CANONICAL_DB", "PROJECT", "REGION", "SOURCE_INSTANCE", "SOURCE", "SQL_INSTANCE", "ALLOW_OTHER_PROJECT", "CLONE", "PROXY_PORT", "ADMIN_USER", "REHEARSAL_DIR", "REHEARSAL_APPLY_SQL"])(
    "refuses the variable %s", (name) => {
      evidence(now());
      const r = run({ [name]: "x" });
      expect(r.code).toBe(9);
      expect(r.out).toContain(`the variable ${name} is set`);
    });
  it("simulator mode accepts only the simulator port, never the production proxy port", () => {
    const r = run({ REHEARSAL_SIMULATOR: "1", PROXY_PORT: "5434", REHEARSAL_DIR: DIR });
    expect(r.code).toBe(9); expect(r.out).toContain("only PROXY_PORT=5433");
  });
  it("needs the gate evidence of THIS clone, no older than 24 h", () => {
    writeFileSync(path.join(DIR, "netcheck_ok"), "garbage\n"); expect(run().out).toContain("malformed netcheck_ok");
    evidence(now(), "other-project:northamerica-south1:discovery-db"); expect(run().out).toContain("belongs to");
    evidence(now() - 90000); expect(run().out).toContain("older than 24 h");
  });
});

describe("rehearse-on-clone.sh — stopping never deletes", () => {
  it("when the SQL side cannot start it prints the controlled teardown command (exact name, explicit confirmation) and runs nothing else", () => {
    evidence(now());
    const r = run();
    expect(r.code).toBe(9);
    expect(r.out).toContain("cannot log in");
    expect(r.out).toContain(`CONFIRM_DELETE=${CLONE} TAG=t1 bash infra/db/rehearsal/clone-rehearsal.sh teardown`);
    expect(r.out).toContain("NOT touched and NOT deleted");
  });
  it("the script itself never runs gcloud or the teardown: gcloud is shimmed to fail and the teardown appears only inside echo text", () => {
    expect(text).toMatch(/gcloud is disabled inside rehearse-on-clone\.sh/);
    const executed = text.split("\n").filter((l) => /clone-rehearsal\.sh/.test(l) && !/^\s*(#|\{?\s*echo|\{ echo)/.test(l) && !/^\s*echo/.test(l));
    expect(executed.filter((l) => /bash .*clone-rehearsal\.sh/.test(l) && !/echo/.test(l))).toEqual([]);
  });
});

describe("rehearse-on-clone.sh — critical failures stop the run before destructive steps", () => {
  it("each destructive or irreversible step comes after its identity gate", () => {
    expect(at('identity_gate "S5 reverse reconciliation')).toBeLessThan(at("SYNC_SOURCE_URL=$DST SYNC_TARGET_URL=$SRC"));
    expect(at('identity_gate "S6 legacy hardening')).toBeLessThan(at("LEGACY_HARDEN=yes"));
    expect(at('identity_gate "S6b persisted anonymisation')).toBeLessThan(at('privacy_functional "S6b'));
    const g7 = at('identity_gate "S7 rollback drill');
    for (const needle of ["DROP DATABASE $NEWDB", 'GRANT beeside_migrate TO', 'DROP ROLE $r', "DROP ROLE IF EXISTS $r"]) expect(g7).toBeLessThan(at(needle));
    expect(at('identity_gate "S2 data copy')).toBeLessThan(at("DOMAIN_SYNC_APPROVED=yes sync"));
  });
  it("the gate requires zero failed checks and the marker on every connection used; the S4 privacy gate precedes every later section", () => {
    const gate = text.slice(at("identity_gate(){"), at("identity_gate(){") + 1800);
    expect(gate).toContain('crit_gate "$1"');
    expect(gate).toContain("pg_roles where rolname='$M'");
    expect(gate).toMatch(/discovery_migrate connection does not land on the marked clone/);
    expect(gate).toMatch(/beeside_migrate connection does not land on the marked clone/);
    expect(at('crit_gate "S4 privacy')).toBeLessThan(at("echo \"== S5 "));
  });
  it("the destructive operations themselves are must_* (a failure stops on the spot) and only drop what the run created", () => {
    for (const needle of ['must_ok "DROP DATABASE $NEWDB"', 'must_ok "temporary: admin joins the database owner"', 'must_ok "DROP ROLE $r" adm "DROP ROLE $r"']) expect(text).toContain(needle);
    expect(text).toContain("none of the roles to drop existed before the rehearsal");
    expect(text).toContain("the database to drop is owned by the role this run created");
    expect(text).toContain("the roles the rehearsal creates (and S7 drops) do not exist yet");
  });
  it("the provisioning stops between PRE, migrate and POST on a failed check", () => {
    for (const needle of ['crit_gate "$1: PRE checks', 'crit_gate "$1: migrations', 'crit_gate "$1: POST']) expect(text).toContain(needle);
  });
});

describe("rehearse-on-clone.sh — the privacy check runs the real erasure function and verifies its effects", () => {
  it("executes fa4_anonymize_project and verifies what must go, what must stay and what must not be touched", () => {
    expect(text).toContain("select fa4_anonymize_project('@T@'");
    for (const key of ["email", "answers_empty", "status", "result_model_erased", "result_snapshots_erased", "result_structure_kept", "signals_erased_kept", "contacts_erased_kept", "tokens_revoked_kept",
      "legal_evidence_kept", "analytics_events_kept", "marketing_consent_kept", "erasure_log_one_row", "no_trace_of_personal_data", "control_project_untouched", "only_the_target_anonymised", "erasure_flag_closed"])
      expect(text).toContain(`('${key}'`);
    expect(text).toContain("BYPASS_LEAKED");
    expect(text).toContain("LOG_MUTABLE");
    expect(text).toContain("ACCEPTED_EMPTY_ACTOR");
    expect(text).toContain("ACCEPTED_UNKNOWN_PROJECT");
  });
  it("runs reversibly on both databases as the gate, then committed on the canonical one, and the evidence log never prints an e-mail address", () => {
    expect(text).toContain("privacy_functional \"S4 canonical $NEWDB (rolled back)\" bm rollback");
    expect(text).toContain("privacy_functional \"S4 legacy $LEGDB, production role model (rolled back)\" dm rollback");
    expect(text).toContain("privacy_functional \"S6b canonical $NEWDB (committed)\" bm commit");
    expect(text).toContain("no e-mail address of the clone data appears in the evidence");
  });
  it("refusals must come for the right reason (permission denied / append-only), not from a broken connection", () => {
    expect(text).toContain("expect_fail_like()");
    expect(text).toContain("must_fail_like()");
    expect((text.match(/must_fail_like "/g) ?? []).length).toBeGreaterThanOrEqual(9);
  });
});
