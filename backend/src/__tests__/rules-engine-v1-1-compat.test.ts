import { buildRulesEngineBundle, FA_RULES_ENGINE_VERSION } from "../rules/content/rules-engine-v1";
import { buildRulesEngineBundleV11, FA_RULES_ENGINE_VERSION_V1_1 } from "../rules/content/rules-engine-v1-1";
import { validateRulesEngineBundle } from "../rules/validate-rules-bundle";
import { FA_QUESTION_BANK_VERSION_V2 } from "../fa/content/question-bank-v2";
import { FA_QUESTION_BANK_VERSION_V21 } from "../fa/content/question-bank-v2-1";

/**
 * re-1.1.0 — pure versioning/compatibility extension of re-1.0.0 (Final Pre-Deploy pass, item 2).
 * These tests exist to keep that promise mechanically enforced: if a future edit ever makes
 * re-1.1.0's actual rule content (areas, conditions, scoring, copy) diverge from re-1.0.0 by
 * anything other than `question_bank_versions`, this file fails loudly rather than letting a
 * silent methodology change ride in under a "just a version bump" commit.
 */
describe("Rules Engine re-1.1.0 — version/compatibility extension only", () => {
  it("is versioned re-1.1.0, distinct from and not replacing re-1.0.0", () => {
    expect(FA_RULES_ENGINE_VERSION_V1_1).toBe("re-1.1.0");
    expect(FA_RULES_ENGINE_VERSION).toBe("re-1.0.0");
    expect(FA_RULES_ENGINE_VERSION_V1_1).not.toBe(FA_RULES_ENGINE_VERSION);
  });

  it("validates cleanly against the same rules-bundle schema as re-1.0.0", () => {
    expect(validateRulesEngineBundle(buildRulesEngineBundleV11())).toEqual([]);
  });

  it("directly vouches for fa-qb-2.0.0 and fa-qb-2.1.0, on top of legacy fa-qb-1.0.0", () => {
    const versions = buildRulesEngineBundleV11().question_bank_versions;
    expect(versions).toContain("fa-qb-1.0.0");
    expect(versions).toContain(FA_QUESTION_BANK_VERSION_V2);
    expect(versions).toContain(FA_QUESTION_BANK_VERSION_V21);
  });

  it("leaves re-1.0.0 itself completely untouched — still only fa-qb-1.0.0", () => {
    expect(buildRulesEngineBundle().question_bank_versions).toEqual(["fa-qb-1.0.0"]);
  });

  it("changes NOTHING else — every area, condition, weight, panel, capability, growth-boost, priority-alignment and copy string is byte-identical to re-1.0.0", () => {
    const v10 = buildRulesEngineBundle();
    const v11 = buildRulesEngineBundleV11();
    const { question_bank_versions: qb10, ...rest10 } = v10;
    const { question_bank_versions: qb11, ...rest11 } = v11;
    expect(rest11).toEqual(rest10);
    expect(qb10).toEqual(["fa-qb-1.0.0"]);
    expect(qb11).not.toEqual(qb10);
  });
});
