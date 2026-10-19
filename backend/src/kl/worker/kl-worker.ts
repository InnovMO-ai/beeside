import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { withServiceAttestation } from "../db/attested-tx";
import { workerPools, WorkerKlPools } from "../db/pools";
import { KlConfigError, workerKlConfig } from "../config/env";
import { ObjectStore, objectStoreFromEnv } from "../ingest/object-store";
import { BrowserLike, launchChromium } from "../products/render/pdf";
import { renderEditionJob } from "../products/render/render-edition";

/**
 * Punto de entrada de `kl-worker` (CR-KL-002 B6): Cloud Run Job con su propia cuenta de servicio, misma imagen. Procesa la
 * cola `kl.job` (SKIP LOCKED) y termina. En R1 los agentes están APAGADOS: no hay manejador de recolección, de
 * conocimiento ni de render, y el worker no tiene cliente HTTP ni credenciales de `beeside`. Los jobs de agentes quedan en
 * cola. Solo existen dos manejadores deterministas y sin red: `noop` (salud) y `schedule_tick` (vencimiento de versiones).
 */
export interface ClaimedJob {
  job_id: string;
  kind: string;
  payload: Record<string, unknown>;
  lease_token: string;
  attempts: number;
}

export type JobHandler = (job: ClaimedJob, pools: WorkerKlPools) => Promise<void>;

/**
 * Render de ediciones y vistas previas en el worker (B6, DD-10): Chromium sin red, una vez por edición e idioma. Solo se registra si
 * KL_RENDER_ENABLED=true; el navegador se abre una vez y se reutiliza en el ciclo; la tipografía la fija el manifiesto de cada edición.
 */
export interface RenderRuntime {
  handlers: Record<string, JobHandler>;
  close(): Promise<void>;
}

export function createRenderRuntime(pools: WorkerKlPools, store: ObjectStore, env: NodeJS.ProcessEnv = process.env): RenderRuntime {
  let browser: BrowserLike | null = null;
  const deps = async () => {
    browser ??= await launchChromium({ env });
    return { knowledge: pools.knowledge, store, browser };
  };
  const handler = (kind: "final" | "preview"): JobHandler => async (job) => {
    await renderEditionJob(await deps(), String(job.payload.edition_id), kind);
  };
  return {
    handlers: { render_edition: handler("final"), render_preview: handler("preview") },
    close: async () => void (await browser?.close().catch(() => undefined)),
  };
}

export interface MaintenanceResult {
  planner: Record<string, number>;
  triage: Record<string, number>;
  validations: Record<string, number>;
  expiredVersions: number;
}

/**
 * Mantenimiento determinista de R2, sin red ni IA: (1) planificador por calendario (`kl.plan_due`: encola jobs `collect`
 * para fuentes y productos vencidos; los agentes siguen apagados, así que esos jobs esperan en cola), (2) aviso y vencimiento
 * de validaciones especializadas, (3) versiones publicadas con `valid_to` vencido. Todo en una transacción certificada.
 */
export async function runMaintenance(pools: WorkerKlPools): Promise<MaintenanceResult> {
  return withServiceAttestation(pools.knowledge, async (tx) => {
    const planner = (await tx.query<{ r: Record<string, number> }>("SELECT kl.plan_due() AS r")).rows[0]?.r ?? {};
    const triage = (await tx.query<{ r: Record<string, number> }>("SELECT kl.triage_stale_jobs() AS r")).rows[0]?.r ?? {};
    const validations = (await tx.query<{ r: Record<string, number> }>("SELECT kl.expire_validations() AS r")).rows[0]?.r ?? {};
    const expired = (await tx.query<{ n: number }>("SELECT kl.expire_due_versions() AS n")).rows[0]?.n ?? 0;
    return { planner, triage, validations, expiredVersions: Number(expired) };
  });
}

export const DEFAULT_HANDLERS: Record<string, JobHandler> = {
  noop: async () => undefined,
  schedule_tick: async (_job, pools) => {
    await runMaintenance(pools);
  },
};

/** Tipos de job de agentes: sin manejador mientras los agentes estén apagados (R1). */
export const AGENT_KINDS = ["collect", "review_now", "compile_package", "extraordinary_edition", "render_edition"] as const;

export interface CycleResult {
  claimed: number;
  succeeded: number;
  failed: number;
  maintenance?: MaintenanceResult;
}

const KIND_POOL: Record<string, "agent" | "knowledge"> = { noop: "knowledge", schedule_tick: "knowledge" };

export async function runCycle(pools: WorkerKlPools, handlers: Record<string, JobHandler> = DEFAULT_HANDLERS, options: { limit?: number; leaseSeconds?: number; maintenance?: boolean } = {}): Promise<CycleResult> {
  const result: CycleResult = { claimed: 0, succeeded: 0, failed: 0 };
  if (options.maintenance !== false) result.maintenance = await runMaintenance(pools);
  for (const poolName of ["agent", "knowledge"] as const) {
    const pool: Pool = pools[poolName];
    const kinds = Object.keys(handlers).filter((k) => (KIND_POOL[k] ?? "knowledge") === poolName);
    if (kinds.length === 0) continue; // nada que reclamar con este rol: los agentes siguen apagados
    const jobs = await withServiceAttestation(pool, async (tx) => (await tx.query<ClaimedJob>("SELECT job_id, kind, payload, lease_token, attempts FROM kl.claim_jobs($1, $2, $3)", [kinds, options.limit ?? 5, options.leaseSeconds ?? 300])).rows);
    for (const job of jobs) {
      result.claimed += 1;
      let outcome: "succeeded" | "failed" = "succeeded";
      try {
        await (handlers[job.kind] as JobHandler)(job, pools);
      } catch {
        outcome = "failed";
      }
      await withServiceAttestation(pool, (tx) => tx.query("SELECT kl.complete_job($1, $2, $3, $4)", [job.job_id, job.lease_token, outcome, outcome === "failed" ? "handler_error" : null]), randomUUID());
      result[outcome] += 1;
    }
  }
  return result;
}

/* istanbul ignore next -- entrada del Cloud Run Job */
if (require.main === module) {
  void (async () => {
    try {
      const config = workerKlConfig(process.env);
      const pools = workerPools(config);
      let runtime: RenderRuntime | null = null;
      try {
        if (process.env.KL_RENDER_ENABLED === "true") {
          // Almacén por entorno: Cloud Storage con KL_STORE_BUCKET (producción, B9); sin él, el almacén local solo de desarrollo (en producción se niega).
          const { store, kind } = objectStoreFromEnv(process.env);
          process.stdout.write(`${JSON.stringify({ level: "info", message: "kl-worker object store", kind })}\n`);
          runtime = createRenderRuntime(pools, store);
        }
        const r = await runCycle(pools, runtime ? { ...DEFAULT_HANDLERS, ...runtime.handlers } : DEFAULT_HANDLERS);
        process.stdout.write(`${JSON.stringify({ level: "info", message: "kl-worker cycle", ...r })}\n`);
      } finally {
        await runtime?.close();
        await pools.close();
      }
    } catch (error) {
      process.stderr.write(`${error instanceof KlConfigError ? error.message : String(error)}\n`);
      process.exit(1);
    }
  })();
}
