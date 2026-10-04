import type { Answers, ProjectComponent } from '../domain/answers';
import { OPEN_DEST, componentFor } from '../domain/answers';
import type { FrontKey } from '../domain/types';
import { FRONT_ORDER } from '../catalog/fronts';

/**
 * Deterministic front activation (FA_INFORMATION_MODEL §3, adjusted to the frozen Journeys A/B/C — see docs/RULE_NOTES.md).
 * Every verdict carries the declared facts ("because") that produced it, so each customer-facing conclusion is traceable.
 */
export type Because =
  | 'own_premises' | 'own_plant' | 'own_presence' | 'hire' | 'operate' | 'produce' | 'source' | 'sell'
  | 'goods_cross' | 'goods' | 'carries_people' | 'carries_equipment' | 'onsite_execution' | 'temporary'
  | 'sells_government' | 'own_brand' | 'regulated' | 'regulated_unknown' | 'group_operation' | 'invest_only'
  | 'third_parties' | 'declared';

export type FrontVerdict =
  | { kind: 'applies'; because: Because[]; possible?: boolean; origin: 'derived' | 'declared' }
  | { kind: 'depends'; because: Because[]; cause: DependsCause }
  | { kind: 'none' };
export type DependsCause = 'presence' | 'hire' | 'legal_operation';

const operatesInDestination = (c: ProjectComponent) => c.activities.includes('operate') || c.activities.includes('sell') || c.activities.includes('produce');
const has = (c: ProjectComponent, a: ProjectComponent['activities'][number]) => c.activities.includes(a);
const ownPhysical = (c: ProjectComponent) => c.presence === 'own_physical';
const ownOnsite = (c: ProjectComponent) => c.presence === 'own_onsite';
const ownAny = (c: ProjectComponent) => ownPhysical(c) || ownOnsite(c);
const goods = (c: ProjectComponent) => c.withWhat.includes('goods');
const carriesPeople = (c: ProjectComponent) => c.carries.includes('people');
const carriesEquip = (c: ProjectComponent) => c.carries.includes('equipment');

export function dependsCause(c: ProjectComponent): DependsCause {
  if (ownOnsite(c)) return 'legal_operation';
  if (has(c, 'hire') && !has(c, 'operate') && !has(c, 'sell') && !has(c, 'produce')) return 'hire';
  return 'presence';
}

export function evaluateFront(front: FrontKey, c: ProjectComponent, a: Answers): FrontVerdict {
  const A = (because: Because[], possible = false): FrontVerdict => ({ kind: 'applies', because, possible, origin: 'derived' });
  const D = (because: Because[]): FrontVerdict => ({ kind: 'depends', because, cause: dependsCause(c) });
  const activeProject = !has(c, 'invest_only') && c.activities.length > 0;

  switch (front) {
    case 'FR_SITE':
      return ownPhysical(c) ? A([has(c, 'produce') ? 'own_plant' : 'own_premises']) : { kind: 'none' };
    case 'FR_LEGAL_TAX': {
      // RULE 1 (PO-approved, see FA_INFORMATION_MODEL §3):
      //  1. own presence in destination (physical or on-site) -> APPLIES;
      //  2. an operating presence (operate / sell / produce) whose model or structure is still undefined, with no own-presence
      //     activator -> DEPENDENT on that decision. This precedes local hiring when both occur in the same component;
      //  3. local hiring (and no undefined operating presence, e.g. a talent-only project) -> APPLIES.
      if (!activeProject) return { kind: 'none' };
      if (ownAny(c)) return A(['own_presence', ...(has(c, 'hire') ? (['hire'] as Because[]) : []), ...(has(c, 'operate') ? (['operate'] as Because[]) : [])]);
      if (c.presence === 'open' && operatesInDestination(c)) return D(['operate']);
      if (has(c, 'hire') || has(c, 'operate')) return A([has(c, 'hire') ? 'hire' : 'operate']);
      return { kind: 'none' };
    }
    case 'FR_PERMITS':
      return (has(c, 'produce') || has(c, 'operate')) && ownAny(c)
        ? A([has(c, 'produce') ? 'produce' : ownOnsite(c) ? 'onsite_execution' : 'operate']) : { kind: 'none' };
    case 'FR_RECRUITMENT':
    case 'FR_EMPLOYMENT':
      return has(c, 'hire') ? A(['hire']) : { kind: 'none' };
    case 'FR_MOBILE_STAFF':
      return carriesPeople(c) ? A(['carries_people']) : { kind: 'none' };
    case 'FR_TRADE': {
      if (carriesEquip(c)) return A(['carries_equipment']);
      return goods(c) && (has(c, 'sell') || has(c, 'source') || has(c, 'produce')) ? A(['goods_cross']) : { kind: 'none' };
    }
    case 'FR_LOGISTICS':
      return goods(c) && activeProject ? A(['goods']) : { kind: 'none' };
    case 'FR_SUPPLIERS':
      return has(c, 'source') || has(c, 'produce') || (has(c, 'operate') && ownAny(c))
        ? A([has(c, 'source') ? 'source' : has(c, 'produce') ? 'produce' : 'operate']) : { kind: 'none' };
    case 'FR_BANKING': {
      if (!activeProject) return { kind: 'none' };
      if (ownPhysical(c)) return A(['own_presence']);
      if (c.presence === 'open' || ownOnsite(c)) return D([]);
      return { kind: 'none' };
    }
    case 'FR_INSURANCE':
      return ownPhysical(c) || ownOnsite(c) || carriesPeople(c) || carriesEquip(c)
        ? A([ownPhysical(c) ? 'own_premises' : ownOnsite(c) ? 'onsite_execution' : carriesPeople(c) ? 'carries_people' : 'carries_equipment']) : { kind: 'none' };
    case 'FR_STAFF_HOUSING':
      return ownAny(c) && c.permanence === 'temporary' && (carriesPeople(c) || has(c, 'hire')) ? A(['onsite_execution', 'temporary']) : { kind: 'none' };
    case 'FR_EXIT':
      return c.permanence === 'temporary' && activeProject ? A(['temporary']) : { kind: 'none' };
    case 'FR_PARENT_LINK':
      // RULE 3 (PO-approved): never from the mere fact of operating or hiring abroad. Requires evidence of a real relationship
      // between related entities. The deterministic evidence available in Public v1.0 is an OWN physical presence (plant, office or
      // premises) -> a local entity/branch of the home company; another declared datum may be added later without changing this rule.
      return activeProject && ownPhysical(c) ? A(['group_operation']) : { kind: 'none' };
    case 'FR_GTM':
      return has(c, 'sell') ? A(['sell']) : { kind: 'none' };
    case 'FR_PUBLIC_PROCUREMENT':
      return has(c, 'sell') && (c.sellsTo === 'government' || c.sellsTo === 'mixed') ? A(['sells_government']) : { kind: 'none' };
    case 'FR_LOCAL_PARTNERS':
      return c.presence === 'third_parties' ? A(['third_parties']) : { kind: 'none' };
    case 'FR_REGULATORY':
      if (!activeProject) return { kind: 'none' };
      if (a.regulated === 'yes') return A(['regulated']);
      if (a.regulated === 'unknown') return A(['regulated_unknown'], true);
      return { kind: 'none' };
    case 'FR_BRAND':
      return has(c, 'sell') && c.ownBrand === 'yes' ? A(['own_brand']) : { kind: 'none' };
    case 'FR_INVEST_RC':
      return has(c, 'invest_only') ? A(['invest_only']) : { kind: 'none' };
  }
}

/**
 * RULE 6 (PO-approved, PRESENTATION only): at most three "not relevant" groups, selected deterministically from declared
 * negatives / already-demonstrated rules, shown with the canonical Front Catalog names; fewer when fewer apply.
 */
export type NotApplicableGroup = 'sell' | 'place' | 'goods' | 'housing_exit';
const NA_PRIORITY: NotApplicableGroup[] = ['sell', 'place', 'goods', 'housing_exit'];
/** Fronts that decide whether the group is absent (all must be inactive) ... */
const NA_FRONTS: Record<NotApplicableGroup, FrontKey[]> = {
  sell: ['FR_GTM', 'FR_PUBLIC_PROCUREMENT', 'FR_BRAND', 'FR_LOCAL_PARTNERS'],
  place: ['FR_SITE'],
  goods: ['FR_TRADE', 'FR_LOGISTICS'],
  housing_exit: ['FR_STAFF_HOUSING', 'FR_EXIT'],
};
/** ... and the canonical front names displayed for it. */
export const NA_DISPLAY_FRONTS: Record<NotApplicableGroup, FrontKey[]> = {
  sell: ['FR_GTM', 'FR_BRAND'], place: ['FR_SITE'], goods: ['FR_TRADE', 'FR_LOGISTICS'], housing_exit: ['FR_STAFF_HOUSING', 'FR_EXIT'],
};

export interface DestinationPlan {
  destination: string;
  component?: ProjectComponent;
  applies: Array<{ front: FrontKey; verdict: Extract<FrontVerdict, { kind: 'applies' }> }>;
  depends: Array<{ front: FrontKey; verdict: Extract<FrontVerdict, { kind: 'depends' }> }>;
  dependsCause?: DependsCause;
  notApplicable: NotApplicableGroup[];
  /** Fronts not part of the plan but declared by the user via free text (I-19). */
  declaredOnly: FrontKey[];
}

/** Which "not applicable" groups to demonstrate judgement on (max 3, priority-ordered; derived from declared negatives only). */
function notApplicableFor(c: ProjectComponent, verdicts: Map<FrontKey, FrontVerdict>): NotApplicableGroup[] {
  const out: NotApplicableGroup[] = [];
  for (const g of NA_PRIORITY) {
    const members = NA_FRONTS[g];
    if (members.some((f) => verdicts.get(f)?.kind !== 'none')) continue;
    if (g === 'sell' && c.activities.includes('sell')) continue;
    if (g === 'place' && c.presence === 'own_physical') continue;
    if (g === 'housing_exit' && c.permanence !== 'permanent') continue;
    if (g === 'goods' && c.withWhat.includes('goods')) continue;
    if (c.activities.includes('invest_only')) continue;
    out.push(g);
  }
  return out.slice(0, 3);
}

export function planFor(a: Answers, dest: string): DestinationPlan {
  const comp = componentFor(a, dest);
  const plan: DestinationPlan = { destination: dest, component: comp, applies: [], depends: [], notApplicable: [], declaredOnly: [] };
  if (!comp) return plan;
  const verdicts = new Map<FrontKey, FrontVerdict>();
  for (const f of FRONT_ORDER) verdicts.set(f, evaluateFront(f, comp, a));
  for (const f of FRONT_ORDER) {
    const v = verdicts.get(f)!;
    if (v.kind === 'applies') plan.applies.push({ front: f, verdict: v });
    if (v.kind === 'depends') plan.depends.push({ front: f, verdict: v });
  }
  if (plan.depends.length) plan.dependsCause = plan.depends[0]!.verdict.cause;
  plan.notApplicable = notApplicableFor(comp, verdicts);
  return plan;
}

export function plansFor(a: Answers): DestinationPlan[] {
  const dests = a.destinations.open || a.destinations.list.length === 0 ? [OPEN_DEST] : a.destinations.list.map((d) => d.iso);
  return dests.map((d) => planFor(a, d));
}
