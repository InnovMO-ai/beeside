#!/usr/bin/env node
/**
 * FA4 load / concurrency driver (no dependencies beyond the workspace: node:http, pg, the engine fixtures).
 *   node perf/fa4/load.mjs --mode levels --levels 25,100,250,500,1000 --duration 45
 *   node perf/fa4/load.mjs --mode burst  --levels 50,100,250,500
 *   node perf/fa4/load.mjs --mode soak   --levels 150 --duration 1800
 * Synthetic users only (*@load.invalid); email is captured by the harness server, never sent.
 * Every virtual user carries a unique marker in its company name, email and free-text need and verifies, client-side and at the end in
 * PostgreSQL, that nothing of any other virtual user ever appears in its answers, results, tokens, mail recipient, signals or catalog version.
 */
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { journeyA, journeyB, journeyC } from '@beeside/fa-public-engine/testing';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const MODE = arg('mode', 'levels');
const LEVELS = arg('levels', '25,100').split(',').map(Number);
const DURATION = Number(arg('duration', 45));
const RAMP = Number(arg('ramp', 10));
const THINK_MS = Number(arg('think', 150));
const BASE = new URL(arg('url', 'http://127.0.0.1:8099'));
const ADMIN_DB = process.env.PERF_ADMIN_DATABASE_URL;
const RUN = Date.now().toString(36);
const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });
// Burst phases use fresh sockets: a macOS loopback quirk resets ~15–25% of simultaneous requests on idle keep-alive sockets even against a 3-line
// hello-world Node server (reproduced), which would otherwise be reported as application errors.
let agentCur = agent;
const admin = new pg.Pool({ connectionString: ADMIN_DB, max: 3 });

// ---------------------------------------------------------------- http
function call(method, path, body, token) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { Accept: 'application/json', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const req = http.request({ agent: agentCur, host: BASE.hostname, port: BASE.port, method, path, headers, timeout: 30000 }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not json */ } resolve({ status: res.statusCode, json, ms: performance.now() - t0 }); });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => resolve({ status: 0, json: null, ms: performance.now() - t0, error: e.code ?? e.message }));
    if (data) req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------- metrics
let M;
const resetMetrics = () => { M = { lat: new Map(), reqs: 0, ok: 0, errors: new Map(), violations: [], flows: 0, flowsOk: 0, started: performance.now() }; };
function rec(name, r, okStatuses = [200, 201]) {
  M.reqs++; (M.win ??= []).push(r.ms); if (!okStatuses.includes(r.status)) M.winErr = (M.winErr ?? 0) + 1;
  const arr = M.lat.get(name) ?? []; arr.push(r.ms); M.lat.set(name, arr);
  if (okStatuses.includes(r.status)) M.ok++; else { const k = `${name}:${r.status || r.error}`; M.errors.set(k, (M.errors.get(k) ?? 0) + 1); }
  return okStatuses.includes(r.status);
}
const violation = (m) => { if (M.violations.length < 50) M.violations.push(m); else M.violations.length === 50 && M.violations.push('… more'); M.violationCount = (M.violationCount ?? 0) + 1; };
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
const summarize = (arr) => ({ n: arr.length, p50: +pct(arr, 50).toFixed(1), p95: +pct(arr, 95).toFixed(1), p99: +pct(arr, 99).toFixed(1), max: +arr.reduce((m, x) => (x > m ? x : m), 0).toFixed(1) });

// ---------------------------------------------------------------- users
const FIXTURES = [journeyA, journeyB, journeyC];
const MARK = /LOAD-[a-z0-9]+-\d+-\d+/g;
function answersFor(vu, iter) {
  const marker = `LOAD-${RUN}-${vu}-${iter}`;
  const a = FIXTURES[(vu + iter) % 3]('es');
  a.identity = { ...a.identity, name: `User ${marker}`, company: marker, email: `u${vu}-${iter}-${RUN}@load.invalid` };
  a.reasonText = `motivo ${marker}`;
  a.addedNeeds = [{ id: 'n1', text: `renta de grúas ${marker}`, destination: a.destinations.list[0]?.iso ?? 'MX' }];
  return { a, marker };
}
const mine = (obj, marker) => { const found = JSON.stringify(obj).match(MARK) ?? []; return found.every((m) => m === marker); };

async function flow(vu, iter, catalogVersion) {
  const { a, marker } = answersFor(vu, iter);
  const email = a.identity.email.toLowerCase();
  M.flows++;
  let ok = true; const need = (cond, msg) => { if (!cond) { ok = false; violation(`${marker}: ${msg}`); } };
  // start FA → create project
  let r = await call('POST', '/api/fa4/sessions', { answers: a, step: 'company' }); if (!rec('create', r)) return;
  const token = r.json.sessionToken;
  await sleep(THINK_MS * Math.random());
  // autosave while answering (conditional questions: add selling → activators appear)
  const b = structuredClone(a);
  r = await call('PUT', '/api/fa4/session', { answers: a, step: 'destinations' }, token); rec('autosave', r);
  b.components = b.components.map((c) => ({ ...c, activities: [...new Set([...c.activities, 'sell'])], withWhat: [...new Set([...c.withWhat, 'goods'])] }));
  r = await call('PUT', '/api/fa4/session', { answers: b, step: 'activity:c1' }, token); rec('autosave', r);
  // server-side resolution (twice: before/after the conditional change)
  r = await call('POST', '/api/fa4/session/resolution', { answers: a }, token); rec('resolution', r);
  need(r.json && !JSON.stringify(r.json).includes('CAP_'), 'resolution leaked a capability id');
  r = await call('POST', '/api/fa4/session/resolution', { answers: b }, token); rec('resolution', r);
  await sleep(THINK_MS * Math.random());
  r = await call('PUT', '/api/fa4/session', { answers: a, step: 'extra' }, token); rec('autosave', r);
  r = await call('GET', '/api/fa4/session', undefined, token); rec('get_session', r);
  need(r.json?.answers?.identity?.company === marker && r.json?.answers?.identity?.email === email, 'session returned another user\'s answers');
  need(mine(r.json, marker), 'session payload contains another marker');
  // generate Your Expansion View (persisted, append-only), then re-deliver (stable signals)
  r = await call('POST', '/api/fa4/session/result', {}, token); const gen = rec('result', r);
  if (gen) {
    need(r.json.model.company === marker, `result is for another company (${r.json.model.company})`);
    need(mine(r.json.model, marker), 'result contains another marker');
    need(r.json.model.catalogVersion === catalogVersion, `result bound to unexpected catalog version ${r.json.model.catalogVersion}`);
    const first = r.json.resultId;
    r = await call('GET', '/api/fa4/session/result', undefined, token); rec('get_result', r);
    need(r.json?.resultId === first && mine(r.json?.model, marker), 'stored result differs / not mine');
    r = await call('POST', '/api/fa4/session/result', {}, token); rec('result', r);
    need(r.json?.model && r.json.model.company === marker, 're-delivered result is not mine');
  }
  // save for later → mail captured → resume link → new session of the SAME project
  r = await call('POST', '/api/fa4/session/finish-later', {}, token); rec('finish_later', r);
  // The harness dispatches inline, so a concurrent request's dispatcher may be the one sending my queued mail: wait for it like a user would.
  let m = { json: null }; const tm = performance.now();
  for (let i = 0; i < 200 && !m.json?.ctaUrl; i++) { m = await call('GET', `/__perf/mail?to=${encodeURIComponent(email)}`); if (!m.json?.ctaUrl) await sleep(50); }
  (M.mailWait ??= []).push(performance.now() - tm);
  if (m.json?.ctaUrl) {
    need(m.json.to.toLowerCase() === email, 'mail captured for another recipient');
    const link = /#r=([^&]+)/.exec(m.json.ctaUrl)?.[1];
    r = await call('POST', '/api/fa4/links/continue', { token: link }); rec('resume_link', r);
    if (r.status === 200) {
      const s2 = await call('GET', '/api/fa4/session', undefined, r.json.sessionToken); rec('get_session', s2);
      need(s2.json?.answers?.identity?.company === marker, 'resume link opened another project');
      const again = await call('POST', '/api/fa4/links/continue', { token: link }); rec('resume_replay', again, [404]);   // single-use
    }
  } else { need(false, 'no mail captured for finish-later'); }
  if (ok) M.flowsOk++;
}

// ---------------------------------------------------------------- sampling
async function sampler(stop, samples) {
  while (!stop.v) {
    const [s, db] = await Promise.all([
      call('GET', '/__perf/stats'),
      admin.query(`SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS conns,
                          (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active') AS active,
                          (SELECT count(*) FROM pg_locks WHERE NOT granted) AS lockwaits,
                          (SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()) AS deadlocks,
                          (SELECT xact_rollback FROM pg_stat_database WHERE datname = current_database()) AS rollbacks`).then((x) => x.rows[0]).catch(() => null),
    ]);
    if (s.json && db && samples.length % 60 === 59) {
      const w = M.win ?? []; M.win = []; const e = M.winErr ?? 0; M.winErr = 0;
      console.error(`[t+${Math.round((performance.now() - M.started) / 1000)}s] req/min=${w.length} err=${e} p50=${pct(w, 50).toFixed(0)} p95=${pct(w, 95).toFixed(0)} p99=${pct(w, 99).toFixed(0)} rss=${s.json.rssMb.toFixed(0)}MB heap=${s.json.heapMb.toFixed(0)}MB dbconns=${db.conns} poolWaiting=${s.json.pool.waiting} lockwaits=${db.lockwaits} deadlocks=${db.deadlocks} viol=${M.violationCount ?? 0}`);
    }
    if (s.json && db) samples.push({ t: performance.now(), ...s.json, db: { conns: +db.conns, active: +db.active, lockwaits: +db.lockwaits, deadlocks: +db.deadlocks, rollbacks: +db.rollbacks } });
    await sleep(1000);
  }
}

// ---------------------------------------------------------------- integrity (PostgreSQL)
async function integrity(catalogVersions) {
  const q = async (sql, v = []) => (await admin.query(sql, v)).rows;
  const like = `%-${RUN}@load.invalid`;
  const out = {};
  out.projects = +(await q('SELECT count(*)::int n FROM fa4_project WHERE email LIKE $1', [like]))[0].n;
  // result_seq: unique, and per project monotonic with creation
  out.results = +(await q('SELECT count(*)::int n FROM fa4_result r JOIN fa4_project p USING (project_id) WHERE p.email LIKE $1', [like]))[0].n;
  out.dupSeq = +(await q('SELECT count(*)::int n FROM (SELECT result_seq FROM fa4_result GROUP BY result_seq HAVING count(*) > 1) x'))[0].n;
  // (created_at is the transaction START time, so concurrent deliveries for one project may be stamped out of seq order: result_seq is the ordering of record)
  // cross-project: every result carries exactly its own company marker
  out.resultWrongOwner = +(await q(`SELECT count(*)::int n FROM fa4_result r JOIN fa4_project p USING (project_id) WHERE p.email LIKE $1 AND r.model->>'company' <> p.answers->'identity'->>'company'`, [like]))[0].n;
  out.resultForeignMarker = +(await q(`SELECT count(*)::int n FROM fa4_result r JOIN fa4_project p USING (project_id) WHERE p.email LIKE $1 AND (SELECT count(DISTINCT m[1]) FROM regexp_matches(r.model::text, '(LOAD-[a-z0-9]+-[0-9]+-[0-9]+)', 'g') m) <> 1`, [like]))[0].n;
  out.answersForeignMarker = +(await q(`SELECT count(*)::int n FROM fa4_project p WHERE p.email LIKE $1 AND (SELECT count(DISTINCT m[1]) FROM regexp_matches(p.answers::text, '(LOAD-[a-z0-9]+-[0-9]+-[0-9]+)', 'g') m) <> 1`, [like]))[0].n;
  out.emailMismatch = +(await q(`SELECT count(*)::int n FROM fa4_project p WHERE p.email LIKE $1 AND p.email <> lower(p.answers->'identity'->>'email')`, [like]))[0].n;
  out.badCatalogVersion = +(await q(`SELECT count(*)::int n FROM fa4_result r JOIN fa4_project p USING (project_id) WHERE p.email LIKE $1 AND r.catalog_version <> ALL($2::text[])`, [like, catalogVersions]))[0].n;
  out.resultVersionMismatch = +(await q(`SELECT count(*)::int n FROM fa4_result r JOIN fa4_project p USING (project_id) WHERE p.email LIKE $1 AND r.model->>'catalogVersion' <> r.catalog_version`, [like]))[0].n;
  // demand signals belong to their project, and are not duplicated per (project, destination, capability/front)
  out.signals = +(await q('SELECT count(*)::int n FROM fa4_demand_signal s JOIN fa4_project p USING (project_id) WHERE p.email LIKE $1', [like]))[0].n;
  out.signalWrongProject = +(await q(`SELECT count(*)::int n FROM fa4_demand_signal s JOIN fa4_project p USING (project_id) WHERE p.email LIKE $1 AND (s.signal_id NOT LIKE 'ds:' || s.project_id || ':%' OR s.payload->>'projectId' <> s.project_id::text)`, [like]))[0].n;
  out.signalForeignMarker = +(await q(`SELECT count(*)::int n FROM fa4_demand_signal s JOIN fa4_project p USING (project_id) WHERE p.email LIKE $1 AND (SELECT count(DISTINCT m[1]) FROM regexp_matches(s.payload::text, '(LOAD-[a-z0-9]+-[0-9]+-[0-9]+)', 'g') m) > 1`, [like]))[0].n;
  // tokens: every token row belongs to a project; no hash is shared by two projects
  out.sharedTokenHash = +(await q('SELECT count(*)::int n FROM (SELECT token_hash FROM fa4_access_token GROUP BY token_hash HAVING count(DISTINCT project_id) > 1) x'))[0].n;
  out.tokens = +(await q('SELECT count(*)::int n FROM fa4_access_token t JOIN fa4_project p USING (project_id) WHERE p.email LIKE $1', [like]))[0].n;
  out.liveResumeTokens = +(await q(`SELECT count(*)::int n FROM fa4_access_token t JOIN fa4_project p USING (project_id) WHERE p.email LIKE $1 AND t.kind = 'RESUME' AND t.used_at IS NULL AND t.revoked_at IS NULL`, [like]))[0].n;
  // email deliveries: one project, one recipient (the project's own address)
  out.deliveries = +(await q('SELECT count(*)::int n FROM fa4_email_delivery d JOIN fa4_project p USING (project_id) WHERE p.email LIKE $1', [like]))[0].n;
  out.sentWrongStatus = +(await q(`SELECT count(*)::int n FROM fa4_email_delivery d JOIN fa4_project p USING (project_id) WHERE p.email LIKE $1 AND d.status NOT IN ('SENT','PENDING','SENDING')`, [like]))[0].n;
  out.projectsWithoutResult = +(await q(`SELECT count(*)::int n FROM fa4_project p WHERE p.email LIKE $1 AND NOT EXISTS (SELECT 1 FROM fa4_result r WHERE r.project_id = p.project_id) AND p.status = 'DELIVERED'`, [like]))[0].n;
  out.deliveredWithoutResult = out.projectsWithoutResult;
  const bad = ['dupSeq', 'resultWrongOwner', 'resultForeignMarker', 'answersForeignMarker', 'emailMismatch', 'badCatalogVersion', 'resultVersionMismatch', 'signalWrongProject', 'signalForeignMarker', 'sharedTokenHash', 'sentWrongStatus', 'deliveredWithoutResult'];
  out.violations = bad.filter((k) => out[k] > 0).map((k) => `${k}=${out[k]}`);
  return out;
}

// ---------------------------------------------------------------- level runner
async function dbCounters() { const r = (await admin.query(`SELECT deadlocks, xact_rollback, conflicts FROM pg_stat_database WHERE datname = current_database()`)).rows[0]; return { deadlocks: +r.deadlocks, rollbacks: +r.xact_rollback }; }
async function runLevel(users, seconds) {
  resetMetrics();
  const catalogVersion = (await call('GET', '/api/fa4/catalog')).json.version;
  const before = await dbCounters(); const samples = []; const stop = { v: false }; const s = sampler(stop, samples);
  const end = performance.now() + (RAMP + seconds) * 1000; let vuN = 0; const vus = [];
  for (let i = 0; i < users; i++) {
    const id = ++vuN; const delay = (RAMP * 1000 * i) / users;
    vus.push((async () => { await sleep(delay); let iter = 0; while (performance.now() < end) { await flow(id, iter++, catalogVersion).catch((e) => violation(`vu${id} crashed: ${e.message}`)); await sleep(THINK_MS); } })());
  }
  await Promise.all(vus); stop.v = true; await s;
  const elapsed = (performance.now() - M.started) / 1000; const after = await dbCounters();
  const all = [].concat(...M.lat.values());
  const per = Object.fromEntries([...M.lat].map(([k, v]) => [k, summarize(v)]));
  const peak = (f) => samples.reduce((m, x) => Math.max(m, f(x)), 0);
  const rss = samples.map((x) => x.rssMb);
  const integ = await integrity([catalogVersion]);
  return {
    users, seconds: +elapsed.toFixed(1), flows: M.flows, flowsOk: M.flowsOk, requests: M.reqs, rps: +(M.reqs / elapsed).toFixed(1), successRate: +(100 * M.ok / Math.max(1, M.reqs)).toFixed(3), errorRate: +(100 * (M.reqs - M.ok) / Math.max(1, M.reqs)).toFixed(3),
    errors: Object.fromEntries(M.errors), overall: summarize(all), perEndpoint: per,
    autosaveMs: per.autosave, resultMs: per.result, resolutionMs: per.resolution,
    peakDbConnections: peak((x) => x.db.conns), peakActiveQueries: peak((x) => x.db.active), peakLockWaits: peak((x) => x.db.lockwaits),
    pool: { max: samples[0]?.pool.max, peakTotal: peak((x) => x.pool.total), peakWaiting: peak((x) => x.pool.waiting) },
    deadlocks: after.deadlocks - before.deadlocks, rollbacks: after.rollbacks - before.rollbacks,
    rssMb: { start: +(rss[0] ?? 0).toFixed(0), peak: +rss.reduce((m, x) => Math.max(m, x), 0).toFixed(0), end: +(rss.at(-1) ?? 0).toFixed(0) }, heapMbEnd: +(samples.at(-1)?.heapMb ?? 0).toFixed(0),
    serverCpuPctAvg: +(samples.reduce((a, x) => a + x.cpuPct, 0) / Math.max(1, samples.length)).toFixed(0), serverCpuPctPeak: +peak((x) => x.cpuPct).toFixed(0),
    loopLagP99MsPeak: +peak((x) => x.loopLagP99Ms).toFixed(0), loopLagMaxMs: +peak((x) => x.loopLagMaxMs).toFixed(0),
    mail: samples.at(-1)?.mail, mailDeliveryWaitMs: summarize(M.mailWait ?? []), clientViolations: M.violationCount ?? 0, clientViolationSamples: M.violations.slice(0, 5), integrity: integ, samples: samples.filter((_, i) => i % Math.ceil(samples.length / 60 || 1) === 0).map((x) => ({ t: Math.round((x.t - M.started) / 1000), rssMb: Math.round(x.rssMb), conns: x.db.conns, poolWaiting: x.pool.waiting, lag: Math.round(x.loopLagP99Ms), cpu: Math.round(x.cpuPct) })),
  };
}

// ---------------------------------------------------------------- burst
async function runBurst(n) {
  resetMetrics();
  const freshAgent = new http.Agent({ keepAlive: false, maxSockets: Infinity }); agentCur = freshAgent;
  const catalogVersion = (await call('GET', '/api/fa4/catalog')).json.version;
  const before = await dbCounters(); const samples = []; const stop = { v: false }; const s = sampler(stop, samples);
  // prepare N synthetic projects (not part of the measurement)
  const users = [];
  const prep = Array.from({ length: n }, (_, i) => (async () => { const { a, marker } = answersFor(900000 + i, 0); let r = await call('POST', '/api/fa4/sessions', { answers: a, step: 'company' }); for (let t = 0; t < 5 && !r.json?.sessionToken; t++) r = await call('POST', '/api/fa4/sessions', { answers: a, step: 'company' }); users.push({ token: r.json.sessionToken, marker, email: a.identity.email.toLowerCase() }); })());
  const tp = performance.now(); await Promise.all(prep); console.error(`prep ${n} projects in ${((performance.now() - tp) / 1000).toFixed(2)}s`);
  const lat = [];
  const likeAll = `%-${RUN}@load.invalid`;
  const resultsBefore = +(await admin.query('SELECT count(*)::int n FROM fa4_result r JOIN fa4_project p ON p.project_id = r.project_id WHERE p.email LIKE $1', [likeAll])).rows[0].n;
  const t0 = performance.now();
  const results = await Promise.all(users.map(async (u) => { const r = await call('POST', '/api/fa4/session/result', {}, u.token); lat.push(r.ms); return { u, r }; }));
  const wall = (performance.now() - t0) / 1000;
  if (process.env.PERF_DEBUG) console.error('failures', results.filter((x) => x.r.status !== 200).slice(0, 5).map((x) => [x.r.error, Math.round(x.r.ms)]));
  let okN = 0, wrong = 0, wrongVersion = 0;
  for (const { u, r } of results) { if (r.status === 200) { okN++; if (r.json.model.company !== u.marker || !mine(r.json.model, u.marker)) wrong++; if (r.json.model.catalogVersion !== catalogVersion) wrongVersion++; } }
  // same-project burst: 10 simultaneous deliveries for ONE project → 10 distinct results, one set of stable signals
  const one = users[0]; const sameBefore = (await admin.query(`SELECT count(*)::int n FROM fa4_result r JOIN fa4_project p USING (project_id) WHERE p.email = $1`, [one.email])).rows[0].n;
  const sigBefore = (await admin.query(`SELECT count(*)::int n FROM fa4_demand_signal s JOIN fa4_project p USING (project_id) WHERE p.email = $1 AND s.superseded_at IS NULL`, [one.email])).rows[0].n;
  const same = await Promise.all(Array.from({ length: 10 }, () => call('POST', '/api/fa4/session/result', {}, one.token)));
  const sameAfter = (await admin.query(`SELECT count(*)::int n, count(DISTINCT result_seq)::int d FROM fa4_result r JOIN fa4_project p USING (project_id) WHERE p.email = $1`, [one.email])).rows[0];
  const sigAfter = (await admin.query(`SELECT count(*)::int n FROM fa4_demand_signal s JOIN fa4_project p USING (project_id) WHERE p.email = $1 AND s.superseded_at IS NULL`, [one.email])).rows[0].n;
  stop.v = true; await s; const after = await dbCounters();
  const integ = await integrity([catalogVersion]);
  const peak = (f) => samples.reduce((m, x) => Math.max(m, f(x)), 0);
  agentCur = agent; freshAgent.destroy();
  const lostResults = okN + same.filter((x) => x.status === 200).length - (integ.results - resultsBefore);
  return { burst: n, lostResults, wallSeconds: +wall.toFixed(2), ok: okN, failed: n - okN, errors: results.filter((x) => x.r.status !== 200).slice(0, 3).map((x) => x.r.status || x.r.error), resultLatency: summarize(lat), resultsPerSec: +(n / wall).toFixed(1),
    crossProjectResults: wrong, wrongCatalogVersion: wrongVersion, resultsInDb: integ.results,
    sameProjectBurst: { requests: 10, ok: same.filter((x) => x.status === 200).length, resultsBefore: sameBefore, resultsAfter: sameAfter.n, distinctSeq: sameAfter.d, activeSignalsBefore: sigBefore, activeSignalsAfter: sigAfter },
    deadlocks: after.deadlocks - before.deadlocks, peakDbConnections: peak((x) => x.db.conns), peakLockWaits: peak((x) => x.db.lockwaits), poolPeakWaiting: peak((x) => x.pool.waiting), rssPeakMb: Math.round(peak((x) => x.rssMb)), integrity: integ };
}

// ---------------------------------------------------------------- main
const out = [];
for (const n of LEVELS) {
  console.error(`\n=== ${MODE} ${n} ===`);
  const r = MODE === 'burst' ? await runBurst(n) : await runLevel(n, DURATION);
  out.push(r);
  const { samples, ...brief } = r; console.log(JSON.stringify(brief, null, 1));
  if (MODE === 'soak' || process.env.PERF_KEEP_SAMPLES) console.log('SAMPLES ' + JSON.stringify(samples));
  await sleep(5000);
}
await admin.end(); agent.destroy();
if (arg('out')) (await import('node:fs')).writeFileSync(arg('out'), JSON.stringify(out, null, 1));
const bad = out.some((r) => (r.integrity?.violations?.length ?? 0) || r.clientViolations || r.crossProjectResults);
process.exit(bad ? 2 : 0);
