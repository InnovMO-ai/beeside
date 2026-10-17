import * as path from "node:path";
import { MigrationError, runMigrations } from "./runner";

/**
 * Punto de entrada de `kl-migrate` (Cloud Run Job). Solo conoce KL_DB_URL_OWNER: se niega a arrancar si
 * encuentra credenciales de otra plataforma (CR-KL-002 Handoff §3).
 */
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const forbidden = ["DATABASE_URL", "KL_DB_URL_APP", "KL_DB_URL_READER", "KL_DB_URL_AGENT", "KL_DB_URL_KNOWLEDGE"].filter((k) => env[k]);
  if (forbidden.length > 0) throw new Error(`kl-migrate se niega a arrancar: variables que no le corresponden (${forbidden.join(", ")})`);
  const url = env.KL_DB_URL_OWNER;
  if (!url) throw new Error("kl-migrate requiere KL_DB_URL_OWNER");
  const dryRun = process.argv.includes("--dry-run");
  const foreignMigrationsDir = env.KL_LINT_FOREIGN_MIGRATIONS ?? path.resolve(__dirname, "../../../db/migrations");
  const result = await runMigrations({ connectionString: url, dryRun, foreignMigrationsDir });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

/* istanbul ignore next */
if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof MigrationError ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
