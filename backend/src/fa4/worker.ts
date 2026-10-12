import { fa4DepsFromEnv } from "../index";
import { deliverDueFa4Emails } from "./email";
import { jsonLogger } from "../security/redact";

/**
 * Dedicated FA4 outbox worker: delivers `fa4_email_delivery` rows. It needs only the FA4 configuration (DATABASE_URL, APP_BASE_URL,
 * FA4_EMAIL_TRANSPORT and the SMTP_* variables), independent of the legacy First Assessment worker.
 *  - safe to run as several replicas: rows are claimed with FOR UPDATE SKIP LOCKED + a lease, so one email has one sender at a time;
 *  - recoverable: a crashed sender's lease expires and the row is picked up again (at-least-once; the delivery id is the idempotency key);
 *  - bounded retries with backoff, then DEAD (the person can ask again; the next request schedules one more attempt of the same delivery);
 *  - no DB transaction is open while the provider is contacted.
 * Run: `node dist/fa4/worker.js` (container command) — or as a Cloud Run job / scheduler calling `runFa4OutboxOnce`.
 */
export async function runFa4OutboxOnce(env: NodeJS.ProcessEnv = process.env): Promise<{ sent: number; failed: number; dead: number }> {
  const fa4 = fa4DepsFromEnv({ ...env, FA4_API_ENABLED: "true" });
  if (!fa4) throw new Error("FA4 is not configured");
  return deliverDueFa4Emails({ db: fa4.db, email: fa4.email, config: { appBaseUrl: fa4.config.appBaseUrl, resumeLinkDays: fa4.config.resumeLinkDays, now: fa4.config.now, contactAddress: fa4.config.contactAddress, premiumResourceUrl: fa4.config.premiumResourceUrl } });
}

/* istanbul ignore next -- process entry point */
if (require.main === module) {
  const fa4 = fa4DepsFromEnv({ ...process.env, FA4_API_ENABLED: "true" });
  if (!fa4) throw new Error("FA4 is not configured");
  const emailDeps = { db: fa4.db, email: fa4.email, config: { appBaseUrl: fa4.config.appBaseUrl, resumeLinkDays: fa4.config.resumeLinkDays, now: fa4.config.now, contactAddress: fa4.config.contactAddress, premiumResourceUrl: fa4.config.premiumResourceUrl } };
  const pollMs = Number(process.env.FA4_WORKER_POLL_MS ?? 5_000);
  let busy = false; let stopping = false;
  const tick = async () => {
    if (busy || stopping) return;
    busy = true;
    try {
      const r = await deliverDueFa4Emails(emailDeps);
      if (r.sent + r.failed + r.dead > 0) jsonLogger("info", "fa4 email outbox", r);
    } catch (error) {
      jsonLogger("error", "fa4 email outbox tick failed", { error: error instanceof Error ? error.name : "unknown" });
    } finally { busy = false; }
  };
  const timer = setInterval(() => void tick(), pollMs);
  void tick();
  const stop = () => { stopping = true; clearInterval(timer); const w = setInterval(() => { if (!busy) { clearInterval(w); process.exit(0); } }, 200); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
