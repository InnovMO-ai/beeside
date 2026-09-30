// Client-side view of the First Assessment question bank bundle (schema_version 1) and API payloads.
// The bundle is served by the backend from the versioned registry; copy is never hard-coded here.

export type Locale = "en" | "es";
// Mirrors backend/src/fa/engine/bundle-types.ts exactly (kept in sync by hand — the frontend has no
// import path into the backend package). fa-qb-1.1.0's original five plus fa-qb-2.0.0's seven Level
// 2 MVP composition-level stage ids (owner alignment pass, 2026-09-18).
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
  | "l2_review"
  // fa-qb-2.1.0 (Product Owner decision 2026-09-30, "Decision A"): the canonical 8-stage rail from
  // the frozen PRE-SNAPSHOT Design Freeze (Identity pre-rail, then these seven, then Snapshot —
  // "snapshot" above is reused, not redeclared). See question-bank-v2-1.ts for the full mapping.
  | "l3_company"
  | "l3_project"
  | "l3_objectives_market"
  | "l3_needs"
  | "l3_activation"
  | "l3_rules"
  | "l3_resources_review";
export type QuestionType =
  | "single_select"
  | "multi_select"
  | "text"
  | "short_text"
  | "timing"
  | "country_list"
  | "quantity"
  | "locale"
  | "tag_list"
  | "needs_map"
  | "counterparty_list";

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
  /** multi_select only (Level 2 MVP). */
  max_select?: number;
  /** country_list only (Level 2 MVP). */
  max_count?: number;
  /** tag_list / counterparty_list only (Level 2 MVP). */
  max_tags?: number;
  max_tag_length?: number;
  copy: Record<Locale, { title: string; helper?: string; placeholder?: string }>;
}

export interface StepDef {
  id: string;
  stage: StageId;
  kind: "questions" | "transition" | "review";
  /** Level 2 MVP: "grouped" renders every applicable question in this step on one screen at once,
   *  replacing the one-question-per-screen default. Undefined (or any other value) keeps the
   *  original per-screen behavior — existing fa-qb-1.1.0 steps are unaffected. */
  layout?: "grouped";
  /** "Leave a note" affordance — id of one of this step's own `question_ids` rendered as a collapsed
   *  post-it instead of inline. See the backend StepDef's own comment for the full rationale. */
  note_field_id?: string;
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
  /** Single primary action: "Continue with Premium" (Level 2 MVP: no Preview Room, no second CTA). */
  transition: { eyebrow: string; headline: string; body: string; continue_cta: string; new_tab: string };
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

/** Execution Demand tier vocabulary (Macroblock 7) — deliberately distinct from Definition & Evidence's
 *  `well_defined`/`partially_defined`/`early_stage` tiers so the two series are never visually conflated
 *  into one scale. Mirrors backend/src/fa/engine/execution-demand.ts's `ExecutionDemandTier`. */
export type ExecutionDemandTier = "low" | "low_medium" | "medium" | "medium_high" | "high";

/** Execution Demand for one Expansion Profile dimension — the frozen artifact's second dumbbell/radar
 *  series (`.marker.dem` / `.radar-dem`). `null` (absent, via `RenderedExpansionDimension.demand`)
 *  means NOT_EVALUABLE — the axis genuinely has no defensible signal, never rendered as zero. */
export interface RenderedExecutionDemand {
  value: number;
  tier: ExecutionDemandTier;
  tierLabel: string;
}

/**
 * One Expansion Profile radar axis (Macroblock 7 Snapshot Runtime Convergence taxonomy, 2026-09-28, superseding the prior
 * 2026-09-17 set — see backend/src/fa/engine/expansion-profile.ts). Mirrors backend/src/snapshot/compose.ts's
 * RenderedExpansionDimension. `value` (0..1) is for radar-axis rendering only — never shown as a
 * number/percentage; `tierLabel` is the only qualitative wording meant to be displayed.
 *
 * Dual Expansion Profile (Macroblock 7): `demand`/`demandNote` carry the second Execution Demand
 * series alongside this dimension's existing Definition & Evidence value/tier — both series are
 * rendered together (dumbbell track view + radar view), never one replacing the other. `demand` is
 * `null` when the dimension's Execution Demand is NOT_EVALUABLE, in which case `demandNote` carries
 * the one line of client-facing context for why (never silently omitted, never shown as zero).
 */
export interface RenderedExpansionDimension {
  key: "market_evidence" | "commercial_ambition_differentiation" | "local_capability_base" | "governance_constraints" | "financial_framework" | "activation_planning";
  label: string;
  value: number;
  /** Stable, non-localized key (RadarProfile's CSS/icon hook) — never derive styling from `tierLabel`. */
  tier: "well_defined" | "partially_defined" | "early_stage";
  tierLabel: string;
  demand: RenderedExecutionDemand | null;
  demandNote: string | null;
}

/** Value Bridges ("beeside can help") — Macroblock 7, wiring the approved library
 *  (`snapshot-etapa2-value-bridges-ronda-final.md`) into the live Snapshot. Mirrors
 *  backend/src/snapshot/value-bridges.ts's `ValueBridgeKey`. */
export type ValueBridgeKey = "strategic_advisory" | "operation_hub_secure" | "the_hive" | "beeside_verified" | "sherpa" | "operation_hub_productivity";

export interface RenderedValueBridge {
  key: ValueBridgeKey;
  eyebrow: string;
  heading: string;
  body: string;
}

/** "What Matters Now" (Level 2 MVP §3.3). Declared order (index 0 = Immediate Priority) — never
 *  reordered by dependency data; `dependsOnLabel`/`owner`/`approvalRequired` are shown alongside. */
export interface RenderedNeedsPriority {
  key: string;
  label: string;
  isImmediatePriority: boolean;
  isBlocker: boolean;
  dependsOnLabel: string | null;
  owner: string | null;
  approvalRequired: boolean;
  approvalFrom: string | null;
}

/** One of the four PathwayDiagram stages (§3.4): a deterministic bucket by dependency depth over the
 *  client's own declared graph — not a rigid methodology or a guarantee. Items sharing a stage are
 *  parallel paths, never forced into an artificial serial sequence. */
export type PathwayStage = "now" | "define" | "enable" | "launch";

export interface RenderedPathwayItem {
  key: string;
  label: string;
  stage: PathwayStage;
  isImmediatePriority: boolean;
  isBlocker: boolean;
  dependsOnLabel: string | null;
}

/** "Capability Landscape" (§3.5): every declared need with its coverage status — never a provider
 *  name. `status` is a stable key for icon/tone; `statusLabel` is the only wording meant to render. */
export interface RenderedNeedsLandscapeItem {
  key: string;
  label: string;
  status: NeedsMapStatus;
  statusLabel: string;
}

export interface RenderedSnapshot {
  eyebrow: string;
  headline: string;
  generatedOn: string;
  summary: string[];
  expansionProfile: RenderedExpansionDimension[];
  /** Dual Expansion Profile section copy (Macroblock 7) — title/intro/series legend shared by both the
   *  dumbbell track view and the radar view, both rendered together over `expansionProfile`. */
  dualProfile: { title: string; intro: string; definitionLabel: string; demandLabel: string };
  /** Narrative Interpretation Library (Macroblock 7 — Final Gap Closure) — deterministic, rule-based
   *  copy; see backend narrative-interpretation.ts for the full ruleset. */
  keyReading: string | null;
  marketEvidenceNarrative: string | null;
  executionPressureNarrative: string | null;
  facts: Array<{ key: "company" | "market" | "launch" | "priority"; label: string; value: string; detail: string | null }>;
  counts: Array<{ tone: SnapshotTone; label: string; count: number }>;
  panels: Array<{ tone: SnapshotTone; title: string; intro: string; items: Array<{ areaId: number; label: string; reason: string | null }> }>;
  immediatePriority: { title: string; value: string; timing: string | null; reason: string | null } | null;
  reconcile: { title: string; text: string } | null;
  decisionAhead: { title: string; text: string } | null;
  shapePlan: { title: string; items: string[] } | null;
  oneThing: { title: string; text: string } | null;
  capabilities: { title: string; intro: string; items: Array<{ categoryId: number; label: string; description: string }> } | null;
  needsPriorities: {
    title: string;
    intro: string;
    immediateLabel: string;
    nextLabel: string;
    blockerLabel: string;
    dependsOnLabel: string;
    ownerLabel: string;
    approvalLabel: string;
    items: RenderedNeedsPriority[];
  } | null;
  pathway: { title: string; intro: string; stageLabels: Record<PathwayStage, string>; immediateLabel: string; blockerLabel: string; items: RenderedPathwayItem[] } | null;
  needsLandscape: { title: string; intro: string; items: RenderedNeedsLandscapeItem[] } | null;
  /** Selective, contextual "beeside can help" microblocks (Macroblock 7) — at most 3, never one per
   *  section, never the same institutional component twice; see value-bridges.ts for trigger logic. */
  valueBridges: RenderedValueBridge[];
  disclosure: { title: string; text: string };
}

export interface SnapshotView {
  snapshotId: string;
  generatedAt: string;
  content: { schema_version: 1; kind: "expansion_snapshot"; generated_at: string; deliverable_locale: Locale; locales: Record<Locale, RenderedSnapshot> };
}

export type ExtensionReason = "missing_information" | "project_not_structured" | "unsure_market_timing" | "something_else";

// ---------------------------------------------------------------------------- Level 2 MVP additions

/** Mirrors backend/src/fa/engine/needs-map-types.ts exactly — see that file for the full rationale. */
export const NEEDS_MAP_STATUSES = ["covered_internally", "covered_by_provider", "in_progress", "needs_resolution", "needs_confirmation"] as const;
export type NeedsMapStatus = (typeof NEEDS_MAP_STATUSES)[number];

export interface NeedsMapSelection {
  key: string;
  status: NeedsMapStatus;
}

export interface NeedsMapDependency {
  key: string;
  dependsOn: string | null;
  owner: string | null;
  approvalRequired: boolean;
  approvalFrom: string | null;
}

export interface NeedsMapValue {
  selections: NeedsMapSelection[];
  priorityRank: string[];
  dependencies: NeedsMapDependency[];
  blockerKeys: string[];
}

export const NEEDS_MAP_LIMITS = { maxSelections: 20, maxPriorityRank: 5, maxFreeTextLength: 200 } as const;

/** Mirrors backend/src/fa/engine/counterparty-types.ts exactly — fa.provider.restricted_counterparties. */
export const RESTRICTION_TYPES = ["cannot_contract", "do_not_share_information", "both"] as const;
export type RestrictionType = (typeof RESTRICTION_TYPES)[number];

export interface CounterpartyEntry {
  name: string;
  restrictionType: RestrictionType;
}

export type CounterpartyListValue = CounterpartyEntry[];

export const COUNTERPARTY_LIST_LIMITS = { maxEntries: 25, maxNameLength: 200 } as const;
