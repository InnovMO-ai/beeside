import { Db } from "../db/database";
import { FaError } from "../fa/services/errors";

/**
 * Macroblock 4 — Precision persistence repository/service primitives.
 *
 * Thin wrappers over the raw SQL in backend/db/migrations/0015-0016 (same convention as
 * ../premium/premium-service.ts: parametrized queries through the `Db` interface, not the
 * Drizzle query builder at runtime — Drizzle here is schema/migration tooling only).
 *
 * NOT VERIFIED BY THE TOOLCHAIN in this pass: `npm install` could not complete in the sandbox
 * this macroblock was built in (sandbox registry policy blocks a transitive dependency,
 * `yocto-queue@0.1.0`, with a persistent E403 — see the Macroblock 4 completion report), so this
 * file has not been typechecked, linted, or exercised by Jest. The physical schema, triggers and
 * SQL functions it calls ARE independently verified — see db/tests/precision/ (50/50 assertions,
 * executed against a real local Postgres 16 instance). Re-run `npm run typecheck`/`test` on this
 * file specifically once node_modules installs cleanly.
 */

// Postgres SQLSTATEs this module's callers care about (see 0016_precision_persistence_integrity.sql).
const BUSINESS_RULE_VIOLATION = "BV409";
const NOT_FOUND_SQLSTATE = "BV404";

function isPgError(err: unknown): err is { code?: string; message: string } {
  return typeof err === "object" && err !== null && "message" in err;
}

/** Maps the DB layer's own exceptions to the FA-wide error contract; anything else rethrows as-is. */
async function mapDbErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isPgError(err)) {
      if (err.code === BUSINESS_RULE_VIOLATION) throw new FaError("NOT_APPLICABLE", err.message);
      if (err.code === NOT_FOUND_SQLSTATE) throw new FaError("NOT_FOUND", err.message);
    }
    throw err;
  }
}

export type PrecisionInstanceScope = "project" | "category";
export type PaStatus = "not_started" | "in_progress" | "ready_for_confirmation" | "confirmed";
export type CategoryStatus = "proposed" | "not_selected" | "confirmed" | "in_progress" | "completed";
export type CategoryOrigin = "pa_detected" | "client_added";
export type FactSource = "precision_assessment" | "category";
export type FactProvenanceStage = "ai_extracted" | "client_answered" | "client_confirmed" | "client_corrected" | "system_derived";
export type FactAnswerState = "NOT_ASKED" | "UNKNOWN" | "WITHHELD" | "EXPLICIT_NO" | "ZERO" | "ANSWERED";

/** Creates the project's single PA instance + its precision_assessment row, pinning the manifest
 * version current at this exact moment (§19). Relies on precision_instance's own partial unique
 * index for "one PA per project" — a second call for the same project surfaces as a 23505 from
 * the driver, which the caller should treat as "PA already exists," not retry. */
export async function createPrecisionAssessment(db: Db, projectId: string): Promise<{ instanceId: string; manifestVersion: string }> {
  return mapDbErrors(async () => {
    const { rows: mv } = await db.query<{ version: string }>("SELECT version FROM project_manifest_version WHERE is_current");
    const manifestVersion = mv[0]?.version;
    if (!manifestVersion) throw new FaError("NOT_APPLICABLE", "no current project_manifest_version is published");
    return db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "INSERT INTO precision_instance (project_id, scope) VALUES ($1, 'project') RETURNING id",
        [projectId],
      );
      const instanceId = rows[0].id;
      await tx.query("INSERT INTO precision_assessment (instance_id, manifest_version) VALUES ($1, $2)", [instanceId, manifestVersion]);
      return { instanceId, manifestVersion };
    });
  });
}

/** Add Category (§22) / PA detection: duplicate-check by (project_id, category_key) first — the
 * three frozen outcomes (redirect / reactivate / insert) — before ever attempting an insert. */
export async function getOrCreateCategoryAssessment(
  db: Db,
  projectId: string,
  categoryKey: string,
  origin: CategoryOrigin,
): Promise<{ instanceId: string; created: boolean; reactivated: boolean }> {
  return mapDbErrors(() =>
    db.transaction(async (tx) => {
      const { rows: existing } = await tx.query<{ instance_id: string; lifecycle_status: CategoryStatus }>(
        "SELECT instance_id, lifecycle_status FROM category_assessment WHERE project_id = $1 AND category_key = $2 FOR UPDATE",
        [projectId, categoryKey],
      );
      if (existing[0]) {
        const row = existing[0];
        if (row.lifecycle_status === "not_selected") {
          await tx.query("UPDATE category_assessment SET lifecycle_status = 'confirmed' WHERE instance_id = $1", [row.instance_id]);
          return { instanceId: row.instance_id, created: false, reactivated: true };
        }
        // confirmed / in_progress / completed -> redirect, no write (§6/§22).
        return { instanceId: row.instance_id, created: false, reactivated: false };
      }

      const { rows: mv } = await tx.query<{ version: string }>(
        "SELECT version FROM category_manifest_version WHERE category_key = $1 AND is_current",
        [categoryKey],
      );
      const manifestVersion = mv[0]?.version;
      if (!manifestVersion) throw new FaError("NOT_APPLICABLE", `no current category_manifest_version is published for ${categoryKey}`);

      const { rows: instance } = await tx.query<{ id: string }>(
        "INSERT INTO precision_instance (project_id, scope) VALUES ($1, 'category') RETURNING id",
        [projectId],
      );
      const instanceId = instance[0].id;
      await tx.query(
        "INSERT INTO category_assessment (instance_id, project_id, category_key, manifest_version, category_origin) VALUES ($1, $2, $3, $4, $5)",
        [instanceId, projectId, categoryKey, manifestVersion, origin],
      );
      return { instanceId, created: true, reactivated: false };
    }),
  );
}

/** Atomic Fact-versioning (§8/§9): one sanctioned write path, superseding the current row for
 * (scope_instance_id, field_key) if any exists, via the fact_record() SQL function (0016). */
export async function recordFact(
  db: Db,
  input: {
    projectId: string;
    scopeInstanceId: string;
    fieldKey: string;
    value: unknown;
    valueType: string;
    answerState: FactAnswerState;
    source: FactSource;
    provenanceStage: FactProvenanceStage;
    confidence?: number | null;
  },
): Promise<string> {
  return mapDbErrors(async () => {
    const { rows } = await db.query<{ fact_record: string }>(
      "SELECT fact_record($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9) AS fact_record",
      [
        input.projectId,
        input.scopeInstanceId,
        input.fieldKey,
        JSON.stringify(input.value),
        input.valueType,
        input.answerState,
        input.source,
        input.provenanceStage,
        input.confidence ?? null,
      ],
    );
    return rows[0].fact_record;
  });
}

/** Reads every current (non-superseded) fact for one instance — the category-local half of the
 * merge-at-read described in §18. The PA-level shared half is a second call with the project's PA
 * instance id; merging by field_key (category-scoped taking precedence) is the caller's job, not
 * this primitive's — kept here as a pure data-access function, not a policy function. */
export async function currentFacts(db: Db, scopeInstanceId: string): Promise<Array<{ fieldKey: string; value: unknown; provenanceStage: FactProvenanceStage; answerState: FactAnswerState }>> {
  const { rows } = await db.query<{ field_key: string; value: unknown; provenance_stage: FactProvenanceStage; answer_state: FactAnswerState }>(
    "SELECT field_key, value, provenance_stage, answer_state FROM fact WHERE scope_instance_id = $1 AND superseded_by IS NULL",
    [scopeInstanceId],
  );
  return rows.map((r) => ({ fieldKey: r.field_key, value: r.value, provenanceStage: r.provenance_stage, answerState: r.answer_state }));
}

/** Confirms a PA (§1.8/§11) — requires lifecycle_status = 'ready_for_confirmation'; wraps the
 * precision_assessment_confirm() SQL function, which atomically inserts the new service_map_snapshot
 * and repoints precision_assessment.service_map_snapshot_id in the same transaction. */
export async function confirmPrecisionAssessment(db: Db, instanceId: string, content: unknown): Promise<string> {
  return mapDbErrors(async () => {
    const { rows } = await db.query<{ precision_assessment_confirm: string }>(
      "SELECT precision_assessment_confirm($1, $2::jsonb) AS precision_assessment_confirm",
      [instanceId, JSON.stringify(content)],
    );
    return rows[0].precision_assessment_confirm;
  });
}

/** Completes a category (§1.8/§11) — requires lifecycle_status = 'in_progress'; wraps
 * category_assessment_complete(), which atomically inserts the new pack and repoints
 * category_assessment.current_pack_id in the same transaction. */
export async function completeCategoryAssessment(db: Db, instanceId: string, content: unknown, contextSnapshot: unknown): Promise<string> {
  return mapDbErrors(async () => {
    const { rows } = await db.query<{ category_assessment_complete: string }>(
      "SELECT category_assessment_complete($1, $2::jsonb, $3::jsonb) AS category_assessment_complete",
      [instanceId, JSON.stringify(content), JSON.stringify(contextSnapshot)],
    );
    return rows[0].category_assessment_complete;
  });
}

/** A client-initiated lifecycle move that is NOT a confirm/complete (e.g. not_started ->
 * in_progress, or a reopen). The guard trigger (0016) is what actually enforces which moves are
 * legal; this primitive exists only so callers never hand-write the UPDATE. */
export async function movePaLifecycle(db: Db, instanceId: string, to: PaStatus): Promise<void> {
  await mapDbErrors(() => db.query("UPDATE precision_assessment SET lifecycle_status = $2 WHERE instance_id = $1", [instanceId, to]));
}

export async function moveCategoryLifecycle(db: Db, instanceId: string, to: CategoryStatus): Promise<void> {
  await mapDbErrors(() => db.query("UPDATE category_assessment SET lifecycle_status = $2 WHERE instance_id = $1", [instanceId, to]));
}

/** Publishes a manifest version and atomically repoints the current pointer (§19). DRAFT ->
 * PUBLISHED directly — no diff-review workflow for manifests in this macroblock (routine scope
 * reduction, see the completion report); additive later via the same config_version_review shape
 * FA's own registries already use, if ever needed. */
export async function publishProjectManifest(db: Db, version: string, actorAdminUserId: string): Promise<void> {
  await mapDbErrors(() => db.query("SELECT precision_project_manifest_publish($1, $2)", [version, actorAdminUserId]));
}

export async function publishCategoryManifest(db: Db, categoryKey: string, version: string, actorAdminUserId: string): Promise<void> {
  await mapDbErrors(() => db.query("SELECT precision_category_manifest_publish($1, $2, $3)", [categoryKey, version, actorAdminUserId]));
}
