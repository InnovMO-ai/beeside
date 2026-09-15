import { Db } from "../db/database";
import { describeError } from "../security/redact";
import { OPERATION_HUB_EVENTS } from "./operation-hub";
import { SMARTSUITE_EVENTS } from "./smartsuite";
import { loadSourceRecord } from "./source-record";
import { AdapterOutcome, DESTINATIONS, Destination, IntegrationError, IntegrationSet, OutboundEvent } from "./types";

/**
 * Integration outbox relay (Phase 12). Business transactions write `outbox_event` rows (ids only).
 * The relay fans each event out to one `integration_delivery` per routed destination (idempotent by
 * event id × destination) and marks the event relayed; deliveries for a destination whose adapter is
 * not enabled simply wait. Delivery claims rows under a lease with SKIP LOCKED, retries with bounded
 * backoff and dead-letters permanent failures — the same guarantees as the email outbox.
 */

const LEASE_SECONDS = 300;
const BACKOFF_SECONDS = [60, 300, 900, 3600, 10_800, 21_600, 43_200];

export const DESTINATION_ROUTES: Record<Destination, ReadonlySet<string>> = {
  smartsuite: new Set(SMARTSUITE_EVENTS),
  operation_hub: OPERATION_HUB_EVENTS,
};

export function integrationBackoffSeconds(attempt: number): number {
  return BACKOFF_SECONDS[Math.min(Math.max(attempt, 1), BACKOFF_SECONDS.length) - 1] ?? 43_200;
}

export async function relayOutboxEvents(db: Db, now: Date, limit = 200): Promise<{ events: number; deliveries: number }> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ outbox_event_id: string; event_id: string; project_id: string | null; event_type: string }>(
      `SELECT outbox_event_id, event_id, project_id, event_type FROM outbox_event
        WHERE relayed_at IS NULL ORDER BY outbox_event_id LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    let deliveries = 0;
    for (const event of rows) {
      for (const destination of DESTINATIONS) {
        if (!DESTINATION_ROUTES[destination].has(event.event_type)) continue;
        const inserted = await tx.query(
          `INSERT INTO integration_delivery (outbox_event_id, event_id, destination, event_type, project_id, next_attempt_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6, $6) ON CONFLICT (event_id, destination) DO NOTHING`,
          [event.outbox_event_id, event.event_id, destination, event.event_type, event.project_id, now],
        );
        deliveries += inserted.rowCount ?? 0;
      }
    }
    if (rows.length > 0) {
      await tx.query("UPDATE outbox_event SET relayed_at = $2 WHERE outbox_event_id = ANY($1::bigint[])", [rows.map((r) => r.outbox_event_id), now]);
    }
    return { events: rows.length, deliveries };
  });
}

export interface IntegrationDeliveryStats {
  claimed: number;
  delivered: number;
  skipped: number;
  failed: number;
  dead: number;
}

interface ClaimedDelivery {
  delivery_id: string;
  outbox_event_id: string;
  destination: Destination;
  event_type: string;
  project_id: string | null;
  attempts: number;
  max_attempts: number;
}

export async function deliverDueIntegrations(db: Db, integrations: IntegrationSet | undefined, now: Date, limit = 25): Promise<IntegrationDeliveryStats> {
  const stats: IntegrationDeliveryStats = { claimed: 0, delivered: 0, skipped: 0, failed: 0, dead: 0 };
  const enabled = DESTINATIONS.filter((d) => integrations?.adapters[d]);
  if (enabled.length === 0) return stats;

  const claimed = await db.transaction(async (tx) => {
    const exhausted = await tx.query(
      `UPDATE integration_delivery SET status = 'DEAD', lease_until = NULL, finished_at = $1, updated_at = $1,
              last_error = COALESCE(last_error, 'delivery lease expired after the final attempt')
        WHERE status = 'SENDING' AND lease_until <= $1 AND attempts >= max_attempts AND destination = ANY($2::text[])`,
      [now, enabled],
    );
    stats.dead += exhausted.rowCount ?? 0;
    const { rows } = await tx.query<ClaimedDelivery>(
      `WITH due AS (
         SELECT delivery_id FROM integration_delivery
          WHERE destination = ANY($4::text[])
            AND ((status IN ('PENDING', 'FAILED') AND next_attempt_at <= $1) OR (status = 'SENDING' AND lease_until <= $1))
            AND attempts < max_attempts
          ORDER BY next_attempt_at, created_at
          LIMIT $2
          FOR UPDATE SKIP LOCKED)
       UPDATE integration_delivery d
          SET status = 'SENDING', attempts = d.attempts + 1, lease_until = $1::timestamptz + make_interval(secs => $3), updated_at = $1
         FROM due WHERE d.delivery_id = due.delivery_id
       RETURNING d.delivery_id, d.outbox_event_id, d.destination, d.event_type, d.project_id, d.attempts, d.max_attempts`,
      [now, limit, LEASE_SECONDS, enabled],
    );
    return rows;
  });
  stats.claimed = claimed.length;

  for (const delivery of claimed) {
    const adapter = integrations?.adapters[delivery.destination];
    if (!adapter) continue;
    try {
      const outcome = await attempt(db, delivery, adapter);
      await db.transaction(async (tx) => {
        const delivered = outcome.kind !== "skipped";
        const externalReference = outcome.kind === "upserted" ? outcome.externalId : outcome.kind === "delivered" ? outcome.externalReference : null;
        await tx.query(
          `UPDATE integration_delivery
              SET status = $2, adapter_name = $3, external_reference = $4, skip_reason = $5, last_error = NULL, lease_until = NULL,
                  delivered_at = CASE WHEN $2 = 'DELIVERED' THEN $6::timestamptz ELSE NULL END, finished_at = $6, updated_at = $6
            WHERE delivery_id = $1 AND status = 'SENDING'`,
          [delivery.delivery_id, delivered ? "DELIVERED" : "SKIPPED", adapter.name, externalReference, outcome.kind === "skipped" ? outcome.reason : null, now],
        );
        if (outcome.kind === "upserted" && delivery.project_id) {
          await tx.query(
            `INSERT INTO integration_external_ref (destination, project_id, external_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)
             ON CONFLICT (destination, project_id) DO UPDATE SET external_id = EXCLUDED.external_id, updated_at = EXCLUDED.updated_at`,
            [delivery.destination, delivery.project_id, outcome.externalId, now],
          );
        }
        if (outcome.kind === "deleted" && delivery.project_id) {
          await tx.query("DELETE FROM integration_external_ref WHERE destination = $1 AND project_id = $2", [delivery.destination, delivery.project_id]);
        }
      });
      if (outcome.kind === "skipped") stats.skipped += 1;
      else stats.delivered += 1;
    } catch (error) {
      const retryable = !(error instanceof IntegrationError) || error.retryable;
      const final = !retryable || delivery.attempts >= delivery.max_attempts;
      await db.query(
        `UPDATE integration_delivery
            SET status = $2, adapter_name = $3, last_error = $4, lease_until = NULL, updated_at = $5,
                next_attempt_at = $5::timestamptz + make_interval(secs => $6),
                finished_at = CASE WHEN $2 = 'DEAD' THEN $5::timestamptz ELSE NULL END
          WHERE delivery_id = $1 AND status = 'SENDING'`,
        [delivery.delivery_id, final ? "DEAD" : "FAILED", adapter.name, describeError(error).slice(0, 300), now, integrationBackoffSeconds(delivery.attempts)],
      );
      if (final) stats.dead += 1;
      else stats.failed += 1;
    }
  }
  return stats;
}

async function attempt(db: Db, delivery: ClaimedDelivery, adapter: NonNullable<IntegrationSet["adapters"][Destination]>): Promise<AdapterOutcome> {
  const { rows } = await db.query<{ event_id: string; event_type: string; project_id: string | null; occurred_at: Date; payload: Record<string, unknown> }>(
    "SELECT event_id, event_type, project_id, occurred_at, payload FROM outbox_event WHERE outbox_event_id = $1",
    [delivery.outbox_event_id],
  );
  const row = rows[0];
  if (!row) return { kind: "skipped", reason: "event_missing" };
  if (!adapter.routes(row.event_type)) return { kind: "skipped", reason: "not_routed_by_configuration" };
  const event: OutboundEvent = { eventId: row.event_id, eventType: row.event_type, projectId: row.project_id, occurredAt: row.occurred_at, payload: row.payload ?? {} };
  const record = await loadSourceRecord(db, event);
  if (!record && event.eventType !== "retention.project_purged") return { kind: "skipped", reason: "project_unavailable" };
  const ref = event.projectId
    ? await db.query<{ external_id: string }>("SELECT external_id FROM integration_external_ref WHERE destination = $1 AND project_id = $2", [delivery.destination, event.projectId])
    : { rows: [] };
  return adapter.deliver({ event, record, externalId: ref.rows[0]?.external_id ?? null });
}

/** ADMIN retry of a failed or dead-lettered delivery: a fresh attempt budget, due immediately. */
export async function retryIntegrationDelivery(tx: Db, deliveryId: string, now: Date): Promise<boolean> {
  const { rowCount } = await tx.query(
    `UPDATE integration_delivery SET status = 'PENDING', attempts = 0, next_attempt_at = $2, lease_until = NULL, finished_at = NULL, updated_at = $2
      WHERE delivery_id = $1 AND status IN ('FAILED', 'DEAD')`,
    [deliveryId, now],
  );
  return (rowCount ?? 0) > 0;
}

const STATUSES = new Set(["PENDING", "SENDING", "DELIVERED", "FAILED", "DEAD", "SKIPPED"]);

export async function listIntegrationDeliveries(db: Db, filter: { status: string | null; destination: string | null }) {
  const status = filter.status && STATUSES.has(filter.status) ? filter.status : null;
  const destination = filter.destination && (DESTINATIONS as readonly string[]).includes(filter.destination) ? filter.destination : null;
  const { rows } = await db.query(
    `SELECT delivery_id, destination, event_type, project_id, status, attempts, max_attempts, adapter_name, external_reference, skip_reason,
            last_error, next_attempt_at, created_at, delivered_at, finished_at
       FROM integration_delivery
      WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR destination = $2)
      ORDER BY created_at DESC LIMIT 100`,
    [status, destination],
  );
  return rows;
}
