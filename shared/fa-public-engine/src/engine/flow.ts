import type { Answers } from '../domain/answers';
import type { Catalog } from '../domain/types';

/** Six-stage progress structure (frozen). The cover and identity precede stage 1. */
export const STAGES = ['company', 'project', 'whyWhen', 'needs', 'more', 'result'] as const;
export type StageId = (typeof STAGES)[number];

export type StepId =
  | 'cover' | 'identity' | 'company'
  | 'destinations' | 'activity' | 'presence'
  | 'reason' | 'decision'
  | 'activators' | 'activators_sell' | 'activators_site'
  | 'fronts_status' | 'fronts_mark' | 'fronts_support' | 'fronts_critical'
  | 'support_values' | 'extra' | 'result';
export interface StepRef { id: StepId; comp?: string }
export const stepKey = (s: StepRef) => (s.comp ? `${s.id}:${s.comp}` : s.id);

export const STAGE_OF: Record<StepId, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  cover: 0, identity: 0, company: 1,
  destinations: 2, activity: 2, presence: 2,
  reason: 3, decision: 3,
  activators: 4, activators_sell: 4, activators_site: 4, fronts_status: 4, fronts_mark: 4, fronts_support: 4, fronts_critical: 4,
  support_values: 5, extra: 5, result: 6,
};

/** Which conditional activator questions apply (I-08…I-12). Nothing derivable is ever asked. */
export function activatorFields(a: Answers): { regulated: boolean; sells: string[]; brand: string[]; location: string[]; carries: string[] } {
  const active = a.components.filter((c) => !c.activities.includes('invest_only') && c.activities.length > 0);
  return {
    regulated: active.length > 0,
    sells: active.filter((c) => c.activities.includes('sell')).map((c) => c.id),
    brand: active.filter((c) => c.activities.includes('sell')).map((c) => c.id),
    location: active.filter((c) => c.presence === 'own_physical' || c.presence === 'own_onsite').map((c) => c.id),
    carries: active.filter((c) => c.presence === 'own_physical' || c.presence === 'own_onsite').map((c) => c.id),
  };
}
export function activatorCount(a: Answers): number {
  const f = activatorFields(a);
  return (f.regulated ? 1 : 0) + (f.sells.length ? 1 : 0) + (f.brand.length ? 1 : 0) + (f.location.length ? 1 : 0) + (f.carries.length ? 1 : 0);
}

/** The ordered list of steps for the current answers. Pure and deterministic; the UI only walks this list. */
/** Kept for API stability: the flow no longer depends on it (the cargo-route question is a block of the topics screen). */
export interface FlowContext { cargoRouteDestinations: string[] }

/**
 * Final Design Delta: merged screens. «same in all countries?» lives in `destinations`; «what do you have there today?» lives in `presence`;
 * the old «this is what we understand» checkpoint is gone (its canonical question «Do you already know what you need?» is asked at the end of the
 * LAST project screen, see `lastProjectStep`); the project size is asked inside `decision`; the cargo-route question is a block of the topics screen.
 */
export function buildFlow(a: Answers, _catalog?: Catalog | FlowContext): StepRef[] {
  const s: StepRef[] = [{ id: 'cover' }, { id: 'identity' }, { id: 'company' }];
  // No eligibility gate: «no business operating today» is a valid Discovery case (a new business / new operation abroad). It follows the SAME journey;
  // only the current-operation questions on the company screen (sector, size, countries of activity) are not asked.
  s.push({ id: 'destinations' });
  const comps = a.components.length ? a.components : [];
  for (const c of comps) {
    s.push({ id: 'activity', comp: c.id });
    const onlyInvest = c.activities.length === 1 && c.activities[0] === 'invest_only';
    if (!onlyInvest) s.push({ id: 'presence', comp: c.id });
  }
  const shortcut = a.knowsNeeds === true;
  s.push({ id: 'reason' }, { id: 'decision' });
  const n = activatorCount(a);
  if (n >= 1) {
    if (n <= 2) s.push({ id: 'activators' });
    else {
      // VT-03: a thematic screen exists only if it has at least one question to show (never an empty "what you set up there" screen).
      const f = activatorFields(a);
      if ((f.regulated ? 1 : 0) + f.sells.length + f.brand.length > 0) s.push({ id: 'activators_sell' });
      if (f.location.length + f.carries.length > 0) s.push({ id: 'activators_site' });
    }
  }
  if (shortcut) s.push({ id: 'fronts_mark' });
  else s.push({ id: 'fronts_status' }, { id: 'fronts_support' });
  if (a.externalDate.has) s.push({ id: 'fronts_critical' });
  s.push({ id: 'support_values' }, { id: 'extra' }, { id: 'result' });
  return s;
}

/** The last screen of «Tu proyecto»: where the canonical clarity question (D-079 shortcut) lives. */
export function lastProjectStep(a: Answers): StepRef {
  const comps = a.components;
  for (let i = comps.length - 1; i >= 0; i--) {
    const c = comps[i]!;
    if (!(c.activities.length === 1 && c.activities[0] === 'invest_only')) return { id: 'presence', comp: c.id };
  }
  return comps.length ? { id: 'activity', comp: comps[comps.length - 1]!.id } : { id: 'destinations' };
}

/** Saved `step_key` values of screens that no longer exist → the surviving logical screen (resume never lands on a removed screen). */
export function normalizeStepKey(key: string, a: Answers): string {
  const [id, comp] = key.split(':');
  switch (id) {
    case 'reflection': return stepKey(lastProjectStep(a));
    case 'same_in_all': return 'destinations';
    case 'existing': return comp ? `presence:${comp}` : stepKey(lastProjectStep(a));
    case 'scale': return 'decision';
    case 'cargo_route': return a.knowsNeeds === true ? 'fronts_mark' : 'fronts_support';
    case 'exit': return 'destinations';   // the old «only for operating businesses» screen no longer exists
    default: return key;
  }
}

const STEP_ORDER: StepId[] = ['cover', 'identity', 'company', 'destinations', 'activity', 'presence', 'reason', 'decision',
  'activators', 'activators_sell', 'activators_site', 'fronts_status', 'fronts_mark', 'fronts_support', 'fronts_critical', 'support_values', 'extra', 'result'];

/** Next step. If the current step has just left the flow (an answer made it irrelevant), continue in canonical order instead of jumping back. */
export function nextStep(a: Answers, catalog: Catalog | FlowContext, current: StepRef): StepRef {
  const f = buildFlow(a, catalog); const i = f.findIndex((x) => stepKey(x) === stepKey(current));
  if (i >= 0) return f[Math.min(f.length - 1, i + 1)]!;
  const cur = STEP_ORDER.indexOf(current.id);
  return f.find((x) => STEP_ORDER.indexOf(x.id) > cur) ?? f[f.length - 1]!;
}
export function prevStep(a: Answers, catalog: Catalog | FlowContext, current: StepRef): StepRef {
  const f = buildFlow(a, catalog); const i = f.findIndex((x) => stepKey(x) === stepKey(current));
  if (i >= 0) return f[Math.max(0, i - 1)]!;
  const cur = STEP_ORDER.indexOf(current.id);
  return [...f].reverse().find((x) => STEP_ORDER.indexOf(x.id) < cur) ?? f[0]!;
}
/** Index (1-based) of the stage for the "n de 6" indicator. */
export const stageNumber = (id: StepId) => STAGE_OF[id];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function isValidEmail(v: string) { return EMAIL.test(v.trim()); }

/** Reserved for screens whose questions depend on the server-side resolution (none is required today). */
export interface RequiredCtx { cargoRouteDestinations?: string[]; desktop?: boolean }

/**
 * The REQUIRED inputs still missing on a screen, as stable keys in the order they appear (so the UI can say which one and focus the first).
 * Required = what the approved Interaction Model asks «always» (or conditionally, when the question is on the screen) and that has an explicit answer for every case
 * ("not sure" / "not decided" are answers). Never required: role, regions, notes and free text, the date of an external deadline, the project size (I-14), the clarity
 * question (I-19: unanswered = NO), the topic statuses/support and the cargo route (the design tolerates unanswered topics), the «mark the topics» shortcut,
 * the critical-date choice, the whole «Algo más» block and the marketing consent.
 */
export function missingRequired(step: StepRef, a: Answers, ctx: RequiredCtx = {}): string[] {
  const m: string[] = [];
  const comp = step.comp ? a.components.find((c) => c.id === step.comp) : undefined;
  switch (step.id) {
    case 'identity':
      if (!a.identity.name.trim()) m.push('identity.name');
      if (!a.identity.company.trim()) m.push('identity.company');
      if (!isValidEmail(a.identity.email)) m.push('identity.email');
      if (a.identity.decider === null) m.push('identity.decider');
      if (!a.identity.termsAccepted) m.push('identity.terms');
      if (!a.identity.privacyAcknowledged) m.push('identity.privacy');
      break;
    case 'company':
      if (a.company.hasExistingBusiness === null) m.push('company.hasBiz');
      else if (a.company.hasExistingBusiness) {
        if (!a.company.sector.trim()) m.push('company.sector');
        if (a.company.size === null) m.push('company.size');
        if (a.company.operatesIn.length === 0) m.push('company.operatesIn');
      }
      break;
    case 'destinations':
      if (!a.destinations.open && a.destinations.list.length === 0) m.push('dest.list');
      else if (!a.destinations.open && a.destinations.list.length >= 2 && a.destinations.sameInAll === null) m.push('dest.same');
      break;
    case 'activity':
      if (!comp) break;
      if (comp.activities.length === 0) m.push('act.acts');
      else if (comp.activities.some((x) => x === 'sell' || x === 'produce' || x === 'source') && comp.withWhat.length === 0) m.push('act.with');
      break;
    case 'presence':
      if (!comp) break;
      if (comp.presence === null) m.push('pres.how');
      if (comp.permanence === null) m.push('pres.perm');
      if (comp.existing === null) m.push('pres.exist');
      break;
    case 'reason':
      if (a.reasons.length === 0 && a.reasonText.trim().length === 0) m.push('reason');
      break;
    case 'decision':
      if (a.decision === null) m.push('dec.state');
      if (a.startWhen === null) m.push('dec.start');
      if (a.externalDate.has === null) m.push('dec.ext');
      break;
    case 'activators': case 'activators_sell': case 'activators_site': {
      const f = activatorFields(a); const sell = step.id !== 'activators_site'; const site = step.id !== 'activators_sell';
      if (sell && f.regulated && a.regulated === null) m.push('reg');
      if (sell) for (const c of a.components.filter((x) => f.sells.includes(x.id))) { if (c.sellsTo === null) m.push(`to-${c.id}`); if (c.ownBrand === null) m.push(`br-${c.id}`); }
      if (site) for (const c of a.components.filter((x) => f.location.includes(x.id))) { if (c.location === null) m.push(`lo-${c.id}`); if (c.carries.length === 0) m.push(`ca-${c.id}`); }
      break;
    }
    // Topics (status / support) and the cargo route are deliberately NOT required: the approved design tolerates unanswered topics (the result has its own sentence for them, D-079/D-119).
    default: break;
  }
  return m;
}

/** "Continue" is allowed only when nothing required is missing. Optional steps are always complete. */
export function isStepComplete(step: StepRef, a: Answers, ctx: RequiredCtx = {}): boolean { return missingRequired(step, a, ctx).length === 0; }
