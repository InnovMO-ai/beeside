/* eslint-disable no-console */
import { Client } from "pg";
import { syncFieldRegistry } from "../fa/admin/field-registry";
import { ensureDevBootstrapAdmin, publishDevConfiguration } from "../fa/admin/publish-config";

// DEVELOPMENT ONLY. Usage:
//   CONFIG_BOOTSTRAP_ENV=development DATABASE_URL=... npm run config:publish-dev -- --development-only
// Syncs canonical fields, ensures the technical dev ADMIN, and publishes the First Assessment
// question bank v1 (+ placeholder rules/snapshot versions when none is current). This does not
// define production ADMIN users and never exposes the Admin API.
async function main() {
  if (process.env.CONFIG_BOOTSTRAP_ENV !== "development" || !process.argv.includes("--development-only")) {
    throw new Error("refusing to run: set CONFIG_BOOTSTRAP_ENV=development and pass --development-only");
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    console.log("field registry sync:", JSON.stringify(await syncFieldRegistry(client)));
    const adminId = await ensureDevBootstrapAdmin(client);
    console.log("configuration:", JSON.stringify(await publishDevConfiguration(client, adminId)));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
