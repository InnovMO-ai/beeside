/**
 * Client-side mirror of backend/src/fa/content/needs-explorer-taxonomy.ts — same convention already
 * used for types.ts / bundle-types.ts. This is display data only (group/leaf labels, grouping order):
 * the canonical mapping to `capability_taxonomy_category` stays backend-only and is never needed in
 * the browser. If the two drift, the backend is authoritative — it validates `needs_map` answers
 * against its own copy (values.ts) regardless of what the client renders.
 *
 * REPLACED 2026-09-30 — frozen 6 families (A–F) / 36 capabilities (Design Freeze). See the backend
 * file for the full rationale, key-stability notes, and dropped-leaf list.
 */

export interface NeedsExplorerLeaf {
  key: string;
  label: { en: string; es: string };
}

export interface NeedsExplorerGroup {
  key: string;
  label: { en: string; es: string };
  leaves: NeedsExplorerLeaf[];
}

export const NEEDS_EXPLORER_TAXONOMY: readonly NeedsExplorerGroup[] = [
  {
    key: "family_a_validate_market_strategy",
    label: { en: "Validate market & strategy", es: "Validar mercado y estrategia" },
    leaves: [
      { key: "market_validation", label: { en: "Market validation", es: "Validación de mercado" } },
      {
        key: "demand_validation",
        label: { en: "Validate demand for the product or service", es: "Validar la demanda del producto o servicio" },
      },
      { key: "appetite_tracker", label: { en: "Appetite Tracker", es: "Appetite Tracker" } },
      { key: "entry_strategy", label: { en: "Entry strategy", es: "Estrategia de entrada" } },
      { key: "commercial_strategy_channels", label: { en: "Commercial strategy / channels", es: "Estrategia comercial / canales" } },
      { key: "growth", label: { en: "Growth", es: "Crecimiento" } },
      {
        key: "local_partner_search_match",
        label: { en: "Local partner or distributor search", es: "Búsqueda de socio o distribuidor local" },
      },
      {
        key: "location_analysis",
        label: { en: "Location analysis in the destination country", es: "Análisis de ubicación en el país destino" },
      },
    ],
  },
  {
    key: "family_b_establish_local_structure",
    label: { en: "Establish local structure", es: "Establecer la estructura local" },
    leaves: [
      { key: "company_setup", label: { en: "Company setup / legal structure", es: "Constitución de empresa / estructura legal" } },
      { key: "tax_accounting", label: { en: "Tax & accounting", es: "Fiscal y contabilidad" } },
      { key: "banking", label: { en: "Banking", es: "Banca" } },
      { key: "insurance", label: { en: "Insurance", es: "Seguros" } },
      { key: "regulatory_permits", label: { en: "Regulatory advisory & compliance", es: "Asesoría regulatoria y cumplimiento" } },
      { key: "intellectual_property", label: { en: "Intellectual property", es: "Propiedad intelectual" } },
    ],
  },
  {
    key: "family_c_prepare_facilities_infrastructure",
    label: { en: "Prepare facilities & infrastructure", es: "Preparar instalaciones e infraestructura" },
    leaves: [
      { key: "industrial_warehouse_real_estate", label: { en: "Site selection / real estate", es: "Selección de sitio / bienes raíces" } },
      { key: "lease_purchase_development", label: { en: "Lease / purchase or development", es: "Arrendamiento / compra o desarrollo" } },
      { key: "construction", label: { en: "Design / fit-out / construction", es: "Diseño / adecuación / construcción" } },
      { key: "infrastructure_utilities", label: { en: "Infrastructure & utilities", es: "Infraestructura y servicios" } },
      { key: "physical_security", label: { en: "Physical security", es: "Seguridad física" } },
    ],
  },
  {
    key: "family_d_build_local_team",
    label: { en: "Build the local team", es: "Construir el equipo local" },
    leaves: [
      { key: "recruitment", label: { en: "Recruitment", es: "Reclutamiento" } },
      { key: "hr_payroll_social_security", label: { en: "Payroll & social security", es: "Nómina y seguridad social" } },
      { key: "mobility_immigration", label: { en: "Mobility / immigration", es: "Movilidad / inmigración" } },
      { key: "labor_advisory", label: { en: "Labor advisory", es: "Asesoría laboral" } },
      { key: "specialized_talent", label: { en: "Specialized talent", es: "Talento especializado" } },
    ],
  },
  {
    key: "family_e_activate_operations_supply_chain",
    label: { en: "Activate operations & supply chain", es: "Activar operación y cadena de suministro" },
    leaves: [
      { key: "supplier_search", label: { en: "Supplier search / development", es: "Búsqueda / desarrollo de proveedores" } },
      { key: "purchasing_sourcing", label: { en: "Purchasing / sourcing", es: "Compras / abastecimiento" } },
      { key: "foreign_trade_customs", label: { en: "Foreign trade & customs", es: "Comercio exterior y aduanas" } },
      { key: "freight_mobility", label: { en: "Transportation", es: "Transporte" } },
      { key: "threepl_warehousing_inventory", label: { en: "Warehousing / 3PL / inventory", es: "Almacenamiento / 3PL / inventario" } },
      { key: "last_mile", label: { en: "Distribution / last mile", es: "Distribución / última milla" } },
    ],
  },
  {
    key: "family_f_technology_digital_operations",
    label: { en: "Technology & digital operations", es: "Tecnología y operaciones digitales" },
    leaves: [
      { key: "erp", label: { en: "Enterprise Resource Planning (ERP)", es: "Planeación de Recursos Empresariales (ERP)" } },
      { key: "wms", label: { en: "Warehouse Management System (WMS)", es: "Sistema de Gestión de Almacenes (WMS)" } },
      { key: "tms", label: { en: "Transportation Management System (TMS)", es: "Sistema de Gestión de Transporte (TMS)" } },
      { key: "integrations", label: { en: "Integrations", es: "Integraciones" } },
      { key: "data_video_surveillance", label: { en: "Data & connectivity", es: "Datos y conectividad" } },
      { key: "cybersecurity", label: { en: "Cybersecurity", es: "Ciberseguridad" } },
    ],
  },
];

const LEAF_INDEX = new Map<string, NeedsExplorerLeaf>(NEEDS_EXPLORER_TAXONOMY.flatMap((group) => group.leaves.map((leaf) => [leaf.key, leaf])));

export function needsLeafLabel(key: string, locale: "en" | "es"): string {
  return LEAF_INDEX.get(key)?.label[locale] ?? key;
}
