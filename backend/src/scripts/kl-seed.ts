/**
 * Loads the INITIAL KNOWLEDGE (the seed) into the Knowledge Layer through the layer's own ingestion path, then proves the layer is ready.
 * The first production connection of Precision is never an empty layer; this is the step that makes it so. Idempotent: identical bytes are
 * "unchanged", changed bytes become a new version that supersedes the previous one (nothing is overwritten).
 *
 *   DATABASE_URL=...  node dist/scripts/kl-seed.js --manifest /seed/manifest.json [--countries MX]     load + verify
 *   DATABASE_URL=...  node dist/scripts/kl-seed.js --check [--countries MX]                              verify only (read-only)
 *
 * manifest.json (files are read relative to the manifest's folder; nothing is fetched from the network):
 *   { "documents": [ { "source": "imco-ice", "title": "...", "edition": "2025", "locator": "https://...", "file": "ICE-2025-libro.pdf", "published": "2025-06-09", "topics": ["labor_market"] } ] }
 * Exit code 1 when the layer is not ready. Prints no secret.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { Pool } from "pg";
import { createPoolDb, type Db } from "../db/database";
import { ingestDocument } from "../knowledge-layer/ingest";
import { createPgKnowledgeRepository } from "../knowledge-layer/pg-repo";
import { knowledgeReadiness } from "../knowledge-layer/readiness";
import { seedInitialSources } from "../knowledge-layer/registry";
import { TOPICS, type Topic } from "../knowledge-layer/types";

export interface SeedEntry { source: string; title: string; edition: string; locator: string; file: string; published?: string; topics?: string[] }

/** Validates a manifest and resolves its files inside the manifest folder (no path escapes). Pure; throws on the first problem. */
export function parseSeedManifest(raw: unknown, dir: string): (SeedEntry & { path: string })[] {
  const docs = (raw as { documents?: unknown } | null)?.documents;
  if (!Array.isArray(docs) || docs.length === 0) throw new Error("the manifest needs a non-empty 'documents' array");
  return docs.map((d, i) => {
    const e = d as Record<string, unknown>;
    for (const k of ["source", "title", "edition", "locator", "file"]) if (typeof e[k] !== "string" || !(e[k] as string).trim()) throw new Error(`documents[${i}].${k} is required`);
    const file = e["file"] as string;
    const path = resolve(dir, file);
    if (isAbsolute(file) || !path.startsWith(`${resolve(dir)}/`)) throw new Error(`documents[${i}].file must be inside the manifest folder`);
    const topics = e["topics"] === undefined ? undefined : (e["topics"] as unknown[]).map(String);
    for (const t of topics ?? []) if (!(TOPICS as readonly string[]).includes(t)) throw new Error(`documents[${i}] has an unknown topic ${t}`);
    return { source: e["source"] as string, title: e["title"] as string, edition: e["edition"] as string, locator: e["locator"] as string, file, path, ...(typeof e["published"] === "string" ? { published: e["published"] } : {}), ...(topics ? { topics } : {}) };
  });
}

const arg = (n: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const flag = (n: string): boolean => process.argv.includes(`--${n}`);

async function main(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required");
  const countries = (arg("countries") ?? "MX").split(",");
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    const repo = createPgKnowledgeRepository(createPoolDb(pool) as Db);
    if (!flag("check")) {
      const m = arg("manifest");
      if (!m) throw new Error("--manifest is required (or use --check)");
      const entries = parseSeedManifest(JSON.parse(readFileSync(m, "utf8")), dirname(resolve(m)));
      for (const e of entries) if (!existsSync(e.path)) throw new Error(`file not found: ${e.file}`);
      await seedInitialSources(repo);
      for (const e of entries) {
        const r = await ingestDocument(repo, { sourceId: e.source, title: e.title, edition: e.edition, locator: e.locator, filename: basename(e.path), data: readFileSync(e.path), now: new Date().toISOString(), ...(e.published ? { publishedAt: e.published } : {}), ...(e.topics ? { topics: e.topics as Topic[] } : {}) });
        console.log(JSON.stringify({ message: "kl-seed", file: e.file, status: r.status, document: r.document.id, version: r.document.version, ...(r.status === "ingested" ? { passages: r.passages } : {}) }));
      }
    }
    const ready = await knowledgeReadiness(repo, countries);
    console.log(JSON.stringify({ message: "kl-readiness", ...ready }));
    if (!ready.ready) process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
