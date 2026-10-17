/* eslint-disable no-console */
import { Client } from "pg";
import { ident } from "../db/domain-isolation";
import { buildPlan, defaultConfig, gatherState, legacyHardeningSteps, renderStep, verifyProvision, type Phase, type Step } from "../db/canonical-provision";

/**
 * Provisions the ONE canonical database (`beeside`) next to the legacy `discovery` database on the same Cloud SQL instance. NOT part of any deployment: it is run by
 * the Product Owner (or on his written instruction) with his own credentials, in two phases around the migrations:
 *   PHASE=pre   groups, migrator, Discovery runtime login, the database, CONNECT      -> then run the migrations as the migrator -> then
 *   PHASE=post  Precision runtime login and the group memberships                     -> then `domain-roles-prepare` (verifies the 17-point contract).
 * MODE=plan (default) only reads and prints what would happen; MODE=verify only reads and checks; MODE=apply executes and needs CANONICAL_DB_PROVISION_APPROVED=yes.
 * Inputs: PROVISION_ADMIN_URL (the Cloud SQL admin user, database `postgres`), optional LEGACY_GROUP_ADMIN_URL (the role that created `beeside_runtime_role`, used for one
 * GRANT only), passwords MIGRATE_DB_PASSWORD / DISCOVERY_RUNTIME_DB_PASSWORD / RUNTIME_DB_PASSWORD (>= 24 chars; never printed, sent to the server as SCRAM verifiers).
 * LEGACY_HARDEN=yes together with CANONICAL_DB_PROVISION_APPROVED=yes ALSO revokes PUBLIC CONNECT on the legacy database (reversible; off by default).
 */
const log = (o: Record<string, unknown>): void => console.log(JSON.stringify(o));

async function main(): Promise<void> {
  const mode = (process.env.MODE ?? "plan").toLowerCase();
  const phase = (process.env.PHASE ?? "pre").toLowerCase() as Phase;
  if (!["plan", "apply", "verify"].includes(mode)) throw new Error("MODE must be plan, apply or verify");
  if (phase !== "pre" && phase !== "post") throw new Error("PHASE must be pre or post");
  const adminUrl = process.env.PROVISION_ADMIN_URL;
  if (!adminUrl) throw new Error("PROVISION_ADMIN_URL is required");
  const cfg = defaultConfig();
  const admin = new Client({ connectionString: adminUrl });
  let legacy: Client | undefined;
  await admin.connect();
  try {
    const st = await gatherState(admin, cfg);
    const plan = buildPlan(cfg, st, phase);
    let steps: Step[] = plan.steps;
    const harden = process.env.LEGACY_HARDEN === "yes";
    if (harden) steps = [...steps, ...legacyHardeningSteps(cfg, cfg.legacyLogins.concat([st.admin.name]))];
    log({ severity: "INFO", message: "provision plan", mode, phase, database: cfg.database, admin: st.admin.name, blockers: plan.blockers, notes: plan.notes, steps: steps.map((s) => ({ id: s.id, via: s.via, description: s.description, sql: s.sql })) });
    if (plan.blockers.length) throw new Error(`blocked: ${plan.blockers.join("; ")}`);

    if (mode === "apply") {
      if (process.env.CANONICAL_DB_PROVISION_APPROVED !== "yes") throw new Error("apply refused: CANONICAL_DB_PROVISION_APPROVED=yes is required (written approval of the Product Owner)");
      const passwords = { migrate: process.env.MIGRATE_DB_PASSWORD ?? "", discovery_runtime: process.env.DISCOVERY_RUNTIME_DB_PASSWORD ?? "", runtime: process.env.RUNTIME_DB_PASSWORD ?? "" };
      // render everything first: a missing/short password aborts before ANY change
      const rendered = steps.map((s) => ({ s, sql: renderStep(s, passwords) }));
      if (rendered.some((r) => r.s.via === "legacy")) {
        const lu = process.env.LEGACY_GROUP_ADMIN_URL;
        if (!lu) throw new Error("LEGACY_GROUP_ADMIN_URL is required: the admin connection holds no ADMIN OPTION on the legacy Precision group");
        legacy = new Client({ connectionString: lu });
        await legacy.connect();
      }
      for (const r of rendered) {
        const c = r.s.via === "legacy" ? legacy! : admin;
        try {
          if (r.s.asRole) await c.query(`SET ROLE ${ident(r.s.asRole)}`);
          try { await c.query(r.sql); } finally { if (r.s.asRole) await c.query("RESET ROLE"); }
        } catch (e) { throw new Error(`step ${r.s.id} failed: ${(e as { code?: string }).code ?? "?"} ${(e as Error).message.split("\n")[0]}`); }
        log({ severity: "INFO", message: "step done", step: r.s.id });
      }
    }
    if (mode !== "plan") {
      const checks = await verifyProvision(admin, cfg, phase);
      for (const c of checks) log({ severity: c.ok ? "INFO" : c.severity, message: `${c.ok ? "ok" : "FAILED"}: ${c.check}`, ...(c.detail ? { offenders: c.detail.slice(0, 20) } : {}) });
      if (checks.some((c) => !c.ok && c.severity === "ERROR")) throw new Error("the provisioned state does not match the contract");
      log({ severity: "INFO", message: "provision verified", phase, checks: checks.length, warnings: checks.filter((c) => !c.ok).length });
    }
  } finally {
    await admin.end();
    if (legacy) await legacy.end();
  }
}

main().catch((e: unknown) => { console.error(JSON.stringify({ severity: "ERROR", message: "canonical database provisioning failed", error: e instanceof Error ? e.message : String(e) })); process.exit(1); });
