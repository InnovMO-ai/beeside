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
  /** A completed project is routed by its Premium history (never / active / lapsed). */
  premium: { everActivated: boolean; accessActive: boolean };
}

/** Premium transition copy (premium-content-1.0.0), served by the backend; no price is ever shown. */
export interface PremiumCopy {
  transition: { eyebrow: string; headline: string; body: string; continue_cta: string; explore_cta: string; explore_helper: string; new_tab: string };
  consideration: {
    eyebrow: string;
    title: string;
    intro: string;
    pillars: Array<{ key: string; title: string; body: string }>;
    outcomes_title: string;
    outcomes: string[];
    candidate_line: string;
    next_cta: string;
    back: string;
  };
  activation: { title: string; points: string[]; terms_prefix: string; terms_label: string; terms_required: string; activate_cta: string; reactivate_cta: string; back: string; error: string };
  result: { pending_title: string; pending_body: string; active_title: string; active_body: string };
  status: { active_title: string; active_body: string; scheduled_body: string; lapsed_title: string; lapsed_body: string; pending_title: string; pending_body: string };
}

export interface PremiumContent {
  version: string;
  previewRoomUrl: string;
  termsUrl: string;
  copy: Record<Locale, PremiumCopy>;
}

export interface PremiumStatus {
  available: boolean;
  everActivated: boolean;
  accessActive: boolean;
  subscriptionStatus: "PREMIUM_ACTIVE" | "CANCELLATION_SCHEDULED" | "PREMIUM_INACTIVE" | null;
  accessUntil: string | null;
  pendingRequest: { kind: "activation" | "reactivation"; requestedAt: string } | null;
  canActivate: boolean;
  canReactivate: boolean;
  previewRoomUrl: string;
  termsUrl: string;
}

export interface PremiumActivationResult {
  outcome: { kind: "pending_confirmation" } | { kind: "redirect"; url: string } | { kind: "activated" };
  status: PremiumStatus;
}

/** Client Expansion Snapshot as generated at completion (immutable; both locales pre-rendered). */
export type SnapshotTone = "well_defined" | "needs_attention" | "resolve_early";

export interface RenderedSnapshot {
  eyebrow: string;
  headline: string;
  generatedOn: string;
  summary: string[];
  facts: Array<{ key: "company" | "market" | "launch" | "priority"; label: string; value: string; detail: string | null }>;
  counts: Array<{ tone: SnapshotTone; label: string; count: number }>;
  panels: Array<{ tone: SnapshotTone; title: string; intro: string; items: Array<{ areaId: number; label: string; reason: string | null }> }>;
  immediatePriority: { title: string; value: string; timing: string | null; reason: string | null } | null;
  reconcile: { title: string; text: string } | null;
  decisionAhead: { title: string; text: string } | null;
  shapePlan: { title: string; items: string[] } | null;
  oneThing: { title: string; text: string } | null;
  capabilities: { title: string; intro: string; items: Array<{ categoryId: number; label: string; description: string }> } | null;
  disclosure: { title: string; text: string };
}

export interface SnapshotView {
  snapshotId: string;
  generatedAt: string;
  content: { schema_version: 1; kind: "expansion_snapshot"; generated_at: string; deliverable_locale: Locale; locales: Record<Locale, RenderedSnapshot> };
}

export type ExtensionReason = "missing_information" | "project_not_structured" | "unsure_market_timing" | "something_else";
