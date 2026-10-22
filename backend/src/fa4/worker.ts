import { fa4DepsFromEnv } from "../index";
import { deliverDueFa4Emails, sweepIdleContinuations } from "./email";
import { ORPHAN_CONTACT_RETENTION_DAYS, purgeExpiredOrphanContacts } from "./retention";
import http from "node:http";
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

/**
 * Cloud Run runs the worker as a service, and a service must answer on $PORT or its revision never becomes healthy. This listener answers /health only (no data, no
 * routes): the poll loop below is the real work. Local runs without PORT do not open it.
 */
export function startHealthServer(port: number, isBusyOrStopping: () => boolean = () => false): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "/health")) { res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify({ status: "ok", service: "discovery-worker", busy: isBusyOrStopping() })); return; }
    res.writeHead(404); res.end();
  });
  server.listen(port);
  return server;
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
  // DSC-36: every 60 s queue ONE continuation link for projects idle for 30 min (and < 24 h): see sweepIdleContinuations. Several replicas are safe (decided under the recipient's lock).
  const sweepMs = Number(process.env.FA4_IDLE_SWEEP_MS ?? 60_000);
  let sweeping = false;
  const sweep = async () => {
    if (sweeping || stopping) return;
    sweeping = true;
    try {
      const r = await sweepIdleContinuations(fa4.db, fa4.config.now(), { cooldownMinutes: fa4.config.emailCooldownMinutes, recipientDailyQuota: fa4.config.emailRecipientDailyQuota });
      if (r.queued > 0) jsonLogger("info", "fa4 idle continuation", { found: r.found, queued: r.queued });
    } catch (error) {
      jsonLogger("error", "fa4 idle continuation failed", { error: error instanceof Error ? error.name : "unknown" });
    } finally { sweeping = false; }
  };
  const sweepTimer = setInterval(() => void sweep(), sweepMs);
  // retention: pre-project contact requests are anonymized after 180 days (checked hourly; idempotent, bounded)
  const retentionDays = Number(process.env.FA4_ORPHAN_CONTACT_RETENTION_DAYS ?? ORPHAN_CONTACT_RETENTION_DAYS);
  const purge = async () => {
    try { const n = await purgeExpiredOrphanContacts(fa4.db, new Date(), retentionDays); if (n > 0) jsonLogger("info", "fa4 orphan contacts anonymized", { count: n }); }
    catch (error) { jsonLogger("error", "fa4 retention failed", { error: error instanceof Error ? error.name : "unknown" }); }
  };
  void purge(); const purgeTimer = setInterval(() => void purge(), 3_600_000);
  const timer = setInterval(() => void tick(), pollMs);
  void tick();
  const stop = () => { stopping = true; clearInterval(timer); clearInterval(purgeTimer); clearInterval(sweepTimer); const w = setInterval(() => { if (!busy && !sweeping) { clearInterval(w); process.exit(0); } }, 200); };
  const health = process.env.PORT ? startHealthServer(Number(process.env.PORT), () => busy) : null;
  process.on("SIGTERM", () => { health?.close(); stop(); }); process.on("SIGINT", () => { health?.close(); stop(); });
}
