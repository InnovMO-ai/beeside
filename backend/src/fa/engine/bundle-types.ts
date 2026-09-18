/**
 * First Assessment question bank bundle — schema_version 1.
 *
 * Published through the Phase 3 versioning workflow (question_bank_version.config) and pinned per
 * project at assessment_started. Logic (ids, field keys, types, option values, applicability) lives
 * outside `copy`; every localized string lives inside a `copy` object keyed by locale, so a
 * copy-only change is classified CONTENT and anything else LOGIC_SCHEMA by the database.
 *
 * Level 2 MVP addendum (fa-qb-2.0.0): adds `tag_list` / `needs_map` / `counterparty_list` question
 * types, an optional `StepDef.layout` ("grouped" renders every applicable question of the step
 * together, as one composition, instead of one question per screen) and a `"review"` step kind (a
 * no-new-questions recap step). Every addition is optional / additive: a bundle that never sets
 * `layout` or uses `kind: "review"` behaves byte-identically to fa-qb-1.1.0.
 */

export type Locale = "en" | "es";
export const BUNDLE_LOCALES: readonly Locale[] = ["en", "es"];

// fa-qb-1.1.0's original five ("project" through "snapshot") plus fa-qb-2.0.0's seven Level 2 MVP
// compositions (owner alignment pass, 2026-09-18): the visible progress structure for Level 2 is
// meant to reflect the approved compositions themselves (Your Company, Your Project, ...) rather
// than the legacy five-stage grouping, so each Level 2 step gets its own dedicated stage id (a 1:1
// mapping — see question-bank-v2.ts's STAGES_V2). No `Record<StageId, ...>` exhaustive mapping
// exists anywhere in this codebase (verified), so widening this union is additive and safe: nothing
// that switches on StageId needs a new case, and fa-qb-1.1.0's own five ids and their behavior are
// completely unchanged.
export type StageId =
  | "project"
  | "business"
  | "operation"
  | "priorities"
  | "snapshot"
  | "l2_company"
  | "l2_your_project"
  | "l2_plan_definition"
  | "l2_priorities"
  | "l2_needs_landscape"
  | "l2_provider_resources"
  | "l2_review";

export type QuestionType =
  | "single_select"
  | "multi_select"
  | "text"
  | "short_text"
  | "timing"
  | "country_list"
  | "quantity"
  | "locale"
  // Level 2 MVP additions.
  | "tag_list"
  | "needs_map"
  | "counterparty_list";

/** Deterministic applicability over earlier DECLARED_BY_USER answers only. */
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { field: string; op: "eq" | "neq"; value: string }
  | { field: string; op: "in" | "not_in"; values: string[] }
  | { field: string; op: "includes_any"; values: string[] }
  | { field: string; op: "answered" }
  | { field: string; op: "selected_count_gte"; value: number; exclude?: string[] };

export type LocalizedString = Record<Locale, string>;

export interface OptionDef {
  value: string;
  copy: LocalizedString;
}

export interface QuestionCopy {
  title: string;
  helper?: string;
  placeholder?: string;
  optional_label?: string;
}

export interface QuestionDef {
  id: string;
  field_key: string;
  type: QuestionType;
  required: boolean;
  options?: OptionDef[];
  /** Options are the current selections of another (earlier) multi-select, minus `exclude`. */
  options_from?: { field: string; exclude?: string[] };
  exclusive_values?: string[];
  /** Quantity units (value + localized label). */
  units?: OptionDef[];
  max_length?: number;
  /** multi_select only: caps how many values may be selected together (e.g. "pick your top 3"). */
  max_select?: number;
  /** country_list only: caps how many countries may be selected (default 30). */
  max_count?: number;
  /** tag_list / counterparty_list: caps entry count / entry (name) length (defaults 20 / 200). */
  max_tags?: number;
  max_tag_length?: number;
  applies_when?: Condition;
  copy: Record<Locale, QuestionCopy>;
}

export interface StepCopy {
  title: string;
  intro?: string;
}

export interface StepDef {
  id: string;
  stage: StageId;
  kind: "questions" | "transition" | "review";
  question_ids: string[];
  /** "grouped" renders every applicable question of the step together as one composition (Level 2
   *  MVP). Undefined preserves the existing one-question-per-screen rendering exactly. */
  layout?: "grouped";
  applies_when?: Condition;
  copy: Record<Locale, StepCopy>;
}

export interface StageDef {
  id: StageId;
  copy: Record<Locale, { label: string }>;
}

export interface QuestionBankBundle {
  schema_version: 1;
  product: "first_assessment";
  locales: Locale[];
  variables: string[];
  stages: StageDef[];
  steps: StepDef[];
  questions: QuestionDef[];
  identity: { personal_email_domains: string[] };
  /**
   * Admin-editable links (Functional Specification v1 §10). The Privacy Policy URL stays null until
   * the definitive document exists — it is never invented.
   */
  links: { terms_url: string; privacy_policy_url: string | null; preview_room_url?: string; premium_terms_url?: string };
  /** Interface copy for non-question screens and states (nested `copy` objects keyed by locale). */
  ui: Record<string, { copy: Record<Locale, Record<string, string>> }>;
  /**
   * Transactional email templates (sent through the email outbox). `secondary_cta` is optional.
   * `active` is optional and defaults to true (absent in every bundle published before Communications
   * Admin existed) — false means the outbox cancels the send instead of delivering it (see `prepare`
   * in operations/email-outbox.ts). Governed content, edited through Configuration's draft/preview/
   * review/publish flow — directly, or through the scoped Communications Admin surface that patches
   * only this field and `copy` (see admin/communications-service.ts).
   */
  emails: Record<string, { active?: boolean; copy: Record<Locale, { subject: string; body: string; cta: string; secondary_cta?: string }> }>;
  /**
   * Access / communication / temporary-retention calendar (see access-lifecycle.ts). Optional:
   * bundles published before it existed run under LIFECYCLE_POLICY_V1.
   */
  lifecycle?: import("../services/access-lifecycle").LifecyclePolicyConfig;
  /** Post-Snapshot Premium transition copy (optional; bundles without it use premium-content-1.0.0). */
  premium?: { copy: Record<Locale, import("../../premium/content").PremiumCopy> };
}
