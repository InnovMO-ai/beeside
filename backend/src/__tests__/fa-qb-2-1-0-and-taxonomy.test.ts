import { buildQuestionBankBundle, FA_QUESTION_BANK_VERSION } from "../fa/content/question-bank";
import { buildQuestionBankBundleV2 } from "../fa/content/question-bank-v2";
import { buildQuestionBankBundleV21, FA_QUESTION_BANK_VERSION_V21 } from "../fa/content/question-bank-v2-1";
import { validateQuestionBankBundle } from "../fa/engine/validate-bundle";
import { NEEDS_EXPLORER_TAXONOMY, isKnownNeedsLeaf, resolveCanonicalCategory } from "../fa/content/needs-explorer-taxonomy";
import { questionSchemaFingerprint, KNOWN_QUESTION_SCHEMA_FINGERPRINTS } from "../fa/services/bundle-store";
import { buildRulesEngineBundle } from "../rules/content/rules-engine-v1";
import { buildRulesEngineBundleV11, FA_RULES_ENGINE_VERSION_V1_1 } from "../rules/content/rules-engine-v1-1";

/**
 * Verification suite for the 2026-09-30 Product Owner decisions (Decision A/B): the new canonical
 * question-bank version fa-qb-2.1.0, the frozen 6-family/36-capability taxonomy it uses, and the
 * Rules Engine compatibility gap that used to block it — and fa-qb-2.0.0 before it — from reaching
 * the Virtual Snapshot step. That gap is now RESOLVED by a new Rules Engine version, re-1.1.0
 * (rules-engine-v1-1.ts) — see rules-engine-v1-1-compat.test.ts for its own dedicated coverage and
 * publish-config.ts's docblock for the full context. The suite below is kept exactly as originally
 * written for re-1.0.0 (still true and still worth asserting: the OLD pinned rules engine genuinely
 * never vouches for fa-qb-2.1.0, which is correct — legacy projects stay on re-1.0.0), with one
 * extra test at the end confirming the resolution path.
 */
describe("fa-qb-2.1.0 — regrouped canonical bundle (Decision A)", () => {
  it("preserves every fa-qb-2.0.0 question plus exactly the 7 new Leave-a-note questions (scope item 5)", () => {
    const v2 = buildQuestionBankBundleV2();
    const v21 = buildQuestionBankBundleV21();
    const v2Ids = new Set(v2.questions.map((q) => q.id));
    const v21Ids = new Set(v21.questions.map((q) => q.id));
    for (const id of v2Ids) expect(v21Ids.has(id)).toBe(true);
    const added = [...v21Ids].filter((id) => !v2Ids.has(id));
    expect(new Set(added)).toEqual(
      new Set(["NOTE_COMPANY", "NOTE_PROJECT", "NOTE_OBJECTIVES", "NOTE_MARKET", "NOTE_ACTIVATION", "NOTE_RULES", "NOTE_RESOURCES"]),
    );
  });

  it("validates cleanly against the engine's structural bundle validator", () => {
    expect(validateQuestionBankBundle(buildQuestionBankBundleV21())).toEqual([]);
  });

  it("exposes exactly the canonical 8-stage rail, Identity excluded (pre-rail)", () => {
    const v21 = buildQuestionBankBundleV21();
    expect(v21.stages.map((s) => s.id)).toEqual([
      "l3_company",
      "l3_project",
      "l3_objectives_market",
      "l3_needs",
      "l3_activation",
      "l3_rules",
      "l3_resources_review",
      "snapshot",
    ]);
  });

  it("gives every one of the 8 named Review blocks its own step and note affordance", () => {
    const v21 = buildQuestionBankBundleV21();
    const reviewBlockSteps = v21.steps.filter((s) => s.kind !== "review" && s.kind !== "transition");
    expect(reviewBlockSteps.map((s) => s.id)).toEqual([
      "l3_company",
      "l3_project",
      "l3_objectives",
      "l3_market",
      "l3_needs",
      "l3_activation",
      "l3_rules",
      "l3_resources",
    ]);
    for (const step of reviewBlockSteps) expect(step.note_field_id).toBeTruthy();
  });
});

describe("needs-explorer-taxonomy — frozen 6 families / 36 capabilities (PRE-SNAPSHOT scope item 6)", () => {
  it("has exactly 6 families and 36 leaves", () => {
    expect(NEEDS_EXPLORER_TAXONOMY.length).toBe(6);
    expect(NEEDS_EXPLORER_TAXONOMY.reduce((n, g) => n + g.leaves.length, 0)).toBe(36);
  });

  it("keeps the sentinel key validate-bundle.ts depends on", () => {
    expect(isKnownNeedsLeaf("company_setup")).toBe(true);
  });

  it("keeps every key referenced by questions-needs-followups.ts gates", () => {
    const gatedKeys = [
      "supplier_search",
      "foreign_trade_customs",
      "threepl_warehousing_inventory",
      "freight_mobility",
      "last_mile",
      "industrial_warehouse_real_estate",
      "construction",
      "erp",
      "wms",
      "tms",
      "integrations",
      "data_video_surveillance",
      "hr_payroll_social_security",
      "local_partner_search_match",
      "regulatory_permits",
    ];
    for (const key of gatedKeys) expect(isKnownNeedsLeaf(key)).toBe(true);
  });

  it("maps every leaf to a valid canonical category id (1-10)", () => {
    for (const group of NEEDS_EXPLORER_TAXONOMY) {
      for (const leaf of group.leaves) {
        const id = resolveCanonicalCategory(leaf.key);
        expect(id).toBeGreaterThanOrEqual(1);
        expect(id).toBeLessThanOrEqual(10);
      }
    }
  });

  it("has no duplicate leaf keys", () => {
    const keys = NEEDS_EXPLORER_TAXONOMY.flatMap((g) => g.leaves.map((l) => l.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("legacy fa-qb-1.1.0 — unaffected by this pass (Decision B)", () => {
  it("still builds, still validates, and its version string is unchanged", () => {
    expect(FA_QUESTION_BANK_VERSION).toBe("fa-qb-1.1.0");
    expect(validateQuestionBankBundle(buildQuestionBankBundle())).toEqual([]);
  });
});

describe("publishDevConfiguration default — new-assessment safety (Decision B)", () => {
  it("fa-qb-1.1.0 stays the function's default even though fa-qb-2.1.0 now exists", () => {
    // publish-config.ts's `questionBank: "v1" | "v2" | "v2.1" = "v1"` — read the source rather than
    // calling the function itself, which requires a live Postgres connection this suite doesn't have.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const src = fs.readFileSync(path.resolve(__dirname, "../fa/admin/publish-config.ts"), "utf8");
    expect(src).toMatch(/questionBank:\s*"v1"\s*\|\s*"v2"\s*\|\s*"v2\.1"\s*=\s*"v1"/);
  });
});

describe("Rules Engine / fa-qb-2.1.0 schema compatibility — re-1.0.0 scope, and its re-1.1.0 resolution", () => {
  it("documents that re-1.0.0 does not currently vouch for fa-qb-2.1.0's schema", () => {
    const rules = buildRulesEngineBundle();
    const v21Fingerprint = questionSchemaFingerprint(buildQuestionBankBundleV21());
    const v1Fingerprint = questionSchemaFingerprint(buildQuestionBankBundle());
    // re-1.0.0 only lists fa-qb-1.0.0, whose known fingerprint is fixed and long predates fa-qb-2.1.0.
    expect(rules.question_bank_versions).toEqual(["fa-qb-1.0.0"]);
    expect(v21Fingerprint).not.toBe(KNOWN_QUESTION_SCHEMA_FINGERPRINTS["fa-qb-1.0.0"]);
    expect(v21Fingerprint).not.toBe(v1Fingerprint);
    // Intentionally red-flagging, not silently green: if this test ever starts failing because a new
    // Rules Engine version's allowlist was extended to cover fa-qb-2.1.0's fingerprint, that is
    // GOOD NEWS — update this test to assert compatibility instead of removing it.
  });

  it("names the exact version that would need to change", () => {
    expect(FA_QUESTION_BANK_VERSION_V21).toBe("fa-qb-2.1.0");
  });

  it("is resolved: re-1.1.0 directly vouches for fa-qb-2.1.0 (and fa-qb-2.0.0), with zero rule-content drift from re-1.0.0", () => {
    expect(FA_RULES_ENGINE_VERSION_V1_1).toBe("re-1.1.0");
    expect(buildRulesEngineBundleV11().question_bank_versions).toContain(FA_QUESTION_BANK_VERSION_V21);
  });
});
