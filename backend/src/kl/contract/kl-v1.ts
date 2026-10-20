/**
 * Contrato `kl.v1` (Contratos kl.v1 §2). Los tipos son los definitivos del Design congelado; este archivo no los
 * modifica. Precision los consume por el puerto `knowledge` (que implementa el responsable de Precision); KL entrega
 * su lado y un consumidor de prueba.
 */
export const KL_CONTRACT = "kl.v1" as const;
export type KlLocale = "es" | "en";
export type KlStage = "understanding" | "precision_by_category";
export type UnitRef = string; // "<unit_key>@<version>"
export type InformationType = "definition" | "procedure" | "general_requirement" | "statistic" | "comparison" | "equivalence";
export type Coverage = "sufficient" | "partial" | "not_available";
export type Availability = "ok" | "degraded" | "unavailable" | "disabled";
export type ContentRisk = "low" | "medium" | "high";
export type Confidence = "specialist_validated" | "reviewed" | "auto_published";
export type AuthorityClass = "A" | "B" | "C" | "D";
export type CardType = "country_profile" | "context" | "question_guide" | "diagnostic_trigger" | "local_service_condition" | "service_general" | "normative" | "guidance" | "methodology" | "beeside_process";

export type CoverageReason =
  | "no_unit"
  | "latest_available_only"
  | "locale_fallback"
  | "locale_unavailable_high"
  | "validation_expired"
  | "no_central_source"
  | "series_break";

export interface KlDimensions {
  destinationCountry: string;
  originCountry?: string;
  region?: string;
  industryKey?: string;
  stage: KlStage;
  categoryKey?: string;
  serviceId?: string;
  topic?: string;
  informationType?: InformationType;
  locale: KlLocale;
}

export interface KlApprovedClaim {
  claimId: string;
  unitRef: UnitRef;
  country: string;
  locale: KlLocale;
  text: string;
  normalizedSha256: string;
  authority: "A";
  authorization: { kind: "specialist_validated" | "reviewed"; validationRef?: string; validUntil?: string };
}

export interface KlUnit {
  ref: UnitRef;
  unitKey: string;
  version: number;
  kind: "statistic" | "card";
  cardType?: CardType;
  title: string;
  locale: KlLocale;
  localeFallback: boolean;
  usage: "citable" | "context_only";
  content: {
    text?: string;
    value?: { number: number | null; display: string; unit: string; valueStatus: "value" | "not_available"; direction?: "higher_is_better" | "lower_is_better" };
    rank?: { position: number; of: number; tieGroupSize?: number; intermediary: string };
  };
  dimensions: { country: string; region?: string; categoryKeys: string[]; serviceIds: string[]; topic?: string; industryKeys: string[] };
  provenance: {
    publicationKey: string;
    institution: string;
    publicationTitle: string;
    authorityClass: AuthorityClass;
    locator?: string;
    primaryRef?: UnitRef;
    citation: string;
    permittedUse: "quote" | "paraphrase_and_cite" | "cite_only";
  };
  validity: {
    period?: { label: string; start: string; end: string; confidence: "declared" | "inferred" | "estimated" };
    sourcePublishedAt?: string;
    validFrom: string;
    validTo?: string;
    nextReview?: string;
    latestAvailable: boolean;
    seriesBreak?: string;
  };
  risk: ContentRisk;
  confidence: Confidence;
  limits: string[];
  specialist: { required: boolean; categoryKey?: string; serviceId?: string; reason?: string };
  notes?: { methodology?: string; estimated?: boolean };
  evidence?: { excerpt: string; locator: string; fileSha256: string };
  related: { unitRefs: UnitRef[]; productSections: string[]; equivalenceSupport: string[] };
}

export interface ContextPackageRequest {
  contract: "kl.v1";
  scope: Pick<KlDimensions, "destinationCountry" | "originCountry" | "stage" | "categoryKey" | "locale">;
  knownPackageRef?: string;
}
export type ContextPackageResponse =
  | { contract: "kl.v1"; availability: Availability; status: "unchanged"; packageRef: string }
  | {
      contract: "kl.v1";
      availability: Availability;
      status: "package";
      package: { packageRef: string; hash: string; level: "core" | "stage"; compiledAt: string; estimatedTokens: number; manifest: UnitRef[]; units: KlUnit[]; approvedClaims: KlApprovedClaim[] };
    }
  | { contract: "kl.v1"; availability: Availability; status: "none" };

export interface PackageStatusRequest {
  packageRefs: string[];
}
export interface PackageStatusResponse {
  availability: Availability;
  statuses: Record<string, "valid" | "invalidated">;
}

export interface KnowledgeQueryRequest {
  contract: "kl.v1";
  dimensions: KlDimensions;
  normalizedQuery?: string;
  indicatorKeys?: string[];
  aggregate?: { kind: "rank" | "max" | "min"; indicatorKey: string; scope: "states"; limit?: number };
  includeEvidence?: boolean;
  limit?: number;
}
export interface RelatedResource {
  productKey: string;
  productTitle: string;
  editionRef: string;
  editionStatus: "current";
  cutoffDate: string;
  locales: ["es", "en"];
  sections: { sectionKey: string; chapter: string; title: string; unitRefs: UnitRef[] }[];
}
export interface KnowledgeQueryResponse {
  contract: "kl.v1";
  availability: Availability;
  coverage: Coverage;
  coverageReasons: CoverageReason[];
  units: KlUnit[];
  approvedClaims: KlApprovedClaim[];
  related: RelatedResource[];
  demandHint?: { topic: string; informationType: InformationType; partialUnitRefs: UnitRef[] };
}

export interface RelatedResourcesRequest {
  contract: "kl.v1";
  destinationCountry: string;
  categoryKey?: string;
  topic?: string;
  locale: KlLocale;
}

export interface DemandSignal {
  contract: "kl.v1";
  destinationCountry: string;
  region?: string;
  topic: string;
  categoryKey?: string;
  serviceId?: string;
  informationType: InformationType;
  coverage: "absent" | "partial";
  partialUnitRefs?: UnitRef[];
  stage: KlStage;
  locale: KlLocale;
  candidate: "knowledge_candidate" | "specialist_service" | "unclear";
  projectRef: string;
  occurredAt: string;
}
export interface UsageBatch {
  contract: "kl.v1";
  items: { ref: UnitRef; stage: KlStage; destinationCountry: string; categoryKey?: string; via: "ram" | "query"; count: number }[];
}

export interface OpenEditionRequest {
  productKey: string;
  locale: KlLocale;
}
export type OpenEditionResult =
  | { status: "ok"; editionRef: string; filename: string; contentType: "application/pdf"; sha256: string; byteLength: number; stream: () => NodeJS.ReadableStream }
  | { status: "no_current_edition" };

/** Límites de integración (Contratos kl.v1 §4). */
export const KL_LIMITS = {
  readBudgetMs: 250,
  maxPackageStatusRefs: 8,
  maxUnits: 20,
  maxTextChars: 1200,
  maxEvidenceChars: 800,
  maxNormalizedQueryChars: 200,
  maxIndicatorKeys: 10,
  maxUsageItems: 200,
} as const;
