/**
 * Category references shared by every domain service (and by the CRP/preview/send router): the API identifies a category by
 * its `category_assessment.instance_id` (an opaque UUID) — never by category key, so `new:<slug>` keys and the manifest
 * keys never reach a client. All lookups are project-scoped.
 */
import type { Db } from "../../db/database";
import type { CategoryStatus as DbCategoryStatus } from "../repository";
import type { CategoryStatus, SendStateDto } from "../api/dto";
import type { CategoryEvaluation } from "../manifest/types";

export interface CategoryRef {
  instanceId: string;
  projectId: string;
  /** Instance key: a catalog category, strategic_advisory, ecosystem_development or `new:<slug>`. Internal. */
  categoryKey: string;
  /** Manifest key actually used (`_generic` for `new:<slug>`). Internal. */
  manifestCategoryKey: string;
  /** Manifest version pinned on the assessment. Internal. */
  manifestVersion: string;
  lifecycle: DbCategoryStatus;
  origin: "pa_detected" | "client_added";
  currentPackId: string | null;
  createdAt: Date;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

interface Row {
  instance_id: string; project_id: string; category_key: string; manifest_category_key: string; manifest_version: string;
  lifecycle_status: DbCategoryStatus; category_origin: "pa_detected" | "client_added"; current_pack_id: string | null; created_at: Date;
}
const COLUMNS = "instance_id, project_id, category_key, manifest_category_key, manifest_version, lifecycle_status, category_origin, current_pack_id, created_at";

const toRef = (r: Row): CategoryRef => ({
  instanceId: r.instance_id, projectId: r.project_id, categoryKey: r.category_key, manifestCategoryKey: r.manifest_category_key,
  manifestVersion: r.manifest_version, lifecycle: r.lifecycle_status, origin: r.category_origin, currentPackId: r.current_pack_id, createdAt: r.created_at,
});

/** The category assessment `id` of this project, or null (malformed id, other project's id, not selected). */
export async function loadCategoryRef(db: Pick<Db, "query">, projectId: string, id: string): Promise<CategoryRef | null> {
  if (!isUuid(id)) return null;
  const { rows } = await db.query<Row>(`SELECT ${COLUMNS} FROM category_assessment WHERE instance_id = $1 AND project_id = $2 AND lifecycle_status <> 'not_selected'`, [id, projectId]);
  return rows[0] ? toRef(rows[0]) : null;
}

/** Every category assessment of the project in creation order (all lifecycles except not_selected). */
export async function listCategoryRefs(db: Pick<Db, "query">, projectId: string): Promise<CategoryRef[]> {
  const { rows } = await db.query<Row>(`SELECT ${COLUMNS} FROM category_assessment WHERE project_id = $1 AND lifecycle_status <> 'not_selected' ORDER BY created_at, instance_id`, [projectId]);
  return rows.map(toRef);
}

/** Send state of one pack from the append-only ledger (the pack's CRP delivery). */
export async function packSendState(db: Pick<Db, "query">, packId: string | null): Promise<SendStateDto> {
  if (!packId) return "not_sent";
  const { rows } = await db.query<{ status: string }>("SELECT status FROM oh_delivery_current WHERE pack_id = $1 AND kind = 'crp' ORDER BY seq DESC", [packId]);
  if (rows.some((r) => r.status === "delivered")) return "sent";
  const last = rows[0]?.status;
  return last === "queued" ? "sending" : last === "failed" ? "failed" : "not_sent";
}

/**
 * The client-visible status of a category. `confirmed` is the CRP being confirmed (lifecycle completed); a category whose
 * workstream has not started is `not_started` (lifecycle confirmed). `ready_for_review` is `in_progress ∧ ready`.
 */
export function categoryUiStatus(lifecycle: DbCategoryStatus, evaluation: Pick<CategoryEvaluation, "ready">, sendState: SendStateDto): CategoryStatus {
  switch (lifecycle) {
    case "in_progress":
      return evaluation.ready ? "ready_for_review" : "in_progress";
    case "completed":
      return sendState === "sent" ? "sent" : "confirmed";
    default:
      return "not_started";
  }
}
