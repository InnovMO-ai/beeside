/* eslint-disable no-console */
import { Pool } from "pg";

/**
 * Deletes EVERYTHING generated during the STABILIZATION stage (fictitious data) before the environment moves to real use. Run as the database OWNER (job `discovery-reset`).
 *  - REFUSES unless RESET_CONFIRM=DELETE-ALL-STABILIZATION-DATA;
 *  - REFUSES if any recorded Privacy acceptance carries a version other than the closed-test marker (that would be real consent: this tool must never touch it);
 *  - works ONLY on the Discovery data tables listed below, with plain DELETEs in foreign-key order — never TRUNCATE, never CASCADE. In the shared canonical database
 *    other domains reference these tables (e.g. `project_origin` -> `fa4_result`); a cascade would silently wipe the Discovery->Precision lineage. So the tool
 *    REFUSES, deleting nothing, if any table outside the Discovery set holds rows that reference them (a promoted project exists), and it never touches such a table;
 *  - removes the rows in ONE transaction (the append-only guards are disabled only for the DELETEs inside that transaction and are verified enabled again before COMMIT);
 *  - keeps the catalog (versions, entities, history) and the schema; the migrations table is untouched.
 * `RESET_MODE=plan` is READ-ONLY: it prints what would be deleted, which tables reference the set, and whether the reset would be refused. It changes nothing.
 */
export const STABILIZATION_MARKER = "CLOSED-TEST-NOT-LEGAL";
const DATA_TABLES = ["fa4_continuation_request", "fa4_result", "fa4_demand_signal", "fa4_contact_request", "fa4_email_delivery", "fa4_access_token", "fa4_marketing_consent", "fa4_legal_acceptance", "fa4_event", "fa4_privacy_erasure_log", "fa4_project"];

export interface ResetPlan {
  counts: Record<string, number>;
  realPrivacyAcceptances: number;
  /** Tables OUTSIDE the Discovery set with a foreign key into it, and how many of their rows exist. A reset is refused while any holds rows. */
  dependents: Array<{ table: string; rows: number }>;
  catalogEntities: number;
  deleteOrder: string[];
  refusals: string[];
}

interface Queryable { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>; }

/** Foreign keys among the Discovery tables ordered so that a table is deleted before the tables it references (children first). */
async function deleteOrder(q: Queryable): Promise<string[]> {
  const edges = (await q.query<{ child: string; parent: string }>(
    `SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent FROM pg_constraint c
      WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY($1) AND c.confrelid::regclass::text = ANY($1) AND c.conrelid <> c.confrelid`, [DATA_TABLES])).rows;
  const remaining = new Set(DATA_TABLES);
  const order: string[] = [];
  while (remaining.size) {
    // a table can go once nothing still remaining references it
    const ready = [...remaining].filter((t) => !edges.some((e) => e.parent === t && remaining.has(e.child)));
    if (!ready.length) throw new Error("foreign-key cycle among the Discovery tables: refusing");
    for (const t of ready) { order.push(t); remaining.delete(t); }
  }
  return order;
}

export async function planStabilizationReset(q: Queryable): Promise<ResetPlan> {
  const counts: Record<string, number> = {};
  for (const t of DATA_TABLES) counts[t] = ((await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`)).rows[0]!).n;
  const real = ((await q.query<{ n: number }>("SELECT count(*)::int AS n FROM fa4_legal_acceptance WHERE document = 'PRIVACY' AND document_version <> $1", [STABILIZATION_MARKER])).rows[0]!).n;
  const refs = (await q.query<{ child: string }>(
    `SELECT DISTINCT c.conrelid::regclass::text AS child FROM pg_constraint c
      WHERE c.contype = 'f' AND c.confrelid::regclass::text = ANY($1) AND NOT (c.conrelid::regclass::text = ANY($1)) ORDER BY 1`, [DATA_TABLES])).rows;
  const dependents: Array<{ table: string; rows: number }> = [];
  for (const r of refs) dependents.push({ table: r.child, rows: ((await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${r.child}`)).rows[0]!).n });
  const catalogEntities = ((await q.query<{ n: number }>("SELECT count(*)::int AS n FROM fa4_catalog_entity")).rows[0]!).n;
  const refusals: string[] = [];
  if (real > 0) refusals.push(`${real} Privacy acceptance(s) carry a real version — this is not stabilization data`);
  for (const d of dependents) if (d.rows > 0) refusals.push(`${d.table} holds ${d.rows} row(s) that reference Discovery records (a promoted project): deleting them would break the Discovery->Precision lineage`);
  if (catalogEntities === 0) refusals.push("the catalog is empty: nothing to preserve, aborting");
  return { counts, realPrivacyAcceptances: real, dependents, catalogEntities, deleteOrder: await deleteOrder(q), refusals };
}

export async function resetStabilizationData(pool: Pool, confirm: string | undefined): Promise<{ deleted: Record<string, number>; catalogEntities: number }> {
  if (confirm !== "DELETE-ALL-STABILIZATION-DATA") throw new Error("refusing: RESET_CONFIRM=DELETE-ALL-STABILIZATION-DATA is required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const plan = await planStabilizationReset(client);
    // the real-consent refusal keeps its historical wording
    if (plan.realPrivacyAcceptances > 0) throw new Error(`refusing: ${plan.realPrivacyAcceptances} Privacy acceptance(s) carry a real version — this is not stabilization data`);
    if (plan.refusals.length) throw new Error(`refusing: ${plan.refusals.join("; ")}`);
    for (const t of DATA_TABLES) await client.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
    for (const t of plan.deleteOrder) await client.query(`DELETE FROM ${t}`);   // plain DELETE: a foreign key from any other table makes this fail instead of cascading
    for (const t of DATA_TABLES) await client.query(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
    // identity/serial counters of the emptied tables restart, as the previous version did (RESTART IDENTITY); only sequences OWNED by these tables' columns
    const seqs = await client.query<{ seq: string }>(
      `SELECT s.oid::regclass::text AS seq FROM pg_class s JOIN pg_depend d ON d.objid = s.oid AND d.deptype IN ('a','i') JOIN pg_class t ON t.oid = d.refobjid
        WHERE s.relkind = 'S' AND t.relname = ANY($1) AND t.relnamespace = 'public'::regnamespace ORDER BY 1`, [DATA_TABLES]);
    for (const s of seqs.rows) await client.query(`ALTER SEQUENCE ${s.seq} RESTART`);
    const off = await client.query("SELECT c.relname FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid WHERE c.relname = ANY($1) AND NOT g.tgisinternal AND g.tgenabled <> 'O'", [DATA_TABLES]);
    if (off.rowCount) throw new Error(`refusing to commit: guards still disabled on ${off.rows.map((r) => r.relname).join(", ")}`);
    for (const t of DATA_TABLES) if ((await client.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n !== 0) throw new Error(`${t} is not empty after the reset`);
    const catalogAfter = ((await client.query<{ n: number }>("SELECT count(*)::int AS n FROM fa4_catalog_entity")).rows[0]!).n;
    if (catalogAfter !== plan.catalogEntities || catalogAfter === 0) throw new Error("the catalog changed or is empty: aborting");
    for (const d of plan.dependents) if (((await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${d.table}`)).rows[0]!).n !== d.rows) throw new Error(`${d.table} changed during the reset: aborting`);
    await client.query("COMMIT");
    return { deleted: plan.counts, catalogEntities: catalogAfter };
  } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; } finally { client.release(); }
}

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL; if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
  const pool = new Pool({ connectionString: url });
  try {
    if (process.env.RESET_MODE === "plan") {
      const plan = await planStabilizationReset(pool);
      console.log(JSON.stringify({ severity: "INFO", message: "stabilization reset PLAN (read-only, nothing deleted)", ...plan, wouldProceed: plan.refusals.length === 0 }));
      return;
    }
    const r = await resetStabilizationData(pool, process.env.RESET_CONFIRM);
    console.log(JSON.stringify({ severity: "INFO", message: "stabilization data deleted", ...r }));
  } finally { await pool.end(); }
}
if (require.main === module) main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
