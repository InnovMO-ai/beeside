/**
 * ARCHITECTURE GUARD — the Knowledge Layer boundary (frozen).
 *
 *  1. Precision reaches knowledge ONLY through the contract: its modules import `knowledge-layer/contract` (types) and nothing else of the
 *     layer, except the composition root (precision/api/wiring.ts) which assembles the production layer.
 *  2. The layer never imports Precision (it is a standalone package: another product could consume it tomorrow).
 *  3. Only the layer's own admin surface (Admin routes, ingestion scripts) uses the layer's internals.
 *  4. There is no live web anywhere in Precision or the layer: the Knowledge Agent (the sanctioned fetch PORT, approved-sources-only) is not
 *     reachable from a client conversation.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC = join(__dirname, "..");
const norm = (p: string): string => p.split(sep).join("/");
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "__tests__" || n === "__integration__" || n === "node_modules" ? [] : sourceFiles(p);
    return /\.ts$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}
const rel = (f: string): string => norm(relative(SRC, f));
const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const importsOf = (file: string): string[] => {
  const src = strip(readFileSync(file, "utf8"));
  const out: string[] = [];
  for (const m of src.matchAll(/(?:from|import|require\()\s*["']([^"']+)["']/g)) out.push(m[1]!);
  return out;
};
/** Resolves a relative import to a path under src ("knowledge-layer/service"); null for packages. */
const resolved = (file: string, spec: string): string | null => (spec.startsWith(".") ? norm(relative(SRC, join(file, "..", spec))) : null);

const precisionFiles = sourceFiles(join(SRC, "precision"));
const layerFiles = sourceFiles(join(SRC, "knowledge-layer"));
const allFiles = sourceFiles(SRC);

describe("Knowledge Layer boundary", () => {
  it("Precision imports the layer only through its contract (the composition root assembles the production layer)", () => {
    const offenders: string[] = [];
    for (const f of precisionFiles) {
      for (const spec of importsOf(f)) {
        const r = resolved(f, spec);
        if (!r || !r.startsWith("knowledge-layer")) continue;
        // the vocabulary pack is the one pure, in-process piece of the layer a consumer may run: it classifies the consumer's OWN text locally
        const ok = r === "knowledge-layer/contract" || (rel(f) === "precision/knowledge-client/adapters.ts" && r === "knowledge-layer/vocabulary") || (rel(f) === "precision/api/wiring.ts" && r === "knowledge-layer");
        if (!ok) offenders.push(`${rel(f)} -> ${r}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("Precision no longer owns a knowledge store: no 'knowledge' package inside precision/, and the conversation never imports the client's internals", () => {
    expect(readdirSync(join(SRC, "precision"))).not.toContain("knowledge");
    const offenders: string[] = [];
    for (const f of precisionFiles.filter((x) => !rel(x).startsWith("precision/knowledge-client/"))) {
      for (const spec of importsOf(f)) {
        const r = resolved(f, spec);
        if (r && r.startsWith("precision/knowledge-client") && !/^precision\/knowledge-client(\/(ports|drivers|index))?$/.test(r)) offenders.push(`${rel(f)} -> ${r}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the layer is standalone: it never imports Precision (or any other product module)", () => {
    const offenders: string[] = [];
    for (const f of layerFiles) {
      for (const spec of importsOf(f)) {
        const r = resolved(f, spec);
        if (!r) continue;
        if (r.startsWith("knowledge-layer") || r === "db/database") continue; // its own files and the database handle
        offenders.push(`${rel(f)} -> ${r}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("only the layer's own admin surface (Admin routes and ingestion scripts) uses its internals", () => {
    const allowedOutside = /^(admin\/knowledge-layer-admin\.ts|scripts\/(ingest-knowledge|onboard-country-guide|kseed-report|kl-seed)\.ts|precision\/api\/wiring\.ts|precision\/knowledge-client\/adapters\.ts)$/;
    const offenders: string[] = [];
    for (const f of allFiles.filter((x) => !rel(x).startsWith("knowledge-layer/"))) {
      for (const spec of importsOf(f)) {
        const r = resolved(f, spec);
        if (r && r.startsWith("knowledge-layer") && r !== "knowledge-layer/contract" && !allowedOutside.test(rel(f))) offenders.push(`${rel(f)} -> ${r}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the vocabulary pack is pure: it imports only the layer's vocabulary modules (no store, no database, no network) and keeps no state", () => {
    const file = join(SRC, "knowledge-layer", "vocabulary.ts");
    for (const spec of importsOf(file)) expect(spec).toMatch(/^\.\/(boundary|demand|geo|topics|types)$/);
    const src = strip(readFileSync(file, "utf8"));
    expect(src).not.toMatch(/\b(Pool|query|fetch|readFile|writeFile|process\.env)\b/);
    expect(src).not.toMatch(/^(?:export )?let /m);
  });

  it("the contract is types only: a consumer cannot get behaviour or a store from it", () => {
    const src = strip(readFileSync(join(SRC, "knowledge-layer", "contract.ts"), "utf8"));
    expect(src).not.toMatch(/^export (?:const|function|class|async)/m);
    for (const spec of importsOf(join(SRC, "knowledge-layer", "contract.ts"))) expect(spec).toMatch(/^\.\/(types|boundary|demand)$/);
    expect(src).toMatch(/import type/);
    expect(src).not.toMatch(/^import (?!type)/m);
  });
});

describe("no live web inside Precision or the Knowledge Layer (frozen KSeed boundary)", () => {
  const files = [...precisionFiles, ...layerFiles];
  // the agent is the sanctioned fetch PORT (approved-sources-only, never wired to conversations); the fake server only LISTENS (test double)
  const ALLOW = new Set(["knowledge-layer/agent.ts", "precision/adapters/clickup-fake-server.ts"]);
  const BAD = [/from\s+["'](?:node:)?https?["']/, /require\(["'](?:node:)?https?["']\)/, /from\s+["'](?:axios|undici|node-fetch|got|superagent|cross-fetch|puppeteer|playwright|cheerio|jsdom)["']/, /\bglobalThis\.fetch\b/, /(?<![\w.])fetch\s*\(/, /\bWebSearch\b|\bweb_search\b|\bgoogle\.com\/search\b|\bserpapi\b|\btavily\b|\bbing\.com\/search\b/i];

  it("no module imports a network client or calls fetch/WebSearch", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (ALLOW.has(rel(f))) continue;
      const src = strip(readFileSync(f, "utf8"));
      for (const re of BAD) if (re.test(src)) offenders.push(`${rel(f)} ~ ${re}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the Knowledge Agent is reachable from neither a client conversation nor the contract implementation", () => {
    const importers = files.filter((f) => importsOf(f).some((s) => resolved(f, s) === "knowledge-layer/agent")).map(rel);
    expect(importers.filter((p) => p !== "knowledge-layer/pg-repo.ts")).toEqual([]); // pg-repo only implements the candidate STORE (types)
    for (const p of ["precision/api/wiring.ts", "precision/understanding/engine.ts", "precision/knowledge-client/adapters.ts", "knowledge-layer/service.ts", "knowledge-layer/orient.ts", "knowledge-layer/retrieve.ts", "knowledge-layer/index.ts"]) {
      expect(readFileSync(join(SRC, p), "utf8")).not.toMatch(/SourceFetcher|runAgentCycle|knowledge-layer\/agent|from\s+["']\.\/agent["']/);
    }
  });

  it("the request path reads the layer's internal repository only", () => {
    const svc = strip(readFileSync(join(SRC, "knowledge-layer", "service.ts"), "utf8"));
    expect(svc).toMatch(/KnowledgeRepository/);
    expect(svc).not.toMatch(/\bfetch\b|node:https?|https?:\/\//);
  });
});
