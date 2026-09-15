import express, { NextFunction, Request, Response, Router } from "express";
import { feedbackStatus, parseFeedbackInput, submitFeedback } from "../feedback/feedback-service";
import { dispatchEmails } from "../operations/email-outbox";
import { RATE_LIMITS, RateLimiter, rateLimit } from "../security/rate-limit";
import { getSessionSnapshot, openSnapshotFromLink } from "../snapshot/snapshot-service";
import { premiumContentOf } from "../premium/content";
import { getPremiumStatus, premiumContentForProject, requestPremiumActivation } from "../premium/premium-service";
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
  projectFromLink,
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
 * Requests never send email themselves: they enqueue into the outbox, and delivery runs after the
 * business transaction has committed.
 */
export function createFaRouter(deps: FaDeps, security: { limiter?: RateLimiter } = {}): Router {
  const router = Router();
  const limiter = security.limiter;
  // Abuse prevention (Phase 13): a shared budget per client address, plus narrower budgets on the
  // endpoints that create identities, send email or hold a session. Limits are counted in the
  // database, so every instance shares them; no address, email or token is stored in clear.
  router.use(rateLimit(limiter, RATE_LIMITS.faAddress));
  router.use(express.json({ limit: "64kb" }));

  const emailSubject = (req: Request): string | null => {
    const value = body(req).email;
    return typeof value === "string" && value.trim() !== "" && value.length <= 320 ? value.trim().toLowerCase() : null;
  };
  const sessionSubject = (req: Request): string | null => bearerToken(req);
  router.use("/session", rateLimit(limiter, RATE_LIMITS.sessionWrites, sessionSubject));
  router.use("/links", rateLimit(limiter, RATE_LIMITS.linkTokenAddress));

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

  router.post("/identity", rateLimit(limiter, RATE_LIMITS.identityAddress), rateLimit(limiter, RATE_LIMITS.identityEmail, emailSubject), handle(async (req, res) => {
    const result = await submitIdentity(deps, parseIdentityInput(req.body));
    await dispatchEmails(deps);
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
    const view = await completeStep(deps, ctx, req.params.stepId ?? "", durationMs);
    await dispatchEmails(deps);
    res.json(view);
  }));

  router.get("/session/snapshot", handle(async (req, res) => {
    const ctx = await session(req);
    res.json(await getSessionSnapshot(deps, ctx.project));
  }));

  router.post("/links/snapshot", handle(async (req, res) => {
    res.json(await openSnapshotFromLink(deps, body(req).token));
  }));

  // ---- Premium transition (after the Snapshot; no price, no payment provider). Copy and links are
  // versioned configuration: the project's pinned question bank, or the current one when anonymous.
  router.get("/premium/content", handle(async (_req, res) => {
    const { version, bundle } = await deps.bundles.current();
    res.set("Cache-Control", "public, max-age=300").json(premiumContentOf(bundle, version));
  }));

  router.get("/session/premium/content", handle(async (req, res) => {
    const ctx = await session(req);
    res.json(await premiumContentForProject(deps.db, deps.bundles, ctx.project.project_id));
  }));

  router.post("/links/premium/content", handle(async (req, res) => {
    const { project } = await projectFromLink(deps, body(req).token);
    res.json(await premiumContentForProject(deps.db, deps.bundles, project.project_id));
  }));

  router.get("/session/premium", handle(async (req, res) => {
    const ctx = await session(req);
    res.json(await getPremiumStatus(deps.db, ctx.project.project_id, deps.bundles));
  }));

  router.post("/session/premium/activation", handle(async (req, res) => {
    const ctx = await session(req);
    res.status(201).json(
      await requestPremiumActivation(deps, ctx.project.project_id, ctx.project.created_by_person_id, { acceptTerms: body(req).acceptTerms, interfaceLanguage: ctx.project.interface_language }),
    );
  }));

  router.post("/links/premium", handle(async (req, res) => {
    const { project } = await projectFromLink(deps, body(req).token);
    res.json(await getPremiumStatus(deps.db, project.project_id, deps.bundles));
  }));

  router.post("/links/premium/activation", handle(async (req, res) => {
    const b = body(req);
    const { project } = await projectFromLink(deps, b.token);
    res.status(201).json(await requestPremiumActivation(deps, project.project_id, project.created_by_person_id, { acceptTerms: b.acceptTerms, interfaceLanguage: project.interface_language }));
  }));

  router.post("/session/finish-later", handle(async (req, res) => {
    const ctx = await session(req);
    const result = await finishLater(deps, ctx.project.project_id);
    await dispatchEmails(deps);
    res.json({ saved: true, ...result });
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
    if (b.days !== 15 && b.days !== 30) throw new FaError("INVALID_INPUT", "days must be 15 or 30", { fields: ["days"] });
    if (typeof b.reason !== "string" || !(b.reason in EXTENSION_REASONS)) {
      throw new FaError("INVALID_INPUT", "a valid reason is required", { fields: ["reason"] });
    }
    const result = await extendFromLink(deps, b.token, b.days, b.reason as ExtensionReason);
    await dispatchEmails(deps);
    res.json(result);
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
  router.post("/links/request", rateLimit(limiter, RATE_LIMITS.linkRequestAddress), rateLimit(limiter, RATE_LIMITS.linkRequestEmail, emailSubject), handle(async (req, res) => {
    await requestLinkByEmail(deps, body(req).email);
    await dispatchEmails(deps);
    res.status(202).json({ status: "accepted" });
  }));

  // ---- Post-Snapshot feedback (after the Snapshot, never before; one answer per project)
  router.get("/session/feedback", handle(async (req, res) => {
    const ctx = await session(req);
    res.json(await feedbackStatus(deps.db, ctx.project.project_id));
  }));

  router.post("/session/feedback", rateLimit(limiter, RATE_LIMITS.feedbackAddress), handle(async (req, res) => {
    const ctx = await session(req);
    res.status(201).json(await submitFeedback(deps, ctx.project.project_id, parseFeedbackInput(req.body), "session"));
  }));

  router.post("/links/feedback", handle(async (req, res) => {
    const { project } = await projectFromLink(deps, body(req).token);
    res.json(await feedbackStatus(deps.db, project.project_id));
  }));

  router.post("/links/feedback/submit", rateLimit(limiter, RATE_LIMITS.feedbackAddress), handle(async (req, res) => {
    const { project } = await projectFromLink(deps, body(req).token);
    res.status(201).json(await submitFeedback(deps, project.project_id, parseFeedbackInput(req.body), "private_link"));
  }));

  router.post("/events", rateLimit(limiter, RATE_LIMITS.eventsAddress), handle(async (req, res) => {
    const b = body(req);
    const events = Array.isArray(b.events) ? b.events.slice(0, 50) : [];
    let ctx: SessionContext | null = null;
    if (bearerToken(req)) ctx = await session(req).catch(() => null);
    // A respondent reading their Snapshot from the email link has no working session: the private
    // link identifies the project so those events are not lost to "anonymous".
    let linkProjectId: string | null = null;
    let linkVersion: string | null = null;
    if (!ctx && typeof b.linkToken === "string") {
      const fromLink = await projectFromLink(deps, b.linkToken).catch(() => null);
      linkProjectId = fromLink?.project.project_id ?? null;
      linkVersion = fromLink?.project.question_bank_version ?? null;
    }
    const anonymousSessionId = isUuid(b.anonymousSessionId) ? b.anonymousSessionId : null;
    if (!ctx && !linkProjectId && !anonymousSessionId) throw new FaError("INVALID_INPUT", "anonymousSessionId is required", { fields: ["anonymousSessionId"] });

    const source = ctx
      ? { version: ctx.project.question_bank_version, bundle: ctx.bundle }
      : linkVersion
        ? { version: linkVersion, bundle: await deps.bundles.byVersion(linkVersion) }
        : await deps.bundles.current();
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
        projectId: ctx?.project.project_id ?? linkProjectId,
        anonymousSessionId,
        questionBankVersion: source.version,
      });
      accepted += 1;
    }
    res.status(202).json({ accepted });
  }));

  return router;
}
