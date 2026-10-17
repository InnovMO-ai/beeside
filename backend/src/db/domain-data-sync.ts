import type { Queryable } from "./domain-isolation";
import { assertErasureConverged, reconcileErasures, ErasureGateError, type ReconcileReport } from "./privacy-erasure-sync";

/**
 * Domain data sync between the legacy `discovery` database and the canonical `beeside` database (both directions). It is the ONE tool for the three moments of the transition:
 *   forward copy   discovery -> beeside   (initial load, and the catch-up after a rehearsal)
 *   reconcile      discovery -> beeside   (writes made on the legacy side after the copy, until the write freeze)
 *   rollback       beeside -> discovery   (writes made on the canonical side after the cutover, if the cutover is reverted)
 * It moves ONLY the tables whose data domain (db_domain_registry of the TARGET) is the requested one (default DISCOVERY), in foreign-key order, columns common to both sides.
 * It never deletes. Conflict policy per table, derived from the registry's Discovery privileges:
 *   - append-only (no 'U'): ON CONFLICT DO NOTHING  (a delivered result, an event, a consent record is never rewritten);
 *   - mutable with `updated_at`: ON CONFLICT DO UPDATE only when the source row is newer (last writer wins by updated_at);
 *   - mutable without `updated_at`: DO NOTHING, and a divergence is reported by the checksum comparison instead of being resolved silently.
 * Verification compares per-table row counts and an order-independent checksum of the common columns on both sides.
 *
 * PRIVACY GATE (Discovery domain, no override): a personal-data erasure must stay effective across the transition and a sync must never bring erased data back. Before copying anything
 * the two sides must agree about every erasure (privacy-erasure-sync: each erased project is scrubbed AND has evidence on every side where it exists); the target's erasure log is locked
 * (SHARE ROW EXCLUSIVE) for the whole transaction so no erasure can be recorded there meanwhile; and right before COMMIT the same check runs again together with a comparison of the
 * erasure ledger seen at the start (an erasure recorded on the source while the sync ran aborts it). Anything else -> ErasureGateError, ROLLBACK, nothing written. The sync itself never
 * runs an erasure: that is domain-erasure-reconcile, a separate, separately approved step.
 */
export interface TablePlan {
  table: string;
  pk: string[];
  columns: string[];
  policy: "append-only" | "upsert-by-updated_at" | "insert-only-report";
  sequences: Array<{ column: string; sequence: string }>;
}

export const quote = (s: string): string => `"${s.replace(/"/g, '""')}"`;
const SAFE = /^[a-z_][a-z0-9_]*$/;
const LEDGER_TABLE = "fa4_privacy_erasure_log";

/** Parent-before-child order over the foreign keys among the given tables (self references ignored). Throws on a cycle. */
export function orderTables(tables: string[], fks: Array<{ child: string; parent: string }>): string[] {
  const set = new Set(tables);
  const deps = new Map<string, Set<string>>(tables.map((t) => [t, new Set<string>()]));
  for (const { child, parent } of fks) if (child !== parent && set.has(child) && set.has(parent)) deps.get(child)!.add(parent);
  const out: string[] = [];
  const left = new Set(tables);
  while (left.size) {
    const ready = [...left].filter((t) => [...deps.get(t)!].every((p) => !left.has(p))).sort();
    if (!ready.length) throw new Error(`foreign-key cycle among: ${[...left].sort().join(", ")}`);
    for (const t of ready) { out.push(t); left.delete(t); }
  }
  return out;
}

/**
 * Rows of an ERASED project. Two sides that both scrubbed the same project hold identical content, but each stamped its own time of scrubbing (updated_at / revoked_at = now()).
 * That time is not a business difference, so (1) the checksum ignores the masked columns for a scrubbed row, and (2) a scrubbed target row is never overwritten by the upsert, whatever
 * the source holds (the sync cannot reintroduce personal data even if the privacy gate were bypassed; the gate refuses to run in that state in the first place).
 */
const ERASED_ROWS: Record<string, { erased: (alias: string) => string; masked: string[] }> = {
  fa4_project: { erased: (a) => `${a}."status" = 'ANONYMIZED'`, masked: ["updated_at"] },
  fa4_demand_signal: { erased: (a) => `${a}."payload" = '{"anonymized": true}'::jsonb`, masked: ["updated_at"] },
  fa4_access_token: { erased: (a) => `EXISTS (SELECT 1 FROM public.fa4_project ep WHERE ep.project_id = ${a}."project_id" AND ep.status = 'ANONYMIZED')`, masked: ["revoked_at"] },
};

export function upsertSql(p: TablePlan): string {
  const cols = p.columns.map(quote).join(", ");
  const conflict = p.pk.map(quote).join(", ");
  const base = `INSERT INTO public.${quote(p.table)} (${cols}) SELECT ${cols} FROM json_populate_recordset(null::public.${quote(p.table)}, $1::json)`;
  if (p.policy !== "upsert-by-updated_at") return `${base} ON CONFLICT (${conflict}) DO NOTHING`;
  const sets = p.columns.filter((c) => !p.pk.includes(c)).map((c) => `${quote(c)} = EXCLUDED.${quote(c)}`).join(", ");
  const er = ERASED_ROWS[p.table];
  const notErased = er ? ` AND NOT (${er.erased(`public.${quote(p.table)}`)})` : "";
  return `${base} ON CONFLICT (${conflict}) DO UPDATE SET ${sets} WHERE public.${quote(p.table)}."updated_at" < EXCLUDED."updated_at"${notErased}`;
}

export function checksumSql(table: string, columns: string[], pk: string[], where?: string): string {
  const er = ERASED_ROWS[table];
  const val = (c: string): string => (er?.masked.includes(c) ? `CASE WHEN ${er.erased("t")} THEN to_jsonb('scrubbed'::text) ELSE to_jsonb(t.${quote(c)}) END` : `t.${quote(c)}`);
  const row = `md5(json_build_object(${columns.map((c) => `'${c}', ${val(c)}`).join(", ")})::text)`;
  return `SELECT count(*)::int AS n, COALESCE(md5(string_agg(${row}, '' ORDER BY ${pk.map((c) => `t.${quote(c)}`).join(", ")})), '') AS sum FROM public.${quote(table)} t${where ? ` WHERE ${where}` : ""}`;
}

export interface SyncOptions { domain?: string; batch?: number; dryRun?: boolean; lockTimeoutMs?: number }
export interface TableResult { table: string; policy: TablePlan["policy"]; sourceRows: number; read: number; inserted: number; updated: number; skipped: number; targetRows: number; match: boolean | null; note?: string }
export interface ErasureGateReport { checked: boolean; converged: boolean | null; erasedProjects: number; manifestSha256: string | null; detail?: string; report?: ReconcileReport }
export interface SyncReport { domain: string; direction: string; tables: TableResult[]; ignoredSourceTables: Array<{ table: string; rows: number }>; missingOnSource: string[]; erasure: ErasureGateReport; ok: boolean }

export async function planSync(source: Queryable, target: Queryable, domain = "DISCOVERY"): Promise<{ plans: TablePlan[]; missingOnSource: string[]; ignored: Array<{ table: string; rows: number }> }> {
  // the registry lives in the canonical database; in the rollback direction the target (legacy) has none, so the source's is used
  const hasRegistry = async (db: Queryable): Promise<boolean> => !!(await db.query<{ r: string | null }>("SELECT to_regclass('public.db_domain_registry')::text AS r")).rows[0]?.r;
  const regDb = (await hasRegistry(target)) ? target : source;
  if (regDb === source && !(await hasRegistry(source))) throw new Error("neither side has db_domain_registry: run the canonical migrations first");
  const reg = (await regDb.query<{ table_name: string; discovery_privileges: string }>("SELECT table_name, discovery_privileges FROM db_domain_registry WHERE domain = $1 ORDER BY table_name", [domain])).rows;
  const exists = async (db: Queryable, names: string[]): Promise<Set<string>> => new Set((await db.query<{ n: string }>(
    "SELECT relname AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p') AND relname = ANY($1::text[])", [names])).rows.map((r) => r.n));
  const names = reg.map((r) => r.table_name);
  for (const n of names) if (!SAFE.test(n)) throw new Error(`unexpected table name ${n}`);
  const onSource = await exists(source, names);
  const onTarget = await exists(target, names);
  const missingOnSource = names.filter((n) => !onSource.has(n));
  const usable = names.filter((n) => onSource.has(n) && onTarget.has(n));
  const cols = async (db: Queryable, t: string): Promise<string[]> => (await db.query<{ n: string }>(
    "SELECT a.attname AS n FROM pg_attribute a WHERE a.attrelid = to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' ORDER BY a.attnum", [`public.${quote(t)}`])).rows.map((r) => r.n);
  const fks = (await regDb.query<{ child: string; parent: string }>(
    `SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`)).rows
    .map((r) => ({ child: r.child.replace(/^public\./, "").replace(/"/g, ""), parent: r.parent.replace(/^public\./, "").replace(/"/g, "") }));
  const plans: TablePlan[] = [];
  for (const t of orderTables(usable, fks)) {
    const [sc, tc] = [await cols(source, t), await cols(target, t)];
    const columns = tc.filter((c) => sc.includes(c));
    // conflict key: the primary key, else the narrowest plain UNIQUE index whose columns are all NOT NULL (e.g. fa4_catalog_entity has no PK, only a unique index)
    let pk = (await target.query<{ n: string }>(
      `SELECT a.attname AS n FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = to_regclass($1) AND i.indisprimary ORDER BY array_position(i.indkey::int2[], a.attnum)`, [`public.${quote(t)}`])).rows.map((r) => r.n);
    if (!pk.length) {
      pk = (await target.query<{ n: string }>(
        `WITH u AS (SELECT i.indexrelid, i.indkey, i.indrelid FROM pg_index i WHERE i.indrelid = to_regclass($1) AND i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indisvalid
                       AND NOT EXISTS (SELECT 1 FROM unnest(i.indkey::int2[]) k JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k WHERE NOT a.attnotnull)
                     ORDER BY array_length(i.indkey::int2[], 1), i.indexrelid LIMIT 1)
         SELECT a.attname AS n FROM u JOIN pg_attribute a ON a.attrelid = u.indrelid AND a.attnum = ANY(u.indkey) ORDER BY array_position(u.indkey::int2[], a.attnum)`, [`public.${quote(t)}`])).rows.map((r) => r.n);
    }
    if (!pk.length) throw new Error(`${t} has neither a primary key nor a NOT NULL unique index: cannot sync it safely`);
    if (!pk.every((c) => columns.includes(c))) throw new Error(`${t}: a primary-key column is missing on the source`);
    const priv = reg.find((r) => r.table_name === t)!.discovery_privileges;
    const policy: TablePlan["policy"] = !priv.includes("U") ? "append-only" : columns.includes("updated_at") ? "upsert-by-updated_at" : "insert-only-report";
    const sequences = (await target.query<{ column: string; sequence: string }>(
      `SELECT a.attname AS "column", pg_get_serial_sequence($1, a.attname) AS sequence FROM pg_attribute a WHERE a.attrelid = to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped AND pg_get_serial_sequence($1, a.attname) IS NOT NULL`, [`public.${quote(t)}`])).rows
      .filter((r) => columns.includes(r.column));
    plans.push({ table: t, pk, columns, policy, sequences });
  }
  // what the source holds outside the requested domain (reported, never copied)
  const regAll = new Set((await regDb.query<{ table_name: string }>("SELECT table_name FROM db_domain_registry")).rows.map((r) => r.table_name));
  const srcTables = (await source.query<{ n: string }>("SELECT relname AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p') ORDER BY 1")).rows.map((r) => r.n);
  const ignored: Array<{ table: string; rows: number }> = [];
  for (const t of srcTables) {
    if (names.includes(t)) continue;
    const n = Number((await source.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.${quote(t)}`)).rows[0]!.n);
    if (n > 0 || !regAll.has(t)) ignored.push({ table: t, rows: n });
  }
  return { plans, missingOnSource, ignored };
}

export async function runSync(source: Queryable, target: Queryable & { query: Queryable["query"] }, opts: SyncOptions = {}): Promise<SyncReport> {
  const domain = opts.domain ?? "DISCOVERY";
  const batch = Math.min(Math.max(opts.batch ?? 500, 1), 5000);
  const { plans, missingOnSource, ignored } = await planSync(source, target, domain);
  const tables: TableResult[] = [];
  const guarded = domain === "DISCOVERY"; // the erasure tables belong to the Discovery domain
  let erasure: ErasureGateReport = { checked: false, converged: null, erasedProjects: 0, manifestSha256: null };
  if (guarded && opts.dryRun) {
    try {
      const g = await assertErasureConverged(source, target);
      erasure = { checked: true, converged: true, erasedProjects: g.report.erasedProjects, manifestSha256: g.report.manifestSha256, report: g.report };
    } catch (e) {
      if (!(e instanceof ErasureGateError)) throw e;
      const r = (e.detail["report"] as ReconcileReport | undefined);
      erasure = { checked: true, converged: false, erasedProjects: r?.erasedProjects ?? 0, manifestSha256: r?.manifestSha256 ?? null, detail: e.message, ...(r ? { report: r } : {}) };
    }
  }
  // ONE transaction on the target: all-or-nothing, and the deferred integrity triggers (a DELIVERED project needs its sealed result) are checked at the end, not table by table
  if (!opts.dryRun) await target.query("BEGIN");
  try {
  if (guarded && !opts.dryRun) {
    // no erasure can be recorded on the target while this transaction lives; a lock that cannot be taken fails fast instead of hanging an erasure or the sync
    await target.query(`SET LOCAL lock_timeout = '${Math.min(Math.max(Math.trunc(opts.lockTimeoutMs ?? 15000), 100), 120000)}ms'`);
    await target.query("LOCK TABLE public.fa4_privacy_erasure_log IN SHARE ROW EXCLUSIVE MODE");
    const g = await assertErasureConverged(source, target);
    erasure = { checked: true, converged: true, erasedProjects: g.report.erasedProjects, manifestSha256: g.report.manifestSha256, report: g.report };
  }
  for (const p of plans) {
    const cols = p.columns.map(quote).join(", ");
    const total = Number((await source.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.${quote(p.table)}`)).rows[0]!.n);
    const res: TableResult = { table: p.table, policy: p.policy, sourceRows: total, read: 0, inserted: 0, updated: 0, skipped: 0, targetRows: 0, match: null };
    if (!opts.dryRun) {
      const order = p.pk.map(quote).join(", ");
      let offset = 0;
      for (;;) {
        const rows = (await source.query<{ j: unknown }>(`SELECT row_to_json(x) AS j FROM (SELECT ${cols} FROM public.${quote(p.table)} ORDER BY ${order} LIMIT ${batch} OFFSET ${offset}) x`)).rows.map((r) => r.j);
        if (!rows.length) break;
        const before = Number((await target.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.${quote(p.table)}`)).rows[0]!.n);
        const r = await target.query(upsertSql(p), [JSON.stringify(rows)]);
        const after = Number((await target.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.${quote(p.table)}`)).rows[0]!.n);
        const touched = r.rowCount ?? 0;
        res.read += rows.length; res.inserted += after - before; res.updated += touched - (after - before); res.skipped += rows.length - touched;
        offset += rows.length;
        if (rows.length < batch) break;
      }
      for (const s of p.sequences) {
        await target.query(`SELECT setval($1::regclass, GREATEST((SELECT COALESCE(max(${quote(s.column)}), 1) FROM public.${quote(p.table)}), (SELECT last_value FROM ${s.sequence})))`, [s.sequence]);
      }
    }
    const ledger = p.table === LEDGER_TABLE;
    // The erasure log is a LEDGER both sides append to (a propagated erasure writes its evidence row on the lagging side), so each side may hold rows the other lacks until the sync has run in
    // both directions: it is verified as "every source row is in the target, identical", not as equality.
    const ids = ledger ? (await source.query<{ i: string }>(`SELECT ${quote(p.pk[0]!)}::text AS i FROM public.${quote(p.table)}`)).rows.map((r) => r.i) : [];
    const [a, b] = [await source.query<{ n: number; sum: string }>(checksumSql(p.table, p.columns, p.pk)),
                    ledger ? await target.query<{ n: number; sum: string }>(checksumSql(p.table, p.columns, p.pk, `t.${quote(p.pk[0]!)}::text = ANY($1::text[])`), [ids]) : await target.query<{ n: number; sum: string }>(checksumSql(p.table, p.columns, p.pk))];
    res.targetRows = ledger ? Number((await target.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.${quote(p.table)}`)).rows[0]!.n) : b.rows[0]!.n;
    res.match = a.rows[0]!.sum === b.rows[0]!.sum && a.rows[0]!.n === b.rows[0]!.n;
    if (!res.match && p.policy === "insert-only-report") res.note = "differs: a mutable table without updated_at is never overwritten; resolve by hand";
    if (!res.match && opts.dryRun) res.note = "dry run: nothing was written";
    tables.push(res);
  }
  if (guarded && !opts.dryRun) {
    // the same question after the copy: nothing copied may have reintroduced personal data, and no erasure may have been recorded on the source meanwhile
    const after = await reconcileErasures(source, target, { apply: false });
    if (!after.converged) throw new ErasureGateError("aborted: personal data of an erased project would remain or reappear after this sync; nothing was written", { report: after });
    if (after.manifestSha256 !== erasure.manifestSha256) throw new ErasureGateError("aborted: an erasure was recorded while the sync was running; reconcile erasures and run the sync again; nothing was written", { report: after });
  }
  if (!opts.dryRun) await target.query("COMMIT");
  } catch (e) {
    if (!opts.dryRun) await target.query("ROLLBACK");
    throw e;
  }
  return { domain, direction: "source->target", tables, ignoredSourceTables: ignored, missingOnSource, erasure, ok: tables.every((t) => t.match === true) && (!guarded || erasure.converged === true) };
}
