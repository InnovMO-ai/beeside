import { baseDepsFromEnv } from "./index";
import { integrationsFromEnv } from "./integrations/config";
import { JobName, runJob } from "./operations/jobs";
import { jsonLogger } from "./security/redact";
import { assertRuntimeConfig } from "./security/runtime-config";

/**
 * Background job runner (system operations — no HTTP surface, no customer or admin credentials).
 * Runs each lifecycle job on its own interval; overlapping or concurrent runners are safe because
 * every job holds a single RUNNING slot and locks its rows with SKIP LOCKED. Intended to run as its
 * own process (e.g. a scheduled job or a worker service); the deployment wiring is not part of this
 * build (deployment pipeline is recorded debt).
 */
const DEFAULT_INTERVALS: Record<JobName, number> = {
  email_outbox: 30,
  access_lifecycle: 15 * 60,
  temporary_retention: 60 * 60,
  integration_outbox: 60,
  security_housekeeping: 60 * 60,
};

function intervalFor(job: JobName, env: NodeJS.ProcessEnv): number {
  const raw = Number(env[`WORKER_${job.toUpperCase()}_SECONDS`]);
  return Number.isFinite(raw) && raw >= 10 ? raw : DEFAULT_INTERVALS[job];
}

/* istanbul ignore next -- process entry point */
if (require.main === module) {
  assertRuntimeConfig(process.env, (level, message) => jsonLogger(level, message));
  const deps = { ...baseDepsFromEnv(process.env), emailDispatch: "none" as const, integrations: integrationsFromEnv(process.env, jsonLogger) };
  const running = new Set<JobName>();
  const timers: NodeJS.Timeout[] = [];
  const tick = async (job: JobName) => {
    if (running.has(job)) return;
    running.add(job);
    try {
      const result = await runJob(deps, job, { trigger: "worker" });
      // eslint-disable-next-line no-console
      console.log(`[worker] ${job} ${result.status}${result.status === "SUCCEEDED" ? ` ${JSON.stringify(result.stats)}` : ""}`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[worker] ${job} crashed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running.delete(job);
    }
  };
  for (const job of Object.keys(DEFAULT_INTERVALS) as JobName[]) {
    void tick(job);
    timers.push(setInterval(() => void tick(job), intervalFor(job, process.env) * 1000));
  }
  const stop = () => {
    timers.forEach(clearInterval);
    // eslint-disable-next-line no-console
    console.log("[worker] stopping after in-flight jobs");
    const wait = setInterval(() => {
      if (running.size === 0) {
        clearInterval(wait);
        process.exit(0);
      }
    }, 250);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
