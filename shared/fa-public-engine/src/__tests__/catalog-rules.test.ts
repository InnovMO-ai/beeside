import fs from 'node:fs';
import path from 'node:path';
import { SEED_CATALOG } from '../catalog/seed';
import { FRONT_KEYS, type Catalog } from '../domain/types';
import { emptyAnswers, type Answers, type ProjectComponent } from '../domain/answers';
import { evaluateCapability, mapTextToFront, resolveAll } from '../engine/resolve';
import { buildYourExpansionView } from '../engine/yev';
import { deriveDemandSignals } from '../engine/demand';
import { COUNTRY_MESSAGES, STATE_MESSAGES, visibleStateMessage } from '../i18n/messages';
import { journeyA, journeyB } from '../testing/journeys';

/** jest has no assertion message argument: keep the (value, message) call style of the original suite. */
const xexpect = (v: unknown, _msg?: unknown) => expect(v);
const cat = SEED_CATALOG;
const cap = (id: string) => cat.capabilities.find((c) => c.capabilityId === id)!;
const comp = (o: Partial<ProjectComponent>): ProjectComponent => ({ id: 'c1', destinations: ['MX'], activities: ['hire'], withWhat: [], presence: 'open', permanence: 'open', existing: 'nothing', sellsTo: null, ownBrand: null, location: null, carries: [], ...o });
const project = (dest: string[] | 'open', c: Partial<ProjectComponent> = {}, extra: Partial<Answers> = {}): Answers => {
  const a = emptyAnswers('es');
  a.company = { hasExistingBusiness: true, sector: 'x', size: '11-50', operatesIn: ['ES'] };
  a.destinations = dest === 'open' ? { list: [], open: true, sameInAll: null } : { list: dest.map((iso) => ({ iso })), open: false, sameInAll: true };
  a.components = [comp({ destinations: dest === 'open' ? ['OPEN'] : dest, ...c })];
  a.regulated = 'no'; a.knowsNeeds = false; a.projectConfirmed = true;
  return Object.assign(a, extra);
};

describe('catalog integrity (CAPABILITY_REGISTRY v4 / CATALOG_MODEL)', () => {
  it('publishes the 49 capabilities, 20 fronts and the Category → Service → Capability hierarchy', () => {
    xexpect(cat.capabilities).toHaveLength(49);
    xexpect(cat.fronts.map((f) => f.key).sort()).toEqual([...FRONT_KEYS].sort());
    for (const c of cat.capabilities) {
      xexpect(cat.services.some((s) => s.serviceId === c.serviceId), c.capabilityId).toBe(true);
      xexpect(c.fronts.length).toBeGreaterThan(0);
      for (const f of c.fronts) xexpect(FRONT_KEYS).toContain(f.front);
      xexpect(c.nameEs && c.nameEn && c.coverageBasis && c.capabilityStatus).toBeTruthy();
      if (c.fronts.some((f) => f.match === 'SPECIFIC')) xexpect(c.triggerRule || (c.triggerTermsEs.length && c.triggerTermsEn.length), `${c.capabilityId} trigger terms`).toBeTruthy();
    }
    for (const s of cat.services) xexpect(cat.categories.some((x) => x.categoryId === s.categoryId), s.serviceId).toBe(true);
    xexpect(new Set(cat.capabilities.map((c) => c.capabilityId)).size).toBe(49);
  });
  it('registry status assignments (D-097/D-115): sourceable / review / not offered', () => {
    for (const id of ['CAP_HIVE_HR_RECRUITMENT', 'CAP_HIVE_HR_STAFF_HOUSING', 'CAP_HIVE_INFRA_OFFICE_SPACE', 'CAP_HIVE_INFRA_RETAIL_PREMISES', 'CAP_HIVE_LEGAL_BRAND', 'CAP_HIVE_REG_PRODUCT', 'CAP_HIVE_HR_EOR', 'CAP_HIVE_LEGAL_WIND_DOWN']) xexpect(cap(id).capabilityStatus, id).toBe('SOURCEABLE');
    for (const id of ['CAP_HIVE_HR_MOBILITY', 'CAP_HIVE_COM_PUBLIC_PROCUREMENT']) xexpect(cap(id).capabilityStatus).toBe('REVIEW');
    xexpect(cap('CAP_HIVE_LEGAL_PERMITS').capabilityStatus).toBe('NOT_OFFERED');
    xexpect(cat.capabilities.filter((c) => c.kind === 'STRATEGIC_ADVISORY').every((c) => c.capabilityStatus === 'REVIEW')).toBe(true);
  });
  it('country coverage: MX ACTIVE, ES DEVELOPING, everything else NO_ACTIVE_COVERAGE by default', () => {
    xexpect(cat.countries.find((c) => c.iso === 'MX')!.state).toBe('ACTIVE');
    xexpect(cat.countries.find((c) => c.iso === 'ES')!.state).toBe('DEVELOPING');
    xexpect(cat.countries.find((c) => c.iso === 'US')).toBeUndefined();
  });
});

describe('canonical customer-visible messages (Registry §7.1) — ES and EN', () => {
  it('match the registry table verbatim', () => {
    xexpect(COUNTRY_MESSAGES.UNDEFINED).toEqual({ es: 'Cuando definas el país, podremos confirmar la cobertura disponible.', en: 'Once you choose the country, we can confirm the coverage available.' });
    xexpect(COUNTRY_MESSAGES.DEVELOPING.es).toBe('beeside está desarrollando su red de aliados en este país.');
    xexpect(COUNTRY_MESSAGES.NO_ACTIVE_COVERAGE.en).toBe('beeside does not yet have active coverage in this country.');
    xexpect(STATE_MESSAGES.ACTIVE).toEqual({ es: 'beeside puede ayudarte', en: 'beeside can help' });
    xexpect(STATE_MESSAGES.SOURCEABLE.en).toBe('Your beeside Sherpa will find and validate the best option for you');
    xexpect(STATE_MESSAGES.REVIEW.es).toBe('beeside puede explorar la mejor opción contigo');
    xexpect(STATE_MESSAGES.DEPENDENT.en).toBe('It depends on how you decide to operate');
  });
  it('NOT_OFFERED and UNMAPPED_NEED share the two variants chosen by Premium continuation (D-096/D-112)', () => {
    xexpect(visibleStateMessage('NOT_OFFERED', true).es).toBe('Lo revisaremos con tu Sherpa');
    xexpect(visibleStateMessage('UNMAPPED_NEED', true).en).toBe("We'll review it with your Sherpa");
    xexpect(visibleStateMessage('NOT_OFFERED', false).es).toBe('Lo identificamos como un tema a considerar');
    xexpect(visibleStateMessage('UNMAPPED_NEED', false).en).toBe('We identified this as a topic to consider');
  });
});


describe('country-first resolution (D-095, D-098)', () => {
  it('Spain (DEVELOPING): one country message, no per-service states, ACTIONABLE demand', () => {
    const a = project(['ES'], { activities: ['hire'] }, { company: { hasExistingBusiness: true, sector: 'x', size: '11-50', operatesIn: ['MX'] } });
    a.fronts['ES|FR_RECRUITMENT'] = { support: 'yes' };
    const y = buildYourExpansionView(a, cat);
    xexpect(y.destinations[0]!.countryMessage).toBe('DEVELOPING');
    xexpect(y.destinations[0]!.valueGroups).toEqual([]);
    const sig = deriveDemandSignals('p', a, resolveAll(a, cat), cat);
    xexpect(sig.length).toBeGreaterThan(0);
    xexpect(sig.every((s) => s.reason === 'DEVELOPING' && s.class === 'ACTIONABLE')).toBe(true);
    xexpect(y.premium.shown).toBe(false);                      // no valuable path → understanding is the deliverable (D-050)
  });
  it('undefined destination: single message, no coverage rules, no demand signals', () => {
    const a = project('open', { activities: ['hire'] });
    const y = buildYourExpansionView(a, cat);
    xexpect(y.destinations[0]!.countryMessage).toBe('UNDEFINED');
    xexpect(y.destinations[0]!.valueGroups).toEqual([]);
    xexpect(deriveDemandSignals('p', a, resolveAll(a, cat), cat)).toEqual([]);
  });
  it('a country not in the catalog defaults to NO_ACTIVE_COVERAGE', () => {
    const a = project(['JP'], { activities: ['hire'] });
    xexpect(buildYourExpansionView(a, cat).destinations[0]!.countryMessage).toBe('NO_ACTIVE_COVERAGE');
  });
});

describe('coverage_basis (D-111) — not everything is checked against the destination', () => {
  it('ISSUING_COUNTRY: apostille of Spanish documents for a Mexico project → REVIEW, not ACTIVE (COM-7)', () => {
    const a = project(['MX']); // operates only in ES
    xexpect(evaluateCapability(cap('CAP_HIVE_LEGAL_APOSTILLE'), 'MX', a)).toMatchObject({ state: 'REVIEW', basisValue: 'ES', coverage: 'UNAVAILABLE' });
    const mx = { ...a, company: { ...a.company, operatesIn: ['MX'] } };
    xexpect(evaluateCapability(cap('CAP_HIVE_LEGAL_APOSTILLE'), 'MX', mx).state).toBe('ACTIVE');
    const multi = { ...a, company: { ...a.company, operatesIn: ['ES', 'DE'] } };
    xexpect(evaluateCapability(cap('CAP_HIVE_LEGAL_APOSTILLE'), 'MX', multi).state).toBe('REVIEW');   // MULTI_COUNTRY / CASE_SPECIFIC → never ACTIVE
  });
  it('end to end: "apostilla" declared by a Spanish company → REVIEW next to ACTIVE needs in the same destination', () => {
    const a = project(['MX'], { activities: ['hire'] });
    a.fronts['MX|FR_LEGAL_TAX'] = { status: 'pending', support: 'yes' };
    a.addedNeeds = [{ id: 'n1', text: 'apostilla de documentos', destination: 'MX' }];
    const need = resolveAll(a, cat).destinations[0]!.needs.find((n) => n.front === 'FR_LEGAL_TAX')!;
    xexpect(need.capabilities.map((c) => [c.capabilityId, c.state])).toEqual([['CAP_HIVE_LEGAL_APOSTILLE', 'REVIEW']]);
    xexpect(need.state).toBe('REVIEW');
  });
  it('LANGUAGE_PAIR / SITE_OR_ENTITY_COUNTRY use the confirmed scope for the destination', () => {
    const a = project(['MX']);
    xexpect(evaluateCapability(cap('CAP_HIVE_DOC_TRANSLATION'), 'MX', a).state).toBe('ACTIVE');
    xexpect(evaluateCapability(cap('CAP_HIVE_CERT_ISO_QUALITY'), 'MX', a).state).toBe('ACTIVE');
    xexpect(evaluateCapability(cap('CAP_HIVE_CERT_ISO_QUALITY'), 'US', a).state).toBe('REVIEW');   // coverage only confirmed for MX
  });
  it('ORIGIN_DESTINATION_ROUTE: standard freight and oversized cargo are independent capabilities (never deduced from each other)', () => {
    const a = project(['MX']);
    for (const id of ['CAP_HIVE_OL_FREIGHT', 'CAP_HIVE_OL_OVERSIZED_CARGO']) {
      xexpect(evaluateCapability(cap(id), 'MX', a).state).toBe('REVIEW');
      xexpect(evaluateCapability(cap(id), 'MX', { ...a, cargoRoute: { MX: 'within' } }).state).toBe('ACTIVE');
      xexpect(evaluateCapability(cap(id), 'MX', { ...a, cargoRoute: { MX: 'into_from_abroad' } }).state).toBe('REVIEW');
      xexpect(evaluateCapability(cap(id), 'MX', { ...a, cargoRoute: { MX: 'both' } }).state).toBe('REVIEW');
      xexpect(evaluateCapability(cap(id), 'MX', { ...a, cargoRoute: { MX: 'unknown' } }).state).toBe('REVIEW');
    }
    xexpect(cap('CAP_HIVE_OL_FREIGHT').scopeLimitEs).toMatch(/estándar/);
  });
  it('the project location never implies a domestic route', () => {
    const b = journeyB('es');            // plant located in a Mexican region, route undeclared
    xexpect(b.cargoRoute).toEqual({});
    const need = resolveAll(b, cat).destinations[0]!.needs.find((n) => n.front === 'FR_LOGISTICS')!;
    xexpect(need.state).toBe('REVIEW');
  });
});

describe('UNMAPPED_NEED (D-112) and publication rules', () => {
  it('a need that matches no front/capability keeps the original text, is UNMAPPED_NEED (≠ NOT_OFFERED) and creates INFORMATIONAL demand', () => {
    const a = journeyA(); a.addedNeeds = [{ id: 'n', text: 'comprar un velero', destination: 'MX' }];
    const res = resolveAll(a, cat);
    xexpect(res.destinations[0]!.unmapped).toHaveLength(1);
    xexpect(res.destinations[0]!.unmapped[0]!.text).toBe('comprar un velero');
    const sig = deriveDemandSignals('p', a, res, cat);
    xexpect(sig.find((s) => s.reason === 'UNMAPPED_NEED')).toMatchObject({ class: 'INFORMATIONAL', triageStatus: 'PENDING', originalText: 'comprar un velero', capabilityId: null });
    const y = buildYourExpansionView(a, cat);
    xexpect(y.destinations[0]!.unmapped[0]!.stateKey).toBe('TO_REVIEW_WITH_SHERPA');
  });
  it('only PUBLISHED records affect FA; a service needs a PUBLISHED capability', () => {
    const draft: Catalog = { ...cat, capabilities: cat.capabilities.map((c) => (c.capabilityId === 'CAP_HIVE_HR_RECRUITMENT' ? { ...c, publicationStatus: 'DRAFT' as const } : c)) };
    const a = journeyA();
    const states = (c: Catalog) => Object.fromEntries(resolveAll(a, c).destinations[0]!.needs.map((n) => [n.front, n.state]));
    xexpect(states(cat).FR_RECRUITMENT).toBe('SOURCEABLE');
    xexpect(states(draft).FR_RECRUITMENT).toBe('UNMAPPED_NEED');
  });
  it('keyword mapping is deterministic, accent-insensitive and bilingual', () => {
    xexpect(mapTextToFront('Grúas', cat).front).toBe('FR_SUPPLIERS');
    xexpect(mapTextToFront('we need cranes', cat).front).toBe('FR_SUPPLIERS');
    xexpect(mapTextToFront('registro de MARCA', cat).front).toBe('FR_BRAND');
    xexpect(mapTextToFront('xyzzy', cat).front).toBeNull();
  });
});

describe('contamination guards', () => {
  const root = path.resolve(__dirname, '../..');
  const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const src = files(path.join(root, 'src')).filter((f) => /\.(ts|tsx|css)$/.test(f) && !f.includes('__tests__'));

  it('no runtime AI/LLM dependency or import (Public v1.0 is deterministic)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(' ');
    xexpect(deps).not.toMatch(/openai|anthropic|langchain|llm|gemini|mistral|cohere|ollama|ai-sdk|@ai-sdk/i);
    for (const f of src) xexpect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/api\.openai|api\.anthropic|generativelanguage|from ['"](openai|@anthropic-ai|ai)['"]/);
  });
  it('no legacy product vocabulary in source (Snapshot, radar, readiness scores, waves, Level2…)', () => {
    const banned = /\b(snapshot|radar|readiness|activation wave|olas de activaci|level ?2|expansion profile|score)\b/i;
    for (const f of src.filter((x) => !x.includes('messages.ts'))) {   // messages.ts only lists them as forbidden strings
      const txt = fs.readFileSync(f, 'utf8');
      xexpect(txt.match(banned), `${path.relative(root, f)} → ${txt.match(banned)?.[0]}`).toBeNull();
    }
  });
  it('internal data (partner names, internal refs) never appear in any component/UI source', () => {
    const ui = src.filter((f) => /components|app\/|i18n/.test(f) && !f.endsWith('messages.ts'));
    for (const f of ui) xexpect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/Grant Thornton|Baker Tilly|Traxi|Santander|MAPFRE|Garza Ponce|AMPIP/);
  });
  it('the YEV model carries no internal fields', () => {
    const y = JSON.stringify(buildYourExpansionView(journeyB('es', 'unknown'), cat));
    for (const s of ['internalRef', 'providerStatus', 'businessCheck', 'sourcing', 'CAP_', 'SVC_', 'demand', 'Grant Thornton', 'Traxión']) xexpect(y, s).not.toContain(s);
  });
  it('no percentages or scores in a delivered result', () => {
    const y = JSON.stringify(buildYourExpansionView(journeyB('es', 'unknown'), cat));
    xexpect(y).not.toMatch(/\d\s?%/);
  });
});
