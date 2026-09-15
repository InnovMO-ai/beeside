/* eslint-disable no-console */
import { Client } from "pg";
import { checkFieldRegistry, syncFieldRegistry } from "../fa/admin/field-registry";

// Usage: DATABASE_URL=... npm run db:sync-fields [-- --check]
// Without --check: synchronizes field_key_registry from shared/canonical-fields.
// With --check: exits 1 if the active registry differs from shared/canonical-fields.
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    if (!process.argv.includes("--check")) {
      console.log("field registry sync:", JSON.stringify(await syncFieldRegistry(client)));
    }
    const drift = await checkFieldRegistry(client);
    console.log("field registry drift:", JSON.stringify(drift));
    if (drift.missing.length || drift.extra.length || drift.changed.length) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
