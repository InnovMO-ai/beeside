/**
 * KNOWLEDGE LAYER — the permanent contract.
 *
 * Precision (and any future product) is a CLIENT of this contract. It never reads the layer's store, never owns knowledge and never
 * reaches the web: the layer returns APPROVED, versioned, provenance-aware knowledge (or says plainly that it has none), and it owns the
 * Knowledge Demand registry that aggregates what clients could not be answered. KSeed is only the first CONTENT published through it.
 *
 *   consumer ──request──▶  KnowledgeLayer ──▶ units + provenance + availability + professional boundary
 *   consumer ──demand signal (normalised, no client text)──▶ KnowledgeLayer (aggregates, triages, decides)
 *
 * Everything a consumer needs is in this file; importing anything else from the layer is an architecture violation (see the boundary test).
 * The interface is async and data-only on purpose: the layer can later run as a separate service without changing a consumer.
 */
import type { AuthorityLevel, Granularity, Indicator, RiskClass, SourceRole, Topic } from "./types";
import type { BoundaryKind } from "./boundary";
import type { DemandOutcome, DemandReason, DemandSignal, InfoType } from "./demand";

export type { AuthorityLevel, Granularity, Indicator, RiskClass, SourceRole, Topic, BoundaryKind, DemandOutcome, DemandReason, DemandSignal, InfoType };
export type Locale = "es" | "en";
export interface L10n { es: string; en: string }

// ------------------------------------------------------------------ availability
/**
 *  sufficient  — approved knowledge answers what was asked: use it (always with its source).
 *  partial     — approved knowledge covers only part: orient within that scope and state what remains unknown (`unresolved`).
 *  unavailable — nothing approved applies: state the limit, keep the diagnosis going, send a demand signal, route the specialist if appropriate.
 */
export type Availability = "sufficient" | "partial" | "unavailable";

// ------------------------------------------------------------------ request
/** What the question is FOR. */
export type RequestIntent =
  /** A client question to be answered from approved knowledge. */
  | "answer_question"
  /** Context for what the project weighs (location criteria, headcount...): the consumer names the topics, there is no question. */
  | "project_context";

export interface KnowledgeRequest {
  /** ISO-2 country of the operation (or "INT"); null when the project has none yet. */
  jurisdiction: string | null;
  intent: RequestIntent;
  /**
   * The client's words. Read for retrieval and interpretation only: the layer never stores them and never echoes them.
   * (An in-process call today; if the layer becomes a service this is the only free text that crosses.)
   */
  question?: string;
  /** Topics the consumer already knows are relevant (required for `project_context`; optional hint for a question). */
  topics?: Topic[];
  /** Subtopic hint from the consumer's own context, when it has one. */
  subtopic?: string;
  /** The consumer's service-map category / service the question belongs to; carried for routing and demand, never used to filter knowledge. */
  category?: string | null;
  service?: string | null;
  /** Project context needed for retrieval (e.g. the states a client is comparing). Controlled, non-identifying. */
  context?: { candidates?: string[] };
  language: Locale;
  limit?: number;
}

// ------------------------------------------------------------------ response
export interface SourceInfo {
  sourceId: string;
  institution: string;
  documentId: string;
  documentTitle: string;
  /** Edition and version of the document the unit comes from ("2025", v1). Newer editions supersede, never overwrite. */
  edition: string;
  version: number;
  jurisdiction: string;
  publishedAt?: string;
  effectiveAt?: string;
  retrievedAt: string;
  /** Where the document came from (URL, file name). */
  locator: string;
  /** Human-checkable location inside the document ("p. 14"). */
  location: string;
  /** Authority class of the SOURCE: official_primary > trusted_institutional > beeside_curated > secondary. */
  authority: AuthorityLevel;
  /** What the source may ground: obligation / context / analysis. */
  roles: SourceRole[];
  risk: RiskClass;
  confidence: "high" | "medium" | "low";
  /** active | superseded | withdrawn. Only active knowledge is returned by a request. */
  status: "active" | "superseded" | "withdrawn";
}

export interface KnowledgeUnit {
  id: string;
  text: string;
  topics: Topic[];
  granularity: Granularity;
  /** Geographic units the unit speaks about (state names...). */
  units: string[];
  indicators: Indicator[];
  source: SourceInfo;
  /** "IMCO, Índice de Competitividad Estatal 2025 (2025), p. 14": a citation a person can check. */
  citation: string;
  /** How the consumer must word it: only an official primary obligation source may be stated as a requirement; everything else is context. */
  wording: "obligation" | "context";
  /** `direct`: the unit addresses what was asked. `contextual`: related approved knowledge offered as context only; it does not answer the request. */
  support: "direct" | "contextual";
}

export interface Limit { kind: "granularity"; place: string; message: L10n }

export interface ComparisonSummary {
  units: string[];
  rows: { criterion: string; topic: Topic; entries: { unit: string; value: number | string; rank?: number; year?: string }[]; leader?: string }[];
  /** Neutral wording of the trade-offs: never a recommendation. */
  summary: L10n;
}

/** What remains unknown after the layer answered what it could (the substance of a PARTIAL or UNAVAILABLE answer). */
export type Unresolved =
  | { kind: "granularity"; detail: L10n }
  | { kind: "professional_judgment"; detail: L10n }
  | { kind: "topic_not_covered"; topic: Topic };

/** Professional-boundary metadata: the client asked for a DETERMINATION that belongs to a specialist. */
export interface Boundary {
  kind: BoundaryKind;
  /** The area a specialist owns ("la conclusión fiscal de tu caso"). */
  area: L10n;
  /** Where the specialist need routes in the consumer's service map, when there is one. */
  specialistCategoryKey: string | null;
}

/** What the layer understood the question to be about, in its own controlled vocabularies. */
export interface Interpretation {
  topics: Topic[];
  topic: Topic | "unclassified";
  subtopic: string;
  infoType: InfoType;
  boundary: Boundary | null;
}

export interface KnowledgeResponse {
  availability: Availability;
  /** Why it is not `sufficient`. */
  reason?: Exclude<DemandReason, "unclassified">;
  jurisdiction: string | null;
  units: KnowledgeUnit[];
  limits: Limit[];
  comparison?: ComparisonSummary;
  unresolved: Unresolved[];
  boundary: Boundary | null;
  interpretation: Interpretation;
  /** Raised when the real question cannot be answered from approved sources: the specialist takes it. */
  specialistNote?: string;
  /** Always false: knowledge orients, it never recommends. */
  recommends: false;
}

// ------------------------------------------------------------------ jurisdiction coverage
export interface JurisdictionCoverage {
  jurisdiction: string;
  /** True when approved context/analysis sources exist for the jurisdiction. */
  available: boolean;
  sourceCount: number;
  topics: Topic[];
}

// ------------------------------------------------------------------ demand
/** What the layer registered for a signal (normalised descriptors only, never client text). */
export interface DemandReceipt {
  topic: Topic | "unclassified";
  subtopic: string;
  infoType: InfoType;
  coverage: "absent" | "partial";
  disposition: "candidate_knowledge" | "specialist_service";
  reason: DemandReason;
  boundary: Boundary | null;
}

export interface DemandContext { projectId: string; turnKey: string }

// ------------------------------------------------------------------ country resources
/** A country guide ("Doing Business in Mexico") published through the layer. The destination is never exposed here: it is opened through `openResource`. */
export interface ResourceDescriptor {
  id: string;
  country: string;
  title: string;
  language: string;
  version: string;
  topic?: string;
  section?: string;
}

// ------------------------------------------------------------------ the contract
export interface KnowledgeLayer {
  /** Is there approved knowledge for this jurisdiction at all? */
  coverage(jurisdiction: string | null): Promise<JurisdictionCoverage>;
  /** Reads a question in the layer's vocabularies (topic, subtopic, information type, professional boundary). Not stored. */
  interpret(question: string): Promise<Interpretation>;
  /** Approved, versioned, provenance-aware knowledge for a request, with its availability state. Never a live search. */
  request(req: KnowledgeRequest): Promise<KnowledgeResponse>;
  /** Sends a normalised demand signal for something the layer could not (fully) answer. Best-effort: never throws into the consumer's turn. */
  recordDemand(ctx: DemandContext, signal: DemandSignal): Promise<DemandReceipt | null>;
  /** Country guides available for a country (newest active version, in the client's language first). */
  resources(q: { country: string; language: string; topic?: string; now?: string }): Promise<ResourceDescriptor[]>;
  /** Where a guide opens (an https URL); null when it is not active or not openable. */
  openResource(id: string): Promise<{ id: string; title: string; url: string } | null>;
}
