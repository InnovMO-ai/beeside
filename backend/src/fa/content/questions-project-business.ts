import { QuestionDef } from "../engine/bundle-types";
import { SELECT_ALL, opts, q, when } from "./helpers";

// Copy: English is the Master Build Guide v2 wording wherever it exists (§6.3, §7.1–§7.3) and the
// approved strategic prompts (Functional & Experience Handoff v1 §12); Spanish is operational copy.

export const STORY_QUESTIONS: QuestionDef[] = [
  q({
    id: "STORY",
    field_key: "fa.project.story_raw",
    type: "text",
    title: [
      "In your own words, tell us what you’re planning, where you are today, and what you’re trying to make happen.",
      "En tus propias palabras, cuéntanos qué estás planeando, dónde estás hoy y qué quieres lograr.",
    ],
    helper: [
      "Don’t worry about having everything figured out. A few sentences are enough.",
      "No te preocupes por tener todo resuelto. Unas cuantas frases son suficientes.",
    ],
  }),
  q({
    id: "ANOTHER_PROJECT",
    field_key: "fa.project.another_project_in_mind",
    type: "single_select",
    title: ["Do you have another project in mind?", "¿Tienes otro proyecto en mente?"],
    helper: [
      "We’ll focus on this project first. You can start another one for the same company afterwards.",
      "Nos enfocaremos primero en este proyecto. Después podrás iniciar otro para la misma empresa.",
    ],
    options: opts(["yes", "Yes", "Sí"], ["no", "No", "No"], ["not_sure", "Not sure", "No estoy seguro"]),
  }),
];

const HAS_TIMING = when.in("fa.goal.launch_timing_status", "firm_commitment", "target_date", "approximate_timeframe");

export const GOAL_QUESTIONS: QuestionDef[] = [
  q({
    id: "G1",
    field_key: "fa.goal.primary_goal",
    type: "single_select",
    title: ["What are you trying to accomplish in this market?", "¿Qué quieres lograr en este mercado?"],
    options: opts(
      ["enter_first_time", "Enter for the first time", "Entrar por primera vez"],
      ["start_selling_locally", "Start selling locally", "Empezar a vender localmente"],
      ["set_up_local_operation", "Set up a local operation", "Establecer una operación local"],
      ["find_customers_partners", "Find customers or commercial partners", "Encontrar clientes o socios comerciales"],
      ["build_local_supply_chain", "Build or strengthen a local supply chain", "Construir o fortalecer una cadena de suministro local"],
      ["expand_existing_operation", "Expand an existing operation", "Ampliar una operación existente"],
      ["evaluate_entry", "Evaluate whether entering makes sense", "Evaluar si tiene sentido entrar"],
      ["other", "Other", "Otro"],
    ),
  }),
  q({
    id: "G2",
    field_key: "fa.goal.success_definition",
    type: "text",
    title: [
      "In your own words, what would a successful expansion look like for your company?",
      "En tus propias palabras, ¿cómo se vería una expansión exitosa para tu empresa?",
    ],
  }),
  q({
    id: "G3",
    field_key: "fa.goal.launch_timing_status",
    type: "single_select",
    title: ["Do you already have a date in mind for starting operations?", "¿Ya tienes una fecha en mente para iniciar operaciones?"],
    options: opts(
      ["firm_commitment", "Yes — a firm commitment", "Sí, un compromiso firme"],
      ["target_date", "Yes — a target date", "Sí, una fecha objetivo"],
      ["approximate_timeframe", "An approximate timeframe", "Un plazo aproximado"],
      ["not_yet", "Not yet", "Todavía no"],
    ),
  }),
  q({
    id: "G4",
    field_key: "fa.goal.launch_target",
    type: "timing",
    applies_when: HAS_TIMING,
    title: ["When are you planning to start?", "¿Cuándo planeas iniciar?"],
    helper: [
      "Share it with the precision you have — an exact date, a month or an approximate quarter all work.",
      "Compártelo con la precisión que tengas: una fecha exacta, un mes o un trimestre aproximado funcionan.",
    ],
  }),
  q({
    id: "G5",
    field_key: "fa.goal.timing_driver",
    type: "single_select",
    applies_when: HAS_TIMING,
    title: ["What is driving that timing?", "¿Qué está definiendo ese plazo?"],
    options: opts(
      ["customer_contract", "A customer or contract", "Un cliente o contrato"],
      ["internal_plan", "Internal plan", "Plan interno"],
      ["market_opportunity", "Market opportunity", "Oportunidad de mercado"],
      ["investment_decision", "Investment decision", "Decisión de inversión"],
      ["supply_chain_requirement", "Supply-chain requirement", "Requerimiento de la cadena de suministro"],
      ["regulatory", "Regulatory requirement", "Requerimiento regulatorio"],
      ["partner_commitment", "Partner commitment", "Compromiso con un socio"],
      ["seasonality", "Seasonality", "Estacionalidad"],
      ["other", "Other", "Otro"],
    ),
  }),
  q({
    id: "G6",
    field_key: "fa.goal.expansion_driver",
    type: "single_select",
    title: ["What’s driving the expansion?", "¿Qué está impulsando la expansión?"],
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

const MARKET_KNOWN = when.in("fa.project.destination_status", "know_country_location", "know_country_comparing_locations", "comparing_countries");

export const PROJECT_QUESTIONS: QuestionDef[] = [
  q({
    id: "P1",
    field_key: "fa.project.destination_status",
    type: "single_select",
    title: ["How defined is the market?", "¿Qué tan definido está el mercado?"],
    options: opts(
      ["know_country_location", "I know the country and the location", "Conozco el país y la ubicación"],
      ["know_country_comparing_locations", "I know the country, but I’m comparing locations", "Conozco el país, pero estoy comparando ubicaciones"],
      ["comparing_countries", "I’m comparing countries or markets", "Estoy comparando países o mercados"],
      ["havent_decided", "I haven’t decided yet", "Todavía no lo he decidido"],
    ),
  }),
  q({
    id: "P2",
    field_key: "fa.project.target_markets",
    type: "country_list",
    applies_when: MARKET_KNOWN,
    title: ["Which country or market are you looking at?", "¿Qué país o mercado estás considerando?"],
    helper: ["You can add more than one.", "Puedes agregar más de uno."],
    placeholder: ["Search for a country", "Busca un país"],
  }),
  q({
    id: "P2_DETAIL",
    field_key: "fa.project.target_location_detail",
    type: "short_text",
    required: false,
    applies_when: MARKET_KNOWN,
    title: ["Region or city, if you already know it", "Región o ciudad, si ya la conoces"],
  }),
  q({
    id: "P3",
    field_key: "fa.project.stage",
    type: "single_select",
    title: ["Where are you today?", "¿Dónde estás hoy?"],
    options: opts(
      ["exploring", "Exploring", "Explorando"],
      ["business_case", "Building the business case", "Construyendo el caso de negocio"],
      ["validating", "Validating", "Validando"],
      ["preparing_entry", "Preparing entry", "Preparando la entrada"],
      ["already_executing", "Already executing", "Ya en ejecución"],
      ["already_operating", "Already operating and looking to grow", "Ya operamos y buscamos crecer"],
    ),
  }),
  q({
    id: "P4",
    field_key: "fa.project.defined_areas",
    type: "multi_select",
    title: ["Which parts already feel reasonably defined?", "¿Qué partes ya se sienten razonablemente definidas?"],
    helper: SELECT_ALL,
    exclusive_values: ["none"],
    options: opts(
      ["target_market", "Target market", "Mercado objetivo"],
      ["location", "Location", "Ubicación"],
      ["customer_segment", "Customer segment", "Segmento de clientes"],
      ["commercial_model", "Commercial model", "Modelo comercial"],
      ["sales_channel", "Sales channel", "Canal de venta"],
      ["offer", "Offer", "Oferta"],
      ["legal", "Legal", "Legal"],
      ["tax", "Tax", "Fiscal"],
      ["supply_chain", "Supply chain", "Cadena de suministro"],
      ["logistics", "Logistics", "Logística"],
      ["suppliers", "Suppliers", "Proveedores"],
      ["partners", "Partners", "Socios"],
      ["facilities", "Facilities", "Instalaciones"],
      ["technology", "Technology", "Tecnología"],
      ["talent", "Talent", "Talento"],
      ["regulatory", "Regulatory", "Regulatorio"],
      ["budget", "Budget", "Presupuesto"],
      ["timing", "Timing", "Tiempos"],
      ["none", "None yet", "Ninguna todavía"],
    ),
  }),
  q({
    id: "P5",
    field_key: "fa.project.previous_expansion_experience",
    type: "single_select",
    title: ["Have you expanded internationally before?", "¿Ya se han expandido internacionalmente antes?"],
    options: opts(["yes", "Yes", "Sí"], ["no", "No", "No"]),
  }),
  q({
    id: "P5_LEARNING",
    field_key: "fa.project.previous_expansion_learning",
    type: "text",
    applies_when: when.eq("fa.project.previous_expansion_experience", "yes"),
    title: ["What did you learn that matters this time?", "¿Qué aprendieron que importa esta vez?"],
  }),
  q({
    id: "P6",
    field_key: "fa.project.next_decision",
    type: "text",
    title: [
      "What is the next important decision you need to make about this expansion?",
      "¿Cuál es la siguiente decisión importante que necesitas tomar sobre esta expansión?",
    ],
  }),
  q({
    id: "SP1",
    field_key: "fa.strategic.decided_vs_open",
    type: "text",
    title: ["What has already been decided — and what is still open?", "¿Qué ya está decidido y qué sigue abierto?"],
  }),
];

const PHYSICAL_PRODUCT = when.any(
  when.in("fa.business.type", "manufacturing", "distribution_wholesale", "retail", "ecommerce"),
  when.eq("fa.business.revenue_model", "physical_products"),
);

export const BUSINESS_QUESTIONS: QuestionDef[] = [
  q({
    id: "B1",
    field_key: "fa.business.description",
    type: "text",
    max_length: 600,
    title: ["In one sentence, what does your company do?", "En una frase, ¿qué hace tu empresa?"],
  }),
  q({
    id: "B2",
    field_key: "fa.business.type",
    type: "single_select",
    title: ["Which best describes your business?", "¿Qué describe mejor a tu negocio?"],
    options: opts(
      ["manufacturing", "Manufacturing", "Manufactura"],
      ["distribution_wholesale", "Distribution / wholesale", "Distribución / mayoreo"],
      ["retail", "Retail", "Comercio minorista"],
      ["ecommerce", "E-commerce", "Comercio electrónico"],
      ["professional_services", "Professional services", "Servicios profesionales"],
      ["technology_saas", "Technology / SaaS", "Tecnología / SaaS"],
      ["logistics", "Logistics", "Logística"],
      ["construction_infrastructure", "Construction / infrastructure", "Construcción / infraestructura"],
      ["financial_services", "Financial services", "Servicios financieros"],
      ["consumer_services", "Consumer services", "Servicios al consumidor"],
      ["other", "Other", "Otro"],
    ),
  }),
  q({
    id: "B3",
    field_key: "fa.business.customer_model",
    type: "single_select",
    title: ["Who are your customers?", "¿Quiénes son tus clientes?"],
    options: opts(
      ["b2b", "Businesses (B2B)", "Empresas (B2B)"],
      ["b2c", "Consumers (B2C)", "Consumidores (B2C)"],
      ["b2g", "Government (B2G)", "Gobierno (B2G)"],
      ["combination", "A combination", "Una combinación"],
    ),
  }),
  q({
    id: "B4",
    field_key: "fa.business.revenue_model",
    type: "single_select",
    title: ["What do customers pay for?", "¿Por qué te pagan tus clientes?"],
    options: opts(
      ["physical_products", "Physical products", "Productos físicos"],
      ["professional_services", "Professional services", "Servicios profesionales"],
      ["software_subscriptions", "Software or subscriptions", "Software o suscripciones"],
      ["projects", "Projects", "Proyectos"],
      ["usage_transactions", "Usage or transactions", "Uso o transacciones"],
      ["digital_products", "Digital products", "Productos digitales"],
      ["combination", "A combination", "Una combinación"],
      ["other", "Other", "Otro"],
    ),
  }),
  q({
    id: "B5",
    field_key: "fa.business.value_chain_role",
    type: "multi_select",
    applies_when: PHYSICAL_PRODUCT,
    title: ["What role do you play with your products?", "¿Qué papel juegas con tus productos?"],
    helper: SELECT_ALL,
    options: opts(
      ["manufacture", "Manufacture", "Fabricamos"],
      ["assemble", "Assemble", "Ensamblamos"],
      ["source", "Source", "Nos abastecemos de terceros"],
      ["import", "Import", "Importamos"],
      ["distribute", "Distribute", "Distribuimos"],
      ["sell_direct", "Sell direct", "Vendemos directamente"],
    ),
  }),
  q({
    id: "B6",
    field_key: "fa.business.employee_band",
    type: "single_select",
    title: ["How many people work at your company?", "¿Cuántas personas trabajan en tu empresa?"],
    options: opts(
      ["1_10", "1–10", "1–10"],
      ["11_50", "11–50", "11–50"],
      ["51_200", "51–200", "51–200"],
      ["201_500", "201–500", "201–500"],
      ["501_1000", "501–1,000", "501–1,000"],
      ["1000_plus", "More than 1,000", "Más de 1,000"],
    ),
  }),
  q({
    id: "SP2",
    field_key: "fa.strategic.commercial_success",
    type: "text",
    title: ["What would make this expansion commercially successful for you?", "¿Qué haría que esta expansión fuera un éxito comercial para ti?"],
  }),
];
