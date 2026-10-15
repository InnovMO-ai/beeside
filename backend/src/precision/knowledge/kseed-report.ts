/**
 * KSeed status and gap report (Spanish, business-first). Pure rendering over the assessment, the ingested documents, the registered
 * country resources and the observed knowledge demand. It reads internal data only.
 */
import type { StoredDemand } from "./demand";
import type { KSeedAssessment, KSeedStatus } from "./kseed-spec";
import type { CountryResource } from "./country-resources";
import type { KnowledgeDocument, KnowledgeSource } from "./types";

/** Editions known to exist but not necessarily ingested (observed by Product; the Knowledge Agent / a person ingests them). */
export const KNOWN_EDITIONS: { sourceId: string; edition: string; observed: string; note: string }[] = [
  { sourceId: "imco-ice", edition: "2026", observed: "2026-10-14", note: "El sitio de IMCO ya muestra el ICE 2026; la arquitectura lo incorpora como versión nueva que sustituye a la 2025." },
];

export interface KSeedReportInput {
  generatedAt: string;
  assessment: KSeedAssessment[];
  documents: { doc: KnowledgeDocument; source: KnowledgeSource }[];
  resources: CountryResource[];
  demand: StoredDemand[];
}

const ES_STATUS: Record<KSeedStatus, string> = { covered: "Cubierto", partial: "Parcial", missing: "Falta" };
const ES_RISK: Record<string, string> = { high: "alto", medium: "medio", low: "bajo" };
const ES_V1 = { required: "Necesario para V1", can_wait: "Puede esperar" } as const;
const ES_AUTH: Record<string, string> = { official_primary: "oficial primaria", trusted_institutional: "institucional confiable", beeside_curated: "curada por beeside", secondary: "secundaria" };
const cell = (s: string): string => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

export function hasDoingBusinessResource(resources: CountryResource[]): boolean {
  return resources.some((r) => r.countryCode === "MX" && r.active && /doing business in mexico/i.test(r.title));
}

export function renderGapReport(i: KSeedReportInput): string {
  const a = i.assessment;
  const count = (s: KSeedStatus, v1?: "required" | "can_wait"): number => a.filter((x) => x.status === s && (!v1 || x.need.v1 === v1)).length;
  const required = a.filter((x) => x.need.v1 === "required");
  const requiredOpen = required.filter((x) => x.status !== "covered");
  const l: string[] = [];

  l.push(`# KSeed — estado y brechas`, ``, `Generado el ${i.generatedAt.slice(0, 10)}. Todo lo que aparece aquí sale de material aprobado e ingerido; Precision no busca en la web durante las conversaciones.`, ``);
  l.push(`## Resumen`, ``);
  l.push(`KSeed cubre hoy ${count("covered")} de ${a.length} necesidades de conocimiento definidas para México (${count("partial")} parciales, ${count("missing")} sin material). De las ${required.length} necesarias para V1 Feature Complete, ${required.length - requiredOpen.length} están cubiertas y ${requiredOpen.length} siguen abiertas.`);
  l.push(``, `La lectura de negocio: lo que hoy sostiene bien a Precision es el contexto estatal (competitividad, mercado laboral, infraestructura) gracias al ICE de IMCO. Lo que todavía no tiene es la capa de obligaciones (corporativo, fiscal, laboral y de seguridad social, aduanas y migración): no hay ninguna fuente oficial primaria ingerida, así que Precision reconoce el límite, sigue el diagnóstico, registra la demanda y enruta al especialista de The Hive, sin improvisar.`, ``);

  l.push(`## Qué contiene KSeed hoy`, ``);
  if (i.documents.length === 0) l.push(`Todavía no hay documentos ingeridos en este entorno.`, ``);
  else {
    l.push(`| Fuente | Documento | Edición | Autoridad | Temas |`, `|---|---|---|---|---|`);
    for (const { doc, source } of i.documents) l.push(`| ${cell(source.institution)} | ${cell(doc.title)} | ${doc.edition} (v${doc.version}) | ${ES_AUTH[source.authority] ?? source.authority} | ${cell(doc.topics.join(", "))} |`);
    l.push(``);
  }
  const dbm = hasDoingBusinessResource(i.resources);
  l.push(`Guía país para clientes: ${dbm ? "«Doing business in Mexico» ya está registrada como recurso de México." : "«Doing business in Mexico» aún no está registrada; falta el PDF final de beeside (ver «Qué necesitamos de ti»)."}`, ``);
  for (const k of KNOWN_EDITIONS) {
    const have = i.documents.some((d) => d.doc.sourceId === k.sourceId && d.doc.edition === k.edition && d.doc.status === "active");
    if (!have) l.push(`Edición pendiente: ${k.sourceId} ${k.edition}. ${k.note}`, ``);
  }

  l.push(`## Matriz de cobertura`, ``, `| Id | Tema / subtema | Categorías | Tipo | Estado | V1 |`, `|---|---|---|---|---|---|`);
  for (const x of a) l.push(`| ${x.need.id} | ${x.need.topic} / ${x.need.subtopic} | ${x.need.categories.join(", ")} | ${x.need.kind === "obligation" ? "obligaciones (fuente oficial)" : "contexto"} | ${ES_STATUS[x.status]} | ${ES_V1[x.need.v1]} |`);
  l.push(``);

  const gaps = a.filter((x) => x.status !== "covered").sort((p, q) => Number(q.need.v1 === "required") - Number(p.need.v1 === "required") || (q.need.risk === "high" ? 1 : 0) - (p.need.risk === "high" ? 1 : 0));
  l.push(`## Brechas, una por una`, ``, `Cada brecha dice qué falta, por qué Precision lo necesita, a qué país, tema y categoría pertenece, qué tipo de fuente es la ideal, el riesgo y si V1 Feature Complete lo exige. Las fuentes ideales son sugerencias para que Producto y The Hive las confirmen; ninguna queda aprobada por estar aquí.`, ``);
  for (const g of gaps) {
    const n = g.need;
    l.push(`### ${n.id} — ${ES_STATUS[g.status]}`);
    l.push(`Qué falta: ${g.note}`);
    l.push(`Qué permitiría a Precision: ${n.enables}`);
    l.push(`Por qué lo necesita Precision: ${n.why}`);
    l.push(`País, tema y categoría: ${n.country}; ${n.topic} / ${n.subtopic}; ${n.categories.join(", ")}.`);
    l.push(`Fuente ideal: ${n.idealSource}.`);
    l.push(`Riesgo: ${ES_RISK[n.risk]}. ${ES_V1[n.v1]}. Cuando esté cubierto, seguirá siendo trabajo de The Hive: ${n.staysWithHive}`, ``);
  }

  l.push(`## Frontera profesional`, ``, `El conocimiento orienta y ayuda a hacer mejores preguntas; no sustituye el trabajo profesional de The Hive. Precision puede explicar el papel general de Manzanillo, pero no afirma que sea la mejor opción para una operación concreta; lo mismo vale para conclusiones fiscales, opiniones legales, asesoría laboral, optimización logística, comparaciones de mercado de entrada y recomendaciones de inversión. Cuando alguien las pide, Precision da el contexto aprobado que exista, dice dónde termina y lo deja anotado para el especialista.`, ``);

  l.push(`## Demanda de conocimiento observada`, ``);
  if (i.demand.length === 0) l.push(`Aún no hay preguntas sin cobertura registradas. Cada una se guarda normalizada (país, tema, subtema, categoría, tipo de información, cobertura), sin texto del cliente ni datos personales; la recurrencia informa la decisión de una persona y nunca publica nada sola.`, ``);
  else {
    l.push(`| País | Tema / subtema | Categoría | Tipo de información | Cobertura | Veces | Proyectos | Destino | Estado |`, `|---|---|---|---|---|---|---|---|---|`);
    for (const d of i.demand.slice(0, 20)) l.push(`| ${d.country} | ${d.topic} / ${d.subtopic} | ${d.categoryKey ?? "-"} | ${d.infoType} | ${d.coverage === "partial" ? "parcial" : "ausente"} | ${d.occurrences} | ${d.projects} | ${d.disposition === "specialist_service" ? "servicio de especialista" : "posible conocimiento futuro"} | ${d.status} |`);
    l.push(``);
  }

  l.push(`## Qué necesitamos de ti`, ``);
  const asks: string[] = [];
  if (!dbm) asks.push(`El PDF final de «Doing business in Mexico»: la URL pública HTTPS para registrarlo como recurso del país y, si lo autorizas, el archivo para ingerirlo como material curado por beeside y que Precision pueda orientar con su contenido.`);
  for (const k of KNOWN_EDITIONS) if (!i.documents.some((d) => d.doc.sourceId === k.sourceId && d.doc.edition === k.edition)) asks.push(`Los archivos del ICE ${k.edition} de IMCO (o su enlace descargable) para sustituir la edición 2025.`);
  if (requiredOpen.some((x) => x.need.kind === "obligation")) asks.push(`La capa de obligaciones es la brecha mayor. Necesitamos que The Hive confirme las fuentes oficiales a curar (SAT y DOF, STPS e IMSS, Secretaría de Economía, INM, ANAM) y designe a quién de The Hive revisa las unidades curadas por área (legal, fiscal, laboral, aduanas, logística). Con eso preparamos las unidades y las ingerimos como material curado que remite a la fuente oficial.`);
  asks.push(`Confirmar si V1 se queda solo con México. Para cualquier otro país, Precision hoy reconoce el límite y registra la demanda; la demanda observada dirá qué país conviene sembrar después.`);
  l.push(...asks.map((t, n) => `${n + 1}. ${t}`), ``);
  return l.join("\n");
}
