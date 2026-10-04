import express, { NextFunction, Request, Response, Router } from "express";
import {
  answersSchema,
  Capability,
  Catalog,
  isValidEmail,
} from "@beeside/fa-public-engine";
import { Db } from "../db/database";
import { EmailTransport } from "../fa/email/email-adapter";
import { FaError } from "../fa/services/errors";
import { looksLikeAccessToken } from "../fa/services/tokens";
import { RateLimitPolicy, RateLimiter, rateLimit } from "../security/rate-limit";
import { Fa4EmailDeps, deliverDueFa4Emails, enqueueFa4Email, fa4EmailRequestedRecently } from "./email";
import {
  Fa4ProjectRow, createProject, issueToken, latestProjectIdForEmail, latestResult, loadPublishedCatalog, normalizeEmail,
  projectByToken, requestContinuation, saveProject,
} from "./repository";
import { deliverResult } from "./service";

export interface Fa4Deps {
  db: Db;
  email: EmailTransport;
  config: { appBaseUrl: string; sessionTtlHours: number; resumeLinkDays: number; emailCooldownMinutes: number; now: () => Date };
  /** "inline" delivers the outbox before responding (tests / local); otherwise the worker or an explicit job delivers. */
  emailDispatch?: "inline" | "deferred";
}

const policy = (name: string, limit: number, windowSeconds: number): RateLimitPolicy => ({ name, limit, windowSeconds });
/** Technical abuse-prevention defaults counted in the shared `rate_limit_counter` table (every instance shares them). */
export const FA4_RATE_LIMITS = {
  address: policy("fa4_address", 1200, 600),
  create: policy("fa4_create_address", 10, 600),
  linkRequestAddress: policy("fa4_link_request_address", 10, 600),
  linkRequestEmail: policy("fa4_link_request_email", 3, 3600),
  linkToken: policy("fa4_link_token_address", 60, 600),
  sessionWrites: policy("fa4_session_writes", 900, 600),
  mail: policy("fa4_mail_session", 6, 600),
} as const;

type Handler = (req: Request, res: Response) => Promise<void>;
const bearer = (req: Request) => /^Bearer\s+(\S+)$/i.exec(req.header("authorization") ?? "")?.[1] ?? null;
const bodyOf = (req: Request): Record<string, unknown> => (typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {});
const maskEmail = (e: string) => { const [u = "", d = ""] = e.split("@"); return `${u.slice(0, 1)}***@${d}`; };

/** Public catalog for client-side flow decisions: internal fields (partner refs, provider / Business Check status, sourcing policy) are never sent. */
export function publicCatalog(c: Catalog): Catalog {
  return {
    ...c,
    capabilities: c.capabilities.map((cap): Capability => {
      const safe: Capability = { ...cap, providerStatus: "NONE", businessCheckStatus: "N/A" };
      delete safe.internalRef;
      delete safe.sourcingPolicy;
      return safe;
    }),
  };
}

export function createFa4Router(deps: Fa4Deps, security: { limiter?: RateLimiter } = {}): Router {
  const router = Router();
  const limiter = security.limiter;
  router.use(rateLimit(limiter, FA4_RATE_LIMITS.address));
  router.use(express.json({ limit: "256kb" }));
  router.use("/session", rateLimit(limiter, FA4_RATE_LIMITS.sessionWrites, bearer));
  router.use("/links", rateLimit(limiter, FA4_RATE_LIMITS.linkToken));

  const emailDeps: Fa4EmailDeps = { db: deps.db, email: deps.email, config: { appBaseUrl: deps.config.appBaseUrl, resumeLinkDays: deps.config.resumeLinkDays, now: deps.config.now } };
  const dispatch = async () => { if (deps.emailDispatch === "inline") await deliverDueFa4Emails(emailDeps); };

  const handle = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((error: unknown) => {
      if (error instanceof FaError) res.status(error.status).json({ error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
      else next(error);
    });
  };
  const session = async (req: Request): Promise<Fa4ProjectRow> => {
    const token = bearer(req);
    const project = token && looksLikeAccessToken(token) ? await projectByToken(deps.db, token, "SESSION", deps.config.now()) : null;
    if (!project) throw new FaError("UNAUTHENTICATED", "a valid working session is required");
    return project;
  };

  router.get("/catalog", handle(async (_req, res) => {
    res.set("Cache-Control", "no-store").json(publicCatalog(await loadPublishedCatalog(deps.db)));
  }));

  // Create the project right after the identity step. No account, no password.
  router.post("/sessions", rateLimit(limiter, FA4_RATE_LIMITS.create), handle(async (req, res) => {
    const parsed = answersSchema.safeParse(bodyOf(req).answers);
    if (!parsed.success) throw new FaError("INVALID_INPUT", "the answers are not valid");
    const a = parsed.data;
    const missing = [
      !a.identity.name.trim() && "name", !a.identity.company.trim() && "company", !isValidEmail(a.identity.email) && "email",
      !a.identity.termsAccepted && "termsAccepted", !a.identity.privacyAcknowledged && "privacyAcknowledged",
    ].filter(Boolean);
    if (missing.length) throw new FaError("INVALID_INPUT", "identity is incomplete", { fields: missing });
    const now = deps.config.now();
    const created = await createProject(deps.db, a, typeof bodyOf(req).step === "string" ? String(bodyOf(req).step).slice(0, 40) : "company", new Date(now.getTime() + deps.config.sessionTtlHours * 3_600_000));
    res.status(201).json({ sessionToken: created.sessionToken });
  }));

  router.get("/session", handle(async (req, res) => {
    const p = await session(req);
    res.json({ answers: p.answers, step: p.stepKey, status: p.status });
  }));

  router.put("/session", handle(async (req, res) => {
    const p = await session(req);
    const parsed = answersSchema.safeParse(bodyOf(req).answers);
    if (!parsed.success) throw new FaError("INVALID_INPUT", "the answers are not valid");
    const a = { ...parsed.data, identity: { ...parsed.data.identity, email: p.email } };   // the captured email can't be swapped silently
    await saveProject(deps.db, p.projectId, a, typeof bodyOf(req).step === "string" ? String(bodyOf(req).step).slice(0, 40) : p.stepKey, a.company.hasExistingBusiness === false ? "INELIGIBLE" : undefined);
    res.json({ ok: true });
  }));

  // "Guardar y seguir después": a resume link to the email already captured (never asked again).
  router.post("/session/finish-later", rateLimit(limiter, FA4_RATE_LIMITS.mail, bearer), handle(async (req, res) => {
    const p = await session(req);
    const now = deps.config.now();
    if (!(await fa4EmailRequestedRecently(deps.db, p.projectId, "fa4_resume_link", deps.config.emailCooldownMinutes, now)))
      await enqueueFa4Email(deps.db, p.projectId, "fa4_resume_link", `fa4_resume_link:${p.projectId}:${now.getTime()}`, now);
    await dispatch();
    res.json({ ok: true, email: maskEmail(p.email) });
  }));

  router.get("/session/result", handle(async (req, res) => {
    const p = await session(req);
    const r = await latestResult(deps.db, p.projectId);
    if (!r) throw new FaError("NOT_FOUND", "no result yet");
    res.json({ resultId: r.resultId, model: r.model });
  }));

  router.post("/session/result", handle(async (req, res) => {
    const p = await session(req);
    if (p.answers.company.hasExistingBusiness === false) throw new FaError("NOT_APPLICABLE", "this First Assessment is for existing businesses");
    res.json(await deliverResult(deps.db, p.projectId, p.answers, deps.config.now()));
  }));

  router.post("/session/result/email", rateLimit(limiter, FA4_RATE_LIMITS.mail, bearer), handle(async (req, res) => {
    const p = await session(req);
    const r = await latestResult(deps.db, p.projectId);
    if (!r) throw new FaError("NOT_FOUND", "no result yet");
    const now = deps.config.now();
    if (!(await fa4EmailRequestedRecently(deps.db, p.projectId, "fa4_result_link", deps.config.emailCooldownMinutes, now)))
      await enqueueFa4Email(deps.db, p.projectId, "fa4_result_link", `fa4_result_link:${r.resultId}:${now.getTime()}`, now);
    await dispatch();
    res.json({ ok: true });
  }));

  // "Continuar con beeside": explicit request tied to the same email; no marketing consent implied (LEGAL-1 pending).
  router.post("/session/continue", handle(async (req, res) => {
    const p = await session(req);
    const r = await latestResult(deps.db, p.projectId);
    if (!r || !r.model.premium.shown) throw new FaError("NOT_APPLICABLE", "no continuation is offered for this result");
    await requestContinuation(deps.db, p.projectId, r.resultId);
    res.json({ ok: true });
  }));

  // Exchange an emailed RESUME link token (URL fragment) for a working session.
  router.post("/links/continue", handle(async (req, res) => {
    const raw = bodyOf(req).token;
    const project = looksLikeAccessToken(raw) ? await projectByToken(deps.db, raw, "RESUME", deps.config.now()) : null;
    if (!project) throw new FaError("NOT_FOUND", "this link is not valid or has expired");
    const now = deps.config.now();
    const sessionToken = await deps.db.transaction((tx) => issueToken(tx, project.projectId, "SESSION", new Date(now.getTime() + deps.config.sessionTtlHours * 3_600_000)));
    res.json({ sessionToken });
  }));

  // Resume by email: always the same answer (no account enumeration); the link goes only to the stored address.
  router.post("/links/request", rateLimit(limiter, FA4_RATE_LIMITS.linkRequestAddress), rateLimit(limiter, FA4_RATE_LIMITS.linkRequestEmail, (req) => {
    const v = bodyOf(req).email; return typeof v === "string" && v.trim() ? normalizeEmail(v).slice(0, 320) : null;
  }), handle(async (req, res) => {
    const email = bodyOf(req).email;
    if (typeof email === "string" && isValidEmail(email)) {
      const projectId = await latestProjectIdForEmail(deps.db, email);
      const now = deps.config.now();
      if (projectId && !(await fa4EmailRequestedRecently(deps.db, projectId, "fa4_resume_link", deps.config.emailCooldownMinutes, now))) {
        await enqueueFa4Email(deps.db, projectId, "fa4_resume_link", `fa4_resume_link:${projectId}:${now.getTime()}`, now);
        await dispatch();
      }
    }
    res.json({ ok: true });
  }));

  return router;
}
