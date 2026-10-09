#!/usr/bin/env node
// Verifies (or with --sync, rewrites) the mirrored copies of docs/f5/precision-dto.ts.
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const canon = fs.readFileSync(path.join(root, "docs/f5/precision-dto.ts"), "utf8");
const mirrors = ["backend/src/precision/api/dto.ts", "frontend/src/precision/api/dto.ts"];
const sync = process.argv.includes("--sync");
let bad = 0;
for (const m of mirrors) {
  const p = path.join(root, m);
  const cur = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  if (cur === canon) continue;
  if (sync) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, canon); console.log("synced", m); }
  else { console.error("DRIFT:", m); bad++; }
}
process.exit(bad ? 1 : 0);
