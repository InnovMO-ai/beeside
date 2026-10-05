import type { Front, FrontKey } from '../domain/types';

const L = (s: string) => s.split('|').map((x) => x.trim()).filter(Boolean);
const f = (
  key: FrontKey, internalName: string, nameEs: string, nameEn: string,
  synEs: string, synEn: string, exEs = '', exEn = '',
): Front => ({
  key, internalName, nameEs, nameEn,
  synonymsEs: L(synEs), synonymsEn: L(synEn), examplesEs: L(exEs), examplesEn: L(exEn),
});

/** FRONT_CATALOG_FOR_DESIGN.md — 20 fronts. Source of truth; no legacy taxonomy. */
export const FRONTS: Front[] = [
  f('FR_LEGAL_TAX', 'Legal, fiscal y contable', 'Estructura legal, impuestos y contabilidad', 'Legal setup, tax and accounting',
    'entidad|sociedad|sucursal|constitución|rfc|impuestos|contador|abogado|compliance fiscal', 'entity|incorporation|branch|tax|accountant|lawyer|bookkeeping'),
  f('FR_BANKING', 'Banca y pagos locales', 'Banco y pagos en el país', 'Local banking and payments',
    'cuenta bancaria|pagos locales|tesorería|transferencias|banco', 'bank account|local payments|treasury|bank'),
  f('FR_RECRUITMENT', 'Talento: reclutamiento', 'Encontrar a las personas', 'Finding the right people',
    'reclutamiento|selección|headhunting|perfiles|vacantes|reclutar', 'recruiting|hiring|talent search|headhunter|recruit'),
  f('FR_EMPLOYMENT', 'Empleo: figura empleadora y nómina', 'Contratar legalmente y pagar nómina', 'Employment and payroll',
    'empleador|nómina|contratos laborales|tercero empleador|eor|prestaciones', 'employer of record|payroll|employment contracts|benefits'),
  f('FR_MOBILE_STAFF', 'Personal desplazado', 'Tu equipo que viaja o se traslada', 'Your staff on assignment',
    'expatriados|personal desplazado|asignaciones|viajes de trabajo', 'expats|assignees|secondment|business travel'),
  f('FR_SITE', 'Sitio, oficina o instalaciones', 'Dónde vas a operar (oficina, planta, local)', "Where you'll operate (office, plant, premises)",
    'oficina|coworking|planta|nave|bodega|local|terreno|parque industrial|tienda', 'office|plant|warehouse|premises|industrial park|store'),
  f('FR_PERMITS', 'Permisos de operación', 'Permisos para operar', 'Operating permits',
    'licencias|permisos|autorizaciones municipales|uso de suelo', 'licenses|permits|zoning'),
  f('FR_GTM', 'Desarrollo comercial y canales', 'Vender y llegar a tus clientes', 'Selling and reaching customers',
    'canales|ventas|go-to-market|ecommerce|marketplace|retail|distribución comercial', 'sales|channels|go-to-market|e-commerce'),
  f('FR_PUBLIC_PROCUREMENT', 'Contratación pública', 'Vender a gobierno', 'Selling to government',
    'licitación|licitaciones|concurso|compras públicas|sector público', 'tender|public procurement|bid'),
  f('FR_LOCAL_PARTNERS', 'Socios locales', 'Socios locales', 'Local partners',
    'distribuidor|representante|partner|aliado|implementador|consorcio', 'distributor|reseller|partner|implementation partner|joint venture'),
  f('FR_REGULATORY', 'Regulatorio de producto o actividad', 'Requisitos regulatorios de tu producto o actividad', 'Product or activity regulatory requirements',
    'registro sanitario|aviso de funcionamiento|etiquetado|certificación|norma|autoridad sanitaria', 'registration|labeling|certification|compliance|regulator'),
  f('FR_BRAND', 'Protección de marca', 'Proteger tu marca', 'Protecting your brand',
    'registro de marca|propiedad intelectual|uso de marca|falsificaciones', 'trademark|ip|brand protection|counterfeits'),
  f('FR_TRADE', 'Importación y comercio exterior', 'Importación y aduanas', 'Import, export and customs',
    'aduana|importación|exportación|agente aduanal|importador|aranceles|importación temporal', 'customs|import|export|broker|tariffs|temporary import'),
  f('FR_LOGISTICS', 'Logística e inventario', 'Logística e inventario', 'Logistics and inventory',
    'transporte|almacén|fulfillment|inventario|rutas|carga sobredimensionada|transporte especializado', 'shipping|warehousing|fulfillment|inventory|freight|heavy haul'),
  f('FR_SUPPLIERS', 'Proveedores en destino', 'Encontrar y validar proveedores', 'Finding and vetting suppliers',
    'proveedores|fabricantes|maquila|subcontratistas|renta de equipo|grúas|grúa|auditoría de proveedores', 'suppliers|manufacturers|contract manufacturing|subcontractors|equipment rental|cranes|crane|supplier audit'),
  f('FR_INSURANCE', 'Seguros', 'Seguros', 'Insurance',
    'pólizas|coberturas|responsabilidad civil|seguro de carga|seguro', 'insurance|coverage|liability|cargo insurance'),
  f('FR_STAFF_HOUSING', 'Alojamiento y logística de personal', 'Alojamiento y traslados del equipo', 'Staff housing and local transport',
    'alojamiento|hospedaje|campamento|traslados|transporte de personal', 'housing|lodging|accommodation|crew transport'),
  f('FR_EXIT', 'Cierre y desmovilización', 'Cerrar ordenadamente al terminar', 'Wind-down and exit',
    'cierre|desmovilización|salida|terminación de contratos|liquidación', 'wind-down|demobilization|exit|closure'),
  f('FR_PARENT_LINK', 'Relación con la empresa de origen', 'Cómo se conecta con tu empresa de origen', 'How it connects with your home company',
    'intercompañía|relación matriz-filial|facturación entre empresas|precios de transferencia', 'intercompany|parent-subsidiary|cross-border invoicing|transfer pricing'),
  f('FR_INVEST_RC', 'Riesgo y cumplimiento de la inversión', 'Riesgo y cumplimiento de tu inversión', 'Investment risk and compliance',
    'due diligence|riesgo|cumplimiento|inversión', 'due diligence|risk|compliance|investment'),
];

/** Canonical presentation order of topics (grouped: place → legal → people → goods → money → exit). */
export const FRONT_ORDER: FrontKey[] = [
  'FR_SITE', 'FR_LEGAL_TAX', 'FR_PERMITS', 'FR_RECRUITMENT', 'FR_EMPLOYMENT', 'FR_MOBILE_STAFF',
  'FR_TRADE', 'FR_LOGISTICS', 'FR_SUPPLIERS', 'FR_BANKING', 'FR_INSURANCE', 'FR_STAFF_HOUSING',
  'FR_PARENT_LINK', 'FR_EXIT', 'FR_GTM', 'FR_PUBLIC_PROCUREMENT', 'FR_LOCAL_PARTNERS',
  'FR_REGULATORY', 'FR_BRAND', 'FR_INVEST_RC',
];
