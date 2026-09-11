/**
 * Canonical field-key registry — placeholder scaffold.
 *
 * This package is intentionally near-empty in Phase 1. Its real content is
 * the full field list from Functional Specification v1 Appendix A / §2.1,
 * authored in Phase 6 as the question bank is built, and the
 * `assessment_state` / subscription-entitlement enums authored in Phase 2 as
 * the schema is built. Phase 1's job is only to prove that backend, frontend,
 * and (later) the rules engine import field keys from ONE shared package
 * rather than redeclaring them locally — the mechanism that prevents schema
 * drift called out as a risk in Build Plan v1.1 FINAL, Phase 2.
 */

export const CANONICAL_FIELDS_PACKAGE_VERSION = "0.1.0-phase1-skeleton" as const;

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
