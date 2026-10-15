/**
 * Writes the KSeed status and gap report (Spanish markdown) from what is ingested in the database. Internal data only; no network.
 *   DATABASE_URL=... npx tsx src/scripts/kseed-report.ts [--out ./kseed-report.md] [--gaps-out ./kseed-v1-gaps.md]
 */
import { writeFileSync } from "node:fs";
import { Pool } from "pg";
import { createPoolDb, type Db } from "../db/database";
import { kseedStatus } from "../admin/precision-knowledge-admin";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const i = process.argv.indexOf("--out");
  const out = i >= 0 ? process.argv[i + 1] : undefined;
  const g = process.argv.indexOf("--gaps-out");
  const gapsOut = g >= 0 ? process.argv[g + 1] : undefined;
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    const { report, assessment, v1Gaps } = await kseedStatus(createPoolDb(pool) as Db, new Date());
    if (gapsOut) writeFileSync(gapsOut, v1Gaps);
    if (out) writeFileSync(out, report);
    else console.log(report);
    const c = (s: string): number => assessment.filter((x) => x.status === s).length;
    console.error(JSON.stringify({ needs: assessment.length, covered: c("covered"), partial: c("partial"), missing: c("missing") }));
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
