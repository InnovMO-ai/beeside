/**
 * Project-level Precision state: the single Understanding instance (`precision_assessment`), its Service Map snapshots,
 * the activity clock and the project's `precision_state` flag.
 */
import type { Db } from "../../db/database";
import { FaError } from "../../fa/services/errors";
import { createPrecisionAssessment, movePaLifecycle, type PaStatus } from "../repository";
import type { Locale } from "../api/dto";
import { emitEvent } from "./events";

type Queryable = Pick<Db, "query">;

export interface PaState {
  instanceId: string;
  status: PaStatus;
  manifestVersion: string;
  snapshotId: string | null;
  confirmedAt: Date | null;
  lastActivityAt: Date;
}

export async function loadPaState(db: Queryable, projectId: string): Promise<PaState | null> {
  const { rows } = await db.query<{ instance_id: string; lifecycle_status: PaStatus; manifest_version: string; service_map_snapshot_id: string | null; confirmed_at: Date | null; last_client_activity_at: Date }>(
    `SELECT pa.instance_id, pa.lifecycle_status, pa.manifest_version, pa.service_map_snapshot_id, pa.confirmed_at, pi.last_client_activity_at
       FROM precision_assessment pa JOIN precision_instance pi ON pi.id = pa.instance_id
      WHERE pi.project_id = $1 AND pi.scope = 'project'`,
    [projectId],
  );
  const r = rows[0];
  return r ? { instanceId: r.instance_id, status: r.lifecycle_status, manifestVersion: r.manifest_version, snapshotId: r.service_map_snapshot_id, confirmedAt: r.confirmed_at, lastActivityAt: r.last_client_activity_at } : null;
}

/** The project's Understanding instance, created on first use (one per project; a racing creator reuses the winner's row). */
export async function ensurePaInstance(db: Db, projectId: string): Promise<PaState> {
  const existing = await loadPaState(db, projectId);
  if (existing) return existing;
  try {
    await createPrecisionAssessment(db, projectId);
  } catch (error) {
    if ((error as { code?: string }).code !== "23505") {
      if (error instanceof FaError && error.code === "NOT_APPLICABLE") throw error; // no published project manifest: a deployment problem
      throw error;
    }
  }
  const created = await loadPaState(db, projectId);
  if (!created) throw new Error("precision assessment could not be created");
  return created;
}

export async function movePa(db: Db, instanceId: string, to: PaStatus): Promise<void> {
  await movePaLifecycle(db, instanceId, to);
}

export interface SnapshotRow { id: string; version: number; confirmedAt: Date; content: Record<string, unknown> }

export async function latestSnapshot(db: Queryable, paInstanceId: string): Promise<SnapshotRow | null> {
  const { rows } = await db.query<{ id: string; version: number; confirmed_at: Date; content: Record<string, unknown> }>(
    "SELECT id, version, confirmed_at, content FROM service_map_snapshot WHERE precision_instance_id = $1 ORDER BY version DESC LIMIT 1",
    [paInstanceId],
  );
  const r = rows[0];
  return r ? { id: r.id, version: r.version, confirmedAt: r.confirmed_at, content: r.content } : null;
}

export async function snapshotCount(db: Queryable, paInstanceId: string): Promise<number> {
  return Number((await db.query<{ n: string }>("SELECT count(*) AS n FROM service_map_snapshot WHERE precision_instance_id = $1", [paInstanceId])).rows[0]?.n ?? 0);
}

/** Marks activity on an instance and returns the previous activity time. */
export async function touchActivity(db: Queryable, instanceId: string, now: Date): Promise<Date | null> {
  const prior = (await db.query<{ t: Date }>("SELECT last_client_activity_at AS t FROM precision_instance WHERE id = $1", [instanceId])).rows[0]?.t ?? null;
  await db.query("UPDATE precision_instance SET last_client_activity_at = $2 WHERE id = $1", [instanceId, now]);
  return prior;
}

/**
 * Add a Service has no assessment of its own, but its turns need a scope. It owns one dedicated `scope = category`
 * instance WITHOUT a `category_assessment` row (so it never appears as a workstream), found by that absence.
 */
export async function ensureAddServiceInstance(db: Db, projectId: string): Promise<string> {
  const find = async (q: Queryable): Promise<string | undefined> =>
    (await q.query<{ id: string }>(
      `SELECT pi.id FROM precision_instance pi
        WHERE pi.project_id = $1 AND pi.scope = 'category' AND NOT EXISTS (SELECT 1 FROM category_assessment ca WHERE ca.instance_id = pi.id)
        ORDER BY pi.created_at, pi.id LIMIT 1`,
      [projectId],
    )).rows[0]?.id;
  const existing = await find(db);
  if (existing) return existing;
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 7))", [`precision_add_service_instance:${projectId}`]);
    const again = await find(tx);
    if (again) return again;
    return (await tx.query<{ id: string }>("INSERT INTO precision_instance (project_id, scope) VALUES ($1, 'category') RETURNING id", [projectId])).rows[0]!.id;
  });
}

/** First entry: `project.precision_state` NOT_STARTED -> STARTED (once), with the `precision_started` event. */
export async function ensurePrecisionStarted(db: Db, projectId: string, locale: Locale, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const { rowCount } = await tx.query("UPDATE project SET precision_state = 'STARTED', precision_started_at = $2 WHERE project_id = $1 AND precision_state = 'NOT_STARTED' AND premium_ever_activated", [projectId, now]);
    if ((rowCount ?? 0) > 0) await emitEvent(tx, { name: "precision_started", eventKey: `precision_started:${projectId}`, projectId, locale });
  });
}

/** Display name of the company, for document titles. Null when unavailable. */
export async function companyName(db: Queryable, projectId: string): Promise<string | null> {
  const r = (await db.query<{ name: string }>("SELECT c.name FROM project p JOIN company c ON c.company_id = p.company_id WHERE p.project_id = $1", [projectId])).rows[0];
  return r?.name ?? null;
}
