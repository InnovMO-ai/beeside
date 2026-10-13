import type { Answers } from '../domain/answers';
import type { Catalog } from '../domain/types';

/** Six-stage progress structure (frozen). The cover and identity precede stage 1. */
export const STAGES = ['company', 'project', 'whyWhen', 'needs', 'more', 'result'] as const;
export type StageId = (typeof STAGES)[number];

export type StepId =
  | 'cover' | 'identity' | 'company' | 'exit'
  | 'destinations' | 'activity' | 'presence'
  | 'reason' | 'decision'
  | 'activators' | 'activators_sell' | 'activators_site'
  | 'fronts_status' | 'fronts_mark' | 'fronts_support' | 'fronts_critical'
  | 'support_values' | 'extra' | 'result';
export interface StepRef { id: StepId; comp?: string }
export const stepKey = (s: StepRef) => (s.comp ? `${s.id}:${s.comp}` : s.id);

export const STAGE_OF: Record<StepId, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  cover: 0, identity: 0, company: 1, exit: 1,
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
  if (a.company.hasExistingBusiness === false) { s.push({ id: 'exit' }); return s; }   // eligibility gate (D-038)
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
    default: return key;
  }
}

const STEP_ORDER: StepId[] = ['cover', 'identity', 'company', 'exit', 'destinations', 'activity', 'presence', 'reason', 'decision',
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

/** Required-input check for "Continue". Optional steps are always complete. */
export function isStepComplete(step: StepRef, a: Answers): boolean {
  const comp = step.comp ? a.components.find((c) => c.id === step.comp) : undefined;
  switch (step.id) {
    case 'cover': return true;
    case 'identity': return !!a.identity.name.trim() && !!a.identity.company.trim() && isValidEmail(a.identity.email) && a.identity.decider !== null && a.identity.termsAccepted && a.identity.privacyAcknowledged;
    case 'company': return a.company.hasExistingBusiness !== null && (a.company.hasExistingBusiness === false || (!!a.company.sector.trim() && a.company.size !== null && a.company.operatesIn.length > 0));
    case 'destinations': return (a.destinations.open || a.destinations.list.length > 0) && (a.destinations.open || a.destinations.list.length < 2 || a.destinations.sameInAll !== null);
    case 'activity': return !!comp && comp.activities.length > 0 && (!comp.activities.some((x) => x === 'sell' || x === 'produce' || x === 'source') || comp.withWhat.length > 0);
    case 'presence': return !!comp && comp.presence !== null && comp.permanence !== null && (comp.permanence !== 'temporary' || comp.durationMonths === undefined || comp.durationMonths > 0) && comp.existing !== null;
    case 'reason': return a.reasons.length > 0 || a.reasonText.trim().length > 0;
    case 'decision': return a.decision !== null && (a.externalDate.has !== null);
    case 'activators': case 'activators_sell': case 'activators_site': return true;
    case 'fronts_mark': return true;
    default: return true;
  }
}
