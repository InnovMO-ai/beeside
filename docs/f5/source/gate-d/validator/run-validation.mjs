import fs from "node:fs";
import path from "node:path";
import { validateManifest, validateProjectManifest } from "./manifest-validator.mjs";
const dir = process.argv[2];
const proj = JSON.parse(fs.readFileSync(process.argv[3], "utf8")); // services_projection.json
const catalog = {};
for (const [, cat, key] of proj) (catalog[cat] ||= []).push(key);
const additions = ["intellectual_property", "wind_down_closure", "retail_premises", "corporate_transactional_advisory"];
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "project_manifest_v2.json").sort();
const registry = new Map();
const manifests = new Map();
const findings = [];
for (const f of files) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  manifests.set(m.category_key, m);
  findings.push(...validateManifest(m, { registry, catalog, additions }));
}
const pm = JSON.parse(fs.readFileSync(path.join(dir, "project_manifest_v2.json"), "utf8"));
const fronts = ["FR_SITE", "FR_LEGAL_TAX", "FR_PERMITS", "FR_RECRUITMENT", "FR_EMPLOYMENT", "FR_MOBILE_STAFF", "FR_TRADE", "FR_LOGISTICS", "FR_SUPPLIERS", "FR_BANKING", "FR_INSURANCE", "FR_STAFF_HOUSING", "FR_PARENT_LINK", "FR_EXIT", "FR_GTM", "FR_PUBLIC_PROCUREMENT", "FR_LOCAL_PARTNERS", "FR_REGULATORY", "FR_BRAND", "FR_INVEST_RC"];
const allFieldKeys = new Set([...manifests.values()].flatMap((m) => m.fields.map((f) => f.field_key)));
findings.push(...validateProjectManifest(pm, { catalogCategories: Object.keys(catalog), manifests, fronts, allFieldKeys }));
const errs = findings.filter((x) => x.severity === "error"), warns = findings.filter((x) => x.severity === "warn");
console.log(JSON.stringify({ manifests: [...manifests.keys()], errors: errs.length, warnings: warns.length }, null, 1));
for (const x of findings) console.log(`${x.severity.toUpperCase().padEnd(5)} [${x.check}] ${x.manifest} :: ${x.where} :: ${x.message}`);
process.exit(errs.length ? 1 : 0);
