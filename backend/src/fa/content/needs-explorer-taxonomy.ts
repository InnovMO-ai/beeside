/**
 * Needs Explorer taxonomy — the customer-facing -> canonical mapping layer.
 *
 * REPLACED 2026-09-30 per Product Owner Design Freeze (PRE-SNAPSHOT scope item 6): the old
 * 11-category / ~30-leaf taxonomy is superseded by the frozen 6 families (A–F) / 36 capabilities
 * defined in the approved design ("11-servicios-capacidades" board). This is a full content
 * replacement of the customer-facing layer only — the canonical layer (below) is unchanged and
 * unchangeable.
 *
 * Two layers:
 *
 *   1. Customer-facing: the 6 frozen families (A–F) and their 36 capabilities, worded exactly as
 *      approved in the Design Freeze.
 *   2. Canonical: the real, already-seeded `capability_taxonomy_category` table (10 rows, applied
 *      2026-09-14 in beeside-dev-canonical-db) — unchanged, never edited to make the UI easier.
 *
 * Every selectable leaf below maps explicitly to exactly one canonical category_id. A customer
 * never needs to know this mapping exists. This file is the ONE place that mapping lives — no
 * component may hardcode a category name or id; every component reads through
 * `NEEDS_EXPLORER_TAXONOMY` / `resolveCanonicalCategory()`.
 *
 * Governing principle (explicit in both design and code): the Needs Explorer answers "what do I
 * need to have resolved to move forward" — never "which beeside service do I want to buy".
 * Selecting a capability is not a purchase signal; the five-state status
 * (`NeedsMapStatus`, values.ts) is the only thing that carries coverage/opportunity meaning, and
 * it is captured as a fact fully independent of which leaf was selected.
 *
 * KEY STABILITY: leaf `key` values are stable identifiers persisted in `fa.needs.map` selections
 * and referenced by conditional follow-up gates (questions-needs-followups.ts) and by the v1
 * rules-engine compatibility shim (legacy-capability-adapter.ts). Every leaf whose underlying
 * concept survives from the pre-freeze taxonomy KEEPS its original key even where its label text
 * changed to match the frozen family wording (e.g. `freight_mobility` is now labeled
 * "Transportation"; `data_video_surveillance` is now labeled "Data & connectivity" — video
 * surveillance narrowed out, cybersecurity split into its own new leaf below). Only genuinely new
 * capabilities introduced by the Design Freeze get new keys.
 *
 * DROPPED (no equivalent in the frozen 36; safe — confirmed via repo-wide search that no
 * `applies_when` gate references them, only test fixtures using arbitrary key strings, which are
 * unaffected since they never round-trip through `isKnownNeedsLeaf`): audit, business_advisory,
 * transfer_pricing, third_party_qualification, warehouse_automation, country_market_brief,
 * feasibility, trade_market_access, growth_gtm, partnership_strategy, business_check.
 *
 * Material exception (documented, no schema change — carried over from the prior version of this
 * file): the owner's fuller Hive / Strategic Advisory service model implies distinctions the
 * current 10-row seed cannot represent on its own — a separate Inbound vs. Outbound Operations
 * split (the seed has one merged "Freight & logistics" row), a distinct Infrastructure concept
 * (folded into "Facilities & warehousing"), and several go-to-market ideas (market validation,
 * entry strategy, growth, location analysis, etc.) collapsed into one "Go-to-market strategy" row.
 * Legal/IP/tax concepts also share "Local entity & legal setup" as an approximate fit. Why: 10 rows
 * were deliberately seeded flat and broad (see the seed file's own comment), not modeled on the
 * full Hive catalog or the frozen 36-capability UI. Proposed change: none now — this mapping layer
 * already absorbs the richer language without touching the schema.
 */

/** capability_taxonomy_category.category_id, 1-10 (backend/db/seed/0001_config_seed.sql). */
export type CanonicalCategoryId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface NeedsExplorerLeaf {
  /** Stable technical key stored in fa.needs.map selections — never shown to the user. */
  key: string;
  /** English / Spanish label shown to the customer. */
  label: { en: string; es: string };
  canonicalCategoryId: CanonicalCategoryId;
  /** True only for leaves that genuinely span two canonical rows; the primary id above is used for
   *  ranking/reporting, this is kept for the documented exception. */
  alsoRelatedTo?: CanonicalCategoryId[];
}

export interface NeedsExplorerGroup {
  /** UX group key (stable; used only for rendering order, never persisted on its own). */
  key: string;
  label: { en: string; es: string };
  leaves: NeedsExplorerLeaf[];
}

export const NEEDS_EXPLORER_TAXONOMY: readonly NeedsExplorerGroup[] = [
  {
    key: "family_a_validate_market_strategy",
    label: { en: "Validate market & strategy", es: "Validar mercado y estrategia" },
    leaves: [
      { key: "market_validation", label: { en: "Market validation", es: "Validación de mercado" }, canonicalCategoryId: 10 },
      {
        key: "demand_validation",
        label: { en: "Validate demand for the product or service", es: "Validar la demanda del producto o servicio" },
        canonicalCategoryId: 10,
      },
      { key: "appetite_tracker", label: { en: "Appetite Tracker", es: "Appetite Tracker" }, canonicalCategoryId: 10 },
      { key: "entry_strategy", label: { en: "Entry strategy", es: "Estrategia de entrada" }, canonicalCategoryId: 10 },
      {
        key: "commercial_strategy_channels",
        label: { en: "Commercial strategy / channels", es: "Estrategia comercial / canales" },
        canonicalCategoryId: 10,
      },
      { key: "growth", label: { en: "Growth", es: "Crecimiento" }, canonicalCategoryId: 10 },
      {
        key: "local_partner_search_match",
        label: { en: "Local partner or distributor search", es: "Búsqueda de socio o distribuidor local" },
        canonicalCategoryId: 10,
      },
      {
        key: "location_analysis",
        label: { en: "Location analysis in the destination country", es: "Análisis de ubicación en el país destino" },
        canonicalCategoryId: 10,
      },
    ],
  },
  {
    key: "family_b_establish_local_structure",
    label: { en: "Establish local structure", es: "Establecer la estructura local" },
    leaves: [
      {
        key: "company_setup",
        label: { en: "Company setup / legal structure", es: "Constitución de empresa / estructura legal" },
        canonicalCategoryId: 2,
      },
      { key: "tax_accounting", label: { en: "Tax & accounting", es: "Fiscal y contabilidad" }, canonicalCategoryId: 2 },
      { key: "banking", label: { en: "Banking", es: "Banca" }, canonicalCategoryId: 9 },
      { key: "insurance", label: { en: "Insurance", es: "Seguros" }, canonicalCategoryId: 9 },
      {
        key: "regulatory_permits",
        label: { en: "Regulatory advisory & compliance", es: "Asesoría regulatoria y cumplimiento" },
        canonicalCategoryId: 3,
      },
      { key: "intellectual_property", label: { en: "Intellectual property", es: "Propiedad intelectual" }, canonicalCategoryId: 2 },
    ],
  },
  {
    key: "family_c_prepare_facilities_infrastructure",
    label: { en: "Prepare facilities & infrastructure", es: "Preparar instalaciones e infraestructura" },
    leaves: [
      {
        key: "industrial_warehouse_real_estate",
        label: { en: "Site selection / real estate", es: "Selección de sitio / bienes raíces" },
        canonicalCategoryId: 6,
      },
      {
        key: "lease_purchase_development",
        label: { en: "Lease / purchase or development", es: "Arrendamiento / compra o desarrollo" },
        canonicalCategoryId: 6,
      },
      {
        key: "construction",
        label: { en: "Design / fit-out / construction", es: "Diseño / adecuación / construcción" },
        canonicalCategoryId: 6,
      },
      {
        key: "infrastructure_utilities",
        label: { en: "Infrastructure & utilities", es: "Infraestructura y servicios" },
        canonicalCategoryId: 6,
      },
      { key: "physical_security", label: { en: "Physical security", es: "Seguridad física" }, canonicalCategoryId: 6 },
    ],
  },
  {
    key: "family_d_build_local_team",
    label: { en: "Build the local team", es: "Construir el equipo local" },
    leaves: [
      { key: "recruitment", label: { en: "Recruitment", es: "Reclutamiento" }, canonicalCategoryId: 5 },
      {
        key: "hr_payroll_social_security",
        label: { en: "Payroll & social security", es: "Nómina y seguridad social" },
        canonicalCategoryId: 5,
      },
      { key: "mobility_immigration", label: { en: "Mobility / immigration", es: "Movilidad / inmigración" }, canonicalCategoryId: 5 },
      { key: "labor_advisory", label: { en: "Labor advisory", es: "Asesoría laboral" }, canonicalCategoryId: 5 },
      { key: "specialized_talent", label: { en: "Specialized talent", es: "Talento especializado" }, canonicalCategoryId: 5 },
    ],
  },
  {
    key: "family_e_activate_operations_supply_chain",
    label: { en: "Activate operations & supply chain", es: "Activar operación y cadena de suministro" },
    leaves: [
      {
        key: "supplier_search",
        label: { en: "Supplier search / development", es: "Búsqueda / desarrollo de proveedores" },
        canonicalCategoryId: 4,
      },
      { key: "purchasing_sourcing", label: { en: "Purchasing / sourcing", es: "Compras / abastecimiento" }, canonicalCategoryId: 4 },
      {
        key: "foreign_trade_customs",
        label: { en: "Foreign trade & customs", es: "Comercio exterior y aduanas" },
        canonicalCategoryId: 1,
      },
      { key: "freight_mobility", label: { en: "Transportation", es: "Transporte" }, canonicalCategoryId: 7, alsoRelatedTo: [1] },
      {
        key: "threepl_warehousing_inventory",
        label: { en: "Warehousing / 3PL / inventory", es: "Almacenamiento / 3PL / inventario" },
        canonicalCategoryId: 6,
      },
      { key: "last_mile", label: { en: "Distribution / last mile", es: "Distribución / última milla" }, canonicalCategoryId: 7 },
    ],
  },
  {
    key: "family_f_technology_digital_operations",
    label: { en: "Technology & digital operations", es: "Tecnología y operaciones digitales" },
    leaves: [
      { key: "erp", label: { en: "Enterprise Resource Planning (ERP)", es: "Planeación de Recursos Empresariales (ERP)" }, canonicalCategoryId: 8 },
      { key: "wms", label: { en: "Warehouse Management System (WMS)", es: "Sistema de Gestión de Almacenes (WMS)" }, canonicalCategoryId: 8 },
      {
        key: "tms",
        label: { en: "Transportation Management System (TMS)", es: "Sistema de Gestión de Transporte (TMS)" },
        canonicalCategoryId: 8,
      },
      { key: "integrations", label: { en: "Integrations", es: "Integraciones" }, canonicalCategoryId: 8 },
      {
        key: "data_video_surveillance",
        label: { en: "Data & connectivity", es: "Datos y conectividad" },
        canonicalCategoryId: 8,
      },
      { key: "cybersecurity", label: { en: "Cybersecurity", es: "Ciberseguridad" }, canonicalCategoryId: 8 },
    ],
  },
];

const LEAF_INDEX = new Map<string, NeedsExplorerLeaf>(NEEDS_EXPLORER_TAXONOMY.flatMap((group) => group.leaves.map((leaf) => [leaf.key, leaf])));

export const NEEDS_EXPLORER_LEAF_KEYS: readonly string[] = [...LEAF_INDEX.keys()];

/** No partner or provider names are ever exposed at this or any downstream stage, per the brief. */
export function isKnownNeedsLeaf(key: string): boolean {
  return LEAF_INDEX.has(key);
}

export function resolveCanonicalCategory(key: string): CanonicalCategoryId | undefined {
  return LEAF_INDEX.get(key)?.canonicalCategoryId;
}

export function needsLeafLabel(key: string, locale: "en" | "es"): string | undefined {
  const leaf = LEAF_INDEX.get(key);
  return leaf ? leaf.label[locale] ?? leaf.label.en : undefined;
}
