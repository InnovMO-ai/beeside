import fs from "node:fs";
import path from "node:path";
import { buildQuestionBankBundle, FA_QUESTION_BANK_VERSION } from "../content/question-bank";
import { buildQuestionBankBundleV2, FA_QUESTION_BANK_VERSION_V2 } from "../content/question-bank-v2";
import { validateQuestionBankBundle } from "../engine/validate-bundle";
import { buildRulesEngineBundle, FA_RULES_ENGINE_VERSION } from "../../rules/content/rules-engine-v1";
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
 * Development bootstrap: the First Assessment question bank (v1 by default; pass "v2" to publish
 * the approved Level 2 bundle instead — see the `--level2` flag on the `config:publish-dev` script),
 * the Rules Engine v1 and the Expansion Snapshot template v1, each published through the Phase 3
 * gate. The earlier placeholder versions — and, when switching question banks, the other version's
 * question bank — stay PUBLISHED (immutable history) but are no longer current. Idempotent.
 *
 * The default ("v1") is unchanged from before this parameter existed, so every existing caller that
 * does not pass a third argument — in particular `fa-harness.ts`, shared by the whole integration
 * test suite — keeps bootstrapping fa-qb-1.1.0 exactly as before. Only the interactive local-dev
 * script opts into "v2".
 *
 * Level 2 MVP: publishing "v2" does not also make the pinned Rules Engine (re-1.0.0) evaluate
 * fa-qb-2.0.0 — its `question_bank_versions` allowlist still lists only fa-qb-1.0.0, and the two
 * bundles' schema fingerprints differ, so `BundleStore.questionBankCompatibleWith` currently returns
 * false for this pair. Reaching the Virtual Snapshot step of the Level 2 journey will still fail with
 * NOT_READY ("the pinned rules engine cannot evaluate this question bank version") until a rules
 * engine version that is actually verified to evaluate the Level 2 schema is published as compatible
 * — a product/content decision this function deliberately does not make on its own.
 */
export async function publishDevConfiguration(
  db: Queryable,
  adminId: string,
  questionBank: "v1" | "v2" = "v1",
): Promise<Record<Registry, string>> {
  const bundle = questionBank === "v2" ? buildQuestionBankBundleV2() : buildQuestionBankBundle();
  const bundleVersion = questionBank === "v2" ? FA_QUESTION_BANK_VERSION_V2 : FA_QUESTION_BANK_VERSION;
  const errors = validateQuestionBankBundle(bundle);
  if (errors.length > 0) throw new Error(`question bank bundle is invalid:\n${errors.join("\n")}`);
  const rules = buildRulesEngineBundle();
  const ruleErrors = validateRulesEngineBundle(rules);
  if (ruleErrors.length > 0) throw new Error(`rules engine bundle is invalid:\n${ruleErrors.join("\n")}`);

  const result = {} as Record<Registry, string>;
  result.QUESTION_BANK = await publishVersion(db, "QUESTION_BANK", bundleVersion, bundle, adminId);
  result.RULES_ENGINE = await publishVersion(db, "RULES_ENGINE", FA_RULES_ENGINE_VERSION, rules, adminId);
  result.SNAPSHOT_TEMPLATE = await publishVersion(db, "SNAPSHOT_TEMPLATE", FA_SNAPSHOT_TEMPLATE_VERSION, buildSnapshotTemplateBundle(), adminId);
  return result;
}
