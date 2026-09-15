/**
 * First Assessment question bank bundle — schema_version 1.
 *
 * Published through the Phase 3 versioning workflow (question_bank_version.config) and pinned per
 * project at assessment_started. Logic (ids, field keys, types, option values, applicability) lives
 * outside `copy`; every localized string lives inside a `copy` object keyed by locale, so a
 * copy-only change is classified CONTENT and anything else LOGIC_SCHEMA by the database.
 */

export type Locale = "en" | "es";
export const BUNDLE_LOCALES: readonly Locale[] = ["en", "es"];

export type StageId = "project" | "business" | "operation" | "priorities" | "snapshot";

export type QuestionType =
  | "single_select"
  | "multi_select"
  | "text"
  | "short_text"
  | "timing"
  | "country_list"
  | "quantity"
  | "locale";

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
  kind: "questions" | "transition";
  question_ids: string[];
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
  links: { terms_url: string; privacy_policy_url: string | null };
  /** Interface copy for non-question screens and states (nested `copy` objects keyed by locale). */
  ui: Record<string, { copy: Record<Locale, Record<string, string>> }>;
  /** Transactional email templates (sent through the email adapter). */
  emails: Record<string, { copy: Record<Locale, { subject: string; body: string; cta: string }> }>;
}
