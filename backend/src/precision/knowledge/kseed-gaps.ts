/**
 * The compact, prioritised plan for the KSeed gaps that V1 Feature Complete needs. One entry per required need; `renderV1GapList` turns
 * the entries that are still open into the list Product reviews. Everything in `suggestedSource` is a SUGGESTION for Product and The Hive
 * to confirm — none of it is approved, and Precision never researches it live. Product / The Hive supply or approve the material.
 */
import type { KSeedAssessment } from "./kseed-spec";

export type GapSupports = "understanding" | "category_depth" | "orientation" | "specialist_handoff";
export interface V1GapPlan {
  needId: string;
  /** 1 = first to close. Ordered by how many acceptance conversations and categories it unlocks, then by risk. */
  priority: number;
  /** Plain-language topic. */
  topic: string;
  whyPrecisionNeedsIt: string;
  exampleQuestion: string;
  /** What a conversation can do once covered. */
  enables: string;
  idealSourceType: string;
  /** Institution(s) proposed. ALWAYS rendered as "NO APROBADA TODAVÍA". */
  suggestedSource: string;
  /** The smallest knowledge unit that is enough for V1 (not a full legal treatise). */
  minimumV1: string;
  supports: GapSupports[];
  /** Who reviews the curated unit before it goes live (tier follows the review policy of the Knowledge Layer). */
  reviewer: string;
}

export const V1_GAP_PLAN: readonly V1GapPlan[] = [
  { needId: "mx.corporate.entity_types", priority: 1, topic: "Formas jurídicas para una empresa extranjera",
    whyPrecisionNeedsIt: "La decisión de la entidad abre todas las demás categorías (fiscal, laboral, aduanas); sin vocabulario correcto Precision no sabe qué preguntar.",
    exampleQuestion: "¿Qué es una S. de R.L. y en qué se diferencia de una S.A. de C.V.?",
    enables: "Explicar las formas habituales y qué preguntas conviene resolver antes de elegir; sin decir cuál conviene.",
    idealSourceType: "Normativa oficial primaria más unidades curadas por beeside", suggestedSource: "Ley General de Sociedades Mercantiles (DOF); Secretaría de Economía",
    minimumV1: "Una unidad curada por forma (S.A. de C.V., S. de R.L. de C.V., SAPI, sucursal): qué es, quién la suele usar, qué preguntas abre; con enlace a la norma.",
    supports: ["understanding", "category_depth", "specialist_handoff"], reviewer: "Socio legal de The Hive" },
  { needId: "mx.corporate.incorporation", priority: 2, topic: "Constitución y registro de la entidad",
    whyPrecisionNeedsIt: "El cliente fija su fecha de arranque según el tiempo de constitución; Precision debe poder hablar de la secuencia sin prometer plazos.",
    exampleQuestion: "¿Qué pasos tiene abrir la empresa y cuánto suele tardar?",
    enables: "Describir la secuencia general (denominación, escritura, registro, inscripción fiscal) y marcar qué depende del caso.",
    idealSourceType: "Guías oficiales de trámite", suggestedSource: "Secretaría de Economía / gob.mx; Registro Público de Comercio; guías de inscripción del SAT",
    minimumV1: "Una unidad con la secuencia general de pasos y qué se queda en manos de The Hive; sin plazos como compromiso.",
    supports: ["understanding", "orientation", "specialist_handoff"], reviewer: "Socio legal de The Hive" },
  { needId: "mx.tax.transfer_pricing", priority: 3, topic: "Precios de transferencia entre partes relacionadas",
    whyPrecisionNeedsIt: "Caso de aceptación: la matriz financia y factura a la filial; el cliente no sabe que existe una obligación de documentación.",
    exampleQuestion: "Mi matriz le va a facturar servicios a la filial, ¿hay algo especial que deba saber?",
    enables: "Reconocer que operaciones entre partes relacionadas tienen obligaciones de documentación y pasar a un especialista fiscal.",
    idealSourceType: "Normativa fiscal oficial más guía de la OCDE como contexto", suggestedSource: "SAT y Ley del Impuesto sobre la Renta (DOF); guías de la OCDE (solo contexto)",
    minimumV1: "Una unidad que diga que existe la obligación, a quién aplica en términos generales y qué información suele pedirse; sin cálculos.",
    supports: ["understanding", "specialist_handoff"], reviewer: "Socio fiscal de The Hive" },
  { needId: "mx.labor.hiring_model", priority: 4, topic: "Modelos de contratación",
    whyPrecisionNeedsIt: "Caso de aceptación: contratación directa más un tercero; la reforma de servicios especializados cambia lo que el cliente puede hacer.",
    exampleQuestion: "¿Puedo contratar a través de un tercero o debe ser todo directo?",
    enables: "Explicar los modelos (directo, tercero registrado, empleador de registro) y qué hay que preguntar; sin recomendar uno.",
    idealSourceType: "Normativa laboral oficial más unidades curadas", suggestedSource: "STPS; Ley Federal del Trabajo (DOF); guías del registro de servicios especializados",
    minimumV1: "Una unidad por modelo con la idea general y las preguntas que abre; marcando el criterio profesional como frontera.",
    supports: ["understanding", "category_depth", "specialist_handoff"], reviewer: "Socio laboral de The Hive" },
  { needId: "mx.social_security.imss", priority: 5, topic: "Registro patronal y seguridad social",
    whyPrecisionNeedsIt: "Todo patrón debe registrarse; el cliente debe saberlo antes de contratar y presupuestar cuotas.",
    exampleQuestion: "¿Tengo que dar de alta a mis trabajadores en el IMSS desde el primer día?",
    enables: "Explicar que existen registro patronal y cuotas, y qué información se necesita para planear el arranque de nómina.",
    idealSourceType: "Fuentes oficiales del sistema de seguridad social", suggestedSource: "IMSS; INFONAVIT; SAR/AFORE; DOF",
    minimumV1: "Una unidad sobre registro patronal y componentes generales de las cuotas, con enlace a la fuente oficial; sin importes.",
    supports: ["understanding", "category_depth", "specialist_handoff"], reviewer: "Socio laboral de The Hive" },
  { needId: "mx.immigration.work_visas", priority: 6, topic: "Condición migratoria para reubicar personal",
    whyPrecisionNeedsIt: "Caso de aceptación: parte del equipo del proyecto se reubica desde Portugal.",
    exampleQuestion: "Voy a enviar a cuatro directivos a México, ¿qué permiso necesitan?",
    enables: "Reconocer que reubicar personal exige condición migratoria y qué datos reunir; sin elegir la condición.",
    idealSourceType: "Autoridad migratoria", suggestedSource: "Instituto Nacional de Migración; gob.mx",
    minimumV1: "Una unidad con las categorías generales de condición de estancia para trabajo y las preguntas que abre (duración, rol, patrocinio).",
    supports: ["understanding", "specialist_handoff"], reviewer: "Socio legal de The Hive" },
  { needId: "mx.customs.regimes", priority: 7, topic: "Regímenes de importación y exportación",
    whyPrecisionNeedsIt: "Importadores, exportadores y manufactureros necesitan el vocabulario antes de que un especialista aduanero tome el caso.",
    exampleQuestion: "¿Qué es el IMMEX y cuándo se usa la importación temporal?",
    enables: "Explicar los regímenes habituales y qué preguntar sobre producto y destino de la mercancía.",
    idealSourceType: "Autoridad aduanera y normativa oficial", suggestedSource: "Agencia Nacional de Aduanas de México; guías aduaneras del SAT; Secretaría de Economía (IMMEX); DOF",
    minimumV1: "Una unidad por régimen principal (definitiva, temporal, IMMEX, depósito fiscal): para qué sirve y qué preguntas abre.",
    supports: ["understanding", "category_depth", "orientation", "specialist_handoff"], reviewer: "Socio de comercio exterior de The Hive" },
  { needId: "mx.logistics.ports", priority: 8, topic: "Puertos y cruces fronterizos principales",
    whyPrecisionNeedsIt: "Los clientes de logística llegan con nombres de puertos; hoy Precision solo reconoce el límite.",
    exampleQuestion: "¿Por qué se menciona tanto Manzanillo?",
    enables: "Explicar el papel general de los puertos y cruces sin afirmar cuál conviene a una operación.",
    idealSourceType: "Datos de autoridades portuarias más unidades curadas", suggestedSource: "Autoridades portuarias; SICT; ANAM; unidades curadas por beeside",
    minimumV1: "Una ficha corta por puerto o cruce principal (papel, tipo de carga que suele mover); sin ranking ni recomendación.",
    supports: ["understanding", "orientation", "category_depth"], reviewer: "Socio logístico de The Hive" },
  { needId: "mx.tax.vat", priority: 9, topic: "IVA básico y devoluciones",
    whyPrecisionNeedsIt: "El flujo de caja del IVA es una pregunta temprana estándar para importadores, exportadores y empresas de servicios.",
    exampleQuestion: "¿Cómo funciona el IVA cuando exporto?",
    enables: "Explicar el mecanismo general y que las devoluciones existen y tienen requisitos.",
    idealSourceType: "Normativa fiscal oficial", suggestedSource: "SAT; Ley del Impuesto al Valor Agregado (DOF)",
    minimumV1: "Una unidad con el mecanismo general (acreditamiento, tasa general, exportación) y la existencia de devoluciones; sin cálculos.",
    supports: ["understanding", "category_depth"], reviewer: "Socio fiscal de The Hive" },
  { needId: "mx.tax.income_tax", priority: 10, topic: "Impuesto sobre la renta empresarial",
    whyPrecisionNeedsIt: "Todo proyecto con entidad llega a lo fiscal; Precision debe hablar con el vocabulario correcto.",
    exampleQuestion: "¿Cómo tributa una filial extranjera en México?",
    enables: "Explicar en términos generales cómo funciona el impuesto y qué preguntar; sin conclusiones del caso.",
    idealSourceType: "Normativa fiscal oficial", suggestedSource: "SAT; Ley del Impuesto sobre la Renta (DOF)",
    minimumV1: "Una unidad con la idea general (sujetos, base, pagos provisionales) y la frontera profesional.",
    supports: ["understanding", "category_depth"], reviewer: "Socio fiscal de The Hive" },
  { needId: "mx.labor.mandatory_benefits", priority: 11, topic: "Prestaciones de ley",
    whyPrecisionNeedsIt: "Los clientes presupuestan solo el salario; la capa legal cambia el costo total de contratar.",
    exampleQuestion: "¿Qué debo sumar al salario además del pago mensual?",
    enables: "Reconocer que existen prestaciones de ley y que el costo total no es el salario; sin cifras.",
    idealSourceType: "Normativa laboral oficial", suggestedSource: "STPS; Ley Federal del Trabajo (DOF)",
    minimumV1: "Una unidad que nombre las prestaciones de ley principales y diga que su monto depende del caso.",
    supports: ["understanding", "category_depth"], reviewer: "Socio laboral de The Hive" },
  { needId: "mx.corporate.foreign_ownership", priority: 12, topic: "Inversión extranjera y sectores restringidos",
    whyPrecisionNeedsIt: "Algunos sectores tienen reglas específicas; hay que preguntarlas pronto para no construir sobre un supuesto falso.",
    exampleQuestion: "¿Una empresa extranjera puede ser dueña del cien por ciento en mi sector?",
    enables: "Reconocer que hay sectores con reglas de participación extranjera y pasar a un especialista.",
    idealSourceType: "Normativa oficial y registro de inversión extranjera", suggestedSource: "Ley de Inversión Extranjera (DOF); Secretaría de Economía (registro nacional de inversiones extranjeras)",
    minimumV1: "Una unidad que diga que existen sectores con límites o autorización y qué dato del proyecto lo determina (sector, actividad).",
    supports: ["understanding", "specialist_handoff"], reviewer: "Socio legal de The Hive" },
];

const ES_SUPPORT: Record<GapSupports, string> = { understanding: "comprensión", category_depth: "profundidad de categoría", orientation: "orientación", specialist_handoff: "paso al especialista" };
const ES_RISK: Record<string, string> = { high: "alto", medium: "medio", low: "bajo" };
const ES_STATUS: Record<string, string> = { missing: "sin material", partial: "parcial", covered: "cubierto" };

/** The 12 open V1 gaps, in priority order, as the compact list Product reviews. Only needs still not covered appear. */
export function renderV1GapList(assessment: KSeedAssessment[]): string {
  const by = new Map(assessment.map((a) => [a.need.id, a]));
  const open = V1_GAP_PLAN.filter((p) => { const a = by.get(p.needId); return a && a.status !== "covered"; }).sort((a, b) => a.priority - b.priority);
  const l: string[] = [`# Brechas abiertas de KSeed para V1`, ``, `Lista priorizada de lo que V1 Feature Complete necesita y todavía no está cubierto (${open.length}). Las instituciones son sugerencias: **NO APROBADAS TODAVÍA**. Precision no investiga estas brechas en vivo; Producto y The Hive aportan o aprueban el material. El conocimiento orienta; la decisión del caso sigue siendo trabajo de The Hive.`, ``];
  for (const p of open) {
    const a = by.get(p.needId)!;
    l.push(`## ${p.priority}. ${p.topic} (${p.needId})`);
    l.push(`- Estado: ${ES_STATUS[a.status]}. Riesgo: ${ES_RISK[a.need.risk]}.`);
    l.push(`- Por qué lo necesita Precision: ${p.whyPrecisionNeedsIt}`);
    l.push(`- Pregunta o conversación que habilita: «${p.exampleQuestion}» — ${p.enables}`);
    l.push(`- Tipo de fuente ideal: ${p.idealSourceType}.`);
    l.push(`- Fuente sugerida (NO APROBADA TODAVÍA): ${p.suggestedSource}.`);
    l.push(`- Mínimo necesario para V1: ${p.minimumV1}`);
    l.push(`- Sostiene: ${p.supports.map((s) => ES_SUPPORT[s]).join(", ")}. Revisa: ${p.reviewer}.`, ``);
  }
  return l.join("\n");
}
