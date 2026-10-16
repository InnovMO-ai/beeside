/* eslint-disable no-console */
import { Pool } from "pg";

/**
 * Deletes EVERYTHING generated during the STABILIZATION stage (fictitious data) before the environment moves to real use. Run as the database OWNER (job `discovery-reset`).
 *  - REFUSES unless RESET_CONFIRM=DELETE-ALL-STABILIZATION-DATA;
 *  - REFUSES if any recorded Privacy acceptance carries a version other than the closed-test marker (that would be real consent: this tool must never touch it);
 *  - removes every row of the Discovery data tables in ONE transaction (the append-only guards are disabled only for the TRUNCATE inside that transaction and are verified enabled again before COMMIT);
 *  - keeps the catalog (versions, entities, history) and the schema; the migrations table is untouched.
 */
export const STABILIZATION_MARKER = "CLOSED-TEST-NOT-LEGAL";
const DATA_TABLES = ["fa4_continuation_request", "fa4_result", "fa4_demand_signal", "fa4_contact_request", "fa4_email_delivery", "fa4_access_token", "fa4_marketing_consent", "fa4_legal_acceptance", "fa4_event", "fa4_privacy_erasure_log", "fa4_project"];

export async function resetStabilizationData(pool: Pool, confirm: string | undefined): Promise<{ deleted: Record<string, number>; catalogEntities: number }> {
  if (confirm !== "DELETE-ALL-STABILIZATION-DATA") throw new Error("refusing: RESET_CONFIRM=DELETE-ALL-STABILIZATION-DATA is required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const real = await client.query("SELECT count(*)::int AS n FROM fa4_legal_acceptance WHERE document = 'PRIVACY' AND document_version <> $1", [STABILIZATION_MARKER]);
    if (real.rows[0].n > 0) throw new Error(`refusing: ${real.rows[0].n} Privacy acceptance(s) carry a real version — this is not stabilization data`);
    const before: Record<string, number> = {};
    for (const t of DATA_TABLES) before[t] = (await client.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
    const catalogBefore = (await client.query("SELECT count(*)::int AS n FROM fa4_catalog_entity")).rows[0].n as number;
    for (const t of DATA_TABLES) await client.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
    await client.query(`TRUNCATE ${DATA_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
    for (const t of DATA_TABLES) await client.query(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
    const off = await client.query("SELECT c.relname FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid WHERE c.relname = ANY($1) AND NOT g.tgisinternal AND g.tgenabled <> 'O'", [DATA_TABLES]);
    if (off.rowCount) throw new Error(`refusing to commit: guards still disabled on ${off.rows.map((r) => r.relname).join(", ")}`);
    for (const t of DATA_TABLES) if ((await client.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n !== 0) throw new Error(`${t} is not empty after the reset`);
    const catalogAfter = (await client.query("SELECT count(*)::int AS n FROM fa4_catalog_entity")).rows[0].n as number;
    if (catalogAfter !== catalogBefore || catalogAfter === 0) throw new Error("the catalog changed or is empty: aborting");
    await client.query("COMMIT");
    return { deleted: before, catalogEntities: catalogAfter };
  } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; } finally { client.release(); }
}

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL; if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
  const pool = new Pool({ connectionString: url });
  try { const r = await resetStabilizationData(pool, process.env.RESET_CONFIRM); console.log(JSON.stringify({ severity: "INFO", message: "stabilization data deleted", ...r })); }
  finally { await pool.end(); }
}
if (require.main === module) main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
