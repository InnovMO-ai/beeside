import { emptyAnswers } from '../domain/answers';
import { journeyB, journeyNortica, journeyNewBusiness } from '../testing/journeys';
import { buildFlow, isStepComplete, missingRequired, stepKey } from '../engine/flow';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe('required inputs per screen (what is missing, in screen order)', () => {
  it('identity: every required item is reported; role and marketing never are', () => {
    expect(missingRequired({ id: 'identity' }, emptyAnswers('es'))).toEqual(['identity.name', 'identity.company', 'identity.email', 'identity.decider', 'identity.terms', 'identity.privacy']);
    const a = emptyAnswers('es'); a.identity = { ...a.identity, name: 'Ana', company: 'Acme', email: 'ana@acme.example', decider: 'me', termsAccepted: true, privacyAcknowledged: true };
    expect(missingRequired({ id: 'identity' }, a)).toEqual([]);
    expect(missingRequired({ id: 'identity' }, { ...a, identity: { ...a.identity, email: 'not-an-email' } })).toEqual(['identity.email']);
  });
  it('a complete journey has nothing missing on any screen; the single-answer gaps are named', () => {
    for (const j of [journeyB('es'), journeyNortica('es'), journeyNewBusiness('es')]) {
      const a = clone(j); a.knowsNeeds = false;
      for (const s of buildFlow(a).filter((x) => !['cover', 'identity', 'result'].includes(x.id))) {
        const ctx = { cargoRouteDestinations: [] as string[], desktop: false };
        expect([stepKey(s), missingRequired(s, a, ctx)]).toEqual([stepKey(s), []]);
      }
    }
  });
  it('destinations: neither countries nor «not decided» → list; two countries → «same in all?»', () => {
    const a = emptyAnswers('es');
    expect(missingRequired({ id: 'destinations' }, a)).toEqual(['dest.list']);
    a.destinations.list = [{ iso: 'MX' }, { iso: 'US' }];
    expect(missingRequired({ id: 'destinations' }, a)).toEqual(['dest.same']);
    a.destinations.sameInAll = false; expect(missingRequired({ id: 'destinations' }, a)).toEqual([]);
    expect(missingRequired({ id: 'destinations' }, { ...emptyAnswers('es'), destinations: { list: [], open: true, sameInAll: null } })).toEqual([]);
  });
  it('decision: state, when to start and «external deadline yes/no»; the date of the deadline and the project size stay optional', () => {
    const a = emptyAnswers('es');
    expect(missingRequired({ id: 'decision' }, a)).toEqual(['dec.state', 'dec.start', 'dec.ext']);
    const b = { ...a, decision: 'exploring' as const, startWhen: 'asap' as const, externalDate: { has: true as const } };
    expect(missingRequired({ id: 'decision' }, b)).toEqual([]);
  });
  it('activators: only the questions that are on the screen are required', () => {
    const a = clone(journeyNortica('es')); a.regulated = null; for (const c of a.components) { c.sellsTo = null; c.ownBrand = null; c.location = null; c.carries = []; }
    const miss = missingRequired({ id: 'activators' }, a);
    expect(miss).toContain('reg'); expect(miss.some((k) => k.startsWith('to-'))).toBe(true); expect(miss.some((k) => k.startsWith('ca-'))).toBe(true);
    expect(missingRequired({ id: 'activators_sell' }, a).some((k) => k.startsWith('lo-'))).toBe(false);
    expect(missingRequired({ id: 'activators_site' }, a).includes('reg')).toBe(false);
  });
  it('topics (status / support) and the cargo route are NOT required: the approved design tolerates unanswered topics (the result has a sentence for them)', () => {
    const a = clone(journeyB('es')); a.knowsNeeds = false; a.fronts = {}; a.cargoRoute = {};
    for (const id of ['fronts_status', 'fronts_support', 'fronts_mark'] as const) expect(missingRequired({ id }, a, { desktop: true, cargoRouteDestinations: ['MX'] })).toEqual([]);
  });
  it('never required: «Algo más», the marked-topics shortcut, the clarity question, critical dates', () => {
    const a = emptyAnswers('es');
    for (const id of ['support_values', 'extra', 'fronts_mark', 'fronts_critical'] as const) expect(isStepComplete({ id }, a)).toBe(true);
    expect(a.knowsNeeds).toBeNull();
  });
});
