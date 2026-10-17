import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The ESTABILIZACIÓN deployment script is exercised ONLY in DRY_RUN with a `gcloud`/`curl` stub that records any real call: the script must print what it would do
 * and never reach GCP. The assertions pin the exposure/authentication/least-privilege design (REPO ROOT script, never executed against GCP in this block).
 */
const ROOT = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(ROOT, "infra/deploy/precision-stabilization.sh");
const stubDir = mkdtempSync(path.join(tmpdir(), "stub-"));
const marker = path.join(stubDir, "REAL_CALL");
for (const bin of ["gcloud", "curl"]) { writeFileSync(path.join(stubDir, bin), `#!/bin/sh\necho "$0 $*" >> "${marker}"\nexit 99\n`); chmodSync(path.join(stubDir, bin), 0o755); }

function run(phase: string, env: Record<string, string> = {}): { code: number | null; out: string } {
  const r = spawnSync("bash", [SCRIPT, phase], { cwd: ROOT, encoding: "utf8", env: { PATH: `${stubDir}:${process.env.PATH}`, HOME: stubDir, DRY_RUN: "1", TAG: "t1", BASH_COMPAT: "32", ...env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const APPROVED = { APPROVAL: "STABILIZATION_DEPLOYMENT_APPROVAL" };

describe("precision-stabilization.sh (dry run)", () => {
  afterAll(() => { expect(existsSync(marker)).toBe(false); }); // nothing above reached a real gcloud/curl

  it("targets the confirmed project, instance, database and region by default", () => {
    const { out } = run("deploy", APPROVED);
    expect(out).toContain("--project beeside-discovery-prod");
    expect(out).toContain("beeside-discovery-prod:northamerica-south1:discovery-db");
    expect(out).toContain("northamerica-south1-docker.pkg.dev/beeside-discovery-prod/precision/");
  });
  it("refuses any other project unless explicitly overridden for a rehearsal", () => {
    expect(run("check", { PROJECT: "some-other-project" })).toMatchObject({ code: 2 });
    expect(run("check", { PROJECT: "some-other-project", ALLOW_OTHER_PROJECT: "1" }).code).toBe(0);
  });
  it.each(["identities", "backup", "migrate", "prepare", "seed", "deploy", "admin", "baseline"])("%s refuses to run without the written approval", (phase) => {
    const r = run(phase, { SEED_BUCKET: "b", ADMIN_OIDC_CLIENT_ID: "x", ADMIN_BOOTSTRAP_EMAIL: "a@beeside.you" });
    expect(r.code).toBe(3);
    expect(r.out).toContain("REFUSED");
  });

  it("backend: no public access, invoker is the web identity only, runtime identity is its own, no migration credential, explicit pool limits", () => {
    const { code, out } = run("deploy", APPROVED);
    expect(code).toBe(0);
    expect(out).not.toMatch(/allUsers|allAuthenticatedUsers/);
    expect(out).not.toMatch(/(?<!no-)allow-unauthenticated/);
    expect(out).not.toContain("--no-invoker-iam-check");
    const backend = out.split("\n").filter((l) => /run deploy precision-backend|set-secrets "DATABASE_URL/.test(l)).join("\n");
    expect(backend).toContain("--service-account precision-backend@beeside-discovery-prod.iam.gserviceaccount.com");
    expect(backend).not.toMatch(/migration-database-url|MIGRATION_DATABASE_URL/);
    expect(out).toMatch(/DB_POOL_MAX=3,PRECISION_DB_POOL_MAX=8,DB_APPLICATION_NAME=precision-backend/);
    expect(out).toMatch(/--max-instances 2 --memory 512Mi/);
    expect(out).toMatch(/run services add-iam-policy-binding precision-backend .*--member serviceAccount:precision-web@beeside-discovery-prod\.iam\.gserviceaccount\.com --role roles\/run\.invoker/);
    expect(out).not.toMatch(/add-iam-policy-binding precision-backend .*--member serviceAccount:precision-backend@/);
  });
  it("web: its own identity, no secrets, no database attachment, gated by IAP for the organization only", () => {
    const out = run("deploy", APPROVED).out;
    const web = out.split("\n").find((l) => /run deploy precision-web /.test(l))!;
    expect(web).toContain("--service-account precision-web@");
    expect(web).not.toMatch(/--set-secrets|--add-cloudsql-instances/);
    expect(out).toContain("--iap");
    expect(out).toContain("--member domain:beeside.you --role roles/iap.httpsResourceAccessor");
  });
  it("identities: per-secret accessors (no project-wide secret role), SQL client limited to the one instance, web identity gets no secret or database role", () => {
    const { code, out } = run("identities", APPROVED);
    expect(code).toBe(0);
    expect(out).not.toMatch(/roles\/secretmanager\.secretAccessor.*--condition=None/);
    expect(out).not.toMatch(/projects add-iam-policy-binding .*roles\/secretmanager/);
    expect(out).toMatch(/secrets add-iam-policy-binding precision-hash-secret --member serviceAccount:precision-backend@/);
    expect(out).toMatch(/secrets add-iam-policy-binding beeside-migration-database-url --member serviceAccount:precision-migrate@/);
    expect(out).not.toMatch(/--member serviceAccount:precision-web@.*(secretmanager|cloudsql)/);
    expect(out).toContain('resource.name == \\"projects/beeside-discovery-prod/instances/discovery-db\\"'.replace(/\\"/g, '"'));
    expect(out).not.toMatch(/precision-backend@.*beeside-migration-database-url|beeside-migration-database-url.*precision-backend@/);
  });
  it("migrations and prepare run as the migration identity against the canonical database, never the backend identity", () => {
    const mig = run("migrate", APPROVED).out;
    expect(mig).toMatch(/run jobs deploy precision-migrate .*--set-secrets MIGRATION_DATABASE_URL=beeside-migration-database-url:latest.*--service-account precision-migrate@/);
    const prep = run("prepare", APPROVED).out;
    expect(prep).toContain("DISCOVERY_RUNTIME_LOGIN=beeside_discovery_runtime,PRECISION_RUNTIME_LOGIN=beeside_runtime");
    expect(prep).toMatch(/--service-account precision-migrate@/);
    expect(prep).not.toMatch(/runtime-role-prepare/);
  });
  it("admin: Control Center secrets are bound to the backend identity only; the route is /admin", () => {
    const out = run("admin", { ...APPROVED, ADMIN_OIDC_CLIENT_ID: "cid", ADMIN_BOOTSTRAP_EMAIL: "a@beeside.you" }).out;
    expect(out).toMatch(/secrets add-iam-policy-binding precision-admin-oidc-client-secret --member serviceAccount:precision-backend@/);
    expect(out).toContain("/admin (IAP + Google sign-in");
  });
  it("never prints a secret value", () => {
    for (const phase of ["identities", "deploy", "admin"]) {
      const out = run(phase, { ...APPROVED, ADMIN_OIDC_CLIENT_ID: "cid", ADMIN_BOOTSTRAP_EMAIL: "a@beeside.you" }).out;
      expect(out).not.toMatch(/postgres:\/\/[^\s]*:[^\s@]+@/);
      expect(out).not.toMatch(/[0-9a-f]{48,}/);
    }
  });
});
