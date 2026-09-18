import { QuestionBankBundle, QuestionDef, StageDef, StageId, StepDef } from "../engine/bundle-types";
import { LIFECYCLE_POLICY_V1, lifecyclePolicyToConfig } from "../services/access-lifecycle";
import { PREMIUM_COPY, PREMIUM_TERMS_URL, PREVIEW_ROOM_URL } from "../../premium/content";
import { Bi, requiredQuestion } from "./helpers";
import { BUSINESS_QUESTIONS, GOAL_QUESTIONS, PROJECT_QUESTIONS, STORY_QUESTIONS } from "./questions-project-business";
import { CAPABILITY_QUESTIONS } from "./questions-operation";
import { CONSTRAINT_QUESTIONS, PREFERENCE_QUESTIONS, PRIORITY_QUESTIONS } from "./questions-priorities";
import { COMPANY_QUESTIONS, ENTRY_APPROACH_QUESTIONS, NEEDS_QUESTIONS, PLAN_QUESTIONS, PRIORITY_TIMING_QUESTIONS, PROVIDER_QUESTIONS } from "./questions-level2";
import { MANUFACTURING_FOLLOWUP_QUESTIONS, NEEDS_FOLLOWUP_QUESTIONS } from "./questions-needs-followups";
import { EMAIL_COPY, UI_COPY } from "./ui-copy";

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
 *   - B3-B6 (customer model, revenue model, value-chain role, employee band): kept exactly as in
 *     fa-qb-1.1.0 — descriptive business-profile facts with no Needs Explorer overlap and no
 *     confirmed redundant mechanism. Alignment pass (2026-09-18): originally placed in their own
 *     "Your Business" step (a carry-over of fa-qb-1.1.0's grouping, never part of the approved macro
 *     structure); folded into "Your Company" alongside B1/B2 instead. See the note above STEPS_V2
 *     for the full alignment-pass rationale, including the same fix for CONSTRAINT_QUESTIONS and
 *     PREFERENCE_QUESTIONS (also kept unchanged, only relocated).
 *
 * OWNER DECISIONS — FINAL LEVEL 2 JOURNEY ALIGNMENT (second alignment pass, 2026-09-18): four
 * further single-question-per-concept rulings, resolving items the first alignment pass had flagged
 * as genuine owner decisions rather than guessing at them:
 *   - SP2 (`fa.strategic.commercial_success`): REMOVED from the visible journey — its meaning is
 *     sufficiently covered by G2 (`fa.goal.success_definition`) and the respondent should not answer
 *     the same "what does success look like" question twice. Any downstream consumer that still
 *     reads `fa.strategic.commercial_success` is served a deterministic copy of the respondent's own
 *     G2 answer — see level2-compatibility-adapter.ts. Not asked, not guessed at, not reworded.
 *   - G6 (`fa.goal.expansion_driver`): REMOVED from the visible journey — PR_DRIVER_STRUCTURED is now
 *     the ONLY client-facing structured-driver interaction (open text → deterministic clue →
 *     structured value → user confirmation → confirmed fact). Downstream consumers that read
 *     `fa.goal.expansion_driver` are served a deterministic copy of the confirmed
 *     `fa.project.primary_driver_structured` value — the two fields already share an identical value
 *     set "by design" (structured-echo.ts), so no translation is needed, only a copy. See
 *     level2-compatibility-adapter.ts.
 *   - G5 (`fa.goal.timing_driver`): REMOVED from the visible journey — the approved Priorities
 *     composition already asks the target date, its flexibility (PR_FLEX) and, when the date isn't
 *     fully flexible, what determines it (PR_FLEX_REASON); asking G5's separate categorical "what is
 *     driving that timing" on top of that is the duplicate the owner ruled out. No deterministic
 *     source exists to derive a value for this specific field (PR_FLEX_REASON is free text on a
 *     narrower gate, not the same categorical taxonomy), so — unlike SP2/G6 — this is NOT mapped;
 *     `fa.goal.timing_driver` simply goes unanswered for Level 2 projects. The one confirmed reader,
 *     the rules engine's "shared_timing_driver" tension test (rules/engine.ts detectTension()), reads
 *     it defensively (`typeof timingDriver === "string" ? ... : []`) and degrades gracefully to just
 *     never firing that one test for Level 2 — it does not throw and no other test is affected.
 *     Flagging this explicitly rather than silently: a real, if narrow, signal loss versus
 *     fa-qb-1.1.0, accepted as part of this owner decision.
 *   - ANOTHER_PROJECT (`fa.project.another_project_in_mind`): REMOVED from the visible journey — the
 *     product already supports Company → Project 1 → Project 2 → ... and "start another project" is
 *     offered unconditionally after completion instead (App.tsx no longer gates it on this answer).
 *     No downstream consumer reads this field_key for anything other than that gate and an analytics
 *     event name, so no compatibility mapping is needed.
 *
 * All four are pure removals from the CLIENT-FACING journey — the canonical fields themselves are
 * untouched, no new question was invented, and B2 (`fa.business.type`) was deliberately left as-is
 * pending a visual UX review of its overlap with CO2/CO3 (a genuine owner decision still open, not
 * resolved by this pass).
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
// BUSINESS_QUESTIONS entry (B3-B6, SP2) keeps its existing relative order, also folded into "Your
// Company" now (see the alignment-pass note above STEPS_V2). SP2 is then filtered back out below —
// see OWNER DECISIONS in the file header — but the destructuring itself is unchanged.
// (noUncheckedIndexedAccess types each destructured position as QuestionDef | undefined even though
// BUSINESS_QUESTIONS is a fixed literal that always has these two entries — requiredQuestion fails
// loudly, instead of silently, if that ever stops being true. See helpers.ts.)
const [rawB1, rawB2, ...REMAINING_BUSINESS_QUESTIONS] = BUSINESS_QUESTIONS;
const B1 = requiredQuestion(rawB1, "B1 (BUSINESS_QUESTIONS[0])");
const B2 = requiredQuestion(rawB2, "B2 (BUSINESS_QUESTIONS[1])");

// OWNER DECISIONS (2026-09-18, see file header): SP2 is removed from the client-facing journey
// (covered by G2 instead); B3-B6 are unaffected and keep their order.
const BUSINESS_QUESTIONS_CLIENT = REMAINING_BUSINESS_QUESTIONS.filter((q) => q.id !== "SP2");

// OWNER DECISIONS (2026-09-18, see file header): ANOTHER_PROJECT is removed from the client-facing
// journey ("start another project" is now offered unconditionally after completion instead).
const STORY_QUESTIONS_CLIENT = STORY_QUESTIONS.filter((q) => q.id !== "ANOTHER_PROJECT");

// OWNER DECISIONS (2026-09-18, see file header): G5 (timing_driver) and G6 (expansion_driver) are
// both removed from the client-facing journey — G5 duplicates the Priorities composition's own
// PR_FLEX/PR_FLEX_REASON timing-rationale questions; G6 duplicates PR_DRIVER_STRUCTURED, now the
// single confirmed structured-driver interaction. G1-G4 are unaffected.
const GOAL_QUESTIONS_CLIENT = GOAL_QUESTIONS.filter((q) => q.id !== "G5" && q.id !== "G6");

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

// Alignment pass (2026-09-18): fa-qb-2.0.0 previously had THREE extra top-level steps —
// l2_business, l2_constraints, l2_preferences — that were never part of the approved 9-composition
// macro structure (0 Welcome/Identity, 1 Your Company, 2 Your Project, 3 Plan Definition,
// 4 Priorities, 5 Needs Landscape, 6 Provider Profile + Resources, 7 Review, 8 Assemble transition,
// 9 Virtual Snapshot). This file's own composition numbering (see questions-level2.ts's section
// comments, "Composition 1" through "Composition 6") already matches that list exactly and never
// numbered these three as compositions of their own — they were a mechanical carry-over of
// fa-qb-1.1.0's question groupings, not an approved macro block. None of the three needed content
// changes (every question they contained was already correctly scoped for Level 2, per the file
// header's fork-resolution notes) — only their placement was wrong:
//   - l2_business (B3-B6, SP2 — customer model, revenue model, value-chain role, employee band,
//     commercial success) folds into "Your Company", immediately after B1/B2, which already moved
//     there from "Your Business" for the same reason (Design Spec Area A grouping).
//   - l2_constraints (C1, C2, SP3, C3, C3_AREAS, C_CONTRACT, C4, C4_AREAS, C5, C6) folds into
//     "Priorities" — the approved list has one Priorities composition, not a separate Constraints
//     block; "what could affect your plan" is part of prioritizing, not a macro step of its own.
//   - l2_preferences (S1, S5, S6_INTERACTION, S6_DELIVERABLE — ownership status, preferred name,
//     interaction/deliverable language) folds into the tail of "Provider Profile + Resources", the
//     last content composition before Review — these are personalization questions, not a
//     standalone macro block.
// Progress structure (owner decision, 2026-09-18, "IMPORTANT — CLIENT-FACING PROGRESS STRUCTURE"):
// the customer must perceive the seven approved compositions themselves (Your Company, Your
// Project, Plan Definition, Priorities, Needs Landscape, Provider Profile + Resources, Review), not
// fa-qb-1.1.0's coarser five-stage grouping (or the even coarser project/priorities/snapshot
// filtering this file used in the first alignment pass). Each step below is therefore given its own
// dedicated stage id — a 1:1 mapping, step id === stage id — so the progress rail (Shell.tsx, which
// renders `bundle.stages` generically with no code change needed) shows exactly these seven
// composition names, in order, with no invented eighth or ninth macro stage: Assemble transition and
// Virtual Snapshot are a separate post-Journey experience (SnapshotScreen / AssembleTransition.tsx /
// VirtualSnapshot.tsx), never part of `bundle.steps`, so they were never part of this progress rail
// to begin with. See STAGES_V2 below for the stage copy itself.
const STEPS_V2: StepDef[] = [
  // Composition 1 — Your Company (includes the former l2_business questions — see note above)
  groupedStep(
    "l2_company",
    "l2_company",
    [...COMPANY_QUESTIONS, B1, B2, ...BUSINESS_QUESTIONS_CLIENT, ...MANUFACTURING_FOLLOWUP_QUESTIONS],
    ["Your company", "Tu empresa"],
    ["A little about who you are and how your company operates today.", "Un poco sobre quién eres y cómo opera tu empresa hoy."],
  ),

  // Composition 2 — Your Project
  groupedStep(
    "l2_your_project",
    "l2_your_project",
    [...STORY_QUESTIONS_CLIENT, ...ENTRY_APPROACH_QUESTIONS, ...GOAL_QUESTIONS_CLIENT, ...PROJECT_QUESTIONS, GROWTH1],
    ["Your project", "Tu proyecto"],
    ["Tell us what you're planning and where it's headed.", "Cuéntanos qué estás planeando y hacia dónde va."],
  ),

  // Composition 3 — Plan Definition
  groupedStep("l2_plan_definition", "l2_plan_definition", PLAN_QUESTIONS, ["How defined is your plan?", "¿Qué tan definido está tu plan?"], [
    "This is about the evidence behind the plan, not how confident you feel about it.",
    "Esto es sobre la evidencia detrás del plan, no sobre qué tan seguro te sientes de él.",
  ]),

  // Composition 4 — Priorities (includes the former l2_constraints questions — see note above)
  groupedStep(
    "l2_priorities",
    "l2_priorities",
    [...PRIORITY_QUESTIONS, ...PRIORITY_TIMING_QUESTIONS, ...CONSTRAINT_QUESTIONS],
    ["Identify your priorities", "Identifica tus prioridades"],
  ),

  // Composition 5 — Needs Landscape (merges former Areas E+F; replaces the old operation-detail
  // tree wherever it was redundant with leaf selection — see file header).
  groupedStep(
    "l2_needs_landscape",
    "l2_needs_landscape",
    [NEEDS_MAP, ...NEEDS_FOLLOWUP_QUESTIONS, NEEDS_CONTEXT],
    ["What needs to be resolved?", "¿Qué necesita resolverse?"],
    [
      "Map what's still open, then rank what matters most — one continuous flow, no need to backtrack.",
      "Mapea lo que sigue abierto y luego ordena lo que más importa: un solo flujo continuo, sin necesidad de retroceder.",
    ],
  ),

  // Composition 6 — Provider Profile + Resources (merges former Areas G+H; includes the former
  // l2_preferences personalization questions at the tail — see note above)
  groupedStep(
    "l2_provider_resources",
    "l2_provider_resources",
    [...PROVIDER_QUESTIONS, ...PREFERENCE_QUESTIONS],
    ["What matters when we match you", "Qué importa cuando te conectemos"],
  ),

  // Composition 7 — Review (no new questions; a recap the respondent confirms before locking).
  reviewStep(
    "l2_review",
    "l2_review",
    ["Review how we understood your project", "Revisa cómo entendimos tu proyecto"],
    [
      "Before we generate your Snapshot, review how we understood your project. If anything does not accurately reflect what you shared, this is the moment to adjust it.",
      "Antes de generar tu Snapshot, revisa cómo entendimos tu proyecto. Si algo no refleja con precisión lo que compartiste, este es el momento de ajustarlo.",
    ],
  ),
];

// One stage per composition, in composition order, labeled with the owner's own approved macro
// names (English verbatim; Spanish is a direct translation of those same names, authored here for
// review — not previously-approved copy). Deliberately NOT derived from fa-qb-1.1.0's shared STAGES
// export (ui-copy.ts) any more — that five-stage list has no entry that matches these compositions,
// and v1 is completely unaffected either way since it never imports from this file.
const STAGES_V2: StageDef[] = [
  { id: "l2_company", copy: { en: { label: "Your Company" }, es: { label: "Tu Empresa" } } },
  { id: "l2_your_project", copy: { en: { label: "Your Project" }, es: { label: "Tu Proyecto" } } },
  { id: "l2_plan_definition", copy: { en: { label: "Plan Definition" }, es: { label: "Definición del Plan" } } },
  { id: "l2_priorities", copy: { en: { label: "Priorities" }, es: { label: "Prioridades" } } },
  { id: "l2_needs_landscape", copy: { en: { label: "Needs Landscape" }, es: { label: "Panorama de Necesidades" } } },
  { id: "l2_provider_resources", copy: { en: { label: "Provider Profile + Resources" }, es: { label: "Perfil de Proveedor y Recursos" } } },
  { id: "l2_review", copy: { en: { label: "Review" }, es: { label: "Revisión" } } },
];

// Explicit return type (matching question-bank.ts's buildQuestionBankBundle) gives every field
// below its contextual type, so plain literals satisfy QuestionBankBundle without `as const` —
// which would otherwise make `locales` a readonly tuple, incompatible with the mutable Locale[]
// the interface declares. This was never caught before because nothing called this function
// against that type until it was wired into the local-dev publish path.
export function buildQuestionBankBundleV2(): QuestionBankBundle {
  return {
    schema_version: 1,
    product: "first_assessment",
    locales: ["en", "es"],
    // Same shared ui/emails copy as fa-qb-1.1.0 (question-bank.ts) — see that file's comment on
    // this list for what each addition backs.
    variables: [
      "preferred_name", "access_until", "company_name", "days_left", "recoverable_until", "until",
      "retention_until", "count", "max", "tag", "name",
    ],
    stages: STAGES_V2,
    steps: STEPS_V2,
    // SP2, ANOTHER_PROJECT, G5 and G6 are deliberately excluded here, not just from STEPS_V2 — the
    // validator requires every bundle.questions entry to appear in exactly one step's question_ids,
    // and these four are no longer client-facing at all (see OWNER DECISIONS in the file header).
    questions: [
      ...COMPANY_QUESTIONS,
      B1,
      B2,
      ...BUSINESS_QUESTIONS_CLIENT,
      ...STORY_QUESTIONS_CLIENT,
      ...ENTRY_APPROACH_QUESTIONS,
      ...GOAL_QUESTIONS_CLIENT,
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
