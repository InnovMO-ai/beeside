import { QuestionBankBundle, QuestionDef, StageDef, StageId, StepDef } from "../engine/bundle-types";
import { LIFECYCLE_POLICY_V1, lifecyclePolicyToConfig } from "../services/access-lifecycle";
import { PREMIUM_COPY, PREMIUM_TERMS_URL, PREVIEW_ROOM_URL } from "../../premium/content";
import { Bi, q, requiredQuestion } from "./helpers";
import { BUSINESS_QUESTIONS, GOAL_QUESTIONS, PROJECT_QUESTIONS, STORY_QUESTIONS } from "./questions-project-business";
import { CAPABILITY_QUESTIONS } from "./questions-operation";
import { CONSTRAINT_QUESTIONS, PREFERENCE_QUESTIONS, PRIORITY_QUESTIONS } from "./questions-priorities";
import { COMPANY_QUESTIONS, ENTRY_APPROACH_QUESTIONS, NEEDS_QUESTIONS, PLAN_QUESTIONS, PRIORITY_TIMING_QUESTIONS, PROVIDER_QUESTIONS } from "./questions-level2";
import { MANUFACTURING_FOLLOWUP_QUESTIONS, NEEDS_FOLLOWUP_QUESTIONS } from "./questions-needs-followups";
import { EMAIL_COPY, UI_COPY } from "./ui-copy";

/**
 * beeside First Assessment — fa-qb-2.1.0.
 *
 * Product Owner decision (2026-09-30, "PRODUCT OWNER DECISIONS — A AND B ARE NOW CLOSED", Decision
 * A): fa-qb-2.0.0's own seven compositions (Your Company, Your Project, Plan Definition, Priorities,
 * Needs Landscape, Provider Profile + Resources, Review — themselves a deliberate, documented owner
 * decision from the 2026-09-18 alignment pass, see question-bank-v2.ts's file header) are
 * superseded: the client-facing journey must instead match the frozen PRE-SNAPSHOT Design Freeze
 * exactly:
 *
 *   Identity (pre-questionnaire, outside the rail — unchanged, still Identity.tsx)
 *   1. Your Company
 *   2. Your Project
 *   3. Objectives & Market
 *   4. What You Need
 *   5. Activation Order
 *   6. Project Rules
 *   7. Resources & Review
 *   8. Snapshot
 *
 * This file is a NEW version, per Decision B ("Create a NEW version rather than editing the
 * existing v2 bundle in place"). fa-qb-2.0.0 (question-bank-v2.ts) is untouched — every project
 * already pinned to fa-qb-1.1.0 or fa-qb-2.0.0 keeps running exactly as it does today, unaffected by
 * anything in this file. This bundle reuses fa-qb-2.0.0's exact question set, field_keys, gates and
 * copy — including every owner decision documented in that file's header (SP2/G5/G6/ANOTHER_PROJECT
 * removals, GROWTH1's relocation into "Your Project," the Needs Explorer fork-resolution, etc.) —
 * unchanged. The ONLY thing this file changes is which of the eight canonical stages each existing
 * question group is grouped under. No question, field_key, option value, or gate condition was
 * added, removed, or reworded from fa-qb-2.0.0.
 *
 * STAGE-CONTENT MAPPING (old fa-qb-2.0.0 composition → new canonical stage; only what moved is
 * called out — anything not listed stayed exactly where it was):
 *   - GOAL_QUESTIONS_CLIENT (G1-G4: primary goal, success definition, launch timing) moves from
 *     "Your Project" to "Objectives & Market" — these are objectives, not project-description
 *     content (PDF/Design Canvas screen "objetivos-exito"). GROWTH1 stays in "Your Project," per
 *     the explicit, rules-engine-load-bearing owner decision that placed it there (see
 *     question-bank-v2.ts's header) — today's stage-naming decision does not reopen that placement.
 *   - PLAN_QUESTIONS (PL1-PL5: first customer, route to market, demand evidence, competitive
 *     landscape, business case) moves from its own "Plan Definition" composition into "Objectives &
 *     Market" — this is market-evidence content (Design Canvas screens
 *     "mercado-validacion/cliente/ventaja"), not a stage of its own.
 *   - CONSTRAINT_QUESTIONS (C1-C6, SP3, C3_AREAS, C_CONTRACT, C4_AREAS) moves out of "Priorities"
 *     into a new "Project Rules" stage — constraints/non-negotiables/commitments are exactly what
 *     the Design Canvas's "reglas-criterios"/"reglas-restricciones" screens cover; they were only
 *     folded into Priorities in fa-qb-2.0.0 for lack of an approved stage of their own at the time
 *     (see that file's header).
 *   - PRIORITY_QUESTIONS + PRIORITY_TIMING_QUESTIONS (D1-D4, STOPGO, PR_FLEX, PR_FLEX_REASON) stay
 *     together and become the new "Activation Order" stage — "what needs to move first, when" is
 *     exactly the Design Canvas's "orden-activacion" screen.
 *   - PROVIDER_QUESTIONS splits along its own two natural concerns (unchanged questions, only
 *     regrouped): PV1-PV6 (values sought in providers, language/presence requirements, restricted
 *     counterparties) move into "Project Rules," alongside CONSTRAINT_QUESTIONS — these are
 *     selection criteria/restrictions on partners, matching "reglas-criterios"/"reglas-restricciones"
 *     exactly as much as C1-C6 do. PV7-PV9 (investment range, internal resource availability) stay,
 *     with PREFERENCE_QUESTIONS, in the "Resources" step of the new "Resources & Review" stage —
 *     resourcing content, matching the Design Canvas's "recursos" screen.
 *   - "Resources" and "Review" are two separate steps/screens (unchanged from fa-qb-2.0.0) but now
 *     share ONE stage id, `l3_resources_review`, so the rail shows one "Resources & Review" item
 *     spanning both — exactly matching the Design Freeze's single 7th stage spanning two screens.
 *   - A terminal `snapshot` stage entry is appended (id literally `"snapshot"`, matching
 *     fa-qb-1.1.0's STAGES and the hardcoded string App.tsx already sets as `currentStage` on the
 *     completion screen) so the rail's 8th item, "Snapshot," renders; Identity remains outside the
 *     rail (unchanged, pre-Journey screen).
 *
 * Not touched by this pass, deliberately: Your Company (COMPANY_QUESTIONS, B1/B2,
 * BUSINESS_QUESTIONS_CLIENT, MANUFACTURING_FOLLOWUP_QUESTIONS), Your Project's own STORY/
 * ENTRY_APPROACH/PROJECT_QUESTIONS/GROWTH1 core, What You Need (NEEDS_MAP/NEEDS_FOLLOWUP_QUESTIONS/
 * NEEDS_CONTEXT), and Review — all identical to fa-qb-2.0.0, only their stage id changed where the
 * canonical name itself changed.
 *
 * ADDED by this pass (PRE-SNAPSHOT scope item 5, not a fa-qb-2.0.0 parity item): one new, genuinely
 * additive "Leave a note" question per major section (SECTION_NOTE_QUESTIONS below) — optional,
 * unscored free text, rendered by the client as a collapsed post-it via StepDef.note_field_id
 * rather than inline. "What You Need" reuses its existing NEEDS_CONTEXT field for this instead of a
 * new question. This is the one place this bundle's question SET differs from fa-qb-2.0.0's — every
 * other question, field_key, option value and gate condition is unchanged, per Decision A ("do not
 * invent new business logic or questions merely to make the stage counts fit" — this is not that:
 * it is the explicitly named scope item 5 itself, not an invented filler question).
 */
export const FA_QUESTION_BANK_VERSION_V21 = "fa-qb-2.1.0";

export { TERMS_URL } from "./question-bank";

const PERSONAL_EMAIL_DOMAINS = [
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com",
  "yahoo.com.mx", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me",
  "protonmail.com", "gmx.com", "gmx.net", "mail.com", "zoho.com", "yandex.com", "hotmail.es",
  "outlook.es", "live.com.mx", "prodigy.net.mx",
];

function groupedStep(id: string, stage: StageId, questions: QuestionDef[], title: Bi, intro?: Bi, noteFieldId?: string): StepDef {
  return {
    id,
    stage,
    kind: "questions",
    layout: "grouped",
    question_ids: questions.map((q) => q.id),
    ...(noteFieldId ? { note_field_id: noteFieldId } : {}),
    copy: {
      en: { title: title[0], ...(intro ? { intro: intro[0] } : {}) },
      es: { title: title[1], ...(intro ? { intro: intro[1] } : {}) },
    },
  };
}

function reviewStep(id: string, stage: StageId, title: Bi, intro: Bi): StepDef {
  return { id, stage, kind: "review", question_ids: [], copy: { en: { title: title[0], intro: intro[0] }, es: { title: title[1], intro: intro[1] } } };
}

// Every derivation below is byte-identical to question-bank-v2.ts's own (same owner decisions, same
// source arrays) — duplicated here rather than imported because they are module-local consts there,
// not exports; see that file for the full rationale behind each one.
const [rawB1, rawB2, ...REMAINING_BUSINESS_QUESTIONS] = BUSINESS_QUESTIONS;
const B1 = requiredQuestion(rawB1, "B1 (BUSINESS_QUESTIONS[0])");
const B2 = requiredQuestion(rawB2, "B2 (BUSINESS_QUESTIONS[1])");
const BUSINESS_QUESTIONS_CLIENT = REMAINING_BUSINESS_QUESTIONS.filter((q) => q.id !== "SP2");

const STORY_QUESTIONS_CLIENT = STORY_QUESTIONS.filter((q) => q.id !== "ANOTHER_PROJECT");

const GOAL_QUESTIONS_CLIENT = GOAL_QUESTIONS.filter((q) => q.id !== "G5" && q.id !== "G6");

const [, , , rawGrowth1] = CAPABILITY_QUESTIONS;
const GROWTH1 = requiredQuestion(rawGrowth1, "GROWTH1 (CAPABILITY_QUESTIONS[3])");

const [rawNeedsMap, rawNeedsContext] = NEEDS_QUESTIONS;
const NEEDS_MAP = requiredQuestion(rawNeedsMap, "NEEDS_MAP (NEEDS_QUESTIONS[0])");
const NEEDS_CONTEXT = requiredQuestion(rawNeedsContext, "NEEDS_CONTEXT (NEEDS_QUESTIONS[1])");

// PROVIDER_QUESTIONS (questions-level2.ts) is authored in this exact order — PV1-PV6 (values,
// language/presence requirements, restricted counterparties) then PV7-PV9 (investment range,
// internal resource availability) — so a plain array slice, with no reordering, cleanly separates
// its two concerns across the two new stages they now belong to. Same pattern this codebase already
// uses for BUSINESS_QUESTIONS/CAPABILITY_QUESTIONS/NEEDS_QUESTIONS above and in question-bank-v2.ts.
const PROVIDER_CRITERIA_QUESTIONS = PROVIDER_QUESTIONS.slice(0, 6); // PV1-PV6
const PROVIDER_RESOURCE_QUESTIONS = PROVIDER_QUESTIONS.slice(6); // PV7-PV9

/**
 * "Leave a note" affordance (Design Freeze, PRE-SNAPSHOT scope item 5): one optional, unscored
 * free-text question per major section, rendered by the client as a collapsed post-it in the
 * screen's corner (StepDef.note_field_id) rather than inline with the section's own questions —
 * per the beeside-platforms skill ("Each major FA section may include an optional 'Leave a
 * note' ... Do not score these notes automatically. Preserve them as direct client context and
 * make them available to Snapshot and Precision"). Ordinary optional text questions in every other
 * respect: normal field_key, normal answer/validation/Review-recap/Precision-context path — only
 * their on-screen placement differs. "What You Need" already has an equivalent field
 * (NEEDS_CONTEXT, fa.needs.additional_context) from fa-qb-2.0.0; it is reused as that step's note
 * affordance below rather than duplicated.
 */
const SECTION_NOTE_QUESTIONS: QuestionDef[] = [
  q({
    id: "NOTE_COMPANY",
    field_key: "fa.company.notes",
    type: "text",
    required: false,
    title: ["Anything else about your company we should know?", "\u00bfAlgo m\u00e1s sobre tu empresa que debamos saber?"],
  }),
  q({
    id: "NOTE_PROJECT",
    field_key: "fa.project.notes",
    type: "text",
    required: false,
    title: ["Anything else about your project we should know?", "\u00bfAlgo m\u00e1s sobre tu proyecto que debamos saber?"],
  }),
  q({
    id: "NOTE_OBJECTIVES",
    field_key: "fa.objectives.notes",
    type: "text",
    required: false,
    title: ["Anything else about your objectives we should know?", "\u00bfAlgo m\u00e1s sobre tus objetivos que debamos saber?"],
  }),
  q({
    id: "NOTE_MARKET",
    field_key: "fa.market.notes",
    type: "text",
    required: false,
    title: ["Anything else about the market we should know?", "\u00bfAlgo m\u00e1s sobre el mercado que debamos saber?"],
  }),
  q({
    id: "NOTE_ACTIVATION",
    field_key: "fa.activation.notes",
    type: "text",
    required: false,
    title: ["Anything else about your activation order we should know?", "\u00bfAlgo m\u00e1s sobre tu orden de activaci\u00f3n que debamos saber?"],
  }),
  q({
    id: "NOTE_RULES",
    field_key: "fa.rules.notes",
    type: "text",
    required: false,
    title: ["Anything else about your project rules we should know?", "\u00bfAlgo m\u00e1s sobre las reglas de tu proyecto que debamos saber?"],
  }),
  q({
    id: "NOTE_RESOURCES",
    field_key: "fa.resources.notes",
    type: "text",
    required: false,
    title: ["Anything else about your resources we should know?", "\u00bfAlgo m\u00e1s sobre tus recursos que debamos saber?"],
  }),
];
const [rawNoteCompany, rawNoteProject, rawNoteObjectives, rawNoteMarket, rawNoteActivation, rawNoteRules, rawNoteResources] = SECTION_NOTE_QUESTIONS;
const NOTE_COMPANY = requiredQuestion(rawNoteCompany, "NOTE_COMPANY (SECTION_NOTE_QUESTIONS[0])");
const NOTE_PROJECT = requiredQuestion(rawNoteProject, "NOTE_PROJECT (SECTION_NOTE_QUESTIONS[1])");
const NOTE_OBJECTIVES = requiredQuestion(rawNoteObjectives, "NOTE_OBJECTIVES (SECTION_NOTE_QUESTIONS[2])");
const NOTE_MARKET = requiredQuestion(rawNoteMarket, "NOTE_MARKET (SECTION_NOTE_QUESTIONS[3])");
const NOTE_ACTIVATION = requiredQuestion(rawNoteActivation, "NOTE_ACTIVATION (SECTION_NOTE_QUESTIONS[4])");
const NOTE_RULES = requiredQuestion(rawNoteRules, "NOTE_RULES (SECTION_NOTE_QUESTIONS[5])");
const NOTE_RESOURCES = requiredQuestion(rawNoteResources, "NOTE_RESOURCES (SECTION_NOTE_QUESTIONS[6])");

const STEPS_V21: StepDef[] = [
  // 1 — Your Company (unchanged from fa-qb-2.0.0's l2_company)
  groupedStep(
    "l3_company",
    "l3_company",
    [...COMPANY_QUESTIONS, B1, B2, ...BUSINESS_QUESTIONS_CLIENT, ...MANUFACTURING_FOLLOWUP_QUESTIONS, NOTE_COMPANY],
    ["Your company", "Tu empresa"],
    ["A little about who you are and how your company operates today.", "Un poco sobre quién eres y cómo opera tu empresa hoy."],
    "NOTE_COMPANY",
  ),

  // 2 — Your Project (GOAL_QUESTIONS_CLIENT moved out to Objectives & Market — see file header)
  groupedStep(
    "l3_project",
    "l3_project",
    [...STORY_QUESTIONS_CLIENT, ...ENTRY_APPROACH_QUESTIONS, ...PROJECT_QUESTIONS, GROWTH1, NOTE_PROJECT],
    ["Your project", "Tu proyecto"],
    ["Tell us what you're planning and where it's headed.", "Cuéntanos qué estás planeando y hacia dónde va."],
    "NOTE_PROJECT",
  ),

  // 3a — Objectives (shares the "Objectives & Market" stage with Market, below). Two separate
  // screens/steps, not one combined grouped composition, matching the Design Freeze's own separate
  // "objetivos-exito"/"objetivos-proteger" vs. "mercado-*" boards, and giving Review its two named
  // blocks ("Tus objetivos" / "El mercado") with independent edit-and-return. Same
  // one-stage/two-steps pattern already used below for "Resources & Review".
  groupedStep(
    "l3_objectives",
    "l3_objectives_market",
    [...GOAL_QUESTIONS_CLIENT, NOTE_OBJECTIVES],
    ["Your objectives", "Tus objetivos"],
    ["What you're trying to accomplish in this market.", "Qué quieres lograr en este mercado."],
    "NOTE_OBJECTIVES",
  ),

  // 3b — Market (shares the "Objectives & Market" stage with Objectives, above)
  groupedStep(
    "l3_market",
    "l3_objectives_market",
    [...PLAN_QUESTIONS, NOTE_MARKET],
    ["The market", "El mercado"],
    ["The evidence behind it — customers, demand, competition.", "La evidencia que lo respalda: clientes, demanda, competencia."],
    "NOTE_MARKET",
  ),


  // 4 — What You Need (unchanged from fa-qb-2.0.0's l2_needs_landscape)
  groupedStep(
    "l3_needs",
    "l3_needs",
    [NEEDS_MAP, ...NEEDS_FOLLOWUP_QUESTIONS, NEEDS_CONTEXT],
    ["What you need", "Lo que necesitas"],
    [
      "Map what's still open, then rank what matters most — one continuous flow, no need to backtrack.",
      "Mapea lo que sigue abierto y luego ordena lo que más importa: un solo flujo continuo, sin necesidad de retroceder.",
    ],
    "NEEDS_CONTEXT",
  ),

  // 5 — Activation Order (was "Priorities," minus the constraint questions — see file header)
  groupedStep(
    "l3_activation",
    "l3_activation",
    [...PRIORITY_QUESTIONS, ...PRIORITY_TIMING_QUESTIONS, NOTE_ACTIVATION],
    ["Your activation order", "Tu orden de activación"],
    ["What needs to happen first, and when.", "Qué necesita suceder primero, y cuándo."],
    "NOTE_ACTIVATION",
  ),

  // 6 — Project Rules (new stage: constraints from "Priorities" + provider criteria from "Provider
  // Profile + Resources" — see file header)
  groupedStep(
    "l3_rules",
    "l3_rules",
    [...CONSTRAINT_QUESTIONS, ...PROVIDER_CRITERIA_QUESTIONS, NOTE_RULES],
    ["Your project rules", "Las reglas de tu proyecto"],
    [
      "What could affect your plan, and what matters most in the people you work with.",
      "Qué podría afectar tu plan, y qué es lo más importante en las personas con quienes trabajarás.",
    ],
    "NOTE_RULES",
  ),

  // 7 — Resources (shares the "Resources & Review" stage with Review, below)
  groupedStep(
    "l3_resources",
    "l3_resources_review",
    [...PROVIDER_RESOURCE_QUESTIONS, ...PREFERENCE_QUESTIONS, NOTE_RESOURCES],
    ["Your resources", "Tus recursos"],
    [
      "What you have available to execute, and a few final preferences.",
      "Con qué cuentas para ejecutar, y algunas preferencias finales.",
    ],
    "NOTE_RESOURCES",
  ),

  // 8 — Review (unchanged from fa-qb-2.0.0's l2_review; now shares the "Resources & Review" stage)
  reviewStep(
    "l3_review",
    "l3_resources_review",
    ["Review how we understood your project", "Revisa cómo entendimos tu proyecto"],
    [
      "Before we generate your Snapshot, review how we understood your project. If anything does not accurately reflect what you shared, this is the moment to adjust it.",
      "Antes de generar tu Snapshot, revisa cómo entendimos tu proyecto. Si algo no refleja con precisión lo que compartiste, este es el momento de ajustarlo.",
    ],
  ),
];

// The eight canonical stages from the frozen PRE-SNAPSHOT Design Freeze, in order. "Resources" and
// "Review" (two steps, above) intentionally share the one "Resources & Review" entry here, so the
// rail shows exactly this list — no more, no fewer. `snapshot` reuses fa-qb-1.1.0's own id (not a
// new `l3_snapshot`) because App.tsx hardcodes the literal string `"snapshot"` as `currentStage` on
// the completion screen; it must match exactly for the rail to highlight it. Identity is not listed
// here — it is a pre-Journey screen (Identity.tsx), outside `bundle.stages` entirely, unchanged.
const STAGES_V21: StageDef[] = [
  { id: "l3_company", copy: { en: { label: "Your Company" }, es: { label: "Tu Empresa" } } },
  { id: "l3_project", copy: { en: { label: "Your Project" }, es: { label: "Tu Proyecto" } } },
  { id: "l3_objectives_market", copy: { en: { label: "Objectives & Market" }, es: { label: "Objetivos y Mercado" } } },
  { id: "l3_needs", copy: { en: { label: "What You Need" }, es: { label: "Lo Que Necesitas" } } },
  { id: "l3_activation", copy: { en: { label: "Activation Order" }, es: { label: "Orden de Activación" } } },
  { id: "l3_rules", copy: { en: { label: "Project Rules" }, es: { label: "Reglas del Proyecto" } } },
  { id: "l3_resources_review", copy: { en: { label: "Resources & Review" }, es: { label: "Recursos y Revisión" } } },
  { id: "snapshot", copy: { en: { label: "Snapshot" }, es: { label: "Snapshot" } } },
];

export function buildQuestionBankBundleV21(): QuestionBankBundle {
  return {
    schema_version: 1,
    product: "first_assessment",
    locales: ["en", "es"],
    // Same shared ui/emails copy as fa-qb-1.1.0/fa-qb-2.0.0 — see question-bank.ts's comment on this
    // list for what each addition backs.
    variables: [
      "preferred_name", "access_until", "company_name", "days_left", "recoverable_until", "until",
      "retention_until", "count", "max", "tag", "name",
    ],
    stages: STAGES_V21,
    steps: STEPS_V21,
    // Same exclusions as fa-qb-2.0.0 (SP2, ANOTHER_PROJECT, G5, G6 — see question-bank-v2.ts's file
    // header, "OWNER DECISIONS"): the validator requires every bundle.questions entry to appear in
    // exactly one step's question_ids, and these four are still not client-facing in this bundle
    // either.
    questions: [
      ...COMPANY_QUESTIONS,
      B1,
      B2,
      ...BUSINESS_QUESTIONS_CLIENT,
      ...MANUFACTURING_FOLLOWUP_QUESTIONS,
      ...STORY_QUESTIONS_CLIENT,
      ...ENTRY_APPROACH_QUESTIONS,
      ...PROJECT_QUESTIONS,
      GROWTH1,
      ...GOAL_QUESTIONS_CLIENT,
      ...PLAN_QUESTIONS,
      ...NEEDS_FOLLOWUP_QUESTIONS,
      ...PRIORITY_QUESTIONS,
      ...PRIORITY_TIMING_QUESTIONS,
      ...CONSTRAINT_QUESTIONS,
      ...PROVIDER_CRITERIA_QUESTIONS,
      ...NEEDS_QUESTIONS,
      ...PROVIDER_RESOURCE_QUESTIONS,
      ...PREFERENCE_QUESTIONS,
      ...SECTION_NOTE_QUESTIONS,
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
