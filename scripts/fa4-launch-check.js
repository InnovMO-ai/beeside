#!/usr/bin/env node
/**
 * FA4 launch-readiness report. Reads the environment the release will use (backend FA4_* and frontend VITE_FA4_* variables) and the repo,
 * prints each launch blocker as READY / PENDING and exits 1 while any is pending. It never invents or defaults a value: a placeholder is PENDING.
 *   FA4_PRIVACY_VERSION=… FA4_PRIVACY_URL=… VITE_FA4_PRIVACY_URL=… node scripts/fa4-launch-check.js
 */
const fs = require('node:fs');
const path = require('node:path');
const env = process.env;
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const rows = [];
const add = (id, ok, detail) => rows.push({ id, ok, detail });

// CHK-1 — Terms (official defaults exist) and Privacy (must be provided)
add('CHK-1 Terms', true, `version ${env.FA4_TERMS_VERSION ?? '1.0-2026-08-27 (default)'} · ${env.FA4_TERMS_URL ?? env.FA4_TERMS_URL_ES ?? 'https://www.beeside.you/termsandconditions (default)'}`);
const pv = env.FA4_PRIVACY_VERSION, pe = env.FA4_PRIVACY_URL_ES ?? env.FA4_PRIVACY_URL, pn = env.FA4_PRIVACY_URL_EN ?? env.FA4_PRIVACY_URL;
add('CHK-1 Privacy (backend evidence)', !!(pv && pe && pn), pv && pe && pn ? `version ${pv} · ${pe}` : 'FA4_PRIVACY_VERSION and FA4_PRIVACY_URL (or _ES/_EN) not set');
const fe = env.VITE_FA4_PRIVACY_URL_ES ?? env.VITE_FA4_PRIVACY_URL, fn = env.VITE_FA4_PRIVACY_URL_EN ?? env.VITE_FA4_PRIVACY_URL;
add('CHK-1 Privacy (frontend link)', !!(fe && fn), fe && fn ? fe : 'VITE_FA4_PRIVACY_URL (or _ES/_EN) not set — the build would link a placeholder');

// BRAND — assets still null/placeholder in brand.ts
const brand = read('frontend/src/fa4/brand.ts');
add('BRAND-1 logo', !/logo:\s*\{\s*src:\s*null/.test(brand), 'BRAND.logo.src');
add('BRAND-2 typography', !/system-ui/.test(brand), 'BRAND.fontStack');
add('BRAND-3 lifestyle image / Night Shift', !/lifestyleImage:\s*\{\s*src:\s*null/.test(brand), 'BRAND.lifestyleImage.src');

// LEGAL-1 / copy — blocked copy remaining in the inventory
const inv = read('docs/fa4/COPY_INVENTORY.md');
const n = (inv.match(/^\| `/gm) || []).length;
add('LEGAL-1 / blocked copy', n === 0, `${n} NEEDS_CANONICAL_COPY entr${n === 1 ? 'y' : 'ies'} (docs/fa4/COPY_INVENTORY.md)`);

// Email provider
add('Email provider', !!env.FA4_EMAIL_PROVIDER_CONFIGURED, env.FA4_EMAIL_PROVIDER_CONFIGURED ? 'configured' : 'no provider behind EmailTransport (logs/captures only)');

const w = Math.max(...rows.map((r) => r.id.length));
for (const r of rows) console.log(`${r.ok ? 'READY  ' : 'PENDING'}  ${r.id.padEnd(w)}  ${r.detail}`);
const pending = rows.filter((r) => !r.ok).length;
console.log(`\n${pending ? `${pending} launch blocker(s) pending` : 'all launch blockers closed'}`);
process.exit(pending ? 1 : 0);
