import { baseDepsFromEnv } from "../index";
import { isJobName, runJob } from "../operations/jobs";

/**
 * One-shot job execution (for a scheduler or an operator):
 *   npm run jobs:run --workspace=backend -- --job email_outbox|access_lifecycle|temporary_retention
 * The retention purge deletes client data of expired free assessments, so it additionally requires
 * --confirm-retention-purge.
 */
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const job = arg("job");
  if (!isJobName(job)) throw new Error("--job must be email_outbox, access_lifecycle or temporary_retention");
  if (job === "temporary_retention" && !process.argv.includes("--confirm-retention-purge")) {
    throw new Error("refusing to run the retention purge without --confirm-retention-purge");
  }
  const deps = { ...baseDepsFromEnv(process.env), emailDispatch: "none" as const };
  const result = await runJob(deps, job, { trigger: "cli" });
  console.log(`job ${job}: ${JSON.stringify(result)}`);
  if (result.status === "FAILED") process.exitCode = 1;
  process.exit();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
