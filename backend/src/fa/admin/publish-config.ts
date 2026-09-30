import fs from "node:fs";
import path from "node:path";
import { buildQuestionBankBundle, FA_QUESTION_BANK_VERSION } from "../content/question-bank";
import { buildQuestionBankBundleV2, FA_QUESTION_BANK_VERSION_V2 } from "../content/question-bank-v2";
import { buildQuestionBankBundleV21, FA_QUESTION_BANK_VERSION_V21 } from "../content/question-bank-v2-1";
import { validateQuestionBankBundle } from "../engine/validate-bundle";
import { buildRulesEngineBundle, FA_RULES_ENGINE_VERSION } from "../../rules/content/rules-engine-v1";
import { buildRulesEngineBundleV11, FA_RULES_ENGINE_VERSION_V1_1 } from "../../rules/content/rules-engine-v1-1";
import { validateRulesEngineBundle } from "../../rules/validate-rules-bundle";
import { buildSnapshotTemplateBundle, FA_SNAPSHOT_TEMPLATE_VERSION } from "../../snapshot/template";

interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** Technical ADMIN used only to bootstrap development configuration (Handoff v1 §30). */
export const DEV_BOOTSTRAP_ADMIN_IDENTITY = "dev-bootstrap-admin@beeside.internal";

export const PLACEHOLDER_VERSIONS = {
  RULES_ENGINE: "re-0.0.0-placeholder",
  SNAPSHOT_TEMPLATE: "st-0.0.0-placeholder",
} as const;

type Registry = "QUESTION_BANK" | "RULES_ENGINE" | "SNAPSHOT_TEMPLATE";
const TABLE: Record<Registry, string> = {
  QUESTION_BANK: "question_bank_version",
  RULES_ENGINE: "rules_engine_version",
  SNAPSHOT_TEMPLATE: "snapshot_template_version",
};

const placeholderPath = (file: string) => path.resolve(__dirname, "../../../db/config-bundles/placeholder", file);

export async function ensureDevBootstrapAdmin(db: Queryable): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO admin_user (role, auth_identity) VALUES ('ADMIN', $1)
     ON CONFLICT (auth_identity) DO UPDATE SET updated_at = now()
     RETURNING admin_user_id, role, active`,
    [DEV_BOOTSTRAP_ADMIN_IDENTITY],
  );
  const admin = rows[0] as { admin_user_id: string; role: string; active: boolean } | undefined;
  if (!admin || admin.role !== "ADMIN" || !admin.active) throw new Error("dev bootstrap admin is not an active ADMIN");
  return admin.admin_user_id;
}

/**
 * Publishes one version through the Phase 3 lifecycle (draft → preview → diff review → publish)
 * unless that exact version is already published. Returns what happened.
 */
async function publishVersion(db: Queryable, registry: Registry, version: string, config: unknown, adminId: string): Promise<string> {
  const { rows } = await db.query(`SELECT status, is_current FROM ${TABLE[registry]} WHERE version = $1`, [version]);
  const existing = rows[0] as { status: string; is_current: boolean } | undefined;
  if (existing?.status === "PUBLISHED") return existing.is_current ? "already current" : "published (not current)";
  if (existing) throw new Error(`${registry} ${version} exists in status ${existing.status}; resolve it through the lifecycle first`);

  await db.query("SELECT config_create_draft($1::config_registry, $2, $3::jsonb, $4::uuid)", [registry, version, JSON.stringify(config), adminId]);
  const preview = await db.query("SELECT config_submit_for_preview($1::config_registry, $2, $3::uuid) AS result", [registry, version, adminId]);
  const kind = (preview.rows[0] as { result: { change_kind: string } }).result.change_kind;
  await db.query("SELECT config_record_review($1::config_registry, $2, $3::uuid, 'APPROVED', $4, $5)", [
    registry,
    version,
    adminId,
    kind === "LOGIC_SCHEMA",
    "Development bootstrap of First Assessment Core configuration",
  ]);
  await db.query("SELECT config_publish($1::config_registry, $2, $3::uuid)", [registry, version, adminId]);
  return `published (${kind})`;
}

/** Placeholder bundles shipped in the repository (kept for the Phase 3 validation suite). */
export function readPlaceholderBundle(registry: "RULES_ENGINE" | "SNAPSHOT_TEMPLATE"): unknown {
  const file = registry === "RULES_ENGINE" ? "rules-engine.json" : "snapshot-template.json";
  return JSON.parse(fs.readFileSync(placeholderPath(file), "utf8"));
}

/**
 * Development bootstrap: the First Assessment question bank (v1 by default; pass "v2" or "v2.1" to
 * publish a later bundle instead — see the `--level2`/`--canonical` flags on the
 * `config:publish-dev` script), the Rules Engine v1 and the Expansion Snapshot template v1, each
 * published through the Phase 3 gate. The earlier placeholder versions — and, when switching
 * question banks, the other versions' question banks — stay PUBLISHED (immutable history) but are
 * no longer current. Idempotent.
 *
 * The default ("v1") is unchanged from before this parameter existed, so every existing caller that
 * does not pass a third argument — in particular `fa-harness.ts`, shared by the whole integration
 * test suite — keeps bootstrapping fa-qb-1.1.0 exactly as before. Only the interactive local-dev
 * script opts into "v2" or "v2.1".
 *
 * "v2.1" (fa-qb-2.1.0, question-bank-v2-1.ts) is the new canonical bundle from the 2026-09-30
 * Product Owner decisions (Decision A/B: "all NEW First Assessments must use the new canonical
 * question-bank version derived from v2"; fa-qb-1.1.0 stays legacy, untouched, still readable for
 * any project already pinned to it — see that file's own header for the full mapping).
 *
 * RESOLVED (2026-09-30, item 2 of the Final Pre-Deploy pass — see rules-engine-v1-1.ts for the full
 * compatibility reasoning): publishing "v2" or "v2.1" now pins the Rules Engine to re-1.1.0, a pure
 * version/compatibility extension of re-1.0.0 whose `question_bank_versions` allowlist directly
 * includes fa-qb-2.0.0 and fa-qb-2.1.0 — not one condition, weight, threshold or scoring behavior
 * changed from re-1.0.0. "v1" keeps publishing re-1.0.0 exactly as before, so `fa-harness.ts` and
 * every existing integration test that calls this function with no third argument, or with "v1", is
 * unaffected. re-1.0.0 itself is untouched: it still lists only fa-qb-1.0.0, so any project already
 * pinned to it (every fa-qb-1.1.0 project) keeps evaluating exactly as it does today.
 */
export async function publishDevConfiguration(
  db: Queryable,
  adminId: string,
  questionBank: "v1" | "v2" | "v2.1" = "v1",
): Promise<Record<Registry, string>> {
  const bundle = questionBank === "v2.1" ? buildQuestionBankBundleV21() : questionBank === "v2" ? buildQuestionBankBundleV2() : buildQuestionBankBundle();
  const bundleVersion = questionBank === "v2.1" ? FA_QUESTION_BANK_VERSION_V21 : questionBank === "v2" ? FA_QUESTION_BANK_VERSION_V2 : FA_QUESTION_BANK_VERSION;
  const errors = validateQuestionBankBundle(bundle);
  if (errors.length > 0) throw new Error(`question bank bundle is invalid:\n${errors.join("\n")}`);
  // v1 keeps publishing re-1.0.0 exactly as before (fa-harness.ts and every caller that does not
  // pass "v2"/"v2.1" must see byte-identical behavior). v2/v2.1 publish re-1.1.0 instead — the same
  // rules content, only its question_bank_versions allowlist is wider — so the Virtual Snapshot step
  // no longer hits NOT_READY for a Level 2 or canonical-regroup project. See rules-engine-v1-1.ts.
  const rules = questionBank === "v1" ? buildRulesEngineBundle() : buildRulesEngineBundleV11();
  const rulesVersion = questionBank === "v1" ? FA_RULES_ENGINE_VERSION : FA_RULES_ENGINE_VERSION_V1_1;
  const ruleErrors = validateRulesEngineBundle(rules);
  if (ruleErrors.length > 0) throw new Error(`rules engine bundle is invalid:\n${ruleErrors.join("\n")}`);

  const result = {} as Record<Registry, string>;
  result.QUESTION_BANK = await publishVersion(db, "QUESTION_BANK", bundleVersion, bundle, adminId);
  result.RULES_ENGINE = await publishVersion(db, "RULES_ENGINE", rulesVersion, rules, adminId);
  result.SNAPSHOT_TEMPLATE = await publishVersion(db, "SNAPSHOT_TEMPLATE", FA_SNAPSHOT_TEMPLATE_VERSION, buildSnapshotTemplateBundle(), adminId);
  return result;
}
