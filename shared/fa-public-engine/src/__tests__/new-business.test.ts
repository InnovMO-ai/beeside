import { SEED_CATALOG } from '../catalog/seed';
import { resolveAll } from '../engine/resolve';
import { buildYourExpansionView } from '../engine/yev';
import { buildFlow, isStepComplete, nextStep, normalizeStepKey, stepKey } from '../engine/flow';
import { journeyA, journeyNewBusiness, journeyNortica } from '../testing/journeys';
import { buildResolutionSnapshot, buildSourceSnapshot } from '../precision/snapshots';
import { canonicalJson, mapSealedResultToPrecisionContext, type SealedResultV1 } from '../precision/context';
import { RESOLUTION_SCHEMA_VERSION, RULES_VERSION, SOURCE_SCHEMA_VERSION } from '../precision/versions';
import { answersSchema } from '../domain/schema';
import type { Answers } from '../domain/answers';

/** Discovery rule: «no business operating today» is a VALID case (a new business / operation abroad), not an exclusion. */
const seal = (a: Answers): SealedResultV1 => { const res = resolveAll(a, SEED_CATALOG); return { projectId: 'p-nb', resultId: 'r-nb', deliveredAt: '2026-10-15T12:00:00.000Z', catalogVersion: res.catalogVersion, rulesVersion: RULES_VERSION, sourceSchemaVersion: SOURCE_SCHEMA_VERSION, sourceSnapshot: buildSourceSnapshot(a), resolutionSchemaVersion: RESOLUTION_SCHEMA_VERSION, resolutionSnapshot: buildResolutionSnapshot(res) }; };

describe.each(['es', 'en'] as const)('new business without an operating company (%s)', (loc) => {
  const a = journeyNewBusiness(loc);
  it('the fixture is a valid Answers document and says «not operating»', () => {
    expect(answersSchema.safeParse(a).success).toBe(true);
    expect(a.company).toEqual({ hasExistingBusiness: false, sector: '', size: null, operatesIn: [] });
  });
  it('the journey continues through the same project screens; there is no exit and no eligibility gate', () => {
    const flow = buildFlow(a).map(stepKey);
    expect(flow).not.toContain('exit');
    expect(flow.slice(0, 4)).toEqual(['cover', 'identity', 'company', 'destinations']);
    const same = buildFlow(journeyNortica(loc)).map(stepKey);
    expect(flow).toEqual(same);                                  // identical branching to an operating business with the same project answers
    expect(nextStep(a, { cargoRouteDestinations: [] }, { id: 'company' }).id).toBe('destinations');
  });
  it('the company screen is complete with «no» alone (current-operation questions are not asked), but «yes» still requires them', () => {
    expect(isStepComplete({ id: 'company' }, a)).toBe(true);
    expect(isStepComplete({ id: 'company' }, { ...a, company: { ...a.company, hasExistingBusiness: null } })).toBe(false);
    expect(isStepComplete({ id: 'company' }, { ...a, company: { hasExistingBusiness: true, sector: '', size: null, operatesIn: [] } })).toBe(false);
    expect(isStepComplete({ id: 'company' }, journeyA(loc))).toBe(true);
  });
  it('every project screen of the journey is answerable (complete) with the fixture', () => {
    for (const s of buildFlow(a).filter((x) => !['cover', 'identity', 'result'].includes(x.id))) expect(isStepComplete(s, a)).toBe(true);
  });
  it('YEV preview succeeds, uses only supplied facts and never fabricates an existing company', () => {
    const m = buildYourExpansionView(a, SEED_CATALOG, new Date('2026-10-15T12:00:00Z'));
    expect(m.kind).toBe('YourExpansionView');
    expect(m.destinations.length).toBeGreaterThan(0);
    const text = JSON.stringify(m);
    expect(text).not.toMatch(/undefined|null null|\s·\s·|·\s*"/);
    expect(text).not.toContain('Fabricación de envases');       // nothing leaks from the operating-company fixture
    expect(text).not.toMatch(/51.250|251.1000/);
    expect(m.premium.shown).toBe(true);                          // a new-business project is Premium-eligible
  });
  it('the sealed envelope keeps operatingBusiness = false and invents no current-operation facts', () => {
    const src = buildSourceSnapshot(a); expect(src.company).toEqual({ hasExistingBusiness: false, sector: '', size: null, operatesIn: [] });
    const ctx = mapSealedResultToPrecisionContext(seal(a));
    expect(ctx.declared.company).toMatchObject({ operatingBusiness: false, sector: '', size: null, operatesIn: [] });
    expect(ctx.declared.destinations.list.map((d) => d.country)).toEqual(['MX']);
    expect(canonicalJson(mapSealedResultToPrecisionContext(seal(a)))).toBe(canonicalJson(ctx));       // reproducible
    const op = mapSealedResultToPrecisionContext(seal(journeyNortica(loc)));
    expect(op.declared.company.operatingBusiness).toBe(true);                                        // distinguishable from an existing-business case
    expect(canonicalJson(ctx)).not.toBe(canonicalJson(op));
  });
  it('a stale saved step «exit» resumes on the destinations screen', () => { expect(normalizeStepKey('exit', a)).toBe('destinations'); });
});

describe('operating-business journeys are unchanged (regression)', () => {
  it.each(['es', 'en'] as const)('Journey A and Nórtica keep the company questions and their flow (%s)', (loc) => {
    for (const a of [journeyA(loc), journeyNortica(loc)]) {
      expect(a.company.hasExistingBusiness).toBe(true);
      expect(isStepComplete({ id: 'company' }, { ...a, company: { ...a.company, size: null } })).toBe(false);   // «yes» still requires size
      expect(buildFlow(a).map(stepKey)).toContain('destinations');
    }
  });
});
