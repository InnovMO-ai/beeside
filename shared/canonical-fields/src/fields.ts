/**
 * First Assessment canonical field registry — the single source of truth for `fa.*` keys.
 *
 * PostgreSQL `field_key_registry` is a synchronized representation of FA_FIELDS (backend
 * `db:sync-fields`), never hand-edited. Question-bank bundles reference these keys and may only
 * use the option values declared here; display copy lives in the versioned question bank, never
 * here. Keys are stable technical identifiers: renaming one is a breaking, versioned change.
 * Future Precision keys use the `precision.*` namespace and are not defined in this module.
 */

export const SUPPORTED_LOCALES = ["en", "es"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export type FieldDataType =
  | "text"
  | "short_text"
  | "single_select"
  | "multi_select"
  | "timing"
  | "country_list"
  | "quantity"
  | "email"
  | "url"
  | "locale";

/** identity = bound to a person/company column; question_bank = stored as an `answer` row. */
export type FieldSource = "identity" | "question_bank";

export type FieldBinding =
  | "person.first_name"
  | "person.last_name"
  | "person.primary_email"
  | "person.preferred_name"
  | "person.interface_language"
  | "person.preferred_interaction_language"
  | "person.preferred_deliverable_language"
  | "company.name"
  | "company.website";

export interface CanonicalFieldDefinition {
  key: string;
  dataType: FieldDataType;
  source: FieldSource;
  module: "first_assessment";
  description: string;
  /** Allowed stored values for select fields (display copy lives in the question bank). */
  values?: readonly string[];
  /** Values that cannot be combined with any other value in a multi-select. */
  exclusiveValues?: readonly string[];
  /** Raw open text: stored verbatim, never interpreted by First Assessment. */
  openText?: boolean;
  /** Identity-sourced fields are persisted in this column instead of `answer`. */
  binding?: FieldBinding;
}

/** Rules Matrix v1 §0 fixed category list (same order/ids as the rules_matrix_category catalog). */
export const RULES_CATEGORY_VALUES = [
  "target_market",
  "customs_trade",
  "local_sourcing_suppliers",
  "local_inventory_warehousing",
  "freight_logistics",
  "technology_systems",
  "local_workforce",
  "facilities_real_estate",
  "local_partner_distributor",
  "regulatory_permits_certifications",
  "local_entity_legal_setup",
  "banking",
  "insurance",
  "go_to_market_commercial_strategy",
  "other",
] as const;
export type RulesCategory = (typeof RULES_CATEGORY_VALUES)[number];

/** rules_matrix_category.category_id for each category value (1-based, catalog order). */
export const RULES_CATEGORY_ID: Readonly<Record<RulesCategory, number>> = Object.fromEntries(
  RULES_CATEGORY_VALUES.map((value, index) => [value, index + 1]),
) as Record<RulesCategory, number>;

const YES_PROBABLY_NO_NOT_SURE = ["yes", "probably", "no", "not_sure"] as const;
const RELATIONSHIP_STATUS = [
  "still_looking",
  "identified",
  "evaluating",
  "in_discussions",
  "selected",
  "already_working_together",
] as const;
const RESOLUTION_STATUS = ["already_in_place", "in_progress", "need_to_establish", "not_sure_required"] as const;

function field(definition: Omit<CanonicalFieldDefinition, "module">): CanonicalFieldDefinition {
  return { module: "first_assessment", ...definition };
}

export const FA_FIELDS: readonly CanonicalFieldDefinition[] = [
  // ---------------------------------------------------------------- Identity (bound columns)
  field({ key: "fa.identity.first_name", dataType: "short_text", source: "identity", binding: "person.first_name", description: "Respondent first name." }),
  field({ key: "fa.identity.last_name", dataType: "short_text", source: "identity", binding: "person.last_name", description: "Respondent last name." }),
  field({ key: "fa.identity.email", dataType: "email", source: "identity", binding: "person.primary_email", description: "Respondent email, normalized (trim + lowercase); identifies person_id." }),
  field({ key: "fa.company.name", dataType: "short_text", source: "identity", binding: "company.name", description: "Company name as declared." }),
  field({ key: "fa.company.website", dataType: "url", source: "identity", binding: "company.website", description: "Company website (optional)." }),
  field({ key: "fa.preferences.interface_language", dataType: "locale", source: "identity", binding: "person.interface_language", values: ["en", "es"], description: "Language chosen for the assessment interface." }),
  field({ key: "fa.preferences.preferred_name", dataType: "short_text", source: "identity", binding: "person.preferred_name", description: "How the respondent prefers to be addressed (optional)." }),
  field({ key: "fa.preferences.interaction_language", dataType: "locale", source: "identity", binding: "person.preferred_interaction_language", values: ["en", "es"], description: "Language for future beeside interactions." }),
  field({ key: "fa.preferences.deliverable_language", dataType: "locale", source: "identity", binding: "person.preferred_deliverable_language", values: ["en", "es"], description: "Language for deliverables prepared for the respondent." }),
  field({ key: "fa.identity.personal_email_acknowledged", dataType: "single_select", source: "question_bank", values: ["yes"], description: "Respondent chose to continue with a personal-domain email (non-blocking acknowledgement)." }),

  // ---------------------------------------------------------------- Project story
  field({ key: "fa.project.story_raw", dataType: "text", source: "question_bank", openText: true, description: "Project narrative in the respondent's own words (verbatim)." }),
  field({ key: "fa.project.another_project_in_mind", dataType: "single_select", source: "question_bank", values: ["yes", "no", "not_sure"], description: "Whether the respondent has another, separate project in mind." }),

  // ---------------------------------------------------------------- Goal (G1–G6)
  field({ key: "fa.goal.primary_goal", dataType: "single_select", source: "question_bank", description: "Project objective (G1).", values: ["enter_first_time", "start_selling_locally", "set_up_local_operation", "find_customers_partners", "build_local_supply_chain", "expand_existing_operation", "evaluate_entry", "other"] }),
  field({ key: "fa.goal.success_definition", dataType: "text", source: "question_bank", openText: true, description: "What a successful expansion looks like (G2, verbatim)." }),
  field({ key: "fa.goal.launch_timing_status", dataType: "single_select", source: "question_bank", description: "Whether a start date exists (G3).", values: ["firm_commitment", "target_date", "approximate_timeframe", "not_yet"] }),
  field({ key: "fa.goal.launch_target", dataType: "timing", source: "question_bank", description: "Launch timing as exact date, target month, approximate quarter/year, or not sure (G4)." }),
  field({ key: "fa.goal.timing_driver", dataType: "single_select", source: "question_bank", description: "What drives the timing (G5).", values: ["customer_contract", "internal_plan", "market_opportunity", "investment_decision", "supply_chain_requirement", "regulatory", "partner_commitment", "seasonality", "other"] }),
  field({ key: "fa.goal.expansion_driver", dataType: "single_select", source: "question_bank", description: "What drives the expansion (G6).", values: ["existing_customer_demand", "new_market_opportunity", "growth_targets", "customer_request", "supply_chain_strategy", "cost_advantage", "diversification", "competitive_pressure", "investor_board_direction", "other"] }),

  // ---------------------------------------------------------------- Project (P1–P6)
  field({ key: "fa.project.destination_status", dataType: "single_select", source: "question_bank", description: "How defined the target market is (P1).", values: ["know_country_location", "know_country_comparing_locations", "comparing_countries", "havent_decided"] }),
  field({ key: "fa.project.target_markets", dataType: "country_list", source: "question_bank", description: "Destination country/market(s), ISO 3166-1 alpha-2 (P2)." }),
  field({ key: "fa.project.target_location_detail", dataType: "short_text", source: "question_bank", openText: true, description: "Optional region/city detail for the destination (P2)." }),
  field({ key: "fa.project.stage", dataType: "single_select", source: "question_bank", description: "Where the project is today (P3).", values: ["exploring", "business_case", "validating", "preparing_entry", "already_executing", "already_operating"] }),
  field({ key: "fa.project.defined_areas", dataType: "multi_select", source: "question_bank", description: "Areas that already feel reasonably defined (P4).", values: ["target_market", "location", "customer_segment", "commercial_model", "sales_channel", "offer", "legal", "tax", "supply_chain", "logistics", "suppliers", "partners", "facilities", "technology", "talent", "regulatory", "budget", "timing", "none"], exclusiveValues: ["none"] }),
  field({ key: "fa.project.previous_expansion_experience", dataType: "single_select", source: "question_bank", values: ["yes", "no"], description: "Has expanded internationally before (P5)." }),
  field({ key: "fa.project.previous_expansion_learning", dataType: "text", source: "question_bank", openText: true, description: "What was learned from previous expansion (P5 follow-up, verbatim)." }),
  field({ key: "fa.project.next_decision", dataType: "text", source: "question_bank", openText: true, description: "Next important decision (P6, verbatim)." }),
  field({ key: "fa.strategic.decided_vs_open", dataType: "text", source: "question_bank", openText: true, description: "Strategic prompt 1: what is decided and what is still open (verbatim)." }),

  // ---------------------------------------------------------------- Business (B1–B6)
  field({ key: "fa.business.description", dataType: "text", source: "question_bank", openText: true, description: "What the company does, in one sentence (B1, verbatim)." }),
  field({ key: "fa.business.type", dataType: "single_select", source: "question_bank", description: "Business type / industry (B2).", values: ["manufacturing", "distribution_wholesale", "retail", "ecommerce", "professional_services", "technology_saas", "logistics", "construction_infrastructure", "financial_services", "consumer_services", "other"] }),
  field({ key: "fa.business.customer_model", dataType: "single_select", source: "question_bank", values: ["b2b", "b2c", "b2g", "combination"], description: "Customer model (B3)." }),
  field({ key: "fa.business.revenue_model", dataType: "single_select", source: "question_bank", description: "What customers pay for (B4).", values: ["physical_products", "professional_services", "software_subscriptions", "projects", "usage_transactions", "digital_products", "combination", "other"] }),
  field({ key: "fa.business.value_chain_role", dataType: "multi_select", source: "question_bank", values: ["manufacture", "assemble", "source", "import", "distribute", "sell_direct"], description: "Role in the physical-product value chain (B5)." }),
  field({ key: "fa.business.employee_band", dataType: "single_select", source: "question_bank", values: ["1_10", "11_50", "51_200", "201_500", "501_1000", "1000_plus"], description: "Employee band (B6)." }),
  field({ key: "fa.strategic.commercial_success", dataType: "text", source: "question_bank", openText: true, description: "Strategic prompt 2: what would make the expansion commercially successful (verbatim)." }),

  // ---------------------------------------------------------------- Operation (O1 + follow-ups)
  field({ key: "fa.operation.components", dataType: "multi_select", source: "question_bank", description: "Operation components important to delivering what is sold today (O1).", values: ["manufacturing", "sourcing_suppliers", "import_export", "warehousing_inventory", "freight_transportation", "last_mile_delivery", "physical_facilities", "technology_systems", "local_workforce", "external_partners", "regulated_activities", "other"] }),
  field({ key: "fa.operation.manufacturing.monthly_volume", dataType: "quantity", source: "question_bank", description: "Monthly production volume (amount + unit, or not sure)." }),
  field({ key: "fa.operation.manufacturing.sku_range", dataType: "single_select", source: "question_bank", values: ["lt_10", "10_50", "51_250", "251_1000", "1000_plus"], description: "SKU / product line range." }),
  field({ key: "fa.operation.sourcing.critical_supplier_count", dataType: "single_select", source: "question_bank", values: ["1_5", "6_20", "21_50", "51_plus", "not_sure"], description: "Critical supplier count range." }),
  field({ key: "fa.operation.sourcing.local_expected", dataType: "single_select", source: "question_bank", values: YES_PROBABLY_NO_NOT_SURE, description: "Local sourcing expected in the new market." }),
  field({ key: "fa.operation.sourcing.local_items", dataType: "text", source: "question_bank", openText: true, description: "What needs to be sourced locally (verbatim)." }),
  field({ key: "fa.operation.sourcing.relationship_status", dataType: "single_select", source: "question_bank", values: RELATIONSHIP_STATUS, description: "Supplier relationship status." }),
  field({ key: "fa.operation.sourcing.relationship_context", dataType: "text", source: "question_bank", openText: true, description: "Optional supplier relationship context (verbatim)." }),
  field({ key: "fa.operation.import_export.monthly_shipments", dataType: "single_select", source: "question_bank", values: ["lt_5", "5_20", "21_100", "101_plus", "not_sure"], description: "Typical cross-border shipments per month." }),
  field({ key: "fa.operation.import_export.cross_border_expected", dataType: "single_select", source: "question_bank", values: YES_PROBABLY_NO_NOT_SURE, description: "Goods will cross borders in the new operation." }),
  field({ key: "fa.operation.warehousing.current_model", dataType: "single_select", source: "question_bank", values: ["own", "leased", "third_party_logistics", "multiple", "no_inventory"], description: "Current inventory model." }),
  field({ key: "fa.operation.warehousing.local_expected", dataType: "single_select", source: "question_bank", values: YES_PROBABLY_NO_NOT_SURE, description: "Local inventory/warehousing expected." }),
  field({ key: "fa.operation.warehousing.scale", dataType: "quantity", source: "question_bank", values: ["pallet_positions", "square_meters", "orders_per_month"], description: "Optional rough warehousing scale (amount + unit, or not sure)." }),
  field({ key: "fa.operation.freight.frequency", dataType: "single_select", source: "question_bank", values: ["daily", "several_weekly", "weekly", "several_monthly", "occasionally"], description: "Freight frequency." }),
  field({ key: "fa.operation.freight.type", dataType: "single_select", source: "question_bank", values: ["dry", "refrigerated", "intermodal", "specialized", "other", "not_sure"], description: "Freight type." }),
  field({ key: "fa.operation.last_mile.monthly_deliveries", dataType: "single_select", source: "question_bank", values: ["lt_500", "500_5000", "5001_50000", "50001_plus", "not_sure"], description: "Last-mile monthly deliveries range." }),
  field({ key: "fa.operation.last_mile.local_expected", dataType: "single_select", source: "question_bank", values: YES_PROBABLY_NO_NOT_SURE, description: "Last-mile delivery expected locally." }),
  field({ key: "fa.operation.technology.critical_systems", dataType: "multi_select", source: "question_bank", values: ["erp", "wms", "tms", "crm", "ecommerce", "proprietary", "other"], description: "Critical business systems." }),
  field({ key: "fa.operation.technology.integration_expected", dataType: "single_select", source: "question_bank", values: YES_PROBABLY_NO_NOT_SURE, description: "Implementation/integration/adaptation expected." }),
  field({ key: "fa.operation.workforce.local_hiring_expected", dataType: "single_select", source: "question_bank", values: YES_PROBABLY_NO_NOT_SURE, description: "Local hiring expected." }),
  field({ key: "fa.operation.workforce.first_year_headcount", dataType: "single_select", source: "question_bank", values: ["1_10", "11_50", "51_200", "201_plus", "not_sure"], description: "First-year local headcount range." }),
  field({ key: "fa.operation.facilities.facility_required", dataType: "single_select", source: "question_bank", values: ["office", "warehouse", "manufacturing", "retail", "multiple", "no", "not_sure"], description: "Facility required." }),
  field({ key: "fa.operation.facilities.location_selected", dataType: "single_select", source: "question_bank", values: ["yes", "evaluating", "no"], description: "Facility location selected/committed." }),
  field({ key: "fa.operation.partners.dependency", dataType: "single_select", source: "question_bank", values: YES_PROBABLY_NO_NOT_SURE, description: "Depends on a local partner/distributor/representative/third party." }),
  field({ key: "fa.operation.partners.relationship_status", dataType: "single_select", source: "question_bank", values: RELATIONSHIP_STATUS, description: "Partner relationship status." }),
  field({ key: "fa.operation.partners.relationship_context", dataType: "text", source: "question_bank", openText: true, description: "Optional partner relationship context (verbatim)." }),
  field({ key: "fa.operation.regulated.permits_status", dataType: "single_select", source: "question_bank", values: ["yes", "no", "not_sure"], description: "Permits/certifications/regulatory approvals today." }),
  field({ key: "fa.operation.regulated.permits_which", dataType: "text", source: "question_bank", openText: true, description: "Which permits/certifications (verbatim)." }),
  field({ key: "fa.operation.expected_capabilities", dataType: "multi_select", source: "question_bank", description: "New-market capability mother question: areas to build, adapt or validate.", values: ["legal_corporate", "tax", "accounting", "banking", "insurance", "contracts", "talent_hr", "payroll", "facilities", "technology", "cyber_data", "logistics", "warehousing", "customs_trade", "suppliers", "manufacturing", "commercial_strategy", "sales_channels", "marketing", "regulatory_compliance", "local_partner_distributor", "risk_due_diligence", "not_sure", "other"], exclusiveValues: ["not_sure"] }),
  field({ key: "fa.operation.banking_status", dataType: "single_select", source: "question_bank", values: RESOLUTION_STATUS, description: "Where the respondent is with local banking." }),
  field({ key: "fa.operation.insurance_status", dataType: "single_select", source: "question_bank", values: RESOLUTION_STATUS, description: "Where the respondent is with insurance for the new operation." }),
  field({ key: "fa.operation.growth_focus", dataType: "multi_select", source: "question_bank", description: "Already-operating growth focus (Rules Matrix v1 §15, ten declared intents).", values: ["grow_sales", "improve_local_operation", "find_replace_suppliers", "find_partners_distributors", "strengthen_compliance", "improve_logistics", "add_capabilities_infrastructure", "reduce_operating_risk", "explore_growth_opportunity", "not_sure"], exclusiveValues: ["not_sure"] }),

  // ---------------------------------------------------------------- Priorities (D1–D4 + stop/go)
  field({ key: "fa.priority.priority_known", dataType: "single_select", source: "question_bank", values: ["yes", "not_yet", "not_sure"], description: "Whether an area already needs to move first (D1)." }),
  field({ key: "fa.priority.client_priority", dataType: "single_select", source: "question_bank", values: RULES_CATEGORY_VALUES, description: "Client-declared immediate priority (D2), never replaced by a derived signal." }),
  field({ key: "fa.priority.timing", dataType: "single_select", source: "question_bank", values: ["already_in_progress", "immediately", "within_30_days", "1_3_months", "3_6_months", "later"], description: "When the priority needs to move (D3)." }),
  field({ key: "fa.priority.reason", dataType: "text", source: "question_bank", openText: true, description: "Why the priority comes first (D4, optional, verbatim)." }),
  field({ key: "fa.project.stop_go_criteria", dataType: "multi_select", source: "question_bank", description: "What could make the respondent decide not to move forward (declared context, never a finding).", values: ["economics", "demand", "regulatory_complexity", "investment_too_high", "partners_suppliers", "timeline", "internal_capacity", "nothing_specific", "other"], exclusiveValues: ["nothing_specific"] }),

  // ---------------------------------------------------------------- Constraints (C1–C6)
  field({ key: "fa.constraints.items", dataType: "multi_select", source: "question_bank", values: [...RULES_CATEGORY_VALUES, "not_sure"], exclusiveValues: ["not_sure"], description: "What could affect the plan (C1, fixed category list)." }),
  field({ key: "fa.constraints.critical", dataType: "single_select", source: "question_bank", values: RULES_CATEGORY_VALUES, description: "Selected item with the biggest potential impact (C2)." }),
  field({ key: "fa.strategic.slowdown_concern", dataType: "text", source: "question_bank", openText: true, description: "Strategic prompt 3: what could slow the project down or make it more expensive (verbatim)." }),
  field({ key: "fa.constraints.existing_commitments", dataType: "text", source: "question_bank", openText: true, description: "Strategic prompt 4 / C3: commitments already made (verbatim)." }),
  field({ key: "fa.constraints.commitment_areas", dataType: "multi_select", source: "question_bank", values: [...RULES_CATEGORY_VALUES, "none"], exclusiveValues: ["none"], description: "Structured companion of existing commitments (category list)." }),
  field({ key: "fa.constraints.has_customer_contract", dataType: "single_select", source: "question_bank", values: ["yes", "no"], description: "A customer contract/commitment already exists." }),
  field({ key: "fa.constraints.non_negotiables", dataType: "text", source: "question_bank", openText: true, description: "Strategic prompt 5 / C4: what must not be compromised (verbatim)." }),
  field({ key: "fa.constraints.non_negotiable_areas", dataType: "multi_select", source: "question_bank", values: [...RULES_CATEGORY_VALUES, "none"], exclusiveValues: ["none"], description: "Structured companion of non-negotiables (category list)." }),
  field({ key: "fa.project.primary_concern", dataType: "text", source: "question_bank", openText: true, description: "What the respondent is most concerned about getting wrong (C5, verbatim)." }),
  field({ key: "fa.project.additional_context", dataType: "text", source: "question_bank", openText: true, description: "Anything else to know (C6, optional, verbatim)." }),

  // ---------------------------------------------------------------- Ownership & preferences
  field({ key: "fa.ownership.project_responsibility", dataType: "single_select", source: "question_bank", values: ["leading", "part_of_team", "someone_else_leading", "being_defined"], description: "Respondent's responsibility for the project (S1)." }),
];

const FIELD_INDEX = new Map(FA_FIELDS.map((definition) => [definition.key, definition]));

export function getFieldDefinition(key: string): CanonicalFieldDefinition | undefined {
  return FIELD_INDEX.get(key);
}

export const FIELD_KEY_PATTERN = /^(fa|precision)\.[a-z0-9_]+(\.[a-z0-9_]+)*$/;
