/**
 * PRECISION V1.0 — PUBLIC READY status. Read-only: reports, per Public Ready front, whether the inputs it needs are configured and
 * what single command proves it. It never prints a value (only "set"/"missing"), never calls an external service and never writes.
 *
 *   cd backend && npx tsx scripts/public-ready-status.ts            # env only
 *   DATABASE_URL=... npx tsx scripts/public-ready-status.ts          # also checks the approved retention policy
 */
import { Pool } from "pg";
import { existsSync } from "node:fs";
import { join } from "node:path";

type State = "READY_TO_PROVE" | "WAITING_ON_INPUT" | "BUILT_NOT_PROVEN";
const env = process.env;
const has = (k: string): boolean => Boolean(env[k] && env[k]!.trim() !== "");
const missing = (keys: string[]): string[] => keys.filter((k) => !has(k));
const rows: { front: string; state: State; detail: string; proof: string }[] = [];

async function main(): Promise<void> {
  // 1 Discovery
  const reader = existsSync(join(__dirname, "../src/precision/adapters/fa4-fa-context.ts"));
  rows.push({
    front: "1 Discovery contract + real continuity",
    state: reader ? "READY_TO_PROVE" : "WAITING_ON_INPUT",
    detail: reader ? "permanent reader adapter present" : "no permanent reader (by decision: none is built before the canonical Discovery contract); PRECISION_FA_CONTEXT_PROVIDER=reader refuses to start",
    proof: "docs/precision-discovery-bridge-acceptance: reconcile contract vs G1–G5, then real project/result -> Premium -> Precision -> pin -> Understanding",
  });
  // 2 Real model / ZDR
  const m = missing(["PRECISION_GATEWAY_PRIMARY_ENDPOINT", "PRECISION_GATEWAY_PRIMARY_MODEL"]);
  rows.push({
    front: "2 Real model rehearsal (ZDR / privacy)",
    state: env.PRECISION_MODEL_PROVIDER === "gateway" && m.length === 0 ? "READY_TO_PROVE" : "WAITING_ON_INPUT",
    detail: `PRECISION_MODEL_PROVIDER=${env.PRECISION_MODEL_PROVIDER ?? "scripted"}; gateway settings missing: ${m.join(", ") || "none"}; ZDR approval is an external attestation (the model interpreter stays off until it is recorded)`,
    proof: "PRECISION_MODEL_PROVIDER=gateway + synthetic data only: route-rehearsal-real-model.int.test.ts (rehearsal A–J)",
  });
  // 3 Stripe
  const sk = env.STRIPE_SECRET_KEY ?? "";
  const sMiss = missing(["STRIPE_SECRET_KEY", "STRIPE_PRICE_ID", "STRIPE_WEBHOOK_SECRET", "STRIPE_SUCCESS_URL", "STRIPE_CANCEL_URL"]);
  rows.push({
    front: "3 Stripe sandbox recurring subscription",
    state: sMiss.length === 0 && /^(sk|rk)_test_/.test(sk) && env.STRIPE_BILLING_MODE === "subscription" ? "READY_TO_PROVE" : "WAITING_ON_INPUT",
    detail: `missing: ${sMiss.join(", ") || "none"}; key kind: ${sk ? (/^(sk|rk)_test_/.test(sk) ? "test" : "NOT a test key (refused)") : "n/a"}; billing mode: ${env.STRIPE_BILLING_MODE ?? "payment (needs subscription)"}`,
    proof: "npm run stripe:sandbox-verify -- --i-understand-this-writes-test-data --cancel-check  (+ test clock for a renewal)",
  });
  // 4 ClickUp / OH
  const cMiss = missing(["CLICKUP_TOKEN", "CLICKUP_WORKSPACE_ID", "CLICKUP_SPACE_ID"]);
  rows.push({
    front: "4 Real ClickUp / Operation Hub acceptance (incl. understanding)",
    state: env.PRECISION_OH_PROVIDER === "clickup" && cMiss.length === 0 ? "READY_TO_PROVE" : "WAITING_ON_INPUT",
    detail: `PRECISION_OH_PROVIDER=${env.PRECISION_OH_PROVIDER ?? "simulator"}; missing: ${cMiss.join(", ") || "none"}; CLICKUP_MODE=${env.CLICKUP_MODE ?? "REAL (use SANDBOX for the acceptance space)"}`,
    proof: "adapter + fake-server contract suite is green; the real run replays the same contract against the sandbox space",
  });
  // 5 Retention
  let policy = "not checked (no DATABASE_URL)";
  let retState: State = "WAITING_ON_INPUT";
  if (has("DATABASE_URL")) {
    const pool = new Pool({ connectionString: env.DATABASE_URL });
    try {
      const r = await pool.query("SELECT version, min_days_after_block, retain_legal_acceptance FROM privacy_policy WHERE status = 'approved'");
      policy = r.rows.length ? `approved policy v${r.rows[0].version} (min_days_after_block=${r.rows[0].min_days_after_block})` : "no approved policy row (erasure refuses by design)";
      retState = r.rows.length ? "READY_TO_PROVE" : "WAITING_ON_INPUT";
    } catch (e) {
      policy = `not readable (${(e as Error).message.slice(0, 60)})`;
    } finally {
      await pool.end();
    }
  }
  rows.push({
    front: "5 Approved retention policy",
    state: retState,
    detail: `${policy}; mechanism built: dry-run first, one transaction, append-only run record, external follow-ups; NOT scheduled`,
    proof: "Legal/privacy sets min_days_after_block + retain_legal_acceptance -> approved row -> erasure dry run on a blocked project",
  });
  // 6 / 7
  rows.push({ front: "6 Human walkthroughs / conversational quality", state: "BUILT_NOT_PROVEN", detail: "scripted walkthroughs green; quality verdict needs the real model (front 2) and a human reader", proof: "rehearsal report + walkthrough notes" });
  rows.push({ front: "7 Production KSeed content", state: "WAITING_ON_INPUT", detail: "ingestion path frozen (KL); needs Doing Business in Mexico + approved material for the 12 V1 gaps", proof: "npx tsx src/scripts/onboard-country-guide.ts / ingest-knowledge.ts, then kseed-report" });

  for (const r of rows) console.log(`[${r.state}] ${r.front}\n    ${r.detail}\n    proof: ${r.proof}\n`);
  const waiting = rows.filter((r) => r.state === "WAITING_ON_INPUT").length;
  console.log(`${waiting} of ${rows.length} fronts are waiting on an external input; the rest are built and need a run or a human read.`);
}
main().catch((e) => { console.error((e as Error).message); process.exit(1); });
