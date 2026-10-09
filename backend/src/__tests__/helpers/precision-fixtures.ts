import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Db } from "../../db/database";

/**
 * DB fixtures for tests that need a project and real packs (mirrors db/tests/precision/run_precision_tests.sql).
 * Writes COMMITTED rows when given a pool-backed Db (required to test concurrency); use a scratch database.
 * Every call uses fresh version names, so it can run any number of times against the same database.
 */
export interface PrecisionFixture {
  newProject(label?: string): Promise<{ projectId: string; companyId: string }>;
  /** Completes a category assessment and returns the resulting pack id. */
  newPack(projectId: string, categoryKey: "logistics" | "hr"): Promise<string>;
  /** Confirms the Project Service Map and returns the snapshot id. */
  newSnapshot(projectId: string): Promise<string>;
}

// A marker key keeps the bundle different from the placeholder bundles that db/tests/precision publishes (the registry
// refuses an identical re-publish), so this fixture and the SQL suite can share one scratch database.
const bundle = (name: string, run: string): string =>
  JSON.stringify({ ...JSON.parse(readFileSync(join(__dirname, "../../../db/config-bundles/placeholder", name), "utf8")), fixture_run: run });

export async function setupPrecisionFixture(db: Db): Promise<PrecisionFixture> {
  const run = randomUUID().slice(0, 8);
  const admin = (await db.query<{ id: string }>("INSERT INTO admin_user (role, auth_identity) VALUES ('ADMIN', $1) RETURNING admin_user_id AS id", [`oh-${run}@beeside.internal`])).rows[0]!.id;
  // The config registry refuses to publish a bundle identical to the current one, so a re-run reuses what is current.
  const registries: Array<[string, string, string, string]> = [
    ["QUESTION_BANK", `ohd-qb-${run}`, bundle("question-bank.json", run), "question_bank_version"],
    ["RULES_ENGINE", `ohd-re-${run}`, bundle("rules-engine.json", run), "rules_engine_version"],
    ["SNAPSHOT_TEMPLATE", `ohd-st-${run}`, bundle("snapshot-template.json", run), "snapshot_template_version"],
  ];
  for (const reg of registries) {
    const [type, version, content, table] = reg;
    const current = (await db.query<{ version: string }>(`SELECT version FROM ${table} WHERE is_current`)).rows[0];
    if (current) { reg[1] = current.version; continue; }
    await db.query("SELECT config_create_draft($1, $2, $3::jsonb, $4)", [type, version, content, admin]);
    await db.query("SELECT config_submit_for_preview($1, $2, $3)", [type, version, admin]);
    await db.query("SELECT config_record_review($1, $2, $3, 'APPROVED', true, 'fixture')", [type, version, admin]);
    await db.query("SELECT config_publish($1, $2, $3)", [type, version, admin]);
  }
  const pmv = `pmv-ohd-${run}`;
  await db.query(
    "INSERT INTO project_manifest_version (version, content, created_by_admin_user_id) VALUES ($1, $2::jsonb, $3)",
    [pmv, '{"candidate_categories": [{"category_key": "logistics"}, {"category_key": "hr"}], "project_split_signals": []}', admin],
  );
  await db.query("SELECT precision_project_manifest_publish($1, $2)", [pmv, admin]);
  const cmv: Record<string, string> = {};
  for (const key of ["logistics", "hr"]) {
    cmv[key] = `cmv-ohd-${key}-${run}`;
    await db.query(
      "INSERT INTO category_manifest_version (category_key, version, content, created_by_admin_user_id) VALUES ($1, $2, $3::jsonb, $4)",
      [key, cmv[key], '{"fields": [], "critical_decisions": [], "country_overlays": {}, "operational_pending_items": [], "visibility_rules": []}', admin],
    );
    await db.query("SELECT precision_category_manifest_publish($1, $2, $3)", [key, cmv[key], admin]);
  }

  return {
    async newProject(label = "OhDelivery") {
      const company = (await db.query<{ id: string }>("INSERT INTO company (name) VALUES ($1) RETURNING company_id AS id", [`${label} ${run} Co`])).rows[0]!.id;
      const person = (await db.query<{ id: string }>(
        `INSERT INTO person (first_name, last_name, primary_email, interface_language, preferred_interaction_language, preferred_deliverable_language)
         VALUES ($1, 'Person', $2, 'en', 'en', 'en') RETURNING person_id AS id`,
        [label, `${randomUUID()}@beeside-test.invalid`],
      )).rows[0]!.id;
      const project = (await db.query<{ id: string }>(
        `INSERT INTO project (company_id, created_by_person_id, responsible_person_id, question_bank_version, rules_engine_version, snapshot_template_version)
         VALUES ($1, $2, $2, $3, $4, $5) RETURNING project_id AS id`,
        [company, person, registries[0]![1], registries[1]![1], registries[2]![1]],
      )).rows[0]!.id;
      return { projectId: project, companyId: company };
    },
    async newSnapshot(projectId) {
      const inst = (await db.query<{ id: string }>("INSERT INTO precision_instance (project_id, scope) VALUES ($1, 'project') RETURNING id", [projectId])).rows[0]!.id;
      await db.query("INSERT INTO precision_assessment (instance_id, manifest_version) VALUES ($1, (SELECT version FROM project_manifest_version WHERE is_current))", [inst]);
      await db.query("UPDATE precision_assessment SET lifecycle_status = 'in_progress' WHERE instance_id = $1", [inst]);
      await db.query("UPDATE precision_assessment SET lifecycle_status = 'ready_for_confirmation' WHERE instance_id = $1", [inst]);
      return (await db.query<{ id: string }>("SELECT precision_assessment_confirm($1, '{\"categories\": []}'::jsonb) AS id", [inst])).rows[0]!.id;
    },
    async newPack(projectId, categoryKey) {
      const inst = (await db.query<{ id: string }>("INSERT INTO precision_instance (project_id, scope) VALUES ($1, 'category') RETURNING id", [projectId])).rows[0]!.id;
      await db.query(
        "INSERT INTO category_assessment (instance_id, project_id, category_key, manifest_version, category_origin) VALUES ($1, $2, $3, $4, 'pa_detected')",
        [inst, projectId, categoryKey, cmv[categoryKey]],
      );
      await db.query("UPDATE category_assessment SET lifecycle_status = 'confirmed' WHERE instance_id = $1", [inst]);
      await db.query("UPDATE category_assessment SET lifecycle_status = 'in_progress' WHERE instance_id = $1", [inst]);
      return (await db.query<{ id: string }>(
        "SELECT category_assessment_complete($1, $2::jsonb, '{}'::jsonb) AS id",
        [inst, JSON.stringify({ crp_kind: "operational", version_label: "v1.0" })],
      )).rows[0]!.id;
    },
  };
}
