import type {
  Activity, CargoRoute, CarriesFromOrigin, DecisionState, ExistingInDest, FrontKey, FrontStatus, Locale,
  LocationState, Permanence, Presence, SellsTo, Support, SupportValue, WithWhat, YesNoUnknown,
} from './types';

export type SizeRange = '1-10' | '11-50' | '51-250' | '251-1000' | '1000+' ;
export type DeciderRole = 'me' | 'other' | 'shared';
export type Reason =
  | 'client_request' | 'follow_clients' | 'growth' | 'talent' | 'cost' | 'resilience' | 'diversify'
  | 'contract' | 'partner' | 'other';
export type ScaleProxy = 'investment' | 'people' | 'products' | 'purchase' | 'duration';
export type StartWhen = 'asap' | '3m' | '6m' | '12m' | 'unknown';

export interface Identity {
  name: string; company: string; email: string; role: string; decider: DeciderRole | null;
  termsAccepted: boolean; privacyAcknowledged: boolean;
}

export interface Destination {
  iso: string;               // ISO-3166 alpha-2, or 'OPEN' when the country is not decided
  region?: string;           // e.g. "Texas" — display only; never used for coverage
}

export interface ProjectComponent {
  id: string;
  destinations: string[];    // ISO codes served by this component (several when "same in all")
  description?: string;      // I-20 per component, cited literally
  activities: Activity[];
  withWhat: WithWhat[];
  presence: Presence | null;
  permanence: Permanence | null;
  durationMonths?: number;
  existing: ExistingInDest | null;
  existingNote?: string;
  // Conditional data
  sellsTo: SellsTo | null;
  ownBrand: YesNoUnknown | null;
  location: LocationState | null;
  locationText?: string;
  carries: CarriesFromOrigin[];
}

export interface FrontAnswer {
  status?: FrontStatus;
  support?: Support;
  critical?: boolean;
  marked?: boolean;          // shortcut mode: user explicitly marked this topic
  note?: string;
}

export interface AddedNeed { id: string; text: string; destination: string }

export interface Answers {
  locale: Locale;
  identity: Identity;
  company: {
    hasExistingBusiness: boolean | null;
    sector: string;          // generic sector, free text / list value
    size: SizeRange | null;
    operatesIn: string[];    // I-03a ISO codes
  };
  destinations: { list: Destination[]; open: boolean; sameInAll: boolean | null };
  components: ProjectComponent[];
  projectConfirmed: boolean;
  knowsNeeds: boolean | null;          // "Ya sé lo que necesito" shortcut
  reasons: Reason[]; reasonText: string;
  decision: DecisionState | null; dependsOn: string;
  startWhen: StartWhen | null;
  externalDate: { has: boolean | null; date?: string; what?: string };
  scale: Record<string, { proxy: ScaleProxy; text: string; declined: boolean }>;   // I-14 by component id
  regulated: YesNoUnknown | null;      // I-08
  fronts: Record<string, FrontAnswer>; // key `${dest}|${FrontKey}`
  addedNeeds: AddedNeed[];             // I-19
  cargoRoute: Record<string, CargoRoute>;   // I-26 by destination ISO
  supportValues: SupportValue[]; supportWords: string; keepWords: string;
  context: { success: string; constraints: string; description: string; experience: string; unknowns: string; personalNeed: boolean };
}

/**
 * Rule 7: when the user declares that the decision depends on an event/condition AND provides that dependency,
 * the decision is CONDITIONAL. Derived deterministically; no redundant option exists in the questionnaire.
 */
export function deriveDecision(a: Pick<Answers, 'decision' | 'dependsOn'>): DecisionState | 'conditional' | null {
  if (a.decision === 'decided' && a.dependsOn.trim()) return 'conditional';
  return a.decision;
}

export const frontKey = (dest: string, front: FrontKey) => `${dest}|${front}`;

export function emptyAnswers(locale: Locale = 'es'): Answers {
  return {
    locale,
    identity: { name: '', company: '', email: '', role: '', decider: null, termsAccepted: false, privacyAcknowledged: false },
    company: { hasExistingBusiness: null, sector: '', size: null, operatesIn: [] },
    destinations: { list: [], open: false, sameInAll: null },
    components: [], projectConfirmed: false, knowsNeeds: null,
    reasons: [], reasonText: '', decision: null, dependsOn: '', startWhen: null,
    externalDate: { has: null },
    scale: {}, regulated: null, fronts: {}, addedNeeds: [], cargoRoute: {},
    supportValues: [], supportWords: '', keepWords: '',
    context: { success: '', constraints: '', description: '', experience: '', unknowns: '', personalNeed: false },
  };
}

export const OPEN_DEST = 'OPEN';

/** ISO codes the project is directed to ('OPEN' when the country is undecided). */
export function destinationCodes(a: Answers): string[] {
  if (a.destinations.open || a.destinations.list.length === 0) return [OPEN_DEST];
  return a.destinations.list.map((d) => d.iso);
}
export function componentFor(a: Answers, dest: string): ProjectComponent | undefined {
  return a.components.find((c) => c.destinations.includes(dest));
}
