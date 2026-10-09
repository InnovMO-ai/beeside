// Precision manifest & readiness engine — shared types (the contract between the engine, the domain
// services and the conversation module). Implementations live next to this file (index.ts re-exports).
// Pure and deterministic: nothing here touches the database, the clock or a model.
import type { CategoryManifestContent, FieldDefinition } from "./effective-fields";

/** Stored answer states (fact.answer_state) plus the derived NOT_APPLICABLE. */
export type AnswerState = "NOT_ASKED" | "UNKNOWN" | "WITHHELD" | "EXPLICIT_NO" | "ZERO" | "ANSWERED" | "ASSUMED" | "NOT_APPLICABLE";

/** Current value of one manifest field as the engine sees it (keyed by manifest field_key, WITHOUT the "precision." prefix). */
export interface FactView { value: unknown; answerState: AnswerState; provenance?: string }
export type FactMap = Readonly<Record<string, FactView | undefined>>;

/** Item state inside a repeatable_group value: either a bare value or {value, answer_state}. */
export interface EvaluationInput {
  manifest: CategoryManifestContent & {
    category_key?: string;
    crp_kind?: string;
    intake_depth?: string;
    boundaries?: unknown;
    [k: string]: unknown;
  };
  facts: FactMap;
  /** ISO-3166-1 alpha-2 destination countries (can be empty). */
  countries: string[];
}

export type RequirementState = "confirmed" | "assumed" | "pending" | "not_applicable";

export interface RequirementStatus {
  fieldKey: string;
  level: FieldDefinition["requirement_level"];
  applicable: boolean;
  /** confirmed ⇔ ANSWERED/EXPLICIT_NO/ZERO (and, for groups, min_items + required subfields confirmed). */
  state: RequirementState;
  executionDependency: boolean;
  /** Raw answer state as stored (NOT_ASKED when absent). */
  answerState: AnswerState;
}

export interface CriticalItem {
  /** decision_key when it comes from a critical decision; otherwise the blocking field_key. */
  itemKey: string;
  kind: "field" | "path" | "consistency" | "confirmation";
  label: Record<string, string>;
}

export interface CategoryEvaluation {
  /** floor(100 * confirmed / total) over applicable required (blocking|required|conditional) requirements; null when total = 0. */
  progressPct: number | null;
  totalRequired: number;
  confirmedRequired: number;
  /** Frozen rule: blocking_gaps == [] (blocking fields resolved, blocking decisions resolved, no unacknowledged blocking contradiction). Independent of progressPct. */
  ready: boolean;
  /** Open critical items (blocking field gaps + unresolved blocking decisions). */
  critical: CriticalItem[];
  /** Applicable required/conditional requirements that are not confirmed, shown as Pending Information in the CRP. */
  pending: RequirementStatus[];
  requirements: RequirementStatus[];
  notApplicable: string[];
  /** Server-chosen next field to ask about: blocking first, then manifest order; null when nothing left to ask. */
  nextFieldKey: string | null;
}

export interface EngineClassification {
  scenario: "out_of_scope" | "strategic_advisory" | "ecosystem_development" | "known_service" | "unmapped_known_category" | "discovery" | "ambiguous" | "known_category_exists";
  [k: string]: unknown;
}
