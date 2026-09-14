import { NextFunction, Request, Response, Router } from "express";
import {
  ConfigRegistry,
  ConfigVersioningError,
  ConfigVersioningErrorCode,
  ConfigVersioningService,
  ReviewDecision,
} from "./service";

/**
 * Admin Control Center API for versioned configuration (Draft → Preview → Publish).
 *
 * NOT mounted by createApp(): the backend Cloud Run service is publicly reachable and admin
 * authentication (SSO + ADMIN/SUPERVISOR RBAC) is Build Plan Phase 10. Phase 10 wires this
 * router with a real `resolveAdminActor`. Authorization of every write is additionally enforced
 * in the database (active ADMIN only), so the publication gates hold regardless of the caller.
 */
export interface ConfigVersioningRouterOptions {
  service: ConfigVersioningService;
  /** Returns the authenticated admin_user_id, or null when the request is not authenticated. */
  resolveAdminActor: (req: Request) => Promise<string | null>;
}

const REGISTRY_SLUGS: Record<string, ConfigRegistry> = {
  "question-bank": "QUESTION_BANK",
  "rules-engine": "RULES_ENGINE",
  "snapshot-template": "SNAPSHOT_TEMPLATE",
};

const HTTP_STATUS: Record<ConfigVersioningErrorCode, number> = {
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  GATE_REFUSED: 409,
  CONFLICT: 409,
  VALIDATION_FAILED: 422,
};

class BadRequest extends Error {}

type Handler = (req: Request, res: Response, actor: string, registry: ConfigRegistry) => Promise<void>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(body: unknown, field: string): string {
  const value = isPlainObject(body) ? body[field] : undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new BadRequest(`${field} must be a non-empty string`);
  }
  return value;
}

function requiredObject(body: unknown, field: string): Record<string, unknown> {
  const value = isPlainObject(body) ? body[field] : undefined;
  if (!isPlainObject(value)) {
    throw new BadRequest(`${field} must be a JSON object`);
  }
  return value;
}

export function createConfigVersioningRouter({ service, resolveAdminActor }: ConfigVersioningRouterOptions): Router {
  const router = Router();

  const route =
    (handler: Handler, { withRegistry = true } = {}) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const actor = await resolveAdminActor(req);
        if (!actor) {
          res.status(401).json({ error: "UNAUTHENTICATED" });
          return;
        }
        let registry: ConfigRegistry = "QUESTION_BANK";
        if (withRegistry) {
          const resolved = REGISTRY_SLUGS[req.params.registry ?? ""];
          if (!resolved) {
            res.status(404).json({ error: "UNKNOWN_REGISTRY" });
            return;
          }
          registry = resolved;
        }
        await handler(req, res, actor, registry);
      } catch (err) {
        if (err instanceof BadRequest) {
          res.status(400).json({ error: "BAD_REQUEST", message: err.message });
        } else if (err instanceof ConfigVersioningError) {
          res.status(HTTP_STATUS[err.code]).json({ error: err.code, message: err.message });
        } else {
          next(err);
        }
      }
    };

  router.get(
    "/config/current",
    route(async (_req, res) => {
      res.json(await service.currentVersions());
    }, { withRegistry: false }),
  );

  router.get(
    "/config/:registry/versions",
    route(async (_req, res, _actor, registry) => {
      res.json(await service.listVersions(registry));
    }),
  );

  router.get(
    "/config/:registry/versions/:version",
    route(async (req, res, _actor, registry) => {
      res.json(await service.getVersion(registry, req.params.version ?? ""));
    }),
  );

  router.post(
    "/config/:registry/versions",
    route(async (req, res, actor, registry) => {
      const version = requiredString(req.body, "version");
      await service.createDraft(registry, version, requiredObject(req.body, "config"), actor);
      res.status(201).json({ version, status: "DRAFT" });
    }),
  );

  router.put(
    "/config/:registry/versions/:version/config",
    route(async (req, res, actor, registry) => {
      await service.updateDraft(registry, req.params.version ?? "", requiredObject(req.body, "config"), actor);
      res.json({ version: req.params.version, status: "DRAFT" });
    }),
  );

  router.post(
    "/config/:registry/versions/:version/preview",
    route(async (req, res, actor, registry) => {
      res.json(await service.submitForPreview(registry, req.params.version ?? "", actor));
    }),
  );

  router.post(
    "/config/:registry/versions/:version/return-to-draft",
    route(async (req, res, actor, registry) => {
      await service.returnToDraft(registry, req.params.version ?? "", actor, requiredString(req.body, "reason"));
      res.json({ version: req.params.version, status: "DRAFT" });
    }),
  );

  router.post(
    "/config/:registry/versions/:version/reviews",
    route(async (req, res, actor, registry) => {
      const decision = requiredString(req.body, "decision");
      if (decision !== "APPROVED" && decision !== "REJECTED") {
        throw new BadRequest("decision must be APPROVED or REJECTED");
      }
      const body = req.body as Record<string, unknown>;
      const reviewId = await service.recordReview(registry, req.params.version ?? "", actor, {
        decision: decision as ReviewDecision,
        diffReviewed: body.diffReviewed === true,
        notes: typeof body.notes === "string" ? body.notes : null,
      });
      res.status(201).json({ reviewId });
    }),
  );

  // The publish endpoint itself refuses an unreviewed logic/schema bundle (HTTP 409 GATE_REFUSED).
  router.post(
    "/config/:registry/versions/:version/publish",
    route(async (req, res, actor, registry) => {
      res.json(await service.publish(registry, req.params.version ?? "", actor));
    }),
  );

  router.post(
    "/config/:registry/versions/:version/set-current",
    route(async (req, res, actor, registry) => {
      res.json(await service.setCurrent(registry, req.params.version ?? "", actor, requiredString(req.body, "reason")));
    }),
  );

  return router;
}
