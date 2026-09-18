import { QuestionDef, StageId, StepDef } from "../engine/bundle-types";
import { LIFECYCLE_POLICY_V1, lifecyclePolicyToConfig } from "../services/access-lifecycle";
import { PREMIUM_COPY, PREMIUM_TERMS_URL, PREVIEW_ROOM_URL } from "../../premium/content";
import { Bi, requiredQuestion } from "./helpers";
import { BUSINESS_QUESTIONS, GOAL_QUESTIONS, PROJECT_QUESTIONS, STORY_QUESTIONS } from "./questions-project-business";
import { CAPABILITY_QUESTIONS } from "./questions-operation";
import { CONSTRAINT_QUESTIONS, PREFERENCE_QUESTIONS, PRIORITY_QUESTIONS } from "./questions-priorities";
import { COMPANY_QUESTIONS, ENTRY_APPROACH_QUESTIONS, NEEDS_QUESTIONS, PLAN_QUESTIONS, PRIORITY_TIMING_QUESTIONS, PROVIDER_QUESTIONS } from "./questions-level2";
import { MANUFACTURING_FOLLOWUP_QUESTIONS, NEEDS_FOLLOWUP_QUESTIONS } from "./questions-needs-followups";
import { EMAIL_COPY, STAGES, UI_COPY } from "./ui-copy";

/**
 * beeside First Assessment — Level 2 MVP bundle (Design Specification "beeside First Assessment —
 * Level 2 MVP", all sections). fa-qb-2.0.0 keeps every question, field_key and option value of
 * fa-qb-1.1.0 completely unchanged **in questions-operation.ts / question-bank.ts themselves** — that
 * file is never edited, and any project already pinned to fa-qb-1.1.0 keeps running through the
 * existing one-question-per-screen Journey unchanged. fa-qb-2.0.0 is a structurally new bundle that
 * reuses field_keys (for data continuity) but not the old tree's exported QuestionDef objects
 * wherever their gate changes — see questions-needs-followups.ts.
 *
 * ARCHITECTURAL FORK RESOLVED (owner decision, 2026-09-17 — supersedes the "kept intact" note this
 * file previously carried): the Needs Explorer (composition 5) REPLACES the old operation question
 * tree wherever a question is fully covered by the new mechanisms (Project, Plan Definition, Needs
 * Explorer, Status, Priorities, Blockers, Dependencies, Ownership/Approval, Provider Profile,
 * Resources) — no two mechanisms ask the same thing. Where the old tree captured a fact still
 * needed downstream (rules/findings, a Snapshot/Precision input) that the new structure does not
 * capture, that fact alone is preserved, relocated to the composition it now belongs in:
 *
 *   - `fa.operation.growth_focus` (GROWTH1): confirmed load-bearing in the rules engine
 *     (rules/engine.ts, F.growthFocus / boosted signals) with no Needs Explorer equivalent (a
 *     "boost" signal, not a capability gap) — kept as a real question, moved into "Your Project"
 *     right after project stage (its own gate).
 *   - ~20 operation-detail questions (supplier/import-export/warehousing/freight/last-mile/
 *     facilities/technology-integration/workforce/partner/regulated-permit specifics, plus
 *     manufacturing volume/SKU): unique volumetric, current-state or relationship data with no
 *     Needs Explorer equivalent — relocated to questions-needs-followups.ts, gated on the matching
 *     Needs Explorer leaf (or, for manufacturing, on the existing business-type field, since no
 *     leaf exists for it — a documented gap) instead of the removed O1 mother question.
 *   - `fa.operation.expected_capabilities` / `banking_status` / `insurance_status` (CAP1 and its two
 *     children): REMOVED from the visible journey — CAP1 is a near word-for-word duplicate of the
 *     Needs Explorer's own selection mechanism. A rules-engine compatibility fallback (not a visible
 *     question) lives in legacy-capability-adapter.ts in case the live rules_engine_version.config
 *     still references these field_keys; see that file for the full reasoning and its residual,
 *     explicitly flagged verification need.
 *   - Removed outright, not relocated, because the QUESTION ITSELF (not just its topic) duplicates
 *     leaf selection: O1, O_SRC_LOCAL, O_IMP_CROSS_BORDER, O_WH_LOCAL, O_LM_LOCAL, O_WF_HIRING,
 *     O_PRT_DEPENDENCY, O_TECH_SYSTEMS.
 *   - PRIORITY_QUESTIONS / CONSTRAINT_QUESTIONS / PREFERENCE_QUESTIONS: kept exactly as in
 *     fa-qb-1.1.0. They read on a different, coarser 14-category taxonomy than the Needs Explorer's
 *     10-category one and are confirmed load-bearing in the rules engine (declaredPriority() /
 *     pressureApplies() in rules/engine.ts) — not captured by the new structure, so not removed.
 *   - B3-B6 / SP2 (customer model, revenue model, value-chain role, employee band, commercial
 *     success): kept exactly as in fa-qb-1.1.0 in "Your Business" — descriptive business-profile
 *     facts with no Needs Explorer overlap and no confirmed redundant mechanism.
 */
export const FA_QUESTION_BANK_VERSION_V2 = "fa-qb-2.0.0";

export { TERMS_URL } from "./question-bank";

const PERSONAL_EMAIL_DOMAINS = [
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com",
  "yahoo.com.mx", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me",
  "protonmail.com", "gmx.com", "gmx.net", "mail.com", "zoho.com", "yandex.com", "hotmail.es",
  "outlook.es", "live.com.mx", "prodigy.net.mx",
];

function groupedStep(id: string, stage: StageId, questions: QuestionDef[], title: Bi, intro?: Bi): StepDef {
  return {
    id,
    stage,
    kind: "questions",
    layout: "grouped",
    question_ids: questions.map((q) => q.id),
    copy: {
      en: { title: title[0], ...(intro ? { intro: intro[0] } : {}) },
      es: { title: title[1], ...(intro ? { intro: intro[1] } : {}) },
    },
  };
}

function reviewStep(id: string, stage: StageId, title: Bi, intro: Bi): StepDef {
  return { id, stage, kind: "review", question_ids: [], copy: { en: { title: title[0], intro: intro[0] }, es: { title: title[1], intro: intro[1] } } };
}

// B1 (description) and B2 (type) move from "Your Business" into composition 1 ("Your Company"),
// per the Design Specification's Area A grouping ("company description ... industry"). Every other
// BUSINESS_QUESTIONS entry (B3-B6, SP2) keeps its existing relative order in "Your Business" below.
// (noUncheckedIndexedAccess types each destructured position as QuestionDef | undefined even though
// BUSINESS_QUESTIONS is a fixed literal that always has these two entries — requiredQuestion fails
// loudly, instead of silently, if that ever stops being true. See helpers.ts.)
const [rawB1, rawB2, ...REMAINING_BUSINESS_QUESTIONS] = BUSINESS_QUESTIONS;
const B1 = requiredQuestion(rawB1, "B1 (BUSINESS_QUESTIONS[0])");
const B2 = requiredQuestion(rawB2, "B2 (BUSINESS_QUESTIONS[1])");

// GROWTH1 is CAPABILITY_QUESTIONS' 4th and last entry (after CAP1, CAP_BANKING, CAP_INSURANCE, none
// of which fa-qb-2.0.0 uses — see the file header). Destructured, not spread, so those three never
// enter this bundle's `questions` array.
const [, , , rawGrowth1] = CAPABILITY_QUESTIONS;
const GROWTH1 = requiredQuestion(rawGrowth1, "GROWTH1 (CAPABILITY_QUESTIONS[3])");

// fa.needs.map itself, then every leaf-gated follow-up, then the free-text catch-all — progressive
// disclosure within one continuous composition, exactly as NEEDS_QUESTIONS was authored.
const [rawNeedsMap, rawNeedsContext] = NEEDS_QUESTIONS;
const NEEDS_MAP = requiredQuestion(rawNeedsMap, "NEEDS_MAP (NEEDS_QUESTIONS[0])");
const NEEDS_CONTEXT = requiredQuestion(rawNeedsContext, "NEEDS_CONTEXT (NEEDS_QUESTIONS[1])");

const STEPS_V2: StepDef[] = [
  // Composition 1 — Your Company
  groupedStep(
    "l2_company",
    "project",
    [...COMPANY_QUESTIONS, B1, B2, ...MANUFACTURING_FOLLOWUP_QUESTIONS],
    ["Your company", "Tu empresa"],
    ["A little about who you are and how your company operates today.", "Un poco sobre quién eres y cómo opera tu empresa hoy."],
  ),

  // Composition 2 — Your Project
  groupedStep(
    "l2_your_project",
    "project",
    [...STORY_QUESTIONS, ...ENTRY_APPROACH_QUESTIONS, ...GOAL_QUESTIONS, ...PROJECT_QUESTIONS, GROWTH1],
    ["Your project", "Tu proyecto"],
    ["Tell us what you're planning and where it's headed.", "Cuéntanos qué estás planeando y hacia dónde va."],
  ),

  // Composition 3 — Plan Definition
  groupedStep("l2_plan_definition", "project", PLAN_QUESTIONS, ["How defined is your plan?", "¿Qué tan definido está tu plan?"], [
    "This is about the evidence behind the plan, not how confident you feel about it.",
    "Esto es sobre la evidencia detrás del plan, no sobre qué tan seguro te sientes de él.",
  ]),

  // Kept baseline (see file header): descriptive business-profile facts, unchanged, now grouped
  // instead of one-question-per-screen. The pre-Level-2 operation question tree no longer has its
  // own composition — every question that survived it is now either here (none are), in Your
  // Project (GROWTH1), in Your Company (manufacturing), or in Needs Landscape (everything else).
  groupedStep("l2_business", "business", REMAINING_BUSINESS_QUESTIONS, ["Your business", "Tu negocio"]),

  // Composition 4 — Priorities
  groupedStep("l2_priorities", "priorities", [...PRIORITY_QUESTIONS, ...PRIORITY_TIMING_QUESTIONS], ["Identify your priorities", "Identifica tus prioridades"]),
  groupedStep("l2_constraints", "priorities", CONSTRAINT_QUESTIONS, ["What could affect your plan?", "¿Qué podría afectar tu plan?"]),

  // Composition 5 — Needs Landscape (merges former Areas E+F; replaces the old operation-detail
  // tree wherever it was redundant with leaf selection — see file header).
  groupedStep(
    "l2_needs_landscape",
    "priorities",
    [NEEDS_MAP, ...NEEDS_FOLLOWUP_QUESTIONS, NEEDS_CONTEXT],
    ["What needs to be resolved?", "¿Qué necesita resolverse?"],
    [
      "Map what's still open, then rank what matters most — one continuous flow, no need to backtrack.",
      "Mapea lo que sigue abierto y luego ordena lo que más importa: un solo flujo continuo, sin necesidad de retroceder.",
    ],
  ),

  // Composition 6 — Provider Profile + Resources (merges former Areas G+H)
  groupedStep("l2_provider_resources", "priorities", PROVIDER_QUESTIONS, ["What matters when we match you", "Qué importa cuando te conectemos"]),

  groupedStep("l2_preferences", "priorities", PREFERENCE_QUESTIONS, ["A few final details", "Unos últimos detalles"]),

  // Composition 7 — Review (no new questions; a recap the respondent confirms before locking).
  reviewStep(
    "l2_review",
    "snapshot",
    ["Review how we understood your project", "Revisa cómo entendimos tu proyecto"],
    [
      "Before we generate your Snapshot, review how we understood your project. If anything does not accurately reflect what you shared, this is the moment to adjust it.",
      "Antes de generar tu Snapshot, revisa cómo entendimos tu proyecto. Si algo no refleja con precisión lo que compartiste, este es el momento de ajustarlo.",
    ],
  ),
];

export function buildQuestionBankBundleV2() {
  return {
    schema_version: 1 as const,
    product: "first_assessment" as const,
    locales: ["en", "es"] as const,
    // Same shared ui/emails copy as fa-qb-1.1.0 (question-bank.ts) — see that file's comment on
    // this list for what each addition backs.
    variables: [
      "preferred_name", "access_until", "company_name", "days_left", "recoverable_until", "until",
      "retention_until", "count", "max", "tag", "name",
    ],
    stages: STAGES,
    steps: STEPS_V2,
    questions: [
      ...COMPANY_QUESTIONS,
      ...BUSINESS_QUESTIONS,
      ...STORY_QUESTIONS,
      ...ENTRY_APPROACH_QUESTIONS,
      ...GOAL_QUESTIONS,
      ...PROJECT_QUESTIONS,
      GROWTH1,
      ...PLAN_QUESTIONS,
      ...MANUFACTURING_FOLLOWUP_QUESTIONS,
      ...NEEDS_FOLLOWUP_QUESTIONS,
      ...PRIORITY_QUESTIONS,
      ...PRIORITY_TIMING_QUESTIONS,
      ...CONSTRAINT_QUESTIONS,
      ...NEEDS_QUESTIONS,
      ...PROVIDER_QUESTIONS,
      ...PREFERENCE_QUESTIONS,
    ],
    identity: { personal_email_domains: PERSONAL_EMAIL_DOMAINS },
    links: {
      terms_url: "https://www.beeside.you/termsandconditions",
      privacy_policy_url: null,
      preview_room_url: PREVIEW_ROOM_URL,
      premium_terms_url: PREMIUM_TERMS_URL,
    },
    ui: UI_COPY,
    emails: EMAIL_COPY,
    lifecycle: lifecyclePolicyToConfig(LIFECYCLE_POLICY_V1),
    premium: { copy: PREMIUM_COPY },
  };
}
