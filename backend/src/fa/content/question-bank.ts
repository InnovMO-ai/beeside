import { QuestionBankBundle, QuestionDef, StageId, StepDef } from "../engine/bundle-types";
import { LIFECYCLE_POLICY_V1, lifecyclePolicyToConfig } from "../services/access-lifecycle";
import { PREMIUM_COPY, PREMIUM_TERMS_URL, PREVIEW_ROOM_URL } from "../../premium/content";
import { Bi } from "./helpers";
import { BUSINESS_QUESTIONS, GOAL_QUESTIONS, PROJECT_QUESTIONS, STORY_QUESTIONS } from "./questions-project-business";
import { CAPABILITY_QUESTIONS, OPERATION_COMPONENT_QUESTIONS, OPERATION_DETAIL_QUESTIONS } from "./questions-operation";
import { CONSTRAINT_QUESTIONS, PREFERENCE_QUESTIONS, PRIORITY_QUESTIONS } from "./questions-priorities";
import { EMAIL_COPY, STAGES, UI_COPY } from "./ui-copy";

/**
 * Version identifier for this bundle in the question_bank_version registry.
 * fa-qb-1.1.0 keeps every question, step and option of fa-qb-1.0.0 unchanged and adds the
 * operations configuration: the access/communication/retention calendar (`lifecycle`, 15 days
 * provisional), lifecycle email copy with exact dates, the contextual follow-ups, the Premium
 * transition copy and its links — all admin-governed through the versioned publish workflow.
 */
export const FA_QUESTION_BANK_VERSION = "fa-qb-1.1.0";

export const TERMS_URL = "https://www.beeside.you/termsandconditions";

/**
 * Personal-mail domains: an email on one of these is accepted but does not produce a corporate
 * company-matching signal, and shows the non-blocking personal-email note.
 */
const PERSONAL_EMAIL_DOMAINS = [
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com",
  "yahoo.com.mx", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me",
  "protonmail.com", "gmx.com", "gmx.net", "mail.com", "zoho.com", "yandex.com", "hotmail.es",
  "outlook.es", "live.com.mx", "prodigy.net.mx",
];

function questionsStep(id: string, stage: StageId, questions: QuestionDef[], title: Bi, intro?: Bi): StepDef {
  return {
    id,
    stage,
    kind: "questions",
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

const YOUR_OPERATION: Bi = ["Your operation", "Tu operación"];

// Journey (Handoff v1 §7): project story → Set Your Goal → Your Project → Your Business →
// Your Operation → What needs to happen first? → What could affect your plan? → remaining
// preferred-name/language context → Snapshot (automatic, Phase 8). No review screen.
const STEPS: StepDef[] = [
  questionsStep("project_story", "project", STORY_QUESTIONS, ["Tell us about your project.", "Cuéntanos sobre tu proyecto."]),
  questionsStep("goal", "project", GOAL_QUESTIONS, ["Set your goal", "Define tu objetivo"]),
  questionsStep("project", "project", PROJECT_QUESTIONS, ["Your project", "Tu proyecto"]),
  transitionStep("business_transition", "business", [
    "Now let’s look at how your business creates value.",
    "Ahora veamos cómo tu negocio genera valor.",
  ]),
  questionsStep("business", "business", BUSINESS_QUESTIONS, ["Your business", "Tu negocio"]),
  transitionStep("operation_transition", "operation", [
    "Now let’s look at what keeps your business running.",
    "Ahora veamos qué mantiene funcionando tu negocio.",
  ]),
  questionsStep("operation_components", "operation", OPERATION_COMPONENT_QUESTIONS, YOUR_OPERATION),
  questionsStep("operation_details", "operation", OPERATION_DETAIL_QUESTIONS, YOUR_OPERATION),
  questionsStep("operation_capabilities", "operation", CAPABILITY_QUESTIONS, YOUR_OPERATION),
  questionsStep("priorities", "priorities", PRIORITY_QUESTIONS, ["What needs to happen first?", "¿Qué necesita suceder primero?"]),
  questionsStep("constraints", "priorities", CONSTRAINT_QUESTIONS, ["What could affect your plan?", "¿Qué podría afectar tu plan?"]),
  questionsStep("preferences", "priorities", PREFERENCE_QUESTIONS, ["A few final details", "Unos últimos detalles"]),
];

export function buildQuestionBankBundle(): QuestionBankBundle {
  return {
    schema_version: 1,
    product: "first_assessment",
    locales: ["en", "es"],
    variables: ["preferred_name", "access_until", "company_name", "days_left", "recoverable_until", "until"],
    stages: STAGES,
    steps: STEPS,
    questions: [
      ...STORY_QUESTIONS,
      ...GOAL_QUESTIONS,
      ...PROJECT_QUESTIONS,
      ...BUSINESS_QUESTIONS,
      ...OPERATION_COMPONENT_QUESTIONS,
      ...OPERATION_DETAIL_QUESTIONS,
      ...CAPABILITY_QUESTIONS,
      ...PRIORITY_QUESTIONS,
      ...CONSTRAINT_QUESTIONS,
      ...PREFERENCE_QUESTIONS,
    ],
    identity: { personal_email_domains: PERSONAL_EMAIL_DOMAINS },
    // The Privacy Policy URL is a configurable canonical setting that is not yet defined: it stays
    // null (never invented) and acceptances record which configuration version was shown.
    links: { terms_url: TERMS_URL, privacy_policy_url: null, preview_room_url: PREVIEW_ROOM_URL, premium_terms_url: PREMIUM_TERMS_URL },
    ui: UI_COPY,
    emails: EMAIL_COPY,
    lifecycle: lifecyclePolicyToConfig(LIFECYCLE_POLICY_V1),
    premium: { copy: PREMIUM_COPY },
  };
}
