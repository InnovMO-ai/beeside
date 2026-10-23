import { SEED_CATALOG } from '../catalog/seed';
import { buildYourExpansionView } from '../engine/yev';
import { buildFlow, stepKey } from '../engine/flow';
import { proxyFor } from '../engine/scale';
import { journeyNortica, journeyUnknown, journeyA } from '../testing/journeys';
import type { Activity } from '../domain/types';

const cat = SEED_CATALOG;
const c = (activities: Activity[], permanence: 'permanent' | 'temporary' | 'open' = 'permanent') => ({ activities, permanence });
const text = (xs: Array<{ es: string; en: string }>) => xs.map((x) => x.es);
const flow = (a: Parameters<typeof buildFlow>[0]) => buildFlow(a, cat).map(stepKey);

describe('D-149 — size proxy priority (PI-1 A–G)', () => {
  it.each([
    ['A sell', c(['sell']), 'products'],
    ['B hire', c(['hire']), 'people'],
    ['C sell + hire', c(['sell', 'hire']), 'people'],
    ['D produce + hire', c(['produce', 'hire']), 'investment'],
    ['E source + hire', c(['source', 'hire']), 'people'],
    ['F temporary (any activity)', c(['sell', 'hire', 'produce'], 'temporary'), 'duration'],
    ['source only', c(['source']), 'purchase'],
    ['fallback', c(['operate']), 'investment'],
  ] as const)('%s', (_n, comp, expected) => expect(proxyFor(comp as never)).toBe(expected));

  it('G — exact Nórtica route: people, "Equipo previsto: 8 personas", no inferred budget (VT-01 stays PASS)', () => {
    const a = journeyNortica();
    expect(proxyFor(a.components[0]!)).toBe('people');
    const y = buildYourExpansionView(a, cat);
    expect(text(y.decided)).toContain('Equipo previsto: 8 personas');
    expect(text(y.stillOpen).join('|')).not.toMatch(/Presupuesto|Inversión/);
    const en = buildYourExpansionView(journeyNortica('en'), cat);
    expect(en.decided.map((x) => x.en)).toContain('Planned team: 8 people');
    expect(en.stillOpen.map((x) => x.en).join('|')).not.toMatch(/Budget|Investment/);
  });
  it('a bare number is labelled; free text is kept', () => {
    const a = journeyNortica(); a.scale.c1!.text = '8';
    expect(text(buildYourExpansionView(a, cat).decided)).toContain('Equipo previsto: 8 personas');
    const b = journeyA(); expect(text(buildYourExpansionView(b, cat).decided)).toContain('Equipo previsto: 3 a 5 personas');
  });
});

describe('VT-02 — "not sure yet" presence is never a decision', () => {
  const y = buildYourExpansionView(journeyUnknown(), cat);
  it('Ya decidido has no "Sin espacio propio"', () => expect(text(y.decided).join('|')).not.toMatch(/Sin espacio propio|No premises/));
  it('No aplica has no "No abrirás oficina"', () => {
    const na = y.destinations[0]!.notApplicable.map((g) => g.reason.es).join('|');
    expect(na).not.toMatch(/No abrirás oficina|No tendrás espacio propio/);
  });
  it('it is shown as an open topic: how you will be present', () => expect(text(y.stillOpen)).toContain('Cómo estarás presente en México'));
  it('a declared negative (partner/remote) still produces it', () => {
    const a = journeyUnknown(); a.components[0]!.presence = 'remote'; a.components[0]!.permanence = 'permanent';
    expect(text(buildYourExpansionView(a, cat).decided)).toContain('Sin espacio propio');
  });
});

describe('VT-03 — no empty thematic screens', () => {
  it('Nórtica keeps both screens (sell + site have questions)', () => {
    const f = flow(journeyNortica()); expect(f).toContain('activators_sell'); expect(f).toContain('activators_site');
  });
  it('"No lo sé" route: only the sell screen; no empty "Lo que montas allí"', () => {
    const f = flow(journeyUnknown()); expect(f).toContain('activators_sell'); expect(f).not.toContain('activators_site');
  });
  it('sell group with a single question is still rendered once (neutral treatment in UI), never zero', () => {
    const a = journeyNortica(); a.components[0]!.activities = ['hire'];
    const f = flow(a); expect(f).toContain('activators_sell'); expect(f).toContain('activators_site');
  });
});
