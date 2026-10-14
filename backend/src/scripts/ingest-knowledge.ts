/**
 * Ingests one publication into the permanent Knowledge feed (Source Registry must know the source).
 *   DATABASE_URL=... npx tsx src/scripts/ingest-knowledge.ts --source imco-ice --title "Índice de Competitividad Estatal 2025" \
 *     --edition 2025 --file ./ICE-2025-libro.pdf --locator https://imco.org.mx/... [--published 2025-06-09] [--topics labor_market,infrastructure]
 * Same bytes -> "unchanged"; different bytes under the same title -> a new version that supersedes the previous one.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Pool } from "pg";
import { createPoolDb, type Db } from "../db/database";
import { ingestDocument } from "../precision/knowledge/ingest";
import { createPgKnowledgeRepository } from "../precision/knowledge/pg-repo";
import { seedInitialSources } from "../precision/knowledge/registry";
import { TOPICS, type Topic } from "../precision/knowledge/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const need = (n: string): string => { const v = arg(n); if (!v) throw new Error(`--${n} is required`); return v; };
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const file = need("file");
  const topics = arg("topics")?.split(",").map((t) => t.trim()).filter(Boolean) as Topic[] | undefined;
  for (const t of topics ?? []) if (!(TOPICS as readonly string[]).includes(t)) throw new Error(`unknown topic ${t}`);
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    const db = createPoolDb(pool) as Db;
    const repo = createPgKnowledgeRepository(db);
    await seedInitialSources(repo);
    const r = await ingestDocument(repo, {
      sourceId: need("source"), title: need("title"), edition: need("edition"), locator: need("locator"), filename: basename(file), data: readFileSync(file), now: new Date().toISOString(),
      ...(arg("published") ? { publishedAt: arg("published")! } : {}), ...(topics ? { topics } : {}),
    });
    console.log(JSON.stringify({ status: r.status, document: r.document.id, version: r.document.version, ...(r.status === "ingested" ? { passages: r.passages, supersedes: r.supersededId ?? null } : {}) }));
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
