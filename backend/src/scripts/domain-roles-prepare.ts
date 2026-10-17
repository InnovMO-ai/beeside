/* eslint-disable no-console */
import { Pool } from "pg";
import { bindDomainRoles } from "../db/domain-isolation";

/**
 * Deployment step for the ONE canonical database shared by Discovery and Precision Center. Runs as a Cloud Run job with the MIGRATION (owner) credential,
 * after the migrations and after the Precision runtime login exists (`runtime-role-prepare`). Idempotent. Touches only the two logins it is given.
 *   1. refreshes the Discovery group's privileges from `db_domain_registry` (refuses while any table has no data domain);
 *   2. moves the Discovery login out of `beeside_runtime_role` and into `beeside_discovery_rw`; keeps the Precision login in `beeside_runtime_role` only;
 *   3. closes Precision's write access to Discovery's tables (refused by the database unless step 2 holds);
 *   4. VERIFIES the isolation contract and fails the job if anything differs. Prints check names and counts only.
 * Inputs: MIGRATION_DATABASE_URL (owner credential); DISCOVERY_RUNTIME_LOGIN (default discovery_runtime); PRECISION_RUNTIME_LOGIN (default beeside_runtime).
 */
async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
  const discoveryLogin = process.env.DISCOVERY_RUNTIME_LOGIN ?? "discovery_runtime";
  const precisionLogin = process.env.PRECISION_RUNTIME_LOGIN ?? "beeside_runtime";
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const checks = await bindDomainRoles(pool, { discoveryLogin, precisionLogin });
    for (const c of checks) console.log(JSON.stringify({ severity: c.ok ? "INFO" : "ERROR", message: `${c.ok ? "ok" : "FAILED"}: ${c.check}`, ...(c.detail ? { offenders: c.detail.slice(0, 20) } : {}) }));
    if (checks.some((c) => !c.ok)) throw new Error("the data-domain isolation contract does not hold");
    console.log(JSON.stringify({ severity: "INFO", message: "data-domain roles ready", discoveryLogin, precisionLogin, checks: checks.length }));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((e: unknown) => { console.error(JSON.stringify({ severity: "ERROR", message: "data-domain role preparation failed", error: e instanceof Error ? e.message : String(e) })); process.exit(1); });
}
