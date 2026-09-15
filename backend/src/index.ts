import express from "express";
import { Pool } from "pg";
import { AdminDeps, createAdminRouter } from "./admin/admin-router";
import { OidcIdentityProvider } from "./admin/oidc";
import { createConfigVersioningService } from "./config-versioning/service";
import { createPoolDb } from "./db/database";
import { LogEmailTransport } from "./fa/email/email-adapter";
import { createFaRouter } from "./fa/routes";
import { BundleStore } from "./fa/services/bundle-store";
import { FaDeps } from "./fa/services/repository";
import { BillingDeps, createBillingRouter } from "./premium/billing-router";
import { devSimulatedCheckout } from "./premium/premium-service";
import { healthRouter } from "./routes/health";

export interface AppOptions {
  /** First Assessment API dependencies; the API is mounted only when provided. */
  fa?: FaDeps;
  /** Provider-agnostic subscription event endpoint; mounted only when provided. */
  billing?: BillingDeps;
  /** Admin/Supervisor Control Center API; mounted only when provided (identity provider configured). */
  admin?: AdminDeps;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(healthRouter);
  if (options.fa) app.use("/api/fa", createFaRouter(options.fa));
  if (options.billing) app.use("/api/billing", createBillingRouter(options.billing));
  if (options.admin) app.use("/api/admin", createAdminRouter(options.admin));
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
  };
}

/**
 * The First Assessment API collects personal data, so it stays off unless explicitly enabled
 * (FA_API_ENABLED=true) — the deployed dev service does not enable it before Phase 13 controls.
 * No payment provider is selected either: Premium requests wait for manual confirmation, unless a
 * local machine explicitly simulates the provider (PREMIUM_DEV_SIMULATION=true, never in production).
 */
export function faDepsFromEnv(env: NodeJS.ProcessEnv = process.env): FaDeps | undefined {
  if (env.FA_API_ENABLED !== "true") return undefined;
  if (!env.DATABASE_URL || !env.APP_BASE_URL) throw new Error("FA_API_ENABLED requires DATABASE_URL and APP_BASE_URL");
  const base = baseDepsFromEnv(env);
  const simulate = env.PREMIUM_DEV_SIMULATION === "true" && env.NODE_ENV !== "production";
  return { ...base, ...(simulate ? { premium: { checkout: devSimulatedCheckout({ bundles: base.bundles }) } } : {}) };
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

/* istanbul ignore next -- exercised by real deployment, not unit tests */
if (require.main === module) {
  const app = createApp({ fa: faDepsFromEnv(), billing: billingDepsFromEnv(), admin: adminDepsFromEnv() });
  const port = Number(process.env.PORT ?? 8080);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`beeside backend listening on :${port}`);
  });
}
