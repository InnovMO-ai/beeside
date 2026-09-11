import { pgEnum } from "drizzle-orm/pg-core";

export const assessmentStateEnum = pgEnum("assessment_state", [
  "DRAFT",
  "IN_PROGRESS",
  "COMPLETED_LOCKED",
  "EXPIRED",
  "DELETED",
]);

export const trustStateEnum = pgEnum("trust_state", ["NORMAL", "REVIEW", "BLOCK"]);

export const precisionStateEnum = pgEnum("precision_state", ["NOT_STARTED", "STARTED"]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "PREMIUM_ACTIVE",
  "CANCELLATION_SCHEDULED",
  "PREMIUM_INACTIVE",
]);

export const subscriptionEventTypeEnum = pgEnum("subscription_event_type", [
  "premium_activated",
  "cancellation_requested",
  "subscription_period_ended",
  "premium_reactivated",
]);

export const findingStatusEnum = pgEnum("finding_status", [
  "DEFINED",
  "NEEDS_ATTENTION",
  "CRITICAL_GAP",
  "NOT_APPLICABLE",
]);

export const priorityAlignmentStatusEnum = pgEnum("priority_alignment_status", [
  "ALIGNED",
  "TENSION_DETECTED",
]);

export const adminRoleEnum = pgEnum("admin_role", ["ADMIN", "SUPERVISOR"]);

export const signalStrengthEnum = pgEnum("signal_strength", [
  "STRONG",
  "SUPPORTING",
  "POSSIBLE",
  "NO_SIGNAL",
]);

// Who performed a change that must be audited: a client-side person, a beeside-internal
// admin_user (Admin/Supervisor acting from Precision or Operation Hub), or — reserved for
// a future automated change — the system itself.
export const actorTypeEnum = pgEnum("actor_type", ["PERSON", "ADMIN_USER", "SYSTEM"]);
