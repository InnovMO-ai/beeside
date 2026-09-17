import { QuestionDef, StageId, StepDef } from "../engine/bundle-types";
import { LIFECYCLE_POLICY_V1, lifecyclePolicyToConfig } from "../services/access-lifecycle";
import { PREMIUM_COPY, PREMIUM_TERMS_URL, PREVIEW_ROOM_URL } from "../../premium/content";
import { Bi } from "./helpers";
import { BUSINESS_QUESTIONS, GOAL_QUESTIONS, PROJECT_QUESTIONS, STORY_QUESTIONS } from "./questions-project-business";
import { CAPABILITY_QUESTIONS, OPERATION_COMPONENT_QUESTIONS, OPERATION_DETAIL_QUESTIONS } from "./questions-operation";
import { CONSTRAINT_QUESTIONS, PREFERENCE_QUESTIONS, PRIORITY_QUESTIONS } from "./questions-priorities";
import { COMPANY_QUESTIONS, ENTRY_APPROACH_QUESTIONS, NEEDS_QUESTIONS, PLAN_QUESTIONS, PRIORITY_TIMING_QUESTIONS, PROVIDER_QUESTIONS } from "./questions-level2";
import { EMAIL_COPY, STAGES, UI_COPY } from "./ui-copy";

/**
 * beeside First Assessment — Level 2 MVP bundle (Design Specification "beeside First Assessment —
 * Level 2 MVP", all sections). fa-qb-2.0.0 keeps every question, field_key and option value of
 * fa-qb-1.1.0 completely unchanged — it only re-groups WHERE those questions render (one-question-
 * per-screen -> grouped compositions, `StepDef.layout: "grouped"`) and adds the new composition-5
 * (Needs Landscape) / composition-6 (Provider Profile + Resources) content plus a composition-7
 * Review step. This is a genuinely additive, backward-compatible bundle: any project already pinned
 * to fa-qb-1.1.0 keeps running through the existing one-question-per-screen Journey unchanged.
 *
 * Scope decision, documented rather than guessed (per the owner's own instruction to flag, not
 * silently resolve, a genuine architectural fork): the canonical 8-composition table (0-7) in the
 * Design Specification does not spell out where the existing, already-tested business/operation
 * question tree (B3-B6, O1 + ~30 conditional operation-detail questions, CAP1 capability mother
 * question) lands, because "Areas E and F" (whatever their original, pre-canonical-table content
 * was) are described as merging into composition 5 (Needs Landscape). Removing or replacing that
 * question tree would silently starve the already-baselined, already-tested rules engine
 * (finding / capability_rank / priority_alignment, Phases 7-8) of its inputs — which the owner
 * explicitly said to treat as frozen baseline, reused unless explicitly redefined. This bundle
 * therefore KEEPS that question tree fully intact and unchanged (field_keys, values, internal
 * order), simply grouped into its own "Your Business" / "Your Operation" grouped compositions
 * immediately before Priorities, and treats fa.needs.map (composition 5, Needs Landscape) as an
 * ADDITIONAL, client-declared self-assessment layer alongside it, not a replacement. If the
 * intent was for the Needs Explorer to replace the deep operation question tree, that is a
 * material, hard-to-reverse product decision this bundle deliberately does not make — see the
 * implementation report's open-decisions section.
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

function transitionStep(id: string, stage: StageId, line: Bi): StepDef {
  return { id, stage, kind: "transition", question_ids: [], copy: { en: { title: line[0] }, es: { title: line[1] } } };
}

function reviewStep(id: string, stage: StageId, title: Bi, intro: Bi): StepDef {
  return { id, stage, kind: "review", question_ids: [], copy: { en: { title: title[0], intro: intro[0] }, es: { title: title[1], intro: intro[1] } } };
}

// B1 (description) and B2 (type) move from "Your Business" into composition 1 ("Your Company"),
// per the Design Specification's Area A grouping ("company description ... industry"). Every other
// BUSINESS_QUESTIONS entry (B3-B6, SP2) keeps its existing relative order in "Your Business" below.
const [B1, B2, ...REMAINING_BUSINESS_QUESTIONS] = BUSINESS_QUESTIONS;

const STEPS_V2: StepDef[] = [
  // Composition 1 — Your Company
  groupedStep("l2_company", "project", [...COMPANY_QUESTIONS, B1, B2], ["Your company", "Tu empresa"], [
    "A little about who you are and how your company operates today.",
    "Un poco sobre quién eres y cómo opera tu empresa hoy.",
  ]),

  // Composition 2 — Your Project
  groupedStep(
    "l2_your_project",
    "project",
    [...STORY_QUESTIONS, ...ENTRY_APPROACH_QUESTIONS, ...GOAL_QUESTIONS, ...PROJECT_QUESTIONS],
    ["Your project", "Tu proyecto"],
    ["Tell us what you're planning and where it's headed.", "Cuéntanos qué estás planeando y hacia dónde va."],
  ),

  // Composition 3 — Plan Definition
  groupedStep("l2_plan_definition", "project", PLAN_QUESTIONS, ["How defined is your plan?", "¿Qué tan definido está tu plan?"], [
    "This is about the evidence behind the plan, not how confident you feel about it.",
    "Esto es sobre la evidencia detrás del plan, no sobre qué tan seguro te sientes de él.",
  ]),

  // Kept baseline (see file header): Your Business / Your Operation, unchanged question tree,
  // now grouped instead of one-question-per-screen.
  groupedStep("l2_business", "business", REMAINING_BUSINESS_QUESTIONS, ["Your business", "Tu negocio"]),
  transitionStep("l2_operation_transition", "operation", [
    "Now let's look at what keeps your business running.",
    "Ahora veamos qué mantiene funcionando tu negocio.",
  ]),
  groupedStep(
    "l2_operation",
    "operation",
    [...OPERATION_COMPONENT_QUESTIONS, ...OPERATION_DETAIL_QUESTIONS, ...CAPABILITY_QUESTIONS],
    ["Your operation", "Tu operación"],
    [
      "Select what's relevant — each choice reveals only its own follow-up.",
      "Selecciona lo relevante; cada elección revela únicamente su propio seguimiento.",
    ],
  ),

  // Composition 4 — Priorities
  groupedStep("l2_priorities", "priorities", [...PRIORITY_QUESTIONS, ...PRIORITY_TIMING_QUESTIONS], ["Identify your priorities", "Identifica tus prioridades"]),
  groupedStep("l2_constraints", "priorities", CONSTRAINT_QUESTIONS, ["What could affect your plan?", "¿Qué podría afectar tu plan?"]),

  // Composition 5 — Needs Landscape (merges former Areas E+F)
  groupedStep("l2_needs_landscape", "priorities", NEEDS_QUESTIONS, ["What needs to be resolved?", "¿Qué necesita resolverse?"], [
    "Map what's still open, then rank what matters most — one continuous flow, no need to backtrack.",
    "Mapea lo que sigue abierto y luego ordena lo que más importa: un solo flujo continuo, sin necesidad de retroceder.",
  ]),

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
    variables: ["preferred_name", "access_until", "company_name", "days_left", "recoverable_until", "until"],
    stages: STAGES,
    steps: STEPS_V2,
    questions: [
      ...COMPANY_QUESTIONS,
      ...BUSINESS_QUESTIONS,
      ...STORY_QUESTIONS,
      ...ENTRY_APPROACH_QUESTIONS,
      ...GOAL_QUESTIONS,
      ...PROJECT_QUESTIONS,
      ...PLAN_QUESTIONS,
      ...OPERATION_COMPONENT_QUESTIONS,
      ...OPERATION_DETAIL_QUESTIONS,
      ...CAPABILITY_QUESTIONS,
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
