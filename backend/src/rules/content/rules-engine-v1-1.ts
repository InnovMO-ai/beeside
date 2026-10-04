import type { RulesEngineBundle } from "../types";
import { buildRulesEngineBundle } from "./rules-engine-v1";
import { FA_QUESTION_BANK_VERSION_V2 } from "../../fa/content/question-bank-v2";
import { FA_QUESTION_BANK_VERSION_V21 } from "../../fa/content/question-bank-v2-1";

export const FA_RULES_ENGINE_VERSION_V1_1 = "re-1.1.0";

/**
 * Rules Engine re-1.1.0 — pure version/compatibility extension of re-1.0.0 ((FA_RULES_ENGINE_VERSION)),
 * per Product Owner authorization (2026-09-30, "RULES ENGINE COMPATIBILITY", item 2): "You may...
 * create a new compatible Rules Engine version; extend schema/version compatibility; add/update
 * fingerprints or version allowlists... You may NOT silently change: scoring methodology;
 * applicability rules; Definition & Evidence logic; Execution Demand logic; narrative methodology;
 * ...any frozen FA/Snapshot product rule."
 *
 * Every AREAS / pressure_reasons / panels / capabilities / growth_boosts / priority_alignment rule
 * is spread unchanged from buildRulesEngineBundle() — not one condition, weight, threshold, copy
 * string or scoring behavior differs from re-1.0.0. The ONLY change below is `question_bank_versions`,
 * extended to also vouch for fa-qb-2.0.0 and fa-qb-2.1.0 (the Level 2 MVP bundle and its 2026-09-30
 * canonical stage-regroup). re-1.0.0 itself is untouched — this is a new, additional pinned version,
 * not an edit to the existing one, so any project already pinned to re-1.0.0 keeps evaluating exactly
 * as it does today.
 *
 * Why this is a genuine version/compatibility fix and not a hidden methodology change:
 *
 *  - fa-qb-2.0.0 keeps every fa-qb-1.1.0 field_key, option value and gate this rules engine's
 *    conditions read UNCHANGED wherever that field is still asked — question-bank-v2.ts's own file
 *    header documents PRIORITY_QUESTIONS / CONSTRAINT_QUESTIONS / PREFERENCE_QUESTIONS and B3-B6 as
 *    "kept exactly as in fa-qb-1.1.0", and every relocated operation-detail question in
 *    questions-needs-followups.ts explicitly keeps "the same `id` and same `field_key` as the
 *    pre-Level-2 question in every case ... only the gate and the composition it renders in change".
 *
 *  - fa-qb-2.1.0 reuses fa-qb-2.0.0's question set, field_keys, gates and copy byte-for-byte — only
 *    the stage grouping changed (question-bank-v2-1.ts's own file header: "No question, field_key,
 *    option value, or gate condition was added, removed, or reworded from fa-qb-2.0.0") — so
 *    everything true of fa-qb-2.0.0 above is equally true of fa-qb-2.1.0. The stage regroup does
 *    change `stages`/`steps`, so its question-schema fingerprint differs from fa-qb-2.0.0's; that is
 *    exactly why it needs its own explicit entry below rather than relying on a fingerprint match.
 *
 *  - The one field this rules engine reads that fa-qb-2.x genuinely removed from the visible journey
 *    outright — `fa.operation.expected_capabilities` and its two children
 *    `fa.operation.banking_status` / `fa.operation.insurance_status` (the old CAP1 "capability mother
 *    question", superseded by the Needs Explorer) — is reconciled by
 *    `legacy-capability-adapter.ts`'s `deriveLegacyCapabilityAnswers()`, already wired into
 *    `snapshot-service.ts`'s evidence map for every project regardless of which rules engine version
 *    it is pinned to. That is the "adapters/mappings for continuity" path the owner explicitly
 *    authorized — an in-memory evidence reconciliation, never a rules or scoring change.
 *
 *  - A further set of operation-detail toggle fields were removed outright, not relocated, because
 *    fa-qb-2.0.0's own decision was that the QUESTION ITSELF duplicated Needs Explorer leaf selection
 *    (`fa.operation.import_export.cross_border_expected`, `fa.operation.sourcing.local_expected`,
 *    `fa.operation.warehousing.local_expected`, `fa.operation.last_mile.local_expected`,
 *    `fa.operation.workforce.local_hiring_expected`, `fa.operation.partners.dependency`,
 *    `fa.operation.technology.critical_systems`, `fa.operation.components`). This is a real, narrow
 *    signal loss for Level 2 projects — already owner-accepted in question-bank-v2.ts's file header,
 *    the same category as its documented `fa.goal.timing_driver` (G5) loss — not something re-1.1.0
 *    introduces. Every condition that reads one of these fields simply sees it as never
 *    DECLARED_BY_USER for a Level 2 project, so `declared()` / `eq()` / `in()` / `answered()`
 *    conditions built on it evaluate to false / not-matched exactly as for any other unanswered
 *    field: no exception is thrown, no unrelated rule or scoring path is affected, and the rules
 *    engine's own methodology is completely untouched. Flagged here for visibility, not silently
 *    absorbed — see the Final Pre-Deploy Report. The durable fix, if this signal is ever wanted back,
 *    is a Needs-Explorer-leaf-gated question that re-derives it (the same pattern already used for
 *    the ~20 relocated operation-detail questions), not a rules engine change.
 */
export function buildRulesEngineBundleV11(): RulesEngineBundle {
  return {
    ...buildRulesEngineBundle(),
    question_bank_versions: ["fa-qb-1.0.0", FA_QUESTION_BANK_VERSION_V2, FA_QUESTION_BANK_VERSION_V21],
  };
}
