import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Static server for the built First Assessment app (Phase 13). No dependencies: it serves the Vite
 * build with security headers, never serves anything outside dist/, falls back to index.html for
 * client-side routes (/resume, /admin), and forwards /api to the backend when API_UPSTREAM_URL is
 * configured — the customer app and the API must be same-origin for the browser.
 */

const ROOT = process.env.STATIC_ROOT ? path.resolve(process.env.STATIC_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "dist");   // STATIC_ROOT: tests only
const PORT = Number(process.env.PORT ?? 8080);
const UPSTREAM = process.env.API_UPSTREAM_URL ? new URL(process.env.API_UPSTREAM_URL) : null;
const PRODUCTION = process.env.NODE_ENV === "production";
// INTERNAL STAGING switches (all off by default; public production sets none of them).
const NOINDEX = process.env.ROBOTS_NOINDEX === "true";                       // never indexed by search engines
const BASIC_AUTH = process.env.STAGING_BASIC_AUTH ?? "";                      // "user:password" gate in front of everything except /health
const TEST_LEGAL = process.env.STAGING_TEST_LEGAL === "true";
// An FA4-only environment sends the bare root to the FA4 entry instead of the legacy First Assessment shell (which needs the legacy API and would show a misleading error).
const ROOT_REDIRECT = /^\/[A-Za-z0-9/_-]*$/.test(process.env.ROOT_REDIRECT ?? "") ? process.env.ROOT_REDIRECT : "";                 // serves the non-legal TEST Privacy placeholder page
const digest = (v) => createHash("sha256").update(v).digest();
// The FA4 API itself uses "Authorization: Bearer" for the working session, so the browser cannot also send Basic credentials on /api calls:
// after a successful Basic login a same-origin HttpOnly cookie (derived from the secret) authorizes the page's own API calls.
const COOKIE_NAME = "fa4_staging";
const COOKIE_VALUE = BASIC_AUTH ? createHash("sha256").update(`cookie:${BASIC_AUTH}`).digest("hex") : "";
const sameSecret = (a, b) => timingSafeEqual(digest(a), digest(b));
function authorize(request) {
  if (!BASIC_AUTH) return { ok: true, viaBasic: false };
  const m = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "");
  if (m && sameSecret(Buffer.from(m[1], "base64").toString("utf8"), BASIC_AUTH)) return { ok: true, viaBasic: true };
  const cookie = /(?:^|;\s*)fa4_staging=([a-f0-9]{64})/.exec(request.headers.cookie ?? "")?.[1];
  return { ok: !!cookie && sameSecret(cookie, COOKIE_VALUE), viaBasic: false };
}
const TEST_PRIVACY_PAGE = `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>TEST — not the Privacy Policy</title>
<body style="font-family:system-ui;max-width:640px;margin:48px auto;padding:0 16px"><h1>TEST placeholder</h1>
<p>Internal staging only. This is <b>not</b> beeside's Privacy Policy and has no legal value. · Solo staging interno. Esto <b>no</b> es la Política de Privacidad de beeside.</p></body>`;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

// The app loads only its own assets; nothing may frame it, and no third-party origin is contacted.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ");

function securityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  // Private links travel in the URL fragment; a no-referrer policy keeps anything else out of referrers too.
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", CSP);
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (NOINDEX) response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  if (PRODUCTION) response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

// Cloud Run service-to-service: when the upstream is a private (IAM-protected) Cloud Run service, the static server presents a Google ID token
// for it in X-Serverless-Authorization (Cloud Run consumes that header; Authorization / X-Fa4-Session reach the app untouched).
const UPSTREAM_AUDIENCE = process.env.UPSTREAM_AUTH_AUDIENCE ?? "";
const METADATA_IDENTITY = process.env.METADATA_IDENTITY_URL ?? "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";
let idToken = { value: "", expires: 0 };
async function upstreamIdToken() {
  if (!UPSTREAM_AUDIENCE) return null;
  if (Date.now() < idToken.expires) return idToken.value;
  const r = await fetch(`${METADATA_IDENTITY}?audience=${encodeURIComponent(UPSTREAM_AUDIENCE)}`, { headers: { "Metadata-Flavor": "Google" } });
  if (!r.ok) throw new Error(`identity token request failed (${r.status})`);
  idToken = { value: (await r.text()).trim(), expires: Date.now() + 50 * 60_000 };   // tokens live 1 h
  return idToken.value;
}

async function proxy(request, response) {
  const unavailable = () => {
    if (!response.headersSent) response.writeHead(502, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "UPSTREAM_UNAVAILABLE" }));
  };
  let token = null;
  try { token = await upstreamIdToken(); } catch { unavailable(); return; }
  const target = new URL(request.url, UPSTREAM);
  const forwardedFor = [request.headers["x-forwarded-for"], request.socket.remoteAddress].filter(Boolean).join(", ");
  const headers = { ...request.headers, host: UPSTREAM.host, "x-forwarded-for": forwardedFor, "x-forwarded-proto": request.headers["x-forwarded-proto"] ?? "https" };
  if (token) headers["x-serverless-authorization"] = `Bearer ${token}`;
  try {
    const module = await (UPSTREAM.protocol === "https:" ? import("node:https") : import("node:http"));
    const client = module.default.request(target, { method: request.method, headers }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    client.on("error", unavailable);
    request.pipe(client);
  } catch {
    unavailable();
  }
}

async function serve(filePath, response, status = 200) {
  const extension = path.extname(filePath);
  const info = await stat(filePath);
  response.writeHead(status, {
    "Content-Type": TYPES[extension] ?? "application/octet-stream",
    "Content-Length": info.size,
    // Hashed build assets are immutable; the entry document must never be cached.
    "Cache-Control": filePath.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-store",
  });
  createReadStream(filePath).pipe(response);
}


// ---------------------------------------------------------------------------------------------------------------------------------------------
// DISCOVERY MODE (production under https://beeside.you/discovery). SERVE_MODE=discovery turns this server into the ONLY thing the edge sends to the
// Discovery path: it answers just `${PUBLIC_PATH}/…`, forwards ONLY `${PUBLIC_PATH}/api/fa4/…` to the backend (never the legacy /api/fa, /api/admin,
// /api/billing), reserves /ops-control (blocked: it must never expose the legacy Control Center), redirects the technical /fa4 to the public path and
// never falls back to the legacy First Assessment shell. Controlled access is a RUNTIME switch (ACCESS_GATE_MODE), so opening commercially is
// configuration only. Any invalid configuration refuses to start (fail closed).
// ---------------------------------------------------------------------------------------------------------------------------------------------
const DISCOVERY = process.env.SERVE_MODE === "discovery";
const PUBLIC_PATH = process.env.PUBLIC_PATH ?? "/discovery";
const GATE_MODE = process.env.ACCESS_GATE_MODE ?? "";
const GATE_TTL_MS = Number(process.env.ACCESS_GATE_COOKIE_TTL_HOURS ?? 12) * 3_600_000;
const GATE_CREDENTIALS = (process.env.ACCESS_GATE_CREDENTIALS ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
if (DISCOVERY) {
  const fail = (why) => { throw new Error(`discovery mode refuses to start: ${why}`); };
  if (PUBLIC_PATH !== "/" && !/^\/[a-z0-9-]+$/.test(PUBLIC_PATH)) fail("PUBLIC_PATH must be / (dedicated host) or look like /discovery");
  if (!["off", "basic", "edge"].includes(GATE_MODE)) fail("ACCESS_GATE_MODE must be set explicitly to off | basic | edge (no implicit default)");
  if (!(GATE_TTL_MS >= 3_600_000 && GATE_TTL_MS <= 7 * 86_400_000)) fail("ACCESS_GATE_COOKIE_TTL_HOURS must be between 1 and 168");
  if (GATE_MODE === "basic") {
    if (!GATE_CREDENTIALS.length) fail("ACCESS_GATE_MODE=basic requires ACCESS_GATE_CREDENTIALS (one user:password per line)");
    for (const c of GATE_CREDENTIALS) if (!/^[A-Za-z0-9._@-]{3,64}:.{12,200}$/.test(c)) fail("every ACCESS_GATE_CREDENTIALS line must be user:password (user 3–64 safe characters, password ≥ 12)");
  } else if (GATE_CREDENTIALS.length) fail("ACCESS_GATE_CREDENTIALS is only valid with ACCESS_GATE_MODE=basic");
  if (PRODUCTION && !UPSTREAM) fail("API_UPSTREAM_URL is required in production");
  if (BASIC_AUTH || process.env.STAGING_TEST_LEGAL === "true" || ROOT_REDIRECT) fail("the staging switches (STAGING_BASIC_AUTH, STAGING_TEST_LEGAL, ROOT_REDIRECT) are not valid in discovery mode");
}
const PREFIX = PUBLIC_PATH === "/" ? "" : PUBLIC_PATH;   // "" = the app owns the whole (dedicated) host; "/discovery" = it shares the host under that path
// CLOSED TEST (controlled launch, fictitious data, no final Privacy version): only valid while the application gate is closed. The label is shown to every visitor (runtime
// config, so opening commercially needs no rebuild).
const CLOSED_TEST = process.env.CLOSED_TEST_MODE === "true";
const CLOSED_TEST_LABEL = (process.env.CLOSED_TEST_LABEL ?? "PRUEBA CONTROLADA · datos ficticios · no comercial").slice(0, 120);
if (DISCOVERY && CLOSED_TEST && GATE_MODE !== "basic") throw new Error("discovery mode refuses to start: CLOSED_TEST_MODE requires ACCESS_GATE_MODE=basic (test mode exists only behind a closed gate)");
if (!DISCOVERY && CLOSED_TEST) throw new Error("CLOSED_TEST_MODE is only valid in discovery mode");
// An OPEN application (gate off / enforced elsewhere) must run under the FINAL legal regime: the backend says which regime it is in; anything else — including "cannot tell" —
// answers 503 (fail closed). Checked per request with a short cache, so a backend switched back to test mode closes the front door too.
let legalCache = { ok: false, at: 0 };
async function legalIsFinal() {
  if (Date.now() - legalCache.at < 30_000) return legalCache.ok;
  let ok = false;
  try {
    if (UPSTREAM) {
      const token = await upstreamIdToken();
      const mod = await (UPSTREAM.protocol === "https:" ? import("node:https") : import("node:http"));
      const body = await new Promise((resolve, reject) => {
        const rq = mod.default.get(new URL("/api/fa4/legal-mode", UPSTREAM), { headers: token ? { "x-serverless-authorization": `Bearer ${token}` } : {}, timeout: 3000 }, (res) => {
          let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => (res.statusCode === 200 ? resolve(b) : reject(new Error("status"))));
        });
        rq.on("timeout", () => rq.destroy(new Error("timeout"))); rq.on("error", reject);
      });
      ok = JSON.parse(String(body)).legalMode === "final";
    }
  } catch { ok = false; }
  legalCache = { ok, at: Date.now() };
  return ok;
}
const GATE_KEY = createHash("sha256").update(GATE_CREDENTIALS.join("\n")).digest();
const GATE_COOKIE = "discovery_gate";
const gateCookieValue = (expires) => `${expires}.${createHmac("sha256", GATE_KEY).update(String(expires)).digest("hex")}`;
function gateCookieValid(header) {
  const m = /(?:^|;\s*)discovery_gate=(\d{10,15})\.([a-f0-9]{64})/.exec(header ?? "");
  if (!m || Number(m[1]) < Date.now()) return false;
  const expected = createHmac("sha256", GATE_KEY).update(m[1]).digest("hex");
  return timingSafeEqual(Buffer.from(expected), Buffer.from(m[2]));
}
function gateBasicValid(header) {
  const m = /^Basic\s+(.+)$/i.exec(header ?? "");
  if (!m) return false;
  const given = Buffer.from(m[1], "base64").toString("utf8");
  let ok = false;
  for (const c of GATE_CREDENTIALS) if (sameSecret(given, c)) ok = true;   // no early exit: constant work per credential
  return ok;
}
// brute-force brake (per client address, per instance): 10 failures / 10 minutes → 429. The edge/Cloud Armor remains the real perimeter.
const failures = new Map();
const clientOf = (request) => String(request.headers["x-forwarded-for"] ?? request.socket.remoteAddress ?? "").split(",")[0].trim();
function tooManyFailures(ip) { const now = Date.now(); const list = (failures.get(ip) ?? []).filter((t) => now - t < 600_000); failures.set(ip, list); return list.length >= 10; }
const noteFailure = (ip) => failures.set(ip, [...(failures.get(ip) ?? []), Date.now()]);

const inner_isConfig = (p) => p === `${PREFIX}/config.json`;

async function handleDiscovery(request, response) {
  const url = new URL(request.url, "http://localhost");
  let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { response.writeHead(400); response.end(); return; }
  const send = (status, headers, body = "") => { response.writeHead(status, headers); response.end(body); };
  const notAvailable = (status = 404) => send(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" }, "Not available");
  if (NOINDEX || /^\/ops-control(\/|$)/.test(pathname)) response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  // public by design: health probe, robots, and the brand files that e-mail clients fetch without any cookie
  if (pathname === "/health") { send(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }, JSON.stringify({ status: "ok", service: "beeside-discovery-web", gate: GATE_MODE, closedTest: CLOSED_TEST })); return; }
  if (pathname === "/robots.txt") { if (NOINDEX) send(200, { "Content-Type": "text/plain; charset=utf-8" }, "User-agent: *\nDisallow: /\n"); else notAvailable(); return; }
  // runtime, non-sensitive configuration (public; no gate): lets the page show that this is a closed, non-commercial test without a rebuild
  if (inner_isConfig(pathname)) { send(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }, JSON.stringify({ closedTest: CLOSED_TEST, label: CLOSED_TEST ? CLOSED_TEST_LABEL : null })); return; }
  // Administration is RESERVED: blocked until the Discovery administration surface is connected. Never a redirect to /admin, never the legacy console.
  if (/^\/ops-control(\/|$)/.test(pathname)) { notAvailable(); return; }
  // technical alias → canonical public path (the fragment of private links survives a redirect)
  if (/^\/fa4(\/|$)/.test(pathname)) { send(308, { Location: (PREFIX + pathname.slice(4) || "/") + (pathname === "/fa4" && PREFIX ? "/" : "") + url.search, "Cache-Control": "no-store" }); return; }
  if (PREFIX && pathname === PREFIX) { send(308, { Location: `${PREFIX}/${url.search}`, "Cache-Control": "no-store" }); return; }
  if (PREFIX && !pathname.startsWith(PREFIX + "/")) { notAvailable(); return; }
  const inner = PREFIX ? pathname.slice(PREFIX.length) : pathname;          // always starts with "/"
  if (GATE_MODE !== "basic" && !inner.startsWith("/brand/") && !(await legalIsFinal())) { send(503, { "Content-Type": "application/json", "Cache-Control": "no-store" }, JSON.stringify({ error: "NOT_OPEN" })); return; }
  const isApi = inner.startsWith("/api/");
  const exempt = inner.startsWith("/brand/");
  if (GATE_MODE === "basic" && !exempt) {
    const ip = clientOf(request);
    if (tooManyFailures(ip)) { send(429, { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "600", "Cache-Control": "no-store" }, "Too many attempts"); return; }
    const viaBasic = gateBasicValid(request.headers.authorization);
    if (!viaBasic && !gateCookieValid(request.headers.cookie)) {
      if (request.headers.authorization) noteFailure(ip);
      const challenge = isApi ? {} : { "WWW-Authenticate": 'Basic realm="beeside Discovery (controlled access)", charset="UTF-8"' };
      send(401, { "Content-Type": isApi ? "application/json" : "text/plain; charset=utf-8", "Cache-Control": "no-store", ...challenge }, isApi ? JSON.stringify({ error: "ACCESS_RESTRICTED" }) : "Authentication required");
      return;
    }
    // the page's own API calls carry the Fa4 session header, not Basic: an HttpOnly, Secure, signed, expiring cookie authorizes them
    if (viaBasic) response.setHeader("Set-Cookie", `${GATE_COOKIE}=${gateCookieValue(Date.now() + GATE_TTL_MS)}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${Math.floor(GATE_TTL_MS / 1000)}`);
  }
  if (isApi) {
    // ONLY the Discovery API is reachable through this path; everything else (legacy /api/fa, /api/admin, /api/billing…) does not exist here
    if (!inner.startsWith("/api/fa4/")) { notAvailable(); return; }
    if (!UPSTREAM) { send(503, { "Content-Type": "application/json" }, JSON.stringify({ error: "API_NOT_CONFIGURED" })); return; }
    request.url = inner + url.search;                          // /discovery/api/fa4/x → /api/fa4/x
    proxy(request, response);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") { send(405, { Allow: "GET, HEAD" }); return; }
  const candidate = path.join(ROOT, inner);
  if (candidate.startsWith(ROOT + path.sep) && path.extname(candidate) !== "") {
    try { await serve(candidate, response); return; } catch { notAvailable(); return; }   // a missing file is a 404, never the app shell
  }
  if (!PREFIX && inner !== "/") { notAvailable(); return; }                  // dedicated host: the only page is "/" (state lives in the URL fragment); nothing else falls back to the shell
  try { await serve(path.join(ROOT, "index.html"), response); }
  catch { send(500, { "Content-Type": "application/json" }, JSON.stringify({ error: "INTERNAL" })); }
}

export const server = http.createServer((request, response) => {
  void (async () => {
    securityHeaders(response);
    if (DISCOVERY) { await handleDiscovery(request, response); return; }
    const auth = request.url === "/health" ? { ok: true, viaBasic: false } : authorize(request);
    if (auth.viaBasic) response.setHeader("Set-Cookie", `${COOKIE_NAME}=${COOKIE_VALUE}; Path=/; HttpOnly; SameSite=Strict`);
    if (!auth.ok) {
      response.writeHead(401, { "WWW-Authenticate": 'Basic realm="beeside internal staging", charset="UTF-8"', "Content-Type": "text/plain; charset=utf-8" });
      response.end("Authentication required");
      return;
    }
    if (ROOT_REDIRECT && (request.url === "/" || request.url.startsWith("/?"))) {
      response.writeHead(302, { Location: ROOT_REDIRECT, "Cache-Control": "no-store" });
      response.end();
      return;
    }
    if (NOINDEX && request.url === "/robots.txt") {
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("User-agent: *\nDisallow: /\n");
      return;
    }
    if (TEST_LEGAL && request.url === "/staging/privacy-test") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(TEST_PRIVACY_PAGE);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD" && !(UPSTREAM && request.url.startsWith("/api/"))) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }
    if (request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "ok", service: "beeside-frontend" }));
      return;
    }
    if (request.url.startsWith("/api/")) {
      if (!UPSTREAM) {
        response.writeHead(503, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "API_NOT_CONFIGURED" }));
        return;
      }
      proxy(request, response);
      return;
    }
    const requested = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    // /ops-control is RESERVED for the Discovery administration surface: blocked in every mode (never the legacy console). /admin stays the legacy technical route.
    if (/^\/ops-control(\/|$)/.test(requested)) { response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" }); response.end("Not available"); return; }
    if (/^\/admin(\/|$)/.test(requested)) response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    const candidate = path.join(ROOT, requested);
    // Path traversal: anything resolving outside dist/ is answered with the app shell, not the file.
    if (candidate.startsWith(ROOT + path.sep) && path.extname(candidate) !== "") {
      try {
        await serve(candidate, response);
        return;
      } catch {
        // fall through to the app shell
      }
    }
    try {
      await serve(path.join(ROOT, "index.html"), response);
    } catch {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "INTERNAL" }));
    }
  })();
});

if (process.env.STATIC_SERVER_AUTOSTART !== "false") {
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ severity: "INFO", message: "beeside frontend listening", port: PORT, api: UPSTREAM ? "proxied" : "not configured", mode: DISCOVERY ? "discovery" : "legacy", gate: DISCOVERY ? GATE_MODE : undefined }));
  });
}
