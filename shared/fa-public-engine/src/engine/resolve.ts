import type { Answers } from '../domain/answers';
import { OPEN_DEST, frontKey } from '../domain/answers';
import type {
  Capability, CapabilityStatus, Catalog, CountryState, CoverageState, FrontKey, FrontStatus, RoutingState, Support,
} from '../domain/types';
import { FRONT_ORDER } from '../catalog/fronts';
import { dependsCause, planFor, type Because, type DependsCause, type DestinationPlan } from './frontRules';
import { containsTerm, norm } from './text';

/** Conservative ordering (CAPABILITY_REGISTRY §7.2): NOT_OFFERED / UNMAPPED < DEPENDENT < REVIEW < SOURCEABLE < ACTIVE. */
export const CONSERVATIVE_RANK: Record<RoutingState, number> = {
  NOT_OFFERED: 0, UNMAPPED_NEED: 0, DEPENDENT: 1, REVIEW: 2, SOURCEABLE: 3, ACTIVE: 4,
};
export function mostConservative(states: RoutingState[]): RoutingState {
  return states.reduce((m, s) => (CONSERVATIVE_RANK[s] < CONSERVATIVE_RANK[m] ? s : m), states[0] ?? 'UNMAPPED_NEED');
}

export type CountryMessageKind = 'UNDEFINED' | 'DEVELOPING' | 'NO_ACTIVE_COVERAGE';
export interface TraceStep { rule: string; detail: string }

export interface ResolvedCapability {
  capabilityId: string; nameEs: string; nameEn: string; limitEs?: string; limitEn?: string;
  /** DEPENDENT = this capability only makes sense once an open decision (e.g. own entity) is taken; the topic itself still applies. */
  state: CapabilityStatus | 'DEPENDENT';
  coverageBasis: Capability['coverageBasis'];
  basisValue: string | null;
  coverage: CoverageState | 'UNAVAILABLE';
  /** Shown only as a conditional note (e.g. company setup when no own entity is decided). */
  conditionalOn?: 'own_entity';
  kind: Capability['kind'];
}

export type NeedOrigin = 'derived' | 'declared';
export interface ResolvedNeed {
  destination: string; front: FrontKey; origin: NeedOrigin;
  state: RoutingState;
  capabilities: ResolvedCapability[];
  declaredTexts: string[];
  because: Because[]; possible: boolean;
  status: FrontStatus | null; support: Support | null; critical: boolean;
  dependsCause?: DependsCause;
  trace: TraceStep[];
}
export interface UnmappedNeed { destination: string; text: string; trace: TraceStep[] }

export interface DestinationResolution {
  destination: string;
  countryState: CountryState | 'UNDEFINED';
  countryMessage: CountryMessageKind | null;
  plan: DestinationPlan;
  /** Topics applying to the project (derived + declared + conditional), whether or not they are needs. */
  topics: Array<{ front: FrontKey; kind: 'applies' | 'depends'; possible: boolean; origin: NeedOrigin;
    status: FrontStatus | null; notIndicated: boolean }>;
  needs: ResolvedNeed[];
  unmapped: UnmappedNeed[];
}
export interface Resolution { catalogVersion: string; destinations: DestinationResolution[]; premiumShown: boolean }

// ---------- capability evaluation (CATALOG_MODEL §4 / §4.1) ----------

function coverageOf(cap: Capability, value: string): CoverageState | undefined {
  return cap.coverage.find((c) => c.value === value)?.state;
}

export function evaluateCapability(cap: Capability, dest: string, a: Answers): ResolvedCapability {
  const base = {
    capabilityId: cap.capabilityId, nameEs: cap.nameEs, nameEn: cap.nameEn,
    limitEs: cap.scopeLimitEs, limitEn: cap.scopeLimitEn, coverageBasis: cap.coverageBasis, kind: cap.kind,
  };
  if (cap.capabilityStatus !== 'ACTIVE') {
    return { ...base, state: cap.capabilityStatus, basisValue: null, coverage: 'UNAVAILABLE' };
  }
  let coverage: CoverageState | 'UNAVAILABLE' = 'UNAVAILABLE';
  let basisValue: string | null = null;
  switch (cap.coverageBasis) {
    case 'DESTINATION_COUNTRY': case 'SITE_OR_ENTITY_COUNTRY': case 'LANGUAGE_PAIR':
      basisValue = dest; coverage = coverageOf(cap, dest) ?? 'UNAVAILABLE'; break;
    case 'ISSUING_COUNTRY': {
      const ops = a.company.operatesIn;
      if (ops.length === 1) { basisValue = ops[0]!; coverage = coverageOf(cap, basisValue) ?? 'UNAVAILABLE'; }
      break; // several or unknown issuing countries → MULTI_COUNTRY / CASE_SPECIFIC → not confirmed
    }
    case 'ORIGIN_DESTINATION_ROUTE': {
      const route = a.cargoRoute[dest];
      const legs = route === 'within' ? [`${dest}:DOMESTIC`] : route === 'into_from_abroad' ? [`INTL->${dest}`]
        : route === 'both' ? [`${dest}:DOMESTIC`, `INTL->${dest}`] : [];
      basisValue = route ? legs.join('+') : null;
      if (legs.length) {
        const states = legs.map((l) => coverageOf(cap, l));
        coverage = states.every((s) => s === 'CONFIRMED') ? 'CONFIRMED' : (states.find((s) => s === 'VIA_SOURCING') ? 'VIA_SOURCING' : 'TO_CONFIRM');
      }
      break;
    }
    case 'MULTI_COUNTRY': coverage = 'UNAVAILABLE'; break;
  }
  const state: CapabilityStatus = coverage === 'CONFIRMED' ? 'ACTIVE' : coverage === 'VIA_SOURCING' ? 'SOURCEABLE' : 'REVIEW';
  return { ...base, state, basisValue, coverage };
}

// ---------- declared-text → front mapping (keyword/synonym, no AI) ----------

export interface TextMatch { front: FrontKey | null; weight: number }
export function mapTextToFront(text: string, catalog: Catalog): TextMatch {
  const h = norm(text);
  let best: TextMatch = { front: null, weight: 0 };
  for (const front of FRONT_ORDER) {
    const def = catalog.fronts.find((f) => f.key === front);
    if (!def) continue;
    let weight = 0;
    for (const t of [...def.synonymsEs, ...def.synonymsEn]) if (containsTerm(h, t)) weight += 1;
    for (const c of catalog.capabilities) {
      if (c.publicationStatus !== 'PUBLISHED' || !c.fronts.some((x) => x.front === front && x.match === 'SPECIFIC')) continue;
      for (const t of [...c.triggerTermsEs, ...c.triggerTermsEn]) if (containsTerm(h, t)) weight += 2;
    }
    if (weight > best.weight) best = { front, weight };
  }
  return best;
}

// ---------- the resolver ----------

function publishedCaps(catalog: Catalog) { return catalog.capabilities.filter((c) => c.publicationStatus === 'PUBLISHED'); }

function countryOf(catalog: Catalog, iso: string): CountryState {
  return catalog.countries.find((c) => c.iso === iso)?.state ?? 'NO_ACTIVE_COVERAGE';
}

export function resolveFront(
  front: FrontKey, dest: string, a: Answers, catalog: Catalog, declaredTexts: string[], plan: DestinationPlan,
): { state: RoutingState; capabilities: ResolvedCapability[]; trace: TraceStep[] } {
  const trace: TraceStep[] = [];
  const comp = plan.component!;
  const caps = publishedCaps(catalog).filter((c) => c.fronts.some((x) => x.front === front));
  const norms = declaredTexts.map(norm);
  const specific = caps.filter((c) => {
    if (!c.fronts.some((x) => x.front === front && x.match === 'SPECIFIC')) return false;
    const byText = [...c.triggerTermsEs, ...c.triggerTermsEn].some((t) => norms.some((n) => containsTerm(n, t)));
    const byData = !!c.triggerRule?.activitiesAny?.some((act) => comp.activities.includes(act));
    return byText || byData;
  });
  let chosen: Capability[];
  if (specific.length) {
    chosen = specific; trace.push({ rule: 'H-024.4', detail: `specific capability matched: ${specific.map((c) => c.capabilityId).join(', ')}` });
  } else {
    chosen = caps.filter((c) => c.fronts.some((x) => x.front === front && x.match === 'DEFAULT'));
    if (chosen.length) trace.push({ rule: 'H-024.5', detail: `front default capabilities: ${chosen.map((c) => c.capabilityId).join(', ')}` });
  }
  if (!chosen.length) {
    trace.push({ rule: 'D-112', detail: 'no capability fits the need' });
    return { state: 'UNMAPPED_NEED', capabilities: [], trace };
  }
  const resolved = chosen.map((c) => {
    const r = evaluateCapability(c, dest, a);
    trace.push({ rule: 'D-111', detail: `${c.capabilityId}: basis ${c.coverageBasis}=${r.basisValue ?? 'n/a'} coverage ${r.coverage} → ${r.state}` });
    // RULE 1: capability dependency (not front dependency). Company setup depends on the open decision of having an own entity.
    if (c.capabilityId === 'CAP_HIVE_FI_COMPANY_SETUP' && comp.presence !== 'own_physical' && comp.presence !== 'own_onsite') { r.conditionalOn = 'own_entity'; r.state = 'DEPENDENT'; }
    return r;
  });
  const state = mostConservative(resolved.filter((r) => !r.conditionalOn || resolved.every((x) => x.conditionalOn)).map((r) => r.state));
  trace.push({ rule: 'H-024', detail: `most conservative state → ${state}` });
  return { state, capabilities: resolved, trace };
}

export function resolveAll(a: Answers, catalog: Catalog): Resolution {
  const dests = a.destinations.open || a.destinations.list.length === 0 ? [OPEN_DEST] : a.destinations.list.map((d) => d.iso);
  const out: DestinationResolution[] = [];

  for (const dest of dests) {
    const plan = planFor(a, dest);
    const trace0: TraceStep[] = [];
    let countryState: DestinationResolution['countryState'];
    let countryMessage: CountryMessageKind | null = null;
    if (dest === OPEN_DEST) { countryState = 'UNDEFINED'; countryMessage = 'UNDEFINED'; trace0.push({ rule: 'D-098', detail: 'destination undefined: single message, no coverage rules' }); }
    else {
      countryState = countryOf(catalog, dest);
      if (countryState !== 'ACTIVE') { countryMessage = countryState; trace0.push({ rule: 'D-095', detail: `${dest} is ${countryState}: single country message` }); }
    }

    const shortcut = a.knowsNeeds === true;
    const topics: DestinationResolution['topics'] = [];
    const needs: ResolvedNeed[] = [];
    const unmapped: UnmappedNeed[] = [];
    if (!plan.component) { out.push({ destination: dest, countryState, countryMessage, plan, topics, needs, unmapped }); continue; }

    // Declared free-text needs (I-19) per destination, mapped to fronts deterministically.
    const textsByFront = new Map<FrontKey, string[]>();
    const declaredFronts = new Set<FrontKey>();
    for (const n of a.addedNeeds.filter((x) => x.destination === dest || (!x.destination && dests.length === 1))) {
      const m = mapTextToFront(n.text, catalog);
      if (!m.front) { unmapped.push({ destination: dest, text: n.text, trace: [{ rule: 'D-112', detail: 'text matches no front or capability' }, ...trace0] }); continue; }
      textsByFront.set(m.front, [...(textsByFront.get(m.front) ?? []), n.text]);
      declaredFronts.add(m.front);
    }

    const pushNeed = (front: FrontKey, kind: 'applies' | 'depends', origin: NeedOrigin, because: Because[], possible: boolean, cause?: DependsCause) => {
      const fa = a.fronts[frontKey(dest, front)] ?? {};
      const status = fa.status ?? null;
      const texts = textsByFront.get(front) ?? [];
      const marked = fa.marked === true;
      const isNeed = kind === 'depends' ? true
        : origin === 'declared' ? true
        : shortcut ? marked || texts.length > 0
        // RULE 5: "do you want support?" is NOT a gate. An applicable, unresolved topic is part of Where beeside adds value even
        // when the answer was "not sure" (or "no"); the support preference is kept as context (support field), never as a filter.
        : status !== 'resolved';
      topics.push({ front, kind, possible, origin, status, notIndicated: shortcut && kind === 'applies' && !marked && texts.length === 0 });
      if (!isNeed) return;
      const trace = [...trace0];
      let state: RoutingState; let capabilities: ResolvedCapability[] = [];
      if (countryMessage) {
        // Country-level message takes precedence; per-service states are not shown (D-095/D-098). Capabilities are still
        // resolved internally (ignoring coverage) so Demand Signals can name them.
        const internal = kind === 'depends' ? null : resolveFront(front, dest, a, catalog, texts, plan);
        state = kind === 'depends' ? 'DEPENDENT' : internal!.state;
        capabilities = internal?.capabilities ?? [];
        if (internal) trace.push(...internal.trace);
      } else if (kind === 'depends') {
        state = 'DEPENDENT'; trace.push({ rule: 'H-024.3', detail: 'open decision → DEPENDENT' });
      } else {
        const r = resolveFront(front, dest, a, catalog, texts, plan);
        state = r.state; capabilities = r.capabilities; trace.push(...r.trace);
      }
      needs.push({
        destination: dest, front, origin, state, capabilities, declaredTexts: texts, because, possible,
        status, support: fa.support ?? null, critical: fa.critical === true,
        ...(cause ? { dependsCause: cause } : {}), trace,
      });
    };

    for (const t of plan.applies) pushNeed(t.front, 'applies', 'derived', t.verdict.because, t.verdict.possible === true);
    for (const t of plan.depends) pushNeed(t.front, 'depends', 'derived', t.verdict.because, false, t.verdict.cause);
    for (const f of declaredFronts) {
      if (plan.applies.some((x) => x.front === f) || plan.depends.some((x) => x.front === f)) continue;
      plan.declaredOnly.push(f);
      pushNeed(f, 'applies', 'declared', ['declared'], false);
    }
    needs.sort((x, y) => FRONT_ORDER.indexOf(x.front) - FRONT_ORDER.indexOf(y.front));
    out.push({ destination: dest, countryState, countryMessage, plan, topics, needs, unmapped });
  }

  const premiumShown = out.some((d) => !d.countryMessage && d.needs.some((n) => ['ACTIVE', 'SOURCEABLE', 'REVIEW'].includes(n.state)));
  return { catalogVersion: catalog.version, destinations: out, premiumShown };
}

/** Destinations where a route-based capability (freight / oversized cargo) is relevant — whether or not I-26 is already answered. */
export function destinationsWithCargoRouteRelevance(a: Answers, catalog: Catalog): string[] {
  const r = resolveAll({ ...a, cargoRoute: {} }, catalog);
  return r.destinations
    .filter((d) => !d.countryMessage)   // never when a single country message already applies (D-095/D-098)
    .filter((d) => d.needs.some((n) => n.state !== 'DEPENDENT' && n.capabilities.some((c) => c.coverageBasis === 'ORIGIN_DESTINATION_ROUTE')))
    .map((d) => d.destination);
}

/** Destinations that still need the I-26 cargo-route question (D-119): relevant AND not yet declared. */
export function destinationsNeedingCargoRoute(a: Answers, catalog: Catalog): string[] {
  return destinationsWithCargoRouteRelevance(a, catalog).filter((d) => a.cargoRoute[d] === undefined);
}

export { dependsCause };
