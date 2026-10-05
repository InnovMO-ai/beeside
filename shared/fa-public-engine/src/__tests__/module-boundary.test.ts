import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * Package boundary: the built package must resolve the same named exports from native ESM (`import`) and CommonJS (`require`), for the
 * root and the `./seed` / `./testing` sub-paths, through the package's own "exports" map — exactly what Node (Linux CI, Playwright,
 * Vite SSR) does. Runs against `dist`, so `npm run build` must have run (the workspace `pretest` hooks guarantee it).
 */
const pkgDir = path.resolve(__dirname, '..', '..');
const run = (args: string[]) => spawnSync(process.execPath, args, { cwd: pkgDir, encoding: 'utf8' });

const esm = `
import { emptyAnswers, buildYourExpansionView, resolveAll } from '@beeside/fa-public-engine';
import { SEED_CATALOG } from '@beeside/fa-public-engine/seed';
import { journeyA, journeyB, journeyC } from '@beeside/fa-public-engine/testing';
const ok = [emptyAnswers, buildYourExpansionView, resolveAll, journeyA, journeyB, journeyC].every((f) => typeof f === 'function') && SEED_CATALOG.capabilities.length > 0;
console.log(JSON.stringify({ ok, empty: emptyAnswers('es').locale }));
`;
const cjs = `
const e = require('@beeside/fa-public-engine');
const { SEED_CATALOG } = require('@beeside/fa-public-engine/seed');
const t = require('@beeside/fa-public-engine/testing');
const ok = [e.emptyAnswers, e.buildYourExpansionView, e.resolveAll, t.journeyA, t.journeyB, t.journeyC].every((f) => typeof f === 'function') && SEED_CATALOG.capabilities.length > 0;
console.log(JSON.stringify({ ok, empty: e.emptyAnswers('es').locale }));
`;

describe('package module boundary (ESM + CJS + sub-paths)', () => {
  it('native ESM resolves named exports from ".", "./seed" and "./testing"', () => {
    const r = run(['--input-type=module', '-e', esm]);
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, empty: 'es' });
  });
  it('CommonJS resolves the same exports', () => {
    const r = run(['-e', cjs]);
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, empty: 'es' });
  });
  it('the ESM tree is marked as a module and uses explicit relative extensions', () => {
    const r = run(['-e', `
      const fs = require('fs'); const p = require('path');
      const m = (d) => JSON.parse(fs.readFileSync(p.join('dist', d, 'package.json'), 'utf8')).type;
      const bad = []; const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { const f = p.join(d, e.name); if (e.isDirectory()) return walk(f);
        if (!f.endsWith('.js')) return; for (const x of fs.readFileSync(f, 'utf8').matchAll(/(?:from|import)\\s*['"](\\.{1,2}\\/[^'"]+)['"]/g)) if (!/\\.(js|json)$/.test(x[1])) bad.push(f + ' ' + x[1]); });
      walk('dist/esm'); console.log(JSON.stringify({ esm: m('esm'), cjs: m('cjs'), bad }));`]);
    expect(JSON.parse(r.stdout)).toEqual({ esm: 'module', cjs: 'commonjs', bad: [] });
  });
});
