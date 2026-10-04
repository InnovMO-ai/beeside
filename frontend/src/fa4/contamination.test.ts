import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const fa4 = walk(path.join(root, "src/fa4")).filter((f) => /\.(ts|tsx|css)$/.test(f) && !/\.test\.|test-helpers/.test(f));

describe("FA Public v1.0 isolation and contamination guards (frontend)", () => {
  it("does not import any legacy First Assessment module (src/fa, src/App, src/admin, styles.css)", () => {
    for (const f of fa4) expect(fs.readFileSync(f, "utf8"), path.relative(root, f)).not.toMatch(/from ["'](\.\.\/)+(fa|App|admin|styles)(\/|["'])/);
  });
  it("no legacy product vocabulary (Snapshot, radar, readiness, scoring, Level2, waves)", () => {
    const banned = /\b(snapshot|radar|readiness|activation wave|level ?2|expansion profile|score)\b/i;
    for (const f of fa4) { const m = fs.readFileSync(f, "utf8").match(banned); expect(m?.[0], path.relative(root, f)).toBeUndefined(); }
  });
  it("no runtime AI/LLM dependency or call", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(" ")).not.toMatch(/openai|anthropic|langchain|llm|gemini|mistral|cohere|ollama|ai-sdk/i);
    for (const f of fa4) expect(fs.readFileSync(f, "utf8"), path.relative(root, f)).not.toMatch(/api\.openai|api\.anthropic|generativelanguage/);
  });
  it("no internal partner names or the seed catalog in the browser code", () => {
    for (const f of fa4) {
      const t = fs.readFileSync(f, "utf8");
      expect(t, path.relative(root, f)).not.toMatch(/Grant Thornton|Baker Tilly|Traxi|Santander|MAPFRE|Garza Ponce|AMPIP/);
      expect(t, path.relative(root, f)).not.toMatch(/fa-public-engine\/seed/);
    }
  });
});
