/**
 * OWNED BY DOMAIN-B. Mounted by DOMAIN-A after authentication; paths are absolute (/api/precision/...).
 *
 *   GET  /api/precision/categories/:id/crp
 *   POST /api/precision/categories/:id/crp/request-changes
 *   POST /api/precision/categories/:id/crp/confirm        { requestKey? }
 *   POST /api/precision/categories/:id/crp/new-version
 *   GET  /api/precision/categories/:id/preview
 *   POST /api/precision/categories/:id/send               { previewChecksum, requestKey? }
 *
 * `:id` is category_assessment.instance_id and is always resolved inside the authenticated project (a category of
 * another project is a 404). Reads are allowed in READ_ONLY; every write needs FULL (403 PRECISION_READ_ONLY); a
 * REVOKED project gets 403 PRECISION_REVOKED everywhere. Errors are ApiErrorDto with a localized, safe message.
 */
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { describeError } from "../../../security/redact";
import { accessPermits } from "../../ports/entitlement";
import { requirePrecision, type RouterFactory } from "../deps";
import { CrpError } from "./errors";
import { getPreview } from "./preview";
import { REQUEST_KEY, parseSendInput, sendCrp } from "./send";
import { confirmCrp, getCrpView, newVersion, requestChanges, type CrpActor } from "./service";

const BASE = "/api/precision/categories/:id";

export const createCrpRouter: RouterFactory = (deps) => {
  const router = express.Router();

  const actorOf = (req: Request): CrpActor => {
    const p = requirePrecision(req);
    return { projectId: p.projectId, locale: p.locale, canWrite: accessPermits(p.entitlement.accessMode, "write") };
  };

  const handle =
    (kind: "read" | "write", fn: (req: Request, actor: CrpActor) => Promise<unknown>, status = 200): RequestHandler =>
    async (req: Request, res: Response, _next: NextFunction) => {
      let locale = req.precision?.locale ?? "en";
      try {
        const p = requirePrecision(req);
        locale = p.locale;
        if (p.entitlement.accessMode === "REVOKED") throw new CrpError("PRECISION_REVOKED");
        if (kind === "write" && !accessPermits(p.entitlement.accessMode, "write")) throw new CrpError("PRECISION_READ_ONLY");
        res.status(status).json(await fn(req, actorOf(req)));
      } catch (e) {
        const err = e instanceof CrpError ? e : null;
        if (!err) deps.log("error", "precision crp request failed", { path: req.path, error: describeError(e) });
        const out = err ?? new CrpError("TEMPORARILY_UNAVAILABLE");
        res.status(out.status).json(out.toDto(locale));
      }
    };

  const idOf = (req: Request): string => String(req.params.id ?? "");

  /** Optional `requestKey` in confirm bodies: validated, otherwise ignored (confirmation is idempotent by pack). */
  const checkRequestKey = (req: Request): void => {
    const k = (req.body as { requestKey?: unknown } | undefined)?.requestKey;
    if (k !== undefined && (typeof k !== "string" || !REQUEST_KEY.test(k))) throw new CrpError("INVALID_INPUT");
  };

  router.get(`${BASE}/crp`, handle("read", (req, a) => getCrpView(deps, a, idOf(req))));
  router.post(`${BASE}/crp/request-changes`, handle("write", (req, a) => requestChanges(deps, a, idOf(req))));
  router.post(
    `${BASE}/crp/confirm`,
    handle("write", async (req, a) => {
      checkRequestKey(req);
      return (await confirmCrp(deps, a, idOf(req))).view;
    }),
  );
  router.post(`${BASE}/crp/new-version`, handle("write", (req, a) => newVersion(deps, a, idOf(req))));
  router.get(`${BASE}/preview`, handle("read", (req, a) => getPreview(deps, a, idOf(req))));
  router.post(`${BASE}/send`, handle("write", (req, a) => sendCrp(deps, a, idOf(req), parseSendInput(req.body))));

  return router;
};
