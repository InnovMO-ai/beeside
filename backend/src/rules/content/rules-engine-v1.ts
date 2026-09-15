import type { Condition } from "../../fa/engine/bundle-types";
import type { AreaDefinition, CriticalRule, PressurePrimitive, RuleCondition, RulesEngineBundle, SignalRule, StatusRule } from "../types";

// Rules Engine v1 — Rules Matrix v1 (FROZEN 2026-09-10) area by area, Capability Taxonomy v1, and the
// First Assessment question bank fa-qb-1.0.0 field keys/values. Every condition is an enum/list
// test over structured DECLARED_BY_USER answers; open text is only ever tested for presence.
// Client reasons use the Rules Matrix wording where it exists ({{pressure_reason}} substitutes the
// material-pressure clause when the Matrix lists alternatives); the remaining reasons are minimal
// operational copy in the same editorial register.

export const FA_RULES_ENGINE_VERSION = "re-1.0.0";

type Bi = readonly [string, string];
const reason = ([en, es]: Bi) => ({ en: { reason: en }, es: { reason: es } });

const w = {
  eq: (field: string, value: string): Condition => ({ field, op: "eq", value }),
  neq: (field: string, value: string): Condition => ({ field, op: "neq", value }),
  in: (field: string, ...values: string[]): Condition => ({ field, op: "in", values }),
  includes: (field: string, ...values: string[]): Condition => ({ field, op: "includes_any", values }),
  answered: (field: string): Condition => ({ field, op: "answered" }),
  declared: (field: string): RuleCondition => ({ field, op: "declared" }),
  all: (...conditions: RuleCondition[]): RuleCondition => ({ all: conditions }),
  any: (...conditions: RuleCondition[]): RuleCondition => ({ any: conditions }),
  not: (condition: RuleCondition): RuleCondition => ({ not: condition }),
  status: (...statuses: Array<"DEFINED" | "NEEDS_ATTENTION" | "CRITICAL_GAP">): RuleCondition => ({ status_in: statuses }),
  always: { always: true } as RuleCondition,
};

const K = {
  components: "fa.operation.components",
  expected: "fa.operation.expected_capabilities",
  definedAreas: "fa.project.defined_areas",
  stage: "fa.project.stage",
  primaryGoal: "fa.goal.primary_goal",
  launchStatus: "fa.goal.launch_timing_status",
  contract: "fa.constraints.has_customer_contract",
  commitmentAreas: "fa.constraints.commitment_areas",
  nonNegotiableAreas: "fa.constraints.non_negotiable_areas",
  constraintItems: "fa.constraints.items",
  criticalConstraint: "fa.constraints.critical",
  clientPriority: "fa.priority.client_priority",
  destination: "fa.project.destination_status",
  markets: "fa.project.target_markets",
  crossBorder: "fa.operation.import_export.cross_border_expected",
  shipments: "fa.operation.import_export.monthly_shipments",
  sourcingLocal: "fa.operation.sourcing.local_expected",
  supplierCount: "fa.operation.sourcing.critical_supplier_count",
  supplierStatus: "fa.operation.sourcing.relationship_status",
  inventoryModel: "fa.operation.warehousing.current_model",
  inventoryLocal: "fa.operation.warehousing.local_expected",
  warehousingScale: "fa.operation.warehousing.scale",
  freightFrequency: "fa.operation.freight.frequency",
  freightType: "fa.operation.freight.type",
  lastMileDeliveries: "fa.operation.last_mile.monthly_deliveries",
  lastMileLocal: "fa.operation.last_mile.local_expected",
  systems: "fa.operation.technology.critical_systems",
  integration: "fa.operation.technology.integration_expected",
  hiring: "fa.operation.workforce.local_hiring_expected",
  headcount: "fa.operation.workforce.first_year_headcount",
  facility: "fa.operation.facilities.facility_required",
  location: "fa.operation.facilities.location_selected",
  partnerDependency: "fa.operation.partners.dependency",
  partnerStatus: "fa.operation.partners.relationship_status",
  permits: "fa.operation.regulated.permits_status",
  permitsWhich: "fa.operation.regulated.permits_which",
  banking: "fa.operation.banking_status",
  insurance: "fa.operation.insurance_status",
  revenueModel: "fa.business.revenue_model",
  customerModel: "fa.business.customer_model",
} as const;

const PRE_SELECTION = ["still_looking", "identified", "evaluating", "in_discussions"];
const UNRESOLVED_ESTABLISHMENT = ["in_progress", "need_to_establish", "not_sure_required"];
const SPECIFIC_FACILITY = ["office", "warehouse", "manufacturing", "retail", "multiple"];

function critical(id: string, unresolved: RuleCondition, pressure: PressurePrimitive[], copy: Bi): CriticalRule {
  return { id, status: "CRITICAL_GAP", unresolved, pressure, copy: reason(copy) };
}
function rule(id: string, status: "DEFINED" | "NEEDS_ATTENTION", when: RuleCondition, copy: Bi): StatusRule {
  return { id, status, when, copy: reason(copy) };
}
function signal(when: RuleCondition, name: string | null, strength: SignalRule["strength"]): SignalRule {
  return { when, signal: name, strength };
}
const unresolvedStatus = w.status("CRITICAL_GAP", "NEEDS_ATTENTION");

type AreaInput = Omit<AreaDefinition, "copy" | "fallback"> & {
  fallback: [string, Bi];
  label: Bi;
  short: Bi;
  precision: Bi;
};
function area(input: AreaInput): AreaDefinition {
  const { fallback, label, short, precision, ...rest } = input;
  return {
    ...rest,
    fallback: { id: fallback[0], status: "NEEDS_ATTENTION", copy: reason(fallback[1]) },
    copy: {
      en: { label: label[0], short_label: short[0], precision_focus: precision[0] },
      es: { label: label[1], short_label: short[1], precision_focus: precision[1] },
    },
  };
}

// Capability Taxonomy v1 §2 ids (capability_taxonomy_category).
const CAP = { trade: 1, entity: 2, permits: 3, partnersSuppliers: 4, workforce: 5, facilities: 6, freight: 7, systems: 8, bankingInsurance: 9, gtm: 10 };

const AREAS: AreaDefinition[] = [
  // 1. Target Market Definition
  area({
    id: 1,
    category: "target_market",
    applies_when: w.always,
    evidence_fields: [K.destination, K.markets, K.launchStatus, K.contract],
    critical: [
      critical("area.1.critical.market_undecided", w.eq(K.destination, "havent_decided"), ["firm_commitment", "customer_contract"], [
        "A target market hasn't been decided yet, and {{pressure_reason}}.",
        "Todavía no se ha decidido un mercado objetivo, y {{pressure_reason}}.",
      ]),
    ],
    rules: [
      rule("area.1.defined.market_located", "DEFINED", w.all(w.eq(K.destination, "know_country_location"), w.answered(K.markets)), [
        "Your target market and location are already decided.",
        "Tu mercado objetivo y la ubicación ya están decididos.",
      ]),
      rule("area.1.needs.comparing", "NEEDS_ATTENTION", w.in(K.destination, "know_country_comparing_locations", "comparing_countries"), [
        "Your market is taking shape, but the final country or location is still being compared.",
        "Tu mercado está tomando forma, pero todavía estás comparando el país o la ubicación final.",
      ]),
    ],
    fallback: ["area.1.needs.undecided", ["The target market still needs to be decided.", "Todavía falta decidir el mercado objetivo."]],
    contract_linked: true,
    weighting: {},
    signals: [
      signal(w.status("CRITICAL_GAP"), "Country & Market Brief", "STRONG"),
      signal(w.status("NEEDS_ATTENTION"), "Country & Market Brief", "SUPPORTING"),
    ],
    capability_ids: [],
    label: ["Target market", "Mercado objetivo"],
    short: ["the target market", "el mercado objetivo"],
    precision: [
      "Confirm the market-selection criteria; when this must be resolved early, it is Precision's first open question.",
      "Confirmar los criterios de selección de mercado; si conviene resolverlo desde ahora, es la primera pregunta abierta de Precision.",
    ],
  }),

  // 2. Customs & Market Access
  area({
    id: 2,
    category: "customs_trade",
    applies_when: w.any(w.includes(K.components, "import_export"), w.includes(K.expected, "customs_trade")),
    evidence_fields: [K.components, K.crossBorder, K.shipments, K.definedAreas, K.expected, K.launchStatus, K.contract],
    critical: [
      critical(
        "area.2.critical.customs_undefined",
        w.all(w.in(K.crossBorder, "yes", "probably"), w.not(w.includes(K.definedAreas, "regulatory"))),
        ["firm_commitment", "customer_contract"],
        [
          "Your project includes cross-border inventory, but the import structure is still undefined and may affect the timing you selected.",
          "Tu proyecto incluye inventario que cruza fronteras, pero la estructura de importación todavía no está definida y puede afectar los tiempos que seleccionaste.",
        ],
      ),
    ],
    rules: [
      rule("area.2.defined.customs_defined", "DEFINED", w.includes(K.definedAreas, "regulatory"), [
        "Your import and customs structure is already defined for this stage.",
        "Tu estructura de importación y aduanas ya está definida para esta etapa.",
      ]),
      rule("area.2.defined.no_cross_border", "DEFINED", w.eq(K.crossBorder, "no"), [
        "Goods aren't expected to cross borders in the new operation.",
        "No se espera que la mercancía cruce fronteras en la nueva operación.",
      ]),
      rule("area.2.needs.customs_undefined", "NEEDS_ATTENTION", w.in(K.crossBorder, "yes", "probably"), [
        "Goods will cross borders, and the customs and import structure still needs to be defined.",
        "La mercancía cruzará fronteras y todavía falta definir la estructura de aduanas e importación.",
      ]),
    ],
    fallback: ["area.2.needs.to_confirm", ["Customs and trade requirements still need to be confirmed.", "Todavía falta confirmar los requerimientos de aduanas y comercio exterior."]],
    contract_linked: true,
    weighting: {
      operational_dependency: w.includes(K.components, "import_export"),
      capability_need: w.includes(K.expected, "customs_trade"),
      scale_volume: w.declared(K.shipments),
    },
    signals: [
      signal(unresolvedStatus, "Trade & Market Access Strategy", "BY_STATUS"),
      signal(w.all(w.status("DEFINED"), w.in(K.crossBorder, "yes", "probably")), "The Hive: Foreign Trade & Customs Advisory", "SUPPORTING"),
    ],
    capability_ids: [CAP.trade],
    label: ["Customs & trade structure", "Estructura de aduanas y comercio exterior"],
    short: ["the import and customs structure", "la estructura de importación y aduanas"],
    precision: ["Confirm the intended customs pathway and the responsible party.", "Confirmar la ruta aduanal prevista y quién será responsable."],
  }),

  // 3. Local Sourcing & Supply Chain
  area({
    id: 3,
    category: "local_sourcing_suppliers",
    applies_when: w.includes(K.components, "sourcing_suppliers"),
    evidence_fields: [K.sourcingLocal, K.supplierCount, K.supplierStatus, K.commitmentAreas, K.nonNegotiableAreas, K.clientPriority],
    critical: [
      critical(
        "area.3.critical.suppliers_open",
        w.all(w.in(K.sourcingLocal, "yes", "probably", "not_sure"), w.in(K.supplierStatus, ...PRE_SELECTION)),
        ["non_negotiable_area", "commitment_area", "client_priority"],
        [
          "Local sourcing is expected for this operation, but which suppliers or inputs still needs to be defined, and {{pressure_reason}}.",
          "Se espera abastecimiento local para esta operación, pero todavía falta definir qué proveedores o insumos, y {{pressure_reason}}.",
        ],
      ),
    ],
    rules: [
      rule("area.3.defined.suppliers_selected", "DEFINED", w.all(w.in(K.sourcingLocal, "yes", "probably"), w.in(K.supplierStatus, "selected", "already_working_together")), [
        "Your local suppliers are already selected or in place.",
        "Tus proveedores locales ya están seleccionados o trabajando contigo.",
      ]),
      rule("area.3.defined.no_local_sourcing", "DEFINED", w.eq(K.sourcingLocal, "no"), [
        "Local sourcing isn't expected for the new operation.",
        "No se espera abastecimiento local para la nueva operación.",
      ]),
      rule("area.3.needs.suppliers_open", "NEEDS_ATTENTION", w.all(w.in(K.sourcingLocal, "yes", "probably", "not_sure"), w.in(K.supplierStatus, ...PRE_SELECTION)), [
        "Local sourcing is expected, and the supplier search or evaluation is still under way.",
        "Se espera abastecimiento local y la búsqueda o evaluación de proveedores sigue en curso.",
      ]),
    ],
    fallback: ["area.3.needs.to_confirm", ["Local sourcing still needs to be confirmed.", "Todavía falta confirmar el abastecimiento local."]],
    contract_linked: false,
    weighting: {
      operational_dependency: w.includes(K.components, "sourcing_suppliers"),
      capability_need: w.includes(K.expected, "suppliers"),
      scale_volume: w.declared(K.supplierCount),
    },
    signals: [
      signal(w.all(w.neq(K.sourcingLocal, "no"), w.in(K.supplierStatus, "still_looking", "identified")), "Supplier Search & Qualification", "BY_STATUS"),
      signal(w.all(w.neq(K.sourcingLocal, "no"), w.in(K.supplierStatus, "evaluating", "in_discussions")), "Supplier Search & Qualification", "SUPPORTING"),
      signal(w.all(w.neq(K.sourcingLocal, "no"), w.eq(K.supplierStatus, "selected")), "Business Check", "STRONG"),
    ],
    capability_ids: [CAP.partnersSuppliers],
    label: ["Local sourcing & suppliers", "Abastecimiento y proveedores locales"],
    short: ["local sourcing", "el abastecimiento local"],
    precision: [
      "Confirm the named suppliers' qualification status and any exclusivity or non-negotiable terms; read the supplier relationship context verbatim.",
      "Confirmar la validación de los proveedores mencionados y cualquier exclusividad o condición innegociable; leer textualmente el contexto de la relación con proveedores.",
    ],
  }),

  // 4. Local Inventory & Warehousing
  area({
    id: 4,
    category: "local_inventory_warehousing",
    applies_when: w.includes(K.components, "warehousing_inventory"),
    evidence_fields: [K.inventoryModel, K.inventoryLocal, K.warehousingScale, K.commitmentAreas, K.nonNegotiableAreas, K.launchStatus],
    critical: [
      critical(
        "area.4.critical.model_undecided",
        w.all(w.in(K.inventoryLocal, "yes", "probably", "not_sure"), w.any(w.eq(K.inventoryModel, "no_inventory"), w.not(w.answered(K.inventoryModel)))),
        ["firm_commitment", "non_negotiable_area", "commitment_area"],
        [
          "Local inventory is expected, but the warehousing model hasn't been decided, and {{pressure_reason}}.",
          "Se espera inventario local, pero el modelo de almacenamiento todavía no está decidido, y {{pressure_reason}}.",
        ],
      ),
    ],
    rules: [
      rule("area.4.defined.no_local_inventory", "DEFINED", w.eq(K.inventoryLocal, "no"), [
        "Local inventory isn't expected for the new operation.",
        "No se espera inventario local para la nueva operación.",
      ]),
      rule(
        "area.4.defined.model_in_place",
        "DEFINED",
        w.all(w.in(K.inventoryLocal, "yes", "probably"), w.answered(K.inventoryModel), w.neq(K.inventoryModel, "no_inventory")),
        ["Local inventory is expected, and you already work with a defined inventory model.", "Se espera inventario local y ya trabajas con un modelo de inventario definido."],
      ),
      rule(
        "area.4.needs.model_undecided",
        "NEEDS_ATTENTION",
        w.all(w.in(K.inventoryLocal, "yes", "probably", "not_sure"), w.any(w.eq(K.inventoryModel, "no_inventory"), w.not(w.answered(K.inventoryModel)))),
        ["Local inventory is expected, but the warehousing model still needs to be decided.", "Se espera inventario local, pero todavía falta decidir el modelo de almacenamiento."],
      ),
    ],
    fallback: ["area.4.needs.to_confirm", ["Local inventory needs still have to be confirmed.", "Todavía falta confirmar las necesidades de inventario local."]],
    contract_linked: false,
    weighting: {
      operational_dependency: w.includes(K.components, "warehousing_inventory"),
      capability_need: w.includes(K.expected, "warehousing"),
      scale_volume: w.declared(K.warehousingScale),
    },
    signals: [
      signal(unresolvedStatus, "The Hive: 3PL warehousing/inventory", "BY_STATUS"),
      signal(w.all(w.status("DEFINED"), w.in(K.inventoryLocal, "yes", "probably")), "The Hive: 3PL warehousing/inventory", "POSSIBLE"),
      signal(w.in(K.inventoryLocal, "yes", "probably"), "The Hive: industrial/warehouse real estate", "POSSIBLE"),
      signal(w.all(w.in(K.inventoryLocal, "yes", "probably"), w.declared(K.warehousingScale)), "The Hive: warehouse construction", "POSSIBLE"),
    ],
    capability_ids: [CAP.facilities],
    label: ["Local inventory & warehousing", "Inventario y almacenamiento local"],
    short: ["the warehousing model", "el modelo de almacenamiento"],
    precision: ["Confirm the warehousing model and, if 3PL or a build, the target scale.", "Confirmar el modelo de almacenamiento y, si es 3PL o construcción, la escala objetivo."],
  }),

  // 5. Freight & Logistics
  area({
    id: 5,
    category: "freight_logistics",
    applies_when: w.any(w.includes(K.components, "freight_transportation"), w.includes(K.components, "last_mile_delivery")),
    evidence_fields: [K.components, K.freightFrequency, K.freightType, K.lastMileDeliveries, K.lastMileLocal, K.crossBorder, K.contract],
    critical: [
      critical("area.5.critical.freight_undefined", w.all(w.eq(K.freightType, "not_sure"), w.includes(K.components, "last_mile_delivery")), ["customer_contract"], [
        "Freight and delivery requirements aren't yet defined, and your existing customer commitment likely depends on them.",
        "Los requerimientos de transporte y entrega todavía no están definidos, y es probable que tu compromiso con el cliente dependa de ellos.",
      ]),
    ],
    rules: [
      rule("area.5.defined.freight_defined", "DEFINED", w.all(w.answered(K.freightType), w.neq(K.freightType, "not_sure"), w.answered(K.freightFrequency)), [
        "Freight type and frequency are already defined.",
        "El tipo y la frecuencia de carga ya están definidos.",
      ]),
      rule("area.5.defined.last_mile_defined", "DEFINED", w.all(w.not(w.answered(K.freightType)), w.declared(K.lastMileDeliveries)), [
        "Your last-mile delivery volumes are already defined.",
        "Tus volúmenes de entrega de última milla ya están definidos.",
      ]),
      rule("area.5.needs.freight_undefined", "NEEDS_ATTENTION", w.eq(K.freightType, "not_sure"), [
        "Freight requirements still need to be defined.",
        "Todavía falta definir los requerimientos de transporte de carga.",
      ]),
    ],
    fallback: ["area.5.needs.to_confirm", ["Freight and delivery requirements still need to be confirmed.", "Todavía falta confirmar los requerimientos de transporte y entrega."]],
    contract_linked: true,
    weighting: {
      operational_dependency: w.any(w.includes(K.components, "freight_transportation"), w.includes(K.components, "last_mile_delivery")),
      capability_need: w.includes(K.expected, "logistics"),
      scale_volume: w.any(w.declared(K.lastMileDeliveries), w.answered(K.freightFrequency)),
    },
    signals: [
      signal(w.all(unresolvedStatus, w.in(K.crossBorder, "yes", "probably")), "Trade & Market Access Strategy", "BY_STATUS"),
      signal(w.all(unresolvedStatus, w.not(w.in(K.crossBorder, "yes", "probably"))), null, "POSSIBLE"),
      signal(w.includes(K.components, "freight_transportation"), "The Hive: Freight Mobility", "SUPPORTING"),
      signal(w.includes(K.components, "last_mile_delivery"), "The Hive: Last Mile", "SUPPORTING"),
    ],
    capability_ids: [CAP.freight],
    label: ["Freight & logistics", "Transporte y logística"],
    short: ["freight and delivery requirements", "los requerimientos de transporte y entrega"],
    precision: ["Confirm carrier or logistics-partner status.", "Confirmar la situación con transportistas o socios logísticos."],
  }),

  // 6. Technology Systems
  area({
    id: 6,
    category: "technology_systems",
    applies_when: w.includes(K.components, "technology_systems"),
    evidence_fields: [K.systems, K.integration, K.constraintItems],
    critical: [
      critical("area.6.critical.integration_open", w.all(w.in(K.integration, "yes", "probably", "not_sure"), w.not(w.answered(K.systems))), ["constraint_item"], [
        "System integration for the new operation is still open, and you've flagged technology as a factor that could affect your plan.",
        "La integración de sistemas para la nueva operación sigue abierta, y señalaste la tecnología como un factor que podría afectar tu plan.",
      ]),
    ],
    rules: [
      rule("area.6.defined.systems_named", "DEFINED", w.all(w.answered(K.systems), w.in(K.integration, "no", "yes", "probably")), [
        "Your critical business systems are already identified for this stage.",
        "Tus sistemas de negocio críticos ya están identificados para esta etapa.",
      ]),
      rule("area.6.defined.no_integration", "DEFINED", w.eq(K.integration, "no"), [
        "No system integration work is expected for the new operation.",
        "No se espera trabajo de integración de sistemas para la nueva operación.",
      ]),
      rule("area.6.needs.integration_open", "NEEDS_ATTENTION", w.all(w.in(K.integration, "yes", "probably", "not_sure"), w.not(w.answered(K.systems))), [
        "System integration is expected, but the systems involved still need to be identified.",
        "Se espera integración de sistemas, pero todavía falta identificar qué sistemas intervienen.",
      ]),
    ],
    fallback: ["area.6.needs.to_confirm", ["The integration work the new market needs is still being confirmed.", "Todavía se está confirmando el trabajo de integración que requiere el nuevo mercado."]],
    contract_linked: false,
    weighting: {
      operational_dependency: w.includes(K.components, "technology_systems"),
      capability_need: w.includes(K.expected, "technology", "cyber_data"),
    },
    signals: [signal(w.neq(K.integration, "no"), "The Hive: Management Systems", "BY_STATUS")],
    capability_ids: [CAP.systems],
    label: ["Technology systems", "Sistemas tecnológicos"],
    short: ["system integration", "la integración de sistemas"],
    precision: ["Confirm which systems require new-market configuration.", "Confirmar qué sistemas requieren configuración para el nuevo mercado."],
  }),

  // 7. Local Workforce
  area({
    id: 7,
    category: "local_workforce",
    applies_when: w.includes(K.components, "local_workforce"),
    evidence_fields: [K.hiring, K.headcount, K.launchStatus],
    critical: [
      critical("area.7.critical.headcount_open", w.all(w.in(K.hiring, "yes", "probably"), w.not(w.declared(K.headcount))), ["firm_commitment"], [
        "Local hiring is expected, but scale hasn't been defined, and {{pressure_reason}}.",
        "Se espera contratar personal local, pero la escala todavía no está definida, y {{pressure_reason}}.",
      ]),
    ],
    rules: [
      rule("area.7.defined.no_local_hiring", "DEFINED", w.eq(K.hiring, "no"), [
        "Local hiring isn't expected for the new operation.",
        "No se espera contratar personal local para la nueva operación.",
      ]),
      rule("area.7.defined.headcount_sized", "DEFINED", w.all(w.in(K.hiring, "yes", "probably"), w.declared(K.headcount)), [
        "Local hiring is expected, and first-year headcount is already sized.",
        "Se espera contratar personal local y la plantilla del primer año ya está dimensionada.",
      ]),
      rule("area.7.needs.headcount_open", "NEEDS_ATTENTION", w.all(w.in(K.hiring, "yes", "probably"), w.not(w.declared(K.headcount))), [
        "Local hiring is expected, but the team size still needs to be defined.",
        "Se espera contratar personal local, pero todavía falta definir el tamaño del equipo.",
      ]),
      rule("area.7.needs.hiring_open", "NEEDS_ATTENTION", w.eq(K.hiring, "not_sure"), [
        "Whether you'll hire locally is still open.",
        "Todavía está abierto si vas a contratar personal local.",
      ]),
    ],
    fallback: ["area.7.needs.to_confirm", ["Local workforce needs still have to be confirmed.", "Todavía falta confirmar las necesidades de personal local."]],
    contract_linked: false,
    weighting: {
      operational_dependency: w.includes(K.components, "local_workforce"),
      capability_need: w.includes(K.expected, "talent_hr", "payroll"),
      scale_volume: w.declared(K.headcount),
    },
    signals: [signal(w.in(K.hiring, "yes", "probably", "not_sure"), "The Hive: HR / Business Process Solutions", "BY_STATUS")],
    capability_ids: [CAP.workforce],
    label: ["Local workforce", "Personal local"],
    short: ["local workforce planning", "la planeación del personal local"],
    precision: ["Confirm the target headcount and role mix by function.", "Confirmar la plantilla objetivo y la mezcla de puestos por función."],
  }),

  // 8. Facilities & Real Estate
  area({
    id: 8,
    category: "facilities_real_estate",
    applies_when: w.includes(K.components, "physical_facilities"),
    evidence_fields: [K.facility, K.location, K.commitmentAreas, K.nonNegotiableAreas, K.launchStatus],
    critical: [
      critical("area.8.critical.location_open", w.all(w.in(K.facility, ...SPECIFIC_FACILITY), w.eq(K.location, "no")), ["non_negotiable_area", "commitment_area", "firm_commitment"], [
        "A facility is required for this operation, but a location hasn't been selected, and {{pressure_reason}}.",
        "Esta operación requiere instalaciones, pero todavía no se ha seleccionado la ubicación, y {{pressure_reason}}.",
      ]),
    ],
    rules: [
      rule("area.8.defined.location_selected", "DEFINED", w.all(w.in(K.facility, ...SPECIFIC_FACILITY), w.eq(K.location, "yes")), [
        "The facility type and location are already selected.",
        "El tipo de instalación y la ubicación ya están seleccionados.",
      ]),
      rule("area.8.defined.no_facility", "DEFINED", w.eq(K.facility, "no"), [
        "No new facility is expected for this operation.",
        "No se esperan nuevas instalaciones para esta operación.",
      ]),
      rule("area.8.needs.location_open", "NEEDS_ATTENTION", w.all(w.in(K.facility, ...SPECIFIC_FACILITY), w.in(K.location, "evaluating", "no")), [
        "A facility is required, and the location still needs to be selected.",
        "Se requieren instalaciones y todavía falta seleccionar la ubicación.",
      ]),
    ],
    fallback: ["area.8.needs.to_confirm", ["Facility requirements still need to be confirmed.", "Todavía falta confirmar los requerimientos de instalaciones."]],
    contract_linked: false,
    weighting: {
      operational_dependency: w.includes(K.components, "physical_facilities"),
      capability_need: w.includes(K.expected, "facilities"),
    },
    signals: [signal(w.in(K.facility, ...SPECIFIC_FACILITY), "The Hive: industrial/warehouse real estate", "BY_STATUS")],
    capability_ids: [CAP.facilities],
    label: ["Facilities & real estate", "Instalaciones e inmuebles"],
    short: ["the facility location", "la ubicación de las instalaciones"],
    precision: ["Confirm the facility search status and selection criteria.", "Confirmar el avance de la búsqueda de instalaciones y los criterios de selección."],
  }),

  // 9. Local Partner / Distributor
  area({
    id: 9,
    category: "local_partner_distributor",
    applies_when: w.includes(K.components, "external_partners"),
    evidence_fields: [K.partnerDependency, K.partnerStatus, K.contract, K.commitmentAreas, K.launchStatus],
    critical: [
      critical("area.9.critical.partner_open", w.all(w.eq(K.partnerDependency, "yes"), w.in(K.partnerStatus, ...PRE_SELECTION)), ["firm_commitment", "contract_and_commitment_area"], [
        "This operation depends on a local partner who hasn't been selected yet, and {{pressure_reason}}.",
        "Esta operación depende de un socio local que todavía no se ha seleccionado, y {{pressure_reason}}.",
      ]),
    ],
    rules: [
      rule("area.9.defined.partner_selected", "DEFINED", w.all(w.in(K.partnerDependency, "yes", "probably"), w.in(K.partnerStatus, "selected", "already_working_together")), [
        "Your local partner is already selected or working with you.",
        "Tu socio local ya está seleccionado o trabajando contigo.",
      ]),
      rule("area.9.defined.no_dependency", "DEFINED", w.eq(K.partnerDependency, "no"), [
        "The operation isn't expected to depend on a local partner.",
        "No se espera que la operación dependa de un socio local.",
      ]),
      rule("area.9.needs.partner_open", "NEEDS_ATTENTION", w.all(w.in(K.partnerDependency, "yes", "probably", "not_sure"), w.in(K.partnerStatus, ...PRE_SELECTION)), [
        "The operation relies on a local partner, and the search or evaluation is still under way.",
        "La operación se apoya en un socio local y la búsqueda o evaluación sigue en curso.",
      ]),
    ],
    fallback: ["area.9.needs.to_confirm", ["The role of a local partner still needs to be confirmed.", "Todavía falta confirmar el papel de un socio local."]],
    contract_linked: true,
    weighting: {
      operational_dependency: w.eq(K.partnerDependency, "yes"),
      capability_need: w.includes(K.expected, "local_partner_distributor"),
    },
    signals: [
      signal(w.all(w.neq(K.partnerDependency, "no"), w.in(K.partnerStatus, "still_looking", "identified")), "Local Partner Search & Match", "BY_STATUS"),
      signal(w.all(w.neq(K.partnerDependency, "no"), w.in(K.partnerStatus, "evaluating", "in_discussions")), "Local Partner Search & Match", "SUPPORTING"),
      signal(w.all(w.neq(K.partnerDependency, "no"), w.eq(K.partnerStatus, "selected")), "Business Check / Third-Party Qualification", "STRONG"),
    ],
    capability_ids: [CAP.partnersSuppliers],
    label: ["Local partners & distributors", "Socios y distribuidores locales"],
    short: ["the local partner", "el socio local"],
    precision: [
      "Confirm the partner search criteria or, if a partner is selected, the validation scope; read the partner relationship context verbatim.",
      "Confirmar los criterios de búsqueda del socio o, si ya está seleccionado, el alcance de su validación; leer textualmente el contexto de la relación.",
    ],
  }),

  // 10. Permits & Regulatory Certifications
  area({
    id: 10,
    category: "regulatory_permits_certifications",
    applies_when: w.any(w.includes(K.components, "regulated_activities"), w.includes(K.constraintItems, "regulatory_permits_certifications", "customs_trade")),
    evidence_fields: [K.components, K.permits, K.permitsWhich, K.criticalConstraint, K.crossBorder, K.constraintItems],
    critical: [
      critical("area.10.critical.permits_unresolved", w.eq(K.permits, "not_sure"), ["critical_constraint", "firm_commitment"], [
        "Regulatory approvals for this operation are unresolved, and {{pressure_reason}}.",
        "Las aprobaciones regulatorias de esta operación no están resueltas, y {{pressure_reason}}.",
      ]),
    ],
    rules: [
      rule("area.10.defined.permits_identified", "DEFINED", w.all(w.eq(K.permits, "yes"), w.answered(K.permitsWhich)), [
        "The permits and certifications your operation holds are already identified.",
        "Los permisos y certificaciones con los que cuenta tu operación ya están identificados.",
      ]),
      rule("area.10.needs.permits_unresolved", "NEEDS_ATTENTION", w.eq(K.permits, "not_sure"), [
        "Regulatory approvals for this operation are still unresolved.",
        "Las aprobaciones regulatorias de esta operación todavía no están resueltas.",
      ]),
    ],
    fallback: ["area.10.needs.to_confirm", ["The permits and certifications this operation needs still have to be confirmed.", "Todavía falta confirmar los permisos y certificaciones que necesita esta operación."]],
    contract_linked: false,
    weighting: {
      operational_dependency: w.includes(K.components, "regulated_activities"),
      capability_need: w.includes(K.expected, "regulatory_compliance"),
    },
    signals: [
      signal(w.all(unresolvedStatus, w.in(K.crossBorder, "yes", "probably")), "Trade & Market Access Strategy", "BY_STATUS"),
      signal(w.all(w.status("DEFINED"), w.in(K.crossBorder, "yes", "probably")), "The Hive: Foreign Trade & Customs Advisory", "SUPPORTING"),
      signal(w.all(unresolvedStatus, w.not(w.in(K.crossBorder, "yes", "probably"))), null, "POSSIBLE"),
    ],
    capability_ids: [CAP.permits],
    label: ["Regulatory permits & certifications", "Permisos y certificaciones regulatorias"],
    short: ["regulatory approvals", "las aprobaciones regulatorias"],
    precision: ["Confirm which specific permits or certifications apply and their lead times.", "Confirmar qué permisos o certificaciones aplican y sus tiempos de obtención."],
  }),

  // 11. Local Entity & Legal Setup
  area({
    id: 11,
    category: "local_entity_legal_setup",
    applies_when: w.any(
      w.includes(K.expected, "legal_corporate"),
      w.all(w.not(w.includes(K.definedAreas, "legal")), w.in(K.stage, "preparing_entry", "already_executing", "already_operating")),
    ),
    evidence_fields: [K.expected, K.definedAreas, K.stage, K.launchStatus],
    critical: [
      critical("area.11.critical.entity_undefined", w.all(w.includes(K.expected, "legal_corporate"), w.not(w.includes(K.definedAreas, "legal"))), ["execution_stage", "firm_commitment"], [
        "Your local entity structure isn't yet defined, and {{pressure_reason}}.",
        "La estructura de tu entidad local todavía no está definida, y {{pressure_reason}}.",
      ]),
    ],
    rules: [
      rule("area.11.defined.legal_defined", "DEFINED", w.includes(K.definedAreas, "legal"), [
        "Your local legal structure is already defined for this stage.",
        "Tu estructura legal local ya está definida para esta etapa.",
      ]),
      rule("area.11.needs.entity_undefined", "NEEDS_ATTENTION", w.includes(K.expected, "legal_corporate"), [
        "A local legal structure is needed, and it still has to be defined.",
        "Se necesita una estructura legal local y todavía falta definirla.",
      ]),
    ],
    fallback: [
      "area.11.needs.stage_without_legal",
      ["Your project is moving toward execution, and the local legal structure still needs to be confirmed.", "Tu proyecto avanza hacia la ejecución y todavía falta confirmar la estructura legal local."],
    ],
    contract_linked: false,
    weighting: { capability_need: w.includes(K.expected, "legal_corporate") },
    signals: [signal(unresolvedStatus, "The Hive: Firm Infrastructure / company setup", "BY_STATUS")],
    capability_ids: [CAP.entity],
    label: ["Local entity & legal setup", "Entidad local y estructura legal"],
    short: ["the local legal structure", "la estructura legal local"],
    precision: [
      "Confirm the intended legal structure early — it is frequently a blocking dependency for other areas.",
      "Confirmar pronto la estructura legal prevista: con frecuencia es una dependencia que bloquea otras áreas.",
    ],
  }),

  // 12. Banking
  area({
    id: 12,
    category: "banking",
    applies_when: w.includes(K.expected, "banking"),
    evidence_fields: [K.expected, K.banking],
    critical: [
      critical("area.12.critical.banking_open", w.in(K.banking, ...UNRESOLVED_ESTABLISHMENT), ["firm_commitment", "commitment_area", "non_negotiable_area", "client_priority", "critical_constraint"], [
        "Local banking still needs to be established, and {{pressure_reason}}.",
        "Todavía falta establecer la banca local, y {{pressure_reason}}.",
      ]),
    ],
    rules: [
      rule("area.12.defined.banking_in_place", "DEFINED", w.eq(K.banking, "already_in_place"), ["Local banking is already in place.", "La banca local ya está resuelta."]),
      rule("area.12.needs.banking_open", "NEEDS_ATTENTION", w.in(K.banking, ...UNRESOLVED_ESTABLISHMENT), [
        "Local banking still needs to be established.",
        "Todavía falta establecer la banca local.",
      ]),
    ],
    fallback: ["area.12.needs.to_confirm", ["Local banking still needs to be confirmed.", "Todavía falta confirmar la banca local."]],
    contract_linked: false,
    weighting: { capability_need: w.includes(K.expected, "banking") },
    signals: [signal(unresolvedStatus, "The Hive: corporate banks", "BY_STATUS")],
    capability_ids: [CAP.bankingInsurance],
    label: ["Banking", "Banca"],
    short: ["local banking", "la banca local"],
    precision: ["Confirm the banking relationship status and any timing dependency.", "Confirmar la situación de la relación bancaria y cualquier dependencia de tiempos."],
  }),

  // 13. Insurance
  area({
    id: 13,
    category: "insurance",
    applies_when: w.includes(K.expected, "insurance"),
    evidence_fields: [K.expected, K.insurance],
    critical: [
      critical("area.13.critical.insurance_open", w.in(K.insurance, ...UNRESOLVED_ESTABLISHMENT), ["firm_commitment", "commitment_area", "non_negotiable_area", "client_priority", "critical_constraint"], [
        "Insurance for the new operation still needs to be established, and {{pressure_reason}}.",
        "Todavía falta contratar los seguros para la nueva operación, y {{pressure_reason}}.",
      ]),
    ],
    rules: [
      rule("area.13.defined.insurance_in_place", "DEFINED", w.eq(K.insurance, "already_in_place"), [
        "Insurance for the new operation is already in place.",
        "Los seguros para la nueva operación ya están resueltos.",
      ]),
      rule("area.13.needs.insurance_open", "NEEDS_ATTENTION", w.in(K.insurance, ...UNRESOLVED_ESTABLISHMENT), [
        "Insurance for the new operation still needs to be established.",
        "Todavía falta contratar los seguros para la nueva operación.",
      ]),
    ],
    fallback: ["area.13.needs.to_confirm", ["Insurance for the new operation still needs to be confirmed.", "Todavía falta confirmar los seguros para la nueva operación."]],
    contract_linked: false,
    weighting: { capability_need: w.includes(K.expected, "insurance") },
    signals: [signal(unresolvedStatus, "The Hive: insurance", "BY_STATUS")],
    capability_ids: [CAP.bankingInsurance],
    label: ["Insurance", "Seguros"],
    short: ["insurance", "los seguros"],
    precision: ["Confirm the insurance status and any timing dependency.", "Confirmar la situación de los seguros y cualquier dependencia de tiempos."],
  }),

  // 14. Go-to-Market & Commercial Strategy
  area({
    id: 14,
    category: "go_to_market_commercial_strategy",
    applies_when: w.any(w.includes(K.expected, "commercial_strategy", "sales_channels", "marketing"), w.eq(K.primaryGoal, "find_customers_partners")),
    evidence_fields: [K.expected, K.primaryGoal, K.revenueModel, K.customerModel, K.definedAreas, K.contract, K.clientPriority],
    critical: [
      critical("area.14.critical.gtm_open", w.not(w.includes(K.definedAreas, "commercial_model", "sales_channel")), ["client_priority", "customer_contract"], [
        "How you'll sell and compete locally is still open, and {{pressure_reason}}.",
        "Cómo vas a vender y competir localmente sigue abierto, y {{pressure_reason}}.",
      ]),
    ],
    rules: [
      rule("area.14.defined.gtm_defined", "DEFINED", w.includes(K.definedAreas, "commercial_model", "sales_channel"), [
        "Your commercial model or sales channel is already defined for this stage.",
        "Tu modelo comercial o canal de venta ya está definido para esta etapa.",
      ]),
      rule("area.14.needs.gtm_open", "NEEDS_ATTENTION", w.not(w.includes(K.definedAreas, "commercial_model", "sales_channel")), [
        "How you'll sell and compete locally still needs to be defined.",
        "Todavía falta definir cómo vas a vender y competir localmente.",
      ]),
    ],
    fallback: ["area.14.needs.to_confirm", ["Your go-to-market approach still needs to be confirmed.", "Todavía falta confirmar tu estrategia comercial."]],
    contract_linked: true,
    weighting: { capability_need: w.includes(K.expected, "commercial_strategy", "sales_channels", "marketing") },
    signals: [
      signal(unresolvedStatus, "Commercial & Go-to-Market Strategy", "BY_STATUS"),
      signal(w.includes(K.expected, "local_partner_distributor"), "Partnership & Capability Strategy", "BY_STATUS"),
    ],
    capability_ids: [CAP.gtm],
    label: ["Go-to-market strategy", "Estrategia comercial"],
    short: ["how you'll sell locally", "cómo vas a vender localmente"],
    precision: ["Confirm the channel strategy and the terms of any existing commercial commitments.", "Confirmar la estrategia de canales y las condiciones de los compromisos comerciales existentes."],
  }),
];

export function buildRulesEngineBundle(): RulesEngineBundle {
  return {
    schema_version: 1,
    product: "first_assessment_rules",
    locales: ["en", "es"],
    variables: ["pressure_reason", "client_priority", "tension_area"],
    question_bank_versions: ["fa-qb-1.0.0"],
    areas: AREAS,
    pressure_reasons: [
      { id: "firm_commitment", copy: reason(["your timing is already firm", "tus tiempos ya están comprometidos"]) },
      { id: "customer_contract", copy: reason(["there's already a customer commitment to fulfill", "ya existe un compromiso con un cliente que cumplir"]) },
      { id: "commitment_area", copy: reason(["it's part of a commitment you've already made", "forma parte de un compromiso que ya asumiste"]) },
      { id: "non_negotiable_area", copy: reason(["it's connected to something you've said can't be compromised", "está ligado a algo que dijiste que no puedes comprometer"]) },
      { id: "client_priority", copy: reason(["it's the area you said needs to move first", "es el área que dijiste que necesita avanzar primero"]) },
      { id: "critical_constraint", copy: reason(["this is the constraint you flagged as most likely to affect your plan", "es la restricción que señalaste como la de mayor impacto en tu plan"]) },
      { id: "constraint_item", copy: reason(["you've flagged it as a factor that could affect your plan", "la señalaste como un factor que podría afectar tu plan"]) },
      { id: "contract_and_commitment_area", copy: reason(["it's part of the customer commitment you've already made", "forma parte del compromiso con un cliente que ya asumiste"]) },
      { id: "execution_stage", copy: reason(["you've indicated you're already preparing to execute", "indicaste que ya te estás preparando para ejecutar"]) },
    ],
    panels: { DEFINED: { ceiling: 5 }, NEEDS_ATTENTION: { ceiling: 5 }, CRITICAL_GAP: { ceiling: 5 } },
    capabilities: {
      ceiling: 6,
      categories: [
        { id: 1, copy: { en: { label: "Trade & customs", description: "Getting goods across borders — duties, documentation, import structure" }, es: { label: "Comercio exterior y aduanas", description: "Mover mercancía entre fronteras: aranceles, documentación y estructura de importación" } } },
        { id: 2, copy: { en: { label: "Local entity & legal setup", description: "Setting up the legal structure this market requires" }, es: { label: "Entidad local y estructura legal", description: "Establecer la estructura legal que requiere este mercado" } } },
        { id: 3, copy: { en: { label: "Regulatory permits & certifications", description: "Getting the specific approvals and certifications your operation needs" }, es: { label: "Permisos y certificaciones regulatorias", description: "Obtener las aprobaciones y certificaciones específicas que necesita tu operación" } } },
        { id: 4, copy: { en: { label: "Local partners & suppliers", description: "Finding and qualifying the people you'll depend on locally" }, es: { label: "Socios y proveedores locales", description: "Encontrar y validar a los socios y proveedores de los que dependerás localmente" } } },
        { id: 5, copy: { en: { label: "Workforce & HR setup", description: "Hiring and managing people in the new market" }, es: { label: "Personal y recursos humanos", description: "Contratar y gestionar personal en el nuevo mercado" } } },
        { id: 6, copy: { en: { label: "Facilities & warehousing", description: "Where you'll store, produce, or operate from" }, es: { label: "Instalaciones y almacenamiento", description: "Dónde vas a almacenar, producir u operar" } } },
        { id: 7, copy: { en: { label: "Freight & logistics", description: "Moving goods to and within the new market" }, es: { label: "Transporte y logística", description: "Mover mercancía hacia y dentro del nuevo mercado" } } },
        { id: 8, copy: { en: { label: "Systems & technology", description: "Making your existing systems work in the new market" }, es: { label: "Sistemas y tecnología", description: "Hacer que tus sistemas funcionen en el nuevo mercado" } } },
        { id: 9, copy: { en: { label: "Banking & insurance", description: "Local financial and risk infrastructure" }, es: { label: "Banca y seguros", description: "Infraestructura financiera y de riesgos local" } } },
        { id: 10, copy: { en: { label: "Go-to-market strategy", description: "How you'll sell and compete locally" }, es: { label: "Estrategia comercial", description: "Cómo vas a vender y competir localmente" } } },
      ],
    },
    growth_boosts: [
      { value: "grow_sales", area_ids: [14], capability_boost: true },
      { value: "improve_local_operation", area_ids: [7, 8, 6, 4], capability_boost: true },
      { value: "find_replace_suppliers", area_ids: [3], capability_boost: true },
      { value: "find_partners_distributors", area_ids: [9], capability_boost: true },
      { value: "strengthen_compliance", area_ids: [10, 11], capability_boost: true, strategic_signal: "Third-Party Qualification / Business Check" },
      { value: "improve_logistics", area_ids: [5, 4], capability_boost: true },
      { value: "add_capabilities_infrastructure", area_ids: [6, 8], capability_boost: true },
      { value: "reduce_operating_risk", area_ids: [10, 12, 13], capability_boost: true },
      { value: "explore_growth_opportunity", area_ids: [14], capability_boost: false, strategic_signal: "Growth Strategy Playbook" },
    ],
    priority_alignment: {
      go_to_market_dependency_area_ids: [11, 7, 8, 4, 5, 6, 3, 9],
      timing_driver_area_ids: {},
      copy: {
        en: {
          template: "Your priority is to {{client_priority}}, but {{tension_area}} required to support that is still unresolved.",
          priority_phrases: {
            target_market: "decide your target market",
            customs_trade: "define your import and customs structure",
            local_sourcing_suppliers: "secure local suppliers",
            local_inventory_warehousing: "set up local inventory and warehousing",
            freight_logistics: "define your freight and logistics",
            technology_systems: "prepare your technology systems",
            local_workforce: "build your local team",
            facilities_real_estate: "secure your facilities",
            local_partner_distributor: "secure a local partner or distributor",
            regulatory_permits_certifications: "obtain the permits and certifications you need",
            local_entity_legal_setup: "set up your local entity",
            banking: "establish local banking",
            insurance: "put insurance in place",
            go_to_market_commercial_strategy: "define how you'll sell and compete locally",
            other: "move your declared priority forward",
          },
        },
        es: {
          template: "Tu prioridad es {{client_priority}}, pero para lograrlo todavía falta resolver {{tension_area}}.",
          priority_phrases: {
            target_market: "definir tu mercado objetivo",
            customs_trade: "definir tu estructura de importación y aduanas",
            local_sourcing_suppliers: "asegurar proveedores locales",
            local_inventory_warehousing: "establecer inventario y almacenamiento local",
            freight_logistics: "definir tu transporte y logística",
            technology_systems: "preparar tus sistemas tecnológicos",
            local_workforce: "formar tu equipo local",
            facilities_real_estate: "asegurar tus instalaciones",
            local_partner_distributor: "asegurar un socio o distribuidor local",
            regulatory_permits_certifications: "obtener los permisos y certificaciones que necesitas",
            local_entity_legal_setup: "constituir tu entidad local",
            banking: "establecer la banca local",
            insurance: "contratar los seguros necesarios",
            go_to_market_commercial_strategy: "definir cómo vas a vender y competir localmente",
            other: "avanzar con tu prioridad declarada",
          },
        },
      },
    },
    near_timing_threshold_days: null,
    internal: {
      handoff_quality: { high_max_not_sure: 2, medium_max_not_sure: 5 },
      decision_flexibility: { high_max_commitments: 0, medium_max_commitments: 2 },
    },
  };
}
