/* eslint-disable no-console */
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import { ErasureGateError, manifestOf, parseManifest, readLog, reconcileErasures } from "../db/privacy-erasure-sync";

/**
 * Keeps personal-data erasures effective across the legacy `discovery` / canonical `beeside` transition (finding F2). Run by the Product Owner (or on his written instruction), with the
 * OWNER/migrator credential of each side (the only role that may execute fa4_anonymize_project), BEFORE every domain-data-sync, before a cutover and before a rollback.
 *   two sides   ERASURE_SIDE_A_URL + ERASURE_SIDE_B_URL      every erasure recorded on either side is applied on the other (and any residue is re-scrubbed)
 *   one side    ERASURE_SIDE_A_URL + ERASURE_MANIFEST_FILE   a manifest exported earlier from the other side is applied on this one (the other side is unreachable, e.g. an emergency rollback)
 * DRY_RUN=yes only measures (exit 2 if not converged). A real run needs ERASURE_RECONCILE_APPROVED=yes. ERASURE_EXPORT_MANIFEST=<file> writes the union manifest (project and erasure
 * identifiers, actor, time; no personal data; mode 0600) and prints its SHA-256. Evidence: every applied erasure is a new row of the side's append-only erasure log naming its origin.
 * Prints counts and hashes only. Exit 0 converged, 2 not converged (measure only), 3 stopped by the privacy gate, 1 error.
 */
async function main(): Promise<void> {
  const [au, bu, mf] = [process.env.ERASURE_SIDE_A_URL, process.env.ERASURE_SIDE_B_URL, process.env.ERASURE_MANIFEST_FILE];
  if (!au) throw new Error("ERASURE_SIDE_A_URL is required");
  if (!bu && !mf) throw new Error("give ERASURE_SIDE_B_URL (both sides) or ERASURE_MANIFEST_FILE (one side)");
  if (bu && mf) throw new Error("ERASURE_SIDE_B_URL and ERASURE_MANIFEST_FILE are mutually exclusive");
  if (bu === au) throw new Error("the two sides must differ");
  const dry = process.env.DRY_RUN === "yes";
  if (!dry && process.env.ERASURE_RECONCILE_APPROVED !== "yes") throw new Error("refused: ERASURE_RECONCILE_APPROVED=yes is required for a real run (DRY_RUN=yes only measures)");
  const offline = mf ? parseManifest(readFileSync(mf, "utf8")) : undefined;
  const [a, b] = [new Client({ connectionString: au }), bu ? new Client({ connectionString: bu }) : null];
  await Promise.all([a.connect(), b ? b.connect() : Promise.resolve()]);
  try {
    const rep = await reconcileErasures(a, b, { apply: !dry, ...(offline ? { offline } : {}) });
    const out = process.env.ERASURE_EXPORT_MANIFEST;
    if (out) {
      const m = manifestOf([...(await readLog(a)), ...(b ? await readLog(b) : []), ...(offline?.entries ?? [])]);
      writeFileSync(out, JSON.stringify(m), { mode: 0o600 });
      chmodSync(out, 0o600);
    }
    console.log(JSON.stringify({ severity: rep.converged ? "INFO" : "ERROR", message: dry ? "erasure consistency check (dry run)" : "erasure reconciliation", ...rep, ...(out ? { manifestFile: out } : {}) }));
    if (!rep.converged) process.exit(2);
  } finally {
    await Promise.all([a.end(), b ? b.end() : Promise.resolve()]);
  }
}

main().catch((e: unknown) => {
  const gate = e instanceof ErasureGateError;
  console.error(JSON.stringify({ severity: "ERROR", message: gate ? "erasure reconciliation stopped by the privacy gate" : "erasure reconciliation failed", error: e instanceof Error ? e.message : String(e), ...(gate ? { erasure: (e as ErasureGateError).detail["report"] ?? null } : {}) }));
  process.exit(gate ? 3 : 1);
});
