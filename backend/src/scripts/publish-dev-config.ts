/* eslint-disable no-console */
import { Client } from "pg";
import { syncFieldRegistry } from "../fa/admin/field-registry";
import { ensureDevBootstrapAdmin, publishDevConfiguration } from "../fa/admin/publish-config";

// DEVELOPMENT ONLY. Usage:
//   CONFIG_BOOTSTRAP_ENV=development DATABASE_URL=... npm run config:publish-dev -- --development-only
// Syncs canonical fields, ensures the technical dev ADMIN, and publishes the First Assessment
// question bank v1 (+ placeholder rules/snapshot versions when none is current). This does not
// define production ADMIN users and never exposes the Admin API.
//
// Add --level2 to publish the Level 2 question bank (fa-qb-2.0.0) as current instead of v1
// (fa-qb-1.1.0) — kept for local comparison against the canonical bundle below; fa-qb-2.0.0 was
// never the product's canonical bundle (see question-bank-v2-1.ts's own header).
//
// Add --canonical to publish the new canonical question bank (fa-qb-2.1.0, question-bank-v2-1.ts)
// as current instead — the Product Owner's 2026-09-30 Decision A/B bundle, regrouped onto the frozen
// 8-stage journey. This is the version that should eventually become current for all NEW
// assessments; publishing it here does NOT touch fa-qb-1.1.0 (still published, still fully
// resumable for anything already pinned to it). It DOES also publish a compatible Rules Engine
// version (re-1.1.0) as current, resolving the Rules-Engine compatibility gap that used to block
// the Virtual Snapshot step for "--canonical"/"--level2" projects — see rules-engine-v1-1.ts and
// publishDevConfiguration's own docblock for the full reasoning.
//
// Precedence when both flags are passed: --canonical wins. Either flag affects only this
// interactive script; the integration test suite's own bootstrap (fa-harness.ts) always calls
// publishDevConfiguration with its default ("v1") and is unaffected either way.
async function main() {
  if (process.env.CONFIG_BOOTSTRAP_ENV !== "development" || !process.argv.includes("--development-only")) {
    throw new Error("refusing to run: set CONFIG_BOOTSTRAP_ENV=development and pass --development-only");
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const questionBank = process.argv.includes("--canonical") ? "v2.1" : process.argv.includes("--level2") ? "v2" : "v1";
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    console.log("field registry sync:", JSON.stringify(await syncFieldRegistry(client)));
    const adminId = await ensureDevBootstrapAdmin(client);
    console.log("configuration:", JSON.stringify(await publishDevConfiguration(client, adminId, questionBank)));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
