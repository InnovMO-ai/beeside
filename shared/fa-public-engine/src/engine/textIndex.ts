import type { Catalog, FrontKey } from '../domain/types';
import { FRONT_ORDER } from '../catalog/fronts';
import { containsTerm, norm } from './text';

export interface TextIndexEntry { front: FrontKey; term: string; weight: number }
/** Flattened keyword index (front synonym = weight 1, SPECIFIC capability trigger term = weight 2): capability identities are not kept. */
export function buildTextIndex(catalog: Catalog): TextIndexEntry[] {
  const out: TextIndexEntry[] = [];
  for (const front of FRONT_ORDER) {
    const def = catalog.fronts.find((f) => f.key === front);
    if (!def) continue;
    for (const t of [...def.synonymsEs, ...def.synonymsEn]) out.push({ front, term: t, weight: 1 });
    for (const c of catalog.capabilities) {
      if (c.publicationStatus !== 'PUBLISHED' || !c.fronts.some((x) => x.front === front && x.match === 'SPECIFIC')) continue;
      for (const t of [...c.triggerTermsEs, ...c.triggerTermsEn]) out.push({ front, term: t, weight: 2 });
    }
  }
  return out;
}

export function mapTextWithIndex(text: string, index: TextIndexEntry[]): { front: FrontKey | null; weight: number } {
  const h = norm(text);
  const w = new Map<FrontKey, number>();
  for (const e of index) if (containsTerm(h, e.term)) w.set(e.front, (w.get(e.front) ?? 0) + e.weight);
  let best: { front: FrontKey | null; weight: number } = { front: null, weight: 0 };
  for (const front of FRONT_ORDER) { const x = w.get(front) ?? 0; if (x > best.weight) best = { front, weight: x }; }
  return best;
}

