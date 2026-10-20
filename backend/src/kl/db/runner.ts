import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Client } from "pg";
import { foreignTablesFromMigrations, lintMigration, LintFinding } from "./lint";

/**
 * Runner de migraciones propio de KL (CR-KL-002 §9, B10). Registra número, nombre, SHA-256 y fecha en
 * `kl.__kl_migrations`; falla si hay un hueco, si un archivo ya aplicado cambió o si aparece un número
 * menor que el último aplicado. Nunca omite una migración por su fecha (comportamiento observado en el
 * migrador de Drizzle). Toda la validación ocurre antes de ejecutar nada.
 */
/** Las migraciones viajan junto al código; en la imagen compilada se buscan también en src/ o en KL_MIGRATIONS_DIR. */
export function resolveMigrationsDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.KL_MIGRATIONS_DIR) return env.KL_MIGRATIONS_DIR;
  const local = path.join(__dirname, "migrations");
  if (fs.existsSync(local)) return local;
  const fromDist = path.resolve(__dirname, "../../../src/kl/db/migrations");
  return fs.existsSync(fromDist) ? fromDist : local;
}
export const MIGRATIONS_DIR = resolveMigrationsDir();
export const EXPECTED_DATABASE = "beeside_kl";
export const EXPECTED_ROLE = "kl_owner";
const FILE_RE = /^KL-(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*?)(_integrity)?\.sql$/;
const LOCK_KEY = 7_306_001; // clave de advisory lock propia de kl-migrate

export type MigrationErrorCode =
  | "BAD_FILE_NAME"
  | "GAP"
  | "MISSING_PAIR"
  | "DUPLICATE_NUMBER"
  | "APPLIED_FILE_CHANGED"
  | "APPLIED_FILE_MISSING"
  | "OUT_OF_ORDER"
  | "LINT_FAILED"
  | "WRONG_DATABASE"
  | "WRONG_ROLE"
  | "APPLY_FAILED";

export class MigrationError extends Error {
  constructor(
    readonly code: MigrationErrorCode,
    message: string,
    readonly findings: LintFinding[] = [],
  ) {
    super(`${code}: ${message}`);
    this.name = "MigrationError";
  }
}

export interface MigrationFile {
  number: number;
  /** Nombre del archivo sin extensión, p. ej. `KL-0001_base` o `KL-0001_base_integrity`. */
  name: string;
  topic: string;
  integrity: boolean;
  sql: string;
  sha256: string;
}

export interface JournalRow {
  name: string;
  number: number;
  sha256: string;
}

export function loadMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  const files: MigrationFile[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => !f.startsWith(".")).sort()) {
    const m = FILE_RE.exec(file);
    if (!m) throw new MigrationError("BAD_FILE_NAME", `${file} no cumple KL-NNNN_<tema>[_integrity].sql`);
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    files.push({
      number: Number(m[1]),
      name: file.replace(/\.sql$/, ""),
      topic: m[2] as string,
      integrity: m[3] !== undefined,
      sql,
      sha256: createHash("sha256").update(sql).digest("hex"),
    });
  }
  files.sort((a, b) => a.number - b.number || Number(a.integrity) - Number(b.integrity));
  return files;
}

/** Validaciones de solo archivos: numeración continua y pareja base + `_integrity` por número. */
export function checkFileSet(files: MigrationFile[]): void {
  const numbers = [...new Set(files.map((f) => f.number))].sort((a, b) => a - b);
  numbers.forEach((n, i) => {
    if (n !== i + 1) throw new MigrationError("GAP", `hueco en la numeración: se esperaba KL-${String(i + 1).padStart(4, "0")} y sigue KL-${String(n).padStart(4, "0")}`);
  });
  for (const n of numbers) {
    const group = files.filter((f) => f.number === n);
    const base = group.filter((f) => !f.integrity);
    const integ = group.filter((f) => f.integrity);
    if (base.length !== 1 || integ.length !== 1) throw new MigrationError("DUPLICATE_NUMBER", `KL-${String(n).padStart(4, "0")} debe tener exactamente un archivo base y un _integrity`);
    if (`${(base[0] as MigrationFile).topic}` !== (integ[0] as MigrationFile).topic) throw new MigrationError("MISSING_PAIR", `KL-${String(n).padStart(4, "0")}: base e _integrity deben compartir tema`);
  }
}

/** Decide qué falta por aplicar; lanza antes de ejecutar nada si el estado es inconsistente. */
export function planMigrations(files: MigrationFile[], applied: JournalRow[]): MigrationFile[] {
  checkFileSet(files);
  const byName = new Map(files.map((f) => [f.name, f]));
  for (const row of applied) {
    const file = byName.get(row.name);
    if (!file) throw new MigrationError("APPLIED_FILE_MISSING", `${row.name} está en el journal y ya no existe`);
    if (file.sha256 !== row.sha256) throw new MigrationError("APPLIED_FILE_CHANGED", `${row.name} cambió después de aplicarse`);
  }
  const done = new Set(applied.map((r) => r.name));
  const last = applied.reduce((max, r) => Math.max(max, r.number), 0);
  const pending = files.filter((f) => !done.has(f.name));
  for (const f of pending) {
    if (f.number < last) throw new MigrationError("OUT_OF_ORDER", `${f.name} es anterior al último número aplicado (KL-${String(last).padStart(4, "0")})`);
  }
  return pending;
}

export function lintAll(files: MigrationFile[], foreignTables?: ReadonlySet<string>): void {
  for (const f of files) {
    const findings = lintMigration(f.sql, foreignTables ? { foreignTables } : {});
    if (findings.length > 0) {
      throw new MigrationError("LINT_FAILED", `${f.name}: ${findings.map((x) => `L${x.line} ${x.rule}`).join(", ")}`, findings);
    }
  }
}

export interface RunOptions {
  /** Cadena de conexión de `kl_owner` hacia `beeside_kl`. */
  connectionString: string;
  dir?: string;
  /** Directorio de migraciones de las demás plataformas, para el lint de referencias ajenas. */
  foreignMigrationsDir?: string;
  /** Solo valida y reporta lo pendiente. */
  dryRun?: boolean;
  /** Solo para la base de ensayo (M1 opción b); el CLI de producción no lo expone y exige `beeside_kl`. */
  expectedDatabase?: string;
}

export interface RunResult {
  applied: string[];
  pending: string[];
}

export const JOURNAL_DDL = `
CREATE SCHEMA IF NOT EXISTS kl;
CREATE TABLE IF NOT EXISTS kl.__kl_migrations (
  seq        integer PRIMARY KEY,
  name       text NOT NULL UNIQUE,
  number     integer NOT NULL,
  sha256     text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL DEFAULT current_user
)`;

export async function runMigrations(options: RunOptions): Promise<RunResult> {
  const files = loadMigrations(options.dir);
  checkFileSet(files);
  const foreign = options.foreignMigrationsDir ? foreignTablesFromMigrations(options.foreignMigrationsDir) : undefined;
  lintAll(files, foreign);

  const client = new Client({ connectionString: options.connectionString });
  await client.connect();
  try {
    const who = await client.query<{ db: string; usr: string }>("SELECT current_database() AS db, current_user AS usr");
    if (who.rows[0]?.db !== (options.expectedDatabase ?? EXPECTED_DATABASE)) throw new MigrationError("WRONG_DATABASE", `la base es ${who.rows[0]?.db}, no ${options.expectedDatabase ?? EXPECTED_DATABASE}`);
    if (who.rows[0]?.usr !== EXPECTED_ROLE) throw new MigrationError("WRONG_ROLE", `el rol es ${who.rows[0]?.usr}, no ${EXPECTED_ROLE}`);
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    try {
      await client.query(JOURNAL_DDL);
      const journal = await client.query<JournalRow>("SELECT name, number, sha256 FROM kl.__kl_migrations ORDER BY seq");
      const pending = planMigrations(files, journal.rows);
      if (options.dryRun) return { applied: [], pending: pending.map((f) => f.name) };
      const applied: string[] = [];
      let seq = journal.rows.length;
      for (const file of pending) {
        try {
          await client.query("BEGIN");
          await client.query(file.sql);
          seq += 1;
          await client.query("INSERT INTO kl.__kl_migrations (seq, name, number, sha256) VALUES ($1, $2, $3, $4)", [seq, file.name, file.number, file.sha256]);
          await client.query("COMMIT");
          applied.push(file.name);
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw new MigrationError("APPLY_FAILED", `${file.name}: ${(error as Error).message}`);
        }
      }
      return { applied, pending: [] };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    await client.end();
  }
}
