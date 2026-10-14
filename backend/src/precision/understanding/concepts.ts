/**
 * Concept lexicon: how free narrative (es/en) maps to business concepts, candidate catalog categories/services and the implications
 * the AI may PROPOSE. It is the deterministic baseline of the interpreter (offline, testable, auditable) and the vocabulary the
 * model-backed interpreter is held to: a model may name a concept only if it exists here or is returned as an unresolved need.
 *
 * Product rules encoded:
 *  - NEED FIRST: a concept is evidence of a client need; the catalog (category/services) is enrichment, never the filter.
 *  - `implies` are PROPOSALS (Implicit): they never count for sufficiency and never open a service until the client accepts.
 *  - No concept encodes a legal/tax conclusion. Concepts only say "this topic matters, ask about it".
 *
 * Terms: accents/case are ignored; `*` is a prefix wildcard (contrat* -> contratar, contratación, contratos).
 */
import type { L10n } from "./types";

export type ConceptKind = "need" | "attribute" | "context";

export interface ConceptImplication { concept: string; reason: L10n }

export interface ConceptDef {
  id: string;
  kind: ConceptKind;
  label: L10n;
  /** Short noun phrase used when the product speaks about the concept ("la constitución de la entidad local"). */
  phrase: L10n;
  terms: { es: string[]; en: string[] };
  category?: string;
  services?: string[];
  /** Specialty the topic belongs to (drives specialist-review findings and the knowledge level). */
  specialty?: "legal" | "tax" | "labor" | "customs" | "regulatory" | "corporate" | "finance";
  implies?: ConceptImplication[];
}

const c = (def: ConceptDef): ConceptDef => def;

export const CONCEPTS: readonly ConceptDef[] = [
  // ---------------------------------------------------------------- corporate_legal_admin
  c({
    id: "entity_setup", kind: "need", category: "corporate_legal_admin", services: ["company_incorporation_corporate_setup"], specialty: "corporate",
    label: { es: "Constitución de la entidad local", en: "Local entity setup" },
    phrase: { es: "la constitución de una entidad local", en: "setting up a local entity" },
    terms: {
      es: ["constituir*", "constitucion de (?:la |una |nuestra )?(?:sociedad|empresa|entidad|filial|subsidiaria)", "abrir una empresa", "abrir una sociedad", "crear una empresa", "crear una sociedad", "crear una filial", "crear una subsidiaria", "entidad local", "empresa local", "sociedad local", "filial", "subsidiaria", "sucursal", "oficina de representacion", "razon social", "constitucion", "incorporacion", "establecer una empresa", "establecer una entidad", "montar una empresa", "alta de la empresa"],
      en: ["incorporat*", "set up a company", "setup a company", "set up a local", "local entity", "local company", "subsidiary", "branch office", "representative office", "legal entity", "form a company", "establish a company", "register a company"],
    },
  }),
  c({
    id: "legal_services", kind: "need", category: "corporate_legal_admin", services: ["commercial_contracts", "corporate_secretarial_support"], specialty: "legal",
    label: { es: "Servicios legales", en: "Legal services" },
    phrase: { es: "servicios legales", en: "legal services" },
    terms: {
      es: ["servicios legales", "asesoria legal", "asesoria juridica", "apoyo legal", "abogado*", "despacho juridico", "temas legales", "aspectos legales", "legal"],
      en: ["legal services", "legal advice", "legal support", "lawyer*", "law firm", "legal matters", "legal"],
    },
  }),
  c({
    id: "contracts", kind: "need", category: "corporate_legal_admin", services: ["commercial_contracts", "contract_review"], specialty: "legal",
    label: { es: "Contratos", en: "Contracts" }, phrase: { es: "los contratos", en: "contracts" },
    terms: { es: ["contratos comerciales", "contrato de", "revision de contratos", "redaccion de contratos", "contratos con proveedores", "contratos con clientes"], en: ["commercial contracts", "contract review", "draft contracts", "contracts with suppliers", "contracts with customers"] },
  }),
  c({
    id: "labor_legal", kind: "need", category: "corporate_legal_admin", services: ["labor_legal_support"], specialty: "labor",
    label: { es: "Apoyo legal laboral", en: "Labor legal support" }, phrase: { es: "el apoyo legal laboral", en: "labor legal support" },
    terms: { es: ["laboral*", "legal laboral", "derecho laboral", "contratos laborales", "contratos de trabajo", "obligaciones laborales", "temas laborales", "aspectos laborales", "ley federal del trabajo", "reglamento interno de trabajo"], en: ["labor law", "labour law", "employment law", "employment contracts", "labor obligations", "labour obligations", "employment matters"] },
  }),
  c({
    id: "trademark_ip", kind: "need", category: "corporate_legal_admin", services: [], specialty: "legal",
    label: { es: "Marca y propiedad intelectual", en: "Trademark and IP" }, phrase: { es: "la marca y la propiedad intelectual", en: "trademark and IP" },
    terms: { es: ["registro de marca", "registrar la marca", "propiedad intelectual", "patente*"], en: ["trademark", "intellectual property", "patent*"] },
  }),
  c({
    id: "translation_legalization", kind: "need", category: "corporate_legal_admin", services: ["business_document_translation", "certified_sworn_translation", "apostille_and_document_legalization"],
    label: { es: "Traducción y legalización de documentos", en: "Document translation and legalization" }, phrase: { es: "la traducción y legalización de documentos", en: "document translation and legalization" },
    terms: { es: ["traduccion*", "traductor*", "apostill*", "legalizacion de documentos"], en: ["translation*", "translator*", "apostille", "document legalization", "legalize documents"] },
  }),
  // ---------------------------------------------------------------- tax_accounting_audit
  c({
    id: "tax_services", kind: "need", category: "tax_accounting_audit", services: ["tax_advisory"], specialty: "tax",
    label: { es: "Servicios fiscales", en: "Tax services" }, phrase: { es: "los servicios fiscales", en: "tax services" },
    terms: { es: ["servicios fiscales", "asesoria fiscal", "temas fiscales", "aspectos fiscales", "fiscal", "fiscalidad", "impuestos", "tributari*", "sat", "planeacion fiscal"], en: ["tax services", "tax advice", "tax advisory", "tax matters", "taxes", "taxation", "tax planning", "tax"] },
  }),
  c({
    id: "tax_compliance", kind: "need", category: "tax_accounting_audit", services: ["tax_compliance"], specialty: "tax",
    label: { es: "Cumplimiento fiscal", en: "Tax compliance" }, phrase: { es: "el cumplimiento fiscal", en: "tax compliance" },
    terms: { es: ["cumplimiento fiscal", "obligaciones fiscales", "declaraciones", "declaracion mensual", "declaracion anual", "cumplir con el sat", "registro fiscal", "alta fiscal", "cumplimiento tributario", "iva"], en: ["tax compliance", "tax obligations", "tax filings", "tax returns", "tax registration", "vat", "compliance with the tax"] },
  }),
  c({
    id: "accounting", kind: "need", category: "tax_accounting_audit", services: ["accounting_bookkeeping", "financial_reporting"],
    label: { es: "Contabilidad", en: "Accounting" }, phrase: { es: "la contabilidad", en: "accounting" },
    terms: { es: ["contabilidad", "contable*", "contador*", "teneduria de libros", "estados financieros", "reportes financieros", "cierre contable"], en: ["accounting", "accountant*", "bookkeeping", "financial statements", "financial reporting", "month-end close"] },
  }),
  c({
    id: "audit", kind: "need", category: "tax_accounting_audit", services: ["financial_statements_audit", "internal_audit"],
    label: { es: "Auditoría", en: "Audit" }, phrase: { es: "la auditoría", en: "audit" },
    terms: { es: ["auditoria*", "auditor*", "dictamen"], en: ["audit", "audits", "auditor*"] },
  }),
  c({
    id: "transfer_pricing", kind: "need", category: "tax_accounting_audit", services: ["transfer_pricing_advisory", "transfer_pricing_documentation"], specialty: "tax",
    label: { es: "Precios de transferencia", en: "Transfer pricing" }, phrase: { es: "los precios de transferencia", en: "transfer pricing" },
    terms: { es: ["precios de transferencia", "transfer pricing", "operaciones entre partes relacionadas", "operaciones intercompania", "operaciones intercompañia", "partes relacionadas"], en: ["transfer pricing", "related[- ]party transactions", "intercompany transactions", "intra-?group pricing"] },
  }),
  c({
    id: "intercompany_funding", kind: "need", category: "tax_accounting_audit", services: ["transfer_pricing_advisory"], specialty: "tax",
    label: { es: "Financiamiento intercompañía", en: "Intra-group funding" }, phrase: { es: "el financiamiento desde la casa matriz", en: "funding from the parent company" },
    terms: {
      es: ["financiamiento (?:desde|de|por parte de|con) (?:la )?(?:casa )?matriz", "financiamiento intercompania", "fondeo", "fondear", "prestamo intercompania", "prestamo de la matriz", "prestamo de la casa matriz", "capital de la matriz", "capitalizar", "capitalizacion", "aportacion de capital", "aportaciones de capital", "financiar* (?:desde|con|por) (?:la )?(?:casa )?matriz", "matriz (?:va a|vaya a|vamos a|nos) financi*", "empresa matriz", "casa matriz", "financiamiento intragrupo", "financiado por (?:la )?(?:empresa|casa) matriz"],
      en: ["intercompany loan", "intra-?group (?:loan|funding|financing)", "parent (?:company )?(?:will )?(?:fund|financ)\\w*", "funded by (?:the )?parent", "financed by (?:the )?parent", "capital injection", "capitalize", "capitalization", "funding from (?:the )?parent"],
    },
  }),
  // ---------------------------------------------------------------- banking
  c({
    id: "banking", kind: "need", category: "banking_finance_insurance", services: ["corporate_bank_account_solutions", "corporate_banking"],
    label: { es: "Cuenta bancaria y banca", en: "Banking" }, phrase: { es: "la banca", en: "banking" },
    terms: { es: ["cuenta bancaria", "cuentas bancarias", "abrir una cuenta", "banco*", "banca", "tesoreria"], en: ["bank account", "bank accounts", "banking", "treasury"] },
  }),
  c({
    id: "financing", kind: "need", category: "banking_finance_insurance", services: ["corporate_credit", "working_capital"],
    label: { es: "Financiamiento", en: "Financing" }, phrase: { es: "el financiamiento", en: "financing" },
    terms: { es: ["credito bancario", "linea de credito", "capital de trabajo", "arrendamiento financiero", "factoraje"], en: ["credit line", "bank credit", "working capital", "equipment financing", "leasing", "factoring"] },
  }),
  c({
    id: "insurance", kind: "need", category: "banking_finance_insurance", services: ["corporate_insurance", "cargo_transportation_insurance", "liability_insurance"],
    label: { es: "Seguros", en: "Insurance" }, phrase: { es: "los seguros", en: "insurance" },
    terms: { es: ["seguros? (?:corporativos?|empresariales?|de responsabilidad|de carga|de transporte|para la operacion|de la operacion)", "aseguradora*", "poliza*"], en: ["insurance", "insurer*", "policy cover"] },
  }),
  // ---------------------------------------------------------------- people_payroll_employment
  c({
    id: "hiring", kind: "need", category: "people_payroll_employment", services: ["recruitment", "hr_administration"], specialty: "labor",
    label: { es: "Contratación de personal", en: "Hiring" }, phrase: { es: "la contratación de personal", en: "hiring" },
    terms: { es: ["contratar*", "contratacion de personal", "contratacion", "reclutamiento", "reclutar", "seleccion de personal", "vacantes", "recursos humanos", "dar de alta (?:a )?(?:empleados|trabajadores|personal)"], en: ["hire", "hiring", "recruit*", "human resources", "onboard (?:employees|staff)"] },
  }),
  c({
    id: "workforce_presence", kind: "context",
    label: { es: "Personal en el país", en: "Workforce in the country" }, phrase: { es: "el personal en el país", en: "the workforce in the country" },
    terms: { es: ["empleados", "trabajadores", "personal", "plantilla", "colaboradores", "tecnicos", "ingenieros", "operarios", "mano de obra"], en: ["employees", "workers", "staff", "technicians", "engineers", "workforce", "headcount"] },
    implies: [{ concept: "payroll", reason: { es: "Si habrá personal directo en el país, probablemente haga falta nómina y seguridad social.", en: "If there will be direct staff in the country, payroll and social security will probably be needed." } }],
  }),
  c({
    id: "payroll", kind: "need", category: "people_payroll_employment", services: ["payroll_processing"], specialty: "labor",
    label: { es: "Nómina", en: "Payroll" }, phrase: { es: "la nómina", en: "payroll" },
    terms: { es: ["nomina*", "pago de sueldos", "pago a empleados", "pago de salarios"], en: ["payroll", "salary payments", "pay employees"] },
  }),
  c({
    id: "social_security", kind: "need", category: "people_payroll_employment", services: ["hr_administration", "payroll_processing"], specialty: "labor",
    label: { es: "Seguridad social", en: "Social security" }, phrase: { es: "la seguridad social", en: "social security" },
    terms: { es: ["seguridad social", "imss", "infonavit", "afore", "alta de empleados", "alta de trabajadores", "cuotas obrero patronales", "cuotas patronales"], en: ["social security", "imss", "employer contributions", "social contributions"] },
  }),
  c({
    id: "outsourced_workforce", kind: "need", category: "people_payroll_employment", services: ["temporary_staffing", "employer_of_record_eor"], specialty: "labor",
    label: { es: "Personal subcontratado", en: "Outsourced workforce" }, phrase: { es: "el personal subcontratado", en: "outsourced workforce" },
    terms: { es: ["outsourcing", "subcontrat*", "tercerizad*", "terceriz*", "personal externo", "personal de terceros", "personal por terceros", "empresa de personal", "agencia de personal", "staffing", "servicios especializados", "personal temporal", "proveedor de personal", "a traves de un tercero", "a traves de terceros", "por medio de un tercero", "por medio de terceros", "contratados por terceros", "tercero que los contrate"], en: ["outsourc*", "subcontract*", "third[- ]party (?:staff|personnel|workers|labor|labour)", "staffing (?:agency|company)", "temp(?:orary)? (?:staff|workers)", "contingent workers", "external staff"] },
  }),
  c({
    id: "eor", kind: "need", category: "people_payroll_employment", services: ["employer_of_record_eor"], specialty: "labor",
    label: { es: "Empleador de registro", en: "Employer of record" }, phrase: { es: "un empleador de registro", en: "an employer of record" },
    terms: { es: ["empleador de registro", "employer of record", "eor"], en: ["employer of record", "eor"] },
  }),
  c({
    id: "benefits", kind: "context", specialty: "labor",
    label: { es: "Prestaciones", en: "Employee benefits" }, phrase: { es: "las prestaciones", en: "employee benefits" },
    terms: { es: ["prestaciones", "beneficios para (?:los )?empleados", "beneficios laborales", "vales de despensa", "fondo de ahorro", "aguinaldo", "utilidades", "ptu", "seguro de gastos medicos"], en: ["employee benefits", "benefits package", "benefits for employees", "perks"] },
  }),
  c({
    id: "relocation", kind: "context", category: undefined,
    label: { es: "Personal que se traslada desde el origen", en: "Staff relocating from home country" }, phrase: { es: "personal que se traslada desde el país de origen", en: "staff relocating from the home country" },
    terms: { es: ["expatriad*", "trasladar* (?:a )?(?:nuestro|nuestros|mi|mis)? ?(?:personal|empleados|equipo|tecnicos|ingenieros)", "enviar* (?:a )?(?:nuestro|nuestros)? ?(?:personal|tecnicos|ingenieros|equipo) (?:desde|de) ", "personal portugues", "personal de la matriz", "asignacion internacional"], en: ["expat*", "relocat*", "secondment", "seconded", "assignees", "send our (?:staff|engineers|technicians|team)"] },
    implies: [{ concept: "immigration_mobility", reason: { es: "Si parte del personal se traslada desde el origen, pueden importar los temas migratorios y de movilidad.", en: "If part of the staff relocates from the home country, immigration and mobility topics may matter." } }],
  }),
  c({
    id: "immigration_mobility", kind: "context",
    label: { es: "Movilidad y temas migratorios", en: "Mobility and immigration" }, phrase: { es: "los temas migratorios", en: "immigration topics" },
    terms: { es: ["visa*", "permiso de trabajo", "permisos de trabajo", "residencia", "migraci*", "inmigraci*"], en: ["visa*", "work permit*", "residence permit*", "immigration"] },
  }),
  // ---------------------------------------------------------------- real estate / infrastructure
  c({
    id: "office", kind: "need", category: "corporate_real_estate", services: ["office_rental", "office_search", "coworking_flexible_offices", "serviced_offices", "virtual_office_corporate_address"],
    label: { es: "Oficina", en: "Office space" }, phrase: { es: "una oficina", en: "an office" },
    terms: { es: ["oficina*", "coworking", "domicilio fiscal", "domicilio social", "direccion corporativa"], en: ["office space", "offices", "coworking", "registered address", "virtual office"] },
  }),
  c({
    id: "industrial_site", kind: "need", category: "industrial_real_estate", services: ["warehouse_industrial_building_rental", "industrial_parks", "industrial_site_selection"],
    label: { es: "Nave o parque industrial", en: "Industrial site" }, phrase: { es: "una nave o parque industrial", en: "an industrial site" },
    terms: { es: ["parque industrial", "nave industrial", "renta de nave", "espacio (?:de|para) almac\\w+", "renta de almacen", "terreno industrial", "planta de produccion", "instalaciones industriales"], en: ["warehouse space", "industrial park", "industrial building", "industrial land", "production plant", "industrial site"] },
  }),
  c({
    id: "industrial_works", kind: "need", category: "industrial_infrastructure", services: ["plant_construction_expansion", "engineering", "electrical_installations", "specialized_installations"],
    label: { es: "Obra e instalaciones industriales", en: "Industrial works and installations" }, phrase: { es: "obra e instalaciones industriales", en: "industrial works and installations" },
    terms: { es: ["construccion de planta", "construccion de nave", "ingenieria", "instalaciones electricas", "montaje industrial", "obra civil"], en: ["plant construction", "warehouse construction", "engineering works", "electrical installations", "civil works"] },
  }),
  c({
    id: "equipment_installation", kind: "context",
    label: { es: "Instalación de equipo del proyecto", en: "Installation of project equipment" }, phrase: { es: "la instalación del equipo del proyecto", en: "installing project equipment" },
    terms: { es: ["instalar* (?:parte (?:de|del) )?(?:el |los |las )?(?:equipo|equipos|maquinaria|equipamiento)", "instalacion de (?:parte del )?equipo", "instalacion de equipos", "montaje de equipo", "montar el equipo", "equipo del proyecto"], en: ["install* (?:part of )?(?:the )?(?:project )?equipment", "installation of (?:the )?equipment", "equipment installation"] },
    implies: [{ concept: "customs_trade", reason: { es: "Si el equipo viene del extranjero, la entrada temporal o definitiva del equipo puede requerir apoyo de comercio exterior.", en: "If the equipment comes from abroad, its temporary or permanent entry may need customs and trade support." } }],
  }),
  // ---------------------------------------------------------------- technology / security
  c({
    id: "technology", kind: "need", category: "technology_it", services: ["erp", "wms", "tms", "software_implementation", "systems_integration"],
    label: { es: "Tecnología y sistemas", en: "Technology and systems" }, phrase: { es: "tecnología y sistemas", en: "technology and systems" },
    terms: { es: ["erp", "wms", "tms", "crm", "software", "sistemas de informacion", "sistema de gestion", "infraestructura de ti", "ciberseguridad", "nube"], en: ["erp", "wms", "tms", "crm", "software", "information systems", "it infrastructure", "cybersecurity", "cloud services"] },
  }),
  c({
    id: "physical_security", kind: "need", category: "physical_security", services: ["security_guards", "facility_security"],
    label: { es: "Seguridad física", en: "Physical security" }, phrase: { es: "seguridad física", en: "physical security" },
    terms: { es: ["guardias", "seguridad privada", "vigilancia", "proteccion ejecutiva", "seguridad fisica"], en: ["security guards", "private security", "executive protection", "physical security"] },
  }),
  // ---------------------------------------------------------------- logistics & trade
  c({
    id: "customs_trade", kind: "need", category: "international_trade_customs", services: ["customs_advisory", "customs_brokerage", "import_export_compliance"], specialty: "customs",
    label: { es: "Comercio exterior y aduanas", en: "International trade and customs" }, phrase: { es: "comercio exterior y aduanas", en: "international trade and customs" },
    terms: { es: ["aduana*", "agente aduanal", "importar", "importacion*", "exportar", "exportacion*", "comercio exterior", "arancel*", "fraccion arancelaria", "immex", "prosec", "tratado de libre comercio", "tlc", "regla de origen", "reglas de origen", "importacion temporal"], en: ["customs", "customs broker", "import", "imports", "importing", "export", "exports", "exporting", "tariff*", "hs code", "free trade agreement", "rules of origin", "temporary import"] },
  }),
  c({
    id: "logistics_transport", kind: "need", category: "logistics", services: ["freight_transportation", "dedicated_transportation", "3pl"],
    label: { es: "Transporte y logística", en: "Transport and logistics" }, phrase: { es: "transporte y logística", en: "transport and logistics" },
    terms: { es: ["logistica", "transporte", "transportar", "flete*", "distribucion", "ultima milla", "paqueteria", "3pl", "operador logistico", "envios", "enviar mercancia", "mover mercancia"], en: ["logistics", "transport", "transportation", "freight", "distribution", "last mile", "3pl", "shipping", "shipments", "move goods"] },
  }),
  c({
    id: "warehousing", kind: "need", category: "logistics", services: ["warehousing", "inventory_management", "distribution_center_operations"],
    label: { es: "Almacenamiento", en: "Warehousing" }, phrase: { es: "almacenamiento", en: "warehousing" },
    terms: { es: ["almacen*", "bodega*", "centro de distribucion", "almacenamiento"], en: ["warehouse*", "warehousing", "storage", "distribution center"] },
  }),
  c({
    id: "temperature_control", kind: "attribute", category: "logistics", services: ["refrigerated_transportation", "warehousing"],
    label: { es: "Control de temperatura", en: "Temperature control" }, phrase: { es: "el control de temperatura", en: "temperature control" },
    terms: { es: ["cadena de frio", "refrigerad*", "temperatura controlada", "control de temperatura", "congelad*", "frigorifico*", "perecederos", "perecedero"], en: ["cold chain", "refrigerat*", "temperature[- ]controlled", "temperature control", "frozen", "perishable*", "reefer"] },
    implies: [
      { concept: "logistics_transport", reason: { es: "Mantener la cadena de frío puede implicar transporte con temperatura controlada.", en: "Keeping the cold chain may mean temperature-controlled transport." } },
      { concept: "warehousing", reason: { es: "También puede implicar almacenamiento refrigerado.", en: "It may also mean refrigerated storage." } },
    ],
  }),
  // ---------------------------------------------------------------- procurement, quality, market
  c({
    id: "procurement", kind: "need", category: "procurement_supply_chain", services: ["supplier_sourcing", "local_supplier_development", "supplier_qualification"],
    label: { es: "Compras y proveedores", en: "Procurement and suppliers" }, phrase: { es: "compras y proveedores", en: "procurement and suppliers" },
    terms: { es: ["buscar proveedores", "encontrar proveedores", "conseguir proveedores", "abastecimiento", "compras estrategicas", "desarrollo de proveedores", "cadena de suministro"], en: ["find suppliers", "find local suppliers", "source suppliers", "sourcing", "procurement", "supply chain"] },
  }),
  c({
    id: "certifications", kind: "need", category: "certifications_quality", services: ["product_certification", "nom_local_standards_support", "iso_certification_support"], specialty: "regulatory",
    label: { es: "Certificaciones y calidad", en: "Certifications and quality" }, phrase: { es: "certificaciones y calidad", en: "certifications and quality" },
    terms: { es: ["certificacion*", "certificar", "normas oficiales", "nom-?\\d*", "iso \\d+", "laboratorio", "cofepris", "calidad del producto"], en: ["certification*", "certify", "iso \\d+", "laboratory testing", "quality standards", "product conformity"] },
  }),
  c({
    id: "market_research", kind: "need", category: "market_intelligence", services: ["market_research", "market_sizing", "competitive_intelligence", "demand_studies"],
    label: { es: "Investigación de mercado", en: "Market research" }, phrase: { es: "investigación de mercado", en: "market research" },
    terms: { es: ["investigacion de mercado", "estudio de mercado", "tamano de mercado", "analisis de competencia", "competidores", "validar la demanda", "validacion de mercado", "encuesta*", "focus group"], en: ["market research", "market study", "market sizing", "competitor analysis", "validate demand", "market validation", "survey*", "focus group"] },
  }),
  c({
    id: "location_choice", kind: "need", category: "market_intelligence", services: ["location_studies"],
    label: { es: "Dónde establecerse", en: "Choosing a location" }, phrase: { es: "elegir dónde establecerse", en: "choosing where to set up" },
    terms: { es: ["donde (?:me )?(?:conviene|convendria|deberia|debo|podria) (?:instalar|establec|ubicar|operar|poner)", "que estado", "que estados", "en que zona", "en que estado", "que ciudad", "que region", "seleccion de ubicacion", "estudio de ubicacion", "elegir ubicacion", "donde instalar", "donde establecer", "mejor ubicacion", "mejor zona"], en: ["where (?:should|could|would) (?:i|we) (?:set up|locate|operate|establish|install)", "which state", "which states", "what area", "which city", "site selection", "location study", "best location", "best area"] },
  }),
  c({
    id: "marketing", kind: "need", category: "marketing_communications", services: ["marketing_agency", "digital_marketing", "branding"],
    label: { es: "Marketing", en: "Marketing" }, phrase: { es: "marketing", en: "marketing" },
    terms: { es: ["marketing", "mercadotecnia", "publicidad", "branding", "marca comercial", "redes sociales", "posicionamiento", "pagina web", "sitio web", "seo", "relaciones publicas"], en: ["marketing", "advertising", "branding", "social media", "website", "seo", "public relations", "pr agency"] },
  }),
  c({
    id: "travel", kind: "need", category: "travel_mobility", services: ["corporate_travel_management", "corporate_accommodation", "business_travel_support"],
    label: { es: "Viajes y hospedaje", en: "Travel and accommodation" }, phrase: { es: "viajes y hospedaje", en: "travel and accommodation" },
    terms: { es: ["viajes corporativos", "hospedaje", "alojamiento", "vivienda para el personal", "renta de vehiculos", "flotilla*", "traslado de personal"], en: ["corporate travel", "accommodation", "housing for staff", "car rental", "fleet", "staff housing"] },
  }),
  // ---------------------------------------------------------------- strategic / ecosystem
  c({
    id: "strategy_entry", kind: "need", category: "strategic_advisory", services: [],
    label: { es: "Estrategia de entrada", en: "Entry strategy" }, phrase: { es: "la estrategia de entrada", en: "entry strategy" },
    terms: { es: ["estrategia de entrada", "estrategia comercial", "plan de negocios", "factibilidad", "go-to-market", "estrategia de mercado", "estrategia de expansion"], en: ["entry strategy", "go-to-market", "business plan", "feasibility", "market entry strategy", "commercial strategy"] },
  }),
  c({
    id: "local_partner", kind: "need", category: "ecosystem_development", services: [],
    label: { es: "Socio o distribuidor local", en: "Local partner or distributor" }, phrase: { es: "un socio o distribuidor local", en: "a local partner or distributor" },
    terms: { es: ["socio local", "distribuidor*", "agente comercial", "encontrar un socio", "buscar un socio", "partner local", "aliado local", "representante comercial"], en: ["local partner", "distributor*", "sales agent", "find a partner", "channel partner", "local representative"] },
  }),
  // ---------------------------------------------------------------- attributes / context (activate dimensions)
  c({
    id: "multi_phase", kind: "context",
    label: { es: "Proyecto en varias fases", en: "Multi-phase project" }, phrase: { es: "un proyecto en varias fases", en: "a multi-phase project" },
    terms: { es: ["primera fase", "segunda fase", "fase 1", "fase 2", "en una primera etapa", "en una segunda etapa", "despues de la primera", "mas adelante", "en el futuro vamos a", "en una siguiente fase", "luego vamos a", "posteriormente"], en: ["first phase", "second phase", "phase 1", "phase 2", "in a second stage", "later on we", "after the first", "in a later phase", "afterwards we"] },
  }),
  c({
    id: "temporary_operation", kind: "context",
    label: { es: "Operación temporal en el país", en: "Temporary in-country operation" }, phrase: { es: "una operación temporal en el país", en: "a temporary in-country operation" },
    terms: { es: ["temporal", "por (?:unos? )?\\d+", "durante (?:unos? )?\\d+", "durante aproximadamente", "duracion del proyecto", "mientras dure el proyecto", "subcontratad[oa]s? por", "contratista"], en: ["temporary", "for (?:about |around )?\\d+ (?:years|months)", "duration of the project", "for the duration", "subcontracted by", "contractor"] },
  }),
  c({
    id: "subcontracted_project", kind: "context",
    label: { es: "Subcontratados por ganadores de un proyecto", en: "Subcontracted by project winners" }, phrase: { es: "ser subcontratados por quienes ganaron el proyecto", en: "being subcontracted by the project winners" },
    terms: { es: ["subcontratad[oa]s? por", "nos (?:subcontrataron|contrataron)", "ganaron (?:el|los|un) (?:proyecto|proyectos|contrato|licitacion)", "ganador(?:es)? de (?:proyectos|licitaciones)"], en: ["subcontracted by", "won (?:the |a )?(?:project|contract|tender)", "winners of (?:the )?(?:project|tender)"] },
  }),
  c({
    id: "goods_movement", kind: "context",
    label: { es: "Producto que cruza fronteras", en: "Goods crossing borders" }, phrase: { es: "un producto que cruza fronteras", en: "goods crossing borders" },
    terms: { es: [], en: [] },
    implies: [
      { concept: "customs_trade", reason: { es: "Si el producto cruza fronteras, suele hacer falta apoyo de comercio exterior y aduanas.", en: "If the product crosses borders, trade and customs support is usually needed." } },
      { concept: "logistics_transport", reason: { es: "Mover el producto entre países suele requerir transporte y logística.", en: "Moving the product between countries usually requires transport and logistics." } },
    ],
  }),
  c({
    id: "inventory", kind: "attribute",
    label: { es: "Inventario", en: "Inventory" }, phrase: { es: "inventario", en: "inventory" },
    terms: { es: ["inventario*", "stock", "existencias", "mercancia en bodega"], en: ["inventory", "inventories", "stock on hand"] },
  }),
  c({
    id: "energy_sector", kind: "context",
    label: { es: "Sector energético", en: "Energy sector" }, phrase: { es: "el sector energético", en: "the energy sector" },
    terms: { es: ["energia", "energetic*", "electrica", "solar", "eolic*", "petroleo", "gas natural", "subestacion*", "generacion"], en: ["energy", "power plant", "solar", "wind farm", "oil and gas", "substation*", "electricity generation"] },
  }),
] as const;

const BY_ID = new Map(CONCEPTS.map((x) => [x.id, x]));
export const conceptById = (id: string): ConceptDef | undefined => BY_ID.get(id);
