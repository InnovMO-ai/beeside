import { Pool } from "pg";
import { SEED_CATALOG } from "@beeside/fa-public-engine/seed";
import { createPoolDb } from "../db/database";
import { seedCatalogIfEmpty } from "../fa4/repository";

/**
 * Seeds the FA Public v1.0 catalog (Capability Registry v4) into an EMPTY database as the first PUBLISHED version.
 * Idempotent: a database that already has a published catalog version is left untouched. Later catalog changes go through
 * DRAFT -> PUBLISHED with history (see fa4/repository.ts), never through this script.
 *   DATABASE_URL=... npm run fa4:seed-catalog --workspace=backend
 */
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const seeded = await seedCatalogIfEmpty(createPoolDb(pool), SEED_CATALOG);
    // eslint-disable-next-line no-console
    console.log(seeded ? `FA4 catalog ${SEED_CATALOG.version} seeded` : "FA4 catalog already present; nothing changed");
  } finally {
    await pool.end();
  }
}
main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
