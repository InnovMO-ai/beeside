import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * infra/db/rehearsal/clone-rehearsal.sh: the lifecycle of the TEMPORARY Cloud SQL clone. Exercised with a `gcloud` stub that records every call and keeps a tiny fake
 * instance list: the tests pin the anti-production guards (print-only by default, approval gates, clone-name rule, TTL, label check, exact delete confirmation) and that every
 * write command names the clone and never the source instance. Nothing here reaches GCP.
 */
const ROOT = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(ROOT, "infra/db/rehearsal/clone-rehearsal.sh");
const base = mkdtempSync(path.join(tmpdir(), "clone-rh-"));
const stubDir = path.join(base, "bin"); mkdirSync(stubDir);
const stateDir = path.join(base, "state"); mkdirSync(stateDir);
const calls = path.join(stateDir, "calls.log");
const GCLOUD = `#!/bin/sh
S="${stateDir}"
echo "$*" >> "$S/calls.log"
args="$*"
case "$args" in
  *"--help"*) echo "--update-labels --no-backup --[no-]enable-point-in-time-recovery --availability-type --[no-]deletion-protection --tier --point-in-time";;
  *"sql instances describe"*)
    name=$(echo "$args" | sed -E 's/.*sql instances describe ([^ ]+).*/\\1/')
    fmt=$(echo "$args" | sed -E 's/.*--format=value\\(([^)]*)\\).*/\\1/')
    case "$name" in discovery-db) ;; *) [ -f "$S/clone_exists" ] || { echo "not found" >&2; exit 1; } ;; esac
    case "$fmt" in
      state) echo RUNNABLE;; databaseVersion) echo POSTGRES_16;; settings.backupConfiguration.pointInTimeRecoveryEnabled) echo True;;
      settings.userLabels.purpose) [ -f "$S/no_label" ] || echo rehearsal;; settings.ipConfiguration.authorizedNetworks) [ -f "$S/open_net" ] && echo "0.0.0.0/0" || true;;
      settings.ipConfiguration.sslMode) echo ENCRYPTED_ONLY;; *) echo "x";;
    esac;;
  *"sql instances list"*)
    if [ -f "$S/clone_exists" ]; then
      case "$args" in *csv*) echo "discovery-db-rehearsal-t1,$(cat "$S/expires" 2>/dev/null)";; *) echo "discovery-db-rehearsal-t1";; esac
    fi;;
  *"sql instances delete"*) rm -f "$S/clone_exists";;
  *"sql instances clone"*) touch "$S/clone_exists";;
esac
exit 0
`;
writeFileSync(path.join(stubDir, "gcloud"), GCLOUD); chmodSync(path.join(stubDir, "gcloud"), 0o755);

function run(phase: string, env: Record<string, string> = {}): { code: number | null; out: string } {
  const r = spawnSync("bash", [SCRIPT, phase], { cwd: ROOT, encoding: "utf8", env: { PATH: `${stubDir}:${process.env.PATH}`, HOME: base, TAG: "t1", ...env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const callLog = () => (existsSync(calls) ? readFileSync(calls, "utf8") : "");
const reset = () => { for (const f of readdirSync(stateDir)) if (f !== "x") { try { rmSync(path.join(stateDir, f), { recursive: true, force: true }); } catch { /* ignore */ } } };
const APPROVED = { RUN: "1", APPROVAL: "CLONE_REHEARSAL_APPROVED" };
const DIR = path.join(base, "rdir");

beforeEach(() => reset());

describe("clone-rehearsal.sh — print-only by default", () => {
  it("plan prints the whole procedure and never calls gcloud", () => {
    const { code, out } = run("plan");
    expect(code).toBe(0);
    expect(existsSync(calls)).toBe(false);
    expect(out).toContain("sql instances clone discovery-db discovery-db-rehearsal-t1 --point-in-time");
    expect(out).toContain("--availability-type ZONAL");
    expect(out).toContain("--no-backup");
    expect(out).toContain("--no-enable-point-in-time-recovery");
    expect(out).toContain("purpose=rehearsal,expires_utc=");
    for (const u of ["postgres", "discovery_migrate", "discovery_runtime"]) expect(out).toContain(`sql users set-password ${u} --instance discovery-db-rehearsal-t1 --password <new random, never printed>`);
    expect(out).toContain("CREATE ROLE rehearsal_marker_");
    expect(out).toContain("sql instances delete discovery-db-rehearsal-t1 --quiet");
    expect(out).toContain("--project beeside-discovery-prod");
  });
  it("every write command names the clone, never the source instance", () => {
    const { out } = run("plan");
    const writes = out.split("\n").filter((l) => /sql (instances (clone|patch|delete)|users set-password)/.test(l));
    expect(writes.length).toBeGreaterThanOrEqual(8);
    for (const l of writes) {
      if (/instances clone/.test(l)) expect(l).toMatch(/clone discovery-db discovery-db-rehearsal-t1 /);
      else expect(l).toMatch(/discovery-db-rehearsal-t1/);
      expect(l).not.toMatch(/(patch|delete) discovery-db( |$)/);
    }
    expect(out).not.toMatch(/allUsers|authorized-networks|add-iam-policy-binding|secrets (create|versions)/);
  });
  it("RUN=1 without the written approval refuses every mutating phase before any gcloud call", () => {
    for (const phase of ["create", "harden", "mark", "resize", "teardown"]) {
      const r = run(phase, { RUN: "1", REHEARSAL_DIR: DIR, CONFIRM_DELETE: "discovery-db-rehearsal-t1" });
      expect(r.code).toBe(3);
      expect(r.out).toContain("CLONE_REHEARSAL_APPROVED");
    }
    expect(callLog()).toBe("");
  });
});

describe("clone-rehearsal.sh — static guards", () => {
  it.each([
    ["the source instance as the clone", { CLONE: "discovery-db" }],
    ["a name outside the rehearsal prefix", { CLONE: "prod-copy" }],
    ["a name that only looks similar", { CLONE: "discovery-db-rehearsal-X;rm" }],
    ["a TTL over 24 h", { TTL_HOURS: "25" }],
    ["a non-numeric TTL", { TTL_HOURS: "soon" }],
    ["another project", { PROJECT: "some-other-project" }],
    ["the production proxy port", { PROXY_PORT: "5434" }],
  ])("refuses %s", (_d, env) => {
    const r = run("plan", env as Record<string, string>);
    expect(r.code).toBe(2);
    expect(r.out).toContain("STOP");
    expect(existsSync(calls)).toBe(false);
  });
});

describe("clone-rehearsal.sh — lifecycle against the stub", () => {
  it("preflight is read-only, checks that the installed gcloud documents every flag it will use, and refuses when a rehearsal clone already exists", () => {
    const pre = run("preflight", { RUN: "1" });
    expect(pre.code).toBe(0);
    expect(pre.out).toContain("flags used by the rehearsal are documented");
    expect(callLog().split("\n").filter((l) => !l.includes("--help")).join("\n")).not.toMatch(/instances (clone|patch|delete)|set-password/);
    writeFileSync(path.join(stateDir, "clone_exists"), "");
    const r = run("preflight", { RUN: "1" });
    expect(r.code).toBe(2);
    expect(r.out).toContain("one at a time");
  });
  it("create clones from a point in time; harden replaces every inherited password with a new random one that never reaches the output", () => {
    expect(run("create", { ...APPROVED, REHEARSAL_DIR: DIR }).code).toBe(0);
    expect(callLog()).toMatch(/sql instances clone discovery-db discovery-db-rehearsal-t1 --point-in-time \d{4}-\d\d-\d\dT/);
    const h = run("harden", { ...APPROVED, REHEARSAL_DIR: DIR });
    expect(h.code).toBe(0);
    const dirMode = statSync(DIR).mode & 0o777; expect(dirMode).toBe(0o700);
    for (const u of ["postgres", "discovery_migrate", "discovery_runtime"]) {
      const f = path.join(DIR, `pw_${u}`); expect(existsSync(f)).toBe(true);
      expect(statSync(f).mode & 0o777).toBe(0o600);
      const pw = readFileSync(f, "utf8").trim(); expect(pw).toMatch(/^[0-9a-f]{48}$/);
      expect(h.out).not.toContain(pw);
      expect(callLog()).toContain(`sql users set-password ${u} --instance discovery-db-rehearsal-t1 --password ${pw}`);
    }
    expect(callLog()).toMatch(/patch discovery-db-rehearsal-t1 --availability-type ZONAL/);
    expect(callLog()).toMatch(/patch discovery-db-rehearsal-t1 --no-enable-point-in-time-recovery/);
    expect(callLog()).toMatch(/patch discovery-db-rehearsal-t1 --no-backup/);
    expect(callLog()).toMatch(/--update-labels purpose=rehearsal,expires_utc=\d{8}t\d{4},owner=product-owner/);
    expect(callLog()).not.toMatch(/(patch|delete|set-password)[^\n]* discovery-db( |$)/);
  });
  it("harden stops when the clone has authorized networks (a clone must not widen exposure)", () => {
    writeFileSync(path.join(stateDir, "clone_exists"), ""); writeFileSync(path.join(stateDir, "open_net"), "");
    const r = run("harden", { ...APPROVED, REHEARSAL_DIR: DIR });
    expect(r.code).toBe(2);
    expect(r.out).toContain("authorized networks");
    expect(callLog()).not.toMatch(/set-password|patch/);
  });
  it("status flags an expired clone", () => {
    writeFileSync(path.join(stateDir, "clone_exists"), ""); writeFileSync(path.join(stateDir, "expires"), "20200101t0000");
    expect(run("status", { RUN: "1" }).out).toContain("EXPIRED  discovery-db-rehearsal-t1");
    writeFileSync(path.join(stateDir, "expires"), "29990101t0000");
    expect(run("status", { RUN: "1" }).out).toContain("ok       discovery-db-rehearsal-t1");
  });
  it("teardown needs the exact clone name, refuses a clone without the rehearsal label, then deletes only the clone and destroys the local secrets", () => {
    writeFileSync(path.join(stateDir, "clone_exists"), "");
    mkdirSync(DIR, { recursive: true, mode: 0o700 }); writeFileSync(path.join(DIR, "pw_postgres"), "secret"); writeFileSync(path.join(DIR, "marker"), "m");
    expect(run("teardown", { ...APPROVED, REHEARSAL_DIR: DIR }).code).toBe(3);
    expect(run("teardown", { ...APPROVED, REHEARSAL_DIR: DIR, CONFIRM_DELETE: "discovery-db" }).code).toBe(3);
    writeFileSync(path.join(stateDir, "no_label"), "");
    const noLabel = run("teardown", { ...APPROVED, REHEARSAL_DIR: DIR, CONFIRM_DELETE: "discovery-db-rehearsal-t1" });
    expect(noLabel.code).toBe(2); expect(noLabel.out).toContain("purpose=rehearsal");
    expect(callLog()).not.toMatch(/instances delete/);
    rmSync(path.join(stateDir, "no_label"));
    const ok = run("teardown", { ...APPROVED, REHEARSAL_DIR: DIR, CONFIRM_DELETE: "discovery-db-rehearsal-t1" });
    expect(ok.code).toBe(0);
    expect(callLog()).toMatch(/patch discovery-db-rehearsal-t1 --no-deletion-protection/);
    expect(callLog()).toMatch(/instances delete discovery-db-rehearsal-t1 --quiet/);
    expect(callLog()).not.toMatch(/instances delete discovery-db( |$)/);
    expect(existsSync(DIR)).toBe(false);
    expect(ok.out).toContain("local rehearsal secrets destroyed");
  });
});
