/**
 * KNOWLEDGE LAYER — the permanent contract.
 *
 * Precision (and any future product) is a CLIENT of this contract. It never reads the layer's store, never owns knowledge and never
 * reaches the web: the layer returns APPROVED, versioned, provenance-aware knowledge (or says plainly that it has none), and it owns the
 * Knowledge Demand registry that aggregates what clients could not be answered. KSeed is only the first CONTENT published through it.
 *
 *   consumer ──request (structured dimensions only)──▶  KnowledgeLayer ──▶ units + provenance + availability
 *   consumer ──demand signal (normalised, opaque keyed project reference)──▶ KnowledgeLayer (aggregates, triages, decides)
 *
 * PRIVACY BY DESIGN (frozen, kl.v1): the layer never receives the client's words, names, project figures, documents or the real project id.
 * The consumer interprets the question LOCALLY (see ./vocabulary) and sends only the reusable dimensions below.
 *
 * Everything a consumer needs is in this file; importing anything else from the layer is an architecture violation (see the boundary test).
 * The interface is async and data-only on purpose: the layer can later run as a separate service without changing a consumer.
 */
import type { AuthorityLevel, Granularity, Indicator, RiskClass, SourceRole, Topic } from "./types";
import type { BoundaryKind } from "./boundary";
import type { DemandOutcome, DemandReason, DemandRefs, DemandSignal, InfoType } from "./demand";

export type { AuthorityLevel, Granularity, Indicator, RiskClass, SourceRole, Topic, BoundaryKind, DemandOutcome, DemandReason, DemandRefs, DemandSignal, InfoType };
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

/** Product stage the request is made in. One contract for both: only the stage (and the intent) change. */
export type Stage = "understanding" | "precision_by_category";

/**
 * A request is made of REUSABLE DIMENSIONS ONLY. There is no free text of the client here: the consumer classifies the question itself and
 * sends the result. The layer never stores a request and never echoes one.
 */
export interface KnowledgeRequest {
  /** ISO-2 country of the operation (or "INT"); null when the project has none yet. */
  jurisdiction: string | null;
  /** Country the client comes from, when it matters for equivalences. */
  originCountry?: string | null;
  /** Industry code, when the consumer has one. */
  industry?: string | null;
  stage: Stage;
  intent: RequestIntent;
  /** Topics (controlled vocabulary) the request is about; required for `project_context`. */
  topics?: Topic[];
  /** The primary topic, subtopic and information type the consumer read in the question (controlled vocabularies, never the words). */
  topic?: Topic | "unclassified";
  subtopic?: string;
  infoType?: InfoType;
  /** Regions of the jurisdiction (states from the controlled gazetteer) the request is scoped to. Retrieval parameter only: never stored. */
  regions?: string[];
  /** True when the question points at something finer than a state (a city, a municipality): the layer states its granularity limit. */
  finerThanState?: boolean;
  /** The consumer's service-map category / service the question belongs to; carried for routing and demand, never used to filter knowledge. */
  category?: string | null;
  service?: string | null;
  /**
   * Optional normalised query, WRITTEN by the consumer from vocabulary terms (see `normalizedQuery`): no client, company or project data.
   * Processed in memory to order results; never persisted.
   */
  query?: string;
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

/** A granularity limit. `message` and any note may contain the token {place}: the consumer fills in the place the client named (the layer never sees it). */
export interface Limit { kind: "granularity"; availableLevel: Granularity; message: L10n }

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

/** Professional-boundary metadata: the client asked for a DETERMINATION that belongs to a specialist. Determined by the consumer, in its own reading of the question. */
export interface Boundary {
  kind: BoundaryKind;
  /** The area a specialist owns ("la conclusión fiscal de tu caso"). */
  area: L10n;
  /** Where the specialist need routes in the consumer's service map, when there is one. */
  specialistCategoryKey: string | null;
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


// ------------------------------------------------------------------ country resources
/** A country resource (e.g. "beeside Doing Business México") published through the layer. The destination is never exposed here: it is opened through `openResource`. */
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
  /** Approved, versioned, provenance-aware knowledge for a request, with its availability state. Never a live search. */
  request(req: KnowledgeRequest): Promise<KnowledgeResponse>;
  /**
   * Sends a normalised demand signal for something the layer could not (fully) answer. The only reference to a project is the opaque keyed
   * pair in `refs` (never the project id). Best-effort: never throws into the consumer's turn.
   */
  recordDemand(refs: DemandRefs, signal: DemandSignal): Promise<DemandReceipt | null>;
  /** Country guides available for a country (newest active version, in the client's language first). */
  resources(q: { country: string; language: string; topic?: string; now?: string }): Promise<ResourceDescriptor[]>;
  /** Where a guide opens (an https URL); null when it is not active or not openable. */
  openResource(id: string): Promise<{ id: string; title: string; url: string; type?: "pdf" | "web" } | null>;
}
