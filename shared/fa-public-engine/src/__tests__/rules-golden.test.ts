import { createHash } from 'node:crypto';
import { SEED_CATALOG } from '../catalog/seed';
import { resolveAll } from '../engine/resolve';
import { buildResolutionSnapshot } from '../precision/snapshots';
import { canonicalJson } from '../precision/context';
import { RULES_VERSION } from '../precision/versions';
import { journeyA, journeyB, journeyC, journeyNortica, journeyUnknown } from '../testing/journeys';

/**
 * RULES_VERSION guard (D-157). The deterministic outcome of the rule set for the reference journeys is pinned here. If an engine change alters any
 * outcome, this test fails: bump RULES_VERSION (precision/versions.ts) in the same change, then update the hashes below. That keeps `rules_version`
 * a truthful identifier of the rule set that produced a sealed result.
 */
const GOLDEN: { rulesVersion: string; catalogVersion: string; hashes: Record<string, string> } = {
  rulesVersion: 'fa4-rules/2026-10-14.1', catalogVersion: '2026-10-04.v4',
  hashes: { A: '704e574ab7b48857', B_both: '2f87832ff1e9b0a6', C_unknown: '213b8ee4e28a7ed5', Nortica: 'b083cc509bd57572', NoLoSe: '745236ba1955dd1f' },
};
const FIXTURES = { A: () => journeyA(), B_both: () => journeyB('es', 'both'), C_unknown: () => journeyC('es', 'unknown'), Nortica: () => journeyNortica(), NoLoSe: () => journeyUnknown() };
const hash = (a: ReturnType<(typeof FIXTURES)['A']>) => createHash('sha256').update(canonicalJson(buildResolutionSnapshot(resolveAll(a, SEED_CATALOG)))).digest('hex').slice(0, 16);

describe('rules golden', () => {
  it('RULES_VERSION and catalog version match the pinned golden', () => {
    expect(RULES_VERSION).toBe(GOLDEN.rulesVersion); expect(SEED_CATALOG.version).toBe(GOLDEN.catalogVersion);
  });
  it.each(Object.keys(FIXTURES) as Array<keyof typeof FIXTURES>)('%s: the structured resolution is unchanged (otherwise bump RULES_VERSION and update the golden)', (k) => {
    expect(hash(FIXTURES[k]())).toBe(GOLDEN.hashes[k]);
  });
});
