import { randomUUID } from "node:crypto";
import { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import { Logger, describeError, redact } from "./redact";

/**
 * HTTP hardening shared by every API surface (Phase 13): security headers, request ids, request
 * size limits before any parser runs, an Origin allow-list for state-changing browser requests and
 * a production-safe error handler (JSON only, no stack traces, no echo of request content).
 */

export const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

export function requestContext(): RequestHandler {
  return (req, res, next) => {
    const id = randomUUID();
    (req as Request & { requestId?: string }).requestId = id;
    res.set("X-Request-Id", id);
    next();
  };
}

export function securityHeaders(options: { production: boolean }): RequestHandler {
  return (_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
      // The API only ever answers JSON or redirects: nothing may be rendered, framed or scripted.
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
      // Customer data and credentials must never be stored by browsers or intermediaries; the
      // few public reference routes override this explicitly.
      "Cache-Control": "no-store",
    });
    if (options.production) res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  };
}

/** Refuses declared bodies above the limit before any JSON/raw parser buffers them. */
export function rejectOversizedBodies(maxBytes = MAX_REQUEST_BYTES): RequestHandler {
  return (req, res, next) => {
    const declared = Number(req.header("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > maxBytes) {
      res.status(413).json({ error: "PAYLOAD_TOO_LARGE" });
      return;
    }
    next();
  };
}

export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Browsers always send Origin on cross-site state-changing requests. A request that carries an
 * Origin outside the allow-list is refused; requests without one (server-to-server, signed webhooks)
 * are unaffected — they cannot carry a victim's browser credentials.
 */
export function originGuard(allowed: ReadonlySet<string>): RequestHandler {
  return (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      next();
      return;
    }
    const origin = req.header("origin");
    if (origin !== undefined && !allowed.has(normalizeOrigin(origin) ?? "")) {
      res.status(403).json({ error: "ORIGIN_REJECTED" });
      return;
    }
    next();
  };
}

export function notFoundJson(): RequestHandler {
  return (_req, res) => {
    res.status(404).json({ error: "NOT_FOUND" });
  };
}

/** Last handler: parser failures become 4xx JSON; anything else is logged redacted and answered generically. */
export function errorHandler(log: Logger): ErrorRequestHandler {
  // The fourth parameter is what makes Express treat this as an error handler, used or not.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (error: unknown, req: Request, res: Response, next: NextFunction) => {
    const type = typeof error === "object" && error !== null ? (error as { type?: unknown }).type : undefined;
    if (res.headersSent) {
      req.socket.destroy();
      return;
    }
    if (type === "entity.too.large") {
      res.status(413).json({ error: "PAYLOAD_TOO_LARGE" });
      return;
    }
    if (type === "entity.parse.failed") {
      res.status(400).json({ error: "INVALID_JSON" });
      return;
    }
    if (type === "charset.unsupported" || type === "encoding.unsupported") {
      res.status(415).json({ error: "UNSUPPORTED_MEDIA_TYPE" });
      return;
    }
    const requestId = (req as Request & { requestId?: string }).requestId ?? null;
    log("error", "unhandled request error", { requestId, method: req.method, path: redact(req.path, 200), error: describeError(error) });
    res.status(500).json({ error: "INTERNAL", requestId });
  };
}
