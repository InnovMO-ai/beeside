/**
 * Synthetic demo data: "Northwind Foods Ltd" (fictional), a packaged-food exporter that wants to sell in Mexico.
 *
 * This is DATA ONLY. It feeds (a) the fixture First Assessment context reader, (b) the fixture entitlement provider and
 * (c) the optional fast-forward stages of the seed. Every value is a statement the fictional client makes about its own
 * business; nothing here asserts a legal, regulatory or customs fact about any country (R10). Product code never
 * branches on any of it.
 */
import type { FaClientSafeContext } from "../../ports/fa-context";

export const DEMO_COMPANY_NAME = "Northwind Foods Ltd";
/** Marker used to find the demo company again (the `.example` TLD is reserved: it never resolves). */
export const DEMO_COMPANY_WEBSITE = "https://northwind-foods.example";
export const DEMO_PERSON_EMAIL = "demo-client@northwind-foods.example";
export const DEMO_DESTINATION = "MX";
/** Fixed synthetic First Assessment result id (the context pin needs a uuid). */
export const DEMO_FA_RESULT_ID = "6e0a11de-0000-4000-8000-00000000d3a0";

export const DEMO_FA_CONTEXT: FaClientSafeContext = {
  project: {
    destinationCountry: DEMO_DESTINATION,
    destinationMarket: "Mexico",
    sector: "Packaged food products",
    expansionObjective: "Start selling our packaged food products in Mexico through local distributors",
    timeframe: "Within the next nine months",
  },
  company: { displayName: DEMO_COMPANY_NAME, sizeBand: "11-50", operatingCountries: ["CL"] },
  needs: [
    { capabilityId: "CAP_HIVE_IL_3PL", label: "Third-party logistics for shipments to Mexico", priority: "high" },
    { capabilityId: "CAP_HIVE_OL_FREIGHT", label: "International freight", priority: "high" },
    { capabilityId: "CAP_HIVE_IL_TRADE_CUSTOMS", label: "Support with import and customs procedures", priority: "high" },
    { capabilityId: "CAP_HIVE_FI_COMPANY_SETUP", label: "Set up a local company", priority: "medium" },
    { capabilityId: "CAP_SA_ME_FEASIBILITY", label: "Review whether the plan makes commercial sense", priority: "medium" },
  ],
  literals: {
    motive: "We have steady demand from importers and want a local presence.",
    context: "Our products are dry packaged goods with a long shelf life.",
  },
  locale: "en",
};

/** Premium entitlement for the demo project, served by the fixture provider. */
export const DEMO_ENTITLEMENT = { premiumActive: true, accessMode: "FULL" as const };

// ---------------------------------------------------------------------------------------------- Understanding answers
export const DEMO_UNDERSTANDING_FACTS: ReadonlyArray<{ fieldKey: string; value: unknown; valueType: string }> = [
  { fieldKey: "pa_project_objective", value: "Start selling our packaged food products in Mexico through local distributors", valueType: "text" },
  { fieldKey: "pa_destination_countries", value: ["MX"], valueType: "country_list" },
  { fieldKey: "pa_expansion_product_or_service", value: "Dry packaged food products with a long shelf life", valueType: "text" },
  { fieldKey: "pa_operating_entity", value: "A local company that Northwind Foods Ltd plans to set up", valueType: "text" },
  { fieldKey: "pa_time_window", value: "2027-04", valueType: "date" },
];

/** Needs shown in My Service Map, per category (the client's own words and priorities). */
export const DEMO_MAP_CATEGORIES: ReadonlyArray<{ categoryKey: string; needs: Array<{ id: string; label: string; priority: "high" | "medium" | "low"; why: string }> }> = [
  {
    categoryKey: "logistics",
    needs: [
      { id: "need-3pl", label: "Third-party logistics for shipments to Mexico", priority: "high", why: "Shipments need a partner who handles storage and delivery." },
      { id: "need-freight", label: "International freight", priority: "high", why: "Goods travel from our plant to the destination." },
    ],
  },
  { categoryKey: "international_trade_customs", needs: [{ id: "need-customs", label: "Support with import and customs procedures", priority: "high", why: "Every shipment crosses a border." }] },
  { categoryKey: "corporate_legal_admin", needs: [{ id: "need-setup", label: "Set up a local company", priority: "medium", why: "We want a local entity to sell from." }] },
  { categoryKey: "strategic_advisory", needs: [{ id: "need-review", label: "Review whether the plan makes commercial sense", priority: "medium", why: "We want an outside view before committing." }] },
];

// ---------------------------------------------------------------------------------------------- Logistics answers
type Fact = { fieldKey: string; value: unknown; valueType: string; answerState: "ANSWERED" | "UNKNOWN" | "EXPLICIT_NO" };

/** Logistics answers that make the category ready for review with ONE item left pending ("not sure yet": licensing status). */
export const DEMO_LOGISTICS_FACTS: readonly Fact[] = [
  { fieldKey: "logistics_services_in_scope", value: ["3pl", "freight_transportation"], valueType: "multi_enum", answerState: "ANSWERED" },
  { fieldKey: "logistics_operating_responsibility", value: "third_party_logistics", valueType: "enum", answerState: "ANSWERED" },
  { fieldKey: "logistics_primary_product_type", value: "general_cargo", valueType: "enum", answerState: "ANSWERED" },
  {
    fieldKey: "logistics_flows",
    value: [
      {
        origin_country: "CL",
        destination_country: "MX",
        origin: "Our plant",
        destination: "A distributor warehouse",
        product: "Packaged dry food products",
        volume: { value: 20, unit: "pallets" },
        frequency: "monthly",
        mode_of_transport: "ocean",
      },
    ],
    valueType: "repeatable_group",
    answerState: "ANSWERED",
  },
  { fieldKey: "logistics_warehousing_needed", value: false, valueType: "boolean", answerState: "ANSWERED" },
  { fieldKey: "logistics_hazardous_materials_flag", value: false, valueType: "boolean", answerState: "ANSWERED" },
  { fieldKey: "logistics_import_export_license_status", value: null, valueType: "enum", answerState: "UNKNOWN" },
  { fieldKey: "logistics_insurance_coverage_status", value: "exploring", valueType: "enum", answerState: "ANSWERED" },
];

/** Strategic Advisory answers (the client's own wording) that make that category ready for review. */
export const DEMO_STRATEGIC_FACTS: readonly Fact[] = [
  { fieldKey: "sa_capabilities", value: ["CAP_SA_ME_FEASIBILITY"], valueType: "multi_enum", answerState: "ANSWERED" },
  {
    fieldKey: "sa_studies",
    value: [
      {
        objective: "Decide whether to commit to a local presence",
        question: "Does the plan make commercial sense at our expected volumes?",
        subject_type: ["market"],
        subject_detail: "Retail and food-service distribution for packaged dry goods",
        markets: ["MX"],
        expected_result: "A clear recommendation we can take to our board",
        decisions: "Whether to set up a local company this year",
      },
    ],
    valueType: "repeatable_group",
    answerState: "ANSWERED",
  },
];

export type DemoFact = Fact;
