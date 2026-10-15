import { SEED_CATALOG } from '../catalog/seed';
import { answersSchema } from '../domain/schema';
import { resolveAll } from '../engine/resolve';
import { buildYourExpansionView } from '../engine/yev';
import { journeyA, journeyB, journeyC, journeyNortica, journeyUnknown } from '../testing/journeys';
import fs from 'node:fs';
import path from 'node:path';
import { ANSWERS_COVERAGE, renderCoverageMarkdown, schemaPaths } from '../precision/coverage';
import { buildResolutionSnapshot, buildSourceSnapshot } from '../precision/snapshots';
import { SealedResultError, canonicalJson, mapSealedResultToPrecisionContext, type SealedResultV1 } from '../precision/context';
import { CONTRACT_VERSION, MAPPER_VERSION, RESOLUTION_SCHEMA_VERSION, RULES_VERSION, SOURCE_SCHEMA_VERSION } from '../precision/versions';
import type { Answers } from '../domain/answers';
import type { Catalog } from '../domain/types';

const seal = (a: Answers, catalog: Catalog = SEED_CATALOG, id = 'r-1'): SealedResultV1 => {
  const res = resolveAll(a, catalog);
  return {
    projectId: 'p-1', resultId: id, deliveredAt: '2026-10-14T12:00:00.000Z', catalogVersion: res.catalogVersion, rulesVersion: RULES_VERSION,
    sourceSchemaVersion: SOURCE_SCHEMA_VERSION, sourceSnapshot: buildSourceSnapshot(a), resolutionSchemaVersion: RESOLUTION_SCHEMA_VERSION, resolutionSnapshot: buildResolutionSnapshot(res),
  };
};
const withPII = (a: Answers): Answers => ({ ...a, identity: { ...a.identity, name: 'Lucía Pérez Ñandú', email: 'lucia.perez@nortica.example', termsAccepted: true, privacyAcknowledged: true, marketingConsent: true } });

describe('field coverage matrix (acceptance 17)', () => {
  it('every field of the strict Answers schema is classified, and nothing stale is listed', () => {
    const fields = [...new Set(schemaPaths(answersSchema as unknown))].sort();
    const listed = Object.keys(ANSWERS_COVERAGE).sort();
    expect(fields.filter((f) => !listed.includes(f))).toEqual([]);     // a new field without a decision fails here
    expect(listed.filter((f) => !fields.includes(f))).toEqual([]);
  });
  it('EXCLUDED / RESTRICTED fields have a reason; INCLUDED fields name their place in the contract', () => {
    for (const [p, e] of Object.entries(ANSWERS_COVERAGE)) {
      if (e.cls === 'INCLUDED' ? !e.contract : !e.reason) throw new Error(`coverage entry without ${e.cls === 'INCLUDED' ? 'contract place' : 'reason'}: ${p}`);
    }
  });
});

describe('coverage matrix document', () => {
  it('docs/fa4/FIELD_COVERAGE_MATRIX.md is the generated matrix (run node scripts/fa4-coverage-doc.js)', () => {
    const doc = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'docs', 'fa4', 'FIELD_COVERAGE_MATRIX.md'), 'utf8');
    expect(doc).toBe(renderCoverageMarkdown());
  });
});

describe('source snapshot (D-157)', () => {
  const a = withPII(journeyNortica());
  const snap = buildSourceSnapshot(a); const json = JSON.stringify(snap);
  it('keeps the business facts and drops contact PII, legal and marketing state', () => {
    expect(json).not.toMatch(/lucia\.perez|Pérez Ñandú|termsAccepted|privacyAcknowledged|marketingConsent|projectConfirmed|"email"|"name"/);
    expect(snap.identity).toEqual({ company: 'Nórtica Envases', role: a.identity.role, decider: 'shared' });
    expect(snap.components[0]!.existing).toBe('commercial_traction'); expect(snap.scale.c1!.text).toBe('8 personas');
    expect(snap.context).not.toHaveProperty('unknowns');
  });
  it('is a detached copy: later edits of the live answers never reach it', () => {
    const live = journeyNortica(); const s = buildSourceSnapshot(live);
    live.company.sector = 'changed'; live.components[0]!.activities.push('produce'); live.scale.c1!.text = '999';
    expect(s.company.sector).not.toBe('changed'); expect(s.components[0]!.activities).toEqual(['sell', 'hire']); expect(s.scale.c1!.text).toBe('8 personas');
  });
  it('every INCLUDED answer path is present in the snapshot for a fully populated project', () => {
    const full = withPII(journeyC()); full.context.unknowns = 'secret-unknown'; full.context.personalNeed = true;
    expect(JSON.stringify(buildSourceSnapshot(full))).not.toContain('secret-unknown');
  });
});

describe('resolution snapshot (D-157)', () => {
  const res = resolveAll(journeyB('es', 'both'), SEED_CATALOG); const snap = buildResolutionSnapshot(res); const json = JSON.stringify(snap);
  it('stores stable IDs and structured states only — no traces, labels, provider layer or sourcing fields', () => {
    expect(json).not.toMatch(/"trace"|nameEs|nameEn|limitEs|limitEn|"kind":"HIVE"|STRATEGIC_ADVISORY|internalRef|sourcing|triage|owner|Grant Thornton|Baker Tilly|Traxi|Santander|MAPFRE/i);
    const need = snap.destinations.flatMap((d) => d.needs).find((n) => n.capabilities.length)!;
    expect(Object.keys(need.capabilities[0]!).sort()).toEqual(['basisValue', 'capabilityId', 'conditionalOn', 'coverage', 'coverageBasis', 'state']);
  });
  it('lets the historical conclusion be read WITHOUT the rules engine or the catalog', () => {
    const mx = snap.destinations.find((d) => d.destination === 'MX')!;
    expect(mx.topics.length).toBeGreaterThan(5); expect(mx.needs.some((n) => n.state === 'ACTIVE')).toBe(true);
    const us = snap.destinations.find((d) => d.destination === 'US')!; expect(us.countryMessage).toBe('NO_ACTIVE_COVERAGE');
  });
});

describe('Fa4PrecisionContextV1 mapper (D-158)', () => {
  it('is deterministic and versioned', () => {
    const sealed = seal(journeyNortica()); const c1 = mapSealedResultToPrecisionContext(sealed); const c2 = mapSealedResultToPrecisionContext(JSON.parse(JSON.stringify(sealed)));
    expect(canonicalJson(c1)).toBe(canonicalJson(c2));
    expect(c1.contract).toEqual({ version: CONTRACT_VERSION, mapperVersion: MAPPER_VERSION });
    expect(c1.versions).toEqual({ catalogVersion: SEED_CATALOG.version, rulesVersion: RULES_VERSION, sourceSchemaVersion: 1, resolutionSchemaVersion: 1 });
    expect(c1.ids).toEqual({ projectId: 'p-1', resultId: 'r-1' });
  });
  it('separates DECLARED_BY_USER from DERIVED_FROM_FA', () => {
    const c = mapSealedResultToPrecisionContext(seal(journeyNortica()));
    expect(c.declared.provenance).toBe('DECLARED_BY_USER'); expect(c.derived.provenance).toBe('DERIVED_FROM_FA');
    expect(c.declared.company.name).toBe('Nórtica Envases'); expect(c.declared.destinations.list).toEqual([{ country: 'MX', region: null }]);
    expect(JSON.stringify(c.declared)).not.toMatch(/ACTIVE|SOURCEABLE|REVIEW|DEPENDENT|capabilityId/);     // nothing derived inside «declared»
    expect(c.derived.destinations[0]!.needs.length).toBeGreaterThan(0); expect(JSON.stringify(c.derived)).not.toContain('Exportamos a dos clientes');
  });
  it('reads ONLY the sealed row: it neither needs today\'s catalog nor today\'s rules, and a changed catalog / rule / live project never alters Result A', () => {
    const a = journeyNortica(); const sealed = seal(a); const before = canonicalJson(mapSealedResultToPrecisionContext(sealed));
    // (1) the live answers move on
    a.company.sector = 'otro'; a.components[0]!.existing = 'own'; a.regulated = 'yes';
    // (2) the catalog changes (capability coverage flips; version bumps)
    const changed: Catalog = JSON.parse(JSON.stringify(SEED_CATALOG)); changed.version = '2099-01-01.v9';
    for (const c of changed.capabilities) for (const x of c.coverage) x.state = 'NOT_COVERED';
    expect(canonicalJson(resolveAll(a, changed).destinations)).not.toBe(canonicalJson(resolveAll(a, SEED_CATALOG).destinations));   // the change is real
    // (3) the mapper has no access to answers, catalog or engine: its only input is the sealed row
    expect(canonicalJson(mapSealedResultToPrecisionContext(sealed))).toBe(before);
    expect(mapSealedResultToPrecisionContext.length).toBe(1);
  });
  it('a future Result B (new sealed row for the same project) never changes Result A', () => {
    const aAnswers = journeyNortica(); const A = seal(aAnswers, SEED_CATALOG, 'r-A'); const ctxA = canonicalJson(mapSealedResultToPrecisionContext(A));
    const bAnswers = journeyUnknown(); bAnswers.company.sector = 'otro sector'; const B = seal(bAnswers, SEED_CATALOG, 'r-B');
    expect(canonicalJson(mapSealedResultToPrecisionContext(B))).not.toBe(ctxA);
    expect(canonicalJson(mapSealedResultToPrecisionContext(A))).toBe(ctxA);
  });
  it('commercial traction is its own state and never becomes established third-party operation (D-153)', () => {
    const t = journeyNortica(); const legacy = journeyNortica(); legacy.components[0]!.existing = 'via_third';
    const none = journeyNortica(); none.components[0]!.existing = 'nothing'; const own = journeyNortica(); own.components[0]!.existing = 'own';
    const pos = (x: Answers) => mapSealedResultToPrecisionContext(seal(x)).declared.components[0]!.currentPositionInDestination.state;
    expect([pos(t), pos(legacy), pos(none), pos(own)]).toEqual(['COMMERCIAL_TRACTION', 'THIRD_PARTY_OPERATION', 'NONE', 'OWN_PRESENCE']);
    // routing is untouched by the value (no rule reads it): same derived conclusions for traction / legacy / none
    const d = (x: Answers) => canonicalJson(mapSealedResultToPrecisionContext(seal(x)).derived);
    expect(d(t)).toBe(d(legacy)); expect(d(t)).toBe(d(none));
    const yev = (x: Answers) => buildYourExpansionView(x, SEED_CATALOG, new Date('2026-10-14T00:00:00Z')).destinations.map((y) => y.glance);
    expect(yev(t)).toEqual(yev(none));
  });
  it('turns «not sure / to be defined» answers into structured open states (the retired free text is not part of the contract)', () => {
    const c = mapSealedResultToPrecisionContext(seal(journeyUnknown()));
    const fields = c.declared.openStates.map((o) => o.field);
    for (const f of ['presenceModel', 'permanence', 'startTiming', 'regulation', 'projectSize', 'topicStatus', 'topicSupport', 'cargoRoute']) expect(fields).toContain(f);
    expect(JSON.stringify(c)).not.toMatch(/unknowns|Qué todavía no sabes/);
  });
  it('never carries restricted / internal data', () => {
    const c = JSON.stringify(mapSealedResultToPrecisionContext(seal(withPII(journeyNortica()))));
    expect(c).not.toMatch(/lucia\.perez|nortica\.example|Pérez Ñandú|marketing|terms|privacy|trace|provider|sourcing|triage|Grant Thornton|nameEs/i);
  });
  it('refuses envelopes it cannot interpret instead of guessing (no upgrader / incomplete)', () => {
    const s = seal(journeyA());
    expect(() => mapSealedResultToPrecisionContext({ ...s, sourceSchemaVersion: 2, sourceSnapshot: { ...s.sourceSnapshot, schemaVersion: 2 as never } })).toThrow(SealedResultError);
    expect(() => mapSealedResultToPrecisionContext({ ...s, resolutionSnapshot: undefined as never })).toThrow(/sealed envelope/);
  });
});
