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

// Phase 3 — versioned configuration (Technical Architecture v1.1 §5, Functional Specification v1 §10).
export const configRegistryEnum = pgEnum("config_registry", [
  "QUESTION_BANK",
  "RULES_ENGINE",
  "SNAPSHOT_TEMPLATE",
]);

// Draft → Preview → Publish. PREVIEW freezes the bundle for review; PUBLISHED is immutable.
export const configVersionStatusEnum = pgEnum("config_version_status", ["DRAFT", "PREVIEW", "PUBLISHED"]);

// Derived by the database at preview time, never declared by the author: CONTENT only when the
// bundle differs from the current published version exclusively inside `copy` subtrees.
export const configChangeKindEnum = pgEnum("config_change_kind", ["CONTENT", "LOGIC_SCHEMA"]);

export const configReviewDecisionEnum = pgEnum("config_review_decision", ["APPROVED", "REJECTED"]);

export const configVersionEventTypeEnum = pgEnum("config_version_event_type", [
  "DRAFT_CREATED",
  "DRAFT_UPDATED",
  "SUBMITTED_FOR_PREVIEW",
  "RETURNED_TO_DRAFT",
  "REVIEW_RECORDED",
  "PUBLISHED",
  "CURRENT_REPOINTED",
]);
