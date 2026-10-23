/* eslint-disable no-console */
import { Pool } from "pg";
import type { Db } from "../db/database";
import { createPoolDb } from "../db/database";

/**
 * ESTABILIZACIÓN → PRODUCCIÓN, step "verify the database is clean". READ-ONLY: it only counts rows; it writes nothing and prints no row content.
 *
 * Source of truth is the privacy erasure registry (`privacy_erasure_registry`), which classifies every table:
 *   - `global` tables are system configuration, reference data, governed knowledge, migrations' companions: they are KEPT.
 *   - every other class holds customer / project data (identity, assessment and Precision content, commercial records, analytics, trails…).
 *     During ESTABILIZACIÓN all of it is fictitious test data, so before PRODUCCIÓN every one of those tables must be empty.
 *   - `admin_user`, `admin_session` and `admin_audit_event` are operator-side (the first SUPER_ADMIN and the operator trail are kept on
 *     purpose); `__drizzle_migrations` is the migration journal. Both are reported, never counted as test data.
 * A table that exists but is not in the registry is reported as `unregistered` (and makes the result not clean): nothing is guessed.
 *
 *   DATABASE_URL=... node dist/scripts/stabilization-audit.js [--require-clean]      (exit 1 when --require-clean and not clean)
 */
const OPERATOR_SIDE = new Set(["admin_user", "admin_session", "admin_audit_event"]);
const JOURNAL = new Set(["__drizzle_migrations"]);
const ident = (s: string): string => `"${s.replace(/"/g, '""')}"`;

export interface TableCount { table: string; dataClass: string; rows: number }
export interface AuditReport {
  clean: boolean;
  /** Customer / project data tables that still hold rows (must be empty before PRODUCCIÓN). */
  testData: TableCount[];
  /** Operator-side tables kept on purpose, with their row counts (informational). */
  operatorSide: TableCount[];
  /** Tables present in the database but missing from the registry (not clean until classified). */
  unregistered: string[];
  /** Governed system data that is being kept: tables and total rows (informational). */
  keptGlobal: { tables: number; rows: number };
  /** Tables the registry names that do not exist (a registry drift, not clean). */
  missing: string[];
}

export async function auditStabilizationData(db: Db): Promise<AuditReport> {
  const registry = (await db.query<{ table_name: string; data_class: string }>("SELECT table_name, data_class FROM privacy_erasure_registry ORDER BY table_name")).rows;
  const existing = new Set((await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")).rows.map((r) => r.table_name));
  // the migration journal may live in another schema; it is system data either way
  const known = new Set(registry.map((r) => r.table_name));
  const unregistered = [...existing].filter((t) => !known.has(t) && !JOURNAL.has(t)).sort();
  const missing = registry.map((r) => r.table_name).filter((t) => !existing.has(t)).sort();

  const testData: TableCount[] = [];
  const operatorSide: TableCount[] = [];
  const keptGlobal = { tables: 0, rows: 0 };
  for (const r of registry) {
    if (!existing.has(r.table_name)) continue;
    const rows = Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${ident(r.table_name)}`)).rows[0]?.n ?? "0");
    if (OPERATOR_SIDE.has(r.table_name)) { operatorSide.push({ table: r.table_name, dataClass: r.data_class, rows }); continue; }
    if (r.data_class === "global") { keptGlobal.tables += 1; keptGlobal.rows += rows; continue; }
    if (rows > 0) testData.push({ table: r.table_name, dataClass: r.data_class, rows });
  }
  return { clean: testData.length === 0 && unregistered.length === 0 && missing.length === 0, testData, operatorSide, unregistered, keptGlobal, missing };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const report = await auditStabilizationData(createPoolDb(pool));
    console.log(JSON.stringify({ message: "stabilization data audit", ...report }));
    if (process.argv.includes("--require-clean") && !report.clean) {
      console.error("NOT CLEAN: customer/project test data (or unclassified tables) remain; do not move to PRODUCCIÓN.");
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
