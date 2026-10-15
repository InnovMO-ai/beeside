#!/usr/bin/env node
/**
 * Discovery Public v1.0 — PRODUCTION PREFLIGHT. Refuses a production deployment (exit 1) while any required configuration is missing or invalid.
 * Pure: it reads an env file / the environment (and optionally the built frontend), prints SET / MISSING / INVALID / EXTERNAL per item and NEVER prints a secret value
 * (secrets are referenced by their Secret Manager NAME only). It makes no network or gcloud call unless --verify-gcloud is passed (read-only `describe`).
 *
 *   node scripts/fa4-production-preflight.js --env-file deploy/production/production.env [--dist frontend/dist] [--verify-gcloud]
 *
 * Classes:  BLOCKED   → deployment refused.
 *           EXTERNAL  → decided/provided outside Code (DNS, org policy, Legal…); BLOCKED unless confirmed with the matching *_CONFIRMED=true flag.
 *           WARN      → allowed, but must be read.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DEV_PROJECTS = new Set(['beeside-dev-508220', 'pure-pact-508219-j5']);
const DEV_INSTANCES = new Set(['beeside-dev-canonical-db']);
const truthy = (v) => String(v ?? '').toLowerCase() === 'true';
const set = (v) => v !== undefined && String(v).trim() !== '';

function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line); if (!m) continue;
    const value = m[2].trim(); const quoted = /^(['"])(.*)\1$/.exec(value);
    out[m[1]] = quoted ? quoted[2] : value.replace(/(^|\s+)#.*$/, '').trim();   // inline comments are not part of the value
  }
  return out;
}

/** evaluate(env, opts) → { rows: [{id, status, detail}], blocked: number } — status ∈ SET | MISSING | INVALID | EXTERNAL | WARN | OK */
function evaluate(env, opts = {}) {
  const rows = []; const add = (id, status, detail = '') => rows.push({ id, status, detail });
  const need = (id, cond, detail) => add(id, cond ? 'SET' : 'MISSING', cond ? detail ?? '' : detail ?? 'not set');
  const must = (id, cond, bad) => add(id, cond ? 'OK' : 'INVALID', cond ? '' : bad);
  const external = (id, flag, what) => add(id, truthy(env[flag]) ? 'SET' : 'EXTERNAL', truthy(env[flag]) ? `${flag}=true` : `${what} — confirm with ${flag}=true once done`);

  // ---- target environment (never dev, never shared with dev data)
  need('PROJECT_ID', set(env.PROJECT_ID));
  must('PROJECT_ID is a production project', !DEV_PROJECTS.has(env.PROJECT_ID ?? ''), 'refusing: this is a development project; real prospect data must not live there');
  need('REGION', set(env.REGION));
  need('SQL_CONNECTION_NAME', /^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$/.test(env.SQL_CONNECTION_NAME ?? ''), 'expected project:region:instance');
  must('Cloud SQL instance is not the dev instance', !DEV_INSTANCES.has((env.SQL_CONNECTION_NAME ?? '').split(':')[2] ?? ''), 'refusing: shared dev instance');
  need('IMAGE_TAG', set(env.IMAGE_TAG) && !/^(latest|dev)$/.test(env.IMAGE_TAG ?? ''), 'a pinned tag (the commit SHA), never latest');

  // ---- public identity and routes
  must('PUBLIC_BASE_URL = https host without path', /^https:\/\/[a-z0-9.-]+$/.test(env.PUBLIC_BASE_URL ?? ''), 'must look like https://beeside.you');
  must('PUBLIC_PATH = /discovery', env.PUBLIC_PATH === '/discovery', 'the customer-facing production path is /discovery (never /fa4)');
  must('FA4_PUBLIC_PATH matches PUBLIC_PATH (e-mailed links)', env.FA4_PUBLIC_PATH === env.PUBLIC_PATH, 'e-mailed links would not point at the public path');
  must('APP_BASE_URL = PUBLIC_BASE_URL', env.APP_BASE_URL === env.PUBLIC_BASE_URL, 'APP_BASE_URL must equal the public origin (also hosts the e-mail logo)');
  must('ALLOWED_ORIGINS = public origin', env.ALLOWED_ORIGINS === env.PUBLIC_BASE_URL, 'the API origin guard must allow exactly the public origin');
  must('VITE_BASE_PATH = /discovery/', env.VITE_BASE_PATH === '/discovery/', 'the web build must use the path prefix');
  must('VITE_DISCOVERY_ONLY = true', env.VITE_DISCOVERY_ONLY === 'true', 'the production bundle must contain nothing but Discovery');
  must('/ops-control reserved (no admin surface wired)', env.OPS_CONTROL_MODE === 'reserved', 'OPS_CONTROL_MODE must be "reserved" until the Discovery administration surface is connected');
  must('node environment', env.NODE_ENV === 'production', 'NODE_ENV must be production');
  must('no internal-staging mode', !set(env.FA4_ENV) && !set(env.STAGING_BASIC_AUTH) && !set(env.STAGING_TEST_LEGAL) && !set(env.ROOT_REDIRECT), 'FA4_ENV / STAGING_* / ROOT_REDIRECT must be unset');
  must('no development switches', !truthy(env.DEV_LOG_EMAIL_LINKS) && !truthy(env.PREMIUM_DEV_SIMULATION) && env.FA4_EMAIL_DISPATCH !== 'inline' && !truthy(env.VITE_FA4_ALLOW_PURCHASE_FALLBACK), 'DEV_LOG_EMAIL_LINKS, PREMIUM_DEV_SIMULATION, FA4_EMAIL_DISPATCH=inline and VITE_FA4_ALLOW_PURCHASE_FALLBACK are not allowed');
  must('migration credential not given to runtime services', !set(env.MIGRATION_DATABASE_URL) && !set(env.DATABASE_URL), 'DATABASE_URL / MIGRATION_DATABASE_URL must be referenced by secret name (SECRET_*), never inlined');

  // ---- secrets (names only)
  for (const k of ['SECRET_DATABASE_URL', 'SECRET_MIGRATION_DATABASE_URL', 'SECRET_HASH', 'SECRET_SMTP_PASSWORD']) need(k, /^[A-Za-z][A-Za-z0-9_-]{2,}$/.test(env[k] ?? ''), 'Secret Manager secret NAME');
  must('runtime and migration secrets differ', set(env.SECRET_DATABASE_URL) && env.SECRET_DATABASE_URL !== env.SECRET_MIGRATION_DATABASE_URL, 'the runtime role and the migration role must use different credentials');
  need('TRUST_PROXY_HOPS', /^[0-5]$/.test(env.TRUST_PROXY_HOPS ?? ''), 'integer 0–5, measured behind the real edge (keys the rate limits)');

  // ---- legal / privacy
  need('FA4_PRIVACY_VERSION', set(env.FA4_PRIVACY_VERSION), 'version identifier of the FINAL Privacy document — external (Legal), never invented; production refuses to start without it');
  must('Privacy / Terms URLs are https', [env.FA4_PRIVACY_URL, env.FA4_TERMS_URL].every((u) => !set(u) || /^https:\/\//.test(u)), 'URLs must be https');
  if (env.LAUNCH_PHASE === 'open') external('LEGAL-1 final validation', 'LEGAL1_CONFIRMED', 'Legal sign-off (Terms, Privacy, retention, consent wording)');
  else add('LEGAL-1 final validation', truthy(env.LEGAL1_CONFIRMED) ? 'SET' : 'WARN', truthy(env.LEGAL1_CONFIRMED) ? 'LEGAL1_CONFIRMED=true' : 'not confirmed: internal tests/presentations only — NO real prospect data until Legal clears it');

  // ---- e-mail
  must('e-mail transport is real SMTP', env.FA4_EMAIL_TRANSPORT === 'smtp', 'FA4_EMAIL_TRANSPORT must be smtp');
  need('SMTP_HOST', set(env.SMTP_HOST)); must('SMTP_PORT is 587 (STARTTLS)', String(env.SMTP_PORT ?? '587') === '587', 'only 587 with STARTTLS is supported');
  must('sender, Reply-To and contact mailbox are contact@beeside.you', [env.SMTP_USER, env.MAIL_FROM, env.MAIL_REPLY_TO, env.FA4_CONTACT_ADDRESS].every((v) => !set(v) || v === 'contact@beeside.you') && set(env.SMTP_USER), 'the single operational mailbox is contact@beeside.you');
  external('SPF / DKIM / DMARC for the sending domain', 'MAIL_DNS_CONFIRMED', 'deliverability DNS records');
  need('FA4 outbox worker', truthy(env.FA4_WORKER_CONFIRMED) || truthy(env.DEPLOY_WORKER), 'the worker is part of this deployment (DEPLOY_WORKER=true)');

  // ---- access: controlled launch is the DEFAULT; opening is an explicit decision
  const phase = env.LAUNCH_PHASE;
  must('LAUNCH_PHASE', phase === 'controlled' || phase === 'open', 'LAUNCH_PHASE must be controlled or open (explicit)');
  const gate = env.ACCESS_GATE_MODE;
  must('ACCESS_GATE_MODE', ['off', 'basic', 'edge'].includes(gate ?? ''), 'must be off | basic | edge (no implicit default)');
  if (phase === 'controlled') {
    must('controlled phase keeps a gate', gate === 'basic' || gate === 'edge', 'a controlled launch needs ACCESS_GATE_MODE=basic or edge');
    must('controlled phase is not indexable', truthy(env.ROBOTS_NOINDEX), 'ROBOTS_NOINDEX=true while the environment is closed');
  }
  if (gate === 'basic') need('SECRET_ACCESS_GATE_CREDENTIALS', /^[A-Za-z][A-Za-z0-9_-]{2,}$/.test(env.SECRET_ACCESS_GATE_CREDENTIALS ?? ''), 'Secret Manager secret NAME (one user:password per line, password ≥ 12)');
  if (gate === 'edge') external('edge access control (IAP / Cloud Armor / proxy)', 'EDGE_GATE_CONFIRMED', 'the gate that protects the service in front of it');
  if (phase === 'open') {
    must('opening commercially is an explicit confirmation', truthy(env.OPEN_COMMERCIAL_CONFIRMED), 'OPEN_COMMERCIAL_CONFIRMED=true required');
    must('open phase: Premium comparison approved', truthy(env.COMPARISON_APPROVED), 'Product/Legal approval of the commercial comparison (COMPARISON_APPROVED=true)');
  }

  // ---- premium
  if (set(env.VITE_FA4_PREMIUM_PURCHASE_URL)) must('VITE_FA4_PREMIUM_PURCHASE_URL is https', /^https:\/\//.test(env.VITE_FA4_PREMIUM_PURCHASE_URL), 'must be https');
  else if (phase === 'open') add('VITE_FA4_PREMIUM_PURCHASE_URL', 'MISSING', 'required to open commercially (EXTERNAL: approved purchase destination)');
  else add('VITE_FA4_PREMIUM_PURCHASE_URL', truthy(env.PREMIUM_PURCHASE_DEFERRED_ACK) ? 'WARN' : 'MISSING', truthy(env.PREMIUM_PURCHASE_DEFERRED_ACK) ? '«Start Your Expansion» is NOT rendered (fail-closed) until the destination exists' : 'not set — acknowledge the hidden CTA with PREMIUM_PURCHASE_DEFERRED_ACK=true or supply the URL');
  if (truthy(env.FA4_PREMIUM_COMMERCIAL_CONTENT_ALLOWED)) must('premium commercial content only with Legal', truthy(env.LEGAL1_CONFIRMED), 'FA4_PREMIUM_COMMERCIAL_CONTENT_ALLOWED=true requires LEGAL1_CONFIRMED=true');

  // ---- platform confirmations (decided outside Code)
  external('production database provisioned (instance, database, owner + runtime login roles)', 'DB_PROVISIONED_CONFIRMED', 'platform');
  external('automated backups enabled', 'DB_BACKUPS_CONFIRMED', 'platform');
  external('point-in-time recovery enabled', 'DB_PITR_CONFIRMED', 'platform');
  external('DNS + load balancer + certificate route beeside.you/discovery here', 'EDGE_ROUTING_CONFIRMED', 'platform/marketing');
  external('org policy allows the edge to invoke Cloud Run', 'ORG_POLICY_CONFIRMED', 'platform/security');
  need('ALERT_CHANNEL (who is notified)', set(env.ALERT_CHANNEL), 'Cloud Monitoring notification channel id — external');

  // ---- built artifact (optional)
  if (opts.dist) {
    const index = path.join(opts.dist, 'index.html');
    if (!fs.existsSync(index)) add('frontend build', 'MISSING', `${index} not found (build with VITE_BASE_PATH=/discovery/ VITE_DISCOVERY_ONLY=true)`);
    else {
      const html = fs.readFileSync(index, 'utf8');
      const refs = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
      must('built index.html references only /discovery/ assets', refs.length > 0 && refs.every((r) => r.startsWith('/discovery/')), `root-relative references found: ${refs.filter((r) => !r.startsWith('/discovery/')).join(', ') || '(none at all)'}`);
    }
  }
  const blocked = rows.filter((r) => ['MISSING', 'INVALID', 'EXTERNAL'].includes(r.status)).length;
  return { rows, blocked };
}

function verifyGcloud(env, rows) {
  for (const k of ['SECRET_DATABASE_URL', 'SECRET_MIGRATION_DATABASE_URL', 'SECRET_HASH', 'SECRET_SMTP_PASSWORD', 'SECRET_ACCESS_GATE_CREDENTIALS']) {
    if (!set(env[k])) continue;
    try { execFileSync('gcloud', ['secrets', 'describe', env[k], '--project', env.PROJECT_ID, '--format=value(name)'], { stdio: 'pipe' }); rows.push({ id: `secret exists: ${env[k]}`, status: 'OK', detail: '' }); }
    catch { rows.push({ id: `secret exists: ${env[k]}`, status: 'MISSING', detail: 'not found in Secret Manager (create it; the preflight never creates secrets)' }); }
  }
}

module.exports = { evaluate, parseEnvFile };

if (require.main === module) {
  const args = process.argv.slice(2); const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const envFile = arg('--env-file'); const env = { ...(envFile ? parseEnvFile(fs.readFileSync(envFile, 'utf8')) : {}), ...(envFile ? {} : process.env) };
  const { rows, blocked } = evaluate(env, { dist: arg('--dist') });
  if (args.includes('--verify-gcloud')) verifyGcloud(env, rows);
  const final = rows.filter((r) => ['MISSING', 'INVALID', 'EXTERNAL'].includes(r.status)).length;
  const w = Math.max(...rows.map((r) => r.id.length));
  for (const r of rows) console.log(`${r.status.padEnd(8)} ${r.id.padEnd(w)}  ${r.detail}`);
  console.log(`\n${final ? `PREFLIGHT FAILED — ${final} item(s) block the production deployment` : 'PREFLIGHT PASSED'}${rows.some((r) => r.status === 'WARN') ? ' (read the WARN lines)' : ''}`);
  process.exit(final ? 1 : 0);
  void blocked;
}
