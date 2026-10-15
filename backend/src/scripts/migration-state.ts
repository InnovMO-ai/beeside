import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Read-only migration-state inspection (no schema change, no data read beyond drizzle's own registry table).
 *
 * Why it exists: drizzle's migrator applies a migration only if its journal timestamp (`when`) is NEWER than the last applied one, regardless of its
 * name. A database that applied an OLDER numbering of the same migrations (e.g. Precision's former 0017-0039, before they were renumbered to 0024-0048
 * to sit after Discovery's 0017-0023) would therefore silently SKIP migrations or run them out of order. This check turns that silent risk into a loud,
 * explicit refusal before anything is applied.
 *
 *   safe       : every applied migration is one of this build's migrations, with the same content hash AND the same timestamp, and none of the
 *                not-yet-applied migrations is older than the last applied one (so the migrator will apply exactly the pending ones, in order).
 *   unsafe     : anything else; `problems` says what. Nothing is mutated either way.
 */
export interface MigrationState {
  expected: number;
  applied: number;
  pending: string[];
  safe: boolean;
  problems: string[];
}

interface Queryable { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>; }

export function readJournal(folder: string): Array<{ tag: string; when: number; hash: string }> {
  const journal = JSON.parse(readFileSync(path.join(folder, "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string; when: number }> };
  return journal.entries.map((e) => ({ tag: e.tag, when: e.when, hash: createHash("sha256").update(readFileSync(path.join(folder, `${e.tag}.sql`), "utf8")).digest("hex") }));
}

export async function inspectMigrationState(db: Queryable, folder: string): Promise<MigrationState> {
  const expected = readJournal(folder);
  const reg = await db.query<{ ok: boolean }>("SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ok");
  if (!reg.rows[0]?.ok) return { expected: expected.length, applied: 0, pending: expected.map((e) => e.tag), safe: true, problems: [] };
  const rows = (await db.query<{ hash: string; created_at: string | number }>("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at")).rows;
  const byHash = new Map(expected.map((e) => [e.hash, e]));
  const problems: string[] = [];
  const appliedHashes = new Set<string>();
  let last = 0;
  for (const r of rows) {
    const known = byHash.get(r.hash);
    const at = Number(r.created_at);
    last = Math.max(last, at);
    if (!known) { problems.push(`an applied migration (created_at ${at}) is not part of this build: another numbering or branch was applied to this database`); continue; }
    appliedHashes.add(r.hash);
    if (known.when !== at) problems.push(`${known.tag} was applied with a different timestamp (${at} vs ${known.when}): this database used an older numbering`);
  }
  const pending = expected.filter((e) => !appliedHashes.has(e.hash));
  for (const e of pending) {
    if (e.when <= last) problems.push(`${e.tag} is pending but older than the last applied migration: the migrator would silently skip it`);
  }
  return { expected: expected.length, applied: rows.length, pending: pending.map((e) => e.tag), safe: problems.length === 0, problems };
}
