import type {
  Activity, BusinessCheckStatus, Capability, CapabilityKind, CapabilityStatus, Catalog, CountryCoverage,
  CoverageBasis, CoverageValue, FrontKey, Match, ProviderStatus, Service, ServiceCategory,
} from '../domain/types';
import { FRONTS } from './fronts';

/**
 * Seed of the PUBLISHED catalog — CAPABILITY_REGISTRY_FOR_DESIGN.md v4 (2026-10-04).
 * Runtime code never hardcodes customer states: every state is resolved from these records.
 * `internalRef` is INTERNAL and must never reach a customer-facing model.
 */
export const CATALOG_VERSION = '2026-10-04.v4';
const SINCE = '2026-10-04';
const T = (s: string) => (s ? s.split('|').map((x) => x.trim()) : []);

interface CapDef {
  id: string; svc: string; kind: CapabilityKind; es: string; en: string;
  fronts: Array<[FrontKey, Match]>; termsEs?: string; termsEn?: string; rule?: Activity[];
  status: CapabilityStatus; basis: CoverageBasis; cov: Array<[string, CoverageValue['state']]>;
  provider?: ProviderStatus; bc?: BusinessCheckStatus; limEs?: string; limEn?: string;
  policy?: string; ref?: string; dependsOn?: 'own_entity'; footnote?: boolean;
}
const cap = (d: CapDef): Capability => ({
  capabilityId: d.id, serviceId: d.svc, kind: d.kind, nameEs: d.es, nameEn: d.en,
  fronts: d.fronts.map(([front, match]) => ({ front, match })),
  triggerTermsEs: T(d.termsEs ?? ''), triggerTermsEn: T(d.termsEn ?? ''),
  ...(d.rule ? { triggerRule: { activitiesAny: d.rule } } : {}),
  capabilityStatus: d.status, coverageBasis: d.basis,
  coverage: d.cov.map(([value, state]) => ({ value, state, validFrom: SINCE })),
  providerStatus: d.provider ?? 'NONE', businessCheckStatus: d.bc ?? 'NOT_RECORDED',
  ...(d.limEs ? { scopeLimitEs: d.limEs } : {}), ...(d.limEn ? { scopeLimitEn: d.limEn } : {}),
  ...(d.policy ? { sourcingPolicy: d.policy } : {}), ...(d.ref ? { internalRef: d.ref } : {}),
  ...(d.dependsOn ? { dependsOn: d.dependsOn } : {}), ...(d.footnote ? { footnote: true } : {}),
  validFrom: SINCE, updatedAt: SINCE, publicationStatus: 'PUBLISHED',
});

const MX: Array<[string, 'CONFIRMED']> = [['MX', 'CONFIRMED']];
const VIA: Array<[string, 'VIA_SOURCING']> = [['MX', 'VIA_SOURCING']];
const GT = 'Grant Thornton México / Baker Tilly España';

// ---- Strategic Advisory (REVIEW, delivered by beeside). Trigger terms derived from official names (see docs/CATALOG_DATA_GAPS.md).
const sa = (id: string, svc: string, es: string, en: string, fronts: Array<[FrontKey, Match]>, termsEs: string, termsEn: string, limEs?: string, limEn?: string) =>
  cap({ id, svc, kind: 'STRATEGIC_ADVISORY', es, en, fronts, termsEs, termsEn, status: 'REVIEW', basis: 'DESTINATION_COUNTRY', cov: MX, provider: 'BESIDE', bc: 'N/A', limEs, limEn, ref: 'beeside' });

const hiveSupport = (id: string, svc: string, es: string, en: string, fronts: Array<[FrontKey, Match]>, status: CapabilityStatus, extra: Partial<CapDef> = {}) =>
  cap({ id, svc, kind: 'HIVE', es, en, fronts, status, basis: 'DESTINATION_COUNTRY',
    cov: status === 'ACTIVE' ? MX : status === 'SOURCEABLE' ? VIA : [],
    provider: status === 'ACTIVE' ? 'AFFILIATED' : 'NONE',
    bc: status === 'SOURCEABLE' || status === 'REVIEW' ? 'REQUIRED' : 'NOT_RECORDED', ...extra });

export const CAPABILITIES: Capability[] = [
  // Strategic Advisory
  sa('CAP_SA_ME_COUNTRY_BRIEF', 'SVC_SA_COUNTRY_BRIEF', 'Panorama del país y del mercado', 'Country & market brief', [['FR_GTM', 'SPECIFIC']], 'panorama del país|brief de mercado|estudio de mercado', 'country brief|market brief|market study'),
  sa('CAP_SA_ME_FEASIBILITY', 'SVC_SA_FEASIBILITY', 'Viabilidad del proyecto', 'Feasibility report', [['FR_GTM', 'SPECIFIC']], 'viabilidad|factibilidad', 'feasibility'),
  sa('CAP_SA_ME_APPETITE', 'SVC_SA_APPETITE', 'Encaje de la oportunidad con tu empresa', 'Opportunity fit', [['FR_GTM', 'SPECIFIC']], 'appetite tracker|encaje de la oportunidad', 'appetite tracker|opportunity fit'),
  sa('CAP_SA_ME_MARKET_ACCESS', 'SVC_SA_MARKET_ACCESS', 'Estrategia de acceso al mercado', 'Market access strategy', [['FR_TRADE', 'SPECIFIC'], ['FR_LOGISTICS', 'SPECIFIC'], ['FR_GTM', 'SPECIFIC']], 'acceso al mercado|reglas de origen|aranceles', 'market access|rules of origin|tariff strategy'),
  sa('CAP_SA_RC_BUSINESS_CHECK', 'SVC_SA_BUSINESS_CHECK', 'Verificación de una empresa', 'Business check', [['FR_INVEST_RC', 'DEFAULT'], ['FR_LOCAL_PARTNERS', 'SPECIFIC'], ['FR_SUPPLIERS', 'SPECIFIC']], 'verificación de empresa|business check', 'business check|company verification'),
  sa('CAP_SA_RC_DEEP_DIVE', 'SVC_SA_DEEP_DIVE', 'Evaluación a fondo de una contraparte', 'Deep-dive assessment', [['FR_INVEST_RC', 'DEFAULT'], ['FR_LOCAL_PARTNERS', 'SPECIFIC'], ['FR_SUPPLIERS', 'SPECIFIC']], 'evaluación a fondo|deep dive', 'deep dive|enhanced due diligence'),
  sa('CAP_SA_RC_QUALIFICATION', 'SVC_SA_QUALIFICATION', 'Calificación de proveedores o socios', 'Third-party qualification', [['FR_SUPPLIERS', 'SPECIFIC'], ['FR_LOCAL_PARTNERS', 'SPECIFIC']], 'calificación de proveedores|calificar proveedores', 'third-party qualification|qualify suppliers'),
  sa('CAP_SA_RC_COI', 'SVC_SA_COI', 'Revisión de conflictos de interés', 'Conflict of interest review', [['FR_LOCAL_PARTNERS', 'SPECIFIC'], ['FR_INVEST_RC', 'SPECIFIC']], 'conflicto de interés|conflictos de interés', 'conflict of interest'),
  sa('CAP_SA_GS_PLAYBOOK', 'SVC_SA_PLAYBOOK', 'Estrategia para un reto de crecimiento', 'Growth strategy playbook', [['FR_GTM', 'SPECIFIC']], 'estrategia de crecimiento|playbook', 'growth strategy|playbook'),
  sa('CAP_SA_GS_GTM', 'SVC_SA_GTM', 'Estrategia comercial y de entrada al mercado', 'Commercial & go-to-market strategy', [['FR_GTM', 'DEFAULT'], ['FR_LOCAL_PARTNERS', 'SPECIFIC']], 'estrategia comercial|go-to-market', 'commercial strategy|go-to-market'),
  sa('CAP_SA_GS_PARTNERSHIP', 'SVC_SA_PARTNERSHIP', 'Qué capacidades y alianzas necesitas', 'Partnership & capability strategy', [['FR_LOCAL_PARTNERS', 'SPECIFIC'], ['FR_SUPPLIERS', 'SPECIFIC']], 'estrategia de alianzas|construir comprar o aliarse', 'partnership strategy|build buy partner'),
  sa('CAP_SA_GS_BOARD', 'SVC_SA_BOARD', 'Asesoría estratégica externa periódica', 'Strategic advisory board support', [['FR_GTM', 'SPECIFIC']], 'consejo asesor|asesoría estratégica', 'advisory board|strategic advisory'),
  sa('CAP_SA_ED_SUPPLIER_SEARCH', 'SVC_SA_SUPPLIER_SEARCH', 'Búsqueda y validación de proveedores', 'Supplier search & qualification', [['FR_SUPPLIERS', 'DEFAULT']], '', '', 'Parte de un requerimiento definido por ti', 'Starts from a requirement you define'),
  sa('CAP_SA_ED_PARTNER_MATCH', 'SVC_SA_PARTNER_MATCH', 'Búsqueda de socios locales', 'Local partner search & match', [['FR_LOCAL_PARTNERS', 'DEFAULT']], '', '', 'Termina en una conexión calificada; sin garantía de cierre', 'Ends in a qualified connection; no guarantee of closing'),

  // The Hive — Firm infrastructure / legal
  hiveSupport('CAP_HIVE_FI_COMPANY_SETUP', 'SVC_CORPORATE_SETUP_TAX', 'Constitución y estructura de la empresa', 'Company setup', [['FR_LEGAL_TAX', 'DEFAULT']], 'ACTIVE', { ref: GT, provider: 'AFFILIATED', dependsOn: 'own_entity' }),
  hiveSupport('CAP_HIVE_FI_TAX', 'SVC_CORPORATE_SETUP_TAX', 'Impuestos', 'Tax services', [['FR_LEGAL_TAX', 'DEFAULT']], 'ACTIVE', { ref: GT }),
  hiveSupport('CAP_HIVE_FI_AUDIT', 'SVC_CORPORATE_SETUP_TAX', 'Auditoría', 'Audit', [['FR_LEGAL_TAX', 'SPECIFIC']], 'ACTIVE', { termsEs: 'auditoría|dictamen|control interno', termsEn: 'audit', ref: GT }),
  hiveSupport('CAP_HIVE_FI_BUSINESS_ADVISORY', 'SVC_CORPORATE_SETUP_TAX', 'Asesoría corporativa y transaccional', 'Business advisory', [['FR_INVEST_RC', 'SPECIFIC'], ['FR_LEGAL_TAX', 'SPECIFIC']], 'ACTIVE', { termsEs: 'valuación|m&a|reestructura|gobierno corporativo', termsEn: 'valuation|m&a|restructuring', ref: GT }),
  hiveSupport('CAP_HIVE_LEGAL_ADMIN', 'SVC_LEGAL_ADMIN', 'Apoyo legal y administrativo', 'Legal & administrative support', [['FR_LEGAL_TAX', 'SPECIFIC']], 'ACTIVE', { termsEs: 'contratos|apoyo legal|trámites institucionales', termsEn: 'contracts|legal support', ref: 'InnOv' }),
  hiveSupport('CAP_HIVE_PROC_TRANSFER_PRICING', 'SVC_TRANSFER_PRICING', 'Operaciones entre empresas del grupo', 'Transfer pricing & intercompany', [['FR_PARENT_LINK', 'DEFAULT']], 'ACTIVE', { limEs: 'Lado de tu empresa en el país de destino', limEn: 'The side of your company in the destination country', ref: GT }),
  hiveSupport('CAP_HIVE_LEGAL_BRAND', 'SVC_BRAND_PROTECTION', 'Protección de marca', 'Brand protection', [['FR_BRAND', 'DEFAULT']], 'SOURCEABLE', { limEs: 'Sin garantía de registro', limEn: 'No guarantee of registration', policy: 'COM-3 / D-097' }),
  hiveSupport('CAP_HIVE_LEGAL_WIND_DOWN', 'SVC_WIND_DOWN', 'Cierre y desmovilización', 'Wind-down and closure support', [['FR_EXIT', 'DEFAULT']], 'SOURCEABLE', { policy: 'COM-3 / D-097' }),
  hiveSupport('CAP_HIVE_LEGAL_PERMITS', 'SVC_PERMITS', 'Gestión de permisos', 'Permit processing', [['FR_PERMITS', 'DEFAULT']], 'NOT_OFFERED', { bc: 'N/A', limEs: 'Permisos como servicio independiente. Las autorizaciones integrales a otro servicio forman parte de ese servicio (D-099)', limEn: 'Permits as a stand-alone service. Authorizations integral to another service are part of that service (D-099)' }),

  // Document services (basis differs from destination)
  hiveSupport('CAP_HIVE_DOC_TRANSLATION', 'SVC_DOCUMENT_SERVICES', 'Traducción de documentos', 'Document translation', [['FR_LEGAL_TAX', 'SPECIFIC']], 'ACTIVE', { basis: 'LANGUAGE_PAIR', termsEs: 'traducción|traducción oficial|traducción certificada|traducción jurada', termsEn: 'translation|certified translation' }),
  hiveSupport('CAP_HIVE_LEGAL_APOSTILLE', 'SVC_DOCUMENT_SERVICES', 'Apostilla de documentos', 'Document apostille', [['FR_LEGAL_TAX', 'SPECIFIC']], 'ACTIVE', { basis: 'ISSUING_COUNTRY', termsEs: 'apostilla|apostillar', termsEn: 'apostille', limEs: 'Sólo apostilla', limEn: 'Apostille only' }),
  hiveSupport('CAP_HIVE_DOC_CERT_LEGALIZATION', 'SVC_DOCUMENT_SERVICES', 'Certificación y legalización de documentos', 'Document certification and legalization', [['FR_LEGAL_TAX', 'SPECIFIC']], 'ACTIVE', { basis: 'ISSUING_COUNTRY', termsEs: 'certificación de documentos|legalización|copia certificada|notarización', termsEn: 'document certification|legalization|notarization' }),

  // Financial
  hiveSupport('CAP_HIVE_FIN_BANKING', 'SVC_BANKING', 'Banca empresarial', 'Business banking', [['FR_BANKING', 'DEFAULT']], 'ACTIVE', { footnote: true, limEs: 'La apertura de cuentas la decide el banco', limEn: 'Account opening is decided by the bank', ref: 'Santander — Global' }),
  hiveSupport('CAP_HIVE_FIN_INSURANCE', 'SVC_INSURANCE', 'Seguros empresariales', 'Corporate insurance', [['FR_INSURANCE', 'DEFAULT']], 'ACTIVE', { footnote: true, limEs: 'La emisión de pólizas la decide la aseguradora', limEn: 'Policy issuance is decided by the insurer', ref: 'MAPFRE — Global' }),

  // People
  hiveSupport('CAP_HIVE_HR_PAYROLL', 'SVC_PAYROLL', 'Nómina y obligaciones laborales', 'Payroll & labor obligations', [['FR_EMPLOYMENT', 'DEFAULT']], 'ACTIVE', { footnote: true, limEs: 'Para tus propios empleados; no actúa como empleador en tu lugar', limEn: 'For your own employees; it does not act as employer on your behalf', ref: GT }),
  hiveSupport('CAP_HIVE_HR_EOR', 'SVC_EOR', 'Contratación mediante tercero empleador', 'Employer of Record (EOR)', [['FR_EMPLOYMENT', 'SPECIFIC']], 'SOURCEABLE', { termsEs: 'tercero empleador|eor|contratar sin entidad', termsEn: 'employer of record|eor', policy: 'COM-3 / D-097' }),
  hiveSupport('CAP_HIVE_HR_RECRUITMENT', 'SVC_RECRUITMENT', 'Reclutamiento', 'Recruitment', [['FR_RECRUITMENT', 'DEFAULT']], 'SOURCEABLE', { limEs: 'Sin garantía de contratación', limEn: 'No guarantee of hiring', policy: 'COM-3 / D-097' }),
  hiveSupport('CAP_HIVE_HR_EMPLOYEE_TRANSPORT', 'SVC_EMPLOYEE_TRANSPORT', 'Transporte de personal', 'Employee transportation', [['FR_STAFF_HOUSING', 'SPECIFIC']], 'ACTIVE', { termsEs: 'traslados|transporte de personal', termsEn: 'crew transport|staff transport', limEs: 'Sólo traslados', limEn: 'Transfers only', ref: GT }),
  hiveSupport('CAP_HIVE_HR_STAFF_HOUSING', 'SVC_STAFF_HOUSING', 'Alojamiento de personal', 'Staff housing', [['FR_STAFF_HOUSING', 'DEFAULT']], 'SOURCEABLE', { policy: 'COM-3 / D-097' }),
  hiveSupport('CAP_HIVE_HR_MOBILITY', 'SVC_MOBILITY', 'Movilidad de personal y apoyo migratorio', 'Staff mobility and immigration support', [['FR_MOBILE_STAFF', 'DEFAULT']], 'REVIEW', { limEs: 'FA sólo registra que la necesidad existe', limEn: 'FA only records that the need exists' }),

  // Logistics & trade
  hiveSupport('CAP_HIVE_IL_TRADE_CUSTOMS', 'SVC_TRADE_CUSTOMS', 'Comercio exterior y aduanas', 'Foreign trade & customs advisory', [['FR_TRADE', 'DEFAULT'], ['FR_REGULATORY', 'SPECIFIC']], 'ACTIVE', { termsEs: 'regulación no arancelaria de importación', termsEn: 'non-tariff import rules', limEs: 'Sin registros sanitarios ni regulatorio de producto', limEn: 'No health registrations or product-specific regulatory work', ref: GT }),
  hiveSupport('CAP_HIVE_IL_3PL', 'SVC_WAREHOUSING', 'Almacenaje e inventarios', 'Warehousing & inventory (3PL)', [['FR_LOGISTICS', 'DEFAULT']], 'ACTIVE', { ref: 'Traxión México' }),
  hiveSupport('CAP_HIVE_OL_FREIGHT', 'SVC_FREIGHT', 'Transporte de carga', 'Freight transportation', [['FR_LOGISTICS', 'DEFAULT']], 'ACTIVE', { basis: 'ORIGIN_DESTINATION_ROUTE', limEs: 'Producto terminado estándar', limEn: 'Standard finished goods', ref: 'Traxión México' }),
  hiveSupport('CAP_HIVE_OL_OVERSIZED_CARGO', 'SVC_SPECIAL_CARGO', 'Transporte de carga sobredimensionada o especial', 'Oversized and special cargo transportation', [['FR_LOGISTICS', 'SPECIFIC']], 'ACTIVE', {
    basis: 'ORIGIN_DESTINATION_ROUTE',
    termsEs: 'sobredimensionado|sobredimensional|sobrepeso|carga especial|carga de proyecto|transporte especializado',
    termsEn: 'oversized|over-dimensional|heavy haul|project cargo|special cargo',
    limEs: 'Las autorizaciones de ruta forman parte de la propuesta del transportista', limEn: "Route authorizations are part of the carrier's proposal" }),
  hiveSupport('CAP_HIVE_OL_LAST_MILE', 'SVC_LAST_MILE', 'Última milla', 'Last-mile delivery', [['FR_LOGISTICS', 'SPECIFIC'], ['FR_GTM', 'SPECIFIC']], 'ACTIVE', { basis: 'ORIGIN_DESTINATION_ROUTE', termsEs: 'paquetería|ecommerce|última milla', termsEn: 'parcel|last mile', ref: 'Traxión México' }),

  // Technology
  hiveSupport('CAP_HIVE_TECH_WAREHOUSE_AUTOMATION', 'SVC_OPERATIONS_TECH', 'Automatización de almacenes', 'Warehouse automation', [['FR_LOGISTICS', 'SPECIFIC']], 'ACTIVE', { basis: 'SITE_OR_ENTITY_COUNTRY', termsEs: 'automatización|robótica|bandas', termsEn: 'automation|robotics', ref: 'InnOv México' }),
  hiveSupport('CAP_HIVE_TECH_MGMT_SYSTEMS', 'SVC_OPERATIONS_TECH', 'Sistemas de gestión (ERP, WMS, TMS)', 'Management systems', [['FR_LOGISTICS', 'SPECIFIC']], 'ACTIVE', { basis: 'SITE_OR_ENTITY_COUNTRY', termsEs: 'erp|wms|tms', termsEn: 'erp|wms|tms', ref: 'InnOv México' }),
  hiveSupport('CAP_HIVE_TECH_DATA_SURVEILLANCE', 'SVC_OPERATIONS_TECH', 'Redes de datos y videovigilancia', 'Data & video surveillance', [['FR_SITE', 'SPECIFIC']], 'ACTIVE', { basis: 'SITE_OR_ENTITY_COUNTRY', termsEs: 'videovigilancia|cctv|redes de datos', termsEn: 'video surveillance|data network', ref: 'InnOv México' }),

  // Sites
  hiveSupport('CAP_HIVE_INFRA_OFFICE_SPACE', 'SVC_OFFICE_SPACE', 'Oficinas y coworking', 'Office and coworking space', [['FR_SITE', 'DEFAULT']], 'SOURCEABLE', { termsEs: 'oficina|coworking', termsEn: 'office|coworking', policy: 'COM-3 / D-097' }),
  hiveSupport('CAP_HIVE_INFRA_RETAIL_PREMISES', 'SVC_RETAIL_PREMISES', 'Locales comerciales', 'Retail and commercial premises', [['FR_SITE', 'SPECIFIC']], 'SOURCEABLE', { termsEs: 'local comercial|tienda|punto de venta|showroom', termsEn: 'retail premises|store|shop|showroom', policy: 'D-115' }),
  hiveSupport('CAP_HIVE_INFRA_INDUSTRIAL_RE', 'SVC_INDUSTRIAL_RE', 'Naves y espacios industriales', 'Industrial real estate', [['FR_SITE', 'SPECIFIC']], 'ACTIVE', { termsEs: 'planta|nave|bodega|terreno|parque industrial', termsEn: 'plant|warehouse|industrial park', rule: ['produce'], limEs: 'Sólo inmuebles industriales', limEn: 'Industrial property only', ref: 'Garza Ponce / AMPIP México' }),
  hiveSupport('CAP_HIVE_INFRA_WAREHOUSE_BUILD', 'SVC_WAREHOUSE_BUILD', 'Construcción de almacenes', 'Warehouse construction', [['FR_SITE', 'SPECIFIC']], 'ACTIVE', { basis: 'SITE_OR_ENTITY_COUNTRY', termsEs: 'construcción de almacén|cedis', termsEn: 'warehouse construction', ref: 'Garza Ponce / AMPIP México' }),

  // Certifications & compliance
  hiveSupport('CAP_HIVE_CERT_ISO_QUALITY', 'SVC_ISO_CERTIFICATION', 'Certificaciones ISO y de calidad', 'ISO and quality certifications', [['FR_REGULATORY', 'SPECIFIC']], 'ACTIVE', { basis: 'SITE_OR_ENTITY_COUNTRY', termsEs: 'iso|iso 9001|iso 14001|iso 45001|iatf|certificación de calidad', termsEn: 'iso|quality certification|iatf', limEs: 'Certificaciones voluntarias de sistemas de gestión y calidad', limEn: 'Voluntary management-system and quality certifications' }),
  hiveSupport('CAP_HIVE_REG_PRODUCT', 'SVC_PRODUCT_REGULATORY', 'Apoyo especializado regulatorio de producto', 'Product regulatory specialist support', [['FR_REGULATORY', 'DEFAULT']], 'SOURCEABLE', { limEs: 'Sin garantía de aprobación regulatoria', limEn: 'No guarantee of regulatory approval', policy: 'COM-3 / D-097' }),
  hiveSupport('CAP_HIVE_COM_PUBLIC_PROCUREMENT', 'SVC_PUBLIC_PROCUREMENT', 'Apoyo en contratación pública', 'Public procurement support', [['FR_PUBLIC_PROCUREMENT', 'DEFAULT']], 'REVIEW', { limEs: 'Sin garantía de adjudicación', limEn: 'No guarantee of award' }),
];

// Fix-ups for coverage values that depend on basis (kept explicit so the data reads as the registry does).
for (const c of CAPABILITIES) {
  if (c.coverageBasis === 'ORIGIN_DESTINATION_ROUTE') c.coverage = [{ value: 'MX:DOMESTIC', state: 'CONFIRMED', validFrom: SINCE }];
  if (c.capabilityStatus === 'ACTIVE' && c.providerStatus === 'AFFILIATED' && c.kind === 'HIVE' && c.coverage.length === 0) {
    c.coverage = [{ value: 'MX', state: 'CONFIRMED', validFrom: SINCE }];
  }
}
// Provider status for ACTIVE Hive capabilities (registry §6.2: AFFILIATED in MX).
for (const c of CAPABILITIES) if (c.kind === 'HIVE' && c.capabilityStatus === 'ACTIVE') c.providerStatus = 'AFFILIATED';

const cat = (id: string, es: string, en: string): ServiceCategory => ({ categoryId: id, nameEs: es, nameEn: en, description: en, publicationStatus: 'PUBLISHED', validFrom: SINCE });
export const CATEGORIES: ServiceCategory[] = [
  cat('CAT_SA_MARKET_ENTRY', 'Entrada al mercado', 'Market Entry'),
  cat('CAT_SA_RISK_COMPLIANCE', 'Riesgo y cumplimiento', 'Risk & Compliance'),
  cat('CAT_SA_GROWTH', 'Apoyo al crecimiento', 'Growth Support'),
  cat('CAT_SA_ECOSYSTEM', 'Desarrollo de ecosistema', 'Ecosystem Development'),
  cat('CAT_CORPORATE_LEGAL', 'Corporativo, legal y fiscal', 'Corporate, Legal & Tax'),
  cat('CAT_DOCUMENT_SERVICES', 'Servicios documentales', 'Document Services'),
  cat('CAT_FINANCIAL_SERVICES', 'Servicios financieros', 'Financial Services'),
  cat('CAT_PEOPLE', 'Personas y talento', 'People & Talent'),
  cat('CAT_LOGISTICS', 'Logística y comercio exterior', 'Logistics & Trade'),
  cat('CAT_SITES', 'Sitios e infraestructura', 'Sites & Infrastructure'),
  cat('CAT_OPERATIONS_TECH', 'Tecnología para operaciones', 'Operations Technology'),
  cat('CAT_CERT_COMPLIANCE', 'Certificaciones y cumplimiento', 'Certifications & Compliance'),
];

const SVC_TO_CAT: Record<string, string> = {
  SVC_SA_COUNTRY_BRIEF: 'CAT_SA_MARKET_ENTRY', SVC_SA_FEASIBILITY: 'CAT_SA_MARKET_ENTRY', SVC_SA_APPETITE: 'CAT_SA_MARKET_ENTRY', SVC_SA_MARKET_ACCESS: 'CAT_SA_MARKET_ENTRY',
  SVC_SA_BUSINESS_CHECK: 'CAT_SA_RISK_COMPLIANCE', SVC_SA_DEEP_DIVE: 'CAT_SA_RISK_COMPLIANCE', SVC_SA_QUALIFICATION: 'CAT_SA_RISK_COMPLIANCE', SVC_SA_COI: 'CAT_SA_RISK_COMPLIANCE',
  SVC_SA_PLAYBOOK: 'CAT_SA_GROWTH', SVC_SA_GTM: 'CAT_SA_GROWTH', SVC_SA_PARTNERSHIP: 'CAT_SA_GROWTH', SVC_SA_BOARD: 'CAT_SA_GROWTH',
  SVC_SA_SUPPLIER_SEARCH: 'CAT_SA_ECOSYSTEM', SVC_SA_PARTNER_MATCH: 'CAT_SA_ECOSYSTEM',
  SVC_CORPORATE_SETUP_TAX: 'CAT_CORPORATE_LEGAL', SVC_LEGAL_ADMIN: 'CAT_CORPORATE_LEGAL', SVC_TRANSFER_PRICING: 'CAT_CORPORATE_LEGAL',
  SVC_BRAND_PROTECTION: 'CAT_CORPORATE_LEGAL', SVC_WIND_DOWN: 'CAT_CORPORATE_LEGAL', SVC_PERMITS: 'CAT_CORPORATE_LEGAL',
  SVC_DOCUMENT_SERVICES: 'CAT_DOCUMENT_SERVICES', SVC_BANKING: 'CAT_FINANCIAL_SERVICES', SVC_INSURANCE: 'CAT_FINANCIAL_SERVICES',
  SVC_PAYROLL: 'CAT_PEOPLE', SVC_EOR: 'CAT_PEOPLE', SVC_RECRUITMENT: 'CAT_PEOPLE', SVC_EMPLOYEE_TRANSPORT: 'CAT_PEOPLE', SVC_STAFF_HOUSING: 'CAT_PEOPLE', SVC_MOBILITY: 'CAT_PEOPLE',
  SVC_TRADE_CUSTOMS: 'CAT_LOGISTICS', SVC_WAREHOUSING: 'CAT_LOGISTICS', SVC_FREIGHT: 'CAT_LOGISTICS', SVC_SPECIAL_CARGO: 'CAT_LOGISTICS', SVC_LAST_MILE: 'CAT_LOGISTICS',
  SVC_INDUSTRIAL_RE: 'CAT_SITES', SVC_WAREHOUSE_BUILD: 'CAT_SITES', SVC_OFFICE_SPACE: 'CAT_SITES', SVC_RETAIL_PREMISES: 'CAT_SITES',
  SVC_OPERATIONS_TECH: 'CAT_OPERATIONS_TECH',
  SVC_ISO_CERTIFICATION: 'CAT_CERT_COMPLIANCE', SVC_PRODUCT_REGULATORY: 'CAT_CERT_COMPLIANCE', SVC_PUBLIC_PROCUREMENT: 'CAT_CERT_COMPLIANCE',
};
export const SERVICES: Service[] = Object.entries(SVC_TO_CAT).map(([serviceId, categoryId]) => {
  const caps = CAPABILITIES.filter((c) => c.serviceId === serviceId);
  return {
    serviceId, categoryId, nameEs: caps[0]?.nameEs ?? serviceId, nameEn: caps[0]?.nameEn ?? serviceId,
    publicDescription: caps[0]?.nameEn ?? serviceId, internalDescription: serviceId, aliases: [],
    publicationStatus: 'PUBLISHED', validFrom: SINCE,
  };
});

export const COUNTRIES: CountryCoverage[] = [
  { iso: 'MX', nameEs: 'México', nameEn: 'Mexico', state: 'ACTIVE', validFrom: SINCE },
  { iso: 'ES', nameEs: 'España', nameEn: 'Spain', state: 'DEVELOPING', validFrom: SINCE },
];

export const SEED_CATALOG: Catalog = {
  version: CATALOG_VERSION, publishedAt: SINCE, fronts: FRONTS,
  categories: CATEGORIES, services: SERVICES, capabilities: CAPABILITIES, countries: COUNTRIES,
};
