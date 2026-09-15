/**
 * Canonical field-key registry and shared contracts.
 *
 * `FA_FIELDS` (./fields) is the single source of truth for First Assessment field keys; the
 * database `field_key_registry` is a synchronized representation of it. Backend, the question
 * bank and (later) the rules engine import keys from this ONE package rather than redeclaring
 * them — the mechanism that prevents schema drift (Build Plan v1.1 FINAL, Phase 2 risk).
 */

export const CANONICAL_FIELDS_PACKAGE_VERSION = "1.0.0-fa-core" as const;

export * from "./fields";
export * from "./precision-context";

/**
 * `assessment_state` — deliberately fixed to the five-value v1.1 set.
 * `PRECISION_STARTED` is intentionally NOT a member (Technical Change Note
 * v1.1; Technical Architecture v1.1 FINAL §1 principle 7). Phase 2 enforces
 * this same set at the database constraint level, not only here.
 */
export const ASSESSMENT_STATES = [
  "DRAFT",
  "IN_PROGRESS",
  "COMPLETED_LOCKED",
  "EXPIRED",
  "DELETED",
] as const;
export type AssessmentState = (typeof ASSESSMENT_STATES)[number];

/** Subscription lifecycle — independent of `AssessmentState` (Technical Change Note v1.1). */
export const SUBSCRIPTION_STATUSES = [
  "PREMIUM_ACTIVE",
  "CANCELLATION_SCHEDULED",
  "PREMIUM_INACTIVE",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** The four provider-agnostic subscription events (Technical Change Note v1.1 §12; Build Plan Phase 9). */
export const SUBSCRIPTION_EVENT_TYPES = [
  "premium_activated",
  "cancellation_requested",
  "subscription_period_ended",
  "premium_reactivated",
] as const;
export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENT_TYPES)[number];
