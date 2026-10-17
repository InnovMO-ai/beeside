import type { PoolConfig } from "pg";

/**
 * Explicit connection-pool limits (ESTABILIZACIÓN, shared canonical database).
 *
 * node-postgres opens up to 10 connections per pool when nothing is configured and waits forever for a free one. On the single Cloud SQL
 * instance that Discovery and Precision share (max_connections is fixed by the instance's memory), every Cloud Run instance of every service
 * draws from the same budget, so each process must have a small, explicit ceiling that is written down and checked (see connectionBudget and
 * infra/db/connection-plan.json).
 *
 *   DB_POOL_MAX                  core pool (Discovery backend, worker, any process that is not Precision-only)   default 5,  1..30
 *   PRECISION_DB_POOL_MAX        Precision pool                                                                  default 8,  2..30
 *   DB_POOL_IDLE_TIMEOUT_MS      release an idle connection after                                                default 10000
 *   DB_POOL_CONNECT_TIMEOUT_MS   fail a request instead of waiting forever for a connection                      default 10000
 *   DB_APPLICATION_NAME          label shown in pg_stat_activity (which service holds which connections)
 *
 * The Precision floor is 2: a conversation turn holds one dedicated connection for its per-project advisory lock while the turn's own queries
 * need another one. An invalid value stops the process at start-up (fail closed) instead of silently falling back.
 */
export const POOL_DEFAULTS = { core: 5, precision: 8, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 } as const;

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer between ${min} and ${max} (got "${raw}")`);
  return n;
}

function common(env: NodeJS.ProcessEnv): Pick<PoolConfig, "idleTimeoutMillis" | "connectionTimeoutMillis"> & { application_name?: string } {
  const application = env.DB_APPLICATION_NAME?.trim();
  return {
    idleTimeoutMillis: intEnv(env, "DB_POOL_IDLE_TIMEOUT_MS", POOL_DEFAULTS.idleTimeoutMillis, 1_000, 600_000),
    connectionTimeoutMillis: intEnv(env, "DB_POOL_CONNECT_TIMEOUT_MS", POOL_DEFAULTS.connectionTimeoutMillis, 1_000, 60_000),
    ...(application ? { application_name: application.slice(0, 63) } : {}),
  };
}

export function corePoolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  return { connectionString: env.DATABASE_URL, max: intEnv(env, "DB_POOL_MAX", POOL_DEFAULTS.core, 1, 30), ...common(env) };
}

export function precisionPoolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  return { connectionString: env.DATABASE_URL, max: intEnv(env, "PRECISION_DB_POOL_MAX", POOL_DEFAULTS.precision, 2, 30), ...common(env) };
}

/** One deployed service: how many instances Cloud Run may start and the largest pool each instance may hold. */
export interface BudgetService { name: string; maxInstances: number; poolMax: number }
export interface BudgetInput {
  /** `SHOW max_connections` on the instance (measure it again after any resize: it depends on the instance memory). */
  maxConnections: number;
  /** superuser_reserved_connections plus the connections Cloud SQL itself keeps (conservative). */
  reserved: number;
  /** Jobs and humans that connect on top of the services (migrate, prepare, seed, psql through the proxy). */
  other: number;
  services: BudgetService[];
  /** Fraction of the usable connections the worst case may use. Default 0.7: the rest is headroom for rollouts (old and new revisions overlap). */
  ceiling?: number;
}
export interface BudgetResult { usable: number; worstCase: number; ratio: number; ceiling: number; ok: boolean; perService: Array<BudgetService & { connections: number }> }

export function connectionBudget(input: BudgetInput): BudgetResult {
  const ceiling = input.ceiling ?? 0.7;
  if (!(input.maxConnections > 0) || input.reserved < 0 || input.other < 0 || !(ceiling > 0 && ceiling <= 1)) throw new Error("invalid connection budget input");
  const perService = input.services.map((s) => {
    if (!Number.isInteger(s.maxInstances) || s.maxInstances < 0 || !Number.isInteger(s.poolMax) || s.poolMax < 1) throw new Error(`invalid service entry: ${s.name}`);
    return { ...s, connections: s.maxInstances * s.poolMax };
  });
  const usable = input.maxConnections - input.reserved;
  const worstCase = perService.reduce((sum, s) => sum + s.connections, 0) + input.other;
  const ratio = usable > 0 ? worstCase / usable : Infinity;
  return { usable, worstCase, ratio, ceiling, ok: ratio <= ceiling, perService };
}
