import { createHash, timingSafeEqual } from "node:crypto";
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "dist");
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

export const server = http.createServer((request, response) => {
  void (async () => {
    securityHeaders(response);
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
    console.log(JSON.stringify({ severity: "INFO", message: "beeside frontend listening", port: PORT, api: UPSTREAM ? "proxied" : "not configured" }));
  });
}
