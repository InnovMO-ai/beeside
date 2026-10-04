import { SEED_CATALOG } from '../catalog/seed';
import { resolveAll, destinationsNeedingCargoRoute } from '../engine/resolve';
import { buildYourExpansionView } from '../engine/yev';
import { deriveDemandSignals } from '../engine/demand';
import { buildFlow, nextStep, prevStep, stepKey } from '../engine/flow';
import { journeyA, journeyB, journeyC } from '../testing/journeys';
import { deriveDecision } from '../domain/answers';
import type { Answers } from '../domain/answers';

const cat = SEED_CATALOG;
const states = (a: Answers, dest: string) => {
  const r = resolveAll(a, cat);
  return Object.fromEntries(r.destinations.find((d) => d.destination === dest)!.needs.map((n) => [n.front, n.state]));
};
const naNames = (d: { notApplicable: Array<{ fronts: Array<{ name: { es: string } }> }> }) => d.notApplicable.map((n) => n.fronts.map((f) => f.name.es).join(' · '));
const flowIds = (a: Answers) => buildFlow(a, cat).map(stepKey);

describe('Journey A — simple / focused', () => {
  const a = journeyA();
  it('activates exactly 3 topics + 1 that depends, and states them from the catalog', () => {
    expect(states(a, 'MX')).toEqual({
      FR_LEGAL_TAX: 'ACTIVE', FR_RECRUITMENT: 'SOURCEABLE', FR_EMPLOYMENT: 'ACTIVE', FR_BANKING: 'DEPENDENT',
    });
    const y = buildYourExpansionView(a, cat);
    expect(y.counts).toMatchObject({ applies: 3, depends: 1 });
    expect(y.destinations[0]!.depends?.cause).toBe('hire');
  });
  it('asks only the conditional questions that apply (no location/carries, no sell questions)', () => {
    const ids = flowIds(a);
    expect(ids).toContain('activators');           // regulated only → single step
    expect(ids).not.toContain('activators_site');
    expect(ids).not.toContain('same_in_all');
    expect(ids).not.toContain('cargo_route');
    expect(ids).toContain('scale');
  });
  it('shows country-agnostic judgement: not-applicable groups, capped at three', () => {
    const y = buildYourExpansionView(a, cat);
    expect(naNames(y.destinations[0]!)).toEqual(['Vender y llegar a tus clientes · Proteger tu marca', 'Dónde vas a operar (oficina, planta, local)', 'Importación y aduanas · Logística e inventario']);
  });
  it('offers Premium continuation (real value) and reports where the user is', () => {
    const y = buildYourExpansionView(a, cat);
    expect(y.premium.shown).toBe(true);
    expect(y.whereYouAre).toMatchObject({ resolved: 0, inProgress: 0, pending: 3 });
    expect(y.premium.headline.es).toContain('México');
  });
});

describe('Journey B — complex multi-country', () => {
  const a = journeyB('es', 'unknown');
  it('Mexico: 11 topics → 7 ACTIVE, 1 SOURCEABLE, 2 REVIEW (incl. route-based freight), 1 NOT_OFFERED', () => {
    const s = states(a, 'MX');
    expect(Object.keys(s)).toHaveLength(11);
    const tally = Object.values(s).reduce<Record<string, number>>((m, v) => ({ ...m, [v]: (m[v] ?? 0) + 1 }), {});
    expect(tally).toEqual({ ACTIVE: 7, SOURCEABLE: 1, REVIEW: 2, NOT_OFFERED: 1 });
    expect(s.FR_LOGISTICS).toBe('REVIEW');         // 3PL ACTIVE but freight route not declared → most conservative
    expect(s.FR_SITE).toBe('ACTIVE');              // industrial real estate triggered by "produce" (SPECIFIC via project data)
    expect(s.FR_PERMITS).toBe('NOT_OFFERED');
    expect(s.FR_SUPPLIERS).toBe('REVIEW');
  });
  it('United States: a single country message, never per-service states (D-095)', () => {
    const y = buildYourExpansionView(a, cat);
    const us = y.destinations.find((d) => d.destination === 'US')!;
    expect(us.countryMessage).toBe('NO_ACTIVE_COVERAGE');
    expect(us.valueGroups).toEqual([]);
    expect(us.topicCount).toBe(4);
    expect(us.applies.map((t) => t.front)).toEqual(['FR_RECRUITMENT', 'FR_EMPLOYMENT']);
    expect(us.depends?.topics.map((t) => t.front)).toEqual(['FR_LEGAL_TAX', 'FR_BANKING']);
    expect(us.depends?.cause).toBe('presence');
    expect(us.region).toBe('Texas');
  });
  it('groups the YEV by destination and scales (13 apply, 2 depend, 9 unanswered)', () => {
    const y = buildYourExpansionView(a, cat);
    expect(y.destinations.map((d) => d.destination)).toEqual(['MX', 'US']);
    expect(y.counts).toMatchObject({ applies: 13, depends: 2 });
    expect(y.whereYouAre).toMatchObject({ resolved: 0, inProgress: 2, pending: 4, unanswered: 9 });
    expect(y.title.es).toBe('Planta propia en México y presencia comercial y de ingeniería en Texas');
    expect(naNames(y.destinations[0]!)).toEqual(['Vender y llegar a tus clientes · Proteger tu marca', 'Alojamiento y traslados del equipo · Cerrar ordenadamente al terminar']);
  });
  it('transport route I-26: asked when freight is relevant and undeclared; never inferred', () => {
    const undeclared = journeyB('es');
    expect(destinationsNeedingCargoRoute(undeclared, cat)).toEqual(['MX']);
    expect(flowIds(undeclared)).toContain('cargo_route');
    expect(destinationsNeedingCargoRoute(a, cat)).toEqual([]);          // already declared → not asked again
    expect(flowIds(a)).toContain('cargo_route');                         // …but the step stays reachable so the answer can be edited
    expect(flowIds(journeyA())).not.toContain('cargo_route');            // no freight relevance → never asked
  });
  it('I-26 "within" confirms only the domestic leg → logistics ACTIVE; "both"/"into" stay REVIEW', () => {
    expect(states(journeyB('es', 'within'), 'MX').FR_LOGISTICS).toBe('ACTIVE');
    expect(states(journeyB('es', 'into_from_abroad'), 'MX').FR_LOGISTICS).toBe('REVIEW');
    expect(states(journeyB('es', 'both'), 'MX').FR_LOGISTICS).toBe('REVIEW');
  });
  it('multi-destination asks "same in all?" and a component per destination', () => {
    const ids = flowIds(a);
    expect(ids).toContain('same_in_all');
    expect(ids).toContain('activity:mx'); expect(ids).toContain('activity:us');
    expect(ids).toContain('activators_sell'); expect(ids).toContain('activators_site');
    expect(ids).toContain('fronts_critical');     // external calendar declared
  });
  it('demand signals: ACTIONABLE for sourceable/review/uncovered country, INFORMATIONAL for not-offered', () => {
    const res = resolveAll(a, cat);
    const sig = deriveDemandSignals('p1', a, res, cat);
    const by = (r: string) => sig.filter((s) => s.reason === r);
    expect(by('SOURCEABLE').map((s) => s.capabilityId)).toEqual(['CAP_HIVE_HR_RECRUITMENT']);
    expect(by('NO_ACTIVE_COVERAGE').every((s) => s.destination === 'US' && s.class === 'ACTIONABLE')).toBe(true);
    expect(by('NOT_OFFERED')).toHaveLength(1);
    expect(by('NOT_OFFERED')[0]).toMatchObject({ class: 'INFORMATIONAL', capabilityId: 'CAP_HIVE_LEGAL_PERMITS', sourcingStatus: null });
    // Strategic Advisory REVIEW and confirmed ACTIVE never create signals
    expect(sig.some((s) => s.capabilityId?.startsWith('CAP_SA_'))).toBe(false);
    expect(sig.some((s) => s.capabilityId === 'CAP_HIVE_FI_TAX')).toBe(false);
    // no duplicates
    expect(new Set(sig.map((s) => s.signalId)).size).toBe(sig.length);
  });
});

describe('Journey C — "I know what I need" shortcut', () => {
  const a = journeyC('es', 'unknown');
  it('marked topics are resolved from the catalog; unmarked are NOT INDICATED, never resolved (D-079)', () => {
    const s = states(a, 'MX');
    expect(s).toEqual({
      FR_LEGAL_TAX: 'ACTIVE', FR_RECRUITMENT: 'SOURCEABLE', FR_EMPLOYMENT: 'ACTIVE', FR_MOBILE_STAFF: 'REVIEW',
      FR_LOGISTICS: 'REVIEW', FR_SUPPLIERS: 'REVIEW', FR_BANKING: 'DEPENDENT', FR_INSURANCE: 'ACTIVE', FR_STAFF_HOUSING: 'SOURCEABLE',
    });
    const y = buildYourExpansionView(a, cat);
    expect(y.counts).toMatchObject({ applies: 12, depends: 1, marked: 8, notIndicated: 4 });
    const d = y.destinations[0]!;
    expect(d.notIndicated.map((t) => t.front).sort()).toEqual(['FR_EXIT', 'FR_PERMITS', 'FR_REGULATORY', 'FR_TRADE']);
    expect(y.whereYouAre.resolved).toBe(0);
    expect(y.whereYouAre.notIndicated).toBe(4);
    for (const t of d.notIndicated) expect(d.valueGroups.flatMap((g) => g.items).some((i) => i.front === t.front)).toBe(false);
  });
  it('vocabulary: user words map to fronts by keyword (grúas→suppliers, transporte especializado→logistics oversized, alojamiento→housing)', () => {
    const res = resolveAll(a, cat);
    const mx = res.destinations[0]!;
    const get = (f: string) => mx.needs.find((n) => n.front === f)!;
    expect(get('FR_SUPPLIERS').declaredTexts).toEqual(['grúas de gran capacidad']);
    expect(get('FR_LOGISTICS').capabilities.map((c) => c.capabilityId)).toEqual(['CAP_HIVE_OL_OVERSIZED_CARGO']);
    expect(get('FR_STAFF_HOUSING').declaredTexts).toEqual(['alojamiento']);
    expect(get('FR_REGULATORY')).toBeUndefined();   // possible but not indicated → not a need
  });
  it('oversized cargo is never deduced from standard freight; route unknown → REVIEW, within → ACTIVE', () => {
    expect(states(journeyC('es', 'within'), 'MX').FR_LOGISTICS).toBe('ACTIVE');
    expect(states(journeyC('es', 'unknown'), 'MX').FR_LOGISTICS).toBe('REVIEW');
    expect(destinationsNeedingCargoRoute(journeyC('es'), cat)).toEqual(['MX']);
  });
  it('shortcut flow skips scale and the status/support steps but keeps activators BEFORE the list', () => {
    const ids = flowIds(a);
    expect(ids).not.toContain('scale'); expect(ids).not.toContain('fronts_status'); expect(ids).not.toContain('fronts_support');
    expect(ids.indexOf('activators_site') > -1 ? ids.indexOf('activators_site') : ids.indexOf('activators')).toBeLessThan(ids.indexOf('fronts_mark'));
    expect(ids.indexOf('fronts_mark')).toBeLessThan(ids.indexOf('fronts_critical'));
  });
  it('critical-date marks are kept for the 4 topics', () => {
    const res = resolveAll(a, cat);
    expect(res.destinations[0]!.needs.filter((n) => n.critical).map((n) => n.front).sort()).toEqual(['FR_LOGISTICS', 'FR_MOBILE_STAFF', 'FR_RECRUITMENT', 'FR_SUPPLIERS']);
  });
});

describe('navigation is robust when an answer removes the current step from the flow', () => {
  it('moves forward/back in canonical order instead of jumping to the cover', () => {
    const a = journeyA();                                   // 'cargo_route' is not part of A's flow
    expect(nextStep(a, cat, { id: 'cargo_route' }).id).toBe('support_values');
    expect(prevStep(a, cat, { id: 'cargo_route' }).id).toBe('fronts_support');
    const b = journeyB('es', 'unknown');
    expect(nextStep(b, cat, { id: 'cargo_route' }).id).toBe('support_values');
  });
});

describe('PO-approved rules 1, 3, 5, 6, 7, 8, 9', () => {
  const mk = (over: Partial<import('../domain/answers').ProjectComponent>, extra: Partial<Answers> = {}) => {
    const a = journeyA();
    a.components = [{ ...a.components[0]!, ...over }];
    return Object.assign(a, extra);
  };
  const front = (a: Answers, f: string) => {
    const t = resolveAll(a, cat).destinations[0]!.topics.find((x) => x.front === f);
    return t ? t.kind : 'none';
  };

  it('Rule 1 — legal/tax: local hiring applies; an operating presence with an undefined model depends; own presence applies', () => {
    expect(front(mk({ activities: ['hire'], presence: 'open' }), 'FR_LEGAL_TAX')).toBe('applies');                      // Journey A
    expect(front(mk({ activities: ['operate', 'hire'], presence: 'open' }), 'FR_LEGAL_TAX')).toBe('depends');           // B Texas
    expect(front(mk({ activities: ['sell'], withWhat: ['goods'], presence: 'open' }), 'FR_LEGAL_TAX')).toBe('depends');
    expect(front(mk({ activities: ['produce'], withWhat: ['goods'], presence: 'open' }), 'FR_LEGAL_TAX')).toBe('depends');
    expect(front(mk({ activities: ['operate', 'hire'], presence: 'own_onsite' }), 'FR_LEGAL_TAX')).toBe('applies');
    expect(front(mk({ activities: ['operate'], presence: 'own_physical' }), 'FR_LEGAL_TAX')).toBe('applies');
    expect(front(mk({ activities: ['hire'], presence: 'third_parties' }), 'FR_LEGAL_TAX')).toBe('applies');
  });
  it('Rule 2 — banking: applies with confirmed own physical presence; depends while the operating/structure model is open', () => {
    expect(front(mk({ activities: ['hire'], presence: 'own_physical' }), 'FR_BANKING')).toBe('applies');
    expect(front(mk({ activities: ['hire'], presence: 'open' }), 'FR_BANKING')).toBe('depends');
    expect(front(mk({ activities: ['operate'], presence: 'own_onsite' }), 'FR_BANKING')).toBe('depends');
    expect(front(mk({ activities: ['hire'], presence: 'remote' }), 'FR_BANKING')).toBe('none');
  });
  it('Rule 3 — relation with the home company: never from operating or hiring alone; needs evidence of related entities', () => {
    for (const c of [{ activities: ['hire'], presence: 'open' }, { activities: ['operate', 'hire', 'source'], presence: 'own_onsite' }, { activities: ['operate'], presence: 'third_parties' }] as const)
      expect(front(mk(c as never), 'FR_PARENT_LINK')).toBe('none');
    expect(front(journeyA(), 'FR_PARENT_LINK')).toBe('none');
    expect(front(journeyC(), 'FR_PARENT_LINK')).toBe('none');
    expect(resolveAll(journeyB(), cat).destinations[0]!.topics.some((t) => t.front === 'FR_PARENT_LINK')).toBe(true);     // own plant + local entity
    expect(front(mk({ activities: ['sell'], presence: 'own_physical', withWhat: ['goods'] }), 'FR_PARENT_LINK')).toBe('applies');
  });
  it('Rule 4 — own_onsite is a first-class presence value', () => {
    expect(journeyC().components[0]!.presence).toBe('own_onsite');
    expect(front(journeyC(), 'FR_SITE')).toBe('none');                                                                      // no own space
  });
  it('Rule 5 — "want support?" is not a gate: unknown / no keep the need in Where beeside adds value; resolved removes it', () => {
    const a = journeyA();
    const inValue = (x: Answers) => resolveAll(x, cat).destinations[0]!.needs.map((n) => n.front);
    a.fronts['MX|FR_RECRUITMENT']!.support = 'unknown';
    expect(inValue(a)).toContain('FR_RECRUITMENT');
    a.fronts['MX|FR_RECRUITMENT']!.support = 'no';
    expect(inValue(a)).toContain('FR_RECRUITMENT');
    expect(resolveAll(a, cat).destinations[0]!.needs.find((n) => n.front === 'FR_RECRUITMENT')!.support).toBe('no');       // preference kept as context
    a.fronts['MX|FR_RECRUITMENT']!.status = 'resolved';
    expect(inValue(a)).not.toContain('FR_RECRUITMENT');
  });
  it('Rule 6 + 9 — "not relevant": at most 3 groups, canonical Front Catalog names only, fewer when fewer apply', () => {
    for (const a of [journeyA(), journeyB('es', 'unknown'), journeyC('es', 'unknown')]) {
      const y = buildYourExpansionView(a, cat);
      const canonical = new Set(cat.fronts.flatMap((f) => [f.nameEs, f.nameEn]));
      for (const d of y.destinations) {
        expect(d.notApplicable.length).toBeLessThanOrEqual(3);
        for (const g of d.notApplicable) for (const f of g.fronts) { expect(canonical.has(f.name.es)).toBe(true); expect(canonical.has(f.name.en)).toBe(true); }
      }
    }
    expect(buildYourExpansionView(journeyC('es', 'unknown'), cat).destinations[0]!.notApplicable).toHaveLength(2);
    const sellOnly = buildYourExpansionView(mk({ activities: ['sell'], withWhat: ['goods'], presence: 'own_physical', permanence: 'temporary', sellsTo: 'companies' }), cat);
    expect(sellOnly.destinations[0]!.notApplicable.length).toBeLessThan(3);
  });
  it('Rule 7 — CONDITIONAL is derived from a declared dependency, never stored as an option', () => {
    expect(deriveDecision({ decision: 'decided', dependsOn: 'aprobación del Board' })).toBe('conditional');
    expect(deriveDecision({ decision: 'decided', dependsOn: '  ' })).toBe('decided');
    expect(deriveDecision({ decision: 'exploring', dependsOn: 'x' })).toBe('exploring');
    expect(journeyB().decision).toBe('decided');
    expect(buildYourExpansionView(journeyB('es', 'unknown'), cat).stillOpen.map((x) => x.es).join('|')).toMatch(/La inversión depende de/);
  });
  it('Rule 8 — "Presupuesto" is never inferred from the project type', () => {
    for (const a of [journeyA(), journeyB(), journeyC()]) {
      const y = buildYourExpansionView(a, cat);
      expect(y.stillOpen.map((x) => x.es).join('|')).not.toMatch(/Presupuesto/);
      expect(y.stillOpen.map((x) => x.en).join('|')).not.toMatch(/Budget/);
    }
  });
  it('Rule 10 — I-26 stays reachable after being answered', () => {
    expect(flowIds(journeyB('es', 'within'))).toContain('cargo_route');
  });
});
