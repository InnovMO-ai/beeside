import express from "express";
import { Pool } from "pg";
import { AdminDeps, createAdminRouter } from "./admin/admin-router";
import { OidcIdentityProvider } from "./admin/oidc";
import { createConfigVersioningService } from "./config-versioning/service";
import { Db, createPoolDb } from "./db/database";
import { LogEmailTransport } from "./fa/email/email-adapter";
import { createFaRouter } from "./fa/routes";
import { FA4_RATE_LIMITS, Fa4Deps, createFa4Router } from "./fa4/routes";
import { LegalConfig } from "./fa4/repository";
import { BundleStore } from "./fa/services/bundle-store";
import { FaDeps } from "./fa/services/repository";
import { integrationsFromEnv } from "./integrations/config";
import { BillingDeps, createBillingRouter } from "./premium/billing-router";
import { devSimulatedCheckout } from "./premium/premium-service";
import { healthRouter } from "./routes/health";
import { readinessRouter, shippedMigrationCount } from "./routes/readiness";
import { MAX_REQUEST_BYTES, errorHandler, notFoundJson, originGuard, rejectOversizedBodies, requestContext, securityHeaders } from "./security/http-hardening";
import { MemoryRateLimitStore, PostgresRateLimitStore, RATE_LIMITS, RateLimiter, createRateLimiter, rateLimit } from "./security/rate-limit";
import { Logger, jsonLogger } from "./security/redact";
import { allowedOrigins, assertRuntimeConfig, runtimeDbPrivilegeProblems, trustProxyHops } from "./security/runtime-config";

export interface SecurityOptions {
  /** Adds HSTS and refuses development conveniences. */
  production?: boolean;
  /** Origins allowed to send state-changing browser requests; omit to skip the check (tests). */
  allowedOrigins?: ReadonlySet<string>;
  /** Proxy hops to trust when reading the client address (0 unless a proxy sets X-Forwarded-For). */
  trustProxyHops?: number;
  /** Omit to run without rate limiting (tests and local runs). */
  limiter?: RateLimiter;
  log?: Logger;
}

export interface AppOptions {
  /** First Assessment API dependencies; the API is mounted only when provided. */
  fa?: FaDeps;
  /** FA Public v1.0 API (isolated module); mounted only when provided. */
  fa4?: Fa4Deps;
  /** Provider-agnostic subscription event endpoint; mounted only when provided. */
  billing?: BillingDeps;
  /** Admin/Supervisor Control Center API; mounted only when provided (identity provider configured). */
  admin?: AdminDeps;
  /** Readiness probe: reports ready only when the shipped migrations are applied. */
  readiness?: { db: Db; expectedMigrations: number };
  security?: SecurityOptions;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const security = options.security ?? {};
  const log = security.log ?? jsonLogger;
  app.disable("x-powered-by");
  // Client addresses key the rate limits: only the configured number of proxy hops is believed.
  app.set("trust proxy", security.trustProxyHops ?? 0);
  app.use(requestContext());
  app.use(securityHeaders({ production: security.production === true }));
  app.use(rejectOversizedBodies(MAX_REQUEST_BYTES));
  if (security.allowedOrigins) app.use(originGuard(security.allowedOrigins));
  app.use(healthRouter);
  if (options.readiness) app.use(readinessRouter(options.readiness.db, options.readiness.expectedMigrations));
  if (options.fa) app.use("/api/fa", createFaRouter(options.fa, { limiter: security.limiter }));
  if (options.fa4) app.use("/api/fa4", createFa4Router(options.fa4, { limiter: security.limiter }));
  if (options.billing) app.use("/api/billing", rateLimit(security.limiter, RATE_LIMITS.billingAddress), createBillingRouter(options.billing));
  if (options.admin) app.use("/api/admin", createAdminRouter(options.admin, { limiter: security.limiter }));
  app.use(notFoundJson());
  app.use(errorHandler(log));
  return app;
}

/**
 * Shared runtime dependencies (database, configuration bundles, email transport). No email provider
 * is selected: messages are logged as metadata (links only on a local machine), behind the
 * provider-agnostic transport interface.
 */
export function baseDepsFromEnv(env: NodeJS.ProcessEnv = process.env): FaDeps {
  if (!env.DATABASE_URL || !env.APP_BASE_URL) throw new Error("DATABASE_URL and APP_BASE_URL are required");
  const db = createPoolDb(new Pool({ connectionString: env.DATABASE_URL }));
  const cooldown = Number(env.EMAIL_RESEND_COOLDOWN_MINUTES ?? 5);
  return {
    db,
    email: new LogEmailTransport(env.DEV_LOG_EMAIL_LINKS === "true" && env.NODE_ENV !== "production"),
    bundles: new BundleStore(db),
    config: {
      appBaseUrl: env.APP_BASE_URL,
      sessionTtlHours: 24,
      emailCooldownMinutes: Number.isFinite(cooldown) && cooldown >= 0 && cooldown <= 1440 ? cooldown : 5,
      now: () => new Date(),
    },
    emailDispatch: "background",
    integrations: integrationsFromEnv(env, jsonLogger),
  };
}

/**
 * The First Assessment API collects personal data, so it stays off unless explicitly enabled
 * (FA_API_ENABLED=true). No payment provider is selected either: Premium requests wait for manual
 * confirmation, unless a local machine explicitly simulates the provider (PREMIUM_DEV_SIMULATION=true,
 * never in production).
 */
export function faDepsFromEnv(env: NodeJS.ProcessEnv = process.env): FaDeps | undefined {
  if (env.FA_API_ENABLED !== "true") return undefined;
  if (!env.DATABASE_URL || !env.APP_BASE_URL) throw new Error("FA_API_ENABLED requires DATABASE_URL and APP_BASE_URL");
  const base = baseDepsFromEnv(env);
  const simulate = env.PREMIUM_DEV_SIMULATION === "true" && env.NODE_ENV !== "production";
  return { ...base, ...(simulate ? { premium: { checkout: devSimulatedCheckout({ bundles: base.bundles }) } } : {}) };
}

/**
 * FA Public v1.0 API (module fa4), isolated from the legacy First Assessment. Off unless FA4_API_ENABLED=true; it reuses the existing
 * EmailTransport, the shared rate limiter / `rate_limit_counter` table and the same Postgres pool settings.
 */
export function fa4DepsFromEnv(env: NodeJS.ProcessEnv = process.env, shared?: Db): Fa4Deps | undefined {
  if (env.FA4_API_ENABLED !== "true") return undefined;
  if (!env.DATABASE_URL || !env.APP_BASE_URL) throw new Error("FA4_API_ENABLED requires DATABASE_URL and APP_BASE_URL");
  const staging = fa4IsInternalStaging(env);
  const db = shared ?? createPoolDb(new Pool({ connectionString: env.DATABASE_URL }));
  return {
    db,
    // Internal staging never sends email: it logs (with links, so testers can follow resume / result links) through the log transport.
    email: new LogEmailTransport(staging || (env.DEV_LOG_EMAIL_LINKS === "true" && env.NODE_ENV !== "production")),
    config: {
      appBaseUrl: env.APP_BASE_URL,
      sessionTtlHours: Number(env.FA4_SESSION_TTL_HOURS ?? 24),
      resumeLinkDays: Number(env.FA4_RESUME_LINK_DAYS ?? 30),
      emailCooldownMinutes: Number(env.EMAIL_RESEND_COOLDOWN_MINUTES ?? 5),
      emailRecipientDailyQuota: Number(env.FA4_EMAIL_RECIPIENT_DAILY_QUOTA ?? 6),
      resumeProjectsPerRequest: Number(env.FA4_RESUME_PROJECTS_PER_REQUEST ?? 3),
      legal: fa4LegalFromEnv(env),
      rateLimits: fa4RateLimitOverrides(env),
      now: () => new Date(),
    },
    // Internal staging delivers inline (no worker needed); everywhere else a worker delivers the outbox.
    emailDispatch: staging ? "inline" : "deferred",
  };
}

/**
 * INTERNAL STAGING (not a public launch): explicit opt-in FA4_ENV=staging. It is refused for the public beeside.you hosts and it enables
 * only TEST legal placeholders, log-only email and inline delivery. Public production (FA4_ENV unset) keeps every guard.
 */
export function fa4IsInternalStaging(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.FA4_ENV !== "staging") return false;
  let host = "";
  try { host = new URL(env.APP_BASE_URL ?? "").hostname.toLowerCase(); } catch { /* validated by the caller */ }
  if (host === "beeside.you" || host === "www.beeside.you") throw new Error("FA4_ENV=staging is refused for the public host (" + host + "): staging must run on its own internal host");
  return true;
}

/**
 * Legal acceptance evidence (M2). The Terms / Privacy document identifiers and URLs are configuration, not code: the final documents
 * are launch blocker LEGAL-1 / CHK-1. In production they MUST be set (startup fails otherwise); elsewhere a clearly marked placeholder
 * is recorded so no environment silently stores a plausible-looking version.
 */
const OFFICIAL_TERMS = { version: "1.0-2026-08-27", url: "https://www.beeside.you/termsandconditions" } as const;
export function fa4LegalFromEnv(env: NodeJS.ProcessEnv = process.env): LegalConfig {
  // Terms (CHK-1, closed): the official page is the same document for both languages in version 1.0; env vars override it for a future version.
  // Privacy is still pending (CHK-1): in production the API refuses to start until its version and URLs are configured.
  // FA4_TERMS_URL / FA4_PRIVACY_URL set one document for both languages (FA4_*_URL_ES|EN still override per language).
  const privacyEs = env.FA4_PRIVACY_URL_ES ?? env.FA4_PRIVACY_URL; const privacyEn = env.FA4_PRIVACY_URL_EN ?? env.FA4_PRIVACY_URL;
  // INTERNAL STAGING only: an explicit, visibly non-legal TEST value is recorded as the acceptance evidence for Privacy.
  if (fa4IsInternalStaging(env) && !env.FA4_PRIVACY_VERSION) {
    const base = (env.APP_BASE_URL ?? "").replace(/\/$/, "");
    const test = `${base}/staging/privacy-test`;
    return {
      termsVersion: env.FA4_TERMS_VERSION ?? OFFICIAL_TERMS.version,
      termsUrl: { es: env.FA4_TERMS_URL_ES ?? env.FA4_TERMS_URL ?? OFFICIAL_TERMS.url, en: env.FA4_TERMS_URL_EN ?? env.FA4_TERMS_URL ?? OFFICIAL_TERMS.url },
      privacyVersion: "STAGING-TEST-NOT-LEGAL", privacyUrl: { es: test, en: test },
    };
  }
  const missing = [!env.FA4_PRIVACY_VERSION && "FA4_PRIVACY_VERSION", !privacyEs && "FA4_PRIVACY_URL_ES (or FA4_PRIVACY_URL)", !privacyEn && "FA4_PRIVACY_URL_EN (or FA4_PRIVACY_URL)"].filter(Boolean);
  if (missing.length && env.NODE_ENV === "production") throw new Error(`FA4_API_ENABLED requires ${missing.join(", ")} in production (LEGAL-1: final Terms / Privacy version and URL)`);
  const ph = "UNSET-LEGAL-1";
  return {
    termsVersion: env.FA4_TERMS_VERSION ?? OFFICIAL_TERMS.version,
    termsUrl: { es: env.FA4_TERMS_URL_ES ?? env.FA4_TERMS_URL ?? OFFICIAL_TERMS.url, en: env.FA4_TERMS_URL_EN ?? env.FA4_TERMS_URL ?? OFFICIAL_TERMS.url },
    privacyVersion: env.FA4_PRIVACY_VERSION ?? ph, privacyUrl: { es: privacyEs ?? ph, en: privacyEn ?? ph },
  };
}

/** Abuse-prevention limits are configurable: FA4_RL_<NAME>="<limit>/<windowSeconds>", e.g. FA4_RL_LINKREQUESTEMAIL=3/3600. */
export function fa4RateLimitOverrides(env: NodeJS.ProcessEnv = process.env): NonNullable<Fa4Deps["config"]["rateLimits"]> {
  const out: NonNullable<Fa4Deps["config"]["rateLimits"]> = {};
  for (const k of Object.keys(FA4_RATE_LIMITS) as Array<keyof typeof FA4_RATE_LIMITS>) {
    const m = /^(\d+)\/(\d+)$/.exec(env[`FA4_RL_${k.toUpperCase()}`] ?? "");
    if (m) out[k] = { limit: Number(m[1]), windowSeconds: Number(m[2]) };
  }
  return out;
}

/** Signed subscription events from a future billing adapter (BILLING_EVENTS_ENABLED=true). */
export function billingDepsFromEnv(env: NodeJS.ProcessEnv = process.env): BillingDeps | undefined {
  if (env.BILLING_EVENTS_ENABLED !== "true") return undefined;
  if (!env.DATABASE_URL) throw new Error("BILLING_EVENTS_ENABLED requires DATABASE_URL");
  if (!env.BILLING_WEBHOOK_SECRET || env.BILLING_WEBHOOK_SECRET.length < 32) throw new Error("BILLING_EVENTS_ENABLED requires a BILLING_WEBHOOK_SECRET of at least 32 characters");
  const db = createPoolDb(new Pool({ connectionString: env.DATABASE_URL }));
  return { db, bundles: new BundleStore(db), secret: env.BILLING_WEBHOOK_SECRET };
}

/**
 * The Admin API is never public by convenience: it is mounted only with ADMIN_API_ENABLED=true AND a
 * complete OpenID Connect configuration (any standards-compliant identity provider — none is chosen
 * here) AND a session secret from the secrets store. Insecure cookies are a local-only override.
 */
export function adminDepsFromEnv(env: NodeJS.ProcessEnv = process.env): AdminDeps | undefined {
  if (env.ADMIN_API_ENABLED !== "true") return undefined;
  const required = ["DATABASE_URL", "APP_BASE_URL", "ADMIN_APP_ORIGIN", "ADMIN_OIDC_ISSUER", "ADMIN_OIDC_CLIENT_ID", "ADMIN_OIDC_CLIENT_SECRET", "ADMIN_OIDC_REDIRECT_URI", "ADMIN_SESSION_SECRET"];
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`ADMIN_API_ENABLED requires ${missing.join(", ")}`);
  if ((env.ADMIN_SESSION_SECRET ?? "").length < 32) throw new Error("ADMIN_SESSION_SECRET must be at least 32 characters");
  const insecureCookies = env.ADMIN_COOKIE_SECURE === "false";
  if (insecureCookies && env.NODE_ENV === "production") throw new Error("ADMIN_COOKIE_SECURE=false is not allowed in production");
  const fa = baseDepsFromEnv(env);
  return {
    fa,
    identity: new OidcIdentityProvider({
      issuer: env.ADMIN_OIDC_ISSUER as string,
      clientId: env.ADMIN_OIDC_CLIENT_ID as string,
      clientSecret: env.ADMIN_OIDC_CLIENT_SECRET as string,
      redirectUri: env.ADMIN_OIDC_REDIRECT_URI as string,
      allowedEmailDomains: (env.ADMIN_ALLOWED_EMAIL_DOMAINS ?? "")
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
    }),
    session: {
      sessionSecret: env.ADMIN_SESSION_SECRET as string,
      sessionTtlMinutes: 8 * 60,
      idleTimeoutMinutes: 30,
      cookieSecure: !insecureCookies,
      appOrigin: (env.ADMIN_APP_ORIGIN as string).replace(/\/$/, ""),
    },
    configService: createConfigVersioningService(fa.db),
  };
}

/**
 * Rate limiting, trusted proxy hops and the Origin allow-list. Counters live in PostgreSQL when a
 * database is configured, so all instances share one budget; the hashing secret is required in
 * production (validateRuntimeConfig) and falls back to a development value locally.
 */
export function securityOptionsFromEnv(env: NodeJS.ProcessEnv = process.env, db: Db | null = null): SecurityOptions {
  const store = db ? new PostgresRateLimitStore(db) : new MemoryRateLimitStore();
  const disabled = env.RATE_LIMITING_ENABLED === "false" && env.NODE_ENV !== "production";
  return {
    production: env.NODE_ENV === "production",
    allowedOrigins: allowedOrigins(env),
    trustProxyHops: trustProxyHops(env),
    log: jsonLogger,
    ...(disabled
      ? {}
      : {
          limiter: createRateLimiter({
            store,
            secret: env.SECURITY_HASH_SECRET ?? "development-rate-limit-secret-not-for-production",
            now: () => new Date(),
            log: jsonLogger,
          }),
        }),
  };
}

/* istanbul ignore next -- exercised by real deployment, not unit tests */
if (require.main === module) {
  assertRuntimeConfig(process.env, (level, message) => jsonLogger(level, message));
  const fa = faDepsFromEnv();
  const billing = billingDepsFromEnv();
  const admin = adminDepsFromEnv();
  const fa4 = fa4DepsFromEnv(process.env, fa?.db ?? admin?.fa.db ?? billing?.db);
  const db: Db | null = fa?.db ?? admin?.fa.db ?? billing?.db ?? fa4?.db ?? null;
  const app = createApp({
    fa,
    fa4,
    billing,
    admin,
    security: securityOptionsFromEnv(process.env, db),
    ...(db ? { readiness: { db, expectedMigrations: shippedMigrationCount() } } : {}),
  });
  const port = Number(process.env.PORT ?? 8080);
  const server = app.listen(port, () => jsonLogger("info", "beeside backend listening", { port }));
  // Slow-request protections (a request may not hold a connection open indefinitely).
  server.requestTimeout = 30_000;
  server.headersTimeout = 35_000;
  server.keepAliveTimeout = 65_000;

  // Least privilege: the runtime database user must not be able to change the schema or own it.
  if (db && process.env.DB_PRIVILEGE_CHECK !== "off") {
    void runtimeDbPrivilegeProblems(db)
      .then((problems) => {
        if (problems.length === 0) return;
        for (const problem of problems) jsonLogger(process.env.NODE_ENV === "production" ? "error" : "warn", "database privilege check", { problem });
        if (process.env.NODE_ENV === "production") {
          jsonLogger("error", "refusing to serve production traffic with an over-privileged database user");
          server.close(() => process.exit(1));
        }
      })
      .catch((error: unknown) => jsonLogger("warn", "database privilege check could not run", { error: String(error) }));
  }
}
