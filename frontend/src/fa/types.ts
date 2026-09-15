// Client-side view of the First Assessment question bank bundle (schema_version 1) and API payloads.
// The bundle is served by the backend from the versioned registry; copy is never hard-coded here.

export type Locale = "en" | "es";
export type StageId = "project" | "business" | "operation" | "priorities" | "snapshot";
export type QuestionType = "single_select" | "multi_select" | "text" | "short_text" | "timing" | "country_list" | "quantity" | "locale";

export interface OptionDef {
  value: string;
  copy: Record<Locale, string>;
}

export interface QuestionDef {
  id: string;
  field_key: string;
  type: QuestionType;
  required: boolean;
  options?: OptionDef[];
  options_from?: { field: string; exclude?: string[] };
  exclusive_values?: string[];
  units?: OptionDef[];
  max_length?: number;
  copy: Record<Locale, { title: string; helper?: string; placeholder?: string }>;
}

export interface StepDef {
  id: string;
  stage: StageId;
  kind: "questions" | "transition";
  question_ids: string[];
  copy: Record<Locale, { title: string; intro?: string }>;
}

export interface Bundle {
  schema_version: 1;
  locales: Locale[];
  stages: Array<{ id: StageId; copy: Record<Locale, { label: string }> }>;
  steps: StepDef[];
  questions: QuestionDef[];
  identity: { personal_email_domains: string[] };
  links: { terms_url: string; privacy_policy_url: string | null };
  ui: Record<string, { copy: Record<Locale, Record<string, string>> }>;
}

export interface SessionView {
  questionBankVersion: string;
  status: "DRAFT" | "IN_PROGRESS" | "COMPLETED_LOCKED" | "EXPIRED" | "DELETED";
  currentStepId: string | null;
  lastCompletedStepId: string | null;
  steps: Array<{ id: string; applicable: boolean; confirmed: boolean; missingRequired: string[]; questionIds: string[] }>;
  answers: Record<string, unknown>;
  dynamicOptions: Record<string, string[]>;
  finishLaterAvailable: boolean;
  anotherProjectInMind: string | null;
  accessUntil: string | null;
  interfaceLanguage: string;
}

export interface LinkChoices {
  companyName: string;
  interfaceLanguage: string;
  canContinue: boolean;
  canRecover: boolean;
  closed: boolean;
  completed: boolean;
  anotherProjectInMind: boolean;
  accessUntil: string | null;
}

export type ExtensionReason = "missing_information" | "project_not_structured" | "unsure_market_timing" | "something_else";
