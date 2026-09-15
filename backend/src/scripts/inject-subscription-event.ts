import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createPoolDb } from "../db/database";
import { BundleStore } from "../fa/services/bundle-store";
import { isSubscriptionEventType, processSubscriptionEvent } from "../premium/subscription-events";

/**
 * Development-only manual event injector (Build Plan v1.1 Phase 9: "a manual/admin-triggered event
 * injector is sufficient for this build, since no payment provider is selected").
 *
 * npm run billing:inject-event --workspace=backend -- --development-only --project <uuid>
 *   --type premium_activated|cancellation_requested|subscription_period_ended|premium_reactivated
 *   [--period-start <ISO>] [--period-end <ISO>]   (period required for activation / reactivation)
 */
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  if (process.env.CONFIG_BOOTSTRAP_ENV !== "development" || !process.argv.includes("--development-only")) {
    throw new Error("refusing to run: set CONFIG_BOOTSTRAP_ENV=development and pass --development-only");
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const projectId = arg("project");
  const eventType = arg("type");
  if (!projectId || !isSubscriptionEventType(eventType)) throw new Error("--project and a valid --type are required");

  const pool = new Pool({ connectionString: url });
  try {
    const db = createPoolDb(pool);
    const bundles = new BundleStore(db);
    const now = new Date();
    const result = await db.transaction((tx) =>
      processSubscriptionEvent(tx, bundles, {
        projectId,
        eventType,
        occurredAt: now,
        source: "manual_admin_injection",
        idempotencyKey: `manual-${randomUUID()}`,
        periodStart: arg("period-start") ? new Date(arg("period-start") as string) : null,
        periodEnd: arg("period-end") ? new Date(arg("period-end") as string) : null,
      }),
    );
    console.log(`subscription event: ${JSON.stringify(result)}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
