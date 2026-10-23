import type { Db } from "../db/database";

/**
 * Read model for Admin: the CURRENT state of every Precision delivery to Operation Hub (latest ledger row per delivery key).
 * Ids, status, attempt and the internal error code only: never the payload, the platform reference or any client text.
 */
export const DELIVERY_STATUSES = ["queued", "delivered", "failed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export async function listPrecisionDeliveries(db: Pick<Db, "query">, status: DeliveryStatus | null, limit = 200) {
  const { rows } = await db.query(
    `SELECT project_id, kind, status, attempt, artifact_version, error_code, created_at
       FROM oh_delivery_current
      WHERE ($1::text IS NULL OR status = $1)
      ORDER BY created_at DESC
      LIMIT $2`,
    [status, Math.min(Math.max(limit, 1), 500)],
  );
  const counts = await db.query<{ status: string; n: string }>("SELECT status, count(*) AS n FROM oh_delivery_current GROUP BY status");
  return { deliveries: rows, counts: Object.fromEntries(counts.rows.map((r) => [r.status, Number(r.n)])) };
}
