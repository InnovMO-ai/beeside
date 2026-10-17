import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "pg";
import { lintMigration, foreignTablesFromMigrations } from "../db/lint";
import { loadMigrations, MigrationError, MIGRATIONS_DIR, planMigrations, runMigrations } from "../db/runner";
import { describeKl, freshKlDatabase, roleUrl, withSuper } from "../testing/env";

const FOREIGN = foreignTablesFromMigrations(path.resolve(__dirname, "../../../db/migrations"));

describe("lint de migraciones (X21)", () => {
  it("las migraciones de KL pasan el lint", () => {
    for (const f of loadMigrations()) expect({ file: f.name, findings: lintMigration(f.sql, { foreignTables: FOREIGN }) }).toEqual({ file: f.name, findings: [] });
  });

  const bad: Array<[string, string, string]> = [
    ["referencia a public.*", "INSERT INTO public.fa_project VALUES (1);", "no-public"],
    ["tabla creada sin esquema", "CREATE TABLE widget (id int);", "qualify-kl"],
    ["otra base (tres partes)", "SELECT * FROM beeside.public.admin_user;", "no-cross-database"],
    ["dblink", "SELECT dblink('dbname=beeside', 'select 1');", "no-cross-database"],
    ["esquema ajeno", "SELECT 1 FROM discovery.project;", "only-kl-schema"],
    ["tabla de Discovery sin esquema", "SELECT * FROM admin_user;", "no-foreign-table"],
    ["llave foránea hacia Precision/Discovery", "CREATE TABLE kl.x (a uuid REFERENCES admin_session(session_id));", "no-foreign-table"],
    ["GRANT a PUBLIC", "GRANT SELECT ON kl.principal TO PUBLIC;", "no-public-grant"],
    ["crear rol", "CREATE ROLE evil LOGIN;", "no-global-objects"],
    ["SECURITY DEFINER sin search_path", "CREATE FUNCTION kl.f() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;", "definer-search-path"],
    ["control de transacción", "COMMIT;", "no-tx-control"],
  ];
  it.each(bad)("rechaza: %s", (_label, sql, rule) => {
    const rules = lintMigration(sql, { foreignTables: FOREIGN }).map((f) => f.rule);
    expect(rules).toContain(rule);
  });

  it("permite únicamente la instrucción exacta sobre public que exige §8.2 y no confunde literales ni comentarios", () => {
    expect(lintMigration("REVOKE ALL ON SCHEMA public FROM PUBLIC;")).toEqual([]);
    expect(lintMigration("-- public.fa_project\nSELECT 'public.x FROM admin_user' ;")).toEqual([]);
  });
});

describe("planificador de migraciones (X20, sin base)", () => {
  const files = loadMigrations();
  const journal = files.map((f) => ({ name: f.name, number: f.number, sha256: f.sha256 }));

  it("sin nada aplicado, todo está pendiente y en orden", () => {
    expect(planMigrations(files, []).map((f) => f.name)).toEqual(files.map((f) => f.name));
  });
  it("un archivo aplicado que cambió falla", () => {
    const tampered = files.map((f, i) => (i === 0 ? { ...f, sha256: "0".repeat(64) } : f));
    expect(() => planMigrations(tampered, journal)).toThrow(/APPLIED_FILE_CHANGED/);
  });
  it("un archivo aplicado que desapareció falla", () => {
    const withGhost = [...journal, { name: "KL-0099_fantasma", number: 99, sha256: "1".repeat(64) }];
    expect(() => planMigrations(files, withGhost)).toThrow(/APPLIED_FILE_MISSING/);
  });
});

describeKl("runner contra PostgreSQL 16 efímero (X20)", () => {
  const copyDir = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-mig-"));
    for (const f of fs.readdirSync(MIGRATIONS_DIR)) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    return dir;
  };
  const journalCount = async () => {
    const c = new Client({ connectionString: roleUrl("kl_owner") });
    await c.connect();
    try {
      return (await c.query<{ n: string }>("SELECT count(*) AS n FROM kl.__kl_migrations")).rows[0]?.n;
    } finally {
      await c.end();
    }
  };

  beforeEach(() => freshKlDatabase({ migrate: false }));

  it("aplica todo, registra el SHA-256 y una segunda corrida no hace nada", async () => {
    const first = await runMigrations({ connectionString: roleUrl("kl_owner"), foreignMigrationsDir: path.resolve(__dirname, "../../../db/migrations") });
    expect(first.applied.length).toBe(loadMigrations().length);
    expect(await journalCount()).toBe(String(first.applied.length));
    const again = await runMigrations({ connectionString: roleUrl("kl_owner") });
    expect(again.applied).toEqual([]);
  });

  it("archivo ya aplicado modificado: falla sin aplicar nada más", async () => {
    const dir = copyDir();
    await runMigrations({ connectionString: roleUrl("kl_owner"), dir });
    const first = loadMigrations(dir)[0] as { name: string };
    fs.appendFileSync(path.join(dir, `${first.name}.sql`), "\n-- cambio posterior\n");
    // se añade además una migración nueva válida: no debe aplicarse
    fs.writeFileSync(path.join(dir, `KL-9998_x.sql`), "SELECT 1;");
    await expect(runMigrations({ connectionString: roleUrl("kl_owner"), dir })).rejects.toThrow(/APPLIED_FILE_CHANGED|GAP/);
    expect(await journalCount()).toBe(String(loadMigrations(dir).filter((f) => f.number <= loadMigrations(MIGRATIONS_DIR).at(-1)!.number).length));
  });

  it("hueco en la numeración: falla sin aplicar nada", async () => {
    const dir = copyDir();
    const last = loadMigrations(dir).at(-1) as { number: number };
    const next = String(last.number + 2).padStart(4, "0");
    fs.writeFileSync(path.join(dir, `KL-${next}_salto.sql`), "SELECT 1;");
    fs.writeFileSync(path.join(dir, `KL-${next}_salto_integrity.sql`), "SELECT 1;");
    await expect(runMigrations({ connectionString: roleUrl("kl_owner"), dir })).rejects.toThrow(/GAP/);
    const c = new Client({ connectionString: roleUrl("kl_owner") });
    await c.connect();
    const exists = await c.query("SELECT to_regclass('kl.__kl_migrations') AS j, to_regclass('kl.principal') AS p");
    await c.end();
    expect((exists.rows[0] as { p: string | null }).p).toBeNull();
  });

  it("número menor que el último aplicado: falla", async () => {
    const dir = copyDir();
    await runMigrations({ connectionString: roleUrl("kl_owner"), dir });
    // se reemplaza KL-0001 por otro archivo con el mismo número pero otro nombre de tema
    const files = loadMigrations(dir);
    const one = files.filter((f) => f.number === 1);
    for (const f of one) fs.renameSync(path.join(dir, `${f.name}.sql`), path.join(dir, `${f.name.replace("base", "otra")}.sql`));
    await expect(runMigrations({ connectionString: roleUrl("kl_owner"), dir })).rejects.toBeInstanceOf(MigrationError);
  });

  it("un archivo que no cumple el patrón KL-NNNN falla", async () => {
    const dir = copyDir();
    fs.writeFileSync(path.join(dir, "0099_compartida.sql"), "SELECT 1;");
    await expect(runMigrations({ connectionString: roleUrl("kl_owner"), dir })).rejects.toThrow(/BAD_FILE_NAME/);
  });

  it("solo corre contra beeside_kl como kl_owner", async () => {
    await withSuper((c) => c.query("DROP DATABASE IF EXISTS otra_kl WITH (FORCE)").then(() => c.query("CREATE DATABASE otra_kl OWNER kl_owner")));
    await expect(runMigrations({ connectionString: roleUrl("kl_owner", "otra_kl") })).rejects.toThrow(/WRONG_DATABASE/);
    await expect(runMigrations({ connectionString: roleUrl("kl_app") })).rejects.toThrow(/WRONG_ROLE|permission denied/);
    await withSuper((c) => c.query("DROP DATABASE IF EXISTS otra_kl WITH (FORCE)"));
  });

  it("el lint de un archivo nuevo con una referencia a public detiene todo antes de aplicar", async () => {
    const dir = copyDir();
    const next = String(loadMigrations(dir).at(-1)!.number + 1).padStart(4, "0");
    fs.writeFileSync(path.join(dir, `KL-${next}_mala.sql`), "CREATE TABLE public.leak (id int);");
    fs.writeFileSync(path.join(dir, `KL-${next}_mala_integrity.sql`), "SELECT 1;");
    await expect(runMigrations({ connectionString: roleUrl("kl_owner"), dir })).rejects.toThrow(/LINT_FAILED/);
  });
});
