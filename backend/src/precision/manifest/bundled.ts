/**
 * The manifests that ship with the build (copied from the Gate D authoring tools, unchanged):
 * the 7 authored category manifests, `_generic`, and the project manifest v2. The database registry is the runtime
 * source of truth (registry.ts); these are what `publish.ts` publishes and what tests / fixtures use without a database.
 */
import type { CategoryManifestContent } from "./effective-fields";
import corporateLegalAdmin from "./data/corporate_legal_admin.json";
import ecosystemDevelopment from "./data/ecosystem_development.json";
import genericManifest from "./data/_generic.json";
import internationalTradeCustoms from "./data/international_trade_customs.json";
import logistics from "./data/logistics.json";
import peoplePayrollEmployment from "./data/people_payroll_employment.json";
import projectManifestV2 from "./data/project_manifest_v2.json";
import strategicAdvisory from "./data/strategic_advisory.json";
import taxAccountingAudit from "./data/tax_accounting_audit.json";
import servicesProjection from "./data/services-projection.json";

/** A full authored category manifest document (content + authoring metadata). */
export type CategoryManifestDoc = CategoryManifestContent & {
  schema_version: number;
  manifest_status: string;
  domain_validator: string | null;
  category_key: string;
  manifest_version_label: string;
  crp_kind: "operational" | "strategic_advisory" | "ecosystem_development" | "new_category_discovery";
  intake_depth: "standard" | "light";
  boundaries?: unknown;
  [k: string]: unknown;
};

export const AUTHORED_CATEGORY_KEYS = [
  "logistics",
  "international_trade_customs",
  "people_payroll_employment",
  "corporate_legal_admin",
  "tax_accounting_audit",
  "strategic_advisory",
  "ecosystem_development",
] as const;
export const GENERIC_CATEGORY_KEY = "_generic";

const DOCS: Record<string, CategoryManifestDoc> = {
  logistics: logistics as unknown as CategoryManifestDoc,
  international_trade_customs: internationalTradeCustoms as unknown as CategoryManifestDoc,
  people_payroll_employment: peoplePayrollEmployment as unknown as CategoryManifestDoc,
  corporate_legal_admin: corporateLegalAdmin as unknown as CategoryManifestDoc,
  tax_accounting_audit: taxAccountingAudit as unknown as CategoryManifestDoc,
  strategic_advisory: strategicAdvisory as unknown as CategoryManifestDoc,
  ecosystem_development: ecosystemDevelopment as unknown as CategoryManifestDoc,
  _generic: genericManifest as unknown as CategoryManifestDoc,
};

/** Every bundled category manifest (authored + `_generic`), in a stable order. */
export function bundledCategoryManifests(): CategoryManifestDoc[] {
  return [...AUTHORED_CATEGORY_KEYS, GENERIC_CATEGORY_KEY].map((k) => DOCS[k] as CategoryManifestDoc);
}

export function bundledCategoryManifest(categoryKey: string): CategoryManifestDoc | undefined {
  return DOCS[categoryKey];
}

/** The project manifest v2 document (candidate categories, signals, Add a Service policy, CCIR…). */
export function bundledProjectManifest(): ProjectManifestDoc {
  return projectManifestV2 as unknown as ProjectManifestDoc;
}

export interface CandidateCategory {
  category_key: string;
  kind: "catalog" | "reserved_platform";
  detection_signals_positive: { en: string[]; es: string[] };
  detection_signals_negative?: unknown[];
  typical_dependencies?: string[];
  sequencing_hint?: string;
  fa4_front_signals?: string[];
  capability_signals?: string[];
  category_manifest_status: "DRAFT-SIN-VALIDAR" | "NOT_AUTHORED" | string;
}
export interface OutOfScopeTopic {
  topic_key: string;
  notice_key: string;
  sources: { capability_ids: string[]; lexicon_en: string[]; lexicon_es: string[] };
}
export interface ProjectManifestDoc {
  schema_version: number;
  manifest_status: string;
  manifest_version_label: string;
  candidate_categories: CandidateCategory[];
  reserved_platform_categories: string[];
  new_category_policy: {
    instance_key_pattern: string;
    manifest: string;
    known_candidates: Array<{ slug: string; fa4_front?: string; capability?: string; note?: string }>;
    never_create_new_if_category_exists: boolean;
  };
  out_of_scope_topics: OutOfScopeTopic[];
  add_a_service: { classification_order: string[]; requires: string; always_new_psm_version: boolean };
  [k: string]: unknown;
}

/** Services projection rows: [category order, category_key, service_key, English name, priority]. */
export type ServiceProjectionRow = [number, string, string, string, string];
export function bundledServicesProjection(): ServiceProjectionRow[] {
  return servicesProjection as unknown as ServiceProjectionRow[];
}

/** category_key -> catalog service keys, from the services projection. */
export function bundledCatalog(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [, cat, key] of bundledServicesProjection()) (out[cat] ||= []).push(key);
  return out;
}
