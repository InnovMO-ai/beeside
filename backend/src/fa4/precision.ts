import { Fa4PrecisionContextV1, SealedResultError, SealedResultV1, mapSealedResultToPrecisionContext } from "@beeside/fa-public-engine";
import { Db } from "../db/database";
import { FaError } from "../fa/services/errors";

/**
 * FA4 → Precision boundary (D-158): `getFa4PrecisionContext(project_id, result_id)`. An internal service function of this repository (no public API,
 * no microservice). It reads ONLY the sealed, delivered result row (never the mutable project or answers), never re-runs the rules engine, never
 * needs the current catalog and never touches the YEV model. A preview or legacy (pre-v1.0) row is not eligible.
 * Precision owns what it ingests afterwards (it may pin the context it consumed with `contract.version`, `contract.mapperVersion` and a hash of
 * `canonicalJson(context)`); FA keeps no per-user Precision copy.
 */
export async function getFa4PrecisionContext(db: Db, projectId: string, resultId: string): Promise<Fa4PrecisionContextV1> {
  const r = (await db.query<{
    result_id: string; project_id: string; created_at: Date; catalog_version: string; rules_version: string;
    source_schema_version: number; source_snapshot: SealedResultV1["sourceSnapshot"]; resolution_schema_version: number; resolution_snapshot: SealedResultV1["resolutionSnapshot"];
  }>(
    `SELECT result_id, project_id, created_at, catalog_version, rules_version, source_schema_version, source_snapshot, resolution_schema_version, resolution_snapshot
       FROM fa4_result WHERE result_id = $1 AND project_id = $2 AND NOT legacy_unsealed`, [resultId, projectId])).rows[0];
  if (!r) throw new FaError("NOT_FOUND", "no delivered result for this project");
  if ((r.source_snapshot as unknown as { anonymized?: boolean }).anonymized) throw new FaError("NOT_RECOVERABLE", "the result was erased");
  try {
    return mapSealedResultToPrecisionContext({
      projectId: r.project_id, resultId: r.result_id, deliveredAt: r.created_at.toISOString(), catalogVersion: r.catalog_version, rulesVersion: r.rules_version,
      sourceSchemaVersion: r.source_schema_version, sourceSnapshot: r.source_snapshot, resolutionSchemaVersion: r.resolution_schema_version, resolutionSnapshot: r.resolution_snapshot,
    });
  } catch (e) {
    if (e instanceof SealedResultError) throw new FaError("NOT_READY", e.message);
    throw e;
  }
}
