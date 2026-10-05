import { spawnSync } from "node:child_process";
import path from "node:path";
import { Client } from "pg";

/** Fresh state for every run: real Drizzle migrations, the catalog seed, and no leftover projects. Refuses to run without an explicit disposable database. */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL is required (an empty, disposable PostgreSQL database)");
  if (/cloudsql|googleapis|beeside-dev|prod/i.test(url)) throw new Error("refusing to run end-to-end tests against a non-disposable database");
  const backend = path.resolve(process.cwd(), "../backend");
  const run = (args: string[]) => {
    const r = spawnSync("npx", args, { cwd: backend, env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
    if (r.status !== 0) throw new Error(`failed: npx ${args.join(" ")}`);
  };
  // Append-only tables cannot be truncated (by design), so a fresh state means a fresh schema of this disposable database.
  const reset = new Client({ connectionString: url });
  await reset.connect();
  await reset.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await reset.end();
  run(["drizzle-kit", "migrate"]);
  run(["tsx", "src/scripts/seed-fa4-catalog.ts"]);
}
