import { Db } from "../db/database";
import { recordJourneyEvent } from "../fa/services/analytics";
import { BundleStore } from "../fa/services/bundle-store";
import { FaError } from "../fa/services/errors";
import { enqueueEmail } from "../operations/email-outbox";

/**
 * Provider-agnostic subscription lifecycle (Technical Change Note v1.1 §G, Technical Architecture
 * v1.1 §4.2/§10). Any future payment provider is translated into these four events by a thin
 * adapter; no provider is selected here. None of the handlers writes assessment_state, answers,
 * findings, the Snapshot or the Internal Assessment — Premium can never reopen First Assessment.
 */

export const SUBSCRIPTION_EVENT_TYPES = ["premium_activated", "cancellation_requested", "subscription_period_ended", "premium_reactivated"] as const;
export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENT_TYPES)[number];

export interface SubscriptionEventInput {
  projectId: string;
  eventType: SubscriptionEventType;
  occurredAt: Date;
  /** Who delivered the event: a provider adapter name, "manual_admin_injection", "dev_simulated". */
  source: string;
  providerReference?: string | null;
  /** Unique per delivered event; a repeated delivery is acknowledged without being re-applied. */
  idempotencyKey?: string | null;
  /** Required when a subscription row is created (activation / reactivation). */
  periodStart?: Date | null;
  periodEnd?: Date | null;
}

export interface SubscriptionEventResult {
  eventId: string;
  duplicate: boolean;
  projectId: string;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  premiumAccessActive: boolean;
  premiumEverActivated: boolean;
  precisionState: string;
}

interface SubscriptionRow {
  subscription_id: string;
  status: "PREMIUM_ACTIVE" | "CANCELLATION_SCHEDULED" | "PREMIUM_INACTIVE";
}

export function isSubscriptionEventType(value: unknown): value is SubscriptionEventType {
  return typeof value === "string" && (SUBSCRIPTION_EVENT_TYPES as readonly string[]).includes(value);
}

async function currentState(tx: Db, projectId: string, eventId: string, duplicate: boolean): Promise<SubscriptionEventResult> {
  const { rows } = await tx.query<{
    subscription_id: string | null;
    status: string | null;
    premium_access_active: boolean | null;
    premium_ever_activated: boolean;
    precision_state: string;
  }>(
    `SELECT s.subscription_id, s.status, e.premium_access_active, p.premium_ever_activated, p.precision_state
       FROM project p
       LEFT JOIN LATERAL (SELECT subscription_id, status FROM subscription WHERE project_id = p.project_id ORDER BY created_at DESC, current_period_start DESC LIMIT 1) s ON true
       LEFT JOIN entitlement e ON e.project_id = p.project_id
      WHERE p.project_id = $1`,
    [projectId],
  );
  const row = rows[0];
  return {
    eventId,
    duplicate,
    projectId,
    subscriptionId: row?.subscription_id ?? null,
    subscriptionStatus: row?.status ?? null,
    premiumAccessActive: row?.premium_access_active === true,
    premiumEverActivated: row?.premium_ever_activated === true,
    precisionState: row?.precision_state ?? "NOT_STARTED",
  };
}

/** Processes one lifecycle event inside the caller's transaction. */
export async function processSubscriptionEvent(tx: Db, bundles: BundleStore, input: SubscriptionEventInput): Promise<SubscriptionEventResult> {
  if (!isSubscriptionEventType(input.eventType)) throw new FaError("INVALID_INPUT", "unknown subscription event type", { fields: ["event_type"] });
  if (Number.isNaN(input.occurredAt.getTime())) throw new FaError("INVALID_INPUT", "occurred_at must be a valid timestamp", { fields: ["occurred_at"] });

  // The project row lock is the same one the (Phase 11) retention job takes: activation always wins the race.
  const projects = await tx.query<{ assessment_state: string; premium_ever_activated: boolean; precision_state: string; created_by_person_id: string }>(
    "SELECT assessment_state, premium_ever_activated, precision_state, created_by_person_id FROM project WHERE project_id = $1 FOR UPDATE",
    [input.projectId],
  );
  const project = projects.rows[0];
  if (!project) throw new FaError("NOT_FOUND", "project not found");

  if (input.idempotencyKey) {
    const seen = await tx.query<{ event_id: string; project_id: string }>("SELECT event_id, project_id FROM subscription_event WHERE idempotency_key = $1", [input.idempotencyKey]);
    const previous = seen.rows[0];
    if (previous) {
      if (previous.project_id !== input.projectId) throw new FaError("INVALID_INPUT", "idempotency key already used for another project");
      return currentState(tx, input.projectId, previous.event_id, true);
    }
  }

  const latest = (
    await tx.query<SubscriptionRow>(
      "SELECT subscription_id, status FROM subscription WHERE project_id = $1 ORDER BY created_at DESC, current_period_start DESC LIMIT 1 FOR UPDATE",
      [input.projectId],
    )
  ).rows[0];
  const at = input.occurredAt;

  const insertEvent = async (subscriptionId: string | null) => {
    const { rows } = await tx.query<{ event_id: string }>(
      `INSERT INTO subscription_event (subscription_id, project_id, event_type, occurred_at, source, provider_reference, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING event_id`,
      [subscriptionId, input.projectId, input.eventType, at, input.source, input.providerReference ?? null, input.idempotencyKey ?? null],
    );
    return rows[0]?.event_id as string;
  };
  const createSubscription = async () => {
    if (!input.periodEnd || Number.isNaN(input.periodEnd.getTime())) throw new FaError("INVALID_INPUT", "current_period_end is required", { fields: ["current_period_end"] });
    let start = input.periodStart && !Number.isNaN(input.periodStart.getTime()) ? input.periodStart : at;
    let end = input.periodEnd;
    if (end.getTime() <= start.getTime()) throw new FaError("INVALID_INPUT", "current_period_end must be after current_period_start", { fields: ["current_period_end"] });
    // THE STACKING RULE: a paid term starts when the access the project already holds (free, sponsored, trial, ...) ends, so the
    // client keeps every free day and is never charged for a day already covered. With no other access this is a no-op.
    const held = (await tx.query<{ t: Date }>("SELECT entitlement_covered_until($1, $2) AS t", [input.projectId, at])).rows[0]?.t;
    if (held && held.getTime() > start.getTime()) {
      const length = end.getTime() - start.getTime();
      start = held;
      end = new Date(held.getTime() + length);
    }
    const { rows } = await tx.query<{ subscription_id: string }>(
      `INSERT INTO subscription (project_id, status, current_period_start, current_period_end, created_at, updated_at)
       VALUES ($1, 'PREMIUM_ACTIVE', $2, $3, $4, $4) RETURNING subscription_id`,
      [input.projectId, start, end, at],
    );
    return rows[0]?.subscription_id as string;
  };

  let eventId: string;
  switch (input.eventType) {
    case "premium_activated": {
      if (project.assessment_state !== "COMPLETED_LOCKED") throw new FaError("NOT_APPLICABLE", "Premium continues a completed First Assessment");
      if (project.premium_ever_activated || latest) throw new FaError("NOT_APPLICABLE", "this project already entered Premium; use premium_reactivated");
      const subscriptionId = await createSubscription();
      await tx.query(
        `UPDATE project SET premium_ever_activated = true, premium_first_activated_at = COALESCE(premium_first_activated_at, $2), updated_at = $2
          WHERE project_id = $1`,
        [input.projectId, at],
      );
      eventId = await insertEvent(subscriptionId);
      await enqueueEmail(tx, {
        dedupeKey: `premium_activation_confirmed:${input.projectId}:${eventId}`,
        projectId: input.projectId,
        personId: project.created_by_person_id,
        template: "premium_activation_confirmed",
        enqueuedBy: "premium.subscription_event",
        now: at,
      });
      // Premium entered. The legacy FA-3.0 handoff package (build + precision_handoff_package row + outbox event) is
      // SUPERSEDED by the Precision F5 pull model: Precision reads its context through its own ports and is gated by the
      // Core entitlement. precision_state remains the Core "Precision available" milestone (written once, as before).
      if (project.precision_state === "NOT_STARTED") {
        await tx.query("UPDATE project SET precision_state = 'STARTED', precision_started_at = $2, updated_at = $2 WHERE project_id = $1", [input.projectId, at]);
      }
      break;
    }
    case "cancellation_requested": {
      if (!latest || latest.status !== "PREMIUM_ACTIVE") throw new FaError("NOT_APPLICABLE", "there is no active Premium subscription to cancel");
      await tx.query(
        `UPDATE subscription SET status = 'CANCELLATION_SCHEDULED', cancel_at_period_end = true, cancellation_requested_at = $2, updated_at = $2
          WHERE subscription_id = $1`,
        [latest.subscription_id, at],
      );
      eventId = await insertEvent(latest.subscription_id);
      break;
    }
    case "subscription_period_ended": {
      if (!latest || latest.status === "PREMIUM_INACTIVE") throw new FaError("NOT_APPLICABLE", "there is no Premium period to end");
      await tx.query("UPDATE subscription SET status = 'PREMIUM_INACTIVE', ended_at = $2, updated_at = $2 WHERE subscription_id = $1", [latest.subscription_id, at]);
      eventId = await insertEvent(latest.subscription_id);
      break;
    }
    case "premium_reactivated": {
      if (!project.premium_ever_activated || !latest || latest.status !== "PREMIUM_INACTIVE") {
        throw new FaError("NOT_APPLICABLE", "only a project whose Premium access has ended can be reactivated");
      }
      // A new cycle on the same project_id: never reopens the ended row.
      const subscriptionId = await createSubscription();
      eventId = await insertEvent(subscriptionId);
      await enqueueEmail(tx, {
        dedupeKey: `premium_activation_confirmed:${input.projectId}:${eventId}`,
        projectId: input.projectId,
        personId: project.created_by_person_id,
        template: "premium_activation_confirmed",
        enqueuedBy: "premium.subscription_event",
        now: at,
      });
      break;
    }
  }

  await tx.query(
    `UPDATE premium_activation_request SET status = 'FULFILLED', fulfilled_at = $2, fulfilled_by_event_id = $3
      WHERE project_id = $1 AND status = 'REQUESTED' AND $4 IN ('premium_activated', 'premium_reactivated')`,
    [input.projectId, at, eventId, input.eventType],
  );
  const state = await currentState(tx, input.projectId, eventId, false);
  await tx.query("INSERT INTO outbox_event (project_id, event_type, payload, occurred_at) VALUES ($1, $2, $3::jsonb, $4)", [
    input.projectId,
    `subscription.${input.eventType}`,
    JSON.stringify({ event_id: eventId, project_id: input.projectId, subscription_id: state.subscriptionId, status: state.subscriptionStatus, premium_access_active: state.premiumAccessActive }),
    at,
  ]);
  await recordJourneyEvent(tx, { eventType: input.eventType, projectId: input.projectId, properties: { source: input.source, access_active: state.premiumAccessActive } });
  return state;
}
