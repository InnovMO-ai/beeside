import { AUTHORED_CATEGORY_KEYS, bundledCategoryManifest } from "../bundled";
import { genericBackedManifest, manifestsToPublish, unauthoredCatalogCategories, validateBundled } from "../publish";
import { canonicalJson, manifestContentHash, manifestVersionOf } from "../publish-hash";
import { resolveManifestCategoryKey } from "../registry";
import { evaluateCategory } from "../readiness";

describe("publish helpers (no database)", () => {
  it("the shipped manifests validate with zero findings before anything is published", () => {
    expect(validateBundled()).toEqual([]);
  });
  it("canonical JSON ignores key order and undefined; version strings are deterministic and change with content", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe('{"a":[2,{"d":1}],"b":1}');
    const lg = bundledCategoryManifest("logistics")!;
    expect(manifestVersionOf(lg)).toBe(manifestVersionOf(JSON.parse(JSON.stringify(lg))));
    expect(manifestVersionOf(lg)).toMatch(/^0\.1-draft\.[0-9a-f]{8}$/);
    const changed = { ...lg, fields: lg.fields.slice(1) };
    expect(manifestVersionOf(changed)).not.toBe(manifestVersionOf(lg));
    expect(manifestContentHash(lg)).toMatch(/^[0-9a-f]{64}$/);
    expect(manifestVersionOf({ manifest_version_label: " we ird/label " })).toMatch(/^we-ird-label\.[0-9a-f]{8}$/);
  });
  it("plans 1 project + 7 authored + _generic + 12 generic-backed rows with unique (category, version) keys", () => {
    const plan = manifestsToPublish();
    expect(plan.filter((p) => p.kind === "project")).toHaveLength(1);
    expect(plan.filter((p) => p.kind === "category" && !p.genericBacked).map((p) => p.categoryKey)).toEqual([...AUTHORED_CATEGORY_KEYS, "_generic"]);
    expect(plan.filter((p) => p.genericBacked)).toHaveLength(12);
    const ids = plan.map((p) => `${p.kind}/${p.categoryKey}/${manifestVersionOf(p.doc)}`);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of plan) if (p.categoryKey) expect(p.categoryKey).toMatch(/^(_generic|[a-z][a-z0-9_]{1,63})$/);
    expect(manifestsToPublish(false)).toHaveLength(9);
  });
  it("a generic-backed manifest is the generic content under its own key and evaluates like a normal category", () => {
    expect(unauthoredCatalogCategories()).toContain("banking_finance_insurance");
    const m = genericBackedManifest("banking_finance_insurance");
    expect(m).toMatchObject({ category_key: "banking_finance_insurance", crp_kind: "operational", generic_backed: true });
    expect(m.fields).toEqual(bundledCategoryManifest("_generic")!.fields);
    expect(evaluateCategory({ manifest: m, facts: {}, countries: [] }).progressPct).toBe(0);
    // the bundled _generic is not mutated
    expect(bundledCategoryManifest("_generic")!.category_key).toBe("_generic");
  });
  it("new:<slug> resolves to _generic, everything else to itself", () => {
    expect(resolveManifestCategoryKey("new:x")).toBe("_generic");
    expect(resolveManifestCategoryKey("logistics")).toBe("logistics");
  });
});
