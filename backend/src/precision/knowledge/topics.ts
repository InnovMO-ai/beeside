/** Topic classification for passages and queries. Keyword-based baseline; same vocabulary is used for question-drivers. */
import { fold } from "../understanding/text";
import type { Topic } from "./types";

const KEYWORDS: Record<Topic, string[]> = {
  economy_innovation: ["innovacion", "patentes", "investigacion y desarrollo", "i+d", "innovation", "economia", "pib", "gdp", "complejidad economica", "sectores"],
  foreign_investment: ["inversion extranjera", "inversion extranjera directa", "ied", "fdi", "foreign investment", "capital extranjero"],
  exports_trade: ["exportacion", "exportaciones", "comercio exterior", "exports", "trade", "aduana", "importacion"],
  economic_diversification: ["diversificacion", "complejidad", "diversification", "concentracion economica"],
  infrastructure: ["infraestructura", "carreteras", "puertos", "aeropuertos", "ferrocarril", "energia electrica", "infrastructure", "conectividad", "internet", "telefonia", "banca movil", "terminales punto de venta", "viviendas con acceso"],
  financial_access: ["credito", "financiamiento", "acceso financiero", "bancarizacion", "financial access", "credit", "sucursales bancarias", "banca", "captacion de ahorro", "cuentas de ahorro"],
  transportation_logistics: ["transporte", "logistica", "carga", "transportation", "logistics", "autotransporte", "corredor", "pasajeros aereos", "carga aerea", "accidentes de transito"],
  labor_market: ["mercado laboral", "empleo", "desempleo", "poblacion ocupada", "trabajadores", "labor market", "employment", "participacion laboral", "contratacion", "talento disponible", "mercado de trabajo", "poblacion ocupada", "jornadas laborales", "puesto de trabajo", "tasa de participacion", "unidades economicas"],
  informality: ["informalidad", "informal", "sin seguridad social"],
  wages: ["salario", "salarios", "ingreso laboral", "remuneracion", "wages", "salary", "salario minimo", "salarial", "ingreso promedio", "ingresos por debajo", "linea de bienestar"],
  education_talent: ["educacion", "universidad", "egresados", "talento", "capital humano", "escolaridad", "education", "graduates", "talent", "posgrado"],
  social_security: ["seguridad social", "imss", "infonavit", "afore", "cuotas obrero-patronales", "social security"],
  competitiveness_state: ["competitividad", "ranking estatal", "indice de competitividad", "competitiveness", "estado mas competitivo", "estatal"],
  rule_of_law: ["estado de derecho", "corrupcion", "seguridad publica", "delincuencia", "rule of law", "justicia", "contratos y propiedad", "seguridad", "homicidios", "delictiva", "percepcion de seguridad", "notariales", "periodistas", "robo de vehiculos", "delitos", "denunciados"],
  regulatory_environment: ["regulacion", "mejora regulatoria", "tramites", "permisos", "regulatory", "licencias", "apertura de empresas"],
  government: ["gobierno", "finanzas publicas", "transparencia", "government", "gasto publico", "ingresos propios", "deuda estatal", "sistema politico", "participacion ciudadana", "costo promedio de la deuda"],
  taxes: ["impuesto", "isr", "iva", "fiscal", "tributar", "sat", "tax", "deducible", "precios de transferencia", "transfer pricing"],
  customs: ["aduana", "arancel", "pedimento", "customs", "tariff", "importacion temporal", "iva e ieps"],
  corporate_law: ["sociedad anonima", "s.a. de c.v.", "constitucion de sociedades", "acta constitutiva", "corporate", "incorporation", "registro publico de comercio"],
  immigration_mobility: ["visa", "migratorio", "inm", "permiso de trabajo", "immigration", "work permit"],
  energy: ["energia", "electricidad", "petroleo", "hidrocarburos", "energy", "cfe", "pemex", "renovable", "energetica", "energia electrica"],
};

export function classifyTopics(text: string, max = 4): Topic[] {
  const f = fold(text);
  const scored = (Object.entries(KEYWORDS) as [Topic, string[]][]).map(([t, ks]) => ({ t, n: ks.reduce((a, k) => a + (f.includes(k) ? 1 : 0), 0) })).filter((x) => x.n > 0);
  scored.sort((a, b) => b.n - a.n);
  return scored.slice(0, max).map((x) => x.t);
}
