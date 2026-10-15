/**
 * Knowledge Service — permanent pattern for Precision's knowledge feed.
 *
 *   curated document -> structured / retrievable knowledge -> contextual reasoning -> conversational answer or question -> source traceability
 *
 * Nothing here knows about any specific publication: facts live in ingested documents, never in prompts or code.
 * Authority is a property of the SOURCE (registry), not of the text: analytical commentary is never turned into a legal requirement.
 */

/** official_primary: the issuing authority (SAT, IMSS, DOF, regulators). trusted_institutional: recognised analytical institutions (IMCO...).
 *  beeside_curated: beeside knowledge units derived from the former. secondary: everything else approved. */
export type AuthorityLevel = "official_primary" | "trusted_institutional" | "beeside_curated" | "secondary";
export type SourceRole = "obligation" | "context" | "analysis";
export type RiskClass = "high" | "medium" | "low";
export type UpdateCadence = "continuous" | "monthly" | "quarterly" | "annual" | "biennial" | "ad_hoc";
export type Granularity = "country" | "state" | "municipality" | "city" | "sector" | "none";

export const TOPICS = [
  "economy_innovation", "foreign_investment", "exports_trade", "economic_diversification", "infrastructure", "financial_access",
  "transportation_logistics", "labor_market", "informality", "wages", "education_talent", "social_security", "competitiveness_state",
  "rule_of_law", "regulatory_environment", "government", "taxes", "customs", "corporate_law", "immigration_mobility", "energy",
] as const;
export type Topic = (typeof TOPICS)[number];

export interface KnowledgeSource {
  id: string;
  institution: string;
  /** Web domain(s) the source may be fetched from. The agent never touches anything outside the registry. */
  domains: string[];
  jurisdiction: string; // ISO country code, or "INT"
  topics: Topic[];
  authority: AuthorityLevel;
  /** What the source may ground. `analysis`/`context` sources can inform questions and orientation but never state obligations. */
  roles: SourceRole[];
  primary: boolean;
  cadence: UpdateCadence;
  risk: RiskClass;
  /** Human review required before a candidate update goes live. High risk always; others by policy. */
  reviewRequired: boolean;
  /** The finest geographic unit this source supports; used by the granularity guard. */
  granularity: Granularity;
  active: boolean;
  notes?: string;
}

export interface KnowledgeDocument {
  id: string;
  sourceId: string;
  title: string;
  edition: string; // "2025", "2026-Q2"
  version: number;
  publishedAt?: string; // ISO date
  effectiveAt?: string;
  retrievedAt: string;
  jurisdiction: string;
  topics: Topic[];
  /** Where it came from: URL, file name or document destination. */
  locator: string;
  contentHash: string;
  confidence: "high" | "medium" | "low";
  status: "active" | "superseded" | "withdrawn";
  supersedesId?: string;
  supersededById?: string;
  language: string;
}

export interface Indicator {
  /** e.g. "Mercado de trabajo", free label as published */
  name: string;
  /** Geographic unit the value refers to (state name, "Nacional"). */
  unit: string;
  unitKind: Granularity;
  value: number | string;
  year?: string;
  rank?: number;
}

export interface KnowledgePassage {
  id: string;
  documentId: string;
  sourceId: string;
  ordinal: number;
  text: string;
  /** Human-checkable location: "p. 14", "§ Infraestructura", "row 12". */
  location: string;
  topics: Topic[];
  /** Geographic units the passage speaks about (state names...) and their level. */
  units: string[];
  granularity: Granularity;
  indicators: Indicator[];
}

/** Provenance returned with every retrieved passage so the answer can always cite its source. */
export interface Provenance {
  institution: string;
  documentTitle: string;
  edition: string;
  version: number;
  publishedAt?: string;
  retrievedAt: string;
  jurisdiction: string;
  locator: string;
  location: string;
  authority: AuthorityLevel;
  sourceRoles: SourceRole[];
  documentStatus: KnowledgeDocument["status"];
}

export interface Hit {
  passage: KnowledgePassage;
  score: number;
  provenance: Provenance;
  /** Whether this hit may ground a statement about legal/tax/regulatory OBLIGATIONS. Only official primary sources may. */
  mayGroundObligation: boolean;
}

export interface RetrieveQuery {
  text?: string;
  topics?: Topic[];
  jurisdiction?: string;
  units?: string[];
  limit?: number;
  /** Only include these authority levels. */
  authorities?: AuthorityLevel[];
  includeSuperseded?: boolean;
}

export interface KnowledgeRepository {
  upsertSource(s: KnowledgeSource): Promise<void>;
  getSource(id: string): Promise<KnowledgeSource | null>;
  listSources(filter?: { active?: boolean; jurisdiction?: string }): Promise<KnowledgeSource[]>;
  insertDocument(d: KnowledgeDocument, passages: KnowledgePassage[]): Promise<void>;
  getDocument(id: string): Promise<KnowledgeDocument | null>;
  listDocuments(filter?: { sourceId?: string; status?: KnowledgeDocument["status"] }): Promise<KnowledgeDocument[]>;
  markSuperseded(oldId: string, newId: string): Promise<void>;
  listPassages(documentId: string): Promise<KnowledgePassage[]>;
  getPassage(id: string): Promise<{ passage: KnowledgePassage; doc: KnowledgeDocument } | null>;
  search(q: RetrieveQuery): Promise<{ passage: KnowledgePassage; doc: KnowledgeDocument; score: number }[]>;
}
