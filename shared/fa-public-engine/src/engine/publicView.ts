import type { Answers } from '../domain/answers';
import type { Catalog, FrontKey, FrontStatus } from '../domain/types';
import { destinationsWithCargoRouteRelevance, resolveAll } from './resolve';
import { buildTextIndex, type TextIndexEntry } from './textIndex';

/**
 * Privacy boundary between the server and the unauthenticated browser (VERIFY close, item 15).
 * Capability / coverage resolution is server-side only. The browser gets:
 *  - PublicCatalog: Front names + a flattened keyword index to relate free text to a Front. No capabilities, coverage, countries,
 *    capability states, provider / Business Check / sourcing data;
 *  - ClientResolution: for THIS project only, the coarse facts the interaction needs (which topics apply, which needs depend on a
 *    decision, whether cargo-route applies, whether a Premium continuation is shown). Never a state per capability or country.
 */
export interface PublicCatalog {
  version: string;
  fronts: Array<{ key: FrontKey; nameEs: string; nameEn: string }>;
  textIndex: TextIndexEntry[];
}

export interface ClientResolution {
  premiumShown: boolean;
  /** Destinations where the I-26 cargo-route question applies. */
  cargoRouteDestinations: string[];
  destinations: Array<{
    destination: string;
    topics: Array<{ front: FrontKey; kind: 'applies' | 'depends'; possible: boolean; notIndicated: boolean; status: FrontStatus | null }>;
    needs: Array<{ front: FrontKey; dependent: boolean; critical: boolean }>;
  }>;
}

export function toPublicCatalog(c: Catalog): PublicCatalog {
  return {
    version: c.version,
    fronts: c.fronts.map((f) => ({ key: f.key, nameEs: f.nameEs, nameEn: f.nameEn })),
    textIndex: buildTextIndex(c),
  };
}

export function clientResolution(a: Answers, catalog: Catalog): ClientResolution {
  const r = resolveAll(a, catalog);
  return {
    premiumShown: r.premiumShown,
    cargoRouteDestinations: destinationsWithCargoRouteRelevance(a, catalog),
    destinations: r.destinations.map((d) => ({
      destination: d.destination,
      topics: d.topics.map((t) => ({ front: t.front, kind: t.kind, possible: t.possible, notIndicated: t.notIndicated, status: t.status })),
      needs: d.needs.map((n) => ({ front: n.front, dependent: n.state === 'DEPENDENT', critical: n.critical })),
    })),
  };
}
