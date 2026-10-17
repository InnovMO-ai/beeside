import { readFileSync } from "node:fs";
import { connectionBudget, type BudgetInput } from "../db/pool-config";

/**
 * Go/no-go check G5: does the worst-case number of database connections of every deployed service fit the instance?
 *   node dist/scripts/connection-budget.js [plan.json] [--max-connections N]
 * Plan file: infra/db/connection-plan.json. Prints a table and exits 1 when the worst case exceeds the ceiling. Reads a local file only.
 */
function main(): number {
  const args = process.argv.slice(2);
  const mcIdx = args.indexOf("--max-connections");
  const override = mcIdx >= 0 ? Number(args[mcIdx + 1]) : undefined;
  const file = args.find((a, i) => !a.startsWith("--") && i !== mcIdx + 1) ?? "infra/db/connection-plan.json";
  const plan = JSON.parse(readFileSync(file, "utf8")) as BudgetInput;
  const input: BudgetInput = { ...plan, ...(override !== undefined && Number.isFinite(override) ? { maxConnections: override } : {}) };
  const r = connectionBudget(input);
  console.log(`max_connections=${input.maxConnections} reserved=${input.reserved} usable=${r.usable} other(jobs+humans)=${input.other}`);
  for (const s of r.perService) console.log(`  ${s.name.padEnd(28)} ${String(s.maxInstances).padStart(2)} instances x pool ${String(s.poolMax).padStart(2)} = ${String(s.connections).padStart(3)}`);
  console.log(`worst case ${r.worstCase} of ${r.usable} usable (${(r.ratio * 100).toFixed(0)}%), ceiling ${(r.ceiling * 100).toFixed(0)}% -> ${r.ok ? "OK" : "OVER BUDGET"}`);
  return r.ok ? 0 : 1;
}
process.exitCode = main();
