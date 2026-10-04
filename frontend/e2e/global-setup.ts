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
  run(["drizzle-kit", "migrate"]);
  run(["tsx", "src/scripts/seed-fa4-catalog.ts"]);
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("TRUNCATE fa4_continuation_request, fa4_demand_signal, fa4_email_delivery, fa4_result, fa4_access_token, fa4_project CASCADE");
  await client.end();
}
