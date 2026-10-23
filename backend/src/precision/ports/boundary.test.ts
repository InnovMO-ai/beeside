import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Architecture guard: Precision's domain, conversation, delivery and API code know Operation Hub only through OperationHubPort.
 * ClickUp (or any concrete platform) appears only inside its adapter, its test helpers and the composition root.
 */
const ROOT = join(__dirname, "..");
const ALLOWED = [
  "adapters/clickup-", // the adapter itself + its fake server + its tests
  "delivery/oh-delivery-service.ts", // reads the pre-neutral reference spelling (taskId) of already-stored references
  "api/wiring.ts", // composition root: the one place that picks an adapter from the environment
  "ports/registry.ts", // the provider switch (names the choice, not the platform's model)
  "ports/integration-descriptor.ts", // descriptor vocabulary
  "ports/boundary.test.ts",
  "ports/payload-hygiene.ts", // the lint that forbids platform names in content
  "manifest/copy-lint.ts", // forbidden-words lint
  "conversation/verifiers/tone.ts", // forbidden-words lint
  "domain/crp/__integration__/scan.ts", // forbidden-words lint
];
const TERMS = /click\s?up|folder_id|list_id|space_id|workspace_id|taskId\b|task_id\b/i;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : files(full);
    return /\.ts$/.test(name) ? [full] : [];
  });
}

describe("no platform concepts outside the adapter", () => {
  const offenders = files(ROOT)
    .map((f) => relative(ROOT, f))
    .filter((rel) => !ALLOWED.some((a) => rel.startsWith(a)))
    .filter((rel) => !/\.test\.ts$/.test(rel)) // tests that assert the vocabulary is ABSENT from customer copy
    .filter((rel) => TERMS.test(readFileSync(join(ROOT, rel), "utf8")));

  it("keeps ClickUp vocabulary inside adapters/clickup-*, the composition root and the lints", () => {
    expect(offenders).toEqual([]);
  });

  it("does not import a concrete adapter from domain, conversation, delivery, manifest or ports", () => {
    const bad = files(ROOT)
      .map((f) => relative(ROOT, f))
      .filter((rel) => /^(domain|conversation|delivery|manifest|ports)\//.test(rel) && !rel.includes("__") && !rel.endsWith(".test.ts"))
      .filter((rel) => /from\s+["'][^"']*adapters\//.test(readFileSync(join(ROOT, rel), "utf8")));
    expect(bad).toEqual([]);
  });
});
