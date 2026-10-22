import { randomUUID } from "node:crypto";
import express, { NextFunction, Request, Response, Router } from "express";
import {
  answersSchema,
  type Answers,
  clientResolution,
  isValidEmail,
  toPublicCatalog,
} from "@beeside/fa-public-engine";
import { Db } from "../db/database";
import { EmailTransport } from "../fa/email/email-adapter";
import { FaError } from "../fa/services/errors";
import { looksLikeAccessToken } from "../fa/services/tokens";
import { RateLimitPolicy, RateLimiter, rateLimit } from "../security/rate-limit";
import {
  DeliveryState, Fa4EmailDeps, Fa4EmailTemplate, awaitDelivery, closedTestRecipientAllowed, deliverDueFa4Emails, deliveryStatus, enqueueContact, enqueueFa4Email, enqueueIdleContinuation, latestDelivery, retryFa4Delivery, stateOfStatus,
} from "./email";
import { parseClientEvent, recordEvent } from "./events";
import { cleanInput } from "./email-render";
import {
  Fa4ProjectRow, LegalConfig, createProject, isDelivered, latestMarketingConsent, recordMarketingConsent, exchangeLinkToken, latestResult, loadPublishedCatalog, normalizeEmail,
  projectByToken, recentProjectsForEmail, requestContinuation, saveProject,
} from "./repository";
import { deliverResult, previewResult } from "./service";

export interface Fa4Deps {
  db: Db;
  email: EmailTransport;
  config: {
    appBaseUrl: string; sessionTtlHours: number; resumeLinkDays: number; emailCooldownMinutes: number; now: () => Date;
    /** Max FA 4.0 emails to one address per 24 h (any project, any requester). */
    emailRecipientDailyQuota: number;
    /** Max projects a "resume by email" request sends project-specific links for. */
    resumeProjectsPerRequest: number;
    /** Operational mailbox for "Hablar con beeside" (contact@beeside.you). */
    contactAddress?: string;
    /** Optional secondary CTA of the YEV email (FA4_PREMIUM_RESOURCE_URL_ES|EN). */
    premiumResourceUrl?: { es?: string; en?: string };
    /** Commercial-content policy gate of the YEV email's Premium block (LEGAL-1, external; fail-closed). */
    premiumCommercialContentAllowed?: boolean;
    /** CLOSED TEST mode: no final Privacy version, non-commercial, fictitious data only, e-mail restricted to these domains. */
    closedTest?: import("./email").ClosedTestConfig;
    legalMode?: "final" | "closed-test";
    /** Temporary measurement aid for TRUST_PROXY_HOPS (closed test only): GET /api/fa4/edge-check answers the caller's own address as the server sees it. */
    edgeDiagnostic?: boolean;
    /** Validity (days) of the YEV email's private link. */
    yevLinkDays?: number;
    /** How long an interactive request waits for the provider's answer before it reports `pending` (the UI then polls). */
    emailConfirmWaitMs?: number;
    /** Approved Terms / Privacy identifiers recorded as immutable acceptance evidence (LEGAL-1 / CHK-1 pending). */
    legal: LegalConfig;
    /** Overrides of the technical abuse-prevention limits (see FA4_RATE_LIMITS). */
    /** Public path of Discovery used in e-mailed links (default "/fa4"; production: "/discovery"). */
    publicPath?: string;
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
  /** Contact messages reach a human inbox: tighter than the automatic emails. */
  contact: policy("fa4_contact_session", 4, 600),
  /** Anonymous event capture (pre-Identity included): generous per address, bounded body. */
  events: policy("fa4_events_address", 600, 600),
} as const;

type Handler = (req: Request, res: Response) => Promise<void>;
/**
 * The working-session token: `X-Fa4-Session` (what the app sends — it survives gateways such as Google IAP that consume the
 * Authorization header for their own credentials) or, equivalently, `Authorization: Bearer`.
 */
const bearer = (req: Request) => req.header("x-fa4-session")?.trim() || /^Bearer\s+(\S+)$/i.exec(req.header("authorization") ?? "")?.[1] || null;
/**
 * DSC-01 — only what the person declared is stored and used: facts about an OPERATING company (sector, size, operating countries) are kept only when the answer to
 * «is your company already operating?» is Yes. Typed and then «No»: they are dropped here (they would otherwise be persisted, feed the document-coverage rule
 * that reads the operating countries, and reach the result as if declared).
 */
export const onlyDeclared = (a: Answers): Answers => (a.company.hasExistingBusiness === true || a.company.hasExistingBusiness === null
  ? a : { ...a, company: { hasExistingBusiness: false, sector: "", size: null, operatesIn: [] } });
const bodyOf = (req: Request): Record<string, unknown> => (typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {});
const maskEmail = (e: string) => { const [u = "", d = ""] = e.split("@"); return `${u.slice(0, 1)}***@${d}`; };

export function createFa4Router(deps: Fa4Deps, security: { limiter?: RateLimiter } = {}): Router {
  const router = Router();
  const limiter = security.limiter;
  const lim = (k: keyof typeof FA4_RATE_LIMITS): RateLimitPolicy => ({ ...FA4_RATE_LIMITS[k], ...(deps.config.rateLimits?.[k] ?? {}) });
  router.use(rateLimit(limiter, lim('address')));
  router.use(express.json({ limit: "256kb" }));
  router.use("/session", rateLimit(limiter, lim('sessionWrites'), bearer));
  router.use("/links", rateLimit(limiter, lim('linkToken')));

  const emailDeps: Fa4EmailDeps = {
    db: deps.db, email: deps.email,
    config: { appBaseUrl: deps.config.appBaseUrl, publicPath: deps.config.publicPath, closedTest: deps.config.closedTest, resumeLinkDays: deps.config.resumeLinkDays, now: deps.config.now, contactAddress: deps.config.contactAddress, premiumResourceUrl: deps.config.premiumResourceUrl, premiumCommercialContentAllowed: deps.config.premiumCommercialContentAllowed, yevLinkDays: deps.config.yevLinkDays },
  };
  const emailLimits = { cooldownMinutes: deps.config.emailCooldownMinutes, recipientDailyQuota: deps.config.emailRecipientDailyQuota };
  const dispatch = async () => { if (deps.emailDispatch === "inline") await deliverDueFa4Emails(emailDeps); };

  const waitMs = deps.config.emailConfirmWaitMs ?? 8000;
  /**
   * Reports an email request TRUTHFULLY. `sent` only after the provider accepted the message; `pending` while it is still in flight
   * (HTTP 202 — the UI polls /session/email-status); `failed` otherwise (HTTP 502). A queued row is never reported as sent.
   * A repeated request while the delivery is FAILED/DEAD makes exactly one more attempt of the same delivery.
   */
  const settle = async (res: Response, deliveryId: string, extra: Record<string, unknown> = {}, recipient?: string, allowRetry = true) => {
    let status = await deliveryStatus(deps.db, deliveryId);
    if (allowRetry && (status === "FAILED" || status === "DEAD")) { await retryFa4Delivery(deps.db, deliveryId, deps.config.now()); status = "FAILED"; }
    await dispatch();
    const state: DeliveryState = await awaitDelivery(deps.db, deliveryId, waitMs);
    if (state === "sent") res.status(200).json({ state, ...extra });
    else if (state === "pending") res.status(202).json({ state, ...extra });
    // DSC-02 / DSC-33: a delivery refused by the closed-test recipient policy is NOT a delivery failure (no SMTP attempt was made): it gets its own code and a 4xx, so the person
    // is told the true reason and the 5xx alert keeps meaning «something is broken». Any other failure keeps the generic 502 with the real state. The address is never echoed.
    else if (recipient && deps.config.closedTest && !closedTestRecipientAllowed(recipient, deps.config.closedTest)) res.status(403).json({ error: "RECIPIENT_NOT_AUTHORIZED", message: "e-mail is limited to authorized addresses during the closed test" });
    else res.status(502).json({ error: "EMAIL_NOT_SENT", message: "the email could not be sent", details: { state } });
  };

  const handle = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((error: unknown) => {
      if (error instanceof FaError) res.status(error.status).json({ error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
      // the database is the second line of defence of the delivered state (closed answers / delivery consistency): never a raw 500
      else if (["BV604", "BV605", "BV606"].includes((error as { code?: string }).code ?? "")) res.status(409).json({ error: "ALREADY_DELIVERED", message: "this First Assessment was delivered" });
      else next(error);
    });
  };
  const session = async (req: Request): Promise<Fa4ProjectRow> => {
    const token = bearer(req);
    const project = token && looksLikeAccessToken(token) ? await projectByToken(deps.db, token, "SESSION", deps.config.now()) : null;
    if (!project) throw new FaError("UNAUTHENTICATED", "a valid working session is required");
    return project;
  };

  // Which legal regime this deployment runs under (non-sensitive). The web tier reads it before it will ever open access: an open deployment must be "final".
  router.get("/legal-mode", (_req, res) => { res.set("Cache-Control", "no-store").json({ legalMode: deps.config.legalMode ?? "final" }); });

  // Measurement of the real edge: N such that req.ip is the REAL client = the number of X-Forwarded-For entries (the client is entry 0). Returns only the caller's own address.
  router.get("/edge-check", (req, res) => {
    if (!deps.config.edgeDiagnostic) { res.status(404).json({ error: "NOT_FOUND" }); return; }
    const entries = String(req.headers["x-forwarded-for"] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    res.set("Cache-Control", "no-store").json({ ip: req.ip ?? null, xffEntries: entries.length, trustProxy: req.app.get("trust proxy") });
  });

  router.get("/catalog", handle(async (_req, res) => {
    res.set("Cache-Control", "no-store").json(toPublicCatalog(await loadPublishedCatalog(deps.db)));
  }));

  // Create the project right after the identity step. No account, no password.
  router.post("/sessions", rateLimit(limiter, lim('create')), handle(async (req, res) => {
    const parsed = answersSchema.safeParse(bodyOf(req).answers);
    if (!parsed.success) throw new FaError("INVALID_INPUT", "the answers are not valid");
    const a = onlyDeclared(parsed.data);
    const missing = [
      !a.identity.name.trim() && "name", !a.identity.company.trim() && "company", !isValidEmail(a.identity.email) && "email",
      !a.identity.termsAccepted && "termsAccepted", !a.identity.privacyAcknowledged && "privacyAcknowledged",
    ].filter(Boolean);
    if (missing.length) throw new FaError("INVALID_INPUT", "identity is incomplete", { fields: missing });
    const now = deps.config.now();
    const created = await createProject(deps.db, a, typeof bodyOf(req).step === "string" ? String(bodyOf(req).step).slice(0, 40) : "company", new Date(now.getTime() + deps.config.sessionTtlHours * 3_600_000), deps.config.legal);
    await recordEvent(deps.db, { name: "project_created", source: "server", projectId: created.projectId, locale: a.locale, step: "identity", props: { marketingOptIn: a.identity.marketingConsent === true } });
    if (a.identity.marketingConsent === true) await recordEvent(deps.db, { name: "marketing_opt_in_changed", source: "server", projectId: created.projectId, locale: a.locale, props: { consented: true } });
    res.status(201).json({ sessionToken: created.sessionToken });
  }));

  // Server-side capability / coverage resolution for THIS project only: returns coarse, customer-facing facts for the interaction
  // (which topics apply, which depend on a decision, cargo-route relevance, Premium shown) — never the capability × country matrix.
  router.post("/session/resolution", handle(async (req, res) => {
    await session(req);
    const parsed = answersSchema.safeParse(bodyOf(req).answers);
    if (!parsed.success) throw new FaError("INVALID_INPUT", "the answers are not valid");
    res.set("Cache-Control", "no-store").json(clientResolution(onlyDeclared(parsed.data), await loadPublishedCatalog(deps.db)));
  }));

  router.get("/session", handle(async (req, res) => {
    const p = await session(req);
    // the append-only consent history is the source of truth for the optional marketing checkbox
    res.set("Cache-Control", "no-store").json({ answers: { ...p.answers, identity: { ...p.answers.identity, marketingConsent: await latestMarketingConsent(deps.db, p.projectId) } }, step: p.stepKey, status: p.status });
  }));

  router.put("/session", handle(async (req, res) => {
    const p = await session(req);
    // D-156: after the explicit delivery the questionnaire is closed (enforced here AND by a database trigger)
    if (await isDelivered(deps.db, p.projectId)) throw new FaError("ALREADY_DELIVERED", "this First Assessment was delivered and can no longer be edited");
    const parsed = answersSchema.safeParse(bodyOf(req).answers);
    if (!parsed.success) throw new FaError("INVALID_INPUT", "the answers are not valid");
    // Email and the two legal acknowledgements are pinned to what was captured at identity: the email can't be swapped silently
    // and acceptance evidence (fa4_legal_acceptance) can't diverge from the stored flags. Name / company / role stay editable.
    const a = { ...onlyDeclared(parsed.data), identity: { ...parsed.data.identity, email: p.email, termsAccepted: p.answers.identity.termsAccepted, privacyAcknowledged: p.answers.identity.privacyAcknowledged } };
    const step = typeof bodyOf(req).step === "string" ? String(bodyOf(req).step).slice(0, 40) : p.stepKey;
    await saveProject(deps.db, p.projectId, a, step);
    const before = await latestMarketingConsent(deps.db, p.projectId);
    await recordMarketingConsent(deps.db, p.projectId, parsed.data.identity.marketingConsent === true, a.locale);   // optional, independent of Terms / Privacy; appends only on change
    if (step !== p.stepKey) await recordEvent(deps.db, { name: "step_reached", source: "server", projectId: p.projectId, locale: a.locale, step: step.split(":")[0]! });
    if (before !== (parsed.data.identity.marketingConsent === true)) await recordEvent(deps.db, { name: "marketing_opt_in_changed", source: "server", projectId: p.projectId, locale: a.locale, props: { consented: parsed.data.identity.marketingConsent === true } });
    res.json({ ok: true });
  }));

  // DSC-36 · the tab was idle for 30 min (or came back after it): ONE continuation link per period to the registered address. Idempotent: a reload, a second tab or the worker's sweep
  // returns the delivery that already exists (never a second e-mail); a failed one is retried ONLY when the person asks (`retry: true`) and it is the SAME delivery. The answer never
  // carries the address, the link or any token; a refusal by the closed-test recipient policy is 403 RECIPIENT_NOT_AUTHORIZED (never a 5xx). The project is never touched.
  router.post("/session/idle-continuation", rateLimit(limiter, lim('mail'), bearer), handle(async (req, res) => {
    const p = await session(req);
    const q = await enqueueIdleContinuation(deps.db, p.projectId, deps.config.now(), emailLimits);
    if (q.notEligible === "not_in_progress") throw new FaError("NOT_APPLICABLE", "this project is not open any more");
    if (q.blocked === "quota") { res.status(429).json({ error: "RATE_LIMITED", message: "too many emails for this address today" }); return; }
    if (!q.deliveryId) throw new FaError("NOT_FOUND", "no such project");
    if (q.queued) await recordEvent(deps.db, { name: "resume_email_auto_queued", source: "server", projectId: p.projectId, locale: p.answers.locale, props: { trigger: "tab" } });
    await settle(res, q.deliveryId, {}, p.email, bodyOf(req).retry === true);
  }));

  // "Guardar y seguir después": a resume link to the email already captured (never asked again). The answer reflects the real delivery state.
  router.post("/session/finish-later", rateLimit(limiter, lim('mail'), bearer), handle(async (req, res) => {
    const p = await session(req);
    const r = await enqueueFa4Email(deps.db, p.projectId, "fa4_resume_link", deps.config.now(), emailLimits);
    if (r.blocked === "quota") { res.status(429).json({ error: "RATE_LIMITED", message: "too many emails for this address today" }); return; }
    if (!r.deliveryId) throw new FaError("NOT_FOUND", "no such project");
    if (r.queued) await recordEvent(deps.db, { name: "resume_email_requested", source: "server", projectId: p.projectId, locale: p.answers.locale });
    await settle(res, r.deliveryId, { email: maskEmail(p.email) }, p.email);
  }));

  // State of the latest email of a kind, for the UI to poll while a send is `pending`.
  router.get("/session/email-status", handle(async (req, res) => {
    const p = await session(req);
    const kind = req.query.kind === "result" ? "fa4_result_link" : req.query.kind === "resume" ? "fa4_resume_link" : null;
    if (!kind) throw new FaError("INVALID_INPUT", "unknown kind");
    const d = await latestDelivery(deps.db, p.projectId, kind as Fa4EmailTemplate);
    res.set("Cache-Control", "no-store").json({ state: d ? stateOfStatus(d.status) : "none" });
  }));

  router.get("/session/result", handle(async (req, res) => {
    const p = await session(req);
    const r = await latestResult(deps.db, p.projectId);
    if (!r) throw new FaError("NOT_FOUND", "no result yet");
    res.set("Cache-Control", "no-store").json({ resultId: r.resultId, model: r.model, delivered: true, deliveredAt: r.deliveredAt });
  }));

  // PREVIEW (D-156): computes the YEV from the current answers. Nothing historical is stored and the project is NOT delivered. «Corregir algo» + regenerate stay available.
  router.post("/session/result", handle(async (req, res) => {
    const p = await session(req);
    const done = await latestResult(deps.db, p.projectId);
    if (done) throw new FaError("ALREADY_DELIVERED", "this First Assessment was delivered", { resultId: done.resultId });
    const { model, previewToken } = await previewResult(deps.db, p.projectId, onlyDeclared(p.answers), deps.config.now());   // rows saved before DSC-01 are normalised too
    const m = model;
    await recordEvent(deps.db, {
      name: "yev_previewed", source: "server", projectId: p.projectId, locale: p.answers.locale, step: "result", catalogVersion: m.catalogVersion,
      props: {
        destinations: m.destinations.map((d) => d.destination), destinationCount: m.destinations.length, applies: m.counts.applies, depends: m.counts.depends,
        shortcut: m.shortcut, activities: [...new Set(p.answers.components.flatMap((c) => c.activities))],
        noCoverageDestinations: m.destinations.filter((d) => d.countryMessage).map((d) => d.destination),
      },
    });
    res.set("Cache-Control", "no-store").json({ preview: true, previewToken, model });
  }));

  /** Explicit delivery (D-156): idempotent; records `yev_delivered` once. Returns the sealed result. */
  const deliver = async (p: Fa4ProjectRow, via: "EMAIL" | "CONTINUATION", body: Record<string, unknown>) => {
    const token = typeof body.previewToken === "string" && /^[a-f0-9]{32}$/.test(body.previewToken) ? body.previewToken : undefined;
    const d = await deliverResult(deps.db, p.projectId, deps.config.now(), { previewToken: token, requirePremium: via === "CONTINUATION" });
    if (!d.alreadyDelivered)
      await recordEvent(deps.db, { name: "yev_delivered", source: "server", projectId: p.projectId, locale: p.answers.locale, step: "result", catalogVersion: d.model.catalogVersion,
        props: { via, premiumShown: d.model.premium.shown, destinationCount: d.model.destinations.length, applies: d.model.counts.applies, depends: d.model.counts.depends } });
    return d;
  };

  router.post("/session/result/email", rateLimit(limiter, lim('mail'), bearer), handle(async (req, res) => {
    const p = await session(req);
    const d = await deliver(p, "EMAIL", bodyOf(req));                        // asking for the result by email IS the delivery (D-156); the email is sent for THIS sealed result
    const q = await enqueueFa4Email(deps.db, p.projectId, "fa4_result_link", deps.config.now(), emailLimits, `${d.resultId}:`);
    if (q.blocked === "quota") { res.status(429).json({ error: "RATE_LIMITED", message: "too many emails for this address today" }); return; }
    if (!q.deliveryId) throw new FaError("NOT_FOUND", "no such project");
    if (q.queued) await recordEvent(deps.db, { name: "yev_email_requested", source: "server", projectId: p.projectId, locale: p.answers.locale });
    await settle(res, q.deliveryId, { email: maskEmail(p.email), resultId: d.resultId }, p.email);
  }));

  // "Hablar con beeside": an operational message to contact@beeside.you. Not marketing (never touches marketingConsent), not a provider
  // referral, not The Hive. Idempotent per clientRequestId; success is reported only when the mailbox's SMTP server accepted it.
  // Available with a working session (can attach the progress, only when ticked) and before Identity (cover): anonymous, no progress.
  const contact = (withSession: boolean): Handler => async (req, res) => {
    const p = withSession ? await session(req) : null;
    const b = bodyOf(req);
    const str = cleanInput;   // control characters (NUL included) never enter storage or an email; newlines survive in the message only
    const name = str(b.name, 120), company = str(b.company, 160), email = str(b.email, 254), message = str(b.message, 4000, true);
    if (!name || !isValidEmail(email) || message.length < 3 || (withSession && !company)) throw new FaError("INVALID_INPUT", "the message is incomplete");
    const clientRequestId = /^[A-Za-z0-9_-]{8,64}$/.test(str(b.clientRequestId, 64)) ? str(b.clientRequestId, 64) : randomUUID();
    const share = withSession && b.shareProgress === true;
    const locale = p?.answers.locale ?? (b.locale === "en" ? "en" : "es");
    const c = await enqueueContact(deps.db, p?.projectId ?? null, { name, company, email, message, shareProgress: share, clientRequestId, originStage: withSession && b.stage === "YEV" ? "YEV" : "FA" }, locale, deps.config.now());
    if (c.created) await recordEvent(deps.db, { name: "contact_submitted", source: "server", projectId: p?.projectId ?? null, locale, props: { shareProgress: share, anonymous: !p, stage: withSession && b.stage === "YEV" ? "YEV" : "FA" } });
    await settle(res, c.deliveryId, { email: maskEmail(email) });
  };
  router.post("/session/contact", rateLimit(limiter, lim('contact'), bearer), handle(contact(true)));
  router.post("/contact", rateLimit(limiter, lim('contact')), handle(contact(false)));

  // Minimal event capture. Anonymous (visit id only) before Identity; project-linked when a valid session header is present. Never fails the UI.
  router.post("/events", rateLimit(limiter, lim('events')), handle(async (req, res) => {
    const ev = parseClientEvent(req.body);
    if (!ev) { res.status(204).end(); return; }
    const token = bearer(req);
    const project = token && looksLikeAccessToken(token) ? await projectByToken(deps.db, token, "SESSION", deps.config.now()).catch(() => null) : null;
    await recordEvent(deps.db, {
      name: ev.name, source: "client", visitId: ev.visitId, projectId: project?.projectId ?? null, step: ev.step ?? null,
      locale: project?.answers.locale ?? (typeof ev.props.locale === "string" ? (ev.props.locale as "es" | "en") : null),
      props: ev.props as Record<string, string>,
    });
    res.status(204).end();
  }));

  // «Comienza tu expansión» (D-154): the explicit confirmation is the other delivery action. It delivers (idempotent) and records the Premium
  // continuation for the SAME project + the definitive delivered result. Not marketing consent (D-140 / D-144). No payment in FA.
  router.post("/session/continue", handle(async (req, res) => {
    const p = await session(req);
    const d = await deliver(p, "CONTINUATION", bodyOf(req));
    if (!d.model.premium.shown) throw new FaError("NOT_APPLICABLE", "no continuation is offered for this result");
    await requestContinuation(deps.db, p.projectId, d.resultId);
    await recordEvent(deps.db, { name: "premium_continuation_requested", source: "server", projectId: p.projectId, locale: p.answers.locale, catalogVersion: d.model.catalogVersion });
    res.json({ ok: true, resultId: d.resultId });
  }));

  // Exchange an emailed RESUME link token (URL fragment) for a working session. The link is project-specific and SINGLE-USE:
  // the exchange atomically spends it, so a replay (or a forwarded copy) is refused with the same generic answer as an unknown link.
  router.post("/links/continue", handle(async (req, res) => {
    const raw = bodyOf(req).token;
    const now = deps.config.now();
    const exchanged = looksLikeAccessToken(raw) ? await exchangeLinkToken(deps.db, raw, now, new Date(now.getTime() + deps.config.sessionTtlHours * 3_600_000)) : null;
    if (!exchanged) throw new FaError("NOT_FOUND", "this link is not valid or has expired");
    await recordEvent(deps.db, { name: "resume_link_used", source: "server", projectId: exchanged.projectId });
    res.json({ sessionToken: exchanged.sessionToken, kind: exchanged.kind });
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
