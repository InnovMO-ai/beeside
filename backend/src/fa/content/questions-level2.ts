import { QuestionDef } from "../engine/bundle-types";
import { opts, q, when } from "./helpers";

// Level 2 MVP new question groups (Design Specification "beeside First Assessment — Level 2 MVP").
// Every field_key here is new (shared/canonical-fields/src/fields.ts, "LEVEL 2 MVP" section).
// Existing fa-qb-1.1.0 questions (B1, B2, G4, D2-D4, fa.constraints.non_negotiables, ...) are reused
// unchanged by field_key and re-grouped into the new compositions from question-bank-v2.ts — they
// are NOT redeclared here.

// ---------------------------------------------------------------- Composition 1 — Your Company
const HAS_2_PLUS_BUSINESS_MODELS = { field: "fa.company.business_models", op: "selected_count_gte", value: 2 } as const;

export const COMPANY_QUESTIONS: QuestionDef[] = [
  q({
    id: "CO1",
    field_key: "fa.company.country",
    type: "country_list",
    max_count: 1,
    title: ["Where is your company based?", "¿Dónde está basada tu empresa?"],
    placeholder: ["Search for a country", "Busca un país"],
  }),
  q({
    id: "CO2",
    field_key: "fa.company.business_models",
    type: "multi_select",
    title: ["How does your company operate today?", "¿Cómo opera tu empresa hoy?"],
    helper: ["Select all that apply.", "Selecciona todas las que apliquen."],
    options: opts(
      ["manufacturer", "Manufacturer", "Fabricante"],
      ["distributor_wholesaler", "Distributor / wholesaler", "Distribuidor / mayorista"],
      ["direct_to_consumer", "Direct to consumer", "Directo al consumidor"],
      ["franchise_licensing", "Franchise / licensing", "Franquicia / licenciamiento"],
      ["platform_marketplace", "Platform / marketplace", "Plataforma / marketplace"],
      ["professional_services_firm", "Professional services firm", "Firma de servicios profesionales"],
      ["other", "Other", "Otro"],
    ),
  }),
  q({
    id: "CO3",
    field_key: "fa.company.primary_business_model",
    type: "single_select",
    options_from: { field: "fa.company.business_models" },
    applies_when: HAS_2_PLUS_BUSINESS_MODELS,
    title: ["Which of these matters most to this expansion?", "¿Cuál de estas es la más importante para esta expansión?"],
  }),
  q({
    id: "CO4",
    field_key: "fa.company.role_in_project",
    type: "single_select",
    title: ["What's your role in this project?", "¿Cuál es tu rol en este proyecto?"],
    options: opts(
      ["owner_founder", "Owner / founder", "Dueño / fundador"],
      ["executive_leadership", "Executive leadership", "Liderazgo ejecutivo"],
      ["project_lead", "Project lead", "Líder del proyecto"],
      ["functional_specialist", "Functional specialist", "Especialista funcional"],
      ["advisor_consultant", "Advisor / consultant", "Asesor / consultor"],
      ["other", "Other", "Otro"],
    ),
  }),
  q({
    id: "CO5",
    field_key: "fa.company.job_title",
    type: "short_text",
    required: false,
    max_length: 100,
    title: ["Job title", "Puesto"],
  }),
];

// ---------------------------------------------------------------- Composition 2 — Your Project additions
export const ENTRY_APPROACH_QUESTIONS: QuestionDef[] = [
  q({
    id: "PR_ENTRY",
    field_key: "fa.project.entry_approach",
    type: "text",
    title: ["How are you planning to enter this market?", "¿Cómo planeas entrar a este mercado?"],
    helper: [
      "Describe it in your own words — we'll suggest a structure for you to confirm.",
      "Descríbelo en tus propias palabras; te sugeriremos una estructura para que la confirmes.",
    ],
  }),
  // The structured confirmation is rendered as a StructuredEcho chip directly beneath PR_ENTRY,
  // only when the deterministic parser finds a match — never as a separate screen or question the
  // respondent sees before answering PR_ENTRY. `applies_when: answered(source)` keeps the server's
  // applicability model happy; StructuredEchoChip.tsx decides on its own whether to actually show it.
  q({
    id: "PR_ENTRY_STRUCTURED",
    field_key: "fa.project.entry_approach_structured",
    type: "single_select",
    required: false,
    applies_when: when.answered("fa.project.entry_approach"),
    title: ["Does this match what you meant?", "¿Esto coincide con lo que quisiste decir?"],
    options: opts(
      ["direct_entity", "Set up our own entity", "Establecer nuestra propia entidad"],
      ["distributor_partner", "Work through a distributor or local partner", "Trabajar con un distribuidor o socio local"],
      ["ecommerce_only", "E-commerce only", "Solo comercio electrónico"],
      ["joint_venture", "Joint venture", "Empresa conjunta (joint venture)"],
      ["acquisition", "Acquire a local company", "Adquirir una empresa local"],
      ["licensing_franchise", "Licensing or franchise", "Licenciamiento o franquicia"],
      ["representative_office", "Representative office", "Oficina de representación"],
      ["other", "Other", "Otro"],
    ),
  }),
  q({
    id: "PR_DRIVER_STRUCTURED",
    field_key: "fa.project.primary_driver_structured",
    type: "single_select",
    required: false,
    applies_when: when.answered("fa.project.story_raw"),
    title: ["Does this match your primary driver?", "¿Esto coincide con tu motivo principal?"],
    options: opts(
      ["existing_customer_demand", "Existing customer demand", "Demanda de clientes actuales"],
      ["new_market_opportunity", "A new market opportunity", "Una nueva oportunidad de mercado"],
      ["growth_targets", "Growth targets", "Metas de crecimiento"],
      ["customer_request", "A customer request", "Una solicitud de un cliente"],
      ["supply_chain_strategy", "Supply-chain strategy", "Estrategia de cadena de suministro"],
      ["cost_advantage", "Cost advantage", "Ventaja en costos"],
      ["diversification", "Diversification", "Diversificación"],
      ["competitive_pressure", "Competitive pressure", "Presión competitiva"],
      ["investor_board_direction", "Investor or board direction", "Indicación de inversionistas o del consejo"],
      ["other", "Other", "Otro"],
    ),
  }),
];

// ---------------------------------------------------------------- Composition 3 — Plan Definition
const FIRST_CUSTOMER_DEFINED = when.eq("fa.plan.first_customer_known", "defined");
const ENTRY_APPROACH_NOT_STRUCTURED = when.not(when.answered("fa.project.entry_approach_structured"));

export const PLAN_QUESTIONS: QuestionDef[] = [
  q({
    id: "PL1",
    field_key: "fa.plan.first_customer_known",
    type: "single_select",
    title: ["Do you already know your first customer or segment?", "¿Ya sabes cuál será tu primer cliente o segmento?"],
    options: opts(["not_defined_yet", "Not defined yet", "Todavía no está definido"], ["defined", "Yes, I know", "Sí, ya lo sé"]),
  }),
  q({
    id: "PL1_DETAIL",
    field_key: "fa.plan.first_customer_segment",
    type: "text",
    applies_when: FIRST_CUSTOMER_DEFINED,
    title: ["Who is it?", "¿Quién es?"],
  }),
  q({
    id: "PL2",
    field_key: "fa.plan.route_to_market",
    type: "text",
    // Conditional suppression, not conditional insertion: only asked when the entry-approach
    // StructuredEcho didn't already establish how the respondent reaches customers.
    applies_when: ENTRY_APPROACH_NOT_STRUCTURED,
    title: ["How will you reach customers in this market?", "¿Cómo llegarás a los clientes en este mercado?"],
  }),
  q({
    id: "PL3",
    field_key: "fa.plan.demand_evidence",
    type: "text",
    title: ["What evidence do you have that demand exists?", "¿Qué evidencia tienes de que existe demanda?"],
    helper: ["If you don't have hard evidence yet, describe your reasoning.", "Si aún no tienes evidencia dura, describe tu razonamiento."],
  }),
  q({
    id: "PL4",
    field_key: "fa.plan.competitive_landscape",
    type: "text",
    required: false,
    title: ["What do you know about the competitive landscape?", "¿Qué sabes sobre el panorama competitivo?"],
  }),
  q({
    id: "PL5",
    field_key: "fa.plan.business_case",
    type: "text",
    required: false,
    title: ["How far along is the business case?", "¿Qué tan avanzado está el caso de negocio?"],
  }),
];

// ---------------------------------------------------------------- Composition 4 — Priorities additions
const HAS_TARGET_DATE = when.answered("fa.goal.launch_target");

export const PRIORITY_TIMING_QUESTIONS: QuestionDef[] = [
  q({
    id: "PR_FLEX",
    field_key: "fa.priority.date_flexibility",
    type: "single_select",
    applies_when: HAS_TARGET_DATE,
    title: ["How fixed is that date?", "¿Qué tan fija es esa fecha?"],
    options: opts(
      ["fixed", "Fixed — it can't move", "Fija; no se puede mover"],
      ["some_flexibility", "Some flexibility", "Algo de flexibilidad"],
      ["fully_flexible", "Fully flexible", "Totalmente flexible"],
    ),
  }),
  q({
    id: "PR_FLEX_REASON",
    field_key: "fa.priority.date_flexibility_reason",
    type: "text",
    required: false,
    applies_when: when.all(HAS_TARGET_DATE, when.in("fa.priority.date_flexibility", "fixed", "some_flexibility")),
    title: ["What determines this date?", "¿Qué determina esta fecha?"],
  }),
];

// ---------------------------------------------------------------- Composition 5 — Needs Landscape
export const NEEDS_QUESTIONS: QuestionDef[] = [
  q({
    id: "NEEDS_MAP",
    field_key: "fa.needs.map",
    type: "needs_map",
    title: ["What needs to be resolved to move forward?", "¿Qué necesita resolverse para avanzar?"],
    helper: [
      "Select what applies, tell us where each one stands, then rank your top priorities.",
      "Selecciona lo que aplique, indícanos en qué estado está cada una y luego ordena tus prioridades.",
    ],
  }),
  q({
    id: "NEEDS_CONTEXT",
    field_key: "fa.needs.additional_context",
    type: "text",
    required: false,
    title: ["Anything else about what needs to be resolved?", "¿Algo más sobre lo que necesita resolverse?"],
  }),
];

// ---------------------------------------------------------------- Composition 6 — Provider Profile + Resources
const REQUIRES_LANGUAGE = when.eq("fa.provider.requires_language", "yes");
const REQUIRES_PRESENCE = when.eq("fa.provider.requires_local_presence", "yes");
const RESOURCES_NOT_FULLY_AVAILABLE = when.in("fa.provider.resource_availability", "partially", "no", "not_sure");

export const PROVIDER_QUESTIONS: QuestionDef[] = [
  q({
    id: "PV1",
    field_key: "fa.provider.values",
    type: "multi_select",
    max_select: 3,
    title: ["What matters most to you in the people you work with on this?", "¿Qué es lo más importante para ti en las personas con quienes trabajarás en esto?"],
    helper: ["Choose up to 3.", "Elige hasta 3."],
    options: opts(
      ["reliability", "Reliability", "Confiabilidad"],
      ["speed", "Speed", "Rapidez"],
      ["cost_efficiency", "Cost efficiency", "Eficiencia en costos"],
      ["local_expertise", "Local expertise", "Experiencia local"],
      ["transparency", "Transparency", "Transparencia"],
      ["cultural_fit", "Cultural fit", "Afinidad cultural"],
      ["proven_track_record", "Proven track record", "Historial comprobado"],
      ["innovation", "Innovation", "Innovación"],
      ["compliance_rigor", "Compliance rigor", "Rigor de cumplimiento"],
      ["flexibility", "Flexibility", "Flexibilidad"],
    ),
  }),
  q({
    id: "PV2",
    field_key: "fa.provider.requires_language",
    type: "single_select",
    title: ["Is a specific working language a hard requirement?", "¿Un idioma de trabajo específico es un requisito indispensable?"],
    options: opts(["yes", "Yes", "Sí"], ["no", "No", "No"]),
  }),
  q({
    id: "PV3",
    field_key: "fa.provider.required_language",
    type: "single_select",
    applies_when: REQUIRES_LANGUAGE,
    title: ["Which language?", "¿Qué idioma?"],
    options: opts(["en", "English", "Inglés"], ["es", "Spanish", "Español"], ["pt", "Portuguese", "Portugués"], ["fr", "French", "Francés"], ["de", "German", "Alemán"], ["zh", "Chinese", "Chino"], ["other", "Other", "Otro"]),
  }),
  q({
    id: "PV4",
    field_key: "fa.provider.requires_local_presence",
    type: "single_select",
    title: ["Is local in-country presence a hard requirement?", "¿La presencia local en el país es un requisito indispensable?"],
    options: opts(["yes", "Yes", "Sí"], ["no", "No", "No"]),
  }),
  q({
    id: "PV5",
    field_key: "fa.provider.required_presence_countries",
    type: "country_list",
    applies_when: REQUIRES_PRESENCE,
    title: ["Where?", "¿Dónde?"],
    placeholder: ["Search for a country", "Busca un país"],
  }),
  q({
    id: "PV6",
    field_key: "fa.provider.restricted_counterparties",
    type: "counterparty_list",
    required: false,
    title: ["Are there any companies or groups you cannot work with or share information with?", "¿Hay empresas o grupos con los que no puedas trabajar o compartir información?"],
    helper: ["Optional. This is kept confidential and scoped to this project — never shared with providers.", "Opcional. Esto se mantiene confidencial y limitado a este proyecto — nunca se comparte con proveedores."],
  }),
  q({
    id: "PV7",
    field_key: "fa.provider.investment_range",
    type: "single_select",
    title: ["What investment range are you working with?", "¿Con qué rango de inversión estás trabajando?"],
    options: opts(
      ["under_50k", "Under $50,000 USD", "Menos de $50,000 USD"],
      ["50k_150k", "$50,000–$150,000 USD", "$50,000–$150,000 USD"],
      ["150k_500k", "$150,000–$500,000 USD", "$150,000–$500,000 USD"],
      ["500k_2m", "$500,000–$2,000,000 USD", "$500,000–$2,000,000 USD"],
      ["over_2m", "Over $2,000,000 USD", "Más de $2,000,000 USD"],
      ["not_yet_defined", "Not yet defined", "Todavía no está definido"],
    ),
  }),
  q({
    id: "PV8",
    field_key: "fa.provider.resource_availability",
    type: "single_select",
    title: ["Do you have the internal team and budget available to execute?", "¿Tienes disponible el equipo interno y el presupuesto para ejecutar?"],
    options: opts(["yes", "Yes", "Sí"], ["partially", "Partially", "Parcialmente"], ["no", "No", "No"], ["not_sure", "Not sure", "No estoy seguro"]),
  }),
  q({
    id: "PV9",
    field_key: "fa.provider.resource_gap",
    type: "text",
    required: false,
    applies_when: RESOURCES_NOT_FULLY_AVAILABLE,
    title: ["What's missing?", "¿Qué falta?"],
  }),
];
