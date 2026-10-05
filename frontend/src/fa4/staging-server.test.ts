import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Internal-staging switches of the static server: noindex, basic-auth gate, non-legal TEST Privacy page. All off by default. */
async function boot(env: Record<string, string>) {
  vi.resetModules();
  for (const k of ['ROBOTS_NOINDEX', 'STAGING_BASIC_AUTH', 'STAGING_TEST_LEGAL', 'API_UPSTREAM_URL', 'UPSTREAM_AUTH_AUDIENCE', 'METADATA_IDENTITY_URL']) delete process.env[k];
  Object.assign(process.env, { STATIC_SERVER_AUTOSTART: 'false' }, env);
  // @ts-expect-error plain .mjs without declarations
  const { server } = (await import('../../server/static-server.mjs')) as { server: http.Server };
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const get = (path: string, headers: Record<string, string> = {}) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: b })); }).on('error', reject);
  });
  return { get, close: () => new Promise((r) => server.close(r)) };
}
let closer: (() => Promise<unknown>) | null = null;
afterEach(async () => { await closer?.(); closer = null; });

describe('static server — internal staging switches', () => {
  it('public production (no switches): no auth gate, no robots override, no TEST legal page', async () => {
    const s = await boot({}); closer = s.close;
    expect((await s.get('/health')).status).toBe(200);
    const robots = await s.get('/robots.txt');
    expect(robots.headers['x-robots-tag']).toBeUndefined();
    expect((await s.get('/staging/privacy-test')).body).not.toContain('TEST placeholder');
  });
  it('staging: never indexed (header + robots.txt) and gated by basic auth except /health', async () => {
    const s = await boot({ ROBOTS_NOINDEX: 'true', STAGING_BASIC_AUTH: 'tester:s3cret', STAGING_TEST_LEGAL: 'true' }); closer = s.close;
    expect((await s.get('/health')).status).toBe(200);
    const denied = await s.get('/fa4');
    expect(denied.status).toBe(401); expect(String(denied.headers['www-authenticate'])).toMatch(/Basic/);
    expect((await s.get('/fa4', { Authorization: 'Basic ' + Buffer.from('tester:wrong').toString('base64') })).status).toBe(401);
    const ok = { Authorization: 'Basic ' + Buffer.from('tester:s3cret').toString('base64') };
    const robots = await s.get('/robots.txt', ok);
    expect(robots.body).toContain('Disallow: /');
    expect(robots.headers['x-robots-tag']).toMatch(/noindex/);
    // the page's own API calls carry a Bearer session (so no Basic header): the HttpOnly cookie set at login authorizes them
    const login = await s.get('/fa4', ok);
    const cookie = String(login.headers['set-cookie']?.[0] ?? '').split(';')[0]!;
    expect(cookie).toMatch(/^fa4_staging=[a-f0-9]{64}$/);
    expect((await s.get('/api/fa4/catalog', { Authorization: 'Bearer x', Cookie: cookie })).status).not.toBe(401);
    expect((await s.get('/api/fa4/catalog', { Authorization: 'Bearer x' })).status).toBe(401);
    expect((await s.get('/api/fa4/catalog', { Authorization: 'Bearer x', Cookie: 'fa4_staging=' + 'a'.repeat(64) })).status).toBe(401);
    const legal = await s.get('/staging/privacy-test', ok);
    expect(legal.body).toContain('not</b> beeside'); expect(legal.body).toContain('noindex');
  });

  it('private Cloud Run upstream: presents a Google ID token in X-Serverless-Authorization and leaves the app headers untouched', async () => {
    const seen: http.IncomingHttpHeaders[] = [];
    const upstream = http.createServer((req, res) => { seen.push(req.headers); res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); });
    const meta = http.createServer((req, res) => { expect(req.headers['metadata-flavor']).toBe('Google'); res.end('ID.TOKEN.VALUE'); });
    await Promise.all([upstream, meta].map((s) => new Promise<void>((r) => s.listen(0, '127.0.0.1', r))));
    const up = (upstream.address() as AddressInfo).port; const mp = (meta.address() as AddressInfo).port;
    const s = await boot({ API_UPSTREAM_URL: `http://127.0.0.1:${up}`, UPSTREAM_AUTH_AUDIENCE: 'https://backend.example', METADATA_IDENTITY_URL: `http://127.0.0.1:${mp}/identity` });
    closer = async () => { await s.close(); upstream.close(); meta.close(); };
    const r = await s.get('/api/fa4/catalog', { 'X-Fa4-Session': 'S'.repeat(43) });
    expect(r.status).toBe(200);
    expect(seen[0]!['x-serverless-authorization']).toBe('Bearer ID.TOKEN.VALUE');
    expect(seen[0]!['x-fa4-session']).toBe('S'.repeat(43));
  });
  it('without an audience nothing is added (local / CI behaviour unchanged)', async () => {
    const seen: http.IncomingHttpHeaders[] = [];
    const upstream = http.createServer((req, res) => { seen.push(req.headers); res.end('{}'); });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    const s = await boot({ API_UPSTREAM_URL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}` });
    closer = async () => { await s.close(); upstream.close(); };
    await s.get('/api/fa4/catalog');
    expect(seen[0]!['x-serverless-authorization']).toBeUndefined();
  });
});
