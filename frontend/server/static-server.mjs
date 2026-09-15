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
  if (PRODUCTION) response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

function proxy(request, response) {
  const target = new URL(request.url, UPSTREAM);
  const forwardedFor = [request.headers["x-forwarded-for"], request.socket.remoteAddress].filter(Boolean).join(", ");
  const headers = { ...request.headers, host: UPSTREAM.host, "x-forwarded-for": forwardedFor, "x-forwarded-proto": request.headers["x-forwarded-proto"] ?? "https" };
  const upstream = (UPSTREAM.protocol === "https:" ? import("node:https") : import("node:http")).then((module) =>
    module.default.request(target, { method: request.method, headers }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    }),
  );
  upstream
    .then((client) => {
      client.on("error", () => {
        if (!response.headersSent) response.writeHead(502, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "UPSTREAM_UNAVAILABLE" }));
      });
      request.pipe(client);
    })
    .catch(() => {
      if (!response.headersSent) response.writeHead(502, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "UPSTREAM_UNAVAILABLE" }));
    });
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
