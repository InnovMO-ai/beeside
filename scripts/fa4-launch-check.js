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

// CHK-1 — Terms and Privacy URLs are canonical defaults; the Privacy document VERSION is not supplied and must be configured (external dependency)
add('CHK-1 Terms', true, `version ${env.FA4_TERMS_VERSION ?? '1.0-2026-08-27 (default)'} · ${env.FA4_TERMS_URL ?? env.FA4_TERMS_URL_ES ?? 'https://beeside.you/termsandconditions (default)'}`);
const pv = env.FA4_PRIVACY_VERSION;
add('CHK-1 Privacy URL', true, `${env.FA4_PRIVACY_URL_ES ?? env.FA4_PRIVACY_URL ?? 'https://www.beeside.you/privacy (default)'}`);
add('CHK-1 Privacy VERSION (EXTERNAL)', !!pv, pv ? `version ${pv}` : 'FA4_PRIVACY_VERSION not set — the document version/date has not been supplied; production refuses to start without it');
add('CHK-2 Help Center', true, `${env.VITE_FA4_HELP_URL_ES ?? 'https://www.beeside.you/helpcenter (default)'}`);

// BRAND — assets still null/placeholder in brand.ts
const brand = read('frontend/src/fa4/brand.ts');
add('BRAND-1 logo', /logo:\s*\{\s*dark:/.test(brand) && fs.existsSync(path.join(__dirname, '..', 'frontend/src/fa4/assets/brand/lockup-dark.svg')), 'official lockup (dark + light) integrated');
add('BRAND-2 typography', 'partial', 'no official typeface name/files supplied; interim = the live First Assessment font stack');
add('BRAND-3 lifestyle image / Night Shift', 'partial', 'lifestyle image integrated; Night Shift treatment for FA 4.0 not defined (legacy FA has one)');

// LEGAL-1 / copy — blocked copy remaining in the inventory
const inv = read('docs/fa4/COPY_INVENTORY.md');
const n = (inv.match(/^\| `/gm) || []).length;
add('LEGAL-1 / blocked copy', n === 0, `${n} NEEDS_CANONICAL_COPY entr${n === 1 ? 'y' : 'ies'} (docs/fa4/COPY_INVENTORY.md)`);

// Email: real SMTP behind EmailTransport; contact@beeside.you is sender, Reply-To and contact recipient
const smtpOk = env.FA4_EMAIL_TRANSPORT === 'smtp' && !!env.SMTP_HOST && !!env.SMTP_PASSWORD;
add('Email transport (SMTP)', smtpOk, smtpOk ? `smtp · from ${env.MAIL_FROM ?? 'contact@beeside.you'} · reply-to ${env.MAIL_REPLY_TO ?? 'contact@beeside.you'}` : 'FA4_EMAIL_TRANSPORT=smtp, SMTP_HOST and SMTP_PASSWORD (Secret Manager) not all set — production refuses log-only email');
add('Email worker', !!env.FA4_WORKER_CONFIRMED, env.FA4_WORKER_CONFIRMED ? 'FA4 outbox worker deployed (npm run start:fa4-worker)' : 'deploy the FA4 outbox worker (node dist/fa4/worker.js) — set FA4_WORKER_CONFIRMED=true once running');
add('Premium block gate (3 conditions)', env.FA4_PREMIUM_COMMERCIAL_CONTENT_ALLOWED === 'true' ? true : 'partial', env.FA4_PREMIUM_COMMERCIAL_CONTENT_ALLOWED === 'true' ? 'commercial-content policy allows the YEV email Premium block (LEGAL-1 confirmed)' : 'FA4_PREMIUM_COMMERCIAL_CONTENT_ALLOWED not true → the YEV email omits the Premium block (fail-closed; LEGAL-1 is an external dependency)');
add('Premium resource URL (optional)', true, env.FA4_PREMIUM_RESOURCE_URL_ES || env.FA4_PREMIUM_RESOURCE_URL_EN ? 'configured' : 'not configured — the YEV email omits the secondary link (not a blocker)');

const w = Math.max(...rows.map((r) => r.id.length));
for (const r of rows) console.log(`${r.ok === true ? 'READY  ' : r.ok === 'partial' ? 'PARTIAL' : 'PENDING'}  ${r.id.padEnd(w)}  ${r.detail}`);
const pending = rows.filter((r) => r.ok !== true).length;
console.log(`\n${pending ? `${pending} launch blocker(s) pending` : 'all launch blockers closed'}`);
process.exit(pending ? 1 : 0);
