/**
 * Onboards a country guide ("Doing business in Mexico") in one step: curated source + KSeed ingestion (versioned, with provenance) +
 * country resource with its HTTPS destination. Idempotent. No network: the file is supplied.
 *   DATABASE_URL=... npx tsx src/scripts/onboard-country-guide.ts --country MX --title "Doing business in Mexico" --language en \
 *     --edition 2026 --url https://example.org/doing-business-in-mexico.pdf --file ./doing-business-in-mexico.pdf [--published 2026-10-16] [--topic taxes]
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Pool } from "pg";
import { createPoolDb, type Db } from "../db/database";
import { onboardCountryGuide } from "../knowledge-layer/onboard-guide";
import { createPgCountryResources, createPgKnowledgeRepository } from "../knowledge-layer/pg-repo";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const need = (n: string): string => { const v = arg(n); if (!v) throw new Error(`--${n} is required`); return v; };
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const file = need("file");
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    const db = createPoolDb(pool) as Db;
    const r = await onboardCountryGuide(createPgKnowledgeRepository(db), createPgCountryResources(db), {
      countryCode: need("country"), title: need("title"), language: need("language"), edition: need("edition"), url: need("url"),
      file: { filename: basename(file), data: readFileSync(file) }, now: new Date().toISOString(),
      ...(arg("published") ? { publishedAt: arg("published")! } : {}), ...(arg("topic") ? { topic: arg("topic")! } : {}),
    });
    console.log(JSON.stringify({ source: r.sourceId, approvedHost: r.approvedHost, ingest: r.ingest.status, document: r.ingest.document.id, version: r.ingest.document.version, resource: r.resource.id, deactivated: r.deactivated }));
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
