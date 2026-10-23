import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * infra/db/rehearsal/clone-rehearsal.sh: the lifecycle of the TEMPORARY Cloud SQL clone. Exercised with a `gcloud` stub that records every call and keeps a tiny fake
 * instance: the tests pin (1) the FIXED target (no variable can redirect the script to another project/instance/port/dir), (2) the credential window (the passwords inherited
 * from production are replaced as the first action after the clone exists, before any other change, and an unrotated clone is flagged), (3) the network/TLS/users gate that
 * every later step needs, plus the print-only default, approval gates, TTL, label check and exact delete confirmation. Nothing here reaches GCP.
 */
const ROOT = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(ROOT, "infra/db/rehearsal/clone-rehearsal.sh");
const base = mkdtempSync(path.join(tmpdir(), "clone-rh-"));
const stubDir = path.join(base, "bin"); mkdirSync(stubDir);
const stateDir = path.join(base, "state"); mkdirSync(stateDir);
const calls = path.join(stateDir, "calls.log");
const CLONE = "discovery-db-rehearsal-t1";
const SRC_CONN = "beeside-discovery-prod:northamerica-south1:discovery-db";
const CLONE_CONN = `beeside-discovery-prod:northamerica-south1:${CLONE}`;
// State flags (files in stateDir): clone_exists labeled rotated | no_label open_net src_open_net ssl_weak bad_conn extra_user rot_fail ep_override | expires
// Failure injection: clone_fail (clone command errors after creating the instance) label_fail (the label patch errors) patch_fail (any other patch errors) dp_fail (clearing deletion protection errors) list_fail delete_fail
const GCLOUD = `#!/bin/sh
S="${stateDir}"
echo "$*" >> "$S/calls.log"
args="$*"
f() { [ -f "$S/$1" ]; }
case "$args" in
  *"--help"*) echo "--update-labels --no-backup --[no-]enable-point-in-time-recovery --availability-type --[no-]deletion-protection --tier --point-in-time";;
  *"config list"*) if f ep_override; then echo '{"api_endpoint_overrides": {"sql": "https://x"}}'; else echo '{}'; fi;;
  *"auth list"*) echo tester@example.com;;
  *"sql users list"*) echo postgres; echo discovery_migrate; echo discovery_runtime; if f extra_user; then echo someone_else; fi;;
  *"sql users set-password"*) if f rot_fail; then echo "boom" >&2; exit 1; fi;;
  *"sql instances describe"*)
    name=$(echo "$args" | sed -E 's/.*sql instances describe ([^ ]+).*/\\1/')
    fmt=$(echo "$args" | sed -E 's/.*--format=value\\(([^)]*)\\).*/\\1/')
    if [ "$name" = discovery-db ]; then
      case "$fmt" in
        connectionName) echo "${SRC_CONN}";; state) echo RUNNABLE;; databaseVersion) echo POSTGRES_16;; settings.backupConfiguration.pointInTimeRecoveryEnabled) echo True;;
        settings.ipConfiguration.authorizedNetworks) f src_open_net && echo "0.0.0.0/0" || true;; settings.ipConfiguration.sslMode) echo ENCRYPTED_ONLY;;
        settings.ipConfiguration.ipv4Enabled) echo True;; settings.ipConfiguration.privateNetwork) true;; *) echo x;;
      esac
    else
      f clone_exists || { echo "not found" >&2; exit 1; }
      case "$fmt" in
        connectionName) if f bad_conn; then echo "other-project:northamerica-south1:$name"; else echo "${CLONE_CONN}"; fi;;
        settings.userLabels.purpose) f labeled && ! f no_label && echo rehearsal || true;;
        settings.userLabels.pw_rotated) f rotated && echo yes || true;;
        settings.ipConfiguration.authorizedNetworks) f open_net && echo "0.0.0.0/0" || true;;
        settings.ipConfiguration.sslMode) if f ssl_weak; then echo ALLOW_UNENCRYPTED_AND_ENCRYPTED; else echo ENCRYPTED_ONLY; fi;;
        settings.ipConfiguration.ipv4Enabled) echo True;; settings.ipConfiguration.privateNetwork) true;; *) echo x;;
      esac
    fi;;
  *"sql instances list"*)
    if f list_fail; then echo "list failed" >&2; exit 1; fi
    if f clone_exists; then
      case "$args" in
        *csv*) echo "${CLONE},$(f labeled && echo rehearsal),$(f rotated && echo yes),$(cat "$S/expires" 2>/dev/null)";;
        *) echo "${CLONE}";;
      esac
    fi;;
  *"sql instances delete"*) if f delete_fail; then echo "delete failed" >&2; exit 1; fi; rm -f "$S/clone_exists";;
  *"sql instances clone"*) touch "$S/clone_exists"; if f clone_fail; then echo "clone operation timed out" >&2; exit 1; fi;;
  *"sql instances patch"*)
    case "$args" in
      *"--update-labels"*) if f label_fail; then echo "label patch failed" >&2; exit 1; fi; touch "$S/labeled"; case "$args" in *pw_rotated=yes*) touch "$S/rotated";; esac;;
      *"--no-deletion-protection"*) if f dp_fail; then echo "cannot patch" >&2; exit 1; fi;;
      *) if f patch_fail; then echo "patch failed" >&2; exit 1; fi;;
    esac;;
esac
exit 0
`;
writeFileSync(path.join(stubDir, "gcloud"), GCLOUD); chmodSync(path.join(stubDir, "gcloud"), 0o755);

function run(phase: string, env: Record<string, string> = {}): { code: number | null; out: string } {
  const r = spawnSync("bash", [SCRIPT, phase], { cwd: ROOT, encoding: "utf8", env: { PATH: `${stubDir}:${process.env.PATH}`, HOME: base, TAG: "t1", ...env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const callLog = () => (existsSync(calls) ? readFileSync(calls, "utf8") : "");
const lines = () => callLog().split("\n").filter(Boolean);
const flag = (n: string, content = "") => writeFileSync(path.join(stateDir, n), content);
const reset = () => { for (const f of readdirSync(stateDir)) { try { rmSync(path.join(stateDir, f), { recursive: true, force: true }); } catch { /* ignore */ } } rmSync(path.join(base, ".beeside-rehearsal"), { recursive: true, force: true }); };
const APPROVED = { RUN: "1", APPROVAL: "CLONE_REHEARSAL_APPROVED" };
const DIR = path.join(base, ".beeside-rehearsal", CLONE);
/** state of a clone that `create` already finished (rotated, labelled, gate evidence written) */
const createdClone = () => { flag("clone_exists"); flag("labeled"); flag("rotated"); mkdirSync(DIR, { recursive: true, mode: 0o700 }); writeFileSync(path.join(DIR, "netcheck_ok"), `${Math.floor(Date.now() / 1000)} ${CLONE_CONN}\n`); };

beforeEach(() => reset());

describe("clone-rehearsal.sh — print-only by default", () => {
  it("plan prints the whole procedure and never calls gcloud", () => {
    const { code, out } = run("plan");
    expect(code).toBe(0);
    expect(existsSync(calls)).toBe(false);
    expect(out).toContain(`sql instances clone discovery-db ${CLONE} --point-in-time`);
    expect(out).toContain("--availability-type ZONAL");
    expect(out).toContain("--no-backup");
    expect(out).toContain("--no-enable-point-in-time-recovery");
    expect(out).toContain("purpose=rehearsal,pw_rotated=yes,expires_utc=");
    for (const u of ["postgres", "discovery_migrate", "discovery_runtime"]) expect(out).toContain(`sql users set-password ${u} --instance ${CLONE} --password <new random, never printed>`);
    expect(out).toContain("CREATE ROLE rehearsal_marker_");
    expect(out).toContain(`sql instances delete ${CLONE} --quiet`);
    expect(out).toContain("--project beeside-discovery-prod");
  });
  it("every write command names the clone, never the source instance; the clone is rotated before the first patch", () => {
    const { out } = run("plan");
    const writes = out.split("\n").filter((l) => /sql (instances (clone|patch|delete)|users set-password)/.test(l));
    expect(writes.length).toBeGreaterThanOrEqual(10);
    for (const l of writes) {
      if (/instances clone/.test(l)) expect(l).toMatch(new RegExp(`clone discovery-db ${CLONE} `));
      else expect(l).toContain(CLONE);
      expect(l).not.toMatch(/(patch|delete) discovery-db( |$)/);
    }
    expect(out).not.toMatch(/allUsers|authorized-networks|add-iam-policy-binding|secrets (create|versions)/);
    const idx = (re: RegExp) => writes.findIndex((l) => re.test(l));
    expect(idx(/instances clone/)).toBeLessThan(idx(/set-password postgres/));
    expect(idx(/set-password discovery_runtime/)).toBeLessThan(idx(/instances patch/));
  });
  it("RUN=1 without the written approval refuses every mutating phase before any gcloud call", () => {
    for (const phase of ["create", "harden", "mark", "resize", "teardown"]) {
      const r = run(phase, { RUN: "1", CONFIRM_DELETE: CLONE });
      expect(r.code).toBe(3);
      expect(r.out).toContain("CLONE_REHEARSAL_APPROVED");
    }
    expect(callLog()).toBe("");
  });
});

describe("clone-rehearsal.sh — fixed target: nothing can redirect it", () => {
  it.each([
    ["PROJECT", "some-other-project"], ["REGION", "us-central1"], ["SOURCE_INSTANCE", "other-db"], ["SOURCE", "other-db"], ["CLONE", "discovery-db"],
    ["ALLOW_OTHER_PROJECT", "1"], ["SQL_INSTANCE", "other-db"], ["PROXY_PORT", "5434"], ["REHEARSAL_DIR", "/tmp/elsewhere"],
  ])("refuses the variable %s even when it holds an apparently harmless value", (name, value) => {
    for (const phase of ["plan", "preflight", "create", "teardown"]) {
      const r = run(phase, { [name]: value, ...APPROVED, CONFIRM_DELETE: CLONE });
      expect(r.code).toBe(2);
      expect(r.out).toContain(`the variable ${name} is set`);
    }
    expect(existsSync(calls)).toBe(false);
  });
  it("an unset variable is fine; a gcloud API-endpoint override (environment or configuration) is refused", () => {
    expect(run("plan").code).toBe(0);
    const r = run("plan", { CLOUDSDK_API_ENDPOINT_OVERRIDES_SQLADMIN: "https://evil.example/" });
    expect(r.code).toBe(2); expect(r.out).toContain("CLOUDSDK_API_ENDPOINT_OVERRIDES");
    flag("ep_override");
    const p = run("preflight", { RUN: "1" });
    expect(p.code).toBe(2); expect(p.out).toContain("api_endpoint_overrides");
  });
  it.each([
    ["a TTL over 24 h", { TTL_HOURS: "25" }],
    ["a non-numeric TTL", { TTL_HOURS: "soon" }],
    ["a TAG with shell characters", { TAG: "x;rm" }],
    ["a TAG with upper case", { TAG: "ABC" }],
    ["a TAG longer than 12", { TAG: "abcdefghijklm" }],
    ["a PITR lag over 60 min", { PITR_LAG_MIN: "61" }],
  ])("refuses %s", (_d, env) => {
    const r = run("plan", env as Record<string, string>);
    expect(r.code).toBe(2);
    expect(r.out).toContain("STOP");
    expect(existsSync(calls)).toBe(false);
  });
  it("every gcloud call carries --project beeside-discovery-prod and the fixed region/instance names", () => {
    createdClone();
    run("netcheck", { RUN: "1" }); run("preflight", { RUN: "1" });
    for (const l of lines().filter((x) => !/^(config list|auth list)/.test(x) && !x.includes("--help"))) expect(l).toContain("--project beeside-discovery-prod");
  });
});

describe("clone-rehearsal.sh — credential window and network/TLS gate", () => {
  it("preflight is read-only, checks the gcloud flags and the SOURCE posture (no authorized networks, TLS enforced) and refuses when a rehearsal clone already exists", () => {
    const pre = run("preflight", { RUN: "1" });
    expect(pre.code).toBe(0);
    expect(pre.out).toContain("netcheck discovery-db: authorizedNetworks=none sslMode=ENCRYPTED_ONLY");
    expect(pre.out).toContain("flags used by the rehearsal are documented");
    expect(lines().filter((l) => !l.includes("--help")).join("\n")).not.toMatch(/instances (clone|patch|delete)|set-password/);
    flag("clone_exists");
    const r = run("preflight", { RUN: "1" });
    expect(r.code).toBe(2); expect(r.out).toContain("one at a time");
  });
  it("create and preflight refuse to clone a source that has authorized networks (the clone would inherit the exposure)", () => {
    flag("src_open_net");
    for (const phase of ["preflight", "create"]) {
      const r = run(phase, APPROVED);
      expect(r.code).toBe(2); expect(r.out).toContain("authorized networks");
    }
    expect(callLog()).not.toMatch(/instances clone/);
  });
  it("create: clone from a point in time, THEN rotate every user, THEN the first patch (labels incl. pw_rotated), then verify and write the gate evidence", () => {
    const r = run("create", APPROVED);
    expect(r.code).toBe(0);
    expect(r.out).toContain("create complete: passwords rotated, network and TLS verified");
    const l = lines();
    const at = (re: RegExp) => l.findIndex((x) => re.test(x));
    const cl = at(/sql instances clone discovery-db discovery-db-rehearsal-t1 --point-in-time \d{4}-\d\d-\d\dT/);
    const sp = ["postgres", "discovery_migrate", "discovery_runtime"].map((u) => at(new RegExp(`sql users set-password ${u} --instance ${CLONE} --password `)));
    const lab = at(/instances patch discovery-db-rehearsal-t1 --update-labels purpose=rehearsal,pw_rotated=yes,expires_utc=\d{8}t\d{4},owner=product-owner/);
    expect(cl).toBeGreaterThanOrEqual(0);
    for (const i of sp) expect(i).toBeGreaterThan(cl);
    expect(lab).toBeGreaterThan(Math.max(...sp));
    // no other write between the clone and the last rotation
    const between = l.slice(cl + 1, Math.max(...sp)).filter((x) => /instances (patch|delete|clone)/.test(x));
    expect(between).toEqual([]);
    expect(l.filter((x) => /instances patch/.test(x) && !x.includes("--update-labels"))).toEqual([]);
    expect(statSync(DIR).mode & 0o777).toBe(0o700);
    for (const u of ["postgres", "discovery_migrate", "discovery_runtime"]) {
      const file = path.join(DIR, `pw_${u}`);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      const pw = readFileSync(file, "utf8").trim(); expect(pw).toMatch(/^[0-9a-f]{48}$/);
      expect(r.out).not.toContain(pw);
      expect(callLog()).toContain(`sql users set-password ${u} --instance ${CLONE} --password ${pw}`);
    }
    expect(readFileSync(path.join(DIR, "netcheck_ok"), "utf8")).toMatch(new RegExp(`^\\d+ ${CLONE_CONN}\\s*$`));
    expect(callLog()).not.toMatch(/(patch|delete|set-password)[^\n]* discovery-db( |$)/);
  });
  it("create: a failed rotation stops at once (exit 4), writes no gate evidence, shows the teardown command and does not touch the labels", () => {
    flag("rot_fail");
    const r = run("create", APPROVED);
    expect(r.code).toBe(4);
    expect(r.out).toContain("ROTATION FAILED");
    expect(r.out).toContain("still holds PRODUCTION passwords");
    expect(r.out).toContain("CONFIRM_DELETE=discovery-db-rehearsal-t1");
    expect(existsSync(path.join(DIR, "netcheck_ok"))).toBe(false);
    expect(callLog()).not.toMatch(/--update-labels/);
  });
  it("create: a clone with the wrong identity stops before any rotation", () => {
    flag("bad_conn");
    const r = run("create", APPROVED);
    expect(r.code).toBe(2); expect(r.out).toContain("identity check failed");
    expect(callLog()).not.toMatch(/set-password/);
  });
  it("create: a clone that inherited an unexpected user, a weaker sslMode or authorized networks is reported and no gate evidence is written", () => {
    for (const [fl, msg] of [["extra_user", "unexpected users"], ["ssl_weak", "sslMode"], ["open_net", "authorized networks"]] as const) {
      reset(); flag(fl);
      const r = run("create", APPROVED);
      expect(r.code).toBe(2); expect(r.out).toContain(msg);
      expect(existsSync(path.join(DIR, "netcheck_ok"))).toBe(false);
    }
  });
  it.each(["harden", "mark", "resize"])("%s needs the gate evidence, a rotated clone and a clean network/TLS/users check", (phase) => {
    flag("clone_exists"); flag("labeled"); flag("rotated");
    expect(run(phase, APPROVED).out).toContain("no network/TLS gate evidence");
    createdClone();
    flag("open_net"); expect(run(phase, APPROVED).out).toContain("authorized networks"); rmSync(path.join(stateDir, "open_net"));
    flag("ssl_weak"); expect(run(phase, APPROVED).out).toContain("sslMode"); rmSync(path.join(stateDir, "ssl_weak"));
    flag("extra_user"); expect(run(phase, APPROVED).out).toContain("unexpected users"); rmSync(path.join(stateDir, "extra_user"));
    rmSync(path.join(stateDir, "rotated")); expect(run(phase, APPROVED).out).toContain("UNROTATED");
    expect(callLog()).not.toMatch(/instances patch (?!.*--update-labels)/);
  });
  it("harden (after the gate): ZONAL, PITR off, automatic backups off — all on the clone", () => {
    createdClone();
    expect(run("harden", APPROVED).code).toBe(0);
    expect(callLog()).toMatch(/patch discovery-db-rehearsal-t1 --availability-type ZONAL/);
    expect(callLog()).toMatch(/patch discovery-db-rehearsal-t1 --no-enable-point-in-time-recovery/);
    expect(callLog()).toMatch(/patch discovery-db-rehearsal-t1 --no-backup/);
    expect(callLog()).not.toMatch(/(patch|delete|set-password)[^\n]* discovery-db( |$)/);
  });
  it("netcheck is read-only and reports the clone posture; status flags UNROTATED and EXPIRED clones", () => {
    createdClone();
    const n = run("netcheck", { RUN: "1" });
    expect(n.code).toBe(0); expect(n.out).toContain(`netcheck ${CLONE}: authorizedNetworks=none sslMode=ENCRYPTED_ONLY`);
    expect(lines().filter((l) => /instances (clone|patch|delete)|set-password/.test(l))).toEqual([]);
    flag("expires", "20200101t0000");
    expect(run("status", { RUN: "1" }).out).toContain(`EXPIRED   ${CLONE}`);
    flag("expires", "29990101t0000");
    expect(run("status", { RUN: "1" }).out).toContain(`ok        ${CLONE}`);
    rmSync(path.join(stateDir, "rotated"));
    expect(run("status", { RUN: "1" }).out).toContain(`UNROTATED ${CLONE}`);
  });
});

describe("clone-rehearsal.sh — teardown", () => {
  it("needs the exact clone name, refuses a clone without the rehearsal label, then deletes only the clone and destroys the local secrets", () => {
    createdClone(); writeFileSync(path.join(DIR, "pw_postgres"), "secret"); writeFileSync(path.join(DIR, "marker"), "m");
    expect(run("teardown", APPROVED).code).toBe(3);
    expect(run("teardown", { ...APPROVED, CONFIRM_DELETE: "discovery-db" }).code).toBe(3);
    flag("no_label");
    const noLabel = run("teardown", { ...APPROVED, CONFIRM_DELETE: CLONE });
    expect(noLabel.code).toBe(2); expect(noLabel.out).toContain("purpose=rehearsal");
    expect(callLog()).not.toMatch(/instances delete/);
    rmSync(path.join(stateDir, "no_label"));
    const ok = run("teardown", { ...APPROVED, CONFIRM_DELETE: CLONE });
    expect(ok.code).toBe(0);
    expect(callLog()).toMatch(/patch discovery-db-rehearsal-t1 --no-deletion-protection/);
    expect(callLog()).toMatch(/instances delete discovery-db-rehearsal-t1 --quiet/);
    expect(callLog()).not.toMatch(/instances delete discovery-db( |$)/);
    expect(existsSync(DIR)).toBe(false);
    expect(ok.out).toContain("local rehearsal secrets destroyed");
  });
  it("a clone whose creation failed before labelling can be deleted only with UNLABELED_OK=yes and a matching identity", () => {
    flag("clone_exists");   // no label, as after a failed rotation
    expect(run("teardown", { ...APPROVED, CONFIRM_DELETE: CLONE }).code).toBe(2);
    flag("bad_conn");
    const wrong = run("teardown", { ...APPROVED, CONFIRM_DELETE: CLONE, UNLABELED_OK: "yes" });
    expect(wrong.code).toBe(2); expect(wrong.out).toContain("identity check failed");
    expect(callLog()).not.toMatch(/instances delete/);
    rmSync(path.join(stateDir, "bad_conn"));
    const ok = run("teardown", { ...APPROVED, CONFIRM_DELETE: CLONE, UNLABELED_OK: "yes" });
    expect(ok.code).toBe(0);
    expect(callLog()).toMatch(/instances delete discovery-db-rehearsal-t1 --quiet/);
  });
});

describe("clone-rehearsal.sh — a failure at any stage never deletes anything, tells the state and offers a controlled teardown", () => {
  const TEARDOWN_HINT = `CONFIRM_DELETE=${CLONE}`;
  const noDelete = () => expect(callLog()).not.toMatch(/instances delete/);
  it("fails right after the clone command (the instance exists, the operation reported an error): says it holds PRODUCTION passwords and prints the unlabeled teardown", () => {
    flag("clone_fail");
    const r = run("create", APPROVED);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("PHASE 'create' STOPPED");
    expect(r.out).toContain("stage 'started'");
    expect(r.out).toContain("PRODUCTION passwords");
    expect(r.out).toContain(`${TEARDOWN_HINT} UNLABELED_OK=yes`);
    expect(r.out).toContain("NOTHING was deleted");
    expect(callLog()).not.toMatch(/set-password/);
    noDelete();
  });
  it("fails during the rotation: stage 'rotating', production passwords still on the clone, unlabeled teardown offered, nothing deleted", () => {
    flag("rot_fail");
    const r = run("create", APPROVED);
    expect(r.code).toBe(4);
    expect(r.out).toContain("stage 'rotating'");
    expect(r.out).toContain("still holds PRODUCTION passwords");
    expect(r.out).toContain(`${TEARDOWN_HINT} UNLABELED_OK=yes`);
    noDelete();
  });
  it("fails before the labels are assigned (rotation done): says passwords were rotated, labels missing, and offers the unlabeled teardown", () => {
    flag("label_fail");
    const r = run("create", APPROVED);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("stage 'rotated'");
    expect(r.out).toContain("passwords were rotated");
    expect(r.out).toContain(`${TEARDOWN_HINT} UNLABELED_OK=yes`);
    expect(existsSync(path.join(DIR, "netcheck_ok"))).toBe(false);
    noDelete();
    // and that clone can then be removed in a controlled way: exact name + UNLABELED_OK, nothing else
    expect(run("teardown", { ...APPROVED, CONFIRM_DELETE: CLONE }).code).toBe(2);
    expect(run("teardown", { ...APPROVED, CONFIRM_DELETE: CLONE, UNLABELED_OK: "yes" }).code).toBe(0);
    expect(callLog()).toMatch(/instances delete discovery-db-rehearsal-t1 --quiet/);
    expect(existsSync(DIR)).toBe(false);
  });
  it("fails in the final verification (stage 'labeled'): labelled clone, plain teardown offered (no UNLABELED_OK)", () => {
    flag("extra_user");
    const r = run("create", APPROVED);
    expect(r.code).toBe(2);
    expect(r.out).toContain("stage 'labeled'");
    expect(r.out).toContain(TEARDOWN_HINT);
    expect(r.out).not.toContain("UNLABELED_OK=yes TAG");
    noDelete();
  });
  it("fails during the hardening: the clone is untouched by deletion, teardown is offered, and it still works afterwards", () => {
    createdClone(); flag("patch_fail");
    const r = run("harden", APPROVED);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("PHASE 'harden' STOPPED");
    expect(r.out).toContain(TEARDOWN_HINT);
    noDelete();
    rmSync(path.join(stateDir, "patch_fail"));
    expect(run("teardown", { ...APPROVED, CONFIRM_DELETE: CLONE }).code).toBe(0);
  });
  it("no phase other than teardown ever calls instances delete, whatever fails", () => {
    for (const fl of ["clone_fail", "rot_fail", "label_fail", "extra_user", "ssl_weak", "open_net", "bad_conn", "patch_fail"]) {
      reset(); flag(fl);
      run("create", APPROVED); run("harden", APPROVED); run("mark", APPROVED); run("resize", APPROVED); run("netcheck", { RUN: "1" }); run("status", { RUN: "1" });
      noDelete();
    }
  });
  it("teardown keeps requiring the exact confirmation, the exact identity and approval, even after a failure", () => {
    createdClone();
    expect(run("teardown", { RUN: "1", CONFIRM_DELETE: CLONE }).code).toBe(3);                         // no approval
    expect(run("teardown", { ...APPROVED, CONFIRM_DELETE: CLONE.toUpperCase() }).code).toBe(3);        // wrong confirmation
    expect(run("teardown", { ...APPROVED }).code).toBe(3);                                             // none
    flag("bad_conn");
    const r = run("teardown", { ...APPROVED, CONFIRM_DELETE: CLONE });
    expect(r.code).toBe(2); expect(r.out).toContain("identity check failed");
    expect(existsSync(DIR)).toBe(true);
    noDelete();
  });
  it("teardown goes on when deletion protection cannot be cleared (the delete itself reports), and keeps the secrets if the delete fails", () => {
    createdClone(); flag("dp_fail"); flag("delete_fail");
    const r = run("teardown", { ...APPROVED, CONFIRM_DELETE: CLONE });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("could not clear deletion protection");
    expect(existsSync(path.join(DIR, "netcheck_ok"))).toBe(true);        // secrets kept: the operator can retry
    rmSync(path.join(stateDir, "delete_fail"));
    const ok = run("teardown", { ...APPROVED, CONFIRM_DELETE: CLONE });
    expect(ok.code).toBe(0); expect(existsSync(DIR)).toBe(false);
  });
  it("teardown of a clone that no longer exists destroys only the local secrets and calls neither patch nor delete", () => {
    mkdirSync(DIR, { recursive: true, mode: 0o700 }); writeFileSync(path.join(DIR, "pw_postgres"), "secret");
    const r = run("teardown", { ...APPROVED, CONFIRM_DELETE: CLONE });
    expect(r.code).toBe(0);
    expect(r.out).toContain("only the local secrets will be destroyed");
    expect(callLog()).not.toMatch(/instances (patch|delete)/);
    expect(existsSync(DIR)).toBe(false);
  });
  it("teardown cannot verify the deletion or list the instances: it stops and KEEPS the local secrets (never guesses the clone is gone)", () => {
    createdClone(); flag("list_fail");
    const r = run("teardown", { ...APPROVED, CONFIRM_DELETE: CLONE });
    expect(r.code).not.toBe(0);
    expect(existsSync(DIR)).toBe(true);
    noDelete();
  });
});
