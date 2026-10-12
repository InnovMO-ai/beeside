/**
 * Question bank of the scripted provider (EN + ES): one natural question per manifest field, keyed by the field key
 * (`group.sub` for a sub-field of a repeatable group). It exists so that the deterministic provider phrases questions
 * the way the Voice Guide asks for them (tuteo / second person, one question, specific to the field, no keys, no
 * exclamations). The real model phrases from the manifest label and help text; this bank is never used by it.
 *
 * Rules applied to every entry:
 *  - exactly one question; short sentences; no quality judgments; no Sherpa; no country-specific legal claim (R10);
 *  - canonical names only; acronyms are written out or avoided (SKU is glossed by "productos distintos");
 *  - `why` is present only where the reason is not obvious (Voice Guide principle 2): it is one short sentence that
 *    precedes the question and never states a legal or regulatory fact.
 *
 * Fields that are not in the bank fall back to the manifest label (a label that is already a question is used as is).
 */
import type { Locale } from "../types";

export interface Bilingual { es: string; en: string }
export interface QuestionEntry { q: Bilingual; why?: Bilingual }
export interface GroupEntry {
  /** First required sub-field of the group: the introduction is said before it, for the first item only. */
  first: string;
  /** Said once before the first question of the first item. */
  intro: Bilingual;
  /** From the second item on, the question starts with "<lead> <n>, ". */
  lead: Bilingual;
}

const b = (es: string, en: string): Bilingual => ({ es, en });
const e = (es: string, en: string, whyEs?: string, whyEn?: string): QuestionEntry => ({ q: b(es, en), ...(whyEs && whyEn ? { why: b(whyEs, whyEn) } : {}) });

/** Questions shared by every `generic_*` block (one key, one meaning in every manifest). */
const GENERIC_SUBS: Record<string, QuestionEntry> = {
  need_description: e("¿Puedes contarme con tus palabras qué necesitas?", "Could you tell me in your own words what you need?"),
  objective: e("¿Qué quieres lograr con esto?", "What do you want to achieve with this?"),
  scope: e("¿Qué debería incluir y qué no?", "What should it include, and what should it leave out?"),
  country_scope: e("¿En qué países aplica?", "Which countries does it apply to?"),
  timing_needed_by: e("¿Para qué fecha o mes lo necesitas?", "By which date or month do you need it?"),
  timing_flexibility: e("¿Esa fecha es fija o flexible?", "Is that date fixed or flexible?"),
  volume: e("¿Qué volumen o escala tiene, si aplica?", "What volume or scale is involved, if it applies?"),
  dependencies: e("¿Depende de otras decisiones o servicios?", "Does it depend on other decisions or services?"),
  constraints: e("¿Hay restricciones que debamos considerar, como presupuesto, calendario o contrapartes?", "Are there constraints we should consider, such as budget, calendar or counterparties?"),
  expected_outcome: e("¿Qué resultado esperas?", "What outcome do you expect?"),
  evidence_available: e("¿Qué información tienes ya disponible sobre esto?", "What information do you already have about this?"),
  problem: e("¿Qué problema da origen a esta necesidad?", "What problem lies behind this need?"),
  urgency: e("¿Qué urgencia tiene: alta, media o baja?", "How urgent is it: high, medium or low?"),
  references: e("¿Tienes referencias que quieras compartir?", "Do you have references you would like to share?"),
  current_provider: e("¿Hoy cuentas con un proveedor para esto?", "Do you currently have a provider for this?"),
  business_decision: e("¿Con qué decisión del negocio se relaciona?", "Which business decision is it tied to?"),
  pending_notes: e("¿Qué queda pendiente de definir?", "What is still left to define?"),
};

const GENERIC_GROUP: GroupEntry = {
  first: "need_description",
  intro: b("Vamos a describir esta necesidad con calma.", "Let's describe this need step by step."),
  lead: b("Sobre la necesidad", "About need"),
};

export const GROUPS: Readonly<Record<string, GroupEntry>> = {
  generic_unmapped_needs: GENERIC_GROUP,
  generic_needs: GENERIC_GROUP,
  logistics_flows: {
    first: "origin_country",
    intro: b("Describamos tus flujos de envío, uno a la vez.", "Let's describe your shipping flows, one at a time."),
    lead: b("Para el flujo", "For flow"),
  },
  customs_goods_profile: {
    first: "description",
    intro: b("Describamos la mercancía que pasará por aduana, una a la vez.", "Let's describe the goods that will go through customs, one set at a time."),
    lead: b("Para la mercancía", "For goods item"),
  },
  legal_shareholder_structure: {
    first: "holder_type",
    intro: b("Hablemos de quiénes serían los titulares de la empresa local, uno a la vez.", "Let's talk about who would hold the local company, one holder at a time."),
    lead: b("Para el titular", "For holder"),
  },
  legal_contract_workstreams: {
    first: "contract_type",
    intro: b("Veamos los contratos que necesitas preparar o revisar, uno a la vez.", "Let's go through the contracts you need prepared or reviewed, one at a time."),
    lead: b("Para el contrato", "For contract"),
  },
  legal_translation_needs: {
    first: "document_type",
    intro: b("Veamos los documentos que necesitas traducir, uno a la vez.", "Let's go through the documents you need translated, one at a time."),
    lead: b("Para el documento", "For document"),
  },
  legal_apostille_needs: {
    first: "document_type",
    intro: b("Veamos los documentos que necesitan apostilla o legalización, uno a la vez.", "Let's go through the documents that need an apostille or legalization, one at a time."),
    lead: b("Para el documento", "For document"),
  },
  legal_ip_assets: {
    first: "asset_type",
    intro: b("Hablemos de tus activos de propiedad intelectual, uno a la vez.", "Let's talk about your intellectual property assets, one at a time."),
    lead: b("Para el activo", "For asset"),
  },
  sa_studies: {
    first: "objective",
    intro: b("Primero, el estudio o la asesoría que necesitas.", "First, the study or advisory work you need."),
    lead: b("Para el estudio", "For study"),
  },
  ed_engagements: {
    first: "partner_type",
    intro: b("Primero, el socio que buscas.", "First, the partner you are looking for."),
    lead: b("Para la búsqueda", "For search"),
  },
};

export const QUESTIONS: Readonly<Record<string, QuestionEntry>> = {
  // ---------------------------------------------------------------- Logistics
  logistics_services_in_scope: e("¿Qué servicios de logística necesitas para este proyecto? Puedes indicar más de uno.", "Which logistics services do you need for this project? You can name more than one."),
  logistics_operating_responsibility: e(
    "¿Quién se encargará de la operación logística día a día?",
    "Who will take care of the day-to-day logistics operation?",
    "Esto nos dice qué partes de la operación necesitarías cubrir con un tercero.",
    "This tells us which parts of the operation you would need to cover with a third party.",
  ),
  logistics_primary_product_type: e("¿Qué tipo de producto vas a mover principalmente?", "What main type of product will you be moving?"),
  "logistics_flows.origin_country": e("¿Desde qué país salen los productos?", "Which country do the products leave from?"),
  "logistics_flows.destination_country": e("¿A qué país llegan?", "Which country do they arrive in?"),
  "logistics_flows.origin": e("¿Desde qué ciudad o sitio salen?", "Which city or site do they leave from?"),
  "logistics_flows.destination": e("¿A qué ciudad o sitio llegan?", "Which city or site do they arrive at?"),
  "logistics_flows.product": e("¿Qué producto se mueve en este flujo?", "What product moves in this flow?"),
  "logistics_flows.volume": e("¿Qué volumen mueves en este flujo? Indícalo con su unidad, por ejemplo pallets o contenedores.", "What volume do you move in this flow? Include the unit, for example pallets or containers."),
  "logistics_flows.frequency": e("¿Con qué frecuencia se hace este envío?", "How often is this shipment made?"),
  "logistics_flows.incoterm": e("¿Qué término de entrega (Incoterm) aplica a este flujo?", "Which delivery term (Incoterm) applies to this flow?"),
  "logistics_flows.mode_of_transport": e("¿Qué modo de transporte usarás en este flujo?", "Which mode of transport will you use in this flow?"),
  "logistics_flows.handling_requirements": e("¿Este producto tiene requisitos especiales de manejo?", "Does this product have special handling requirements?"),
  logistics_warehousing_needed: e("¿Necesitas almacenamiento dedicado para este proyecto?", "Do you need dedicated warehousing for this project?"),
  logistics_warehousing_details: e("¿Qué necesitas del almacenamiento dedicado?", "What do you need from the dedicated warehousing?"),
  logistics_hazardous_materials_flag: e(
    "¿Alguno de tus envíos incluye materiales peligrosos o regulados?",
    "Do any of your shipments include hazardous or regulated materials?",
    "Lo pregunto porque cambia cómo se planean el transporte y el almacenamiento.",
    "I ask because it changes how transport and storage are planned.",
  ),
  logistics_hazmat_ack: e("¿Por qué este producto no se considera peligroso en este envío?", "Why is this product not treated as hazardous in this shipment?"),
  logistics_cold_chain_required: e("¿Algún flujo requiere cadena de frío o control de temperatura?", "Does any flow require a cold chain or temperature control?"),
  logistics_import_export_license_status: e("¿Cuál es el estado de tus licencias de importación o exportación?", "What is the status of your import or export licenses?"),
  logistics_customs_broker_status: e("¿En qué punto estás con la contratación de un agente aduanal?", "Where are you with engaging a customs broker?"),
  logistics_inventory_profile: e("¿Cuántos productos distintos (SKU) manejarías, aproximadamente?", "Roughly how many distinct products (SKUs) would you handle?"),
  logistics_monthly_order_volume: e("¿Cuántos pedidos de salida esperas por mes?", "How many outbound orders do you expect per month?"),
  logistics_insurance_coverage_status: e("¿Ya tienes cubierto el seguro de carga?", "Do you already have cargo insurance in place?"),
  logistics_preferred_carrier_relationships: e("¿Ya trabajas con transportistas o tienes alguno preferido?", "Do you already work with carriers, or have a preferred one?"),
  logistics_lead_time_expectations: e("¿Qué tiempos de entrega esperas?", "What delivery lead times do you expect?"),
  logistics_cost_sensitivity_notes: e("¿Hay algo sobre presupuesto o sensibilidad al costo que debamos tener en cuenta?", "Is there anything about budget or cost sensitivity we should keep in mind?"),
  logistics_vat_deferment_scheme_interest: e(
    "¿Te interesa explorar un esquema para diferir el impuesto al valor agregado (IVA) en importaciones, si existe?",
    "Would you like to explore a scheme to defer value-added tax (VAT) on imports, if one exists?",
  ),
  logistics_fda_prior_notice_required: e(
    "¿Esta importación de alimentos o bebidas implica un aviso previo ante una autoridad sanitaria?",
    "Does this food or beverage import involve a prior notice to a health authority?",
  ),
  logistics_eori_number_status: e("¿En qué estado está tu número de registro de operador económico (EORI)?", "What is the status of your economic operator registration (EORI) number?"),
  generic_has_unmapped_need: e("¿Hay alguna necesidad en esta categoría que no encaje en los servicios que ya vimos?", "Is there a need in this category that does not fit the services we have covered?"),

  // ---------------------------------------------------------------- International Trade and Customs
  customs_services_in_scope: e("¿Qué servicios aduaneros necesitas para este proyecto? Puedes indicar más de uno.", "Which customs services do you need for this project? You can name more than one."),
  customs_trade_direction: e("¿Vas a importar, exportar o ambas cosas?", "Will you import, export, or both?"),
  "customs_goods_profile.description": e("¿Qué mercancía es?", "What goods are these?"),
  "customs_goods_profile.classification_status": e("¿Esta mercancía ya tiene clasificación arancelaria?", "Does this merchandise already have a tariff classification?"),
  "customs_goods_profile.tariff_code": e("¿Cuál es su código arancelario (Sistema Armonizado o nacional)?", "What is its tariff code (Harmonized System or national)?"),
  "customs_goods_profile.origin_country": e("¿De qué país proviene esta mercancía?", "Which country does this merchandise come from?"),
  "customs_goods_profile.customs_value_estimate": e("¿Cuál es el valor aproximado por año de esta mercancía para efectos aduaneros?", "What is the approximate yearly customs value of these goods?"),
  "customs_goods_profile.requires_permit_or_control": e("¿Esta mercancía está sujeta a permisos, cupos o controles especiales?", "Are these goods subject to permits, quotas or special controls?"),
  customs_restricted_goods_flag: e(
    "¿Alguna de tus mercancías requiere permisos, cupos o controles especiales?",
    "Do any of your goods require permits, quotas or special controls?",
    "Lo pregunto porque cambia la ruta con la que se prepararía esta categoría.",
    "I ask because it changes the route this category would take.",
  ),
  customs_restricted_goods_ack: e("¿Por qué estas mercancías no requieren permisos ni controles?", "Why do these goods not need permits or controls?"),
  customs_operator_registration_status: e("¿En qué estado está tu registro como importador o exportador?", "What is the status of your registration as an importer or exporter?"),
  customs_preferential_origin_interest: e("¿Te interesa aprovechar un trato arancelario preferencial de acuerdos comerciales?", "Are you interested in using preferential tariff treatment under trade agreements?"),
  customs_agreement_countries: e("¿De qué países podrían aplicar acuerdos comerciales?", "Which countries' trade agreements might apply?"),
  customs_special_regimes_interest: e("¿Te interesa algún régimen aduanero especial? Puedes indicar más de uno.", "Are you interested in any special customs regime? You can name more than one."),
  customs_related_party_transactions: e("¿Las operaciones de comercio son entre empresas relacionadas?", "Are the trade transactions between related companies?"),
  customs_audit_history: e("¿Has tenido auditorías o revisiones aduaneras?", "Have you had any customs audits or reviews?"),
  customs_authorized_operator_status: e("¿En qué estado está tu certificación como operador confiable?", "What is the status of your trusted-trader certification?"),
  customs_documents_available: e("¿Qué documentos de comercio tienes ya disponibles?", "Which trade documents do you already have available?"),
  customs_compliance_review_scope: e("¿Qué debería cubrir la revisión de cumplimiento?", "What should the compliance review cover?"),
  customs_immex_program_status: e("¿En qué estado está tu participación en el programa IMMEX?", "What is the status of your participation in the IMMEX program?"),
  customs_prosec_interest: e("¿Te interesa explorar los programas sectoriales PROSEC?", "Are you interested in exploring the PROSEC sector programs?"),
  customs_mx_importers_registry_status: e("¿En qué estado está tu inscripción en el padrón de importadores?", "What is the status of your importers registry enrollment?"),
  customs_us_importer_of_record_status: e("¿Cómo planeas resolver la figura de importador de registro?", "How do you plan to arrange the importer of record?"),

  // ---------------------------------------------------------------- Corporate, Legal and Administrative
  legal_services_in_scope: e("¿Qué servicios corporativos y legales necesitas? Puedes indicar más de uno.", "Which corporate and legal services do you need? You can name more than one."),
  legal_entity_stage: e(
    "¿En qué etapa está tu entidad local?",
    "What stage is your local entity at?",
    "Esto define por dónde empezaría el trabajo de esta categoría.",
    "This sets where the work in this category would begin.",
  ),
  legal_entity_form_preference: e("¿Tienes una forma de entidad preferida?", "Do you have a preferred entity form?"),
  "legal_shareholder_structure.holder_type": e("¿El titular es una persona o una empresa?", "Is the holder a person or a company?"),
  "legal_shareholder_structure.holder_country": e("¿En qué país está el titular?", "Which country is the holder in?"),
  "legal_shareholder_structure.role": e("¿Qué papel tendría en la empresa local?", "What role would they have in the local company?"),
  "legal_shareholder_structure.ownership_share": e("¿Qué porcentaje de participación tendría?", "What ownership percentage would they have?"),
  legal_registered_address_status: e("¿Ya cuentas con un domicilio para la empresa local?", "Do you already have an address for the local company?"),
  legal_corporate_secretarial_need: e("¿Necesitas apoyo de secretaría corporativa, de forma continua o puntual?", "Do you need corporate secretarial support, on an ongoing or one-time basis?"),
  "legal_contract_workstreams.contract_type": e("¿Qué tipo de contrato es?", "What type of contract is it?"),
  "legal_contract_workstreams.counterparty_type": e("¿Con quién se firmaría?", "Who would sign it with you?"),
  "legal_contract_workstreams.governing_language": e("¿En qué idioma se redactaría?", "In which language would it be written?"),
  "legal_contract_workstreams.starting_point": e("¿Ya existe un borrador o se parte desde cero?", "Does a draft already exist, or are you starting from scratch?"),
  "legal_contract_workstreams.needed_by": e("¿Para cuándo lo necesitas?", "By when do you need it?"),
  legal_labor_legal_scope: e("¿Qué temas laborales necesitas cubrir?", "Which labor topics do you need covered?"),
  "legal_translation_needs.document_type": e("¿Qué documento hay que traducir?", "Which document needs to be translated?"),
  "legal_translation_needs.source_language": e("¿En qué idioma está?", "Which language is it in?"),
  "legal_translation_needs.target_language": e("¿A qué idioma se traduciría?", "Which language should it be translated into?"),
  "legal_translation_needs.certified_required": e("¿Necesitas una traducción certificada o jurada?", "Do you need a certified or sworn translation?"),
  "legal_translation_needs.pages_estimate": e("¿Cuántas páginas tiene, aproximadamente?", "Roughly how many pages does it have?"),
  "legal_translation_needs.needed_by": e("¿Para cuándo la necesitas?", "By when do you need it?"),
  "legal_apostille_needs.document_type": e("¿Qué documento hay que apostillar o legalizar?", "Which document needs an apostille or legalization?"),
  "legal_apostille_needs.issuing_country": e("¿Qué país lo emitió?", "Which country issued it?"),
  "legal_apostille_needs.use_country": e("¿En qué país se usará?", "In which country will it be used?"),
  "legal_apostille_needs.status": e("¿Ya tienes el original o todavía falta obtenerlo?", "Do you already have the original, or does it still need to be obtained?"),
  legal_data_privacy_scope: e("¿Qué datos personales tratará el proyecto? Puedes indicar más de uno.", "Which personal data will the project handle? You can name more than one."),
  "legal_ip_assets.asset_type": e("¿Qué tipo de activo es?", "What type of asset is it?"),
  "legal_ip_assets.asset_name": e("¿Cómo se llama o cómo lo describirías?", "What is it called, or how would you describe it?"),
  "legal_ip_assets.protection_status": e("¿Cuál es su estado de protección?", "What is its protection status?"),
  "legal_ip_assets.protection_countries": e("¿En qué países buscas protegerlo?", "In which countries do you want to protect it?"),
  legal_wind_down_scope: e("¿Qué alcance tendría el cierre?", "What would the scope of the closure be?"),
  legal_admin_support_scope: e("¿Qué tareas de apoyo administrativo necesitas?", "Which administrative support tasks do you need?"),

  // ---------------------------------------------------------------- Strategic Advisory
  sa_capabilities: e("¿Qué tipos de estudio o asesoría te interesan? Puedes indicar más de uno.", "Which kinds of study or advisory work interest you? You can name more than one."),
  "sa_studies.objective": e("¿Qué quieres lograr con este estudio o asesoría?", "What do you want to achieve with this study or advisory work?"),
  "sa_studies.question": e("¿Qué pregunta o hipótesis quieres resolver?", "Which question or hypothesis do you want to resolve?"),
  "sa_studies.subject_type": e("¿Qué quieres que analicemos? Por ejemplo, un producto, un mercado, un canal o la competencia.", "What do you want us to analyze? For example, a product, a market, a channel or the competition."),
  "sa_studies.subject_detail": e("¿Puedes darme más detalle de eso que quieres analizar?", "Could you give me more detail on what you want to analyze?"),
  "sa_studies.scope": e("¿Qué alcance tendría?", "What scope would it have?"),
  "sa_studies.markets": e("¿Para qué país o mercado sería?", "For which country or market would it be?"),
  "sa_studies.expected_result": e("¿Qué resultado esperas obtener?", "What result do you expect to get?"),
  "sa_studies.decisions": e("¿Qué decisión esperas tomar con ese resultado?", "What decision do you expect to make with that result?"),
  "sa_studies.timing": e("¿En qué plazo lo necesitas?", "In what timeframe do you need it?"),
  "sa_studies.context": e("¿Hay contexto relevante que debamos conocer?", "Is there relevant context we should know about?"),
  "sa_studies.available_info": e("¿Qué información tienes ya disponible?", "What information do you already have?"),
  "sa_studies.assumptions": e("¿Qué supuestos relevantes estás considerando?", "Which relevant assumptions are you making?"),

  // ---------------------------------------------------------------- Ecosystem Development
  "ed_engagements.partner_type": e("¿Qué tipo de socio buscas?", "What type of partner are you looking for?"),
  "ed_engagements.purpose": e("¿Para qué lo necesitas?", "What do you need them for?"),
  "ed_engagements.markets": e("¿En qué país o mercado?", "In which country or market?"),
  "ed_engagements.expected_role": e("¿Qué papel tendría ese socio?", "What role would that partner play?"),
  "ed_engagements.expected_result": e("¿Qué resultado esperas de esa relación?", "What result do you expect from that relationship?"),
  "ed_engagements.required_capabilities": e("¿Qué capacidades debería tener?", "Which capabilities should it have?"),
  "ed_engagements.geographic_scope": e("¿Qué alcance geográfico tendría?", "What geographic scope would it have?"),
  "ed_engagements.timing": e("¿En qué plazo lo necesitas?", "In what timeframe do you need it?"),
  "ed_engagements.restrictions": e("¿Hay restricciones que debamos considerar?", "Are there restrictions we should consider?"),
  "ed_engagements.criteria": e("¿Qué criterios son importantes para elegirlo?", "Which criteria matter when choosing?"),
  "ed_engagements.available_context": e("¿Qué contexto tienes ya disponible?", "What context do you already have?"),
  "ed_engagements.current_relationship": e("¿Ya tienes alguna relación con un posible socio?", "Do you already have a relationship with a possible partner?"),
};

/** Looks a question up by field key and sub-field key. Generic blocks share their sub-field questions. */
export function lookupQuestion(fieldKey: string, subKey?: string): QuestionEntry | undefined {
  if (subKey) {
    const own = QUESTIONS[`${fieldKey}.${subKey}`];
    if (own) return own;
    if (fieldKey.startsWith("generic_")) return GENERIC_SUBS[subKey];
    return undefined;
  }
  return QUESTIONS[fieldKey];
}

export function lookupGroup(fieldKey: string): GroupEntry | undefined {
  return GROUPS[fieldKey];
}

export function say(pair: Bilingual, locale: Locale): string {
  return pair[locale];
}
