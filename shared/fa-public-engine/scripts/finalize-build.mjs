// Makes the dual build a valid Node package boundary:
//  * dist/cjs is CommonJS, dist/esm is native ESM (package.json "type" markers — a bare .js under a package without "type":"module" is CJS);
//  * relative imports in dist/esm get explicit file extensions (Node's ESM loader does not resolve extensionless specifiers).
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'dist');
writeFileSync(join(root, 'cjs', 'package.json'), '{"type":"commonjs"}\n');
writeFileSync(join(root, 'esm', 'package.json'), '{"type":"module"}\n');

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []; });
for (const file of walk(join(root, 'esm'))) {
  const src = readFileSync(file, 'utf8');
  const out = src.replace(/(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]*)\2/g, (m, pre, q, spec) => {
    if (/\.(js|json|mjs)$/.test(spec)) return m;
    const base = resolve(dirname(file), spec);
    const target = existsSync(`${base}.js`) ? `${spec}.js` : existsSync(join(base, 'index.js')) ? `${spec}/index.js` : spec;
    return `${pre}${q}${target}${q}`;
  });
  if (out !== src) writeFileSync(file, out);
}
