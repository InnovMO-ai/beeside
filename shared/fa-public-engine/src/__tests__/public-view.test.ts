import { SEED_CATALOG } from '../catalog/seed';
import { journeyA, journeyB, journeyC } from '../testing/journeys';
import { buildFlow, clientResolution, destinationsWithCargoRouteRelevance, mapTextToFront, mapTextWithIndex, resolveAll, toPublicCatalog } from '../index';

describe('public / client view — the browser never gets the capability × coverage matrix', () => {
  const pub = toPublicCatalog(SEED_CATALOG);
  it('PublicCatalog carries only Front names and a flattened keyword index', () => {
    expect(Object.keys(pub).sort()).toEqual(['fronts', 'textIndex', 'version']);
    expect(Object.keys(pub.fronts[0]!).sort()).toEqual(['key', 'nameEn', 'nameEs']);
    const keys = new Set<string>();
    JSON.stringify(pub, (k, v) => { if (k && Number.isNaN(Number(k))) keys.add(k); return v; });
    expect([...keys].sort()).toEqual(['front', 'fronts', 'key', 'nameEn', 'nameEs', 'term', 'textIndex', 'version', 'weight']);   // no capability / coverage / country / status property can exist
    expect(JSON.stringify(pub)).not.toMatch(/CAP_HIVE|providerStatus|businessCheck|internalRef|NO_ACTIVE_COVERAGE/);
    expect(pub.textIndex.length).toBeGreaterThan(50);
  });
  it('free-text mapping through the public index equals the catalog-based mapping', () => {
    for (const t of ['renta de grúas', 'seguro de equipo', 'abrir cuenta bancaria', 'algo rarísimo xyz', 'customs broker', 'alojamiento para la cuadrilla'])
      expect(mapTextWithIndex(t, pub.textIndex)).toEqual(mapTextToFront(t, SEED_CATALOG));
  });
  it.each([['A', journeyA()], ['B', journeyB('es', 'unknown')], ['C', journeyC('es', 'unknown')]] as const)('Journey %s: ClientResolution drives the same flow and has no per-capability state', (_n, a) => {
    const r = clientResolution(a, SEED_CATALOG);
    expect(r.cargoRouteDestinations).toEqual(destinationsWithCargoRouteRelevance(a, SEED_CATALOG));
    expect(buildFlow(a, { cargoRouteDestinations: r.cargoRouteDestinations })).toEqual(buildFlow(a, SEED_CATALOG));
    expect(r.premiumShown).toBe(resolveAll(a, SEED_CATALOG).premiumShown);
    const dump = JSON.stringify(r);
    for (const forbidden of ['capabilities', 'capabilityId', '"ACTIVE"', 'SOURCEABLE', '"REVIEW"', 'coverage', 'trace']) expect(dump).not.toContain(forbidden);
  });
});
