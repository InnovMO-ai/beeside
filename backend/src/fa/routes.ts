import express, { NextFunction, Request, Response, Router } from "express";
import { isExtensionDays } from "./services/access-lifecycle";
import { isUuid, recordJourneyEvent, sanitizeClientEvent } from "./services/analytics";
import { ISO_COUNTRY_CODES } from "./engine/iso-countries";
import { FaError } from "./services/errors";
import { parseIdentityInput, submitIdentity } from "./services/identity-service";
import {
  EXTENSION_REASONS,
  ExtensionReason,
  continueFromLink,
  extendFromLink,
  finishLater,
  newProjectFromLink,
  openLink,
  requestLinkByEmail,
} from "./services/link-service";
import { FaDeps } from "./services/repository";
import {
  SessionContext,
  authenticateSession,
  buildSessionView,
  completeStep,
  saveAnswer,
  setInterfaceLanguage,
  startAnotherProject,
} from "./services/session-service";

type Handler = (req: Request, res: Response) => Promise<void>;

function bearerToken(req: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(req.header("authorization") ?? "");
  return match?.[1] ?? null;
}

function body(req: Request): Record<string, unknown> {
  return typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {};
}

/**
 * Public First Assessment API. Mounted only when FA_API_ENABLED=true (see createApp): the deployed
 * backend does not collect personal data until the Phase 13 abuse-prevention controls exist.
 */
export function createFaRouter(deps: FaDeps): Router {
  const router = Router();
  router.use(express.json({ limit: "64kb" }));

  const handle = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((error: unknown) => {
      if (error instanceof FaError) {
        res.status(error.status).json({ error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
      } else {
        next(error);
      }
    });
  };
  const session = (req: Request): Promise<SessionContext> => authenticateSession(deps, bearerToken(req));

  // ISO 3166-1 alpha-2 codes accepted for country answers; the browser localizes the names.
  router.get("/reference/countries", (_req, res) => {
    res.set("Cache-Control", "public, max-age=86400").json({ codes: [...ISO_COUNTRY_CODES].sort() });
  });

  router.get("/bundles/current", handle(async (_req, res) => {
    res.json(await deps.bundles.current());
  }));

  router.get("/bundles/:version", handle(async (req, res) => {
    res.json({ version: req.params.version, bundle: await deps.bundles.byVersion(req.params.version ?? "") });
  }));

  router.post("/identity", handle(async (req, res) => {
    const result = await submitIdentity(deps, parseIdentityInput(req.body));
    res.status(result.status === "started" ? 201 : 202).json(result);
  }));

  router.get("/session", handle(async (req, res) => {
    const ctx = await session(req);
    res.json(await buildSessionView(deps.db, ctx.project, ctx.bundle));
  }));

  router.put("/session/answers/:questionId", handle(async (req, res) => {
    const ctx = await session(req);
    const b = body(req);
    if (!("value" in b)) throw new FaError("INVALID_INPUT", "value is required");
    res.json(await saveAnswer(deps, ctx, req.params.questionId ?? "", b.value));
  }));

  router.put("/session/interface-language", handle(async (req, res) => {
    const ctx = await session(req);
    res.json(await setInterfaceLanguage(deps, ctx, body(req).language));
  }));

  router.post("/session/steps/:stepId/complete", handle(async (req, res) => {
    const ctx = await session(req);
    const duration = body(req).durationMs;
    const durationMs = typeof duration === "number" && Number.isInteger(duration) && duration >= 0 && duration < 86_400_000 ? duration : null;
    res.json(await completeStep(deps, ctx, req.params.stepId ?? "", durationMs));
  }));

  router.post("/session/finish-later", handle(async (req, res) => {
    const ctx = await session(req);
    res.json({ saved: true, ...(await finishLater(deps, ctx.project.project_id)) });
  }));

  router.post("/session/another-project", handle(async (req, res) => {
    const ctx = await session(req);
    res.status(201).json(await startAnotherProject(deps, ctx, body(req).acceptLegal === true));
  }));

  router.post("/links/open", handle(async (req, res) => {
    res.json(await openLink(deps, body(req).token));
  }));

  router.post("/links/continue", handle(async (req, res) => {
    res.status(201).json(await continueFromLink(deps, body(req).token));
  }));

  router.post("/links/extend", handle(async (req, res) => {
    const b = body(req);
    if (!isExtensionDays(b.days)) throw new FaError("INVALID_INPUT", "days must be 15 or 30", { fields: ["days"] });
    if (typeof b.reason !== "string" || !(b.reason in EXTENSION_REASONS)) {
      throw new FaError("INVALID_INPUT", "a valid reason is required", { fields: ["reason"] });
    }
    res.json(await extendFromLink(deps, b.token, b.days, b.reason as ExtensionReason));
  }));

  router.post("/links/new-project", handle(async (req, res) => {
    const b = body(req);
    res.status(201).json(
      await newProjectFromLink(deps, b.token, {
        sameCompany: b.sameCompany === true,
        companyName: typeof b.companyName === "string" ? b.companyName : null,
        companyWebsite: typeof b.companyWebsite === "string" && b.companyWebsite.trim() !== "" ? b.companyWebsite : null,
        acceptLegal: b.acceptLegal === true,
      }),
    );
  }));

  // Always the same answer, whether or not the email exists (no account enumeration).
  router.post("/links/request", handle(async (req, res) => {
    await requestLinkByEmail(deps, body(req).email);
    res.status(202).json({ status: "accepted" });
  }));

  router.post("/events", handle(async (req, res) => {
    const b = body(req);
    const events = Array.isArray(b.events) ? b.events.slice(0, 50) : [];
    let ctx: SessionContext | null = null;
    if (bearerToken(req)) ctx = await session(req).catch(() => null);
    const anonymousSessionId = isUuid(b.anonymousSessionId) ? b.anonymousSessionId : null;
    if (!ctx && !anonymousSessionId) throw new FaError("INVALID_INPUT", "anonymousSessionId is required", { fields: ["anonymousSessionId"] });

    const source = ctx ? { version: ctx.project.question_bank_version, bundle: ctx.bundle } : await deps.bundles.current();
    const knownIds = {
      steps: new Set(source.bundle.steps.map((s) => s.id)),
      questions: new Set(source.bundle.questions.map((q) => q.id)),
    };
    let accepted = 0;
    for (const raw of events) {
      const event = sanitizeClientEvent(raw, knownIds);
      if (!event) continue;
      await recordJourneyEvent(deps.db, {
        ...event,
        projectId: ctx?.project.project_id ?? null,
        anonymousSessionId,
        questionBankVersion: source.version,
      });
      accepted += 1;
    }
    res.status(202).json({ accepted });
  }));

  return router;
}
