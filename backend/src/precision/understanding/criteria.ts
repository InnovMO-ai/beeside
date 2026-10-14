/** Location decision criteria the client may weigh. Each maps to knowledge topics, so what the client cares about decides what Precision retrieves. */
import type { L10n } from "./types";

export interface LocationCriterion { id: string; label: L10n; terms: string[]; topics: string[] }

export const LOCATION_CRITERIA: LocationCriterion[] = [
  { id: "talent", label: { es: "talento disponible", en: "available talent" }, terms: ["talento", "mano de obra", "personal calificado", "ingenieros", "universidades", "skilled labor", "talent", "workforce", "perfiles"], topics: ["labor_market", "education_talent"] },
  { id: "labor_cost", label: { es: "costos laborales", en: "labor costs" }, terms: ["costo laboral", "costos laborales", "salarios", "sueldos", "costo de la mano de obra", "labor cost", "wages"], topics: ["wages", "labor_market"] },
  { id: "logistics", label: { es: "conectividad logística", en: "logistics connectivity" }, terms: ["logistica", "conectividad", "puertos", "carreteras", "cercania a", "frontera", "aeropuerto", "ferrocarril", "logistics", "port", "highway", "border"], topics: ["infrastructure", "transportation_logistics"] },
  { id: "market_access", label: { es: "cercanía a clientes", en: "proximity to customers" }, terms: ["cerca de los clientes", "cercania a clientes", "cercania al cliente", "cerca de mis clientes", "proximity to customers", "near customers", "cerca del proyecto", "cerca del sitio"], topics: ["economy_innovation", "exports_trade"] },
  { id: "investment_climate", label: { es: "clima de inversión", en: "investment climate" }, terms: ["inversion", "incentivos", "clima de negocios", "investment climate", "incentives", "ecosistema empresarial"], topics: ["foreign_investment", "economy_innovation"] },
  { id: "regulatory", label: { es: "facilidad regulatoria", en: "regulatory ease" }, terms: ["permisos", "tramites", "regulacion", "facilidad regulatoria", "licencias", "permits", "regulatory"], topics: ["regulatory_environment", "government"] },
  { id: "security", label: { es: "seguridad", en: "security" }, terms: ["seguridad(?! social)", "estado de derecho", "inseguridad", "security", "safety", "rule of law"], topics: ["rule_of_law"] },
  { id: "energy_supply", label: { es: "suministro de energía", en: "energy supply" }, terms: ["energia electrica", "suministro electrico", "suministro de energia", "power supply", "electricity"], topics: ["infrastructure", "energy"] },
];
