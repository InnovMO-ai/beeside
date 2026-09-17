import { Bundle, SessionView } from "./types";

export const TEST_BUNDLE: Bundle = {
  schema_version: 1,
  locales: ["en", "es"],
  stages: [
    { id: "project", copy: { en: { label: "Project" }, es: { label: "Proyecto" } } },
    { id: "business", copy: { en: { label: "Business" }, es: { label: "Negocio" } } },
    { id: "operation", copy: { en: { label: "Operation" }, es: { label: "Operación" } } },
    { id: "priorities", copy: { en: { label: "Priorities" }, es: { label: "Prioridades" } } },
    { id: "snapshot", copy: { en: { label: "Snapshot" }, es: { label: "Snapshot" } } },
  ],
  steps: [
    { id: "goal", stage: "project", kind: "questions", question_ids: ["G1", "C1"], copy: { en: { title: "Set your goal" }, es: { title: "Define tu objetivo" } } },
    { id: "business_transition", stage: "business", kind: "transition", question_ids: [], copy: { en: { title: "Now your business." }, es: { title: "Ahora tu negocio." } } },
  ],
  questions: [
    {
      id: "G1",
      field_key: "fa.goal.primary_goal",
      type: "single_select",
      required: true,
      options: [
        { value: "enter_market", copy: { en: "Enter a new market", es: "Entrar a un nuevo mercado" } },
        { value: "not_sure", copy: { en: "Not sure yet", es: "Todavía no estoy seguro" } },
      ],
      copy: { en: { title: "What is the main goal?" }, es: { title: "¿Cuál es el objetivo principal?" } },
    },
    {
      id: "C1",
      field_key: "fa.constraints.items",
      type: "multi_select",
      required: false,
      exclusive_values: ["not_sure"],
      options: [
        { value: "banking", copy: { en: "Banking", es: "Banca" } },
        { value: "insurance", copy: { en: "Insurance", es: "Seguros" } },
        { value: "not_sure", copy: { en: "Not sure", es: "No estoy seguro" } },
      ],
      copy: { en: { title: "What could affect your plan?" }, es: { title: "¿Qué podría afectar tu plan?" } },
    },
  ],
  identity: { personal_email_domains: ["gmail.com"] },
  links: { terms_url: "https://www.beeside.you/termsandconditions", privacy_policy_url: null },
  ui: {
    common: { copy: { en: { continue: "Continue", back: "Back", required_error: "Please answer to continue.", optional: "Optional" }, es: { continue: "Continuar" } } },
    welcome: { copy: { en: { headline: "Your expansion starts with a clearer picture.", cta: "Start my assessment" }, es: { headline: "Tu expansión empieza con una visión más clara.", cta: "Iniciar mi evaluación" } } },
    assemble: { copy: { en: { headline: "Putting the pieces together.", body: "We’re assembling your Expansion Snapshot from what you shared." }, es: { headline: "Armando las piezas.", body: "Estamos preparando tu Expansion Snapshot con lo que compartiste." } } },
    virtual_snapshot: {
      copy: {
        en: {
          big_picture_title: "The big picture",
          big_picture_intro: "Six dimensions of your project, and how clearly each one is defined today.",
          radar_accessible_summary: "Definition by dimension",
          stand_out_title: "What stands out",
          stand_out_intro: "From the big picture, here is where you have a solid foundation and where to focus first.",
          opening_project_label: "Your project",
          opening_objectives_label: "Your objectives",
          opening_requirements_label: "Your requirements",
          opening_requirements_empty: "You haven’t flagged any fixed constraints or commitments yet.",
        },
        es: {
          big_picture_title: "El panorama general",
          big_picture_intro: "Seis dimensiones de tu proyecto, y qué tan definida está cada una hoy.",
          radar_accessible_summary: "Nivel de definición por dimensión",
          stand_out_title: "Lo que más destaca",
          stand_out_intro: "Del panorama general, aquí tienes una base sólida y aquí conviene enfocarte primero.",
          opening_project_label: "Tu proyecto",
          opening_objectives_label: "Tus objetivos",
          opening_requirements_label: "Tus requisitos",
          opening_requirements_empty: "Todavía no has señalado restricciones o compromisos fijos.",
        },
      },
    },
  },
};

export function testView(overrides: Partial<SessionView> = {}): SessionView {
  return {
    questionBankVersion: "fa-qb-1.0.0",
    status: "IN_PROGRESS",
    currentStepId: "goal",
    lastCompletedStepId: null,
    steps: [
      { id: "goal", applicable: true, confirmed: false, missingRequired: ["G1"], questionIds: ["G1", "C1"] },
      { id: "business_transition", applicable: true, confirmed: false, missingRequired: [], questionIds: [] },
    ],
    answers: {},
    dynamicOptions: {},
    finishLaterAvailable: true,
    anotherProjectInMind: null,
    accessUntil: null,
    interfaceLanguage: "en",
    ...overrides,
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
