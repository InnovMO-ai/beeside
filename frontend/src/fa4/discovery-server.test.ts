import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

/**
 * Production under https://beeside.you/discovery: the static server in DISCOVERY MODE. Everything the edge could send here is checked: path prefix, API allow-list,
 * the reserved /ops-control, the /fa4 redirect, no legacy fallback, the controlled-access gate (runtime switch, fail closed) and its public exemptions.
 */
let dist = ''; let upstream: http.Server; let upstreamPort = 0; const seen: Array<{ method?: string; url?: string }> = [];
beforeAll(async () => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'disc-dist-'));
  fs.mkdirSync(path.join(dist, 'assets')); fs.mkdirSync(path.join(dist, 'brand'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Discovery shell</title><script src="/discovery/assets/app.js"></script>');
  fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dist, 'brand', 'beeside-lockup.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  upstream = http.createServer((req, res) => { seen.push({ method: req.method, url: req.url }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"upstream":true}'); });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r)); upstreamPort = (upstream.address() as AddressInfo).port;
});
afterAll(async () => { await new Promise((r) => upstream.close(r)); fs.rmSync(dist, { recursive: true, force: true }); });

const ENV_KEYS = ['SERVE_MODE', 'PUBLIC_PATH', 'ACCESS_GATE_MODE', 'ACCESS_GATE_CREDENTIALS', 'ACCESS_GATE_COOKIE_TTL_HOURS', 'ROBOTS_NOINDEX', 'STAGING_BASIC_AUTH', 'STAGING_TEST_LEGAL', 'API_UPSTREAM_URL', 'UPSTREAM_AUTH_AUDIENCE', 'ROOT_REDIRECT', 'NODE_ENV', 'STATIC_ROOT'];
async function load(env: Record<string, string>) {
  vi.resetModules(); for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, { STATIC_SERVER_AUTOSTART: 'false', STATIC_ROOT: dist, SERVE_MODE: 'discovery', API_UPSTREAM_URL: `http://127.0.0.1:${upstreamPort}` }, env);
  // @ts-expect-error plain .mjs without declarations
  return (await import('../../server/static-server.mjs')) as { server: http.Server };
}
async function boot(env: Record<string, string>) {
  const { server } = await load(env);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r)); const port = (server.address() as AddressInfo).port;
  const call = (method: string, p: string, headers: Record<string, string> = {}, body?: string) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: b })); });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
  return { get: (p: string, h?: Record<string, string>) => call('GET', p, h), post: (p: string, h?: Record<string, string>, b = '{}') => call('POST', p, { 'content-type': 'application/json', ...h }, b), close: () => new Promise((r) => server.close(r)) };
}
let closer: (() => Promise<unknown>) | null = null;
afterEach(async () => { await closer?.(); closer = null; seen.length = 0; });
const basic = (u: string, p: string) => ({ Authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') });
const PW = 'correct-horse-battery';

describe('discovery mode — fail-closed configuration', () => {
  it.each([
    ['no gate mode at all (no implicit default)', {}],
    ['unknown gate mode', { ACCESS_GATE_MODE: 'maybe' }],
    ['basic without credentials', { ACCESS_GATE_MODE: 'basic' }],
    ['credentials too weak', { ACCESS_GATE_MODE: 'basic', ACCESS_GATE_CREDENTIALS: 'tester:short' }],
    ['credentials malformed', { ACCESS_GATE_MODE: 'basic', ACCESS_GATE_CREDENTIALS: 'no-colon-here-at-all' }],
    ['credentials given but gate not basic', { ACCESS_GATE_MODE: 'off', ACCESS_GATE_CREDENTIALS: `tester:${PW}` }],
    ['cookie ttl out of range', { ACCESS_GATE_MODE: 'off', ACCESS_GATE_COOKIE_TTL_HOURS: '0' }],
    ['bad public path', { ACCESS_GATE_MODE: 'off', PUBLIC_PATH: 'discovery' }],
    ['staging switches are not valid here', { ACCESS_GATE_MODE: 'off', STAGING_BASIC_AUTH: 'a:b' }],
  ])('refuses to start: %s', async (_n, env) => { await expect(load(env as Record<string, string>)).rejects.toThrow(/discovery mode refuses to start/); });
  it('production without an API upstream refuses to start', async () => {
    await expect(load({ ACCESS_GATE_MODE: 'off', NODE_ENV: 'production', API_UPSTREAM_URL: '' })).rejects.toThrow(/API_UPSTREAM_URL is required/);
  });
});

describe('discovery mode — path behaviour (gate off)', () => {
  it('serves only under /discovery/: shell for client routes, files for assets/brand, 404 for everything else (never the legacy shell)', async () => {
    const s = await boot({ ACCESS_GATE_MODE: 'off' }); closer = s.close;
    expect((await s.get('/discovery')).status).toBe(308); expect((await s.get('/discovery?x=1')).headers.location).toBe('/discovery/?x=1');
    const shell = await s.get('/discovery/'); expect(shell.status).toBe(200); expect(shell.body).toContain('Discovery shell');
    expect((await s.get('/discovery/some/client/route')).body).toContain('Discovery shell');
    expect((await s.get('/discovery/assets/app.js')).status).toBe(200);
    const png = await s.get('/discovery/brand/beeside-lockup.png'); expect(png.status).toBe(200); expect(png.headers['content-type']).toBe('image/png');
    expect((await s.get('/discovery/assets/missing.js')).status).toBe(404);               // a missing file is not the app shell
    for (const p of ['/', '/resume', '/admin', '/admin/projects', '/assets/app.js', '/brand/beeside-lockup.png', '/api/fa4/catalog', '/api/fa/links', '/discoveryx', '/discovery/../etc/passwd']) expect((await s.get(p)).status, p).toBe(404);
    expect((await s.post('/discovery/some/route')).status).toBe(405);
    const h = await s.get('/discovery/'); expect(h.headers['content-security-policy']).toContain("default-src 'self'"); expect(h.headers['x-frame-options']).toBe('DENY');
    expect((await s.get('/health')).body).toContain('"gate":"off"');
  });
  it('/fa4 (technical) redirects to the public path, keeping sub-paths and the query', async () => {
    const s = await boot({ ACCESS_GATE_MODE: 'off' }); closer = s.close;
    for (const [from, to] of [['/fa4', '/discovery/'], ['/fa4/', '/discovery/'], ['/fa4/step?a=1', '/discovery/step?a=1']] as const) { const r = await s.get(from); expect(r.status, from).toBe(308); expect(r.headers.location, from).toBe(to); }
  });
  it('/ops-control is RESERVED: blocked (404, noindex), never the legacy Control Center, never a redirect to /admin', async () => {
    for (const env of [{ ACCESS_GATE_MODE: 'off' }, { ACCESS_GATE_MODE: 'basic', ACCESS_GATE_CREDENTIALS: `tester:${PW}` }]) {
      const s = await boot(env as Record<string, string>); closer = s.close;
      for (const p of ['/ops-control', '/ops-control/', '/ops-control/projects/1', '/ops-control/api/admin/auth/login']) {
        const r = await s.get(p); expect(r.status, p).toBe(404); expect(r.headers['x-robots-tag']).toMatch(/noindex/); expect(r.headers.location).toBeUndefined(); expect(r.body).not.toMatch(/Control Center|admin/i);
      }
      await s.close(); closer = null;
    }
  });
  it('forwards ONLY /discovery/api/fa4/* to the backend, stripping the public prefix; the legacy APIs do not exist here', async () => {
    const s = await boot({ ACCESS_GATE_MODE: 'off' }); closer = s.close;
    const ok = await s.post('/discovery/api/fa4/session/result/email?x=1', { 'x-fa4-session': 'abc' });
    expect(ok.status).toBe(200); expect(seen.at(-1)).toEqual({ method: 'POST', url: '/api/fa4/session/result/email?x=1' });
    expect((await s.get('/discovery/api/fa4/catalog')).status).toBe(200); expect(seen.at(-1)!.url).toBe('/api/fa4/catalog');
    seen.length = 0;
    for (const p of ['/discovery/api/fa/links/continue', '/discovery/api/admin/auth/login', '/discovery/api/billing/x', '/discovery/api/fa4', '/discovery/api/']) expect((await s.get(p)).status, p).toBe(404);
    expect((await s.post('/discovery/api/admin/x')).status).toBe(404);
    expect(seen).toEqual([]);                                                             // nothing outside /api/fa4 ever reached the backend
  });
  it('noindex: header on every answer and robots.txt, when ROBOTS_NOINDEX=true (controlled phase); absent when opened', async () => {
    const closed = await boot({ ACCESS_GATE_MODE: 'off', ROBOTS_NOINDEX: 'true' }); closer = closed.close;
    expect((await closed.get('/discovery/')).headers['x-robots-tag']).toMatch(/noindex/); expect((await closed.get('/robots.txt')).body).toContain('Disallow: /');
    await closed.close(); closer = null;
    const open = await boot({ ACCESS_GATE_MODE: 'off' }); closer = open.close;
    expect((await open.get('/discovery/')).headers['x-robots-tag']).toBeUndefined();
  });
});

describe('discovery mode — controlled-access gate (runtime switch)', () => {
  const creds = `tester:${PW}\nsecond.user@beeside.you:another-long-password`;
  it('basic: pages and API are closed; /health, robots and the brand files (e-mail logo) stay public; wrong credentials never pass', async () => {
    const s = await boot({ ACCESS_GATE_MODE: 'basic', ACCESS_GATE_CREDENTIALS: creds, ROBOTS_NOINDEX: 'true' }); closer = s.close;
    const page = await s.get('/discovery/'); expect(page.status).toBe(401); expect(String(page.headers['www-authenticate'])).toMatch(/Basic/); expect(page.body).not.toContain('Discovery shell');
    expect((await s.get('/discovery/assets/app.js')).status).toBe(401);
    const api = await s.get('/discovery/api/fa4/catalog'); expect(api.status).toBe(401); expect(api.headers['www-authenticate']).toBeUndefined(); expect(seen).toEqual([]);   // closed API: no popup, backend untouched
    expect((await s.get('/health')).status).toBe(200); expect((await s.get('/robots.txt')).status).toBe(200);
    expect((await s.get('/discovery/brand/beeside-lockup.png')).status).toBe(200);              // e-mail clients carry no cookie
    expect((await s.get('/discovery/', basic('tester', 'wrong-password-123'))).status).toBe(401);
    expect((await s.get('/discovery/', basic('nobody', PW))).status).toBe(401);
    expect((await s.get('/fa4')).status).toBe(308);                                             // the redirect reveals nothing
  });
  it('basic: either credential opens it; a signed, HttpOnly, Secure, expiring cookie then authorizes the page\'s own API calls; forged/expired cookies do not', async () => {
    const s = await boot({ ACCESS_GATE_MODE: 'basic', ACCESS_GATE_CREDENTIALS: creds }); closer = s.close;
    for (const [u, p] of [['tester', PW], ['second.user@beeside.you', 'another-long-password']] as const) expect((await s.get('/discovery/', basic(u, p))).status).toBe(200);
    const login = await s.get('/discovery/', basic('tester', PW)); const setCookie = String(login.headers['set-cookie']?.[0]);
    expect(setCookie).toMatch(/^discovery_gate=\d{13}\.[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict; Secure; Max-Age=\d+$/);
    const cookie = setCookie.split(';')[0]!;
    expect((await s.get('/discovery/api/fa4/catalog', { Cookie: cookie })).status).toBe(200);
    expect((await s.get('/discovery/api/fa4/catalog', { Cookie: cookie.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')) })).status).toBe(401);   // tampered signature
    const forged = `discovery_gate=${Date.now() + 1e9}.${'a'.repeat(64)}`; expect((await s.get('/discovery/', { Cookie: forged })).status).toBe(401);
    const expired = `discovery_gate=${Date.now() - 1000}.${cookie.split('.')[1]}`; expect((await s.get('/discovery/', { Cookie: expired })).status).toBe(401);
  });
  it('basic: a brute-force brake answers 429 after 10 failed attempts from one address', async () => {
    const s = await boot({ ACCESS_GATE_MODE: 'basic', ACCESS_GATE_CREDENTIALS: creds }); closer = s.close;
    for (let i = 0; i < 10; i++) expect((await s.get('/discovery/', basic('tester', `wrong-password-${i}x`))).status).toBe(401);
    const blocked = await s.get('/discovery/', basic('tester', PW)); expect(blocked.status).toBe(429); expect(blocked.headers['retry-after']).toBe('600');
  });
  it('opening commercially is configuration only: the SAME files and code serve open (off) and externally gated (edge) with no gate of their own', async () => {
    for (const mode of ['off', 'edge']) { const s = await boot({ ACCESS_GATE_MODE: mode }); closer = s.close; expect((await s.get('/discovery/')).status, mode).toBe(200); expect((await s.get('/discovery/api/fa4/catalog')).status, mode).toBe(200); expect((await s.get('/health')).body).toContain(`"gate":"${mode}"`); await s.close(); closer = null; }
  });
});
