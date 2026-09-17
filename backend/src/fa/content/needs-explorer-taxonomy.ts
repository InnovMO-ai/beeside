/**
 * Needs Explorer taxonomy — the customer-facing -> canonical mapping layer.
 *
 * Design Specification "beeside First Assessment — Level 2 MVP", section "Needs Explorer"
 * (resolved per owner direction, 2026-09). Two layers:
 *
 *   1. Customer-facing: the UX groups and example capabilities shown to the respondent, worded
 *      however is clearest for a company planning international expansion.
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
 * Material exception (documented, no schema change): the owner's fuller Hive / Strategic Advisory
 * service model implies distinctions the current 10-row seed cannot represent on its own — a
 * separate Inbound vs. Outbound Operations split (the seed has one merged "Freight & logistics"
 * row), a distinct Infrastructure concept (folded into "Facilities & warehousing"), and three
 * separate ideas (Market Entry, Growth, Ecosystem) collapsed into one "Go-to-market strategy" row.
 * Audit and ongoing Business Advisory also have no clean seeded home distinct from one-time entity
 * setup (both map here to "Local entity & legal setup" as an approximate fit). Why: 10 rows were
 * deliberately seeded flat and broad, sized for "up to 6 shown per assessment" (see the seed
 * file's own comment), not modeled on the full Hive catalog. Proposed change: none now — this
 * mapping layer already absorbs the richer language without touching the schema. If category-level
 * filtering/reporting at finer grain is ever needed, a future migration could additively split 2-3
 * of the 10 rows (Freight & logistics; Go-to-market strategy) non-breaking, low-risk — coordinated
 * with Precision's validated radar and SOW by Category's capability landscape, which reference the
 * same category ids.
 */

/** capability_taxonomy_category.category_id, 1-10 (backend/db/seed/0001_config_seed.sql). */
export type CanonicalCategoryId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface NeedsExplorerLeaf {
  /** Stable technical key stored in fa.needs.map selections — never shown to the user. */
  key: string;
  /** English / Spanish label shown to the customer. */
  label: { en: string; es: string };
  canonicalCategoryId: CanonicalCategoryId;
  /** True only for the "Freight and customs" leaves that genuinely span two canonical rows; the
   *  primary id above is used for ranking/reporting, this is kept for the documented exception. */
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
    key: "company_legal",
    label: { en: "Company and legal setup", es: "Constitución de empresa y legal" },
    leaves: [{ key: "company_setup", label: { en: "Company Setup", es: "Constitución de la empresa" }, canonicalCategoryId: 2 }],
  },
  {
    key: "tax_audit_advisory",
    label: { en: "Tax, audit and business advisory", es: "Fiscal, auditoría y asesoría de negocio" },
    leaves: [
      { key: "tax", label: { en: "Tax", es: "Fiscal" }, canonicalCategoryId: 2 },
      { key: "audit", label: { en: "Audit", es: "Auditoría" }, canonicalCategoryId: 2 },
      { key: "business_advisory", label: { en: "Business Advisory", es: "Asesoría de negocio" }, canonicalCategoryId: 2 },
      { key: "transfer_pricing", label: { en: "Transfer Pricing", es: "Precios de transferencia" }, canonicalCategoryId: 2 },
    ],
  },
  {
    key: "permits_certifications",
    label: { en: "Permits and certifications", es: "Permisos y certificaciones" },
    leaves: [{ key: "regulatory_permits", label: { en: "Regulatory approvals and certifications", es: "Aprobaciones y certificaciones regulatorias" }, canonicalCategoryId: 3 }],
  },
  {
    key: "people_payroll",
    label: { en: "People and payroll", es: "Personal y nómina" },
    leaves: [{ key: "hr_payroll_social_security", label: { en: "HR, Payroll and Social Security", es: "RH, nómina y seguridad social" }, canonicalCategoryId: 5 }],
  },
  {
    key: "partners_suppliers",
    label: { en: "Local partners and suppliers", es: "Socios y proveedores locales" },
    leaves: [
      { key: "supplier_search", label: { en: "Supplier Search", es: "Búsqueda de proveedores" }, canonicalCategoryId: 4 },
      { key: "local_partner_search_match", label: { en: "Local Partner Search and Match", es: "Búsqueda y match de socio local" }, canonicalCategoryId: 4 },
      { key: "third_party_qualification", label: { en: "Third-Party Qualification", es: "Calificación de terceros" }, canonicalCategoryId: 4 },
    ],
  },
  {
    key: "facilities_real_estate",
    label: { en: "Facilities and real estate", es: "Instalaciones e inmuebles" },
    leaves: [
      { key: "industrial_warehouse_real_estate", label: { en: "Industrial and Warehouse Real Estate", es: "Bienes raíces industriales y de almacén" }, canonicalCategoryId: 6 },
      { key: "construction", label: { en: "Construction", es: "Construcción" }, canonicalCategoryId: 6 },
    ],
  },
  {
    key: "warehousing_inventory",
    label: { en: "Warehousing and inventory", es: "Almacenamiento e inventario" },
    leaves: [
      { key: "threepl_warehousing_inventory", label: { en: "3PL, Warehousing and Inventory", es: "3PL, almacenamiento e inventario" }, canonicalCategoryId: 6 },
      { key: "warehouse_automation", label: { en: "Warehouse Automation", es: "Automatización de almacén" }, canonicalCategoryId: 6 },
    ],
  },
  {
    key: "freight_customs",
    label: { en: "Freight and customs", es: "Transporte y aduanas" },
    leaves: [
      { key: "foreign_trade_customs", label: { en: "Foreign Trade and Customs", es: "Comercio exterior y aduanas" }, canonicalCategoryId: 1 },
      { key: "freight_mobility", label: { en: "Freight Mobility", es: "Movilidad de carga" }, canonicalCategoryId: 7, alsoRelatedTo: [1] },
      { key: "last_mile", label: { en: "Last Mile", es: "Última milla" }, canonicalCategoryId: 7 },
    ],
  },
  {
    key: "technology_systems",
    label: { en: "Technology and systems", es: "Tecnología y sistemas" },
    leaves: [
      { key: "erp", label: { en: "ERP", es: "ERP" }, canonicalCategoryId: 8 },
      { key: "wms", label: { en: "WMS", es: "WMS" }, canonicalCategoryId: 8 },
      { key: "tms", label: { en: "TMS", es: "TMS" }, canonicalCategoryId: 8 },
      { key: "data_video_surveillance", label: { en: "Data and Video Surveillance", es: "Datos y videovigilancia" }, canonicalCategoryId: 8 },
    ],
  },
  {
    key: "banking_insurance",
    label: { en: "Banking and insurance", es: "Banca y seguros" },
    leaves: [
      { key: "banking", label: { en: "Banking", es: "Banca" }, canonicalCategoryId: 9 },
      { key: "insurance", label: { en: "Insurance", es: "Seguros" }, canonicalCategoryId: 9 },
    ],
  },
  {
    key: "market_entry_growth",
    label: { en: "Market entry and growth", es: "Entrada al mercado y crecimiento" },
    leaves: [
      { key: "country_market_brief", label: { en: "Country and Market Brief", es: "Brief de país y mercado" }, canonicalCategoryId: 10 },
      { key: "feasibility", label: { en: "Feasibility", es: "Factibilidad" }, canonicalCategoryId: 10 },
      { key: "trade_market_access", label: { en: "Trade and Market Access", es: "Comercio y acceso a mercado" }, canonicalCategoryId: 10 },
      { key: "growth_gtm", label: { en: "Growth and GTM", es: "Crecimiento y GTM" }, canonicalCategoryId: 10 },
      { key: "partnership_strategy", label: { en: "Partnership Strategy", es: "Estrategia de alianzas" }, canonicalCategoryId: 10 },
      { key: "business_check", label: { en: "Business Check", es: "Diagnóstico de negocio" }, canonicalCategoryId: 10 },
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
