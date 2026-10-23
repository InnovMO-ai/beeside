import { SEED_CATALOG } from '../catalog/seed';
import { buildYourExpansionView } from '../engine/yev';
import { emptyAnswers, type Answers } from '../domain/answers';
import { syncComponents } from '../domain/components';
import { journeyA, journeyB, journeyC, journeyNewBusiness, journeyNortica, journeyUnknown } from '../testing/journeys';

/**
 * DSC-01 — provenance of the YEV: everything the result shows comes from THIS session's declared answers, nothing is carried over, inferred in silence or
 * left behind by an earlier answer. Metamorphic tests: remove a declared fact → it disappears from the result.
 */
const NOW = new Date('2026-10-21T12:00:00Z');
const yev = (a: Answers) => JSON.stringify(buildYourExpansionView(a, SEED_CATALOG, NOW));
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe('company facts only when the company is declared as operating', () => {
  const stale = (loc: 'es' | 'en') => { const a = clone(journeyNortica(loc)); a.company.hasExistingBusiness = false; return a; };   // «No» answered after sector/size/countries were typed
  it.each(['es', 'en'] as const)('«no business operating» (%s): sector, size and operating countries left over from an earlier answer never reach the YEV', (loc) => {
    const s = yev(stale(loc));
    for (const leaked of ['envases', '51–250', 'España', 'Spain', 'Portugal']) expect(s).not.toContain(leaked);
  });
  it('a declared company size is labelled as the company\'s (ES / EN) and sector/countries stay', () => {
    expect(yev(journeyNortica('es'))).toContain('Tu empresa: 51–250 personas');
    expect(yev(journeyNortica('en'))).toContain('Your company: 51–250 people');
    expect(yev(journeyNortica('es'))).toContain('Fabricación de envases sostenibles para alimentación');
  });
  it('the new-business journey shows no company block facts at all', () => {
    const m = buildYourExpansionView(journeyNewBusiness('es'), SEED_CATALOG, NOW);
    expect(m.subtitle.es).not.toMatch(/personas|envases|España|Portugal/);
  });
});

describe('every declared text in the YEV disappears when that answer is removed (no other source feeds it)', () => {
  type Edit = { name: string; marker: string; apply: (a: Answers) => void };
  const edits: Edit[] = [
    { name: 'sector', marker: 'envases sostenibles', apply: (a) => { a.company.sector = ''; } },
    { name: 'size', marker: '51–250', apply: (a) => { a.company.size = null; } },
    { name: 'operating countries', marker: 'Portugal', apply: (a) => { a.company.operatesIn = []; } },
    { name: 'reason text', marker: 'clientes en México nos piden', apply: (a) => { a.reasonText = ''; } },
    { name: 'existing note', marker: 'dos clientes en México', apply: (a) => { for (const c of a.components) c.existingNote = ''; } },
    { name: 'project size text', marker: '8 personas', apply: (a) => { a.scale = {}; } },
    { name: 'kept in-house', marker: 'La relación comercial con nuestros clientes', apply: (a) => { a.keepWords = ''; } },
  ];
  it.each(edits)('Nórtica: «$name» is the only source of «$marker»', ({ marker, apply }) => {
    const base = journeyNortica('es'); expect(yev(base)).toContain(marker);
    const a = clone(base); apply(a); expect(yev(a)).not.toContain(marker);
  });
  it('Journey C: free texts (success, support words, added needs, deadline note) vanish with their answer', () => {
    const base = journeyC('es'); const s0 = yev(base);
    for (const m of ['grúas de gran capacidad', 'no construir una estructura permanente']) expect(s0).toContain(m);
    const a = clone(base); a.addedNeeds = []; a.context.success = ''; a.externalDate = { has: false };
    const s1 = yev(a); for (const m of ['grúas de gran capacidad', 'no construir una estructura permanente', 'Movilización']) expect(s1).not.toContain(m);
  });
});

describe('no value from one session shows up in another', () => {
  const MARKERS = ['envases', '51–250', 'España', 'Spain', 'Portugal', 'Exportamos', 'Bajío', 'clientes en México nos piden', 'Nórtica', 'Lucía', 'lucia@nortica'];
  const minimal = () => { const a = emptyAnswers('es'); a.identity = { ...a.identity, name: 'Ana', company: 'Otra Empresa', email: 'ana@otra.example', termsAccepted: true, privacyAcknowledged: true };
    a.destinations = { list: [{ iso: 'CL' }, { iso: 'KR' }], open: false, sameInAll: false }; return syncComponents(a); };
  it('a minimal session generated right after Nórtica contains none of Nórtica\'s facts (pure, no shared state)', () => {
    yev(journeyNortica('es'));                       // «previous session»
    const s = yev(minimal());
    for (const m of MARKERS) expect(s).not.toContain(m);
  });
  it('every journey contains no marker that belongs to another journey\'s identity', () => {
    for (const [name, a] of [['A', journeyA('es')], ['B', journeyB('es')], ['C', journeyC('es')], ['unknown', journeyUnknown('es')]] as const) {
      if (name === 'unknown') continue;              // derived from Nórtica by design (same company)
      const s = yev(a); expect([name, s.includes('Nórtica')]).toEqual([name, false]);
    }
  });
});
