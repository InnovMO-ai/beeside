/**
 * Client-side mirror of backend/src/fa/content/needs-explorer-taxonomy.ts — same convention already
 * used for types.ts / bundle-types.ts. This is display data only (group/leaf labels, grouping order):
 * the canonical mapping to `capability_taxonomy_category` stays backend-only and is never needed in
 * the browser. If the two drift, the backend is authoritative — it validates `needs_map` answers
 * against its own copy (values.ts) regardless of what the client renders.
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
    key: "company_legal",
    label: { en: "Company and legal setup", es: "Constitución de empresa y legal" },
    leaves: [{ key: "company_setup", label: { en: "Company Setup", es: "Constitución de la empresa" } }],
  },
  {
    key: "tax_audit_advisory",
    label: { en: "Tax, audit and business advisory", es: "Fiscal, auditoría y asesoría de negocio" },
    leaves: [
      { key: "tax", label: { en: "Tax", es: "Fiscal" } },
      { key: "audit", label: { en: "Audit", es: "Auditoría" } },
      { key: "business_advisory", label: { en: "Business Advisory", es: "Asesoría de negocio" } },
      { key: "transfer_pricing", label: { en: "Transfer Pricing", es: "Precios de transferencia" } },
    ],
  },
  {
    key: "permits_certifications",
    label: { en: "Permits and certifications", es: "Permisos y certificaciones" },
    leaves: [{ key: "regulatory_permits", label: { en: "Regulatory approvals and certifications", es: "Aprobaciones y certificaciones regulatorias" } }],
  },
  {
    key: "people_payroll",
    label: { en: "People and payroll", es: "Personal y nómina" },
    leaves: [{ key: "hr_payroll_social_security", label: { en: "HR, Payroll and Social Security", es: "RH, nómina y seguridad social" } }],
  },
  {
    key: "partners_suppliers",
    label: { en: "Local partners and suppliers", es: "Socios y proveedores locales" },
    leaves: [
      { key: "supplier_search", label: { en: "Supplier Search", es: "Búsqueda de proveedores" } },
      { key: "local_partner_search_match", label: { en: "Local Partner Search and Match", es: "Búsqueda y match de socio local" } },
      { key: "third_party_qualification", label: { en: "Third-Party Qualification", es: "Calificación de terceros" } },
    ],
  },
  {
    key: "facilities_real_estate",
    label: { en: "Facilities and real estate", es: "Instalaciones e inmuebles" },
    leaves: [
      { key: "industrial_warehouse_real_estate", label: { en: "Industrial and Warehouse Real Estate", es: "Bienes raíces industriales y de almacén" } },
      { key: "construction", label: { en: "Construction", es: "Construcción" } },
    ],
  },
  {
    key: "warehousing_inventory",
    label: { en: "Warehousing and inventory", es: "Almacenamiento e inventario" },
    leaves: [
      { key: "threepl_warehousing_inventory", label: { en: "3PL, Warehousing and Inventory", es: "3PL, almacenamiento e inventario" } },
      { key: "warehouse_automation", label: { en: "Warehouse Automation", es: "Automatización de almacén" } },
    ],
  },
  {
    key: "freight_customs",
    label: { en: "Freight and customs", es: "Transporte y aduanas" },
    leaves: [
      { key: "foreign_trade_customs", label: { en: "Foreign Trade and Customs", es: "Comercio exterior y aduanas" } },
      { key: "freight_mobility", label: { en: "Freight Mobility", es: "Movilidad de carga" } },
      { key: "last_mile", label: { en: "Last Mile", es: "Última milla" } },
    ],
  },
  {
    key: "technology_systems",
    label: { en: "Technology and systems", es: "Tecnología y sistemas" },
    leaves: [
      { key: "erp", label: { en: "ERP", es: "ERP" } },
      { key: "wms", label: { en: "WMS", es: "WMS" } },
      { key: "tms", label: { en: "TMS", es: "TMS" } },
      { key: "data_video_surveillance", label: { en: "Data and Video Surveillance", es: "Datos y videovigilancia" } },
    ],
  },
  {
    key: "banking_insurance",
    label: { en: "Banking and insurance", es: "Banca y seguros" },
    leaves: [
      { key: "banking", label: { en: "Banking", es: "Banca" } },
      { key: "insurance", label: { en: "Insurance", es: "Seguros" } },
    ],
  },
  {
    key: "market_entry_growth",
    label: { en: "Market entry and growth", es: "Entrada al mercado y crecimiento" },
    leaves: [
      { key: "country_market_brief", label: { en: "Country and Market Brief", es: "Brief de país y mercado" } },
      { key: "feasibility", label: { en: "Feasibility", es: "Factibilidad" } },
      { key: "trade_market_access", label: { en: "Trade and Market Access", es: "Comercio y acceso a mercado" } },
      { key: "growth_gtm", label: { en: "Growth and GTM", es: "Crecimiento y GTM" } },
      { key: "partnership_strategy", label: { en: "Partnership Strategy", es: "Estrategia de alianzas" } },
      { key: "business_check", label: { en: "Business Check", es: "Diagnóstico de negocio" } },
    ],
  },
];

const LEAF_INDEX = new Map<string, NeedsExplorerLeaf>(NEEDS_EXPLORER_TAXONOMY.flatMap((group) => group.leaves.map((leaf) => [leaf.key, leaf])));

export function needsLeafLabel(key: string, locale: "en" | "es"): string {
  return LEAF_INDEX.get(key)?.label[locale] ?? key;
}
