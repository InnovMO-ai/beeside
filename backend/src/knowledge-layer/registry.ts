/**
 * Source Registry: the only door into the knowledge base. A source is approved here (institution, domains, authority, roles, cadence,
 * risk, review) before anything is ingested from it. The autonomous Knowledge Agent can only act on registered, active sources.
 */
import type { KnowledgeRepository, KnowledgeSource, Topic } from "./types";
import { TOPICS } from "./types";

export class RegistryError extends Error {}

/** Hierarchy rules that keep analytical commentary from becoming a legal requirement. */
export function validateSource(s: KnowledgeSource): string[] {
  const errs: string[] = [];
  if (!s.id || !/^[a-z0-9][a-z0-9_.-]{1,62}$/.test(s.id)) errs.push("id must be a slug");
  if (!s.institution.trim()) errs.push("institution required");
  if (s.domains.length === 0) errs.push("at least one approved domain");
  for (const d of s.domains) if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) errs.push(`bad domain ${d}`);
  if (s.topics.length === 0) errs.push("at least one topic");
  for (const t of s.topics) if (!(TOPICS as readonly string[]).includes(t)) errs.push(`unknown topic ${t}`);
  if (s.roles.length === 0) errs.push("at least one role");
  if (s.roles.includes("obligation") && s.authority !== "official_primary") errs.push("only official primary sources may ground obligations");
  if (s.authority === "official_primary" && !s.primary) errs.push("official primary sources are primary");
  if (s.risk === "high" && !s.reviewRequired) errs.push("high-risk sources require human review");
  if (s.authority === "beeside_curated" && s.roles.includes("obligation")) errs.push("curated units cannot ground obligations on their own");
  return errs;
}

export async function registerSource(repo: KnowledgeRepository, s: KnowledgeSource): Promise<KnowledgeSource> {
  const errs = validateSource(s);
  if (errs.length) throw new RegistryError(`Invalid source ${s.id}: ${errs.join("; ")}`);
  await repo.upsertSource(s);
  return s;
}

/** An ingestion/fetch target is allowed only if its host belongs to an active registered source. */
export function allowedHost(source: KnowledgeSource, url: string): boolean {
  if (!source.active) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return source.domains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch { return false; }
}

const t = (...x: Topic[]): Topic[] => x;

/**
 * Initial registrations (configuration, not content). Admin can edit/extend; nothing here carries facts from any publication.
 * IMCO is registered as a trusted analytical source: no partnership is assumed, and its role is context, never obligations.
 */
export const INITIAL_SOURCES: KnowledgeSource[] = [
  {
    id: "imco-ice", institution: "Instituto Mexicano para la Competitividad (IMCO)", domains: ["imco.org.mx"], jurisdiction: "MX",
    topics: t("economy_innovation", "foreign_investment", "exports_trade", "economic_diversification", "infrastructure", "financial_access", "transportation_logistics", "labor_market", "informality", "wages", "education_talent", "social_security", "competitiveness_state", "rule_of_law", "regulatory_environment", "government"),
    authority: "trusted_institutional", roles: ["context", "analysis"], primary: false, cadence: "biennial", risk: "medium", reviewRequired: true, granularity: "state", active: true,
    notes: "Índice de Competitividad Estatal. State-level only; context for orientation, never the authority on legal, tax or regulatory obligations.",
  },
  { id: "sat", institution: "Servicio de Administración Tributaria (SAT)", domains: ["sat.gob.mx"], jurisdiction: "MX", topics: t("taxes", "customs"), authority: "official_primary", roles: ["obligation", "context"], primary: true, cadence: "continuous", risk: "high", reviewRequired: true, granularity: "country", active: true },
  { id: "imss", institution: "Instituto Mexicano del Seguro Social (IMSS)", domains: ["imss.gob.mx"], jurisdiction: "MX", topics: t("social_security", "labor_market"), authority: "official_primary", roles: ["obligation", "context"], primary: true, cadence: "continuous", risk: "high", reviewRequired: true, granularity: "country", active: true },
  { id: "se", institution: "Secretaría de Economía", domains: ["gob.mx"], jurisdiction: "MX", topics: t("foreign_investment", "corporate_law", "exports_trade"), authority: "official_primary", roles: ["obligation", "context"], primary: true, cadence: "continuous", risk: "high", reviewRequired: true, granularity: "country", active: true },
  { id: "dof", institution: "Diario Oficial de la Federación (DOF)", domains: ["dof.gob.mx"], jurisdiction: "MX", topics: t("taxes", "customs", "corporate_law", "regulatory_environment", "social_security"), authority: "official_primary", roles: ["obligation"], primary: true, cadence: "continuous", risk: "high", reviewRequired: true, granularity: "country", active: true },
];

export async function seedInitialSources(repo: KnowledgeRepository): Promise<void> {
  for (const s of INITIAL_SOURCES) await registerSource(repo, s);
}
