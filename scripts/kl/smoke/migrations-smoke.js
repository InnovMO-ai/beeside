#!/usr/bin/env node
/* Smoke de las migraciones empaquetadas (sin base de datos): el conjunto es contiguo, cada migración tiene su par _integrity,
 * las huellas se calculan y pasan el lint de KL contra las tablas de las demás plataformas (backend/db/migrations en la imagen).
 * Comprueba que el Dockerfile copió los archivos exactamente donde el código compilado los busca. Uso: node migrations-smoke.js */
const path = require("node:path");
const dist = process.env.KL_DIST || path.resolve(process.cwd(), "dist");
const runner = require(path.join(dist, "kl", "db", "runner"));
const lint = require(path.join(dist, "kl", "db", "lint"));
const foreignDir = process.env.KL_LINT_FOREIGN_MIGRATIONS || path.resolve(dist, "..", "db", "migrations");
try {
  const files = runner.loadMigrations(runner.MIGRATIONS_DIR);
  runner.checkFileSet(files);
  const foreign = lint.foreignTablesFromMigrations(foreignDir);
  if (foreign.size === 0) throw new Error(`sin migraciones de otras plataformas en ${foreignDir}: el lint no tendría con qué comparar`);
  runner.lintAll(files, foreign);
  process.stdout.write(JSON.stringify({ ok: true, migrationsDir: runner.MIGRATIONS_DIR, files: files.length, last: files[files.length - 1].name ?? null, foreignTables: foreign.size }) + "\n");
} catch (e) {
  process.stderr.write(`SMOKE FAIL: ${e && e.message ? e.message : e}\n`);
  process.exit(1);
}
