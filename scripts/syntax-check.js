#!/usr/bin/env node
/**
 * Phase 1 verification helper — NOT part of the product build.
 *
 * This sandbox's network egress policy blocks registry.npmjs.org
 * (host_not_allowed), so `npm install` cannot run here and the full
 * `tsc --noEmit` type-check (which needs @types/express, @types/react, etc.
 * on disk) cannot be executed in this environment. This script instead uses
 * the TypeScript compiler API in *syntax-only* mode (no module resolution, no
 * type-checking) against the globally available `typescript` package, to at
 * least confirm every source file is well-formed TypeScript/TSX before
 * hand-off. Full type-checking and the real test suites must run in CI
 * (.github/workflows/ci.yml), which does have npm registry access.
 */
const ts = require("typescript");
const fs = require("fs");
const path = require("path");

const files = process.argv.slice(2);
let hadError = false;

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    kind
  );
  const diagnostics = sourceFile.parseDiagnostics || [];
  if (diagnostics.length > 0) {
    hadError = true;
    console.log(`FAIL ${file}`);
    for (const d of diagnostics) {
      const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      console.log(`  ${msg}`);
    }
  } else {
    console.log(`OK   ${path.relative(process.cwd(), file)}`);
  }
}

process.exit(hadError ? 1 : 0);
