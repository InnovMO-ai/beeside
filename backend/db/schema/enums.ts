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

// Macroblock 4 — Precision Assessment persistence (Master Contract §4.2; canonical shapes per
// precision-block2-macroblock2-canonical-data-model-manifest-architecture-2026-10-02.md, through
// Freeze Patch #3, §33). One engine behaviorally parametrized by `scope` (§4 of that document) —
// `precision_instance` is the single stable identity both subtypes point at.
export const precisionInstanceScopeEnum = pgEnum("precision_instance_scope", ["project", "category"]);

// Precision Assessment (project scope), 4 states — Master Contract §1.8. Distinct type from
// category_status: mixing them in one enum/column would admit nonsense values on the wrong scope
// (Macroblock 2 §4, Option A rejected for exactly this reason).
export const paStatusEnum = pgEnum("pa_status", ["not_started", "in_progress", "ready_for_confirmation", "confirmed"]);

// Category Assessment (category scope), 5 states — Master Contract §1.8.
export const categoryStatusEnum = pgEnum("category_status", [
  "proposed",
  "not_selected",
  "confirmed",
  "in_progress",
  "completed",
]);

// category_assessment.category_origin — Macroblock 2 §7. Deliberately has no 'sherpa_recommended'
// value and never will (structural reinforcement of "Sherpa may advise, Sherpa may not author").
export const categoryOriginEnum = pgEnum("category_origin", ["pa_detected", "client_added"]);

// fact.source — Macroblock 2 §8. Never 'fa' (FA-inherited values are read live, never materialized
// into `fact`, §18) and never 'sherpa' (not in the enum — Sherpa has zero Precision-side write path).
export const factSourceEnum = pgEnum("fact_source", ["precision_assessment", "category"]);

// fact.provenance_stage — Macroblock 2 §8, amended by the pre-freeze contamination audit (§31 §5).
// Replaces a plain changed_by flag: 'client'/'system' stays trivially derivable (ai_extracted /
// system_derived -> system; the other three -> client) but the three-stage AI->confirm->correct
// chain is otherwise unrepresentable as individually-queryable rows.
export const factProvenanceStageEnum = pgEnum("fact_provenance_stage", [
  "ai_extracted",
  "client_answered",
  "client_confirmed",
  "client_corrected",
  "system_derived",
]);

// fact.answer_state — reuses FA's answer-state vocabulary (Master Contract §1.11 / Macroblock 2 §8),
// given its own enum here since FA's own schema never needed one (FA has no AI layer; every FA
// answer is client_answered by construction, so FA's `answer` table carries no equivalent column).
export const factAnswerStateEnum = pgEnum("fact_answer_state", [
  "NOT_ASKED",
  "UNKNOWN",
  "WITHHELD",
  "EXPLICIT_NO",
  "ZERO",
  "ANSWERED",
]);
