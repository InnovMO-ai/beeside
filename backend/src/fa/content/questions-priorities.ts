import { QuestionDef } from "../engine/bundle-types";
import { CATEGORY_OPTIONS, SELECT_ALL, opts, q, when } from "./helpers";

// Priorities, constraints and ownership/preferences (Master Build Guide v2 §7.6–§7.9, Functional
// Specification v1 §2.1 structured companions, Rules Matrix v1 §0 category list, Handoff v1 §12
// strategic prompts 3–5). Commitments, constraints and non-negotiables stay separate fields.

const PRIORITY_KNOWN = when.eq("fa.priority.priority_known", "yes");

export const PRIORITY_QUESTIONS: QuestionDef[] = [
  q({
    id: "D1",
    field_key: "fa.priority.priority_known",
    type: "single_select",
    title: ["Is there any area you already know needs to move first?", "¿Hay alguna área que ya sepas que necesita avanzar primero?"],
    options: opts(["yes", "Yes", "Sí"], ["not_yet", "Not yet", "Todavía no"], ["not_sure", "Not sure", "No estoy seguro"]),
  }),
  q({
    id: "D2",
    field_key: "fa.priority.client_priority",
    type: "single_select",
    applies_when: PRIORITY_KNOWN,
    title: ["What needs attention first?", "¿Qué necesita atención primero?"],
    options: CATEGORY_OPTIONS,
  }),
  q({
    id: "D3",
    field_key: "fa.priority.timing",
    type: "single_select",
    applies_when: PRIORITY_KNOWN,
    title: ["When does it need to move?", "¿Cuándo necesita avanzar?"],
    options: opts(
      ["already_in_progress", "It’s already in progress", "Ya está en proceso"],
      ["immediately", "Immediately", "De inmediato"],
      ["within_30_days", "Within 30 days", "En los próximos 30 días"],
      ["1_3_months", "In 1–3 months", "En 1–3 meses"],
      ["3_6_months", "In 3–6 months", "En 3–6 meses"],
      ["later", "Later", "Más adelante"],
    ),
  }),
  q({
    id: "D4",
    field_key: "fa.priority.reason",
    type: "text",
    required: false,
    applies_when: PRIORITY_KNOWN,
    title: ["Why does this need to happen first?", "¿Por qué necesita suceder primero?"],
  }),
  q({
    id: "STOPGO",
    field_key: "fa.project.stop_go_criteria",
    type: "multi_select",
    applies_when: when.in("fa.project.stage", "exploring", "business_case", "validating"),
    title: ["What could make you decide not to move forward?", "¿Qué podría hacerte decidir no avanzar?"],
    helper: SELECT_ALL,
    exclusive_values: ["nothing_specific"],
    options: opts(
      ["economics", "The economics don’t work", "Los números no funcionan"],
      ["demand", "Demand isn’t strong enough", "La demanda no es suficiente"],
      ["regulatory_complexity", "Regulatory complexity", "Complejidad regulatoria"],
      ["investment_too_high", "The investment is too high", "La inversión es demasiado alta"],
      ["partners_suppliers", "We can’t find the right partners or suppliers", "No encontramos a los socios o proveedores adecuados"],
      ["timeline", "The timeline isn’t achievable", "El plazo no es alcanzable"],
      ["internal_capacity", "Internal capacity", "Capacidad interna"],
      ["nothing_specific", "Nothing specific yet", "Nada en específico por ahora"],
      ["other", "Other", "Otro"],
    ),
  }),
];

export const CONSTRAINT_QUESTIONS: QuestionDef[] = [
  q({
    id: "C1",
    field_key: "fa.constraints.items",
    type: "multi_select",
    title: ["Which of these could affect your plan?", "¿Cuáles de estas áreas podrían afectar tu plan?"],
    helper: SELECT_ALL,
    exclusive_values: ["not_sure"],
    options: [...CATEGORY_OPTIONS, ...opts(["not_sure", "Not sure", "No estoy seguro"])],
  }),
  q({
    id: "C2",
    field_key: "fa.constraints.critical",
    type: "single_select",
    options_from: { field: "fa.constraints.items", exclude: ["not_sure"] },
    applies_when: { field: "fa.constraints.items", op: "selected_count_gte", value: 2, exclude: ["not_sure"] },
    title: ["Which of these could have the biggest impact?", "¿Cuál de estas podría tener el mayor impacto?"],
  }),
  q({
    id: "SP3",
    field_key: "fa.strategic.slowdown_concern",
    type: "text",
    title: [
      "What are you most concerned could slow the project down or make it more expensive?",
      "¿Qué te preocupa más que pueda frenar el proyecto o hacerlo más costoso?",
    ],
  }),
  q({
    id: "C3",
    field_key: "fa.constraints.existing_commitments",
    type: "text",
    title: [
      "What commitments have already been made — customers, suppliers, contracts, facilities or internal approvals?",
      "¿Qué compromisos ya se han hecho: clientes, proveedores, contratos, instalaciones o aprobaciones internas?",
    ],
    helper: ["If nothing has been committed yet, just say so.", "Si todavía no hay compromisos, basta con decirlo."],
  }),
  q({
    id: "C3_AREAS",
    field_key: "fa.constraints.commitment_areas",
    type: "multi_select",
    applies_when: when.answered("fa.constraints.existing_commitments"),
    title: ["Which areas do those commitments involve?", "¿Qué áreas involucran esos compromisos?"],
    helper: SELECT_ALL,
    exclusive_values: ["none"],
    options: [...CATEGORY_OPTIONS, ...opts(["none", "No commitments yet", "Todavía no hay compromisos"])],
  }),
  q({
    id: "C_CONTRACT",
    field_key: "fa.constraints.has_customer_contract",
    type: "single_select",
    title: [
      "Is there already a customer contract or commitment the expansion needs to fulfill?",
      "¿Ya existe un contrato o compromiso con un cliente que la expansión deba cumplir?",
    ],
    options: opts(["yes", "Yes", "Sí"], ["no", "No", "No"]),
  }),
  q({
    id: "C4",
    field_key: "fa.constraints.non_negotiables",
    type: "text",
    title: [
      "Is there anything about your current operating model that you do not want to compromise as you expand?",
      "¿Hay algo de tu modelo operativo actual que no quieras comprometer al expandirte?",
    ],
    helper: ["If nothing is fixed yet, just say so.", "Si todavía no hay nada definido, basta con decirlo."],
  }),
  q({
    id: "C4_AREAS",
    field_key: "fa.constraints.non_negotiable_areas",
    type: "multi_select",
    applies_when: when.answered("fa.constraints.non_negotiables"),
    title: ["Which areas does that involve?", "¿Qué áreas involucra?"],
    helper: SELECT_ALL,
    exclusive_values: ["none"],
    options: [...CATEGORY_OPTIONS, ...opts(["none", "Nothing non-negotiable yet", "Nada innegociable por ahora"])],
  }),
  q({
    id: "C5",
    field_key: "fa.project.primary_concern",
    type: "text",
    title: ["What are you most concerned about getting wrong?", "¿Qué es lo que más te preocupa hacer mal?"],
  }),
  q({
    id: "C6",
    field_key: "fa.project.additional_context",
    type: "text",
    required: false,
    title: ["Anything else we should know?", "¿Algo más que debamos saber?"],
  }),
];

const LANGUAGES = opts(["en", "English", "English"], ["es", "Español", "Español"]);

export const PREFERENCE_QUESTIONS: QuestionDef[] = [
  q({
    id: "S1",
    field_key: "fa.ownership.project_responsibility",
    type: "single_select",
    title: ["Are you the main person responsible for this expansion project?", "¿Eres la persona principal responsable de este proyecto de expansión?"],
    options: opts(
      ["leading", "Yes, I’m leading it", "Sí, yo lo lidero"],
      ["part_of_team", "I’m part of the team", "Soy parte del equipo"],
      ["someone_else_leading", "Someone else is leading it", "Alguien más lo lidera"],
      ["being_defined", "Responsibility is still being defined", "La responsabilidad todavía se está definiendo"],
    ),
  }),
  q({
    id: "S5",
    field_key: "fa.preferences.preferred_name",
    type: "short_text",
    required: false,
    max_length: 80,
    title: ["How would you like us to address you?", "¿Cómo te gustaría que te llamemos?"],
  }),
  q({
    id: "S6_INTERACTION",
    field_key: "fa.preferences.interaction_language",
    type: "locale",
    title: ["Which language would you prefer for future conversations with beeside?", "¿En qué idioma prefieres nuestras próximas conversaciones con beeside?"],
    options: LANGUAGES,
  }),
  q({
    id: "S6_DELIVERABLE",
    field_key: "fa.preferences.deliverable_language",
    type: "locale",
    title: ["And for the products we prepare for you?", "¿Y para los productos que preparemos para ti?"],
    options: LANGUAGES,
  }),
];
