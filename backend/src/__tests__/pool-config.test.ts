import { connectionBudget, corePoolConfig, POOL_DEFAULTS, precisionPoolConfig } from "../db/pool-config";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("explicit pool limits", () => {
  it("has small, finite defaults with a bounded wait for a free connection", () => {
    const core = corePoolConfig({ DATABASE_URL: "postgres://x" } as NodeJS.ProcessEnv);
    expect(core.max).toBe(POOL_DEFAULTS.core);
    expect(core.connectionTimeoutMillis).toBeGreaterThan(0);   // pg's own default is 0 = wait forever
    expect(core.idleTimeoutMillis).toBe(10_000);
    expect(precisionPoolConfig({ DATABASE_URL: "postgres://x" } as NodeJS.ProcessEnv).max).toBe(POOL_DEFAULTS.precision);
  });
  it("reads overrides and labels the connections of a service", () => {
    const env = { DATABASE_URL: "postgres://x", DB_POOL_MAX: "3", PRECISION_DB_POOL_MAX: "6", DB_APPLICATION_NAME: " discovery-worker " } as NodeJS.ProcessEnv;
    expect(corePoolConfig(env)).toMatchObject({ max: 3, application_name: "discovery-worker" });
    expect(precisionPoolConfig(env).max).toBe(6);
  });
  it("fails closed on invalid values instead of falling back", () => {
    for (const bad of ["0", "-1", "2.5", "abc", "31"]) expect(() => corePoolConfig({ DB_POOL_MAX: bad } as NodeJS.ProcessEnv)).toThrow(/DB_POOL_MAX/);
    expect(() => precisionPoolConfig({ PRECISION_DB_POOL_MAX: "1" } as NodeJS.ProcessEnv)).toThrow(/PRECISION_DB_POOL_MAX/);   // floor 2: advisory-lock connection + queries
    expect(() => corePoolConfig({ DB_POOL_CONNECT_TIMEOUT_MS: "0" } as NodeJS.ProcessEnv)).toThrow(/CONNECT_TIMEOUT/);
  });
  it("never puts the connection string or a secret into the application label", () => {
    expect(corePoolConfig({ DATABASE_URL: "postgres://u:p@h/db", DB_APPLICATION_NAME: "a".repeat(100) } as NodeJS.ProcessEnv).application_name).toHaveLength(63);
  });
});

describe("connection budget", () => {
  it("flags the pre-ESTABILIZACIÓN defaults (10 per pool) as over budget on a 100-connection instance", () => {
    const r = connectionBudget({ maxConnections: 100, reserved: 7, other: 10, services: [
      { name: "discovery-backend", maxInstances: 5, poolMax: 10 }, { name: "discovery-worker", maxInstances: 2, poolMax: 10 }, { name: "precision-backend", maxInstances: 2, poolMax: 20 }] });
    expect(r.worstCase).toBe(120);
    expect(r.ok).toBe(false);
  });
  it("accepts the committed plan (infra/db/connection-plan.json) and keeps headroom for overlapping revisions", () => {
    const plan = JSON.parse(readFileSync(path.resolve(__dirname, "../../../infra/db/connection-plan.json"), "utf8"));
    const r = connectionBudget(plan);
    expect(r.worstCase).toBe(5 * 4 + 2 * 3 + 2 * (3 + 8) + 10);
    expect(r.ok).toBe(true);
    expect(r.ratio).toBeLessThanOrEqual(0.7);
  });
  it("rejects nonsense input", () => {
    expect(() => connectionBudget({ maxConnections: 0, reserved: 0, other: 0, services: [] })).toThrow();
    expect(() => connectionBudget({ maxConnections: 100, reserved: 0, other: 0, services: [{ name: "x", maxInstances: 1, poolMax: 0 }] })).toThrow();
  });
});
