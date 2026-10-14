import type { CargoRoute, FrontKey, FrontStatus, Support } from '../domain/types';
import { CONTRACT_VERSION, MAPPER_VERSION } from './versions';
import type { ResolutionSnapshotV1, SourceSnapshotV1 } from './snapshots';

/**
 * FA4 → Precision contract (D-158). NEW and FA4-native: it does not reuse the legacy `FirstAssessmentPrecisionContext` / `PrecisionHandoffPackage`
 * (those belong to the previous FA architecture and stay untouched, documented as LEGACY).
 *
 * The mapper below is PURE and reads ONLY the sealed (delivered, immutable) result envelope: it never reads the mutable project/answers, never
 * re-runs the current rules engine, never needs today's catalog, never parses the YEV (presentation) and uses no AI.
 * FA hands over what the client DECLARED and what FA DERIVED, with provenance — Precision decides what to re-confirm or investigate.
 */
export type Provenance = 'DECLARED_BY_USER' | 'DERIVED_FROM_FA';

/** The immutable columns of a delivered `fa4_result` row that the mapper may read (deliberately WITHOUT the YEV `model`). */
export interface SealedResultV1 {
  projectId: string; resultId: string; deliveredAt: string;
  catalogVersion: string; rulesVersion: string;
  sourceSchemaVersion: number; sourceSnapshot: SourceSnapshotV1;
  resolutionSchemaVersion: number; resolutionSnapshot: ResolutionSnapshotV1;
}

export type OpenState = 'TO_BE_DEFINED' | 'NOT_SURE' | 'DECLINED' | 'NOT_DEFINED' | 'NOT_DECIDED' | 'PARTIAL';
export type CurrentPosition = 'NONE' | 'COMMERCIAL_TRACTION' | 'THIRD_PARTY_OPERATION' | 'OWN_PRESENCE' | 'NOT_ANSWERED';

export interface Fa4PrecisionContextV1 {
  contract: { version: typeof CONTRACT_VERSION; mapperVersion: string };
  ids: { projectId: string; resultId: string };
  deliveredAt: string;
  locale: 'es' | 'en';
  versions: { catalogVersion: string; rulesVersion: string; sourceSchemaVersion: number; resolutionSchemaVersion: number };

  /** What the client said. Nothing here is a conclusion of FA. */
  declared: {
    provenance: 'DECLARED_BY_USER';
    company: { name: string; role: string; decisionRole: 'me' | 'other' | 'shared' | null; operatingBusiness: boolean | null; sector: string; size: string | null; operatesIn: string[] };
    destinations: { open: boolean; sameProjectInAll: boolean | null; list: Array<{ country: string; region: string | null }> };
    components: Array<{
      id: string; countries: string[]; description: string | null; activities: string[]; offering: string[];
      presenceModel: string | null; permanence: string | null; durationMonths: number | null;
      /** D-153: `COMMERCIAL_TRACTION` = customers, orders or commercial conversations WITHOUT own presence; it is never established third-party operation (`THIRD_PARTY_OPERATION` = legacy value). */
      currentPositionInDestination: { state: CurrentPosition; note: string | null };
      customerType: string | null; ownBrand: string | null;
      exactLocation: { state: string | null; text: string | null };
      movesFromAbroad: string[];
    }>;
    clarityAnswer: boolean | null;
    intent: {
      motivations: string[]; motivationText: string;
      decision: { state: string | null; dependsOn: string };
      startTiming: string | null;
      externalDeadline: { has: boolean | null; date: string | null; what: string | null };
      projectSize: Array<{ componentId: string; proxy: string; answer: string; state: 'ANSWERED' | 'DECLINED' | 'NOT_DEFINED' }>;
      regulation: string | null;
    };
    topics: Array<{ destination: string; front: FrontKey; status: FrontStatus | null; supportRequested: Support | null; critical: boolean; markedByUser: boolean }>;
    addedNeeds: Array<{ destination: string; text: string }>;
    cargoRoute: Record<string, CargoRoute>;
    supportPreferences: { values: string[]; words: string; keepInTeam: string };
    notes: { success: string; constraints: string; priorExperience: string; description: string; personalNeedExists: boolean };
    /** Structured «not known / still to define» states (the retired free-text «what do you not know yet» is NOT part of the contract). */
    openStates: Array<{ field: string; destination: string | null; state: OpenState }>;
  };

  /** What FA concluded deterministically with `rulesVersion` + `catalogVersion`. Never presented as declared. */
  derived: {
    provenance: 'DERIVED_FROM_FA';
    premiumShown: boolean;
    destinations: ResolutionSnapshotV1['destinations'];
  };
}

const POSITION: Record<string, CurrentPosition> = { nothing: 'NONE', commercial_traction: 'COMMERCIAL_TRACTION', via_third: 'THIRD_PARTY_OPERATION', own: 'OWN_PRESENCE' };

export class SealedResultError extends Error {
  constructor(readonly code: 'UNSUPPORTED_SOURCE_SCHEMA' | 'UNSUPPORTED_RESOLUTION_SCHEMA' | 'INCOMPLETE_ENVELOPE', message: string) { super(message); this.name = 'SealedResultError'; }
}

export function mapSealedResultToPrecisionContext(r: SealedResultV1): Fa4PrecisionContextV1 {
  if (!r.sourceSnapshot || !r.resolutionSnapshot || !r.rulesVersion) throw new SealedResultError('INCOMPLETE_ENVELOPE', 'the result has no sealed envelope');
  if (r.sourceSchemaVersion !== 1 || r.sourceSnapshot.schemaVersion !== 1) throw new SealedResultError('UNSUPPORTED_SOURCE_SCHEMA', `source schema ${r.sourceSchemaVersion} has no upgrader`);
  if (r.resolutionSchemaVersion !== 1 || r.resolutionSnapshot.schemaVersion !== 1) throw new SealedResultError('UNSUPPORTED_RESOLUTION_SCHEMA', `resolution schema ${r.resolutionSchemaVersion} has no upgrader`);
  const s = r.sourceSnapshot; const res = r.resolutionSnapshot;
  const open: Fa4PrecisionContextV1['declared']['openStates'] = [];
  const push = (field: string, destination: string | null, state: OpenState) => open.push({ field, destination, state });
  if (s.destinations.open) push('destinations', null, 'TO_BE_DEFINED');
  if (s.startWhen === 'unknown') push('startTiming', null, 'TO_BE_DEFINED');
  if (s.regulated === 'unknown') push('regulation', null, 'NOT_SURE');

  const components = s.components.map((c) => {
    const where = c.destinations.join('+');
    if (c.presence === 'open') push('presenceModel', where, 'TO_BE_DEFINED');
    if (c.permanence === 'open') push('permanence', where, 'TO_BE_DEFINED');
    if (c.ownBrand === 'unknown') push('ownBrand', where, 'NOT_SURE');
    if (c.location === 'undecided') push('exactLocation', where, 'NOT_DECIDED'); else if (c.location === 'region_only') push('exactLocation', where, 'PARTIAL');
    return {
      id: c.id, countries: [...c.destinations], description: c.description ?? null, activities: [...c.activities], offering: [...c.withWhat],
      presenceModel: c.presence, permanence: c.permanence, durationMonths: c.durationMonths ?? null,
      currentPositionInDestination: { state: (c.existing ? POSITION[c.existing] : 'NOT_ANSWERED') as CurrentPosition, note: c.existingNote ?? null },
      customerType: c.sellsTo, ownBrand: c.ownBrand, exactLocation: { state: c.location, text: c.locationText ?? null }, movesFromAbroad: [...c.carries],
    };
  });
  const projectSize = s.components.filter((c) => !c.activities.includes('invest_only')).map((c) => {
    const x = s.scale[c.id];
    const state = !x ? 'NOT_DEFINED' : x.declined ? 'DECLINED' : x.text.trim() ? 'ANSWERED' : 'NOT_DEFINED';
    if (state !== 'ANSWERED') push('projectSize', c.destinations.join('+'), state === 'DECLINED' ? 'DECLINED' : 'NOT_DEFINED');
    return { componentId: c.id, proxy: x?.proxy ?? 'investment', answer: x && !x.declined ? x.text : '', state: state as 'ANSWERED' | 'DECLINED' | 'NOT_DEFINED' };
  });
  if (s.cargoRoute) for (const [d, v] of Object.entries(s.cargoRoute)) if (v === 'unknown') push('cargoRoute', d, 'NOT_SURE');
  const topics = Object.entries(s.fronts).map(([key, f]) => {
    const [destination, front] = key.split('|') as [string, FrontKey];
    if (f.status === 'unknown') push('topicStatus', `${destination}|${front}`, 'NOT_SURE');
    if (f.support === 'unknown') push('topicSupport', `${destination}|${front}`, 'NOT_SURE');
    return { destination, front, status: f.status ?? null, supportRequested: f.support ?? null, critical: f.critical === true, markedByUser: f.marked === true };
  }).sort((x, y) => (x.destination + x.front).localeCompare(y.destination + y.front));

  return {
    contract: { version: CONTRACT_VERSION, mapperVersion: MAPPER_VERSION },
    ids: { projectId: r.projectId, resultId: r.resultId }, deliveredAt: r.deliveredAt, locale: s.locale,
    versions: { catalogVersion: r.catalogVersion, rulesVersion: r.rulesVersion, sourceSchemaVersion: r.sourceSchemaVersion, resolutionSchemaVersion: r.resolutionSchemaVersion },
    declared: {
      provenance: 'DECLARED_BY_USER',
      company: { name: s.identity.company, role: s.identity.role, decisionRole: s.identity.decider, operatingBusiness: s.company.hasExistingBusiness, sector: s.company.sector, size: s.company.size, operatesIn: [...s.company.operatesIn] },
      destinations: { open: s.destinations.open, sameProjectInAll: s.destinations.sameInAll, list: s.destinations.list.map((d) => ({ country: d.iso, region: d.region ?? null })) },
      components, clarityAnswer: s.knowsNeeds,
      intent: {
        motivations: [...s.reasons], motivationText: s.reasonText, decision: { state: s.decision, dependsOn: s.dependsOn }, startTiming: s.startWhen,
        externalDeadline: { has: s.externalDate.has, date: s.externalDate.date ?? null, what: s.externalDate.what ?? null }, projectSize, regulation: s.regulated,
      },
      topics, addedNeeds: s.addedNeeds.map((n) => ({ destination: n.destination, text: n.text })), cargoRoute: { ...s.cargoRoute },
      supportPreferences: { values: [...s.supportValues], words: s.supportWords, keepInTeam: s.keepWords },
      notes: { success: s.context.success, constraints: s.context.constraints, priorExperience: s.context.experience, description: s.context.description, personalNeedExists: s.context.personalNeed },
      openStates: open.sort((x, y) => (x.field + (x.destination ?? '')).localeCompare(y.field + (y.destination ?? ''))),
    },
    derived: { provenance: 'DERIVED_FROM_FA', premiumShown: res.premiumShown, destinations: res.destinations },
  };
}

/** Deterministic JSON (sorted keys): what Precision hashes when it pins the context it consumed (the hash lives with Precision, not in FA). */
export function canonicalJson(v: unknown): string {
  const norm = (x: unknown): unknown => (Array.isArray(x) ? x.map(norm) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, norm((x as Record<string, unknown>)[k])])) : x);
  return JSON.stringify(norm(v));
}
