// Domain vocabulary. Source of truth: CATALOG_MODEL.md §3, FA_INFORMATION_MODEL.md, CAPABILITY_REGISTRY_FOR_DESIGN.md.
export type Locale = 'es' | 'en';

export const FRONT_KEYS = [
  'FR_SITE', 'FR_LEGAL_TAX', 'FR_PERMITS', 'FR_RECRUITMENT', 'FR_EMPLOYMENT', 'FR_MOBILE_STAFF',
  'FR_TRADE', 'FR_LOGISTICS', 'FR_SUPPLIERS', 'FR_BANKING', 'FR_INSURANCE', 'FR_STAFF_HOUSING',
  'FR_PARENT_LINK', 'FR_EXIT', 'FR_GTM', 'FR_PUBLIC_PROCUREMENT', 'FR_LOCAL_PARTNERS',
  'FR_REGULATORY', 'FR_BRAND', 'FR_INVEST_RC',
] as const;
export type FrontKey = (typeof FRONT_KEYS)[number];

export type CapabilityStatus = 'ACTIVE' | 'SOURCEABLE' | 'REVIEW' | 'NOT_OFFERED';
/** Routing states are a superset: DEPENDENT and UNMAPPED_NEED are NOT capability_status values (CATALOG_MODEL §3). */
export type RoutingState = CapabilityStatus | 'DEPENDENT' | 'UNMAPPED_NEED';
export type CountryState = 'ACTIVE' | 'DEVELOPING' | 'NO_ACTIVE_COVERAGE';
export type CoverageBasis =
  | 'DESTINATION_COUNTRY' | 'ISSUING_COUNTRY' | 'ORIGIN_DESTINATION_ROUTE'
  | 'LANGUAGE_PAIR' | 'SITE_OR_ENTITY_COUNTRY' | 'MULTI_COUNTRY';
export type CoverageState = 'CONFIRMED' | 'TO_CONFIRM' | 'VIA_SOURCING' | 'NOT_COVERED';
export type Match = 'DEFAULT' | 'SPECIFIC';
export type ProviderStatus = 'AFFILIATED' | 'AFFILIATED_SCOPE_TO_CONFIRM' | 'NONE' | 'BESIDE';
export type BusinessCheckStatus = 'NOT_RECORDED' | 'REQUIRED' | 'PASSED' | 'N/A';
export type PublicationStatus = 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';
export type CapabilityKind = 'STRATEGIC_ADVISORY' | 'HIVE';

export type Activity = 'sell' | 'produce' | 'source' | 'operate' | 'hire' | 'invest_only';
export type WithWhat = 'goods' | 'services' | 'digital';
/** I-06. own_physical = own premises; own_onsite = own execution on site without own premises. */
export type Presence = 'remote' | 'third_parties' | 'own_physical' | 'own_onsite' | 'acquisition' | 'open';
export type Permanence = 'permanent' | 'temporary' | 'open';
export type ExistingInDest = 'nothing' | 'via_third' | 'own';
/** Stored values. CONDITIONAL is derived (see deriveDecision in answers.ts): never a stored option (Rule 7). */
export type DecisionState = 'exploring' | 'decided' | 'in_progress';
export type SellsTo = 'companies' | 'government' | 'consumers' | 'mixed';
export type YesNoUnknown = 'yes' | 'no' | 'unknown';
export type FrontStatus = 'resolved' | 'in_progress' | 'pending' | 'unknown';
export type Support = 'yes' | 'no' | 'unknown';
/** I-26 (D-119) */
export type CargoRoute = 'within' | 'into_from_abroad' | 'both' | 'unknown';
export type CarriesFromOrigin = 'people' | 'equipment' | 'nothing';
export type LocationState = 'defined' | 'region_only' | 'undecided';
export type SupportValue =
  | 'speed' | 'no_network' | 'single_contact' | 'local_validation' | 'comparable_options'
  | 'coordination' | 'cost' | 'keep_control';

export interface Front {
  key: FrontKey;
  internalName: string;
  nameEs: string; nameEn: string;
  synonymsEs: string[]; synonymsEn: string[];
  examplesEs: string[]; examplesEn: string[];
}

export interface ServiceCategory {
  categoryId: string; nameEs: string; nameEn: string; description: string;
  publicationStatus: PublicationStatus; validFrom: string;
}
export interface Service {
  serviceId: string; categoryId: string; nameEs: string; nameEn: string;
  publicDescription: string; internalDescription: string;
  aliases: string[]; publicationStatus: PublicationStatus; validFrom: string;
}
export interface CoverageValue { value: string; state: CoverageState; validFrom: string }
export interface TriggerRule { activitiesAny?: Activity[] }
export interface Capability {
  capabilityId: string; serviceId: string; kind: CapabilityKind;
  nameEs: string; nameEn: string;
  fronts: Array<{ front: FrontKey; match: Match }>;
  triggerTermsEs: string[]; triggerTermsEn: string[]; triggerRule?: TriggerRule;
  capabilityStatus: CapabilityStatus;
  /** Catalog-driven dependency: the capability only makes sense once an open project decision is taken (Rule 1). */
  dependsOn?: 'own_entity';
  /** Catalog-driven: its scope limit is shown as a footnote of the result. */
  footnote?: boolean;
  coverageBasis: CoverageBasis;
  coverage: CoverageValue[];
  providerStatus: ProviderStatus; businessCheckStatus: BusinessCheckStatus;
  scopeLimitEs?: string; scopeLimitEn?: string;
  sourcingPolicy?: string;
  /** INTERNAL — never exposed in customer-facing output. */
  internalRef?: string;
  validFrom: string; updatedAt: string; publicationStatus: PublicationStatus;
}
export interface CountryCoverage { iso: string; nameEs: string; nameEn: string; state: CountryState; validFrom: string }

export interface Catalog {
  version: string;
  publishedAt: string;
  fronts: Front[];
  categories: ServiceCategory[];
  services: Service[];
  capabilities: Capability[];
  countries: CountryCoverage[];
}
