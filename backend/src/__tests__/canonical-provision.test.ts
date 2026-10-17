import { buildPlan, defaultConfig, legacyHardeningSteps, renderStep, scramSha256, validateConfig, type ProvisionState } from "../db/canonical-provision";

const state = (over: Partial<ProvisionState> = {}): ProvisionState => ({
  admin: { name: "postgres", superuser: false, createrole: true, createdb: true },
  adminOn: { beeside_runtime_role: false, beeside_discovery_rw: true },
  rolesExisting: ["beeside_runtime_role"],
  databaseExists: false,
  sourceDatabase: { exists: true, encoding: "UTF8", collate: "en_US.UTF8", ctype: "en_US.UTF8", provider: "c" },
  ...over,
});

describe("canonical database provisioning plan", () => {
  const cfg = defaultConfig({} as NodeJS.ProcessEnv);

  it("defaults to the confirmed target: database beeside, three new differentiated logins", () => {
    expect(cfg).toMatchObject({ database: "beeside", sourceDatabase: "discovery", migrator: "beeside_migrate", discoveryLogin: "beeside_discovery_runtime", precisionLogin: "beeside_runtime" });
  });
  it.each([
    [{ database: "discovery" }, /differ/],
    [{ database: "postgres" }, /system database/],
    [{ migrator: "discovery_migrate" }, /acceptable login/],
    [{ discoveryLogin: "beeside_runtime_role" }, /acceptable login/],
    [{ precisionLogin: "beeside_migrate" }, /three different/],
    [{ migrator: "Bad-Name" }, /acceptable login/],
    [{ database: "x; drop" }, /acceptable database/],
  ])("rejects unsafe configuration %j", (over, re) => { expect(() => validateConfig({ ...cfg, ...over })).toThrow(re); });

  it("PRE: creates the missing groups, the migrator and the Discovery login; never the Precision login (migration 0014 would try to grant it)", () => {
    const ids = buildPlan(cfg, state(), "pre").steps.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["group:beeside_discovery_rw", "group:beeside_analytics_reader", "login:beeside_migrate", "login:beeside_discovery_runtime", "db:create"]));
    expect(ids).not.toContain("group:beeside_runtime_role"); // exists already (legacy): left untouched
    expect(ids).not.toContain("login:beeside_runtime");
  });
  it("PRE: database privileges are changed only AS the owner, after the temporary membership and before leaving it", () => {
    const steps = buildPlan(cfg, state(), "pre").steps;
    const idx = (id: string): number => steps.findIndex((s) => s.id === id);
    expect(idx("owner:join")).toBeLessThan(idx("db:create"));
    expect(idx("db:create")).toBeLessThan(idx("db:revoke-public"));
    expect(idx("db:revoke-public")).toBeLessThan(idx("owner:leave"));
    for (const s of steps.filter((x) => /^db:(revoke-public|connect|no-connect)/.test(x.id))) expect(s.asRole).toBe("beeside_migrate");
    expect(steps.find((s) => s.id === "owner:join")!.sql).toContain("WITH SET TRUE, INHERIT FALSE");
  });
  it("PRE: copies encoding and collation from the legacy database and revokes PUBLIC", () => {
    const create = buildPlan(cfg, state(), "pre").steps.find((s) => s.id === "db:create")!;
    expect(create.sql).toContain("OWNER \"beeside_migrate\" TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'en_US.UTF8' LC_CTYPE 'en_US.UTF8'");
    expect(buildPlan(cfg, state(), "pre").steps.find((s) => s.id === "db:revoke-public")!.sql).toBe('REVOKE ALL ON DATABASE "beeside" FROM PUBLIC');
  });
  it("PRE: the migrator is never granted membership in a runtime group (privacy-erasure bypass depends on it)", () => {
    for (const phase of ["pre", "post"] as const) {
      for (const s of buildPlan(cfg, state(), phase).steps) expect(s.sql).not.toMatch(/GRANT "?beeside_(runtime_role|discovery_rw)"? TO "?beeside_migrate/);
    }
  });
  it("PRE: an existing login is only altered with attributes a managed admin may change", () => {
    const sql = buildPlan(cfg, state({ rolesExisting: ["beeside_runtime_role", "beeside_migrate"] }), "pre").steps.find((s) => s.id === "login:beeside_migrate")!.sql;
    expect(sql).toMatch(/^ALTER ROLE "beeside_migrate" LOGIN NOCREATEDB NOCREATEROLE PASSWORD/);
    expect(sql).not.toMatch(/SUPERUSER|REPLICATION|BYPASSRLS/);
  });
  it("PRE: blocks when the admin cannot create roles and databases, or the source database is missing", () => {
    expect(buildPlan(cfg, state({ admin: { name: "x", superuser: false, createrole: false, createdb: true } }), "pre").blockers.join()).toMatch(/CREATEROLE and CREATEDB/);
    expect(buildPlan(cfg, state({ sourceDatabase: { exists: false } }), "pre").blockers.join()).toMatch(/source database/);
  });
  it("POST: needs the legacy group owner for the one grant into beeside_runtime_role when the admin has no ADMIN OPTION", () => {
    const steps = buildPlan(cfg, state({ databaseExists: true }), "post").steps;
    expect(steps.find((s) => s.id === "member:beeside_runtime_role")!.via).toBe("legacy");
    expect(steps.find((s) => s.id === "member:beeside_discovery_rw")!.via).toBe("admin");
    expect(steps.find((s) => s.id === "login:beeside_runtime")!.sql).toMatch(/^CREATE ROLE/);
  });
  it("POST: a missing database is a blocker", () => { expect(buildPlan(cfg, state(), "post").blockers.join()).toMatch(/does not exist/); });

  it("never deletes anything and never touches a legacy login except to REVOKE its access to the NEW database", () => {
    for (const phase of ["pre", "post"] as const) {
      for (const s of buildPlan(cfg, state({ databaseExists: phase === "post" }), phase).steps) {
        expect(s.sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/i);
        if (/"discovery_(runtime|migrate)"/.test(s.sql)) expect(s.sql).toMatch(/^REVOKE ALL ON DATABASE "beeside" FROM/);
      }
    }
  });

  it("passwords appear only as tokens in the plan, and are sent as SCRAM verifiers", () => {
    const login = buildPlan(cfg, state(), "pre").steps.find((s) => s.id === "login:beeside_migrate")!;
    expect(login.sql).toContain("{{PW:migrate}}");
    const clear = "correct-horse-battery-staple-0123456789";
    const sql = renderStep(login, { migrate: clear });
    expect(sql).not.toContain(clear);
    expect(sql).toMatch(/PASSWORD 'SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+'/);
  });
  it("refuses a missing or short password", () => {
    const login = buildPlan(cfg, state(), "pre").steps.find((s) => s.id === "login:beeside_migrate")!;
    expect(() => renderStep(login, {})).toThrow(/missing or shorter/);
    expect(() => renderStep(login, { migrate: "short" })).toThrow(/missing or shorter/);
  });
  it("scram verifier matches a known PostgreSQL vector shape and is salted", () => {
    const a = scramSha256("pw-pw-pw-pw-pw-pw-pw-pw-1"); const b = scramSha256("pw-pw-pw-pw-pw-pw-pw-pw-1");
    expect(a).not.toBe(b);
    expect(scramSha256("x", Buffer.from("0123456789abcdef"), 4096)).toBe(scramSha256("x", Buffer.from("0123456789abcdef"), 4096));
  });
  it("legacy hardening goes through the legacy owner connection and is reversible", () => {
    const h = legacyHardeningSteps(cfg, ["discovery_runtime"]);
    expect(h.every((s) => s.via === "legacy")).toBe(true);
    expect(h[0]!.description).toContain("rollback");
  });
});
