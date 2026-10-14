import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Architecture guard for the Discovery → Precision bridge (Discovery is the Product name of what the code still calls FA / `fa4_*`).
 *
 * Precision gets Discovery context ONLY through `FaContextReader` (ports/fa-context.ts). So, outside the reader implementations
 * (`adapters/`) and test files, nothing under src/precision may:
 *  - read Discovery's own tables (they are mutable; the reader serves an immutable, pinned result instead);
 *  - import the legacy FA3 context module (`precision-context`);
 *  - parse or even name the rendered Expansion View (YEV): Precision never receives it and must not depend on its text.
 */
const ROOT = __dirname;
const RAW_TABLES = /\b(fa4_(project|result|access_token|catalog_\w+|continuation_request|demand_signal|email_delivery|legal_acceptance|privacy_erasure_log)|fa_(access_extension|journey_event|project_lifecycle))\b/;
const LEGACY_CONTEXT = /precision-context\//;
const YEV = /\bYEV\b|expansion[_ ]view/i;
// Files whose job is to NAME these things in order to forbid them (lints, payload whitelist comment).
const NAMES_YEV_TO_FORBID = ["ports/fa-context.ts", "ports/operation-hub.ts", "ports/payload-hygiene.ts", "manifest/copy-lint.ts", "conversation/verifiers/tone.ts", "domain/crp/__integration__/scan.ts"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : files(full);
    return /\.ts$/.test(name) ? [full] : [];
  });
}

const production = files(ROOT)
  .map((f) => relative(ROOT, f))
  .filter((rel) => !/\.test\.ts$/.test(rel) && !rel.startsWith("adapters/") && !rel.includes("__integration__/") && !rel.includes("__tests__/"))
  .map((rel) => ({ rel, text: readFileSync(join(ROOT, rel), "utf8") }));

describe("Discovery → Precision boundary", () => {
  it("does not read Discovery's mutable tables outside a reader implementation", () => {
    expect(production.filter((f) => RAW_TABLES.test(f.text)).map((f) => f.rel)).toEqual([]);
  });

  it("does not use the legacy FA3 context module", () => {
    expect(production.filter((f) => LEGACY_CONTEXT.test(f.text)).map((f) => f.rel)).toEqual([]);
  });

  it("has no dependency on the rendered Expansion View (YEV)", () => {
    expect(production.filter((f) => !NAMES_YEV_TO_FORBID.includes(f.rel) && YEV.test(f.text)).map((f) => f.rel)).toEqual([]);
  });

  it("the only context entry point is the FaContextReader port", () => {
    const readers = production.filter((f) => /implements\s+FaContextReader/.test(f.text)).map((f) => f.rel);
    expect(readers).toEqual([]); // implementations live under adapters/
  });
});
