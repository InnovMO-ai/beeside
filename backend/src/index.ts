import express from "express";
import { Pool } from "pg";
import { createPoolDb } from "./db/database";
import { LogEmailTransport } from "./fa/email/email-adapter";
import { createFaRouter } from "./fa/routes";
import { BundleStore } from "./fa/services/bundle-store";
import { FaDeps } from "./fa/services/repository";
import { healthRouter } from "./routes/health";

export interface AppOptions {
  /** First Assessment API dependencies; the API is mounted only when provided. */
  fa?: FaDeps;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(healthRouter);
  if (options.fa) app.use("/api/fa", createFaRouter(options.fa));
  return app;
}

/**
 * The First Assessment API collects personal data, so it stays off unless explicitly enabled
 * (FA_API_ENABLED=true) — the deployed dev service does not enable it before Phase 13 controls.
 * No email provider is selected: messages are logged as metadata (links only on a local machine).
 */
export function faDepsFromEnv(env: NodeJS.ProcessEnv = process.env): FaDeps | undefined {
  if (env.FA_API_ENABLED !== "true") return undefined;
  if (!env.DATABASE_URL || !env.APP_BASE_URL) throw new Error("FA_API_ENABLED requires DATABASE_URL and APP_BASE_URL");
  const db = createPoolDb(new Pool({ connectionString: env.DATABASE_URL }));
  return {
    db,
    email: new LogEmailTransport(env.DEV_LOG_EMAIL_LINKS === "true" && env.NODE_ENV !== "production"),
    bundles: new BundleStore(db),
    config: { appBaseUrl: env.APP_BASE_URL, sessionTtlHours: 24, emailCooldownMinutes: 5, now: () => new Date() },
  };
}

/* istanbul ignore next -- exercised by real deployment, not unit tests */
if (require.main === module) {
  const app = createApp({ fa: faDepsFromEnv() });
  const port = Number(process.env.PORT ?? 8080);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`beeside backend listening on :${port}`);
  });
}
