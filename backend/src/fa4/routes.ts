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
import { Fa4EmailDeps, deliverDueFa4Emails, enqueueFa4Email } from "./email";
import {
  Fa4ProjectRow, LegalConfig, createProject, exchangeResumeToken, latestResult, loadPublishedCatalog, normalizeEmail,
  projectByToken, recentProjectsForEmail, requestContinuation, saveProject,
} from "./repository";
import { deliverResult } from "./service";

export interface Fa4Deps {
  db: Db;
  email: EmailTransport;
  config: {
    appBaseUrl: string; sessionTtlHours: number; resumeLinkDays: number; emailCooldownMinutes: number; now: () => Date;
    /** Max FA 4.0 emails to one address per 24 h (any project, any requester). */
    emailRecipientDailyQuota: number;
    /** Max projects a "resume by email" request sends project-specific links for. */
    resumeProjectsPerRequest: number;
    /** Approved Terms / Privacy identifiers recorded as immutable acceptance evidence (LEGAL-1 / CHK-1 pending). */
    legal: LegalConfig;
    /** Overrides of the technical abuse-prevention limits (see FA4_RATE_LIMITS). */
    rateLimits?: Partial<Record<keyof typeof FA4_RATE_LIMITS, { limit: number; windowSeconds: number }>>;
  };
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
  /** Per (email + origin) pair, tighter than either alone. */
  linkRequestPair: policy("fa4_link_request_pair", 2, 3600),
  linkToken: policy("fa4_link_token_address", 60, 600),
  sessionWrites: policy("fa4_session_writes", 900, 600),
  mail: policy("fa4_mail_session", 6, 600),
} as const;

type Handler = (req: Request, res: Response) => Promise<void>;
const bearer = (req: Request) => /^Bearer\s+(\S+)$/i.exec(req.header("authorization") ?? "")?.[1] ?? null;
const bodyOf = (req: Request): Record<string, unknown> => (typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {});
const maskEmail = (e: string) => { const [u = "", d = ""] = e.split("@"); return `${u.slice(0, 1)}***@${d}`; };

/**
 * Minimal customer-safe projection of the PUBLISHED catalog, built from an explicit allow-list (a new internal field can never leak
 * by default). It keeps what the deterministic flow needs in the browser — fronts, trigger terms, coverage and capability states,
 * country messages — and nothing internal: no provider / Business Check status, sourcing policy, internal reference or notes.
 */
export function publicCatalog(c: Catalog): Catalog {
  return {
    version: c.version,
    publishedAt: c.publishedAt,
    fronts: c.fronts.map((f) => ({
      key: f.key, internalName: f.key, nameEs: f.nameEs, nameEn: f.nameEn,
      synonymsEs: f.synonymsEs, synonymsEn: f.synonymsEn, examplesEs: f.examplesEs, examplesEn: f.examplesEn,
    })) as Catalog["fronts"],
    categories: c.categories.map((x) => ({ categoryId: x.categoryId, nameEs: x.nameEs, nameEn: x.nameEn, description: "", publicationStatus: x.publicationStatus, validFrom: x.validFrom })),
    services: c.services.map((x) => ({
      serviceId: x.serviceId, categoryId: x.categoryId, nameEs: x.nameEs, nameEn: x.nameEn, publicDescription: "", internalDescription: "",
      aliases: [], publicationStatus: x.publicationStatus, validFrom: x.validFrom,
    })),
    capabilities: c.capabilities.map((cap): Capability => ({
      capabilityId: cap.capabilityId, serviceId: cap.serviceId, kind: cap.kind, nameEs: cap.nameEs, nameEn: cap.nameEn,
      fronts: cap.fronts, triggerTermsEs: cap.triggerTermsEs, triggerTermsEn: cap.triggerTermsEn,
      ...(cap.triggerRule ? { triggerRule: cap.triggerRule } : {}),
      capabilityStatus: cap.capabilityStatus,
      ...(cap.dependsOn ? { dependsOn: cap.dependsOn } : {}), ...(cap.footnote ? { footnote: true } : {}),
      coverageBasis: cap.coverageBasis, coverage: cap.coverage,
      providerStatus: "NONE", businessCheckStatus: "N/A",
      ...(cap.scopeLimitEs ? { scopeLimitEs: cap.scopeLimitEs } : {}), ...(cap.scopeLimitEn ? { scopeLimitEn: cap.scopeLimitEn } : {}),
      validFrom: cap.validFrom, updatedAt: cap.updatedAt, publicationStatus: cap.publicationStatus,
    })),
    countries: c.countries,
  };
}

export function createFa4Router(deps: Fa4Deps, security: { limiter?: RateLimiter } = {}): Router {
  const router = Router();
  const limiter = security.limiter;
  const lim = (k: keyof typeof FA4_RATE_LIMITS): RateLimitPolicy => ({ ...FA4_RATE_LIMITS[k], ...(deps.config.rateLimits?.[k] ?? {}) });
  router.use(rateLimit(limiter, lim('address')));
  router.use(express.json({ limit: "256kb" }));
  router.use("/session", rateLimit(limiter, lim('sessionWrites'), bearer));
  router.use("/links", rateLimit(limiter, lim('linkToken')));

  const emailDeps: Fa4EmailDeps = { db: deps.db, email: deps.email, config: { appBaseUrl: deps.config.appBaseUrl, resumeLinkDays: deps.config.resumeLinkDays, now: deps.config.now } };
  const emailLimits = { cooldownMinutes: deps.config.emailCooldownMinutes, recipientDailyQuota: deps.config.emailRecipientDailyQuota };
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
  router.post("/sessions", rateLimit(limiter, lim('create')), handle(async (req, res) => {
    const parsed = answersSchema.safeParse(bodyOf(req).answers);
    if (!parsed.success) throw new FaError("INVALID_INPUT", "the answers are not valid");
    const a = parsed.data;
    const missing = [
      !a.identity.name.trim() && "name", !a.identity.company.trim() && "company", !isValidEmail(a.identity.email) && "email",
      !a.identity.termsAccepted && "termsAccepted", !a.identity.privacyAcknowledged && "privacyAcknowledged",
    ].filter(Boolean);
    if (missing.length) throw new FaError("INVALID_INPUT", "identity is incomplete", { fields: missing });
    const now = deps.config.now();
    const created = await createProject(deps.db, a, typeof bodyOf(req).step === "string" ? String(bodyOf(req).step).slice(0, 40) : "company", new Date(now.getTime() + deps.config.sessionTtlHours * 3_600_000), deps.config.legal);
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
    // Email and the two legal acknowledgements are pinned to what was captured at identity: the email can't be swapped silently
    // and acceptance evidence (fa4_legal_acceptance) can't diverge from the stored flags. Name / company / role stay editable.
    const a = { ...parsed.data, identity: { ...parsed.data.identity, email: p.email, termsAccepted: p.answers.identity.termsAccepted, privacyAcknowledged: p.answers.identity.privacyAcknowledged } };
    await saveProject(deps.db, p.projectId, a, typeof bodyOf(req).step === "string" ? String(bodyOf(req).step).slice(0, 40) : p.stepKey);
    res.json({ ok: true });
  }));

  // "Guardar y seguir después": a resume link to the email already captured (never asked again).
  router.post("/session/finish-later", rateLimit(limiter, lim('mail'), bearer), handle(async (req, res) => {
    const p = await session(req);
    const now = deps.config.now();
    await enqueueFa4Email(deps.db, p.projectId, "fa4_resume_link", now, emailLimits);
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

  router.post("/session/result/email", rateLimit(limiter, lim('mail'), bearer), handle(async (req, res) => {
    const p = await session(req);
    const r = await latestResult(deps.db, p.projectId);
    if (!r) throw new FaError("NOT_FOUND", "no result yet");
    const now = deps.config.now();
    await enqueueFa4Email(deps.db, p.projectId, "fa4_result_link", now, emailLimits, `${r.resultId}:`);
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

  // Exchange an emailed RESUME link token (URL fragment) for a working session. The link is project-specific and SINGLE-USE:
  // the exchange atomically spends it, so a replay (or a forwarded copy) is refused with the same generic answer as an unknown link.
  router.post("/links/continue", handle(async (req, res) => {
    const raw = bodyOf(req).token;
    const now = deps.config.now();
    const exchanged = looksLikeAccessToken(raw) ? await exchangeResumeToken(deps.db, raw, now, new Date(now.getTime() + deps.config.sessionTtlHours * 3_600_000)) : null;
    if (!exchanged) throw new FaError("NOT_FOUND", "this link is not valid or has expired");
    res.json({ sessionToken: exchanged.sessionToken });
  }));

  // Resume by email. The answer is always the same ({ok:true}) whether or not the address has projects (no account enumeration).
  // An email alone never opens a project: for each of the address's projects (up to a small cap) it queues a project-specific
  // single-use link sent ONLY to the stored address. Limits: per origin, per email, and per (email + origin) pair.
  const pairKey = (req: Request) => {
    const v = bodyOf(req).email; return typeof v === "string" && v.trim() ? `${normalizeEmail(v).slice(0, 320)}|${req.ip ?? req.socket.remoteAddress ?? "unknown"}` : null;
  };
  const emailKey = (req: Request) => { const v = bodyOf(req).email; return typeof v === "string" && v.trim() ? normalizeEmail(v).slice(0, 320) : null; };
  router.post("/links/request", rateLimit(limiter, lim('linkRequestAddress')), rateLimit(limiter, lim('linkRequestPair'), pairKey), rateLimit(limiter, lim('linkRequestEmail'), emailKey), handle(async (req, res) => {
    const email = bodyOf(req).email;
    if (typeof email === "string" && isValidEmail(email)) {
      const now = deps.config.now();
      for (const projectId of await recentProjectsForEmail(deps.db, email, deps.config.resumeProjectsPerRequest))
        await enqueueFa4Email(deps.db, projectId, "fa4_resume_link", now, emailLimits);
      await dispatch();
    }
    res.json({ ok: true });
  }));

  return router;
}
