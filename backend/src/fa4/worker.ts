import { fa4DepsFromEnv } from "../index";
import { deliverDueFa4Emails } from "./email";
import { ORPHAN_CONTACT_RETENTION_DAYS, purgeExpiredOrphanContacts } from "./retention";
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
  return deliverDueFa4Emails({ db: fa4.db, email: fa4.email, config: { appBaseUrl: fa4.config.appBaseUrl, publicPath: fa4.config.publicPath, closedTest: fa4.config.closedTest, resumeLinkDays: fa4.config.resumeLinkDays, now: fa4.config.now, contactAddress: fa4.config.contactAddress, premiumResourceUrl: fa4.config.premiumResourceUrl, premiumCommercialContentAllowed: fa4.config.premiumCommercialContentAllowed, yevLinkDays: fa4.config.yevLinkDays } });
}

/* istanbul ignore next -- process entry point */
if (require.main === module) {
  const fa4 = fa4DepsFromEnv({ ...process.env, FA4_API_ENABLED: "true" });
  if (!fa4) throw new Error("FA4 is not configured");
  const emailDeps = { db: fa4.db, email: fa4.email, config: { appBaseUrl: fa4.config.appBaseUrl, publicPath: fa4.config.publicPath, closedTest: fa4.config.closedTest, resumeLinkDays: fa4.config.resumeLinkDays, now: fa4.config.now, contactAddress: fa4.config.contactAddress, premiumResourceUrl: fa4.config.premiumResourceUrl, premiumCommercialContentAllowed: fa4.config.premiumCommercialContentAllowed, yevLinkDays: fa4.config.yevLinkDays } };
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
  // retention: pre-project contact requests are anonymized after 180 days (checked hourly; idempotent, bounded)
  const retentionDays = Number(process.env.FA4_ORPHAN_CONTACT_RETENTION_DAYS ?? ORPHAN_CONTACT_RETENTION_DAYS);
  const purge = async () => {
    try { const n = await purgeExpiredOrphanContacts(fa4.db, new Date(), retentionDays); if (n > 0) jsonLogger("info", "fa4 orphan contacts anonymized", { count: n }); }
    catch (error) { jsonLogger("error", "fa4 retention failed", { error: error instanceof Error ? error.name : "unknown" }); }
  };
  void purge(); const purgeTimer = setInterval(() => void purge(), 3_600_000);
  const timer = setInterval(() => void tick(), pollMs);
  void tick();
  const stop = () => { stopping = true; clearInterval(timer); clearInterval(purgeTimer); const w = setInterval(() => { if (!busy) { clearInterval(w); process.exit(0); } }, 200); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
