import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Lint de migraciones de KL (CR-KL-002 §9, prueba X21): solo objetos del esquema `kl`, sin referencias a
 * `public`, a otras bases ni a tablas de Discovery o Precision. El análisis es léxico (no ejecuta SQL) para
 * que pueda correr antes de tocar ninguna base.
 */
export interface LintFinding {
  rule: string;
  line: number;
  message: string;
}

export interface LintOptions {
  /** Tablas de las demás plataformas (Discovery, Precision, plataforma compartida) que KL nunca referencia. */
  foreignTables?: ReadonlySet<string>;
}

/** Instrucción exacta que CR-KL-002 §8.2 exige y que es la única mención permitida de `public`. */
const ALLOWED_PUBLIC_STATEMENT = /REVOKE\s+ALL\s+ON\s+SCHEMA\s+public\s+FROM\s+PUBLIC\s*;/gi;
// old, new y excluded son registros de trigger y de ON CONFLICT, no esquemas.
const ALLOWED_SCHEMAS = new Set(["kl", "pg_catalog", "pg_temp", "information_schema", "old", "new", "excluded"]);

/** Sustituye comentarios y literales de texto por espacios (conserva saltos de línea y longitud). */
export function maskSql(sql: string): string {
  const out: string[] = [];
  let i = 0;
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      out.push(blank(sql.slice(i, stop)));
      i = stop;
    } else if (two === "/*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out.push(blank(sql.slice(i, stop)));
      i = stop;
    } else if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      out.push("'" + blank(sql.slice(i + 1, j)) + "'");
      i = j + 1;
    } else {
      out.push(sql[i] as string);
      i++;
    }
  }
  return out.join("");
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === "\n") line++;
  return line;
}

export function foreignTablesFromMigrations(dir: string): Set<string> {
  const names = new Set<string>();
  if (!fs.existsSync(dir)) return names;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".sql")) continue;
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    for (const m of text.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) names.add((m[1] as string).toLowerCase());
  }
  return names;
}

export function lintMigration(sql: string, options: LintOptions = {}): LintFinding[] {
  const findings: LintFinding[] = [];
  let masked = maskSql(sql);
  // La única mención permitida de `public`: se neutraliza antes de buscar las demás.
  masked = masked.replace(ALLOWED_PUBLIC_STATEMENT, (m) => " ".repeat(m.length));
  const add = (rule: string, index: number, message: string) => findings.push({ rule, line: lineOf(masked, index), message });
  const each = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    for (const m of masked.matchAll(re)) fn(m);
  };

  each(/\bpublic\s*\./gi, (m) => add("no-public", m.index ?? 0, "referencia al esquema public"));
  each(/\bSCHEMA\s+public\b/gi, (m) => add("no-public", m.index ?? 0, "referencia al esquema public"));
  each(/\bsearch_path\b[^;]*\bpublic\b/gi, (m) => add("no-public", m.index ?? 0, "search_path incluye public"));
  each(/\bTO\s+PUBLIC\b/gi, (m) => add("no-public-grant", m.index ?? 0, "ningún permiso se concede a PUBLIC"));

  each(/\\connect\b|\bdblink\b|\bpostgres_fdw\b/gi, (m) => add("no-cross-database", m.index ?? 0, `referencia a otra base (${m[0]})`));
  each(/\bCREATE\s+(?:DATABASE|ROLE|USER|EXTENSION|SERVER|FOREIGN)\b/gi, (m) => add("no-global-objects", m.index ?? 0, `objeto global no permitido en migraciones: ${m[0]}`));
  each(/\bALTER\s+(?:ROLE|USER|DATABASE)\b/gi, (m) => add("no-global-objects", m.index ?? 0, `objeto global no permitido en migraciones: ${m[0]}`));
  each(/\bDROP\s+(?:DATABASE|ROLE|USER|SCHEMA)\b/gi, (m) => add("no-global-objects", m.index ?? 0, `objeto global no permitido en migraciones: ${m[0]}`));
  each(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi, (m) => {
    if ((m[1] as string).toLowerCase() !== "kl") add("no-cross-database", m.index ?? 0, `nombre de tres partes fuera de kl: ${m[0]}`);
  });

  each(/\b(?:FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES|ONLY)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?\s*\.\s*"?([a-z_][a-z0-9_]*)"?/gi, (m) => {
    const schema = (m[1] as string).toLowerCase();
    if (!ALLOWED_SCHEMAS.has(schema)) add("only-kl-schema", m.index ?? 0, `esquema ajeno a kl: ${schema}.${m[2]}`);
  });
  const foreign = options.foreignTables ?? new Set<string>();
  if (foreign.size > 0) {
    const flag = (m: RegExpMatchArray) => {
      const name = (m[1] as string).toLowerCase();
      if (foreign.has(name)) add("no-foreign-table", m.index ?? 0, `tabla de otra plataforma: ${name}`);
    };
    // FROM / JOIN seguidos de un nombre sin esquema (se excluyen llamadas a funciones como FROM unnest(...)).
    each(/\b(?:FROM|JOIN)\s+"?([a-z_][a-z0-9_]*)"?(?!\s*\.)(?![a-z0-9_(])/gi, flag);
    each(/\b(?:INTO|UPDATE|TABLE|REFERENCES|ONLY)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?(?!\s*\.)(?![a-z0-9_])/gi, flag);
  }

  each(/\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:UNIQUE\s+)?(?:TABLE|VIEW|MATERIALIZED\s+VIEW|FUNCTION|TYPE|SEQUENCE|DOMAIN)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?!kl\.)/gi, (m) =>
    add("qualify-kl", m.index ?? 0, "todo objeto se crea con nombre calificado kl.*"),
  );
  each(/\b(?:CREATE\s+(?:UNIQUE\s+)?INDEX\b[^;]*?\bON|CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\b[^;]*?\bON)\s+(?:ONLY\s+)?(?!kl\.)/gi, (m) => add("qualify-kl", m.index ?? 0, "índices y triggers se crean sobre tablas kl.*"));
  each(/\bALTER\s+(?:TABLE|FUNCTION|TYPE|VIEW)\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?!kl\.)/gi, (m) => add("qualify-kl", m.index ?? 0, "ALTER solo sobre objetos kl.*"));
  each(/\bDROP\s+(?:TABLE|VIEW|FUNCTION|TYPE|TRIGGER)\s+(?:IF\s+EXISTS\s+)?(?!kl\.)(?!\S+\s+ON\s+kl\.)/gi, (m) => add("qualify-kl", m.index ?? 0, "DROP solo sobre objetos kl.*"));

  each(/^\s*(?:BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\s*;/gim, (m) => add("no-tx-control", m.index ?? 0, "el runner controla la transacción"));

  // Funciones SECURITY DEFINER: search_path fijo y sin public.
  const starts = [...masked.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi)].map((m) => m.index ?? 0);
  starts.forEach((start, k) => {
    const block = masked.slice(start, starts[k + 1] ?? masked.length);
    if (/SECURITY\s+DEFINER/i.test(block) && !/SET\s+search_path\s*=\s*kl\s*,\s*pg_temp/i.test(block)) {
      add("definer-search-path", start, "SECURITY DEFINER exige SET search_path = kl, pg_temp");
    }
  });

  return findings.sort((a, b) => a.line - b.line);
}
