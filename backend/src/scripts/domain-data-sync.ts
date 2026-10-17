/* eslint-disable no-console */
import { Client } from "pg";
import { runSync } from "../db/domain-data-sync";
import { ErasureGateError } from "../db/privacy-erasure-sync";

/**
 * Copies/reconciles the Discovery-domain tables between the legacy `discovery` database and the canonical `beeside` database, in either direction.
 * Never deletes. Run by the Product Owner (or on his written instruction), with the OWNER credential of each side, in a window where Discovery writes are frozen.
 * Inputs: SYNC_SOURCE_URL, SYNC_TARGET_URL (owner credentials), optional SYNC_DOMAIN (default DISCOVERY), SYNC_BATCH, DOMAIN_SYNC_LOCK_TIMEOUT_MS (erasure-log lock wait, default 15000), DRY_RUN=yes (verify only: reads both sides, writes nothing),
 * and for a real run DOMAIN_SYNC_APPROVED=yes. The TARGET must carry `db_domain_registry` (the canonical database always does; so does the legacy one only after 0051).
 * Prints table names and counts only, never row content.
 * PRIVACY GATE: refuses (exit 3, nothing written) while the two sides disagree about a personal-data erasure; run domain-erasure-reconcile first (see privacy-erasure-sync.ts).
 */
async function main(): Promise<void> {
  const [su, tu] = [process.env.SYNC_SOURCE_URL, process.env.SYNC_TARGET_URL];
  if (!su || !tu) throw new Error("SYNC_SOURCE_URL and SYNC_TARGET_URL are required");
  if (su === tu) throw new Error("source and target must differ");
  const dry = process.env.DRY_RUN === "yes";
  if (!dry && process.env.DOMAIN_SYNC_APPROVED !== "yes") throw new Error("refused: DOMAIN_SYNC_APPROVED=yes is required for a real run (DRY_RUN=yes only measures)");
  const [s, t] = [new Client({ connectionString: su }), new Client({ connectionString: tu })];
  await Promise.all([s.connect(), t.connect()]);
  try {
    const db = (c: Client) => c.query<{ d: string }>("SELECT current_database() AS d").then((r) => r.rows[0]!.d);
    const rep = await runSync(s, t, { domain: process.env.SYNC_DOMAIN ?? "DISCOVERY", batch: Number(process.env.SYNC_BATCH ?? 500), dryRun: dry, lockTimeoutMs: Number(process.env.DOMAIN_SYNC_LOCK_TIMEOUT_MS ?? 15000) });
    rep.direction = `${await db(s)} -> ${await db(t)}`;
    console.log(JSON.stringify({ severity: rep.ok ? "INFO" : "ERROR", message: dry ? "domain data check (dry run)" : "domain data sync", ...rep }));
    if (!rep.ok) process.exit(2);
  } finally {
    await Promise.all([s.end(), t.end()]);
  }
}

main().catch((e: unknown) => {
  const gate = e instanceof ErasureGateError;
  console.error(JSON.stringify({ severity: "ERROR", message: gate ? "domain data sync stopped by the privacy gate" : "domain data sync failed", error: e instanceof Error ? e.message : String(e), ...(gate ? { erasure: (e as ErasureGateError).detail["report"] ?? null } : {}) }));
  process.exit(gate ? 3 : 1);
});
