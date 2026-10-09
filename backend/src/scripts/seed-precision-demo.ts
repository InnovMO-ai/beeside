/* eslint-disable no-console */
import { Pool } from "pg";
import { createPoolDb } from "../db/database";
import { seedDemoProject, type DemoStage } from "../precision/domain/seed/demo-project";

// Usage (development / demo databases only):
//   DATABASE_URL=... CONFIG_BOOTSTRAP_ENV=development npm run precision:seed-demo -- [--stage=start|map_confirmed|logistics_ready] [--reset] [--no-link]
// Seeds the synthetic "Northwind Foods Ltd" project (see docs/f5/demo-route.md). Idempotent: running it again reuses the
// project. --reset creates a new Northwind project. The one-time access code is printed once, to this terminal only.
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const args = process.argv.slice(2);
  const stageArg = args.find((a) => a.startsWith("--stage="))?.slice("--stage=".length) ?? "start";
  if (!["start", "map_confirmed", "logistics_ready"].includes(stageArg)) throw new Error("--stage must be start, map_confirmed or logistics_ready");
  const pool = new Pool({ connectionString: url });
  try {
    const result = await seedDemoProject(createPoolDb(pool), {
      stage: stageArg as DemoStage,
      reset: args.includes("--reset"),
      mintLink: !args.includes("--no-link"),
      bootstrapFaConfig: process.env.CONFIG_BOOTSTRAP_ENV === "development",
    });
    const { linkToken, ...rest } = result;
    console.log(JSON.stringify({ message: "demo project ready", ...rest, hasLink: linkToken !== null }, null, 2));
    if (linkToken) console.log(`one-time access path (shown once): /precision?code=${linkToken}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
