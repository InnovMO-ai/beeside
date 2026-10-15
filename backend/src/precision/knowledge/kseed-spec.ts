/**
 * KSeed — the initial Knowledge Seed: the prepared, reusable, INTERNAL cache Precision consumes during customer conversations.
 *
 * This file is the explicit statement of what KSeed must contain for Precision to orient at consulting depth (an expectation, reviewed by
 * Product and The Hive), and `assessKSeed` compares it against what is actually ingested. The difference is the gap report: what is
 * missing, why Precision needs it, country/topic/category, the ideal source type, the risk, and whether V1 Feature Complete needs it.
 *
 * The frozen boundary: KSeed is built from supplied, approved materials. It is never authorization for live web search. The long-term
 * source of truth is the Knowledge Layer, kept up to date by a separate Knowledge Agent; Precision only reads the approved result.
 */
import { classifySubtopic } from "./demand";
import { retrieve } from "./retrieve";
import type { AuthorityLevel, Granularity, KnowledgeRepository, RiskClass, Topic } from "./types";

/** context: orientation that may be grounded on institutional analysis. obligation: statements about what the law/regulator requires (official primary sources only). */
export type NeedKind = "context" | "obligation";
export type KSeedStatus = "covered" | "partial" | "missing";

export interface KSeedNeed {
  id: string;
  country: string;
  topic: Topic;
  /** A subtopic of the controlled vocabulary, or "*" when any passage on the topic serves. */
  subtopic: string;
  categories: string[];
  kind: NeedKind;
  /** What Precision can do once this is covered (in client terms). */
  enables: string;
  /** Why it matters for the consulting conversation. */
  why: string;
  /** The ideal source TYPE (institutions are suggestions for Product/Hive to confirm, not approvals). */
  idealSource: string;
  risk: RiskClass;
  /** required: V1 Feature Complete needs it. can_wait: valuable, but Precision can recognise the limit and route to a specialist meanwhile. */
  v1: "required" | "can_wait";
  /** The professional work that stays with The Hive even when this is covered. */
  staysWithHive: string;
  /** Overrides which source authorities may cover the need (default: official primary for obligations; official, institutional and curated for context). */
  acceptAuthority?: AuthorityLevel[];
}

const MX = "MX";
/** Sources that may serve a country-level need that state-level institutional analysis cannot (the ICE speaks about states, not about what a port is). */
const COUNTRY_LEVEL: AuthorityLevel[] = ["official_primary", "beeside_curated"];
export const KSEED_SPEC: readonly KSeedNeed[] = [
  // ---------------------------------------------------------------- contexto de análisis institucional (IMCO y equivalentes)
  { id: "mx.competitiveness.state", country: MX, topic: "competitiveness_state", subtopic: "*", categories: ["industrial_real_estate", "corporate_real_estate", "market_intelligence"], kind: "context",
    enables: "Explicar cómo se comparan los estados de México en competitividad, nombrando la fuente y la edición.", why: "La ubicación es la primera pregunta de casi todo proyecto; el cliente necesita criterios y contexto comparable antes de que un especialista acote.",
    idealSource: "Índice de Competitividad Estatal (IMCO), edición vigente", risk: "medium", v1: "required", staysWithHive: "Elegir la ubicación de una operación concreta." },
  { id: "mx.labor.availability", country: MX, topic: "labor_market", subtopic: "*", categories: ["people_payroll_employment", "industrial_real_estate"], kind: "context",
    enables: "Orientar sobre el mercado laboral por estado cuando el proyecto planea contratar a mucha gente.", why: "Un plan de 60 o 150 contrataciones cambia dónde y cómo debe mirar el cliente; Precision debe preguntarlo con contexto.",
    idealSource: "ICE (IMCO); después ENOE de INEGI y estadísticas de empleo del IMSS", risk: "medium", v1: "required", staysWithHive: "Dimensionar y abastecer la plantilla." },
  { id: "mx.infrastructure.state", country: MX, topic: "infrastructure", subtopic: "*", categories: ["logistics", "industrial_real_estate"], kind: "context",
    enables: "Orientar sobre infraestructura (carreteras, conectividad, servicios) por estado.", why: "Las conversaciones de logística y de sitio industrial dependen de lo que el estado puede sostener.",
    idealSource: "ICE (IMCO)", risk: "medium", v1: "required", staysWithHive: "Factibilidad del sitio y debida diligencia de servicios." },
  { id: "mx.rule_of_law.state", country: MX, topic: "rule_of_law", subtopic: "*", categories: ["market_intelligence", "corporate_real_estate"], kind: "context",
    enables: "Orientar sobre seguridad y estado de derecho por estado.", why: "Los clientes preguntan por seguridad y cumplimiento de contratos al elegir dónde operar.",
    idealSource: "ICE (IMCO)", risk: "medium", v1: "can_wait", staysWithHive: "Evaluación de riesgo de un sitio específico." },
  { id: "mx.wages.benchmarks", country: MX, topic: "wages", subtopic: "salary_benchmarks", categories: ["people_payroll_employment"], kind: "context",
    enables: "Dar el orden de magnitud de salarios por estado y perfil, como contexto.", why: "Presupuestar una contratación es lo primero que intentan los clientes; sin datos, Precision solo puede enrutar.",
    idealSource: "ENOE de INEGI y estadísticas salariales del IMSS; indicadores salariales de IMCO", risk: "medium", v1: "can_wait", staysWithHive: "Diseño de compensación y referencias salariales por puesto." },
  { id: "mx.education.talent", country: MX, topic: "education_talent", subtopic: "*", categories: ["people_payroll_employment", "market_intelligence"], kind: "context",
    enables: "Orientar sobre la oferta de talento (egresados, escolaridad) por estado.", why: "Los proyectos de talento técnico necesitan saber si existe la cantera.",
    idealSource: "ICE (IMCO); estadísticas de egresados de ANUIES", risk: "low", v1: "can_wait", staysWithHive: "Búsqueda de talento y marca empleadora." },

  // ---------------------------------------------------------------- corporativo y legal (obligaciones: fuentes oficiales, curadas con The Hive)
  { id: "mx.corporate.entity_types", country: MX, topic: "corporate_law", subtopic: "entity_types", categories: ["corporate_legal_admin"], kind: "obligation",
    enables: "Explicar las formas jurídicas principales que puede usar una empresa extranjera en México (subsidiaria o sucursal; S.A. de C.V., S. de R.L., SAPI) para que el cliente haga las preguntas correctas.", why: "Caso de aceptación obligatorio (empresa portuguesa): la decisión de la entidad abre todas las demás categorías.",
    idealSource: "Fuentes oficiales primarias (Ley General de Sociedades Mercantiles, Secretaría de Economía) más unidades curadas por beeside y revisadas por el socio legal de The Hive", risk: "high", v1: "required", staysWithHive: "Recomendar la forma de la entidad y estructurarla." },
  { id: "mx.corporate.incorporation", country: MX, topic: "corporate_law", subtopic: "incorporation_steps", categories: ["corporate_legal_admin"], kind: "obligation",
    enables: "Describir la secuencia general y los tiempos para constituir y registrar una empresa.", why: "Los clientes planean su fecha de arranque alrededor del tiempo de constitución.",
    idealSource: "Secretaría de Economía / gob.mx, Registro Público de Comercio, guías de inscripción del SAT", risk: "high", v1: "required", staysWithHive: "Ejecutar la constitución." },
  { id: "mx.corporate.foreign_ownership", country: MX, topic: "foreign_investment", subtopic: "foreign_ownership", categories: ["corporate_legal_admin"], kind: "obligation",
    enables: "Explicar a nivel de orientación las reglas de inversión extranjera (sectores restringidos, registro de la inversión extranjera).", why: "Algunos sectores (entre ellos energía) tienen reglas específicas; hay que preguntarlas pronto.",
    idealSource: "Ley de Inversión Extranjera, Secretaría de Economía (RNIE), DOF", risk: "high", v1: "required", staysWithHive: "Opinión legal sobre el sector y la estructura del cliente." },

  // ---------------------------------------------------------------- fiscal
  { id: "mx.tax.income_tax", country: MX, topic: "taxes", subtopic: "income_tax", categories: ["tax_accounting_audit"], kind: "obligation",
    enables: "Explicar en términos generales cómo funciona el impuesto sobre la renta empresarial, para que el cliente entienda qué preguntar.", why: "Todo proyecto con entidad llega a lo fiscal; Precision debe hablar con el vocabulario correcto.",
    idealSource: "SAT, Ley del Impuesto sobre la Renta (DOF), unidades curadas por beeside", risk: "high", v1: "required", staysWithHive: "Conclusiones y planeación fiscal del caso del cliente." },
  { id: "mx.tax.vat", country: MX, topic: "taxes", subtopic: "vat", categories: ["tax_accounting_audit"], kind: "obligation",
    enables: "Explicar a nivel de orientación el IVA básico y sus devoluciones.", why: "El flujo de caja del IVA es una pregunta temprana estándar para importadores, exportadores y empresas de servicios.",
    idealSource: "SAT, Ley del IVA (DOF)", risk: "high", v1: "required", staysWithHive: "Tratamiento del IVA y gestión de devoluciones." },
  { id: "mx.tax.transfer_pricing", country: MX, topic: "taxes", subtopic: "transfer_pricing", categories: ["tax_accounting_audit"], kind: "obligation",
    enables: "Explicar que las operaciones entre partes relacionadas tienen obligaciones de documentación y qué preguntar.", why: "Caso de aceptación obligatorio: la matriz financia y factura a la filial.",
    idealSource: "SAT, disposiciones de precios de transferencia de la LISR (DOF); guías de la OCDE como contexto", risk: "high", v1: "required", staysWithHive: "Política y documentación de precios de transferencia." },
  { id: "mx.tax.withholding", country: MX, topic: "taxes", subtopic: "withholding", categories: ["tax_accounting_audit"], kind: "obligation",
    enables: "Explicar que los pagos al extranjero (dividendos, regalías, servicios, intereses) pueden tener retención.", why: "El financiamiento transfronterizo y las cuotas de gestión son comunes en proyectos de expansión.",
    idealSource: "SAT, LISR (DOF); textos de los tratados (ver la entrada del tratado México–Portugal)", risk: "high", v1: "can_wait", staysWithHive: "Análisis de retenciones y de tratados." },
  { id: "mx.tax.registration", country: MX, topic: "taxes", subtopic: "tax_registration", categories: ["tax_accounting_audit", "corporate_legal_admin"], kind: "obligation",
    enables: "Explicar a nivel de orientación la inscripción fiscal y la facturación electrónica.", why: "La inscripción condiciona operar, facturar y contratar.",
    idealSource: "Guías del SAT (RFC, e.firma, facturación electrónica)", risk: "high", v1: "can_wait", staysWithHive: "Inscripción y puesta en marcha del cumplimiento." },
  { id: "mx.treaty.pt-mx", country: "INT", topic: "taxes", subtopic: "withholding", categories: ["tax_accounting_audit"], kind: "obligation",
    enables: "Reconocer que puede aplicar un tratado fiscal entre el país de la matriz y México.", why: "Caso de aceptación obligatorio: flujos Portugal–México.",
    idealSource: "Textos oficiales de los tratados (SAT y publicaciones de tratados), país por país", risk: "high", v1: "can_wait", staysWithHive: "Análisis de beneficios de tratado." },

  // ---------------------------------------------------------------- laboral y seguridad social
  { id: "mx.labor.hiring_model", country: MX, topic: "labor_market", subtopic: "hiring_model", categories: ["people_payroll_employment"], kind: "obligation",
    enables: "Explicar a nivel de orientación los modelos de contratación (directa, terceros con sus requisitos de registro, empleador de registro).", why: "Caso de aceptación obligatorio: contratación directa más un tercero; importa la reforma de servicios especializados.",
    idealSource: "STPS, Ley Federal del Trabajo (DOF), guías del REPSE, unidades curadas por beeside", risk: "high", v1: "required", staysWithHive: "Elegir y estructurar el modelo de contratación." },
  { id: "mx.labor.mandatory_benefits", country: MX, topic: "wages", subtopic: "mandatory_benefits", categories: ["people_payroll_employment"], kind: "obligation",
    enables: "Explicar que existen prestaciones de ley (aguinaldo, prima vacacional, reparto de utilidades) para no subestimar presupuestos.", why: "Los clientes presupuestan solo el salario; la capa legal cambia el costo total.",
    idealSource: "STPS, Ley Federal del Trabajo (DOF)", risk: "high", v1: "required", staysWithHive: "Diseño de compensación y prestaciones." },
  { id: "mx.social_security.imss", country: MX, topic: "social_security", subtopic: "imss_registration", categories: ["people_payroll_employment"], kind: "obligation",
    enables: "Explicar a nivel de orientación el registro patronal y las cuotas.", why: "Todo patrón debe registrarse; el cliente debe saberlo antes de contratar.",
    idealSource: "IMSS, INFONAVIT, SAR/AFORE (oficiales), DOF", risk: "high", v1: "required", staysWithHive: "Registro y puesta en marcha de nómina." },
  { id: "mx.immigration.work_visas", country: MX, topic: "immigration_mobility", subtopic: "work_visas", categories: ["people_payroll_employment", "corporate_legal_admin"], kind: "obligation",
    enables: "Explicar que reubicar personal requiere condición migratoria y qué preguntar.", why: "Caso de aceptación obligatorio: parte del equipo del proyecto se reubica.",
    idealSource: "Instituto Nacional de Migración, gob.mx", risk: "high", v1: "required", staysWithHive: "Trámites migratorios y elección de la condición de estancia." },

  // ---------------------------------------------------------------- comercio exterior, aduanas y logística
  { id: "mx.customs.regimes", country: MX, topic: "customs", subtopic: "duty_regimes", categories: ["international_trade_customs", "logistics"], kind: "obligation",
    enables: "Explicar a nivel de orientación los regímenes de importación y exportación (importación temporal, regímenes fiscalizados) y qué preguntar.", why: "Exportadores, importadores y manufactureros necesitan el vocabulario antes de que un especialista aduanero tome el caso.",
    idealSource: "Agencia Nacional de Aduanas de México (ANAM), guías aduaneras del SAT, Secretaría de Economía (IMMEX), DOF", risk: "high", v1: "required", staysWithHive: "Selección de régimen y cumplimiento aduanero." },
  { id: "mx.customs.classification", country: MX, topic: "customs", subtopic: "tariff_classification", categories: ["international_trade_customs"], kind: "obligation",
    enables: "Explicar la clasificación arancelaria y por qué se fija por producto.", why: "Aranceles, permisos y origen dependen de ella.",
    idealSource: "Tarifa oficial (TIGIE, DOF) y criterios de la ANAM", risk: "high", v1: "can_wait", staysWithHive: "Clasificar los productos del cliente." },
  { id: "mx.trade.agreements", country: MX, topic: "exports_trade", subtopic: "trade_agreements", categories: ["international_trade_customs"], kind: "obligation",
    enables: "Explicar que los tratados comerciales y las reglas de origen pueden afectar aranceles y qué preguntar.", why: "El caso del exportador de café y cualquier flujo hacia Norteamérica dependen de ellos.",
    idealSource: "Secretaría de Economía (tratados comerciales), textos oficiales de los tratados", risk: "high", v1: "can_wait", staysWithHive: "Determinación de origen y estrategia de preferencias." },
  { id: "mx.logistics.ports", country: MX, topic: "transportation_logistics", subtopic: "ports_and_borders", categories: ["logistics", "international_trade_customs"], kind: "context", acceptAuthority: COUNTRY_LEVEL,
    enables: "Explicar el papel general de los puertos y cruces fronterizos principales (por ejemplo, por qué se conoce Manzanillo) sin decir cuál es mejor para una operación específica.", why: "Los clientes de logística llegan con nombres de puertos; Precision debe entender y orientar, y luego preguntar por su carga y sus flujos.",
    idealSource: "Autoridades portuarias, estadísticas de SICT y ANAM, unidades curadas por beeside revisadas por el socio logístico de The Hive", risk: "medium", v1: "required", staysWithHive: "Selección de puerto y ruta, optimización de costo y tránsito." },
  { id: "mx.logistics.freight", country: MX, topic: "transportation_logistics", subtopic: "freight_costs", categories: ["logistics"], kind: "context", acceptAuthority: COUNTRY_LEVEL,
    enables: "Dar rangos y factores del costo de flete, como contexto.", why: "Las conversaciones de presupuesto empiezan aquí.",
    idealSource: "Reportes de la industria y estadísticas de cámaras (CANACAR, autoridades portuarias)", risk: "medium", v1: "can_wait", staysWithHive: "Cotizaciones y diseño de la red logística." },

  // ---------------------------------------------------------------- inmobiliario, incentivos y banca
  { id: "mx.realestate.industrial", country: MX, topic: "infrastructure", subtopic: "industrial_parks", categories: ["industrial_real_estate"], kind: "context", acceptAuthority: [...COUNTRY_LEVEL, "secondary"],
    enables: "Explicar cómo se organiza el mercado de parques industriales y qué guía la elección del sitio.", why: "Los proyectos de sitio industrial necesitan vocabulario y criterios antes de una búsqueda.",
    idealSource: "AMPIP (asociación de parques industriales), reportes de mercado de consultoras inmobiliarias", risk: "medium", v1: "can_wait", staysWithHive: "Búsqueda de sitio, negociación y debida diligencia." },
  { id: "mx.investment.incentives", country: MX, topic: "foreign_investment", subtopic: "investment_incentives", categories: ["corporate_legal_admin", "tax_accounting_audit"], kind: "obligation",
    enables: "Reconocer que existen programas de incentivos federales y estatales y qué preguntas los destraban.", why: "Los clientes preguntan por incentivos desde el inicio; cambian seguido, así que Precision no debe improvisar.",
    idealSource: "Secretaría de Economía, agencias estatales de desarrollo económico, DOF", risk: "high", v1: "can_wait", staysWithHive: "Elegibilidad y solicitud de incentivos." },
  { id: "mx.finance.banking", country: MX, topic: "financial_access", subtopic: "general", categories: ["banking_finance_insurance"], kind: "obligation",
    enables: "Explicar a nivel de orientación cómo una empresa de capital extranjero abre cuentas y mueve capital.", why: "Caso de aceptación obligatorio: la matriz financia a la filial.",
    idealSource: "Publicaciones de Banxico y CNBV; requisitos de apertura de los bancos", risk: "high", v1: "can_wait", staysWithHive: "Apertura bancaria y estructuración de la aportación de capital." },
] as const;

// ------------------------------------------------------------------ assessment
export interface KSeedEvidence { documentTitle: string; edition: string; institution: string; authority: AuthorityLevel; passages: number; /** coarsest geographic level among the supporting passages (state => every supporting passage is state-level) */ granularity: Granularity }
export interface KSeedAssessment { need: KSeedNeed; status: KSeedStatus; evidence: KSeedEvidence[]; note: string }

const RANK: Record<Granularity, number> = { country: 0, sector: 0, none: 0, state: 1, municipality: 2, city: 2 };
const OBLIGATION_OK: AuthorityLevel[] = ["official_primary"];
const CONTEXT_OK: AuthorityLevel[] = ["official_primary", "trusted_institutional", "beeside_curated"];

/** Compares the spec with what is actually ingested (active documents, by source authority and passage content). Deterministic; no network. */
export async function assessKSeed(repo: KnowledgeRepository, spec: readonly KSeedNeed[] = KSEED_SPEC): Promise<KSeedAssessment[]> {
  const out: KSeedAssessment[] = [];
  for (const need of spec) {
    const hits = (await retrieve(repo, { topics: [need.topic], jurisdiction: need.country, limit: 300 })).filter((h) => h.passage.topics.includes(need.topic) && h.provenance.documentStatus === "active");
    const onSubtopic = need.subtopic === "*" ? hits : hits.filter((h) => classifySubtopic(h.passage.text, need.topic) === need.subtopic);
    const group = (list: typeof hits, ok: AuthorityLevel[]): KSeedEvidence[] => {
      const by = new Map<string, KSeedEvidence>();
      for (const h of list.filter((x) => ok.includes(x.provenance.authority))) {
        const k = `${h.provenance.documentTitle}|${h.provenance.edition}`;
        const e = by.get(k) ?? { documentTitle: h.provenance.documentTitle, edition: h.provenance.edition, institution: h.provenance.institution, authority: h.provenance.authority, passages: 0, granularity: h.passage.granularity };
        e.passages += 1;
        if (RANK[h.passage.granularity] < RANK[e.granularity]) e.granularity = h.passage.granularity;
        by.set(k, e);
      }
      return [...by.values()];
    };
    const accept = need.acceptAuthority ?? (need.kind === "obligation" ? OBLIGATION_OK : CONTEXT_OK);
    const full = group(onSubtopic, accept);
    if (full.length) {
      const stateOnly = full.every((e) => e.granularity === "state");
      out.push({ need, status: "covered", evidence: full, note: stateOnly ? "Cubierto con fuentes aprobadas, solo a nivel estatal." : "Cubierto con fuentes aprobadas." });
      continue;
    }
    // something exists on this very subtopic, but not from a source with the authority the need requires
    const partial = group(onSubtopic, ["official_primary", "trusted_institutional", "beeside_curated", "secondary"]);
    if (partial.length) {
      out.push({ need, status: "partial", evidence: partial, note: need.kind === "obligation"
        ? "Hay contexto institucional sobre el tema, pero ninguna fuente oficial primaria que permita hablar de obligaciones."
        : "Hay material sobre el tema, pero no de una fuente con el nivel o la autoridad requeridos." });
      continue;
    }
    out.push({ need, status: "missing", evidence: [], note: "No hay material aprobado sobre este tema." });
  }
  return out;
}
