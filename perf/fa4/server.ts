/**
 * Load-test harness server (NOT production code): the real FA4 router + real PostgreSQL, started with the least-privilege runtime role,
 * plus a /__perf/* side channel (stats, captured mail). Email is captured in memory and never sent. Rate limits are off here (all
 * virtual users share one client address); they are covered by the abuse tests in backend/src/__integration__/fa4-verify.int.test.ts.
 *   PERF_DATABASE_URL=postgres://beeside_runtime:…@host/db PERF_ADMIN_DATABASE_URL=postgres://owner@host/db npx tsx perf/fa4/server.ts
 */
import express from "express";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { Pool } from "pg";
import { createApp } from "../../backend/src/index";
import { createPoolDb } from "../../backend/src/db/database";
import type { EmailMessage, EmailTransport } from "../../backend/src/fa/email/email-adapter";
import { seedCatalogIfEmpty } from "../../backend/src/fa4/repository";
import { SEED_CATALOG } from "@beeside/fa-public-engine/seed";

const url = process.env.PERF_DATABASE_URL!;
const adminUrl = process.env.PERF_ADMIN_DATABASE_URL!;
const poolMax = Number(process.env.PERF_POOL_MAX ?? 10);   // pg default; this is what the shipped backend uses (`new Pool({ connectionString })`)
const port = Number(process.env.PERF_PORT ?? 8099);

const pool = new Pool({ connectionString: url, max: poolMax });
const admin = new Pool({ connectionString: adminUrl, max: 3 });
const db = createPoolDb(pool);

const mail = new Map<string, { to: string; ctaUrl: string }>();
const mailStats = { sent: 0, wrongRecipient: 0 };
const transport: EmailTransport = {
  name: "perf-capture",
  async send(m: EmailMessage) {
    // the recipient must be exactly the address stored for THAT project
    const r = await admin.query("SELECT email FROM fa4_project WHERE project_id = $1", [m.projectId]);
    mailStats.sent++;
    if (r.rows[0]?.email !== m.to.toLowerCase()) mailStats.wrongRecipient++;
    mail.set(m.to.toLowerCase(), { to: m.to, ctaUrl: m.ctaUrl ?? "" });
    return { providerReference: null };
  },
};

const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
let lastCpu = process.cpuUsage(); let lastT = Date.now();

async function main() {
  await seedCatalogIfEmpty(createPoolDb(admin), SEED_CATALOG);
  const app = createApp({
    fa4: {
      db, email: transport, emailDispatch: "inline",
      config: {
        appBaseUrl: "http://perf.invalid", sessionTtlHours: 24, resumeLinkDays: 30, emailCooldownMinutes: 0, emailRecipientDailyQuota: 100000, resumeProjectsPerRequest: 3,
        legal: { termsVersion: "perf", termsUrl: { es: "https://perf.invalid/t", en: "https://perf.invalid/t" }, privacyVersion: "perf", privacyUrl: { es: "https://perf.invalid/p", en: "https://perf.invalid/p" } },
        now: () => new Date(),
      },
    },
  });
  const outer = express();
  outer.get("/__perf/stats", (_req, res) => {
    const m = process.memoryUsage(); const cpu = process.cpuUsage(); const now = Date.now();
    const cpuPct = ((cpu.user - lastCpu.user + cpu.system - lastCpu.system) / 1000) / (now - lastT) * 100;
    lastCpu = cpu; lastT = now;
    res.json({ rssMb: m.rss / 1048576, heapMb: m.heapUsed / 1048576, cpuPct, loopLagP99Ms: lag.percentile(99) / 1e6, loopLagMaxMs: lag.max / 1e6,
      pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: poolMax }, mail: { ...mailStats, pending: mail.size } });
    lag.reset();
  });
  outer.get("/__perf/mail", (req, res) => { const k = String(req.query.to ?? "").toLowerCase(); const v = mail.get(k); mail.delete(k); res.json(v ?? null); });
  outer.use(app);
  outer.listen(port, () => console.log(`perf server on :${port} pool.max=${poolMax}`));
}
main().catch((e) => { console.error(e); process.exit(1); });
