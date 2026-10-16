import type { Answers, ProjectComponent } from '../domain/answers';
import type { CargoRoute, CoverageState, CountryState, FrontKey, FrontStatus, RoutingState, Support } from '../domain/types';
import type { Because } from '../engine/frontRules';
import type { NotApplicableGroup } from '../engine/frontRules';
import type { Resolution } from '../engine/resolve';
import { RESOLUTION_SCHEMA_VERSION, SOURCE_SCHEMA_VERSION } from './versions';

/**
 * SOURCE FACTS (sealed with the result) — the client-safe business/project facts that produced a delivered result (D-157).
 * It is NOT the whole `Answers` object: contact PII, legal acceptance, marketing consent and internal flow state are left out
 * (see `coverage.ts` for the per-field classification, which a test keeps complete).
 */
export interface SourceSnapshotV1 {
  schemaVersion: typeof SOURCE_SCHEMA_VERSION;
  locale: Answers['locale'];
  identity: { company: string; role: string; decider: Answers['identity']['decider'] };
  company: Answers['company'];
  destinations: Answers['destinations'];
  components: ProjectComponent[];
  knowsNeeds: boolean | null;
  reasons: Answers['reasons']; reasonText: string;
  decision: Answers['decision']; dependsOn: string;
  startWhen: Answers['startWhen'];
  externalDate: Answers['externalDate'];
  scale: Answers['scale'];
  regulated: Answers['regulated'];
  fronts: Answers['fronts'];
  addedNeeds: Answers['addedNeeds'];
  cargoRoute: Answers['cargoRoute'];
  supportValues: Answers['supportValues']; supportWords: string; keepWords: string;
  context: { success: string; constraints: string; description: string; experience: string; personalNeed: boolean };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function buildSourceSnapshot(a: Answers): SourceSnapshotV1 {
  const s: SourceSnapshotV1 = {
    schemaVersion: SOURCE_SCHEMA_VERSION, locale: a.locale,
    identity: { company: a.identity.company, role: a.identity.role, decider: a.identity.decider },
    company: a.company, destinations: a.destinations, components: a.components, knowsNeeds: a.knowsNeeds,
    reasons: a.reasons, reasonText: a.reasonText, decision: a.decision, dependsOn: a.dependsOn, startWhen: a.startWhen,
    externalDate: a.externalDate, scale: a.scale, regulated: a.regulated, fronts: a.fronts, addedNeeds: a.addedNeeds, cargoRoute: a.cargoRoute,
    supportValues: a.supportValues, supportWords: a.supportWords, keepWords: a.keepWords,
    context: { success: a.context.success, constraints: a.context.constraints, description: a.context.description, experience: a.context.experience, personalNeed: a.context.personalNeed },
  };
  return clone(s);   // detached copy: a later change to the live answers can never reach the stored object
}

/**
 * RESOLUTION PROJECTION (sealed with the result) — a sanitized, stable projection of what FA deterministically concluded (D-157): stable IDs and structured states only.
 * Never stored: rule traces, capability/presentation names or scope-limit texts, capability kind (provider layer), provider/sourcing/triage fields.
 */
export interface ResolutionSnapshotNeedV1 {
  front: FrontKey; origin: 'derived' | 'declared'; state: RoutingState; possible: boolean;
  because: Because[]; status: FrontStatus | null; support: Support | null; critical: boolean; dependsCause: 'presence' | 'hire' | 'legal_operation' | null;
  /** The client's own words that produced a declared need. */
  declaredTexts: string[];
  capabilities: Array<{ capabilityId: string; state: RoutingState; coverageBasis: string; basisValue: string | null; coverage: CoverageState | 'UNAVAILABLE'; conditionalOn: 'own_entity' | null }>;
}
export interface ResolutionSnapshotV1 {
  schemaVersion: typeof RESOLUTION_SCHEMA_VERSION;
  catalogVersion: string; premiumShown: boolean;
  destinations: Array<{
    destination: string; countryState: CountryState | 'UNDEFINED'; countryMessage: 'UNDEFINED' | 'DEVELOPING' | 'NO_ACTIVE_COVERAGE' | null;
    notApplicable: NotApplicableGroup[];
    topics: Array<{ front: FrontKey; kind: 'applies' | 'depends'; possible: boolean; origin: 'derived' | 'declared'; status: FrontStatus | null; notIndicated: boolean }>;
    needs: ResolutionSnapshotNeedV1[];
    unmapped: Array<{ text: string }>;
  }>;
}

export function buildResolutionSnapshot(res: Resolution): ResolutionSnapshotV1 {
  const s: ResolutionSnapshotV1 = {
    schemaVersion: RESOLUTION_SCHEMA_VERSION, catalogVersion: res.catalogVersion, premiumShown: res.premiumShown,
    destinations: res.destinations.map((d) => ({
      destination: d.destination, countryState: d.countryState, countryMessage: d.countryMessage,
      notApplicable: [...d.plan.notApplicable],
      topics: d.topics.map((t) => ({ front: t.front, kind: t.kind, possible: t.possible, origin: t.origin, status: t.status, notIndicated: t.notIndicated })),
      needs: d.needs.map((n) => ({
        front: n.front, origin: n.origin, state: n.state, possible: n.possible, because: [...n.because], status: n.status, support: n.support, critical: n.critical,
        dependsCause: n.dependsCause ?? null, declaredTexts: [...n.declaredTexts],
        capabilities: n.capabilities.map((c) => ({ capabilityId: c.capabilityId, state: c.state, coverageBasis: c.coverageBasis, basisValue: c.basisValue, coverage: c.coverage, conditionalOn: c.conditionalOn ?? null })),
      })),
      unmapped: d.unmapped.map((u) => ({ text: u.text })),
    })),
  };
  return clone(s);
}

export type { CargoRoute };
