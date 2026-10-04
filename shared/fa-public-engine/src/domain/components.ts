import type { Answers, ProjectComponent } from './answers';
import { OPEN_DEST } from './answers';

const blank = (id: string, destinations: string[]): ProjectComponent => ({
  id, destinations, activities: [], withWhat: [], presence: null, permanence: null, existing: null,
  sellsTo: null, ownBrand: null, location: null, carries: [],
});

/**
 * Keeps project components consistent with the destinations (B: "¿Harás lo mismo en todos?"):
 * one component when the destination is open, single, or "same in all"; otherwise one per country.
 * Existing answers are preserved by component id; nothing is asked twice.
 */
export function syncComponents(a: Answers): Answers {
  const dests = a.destinations.open || a.destinations.list.length === 0 ? [OPEN_DEST] : a.destinations.list.map((d) => d.iso);
  const plan: Array<{ id: string; dests: string[] }> =
    dests.length === 1 || a.destinations.sameInAll === true ? [{ id: 'c1', dests }] : dests.map((d) => ({ id: d.toLowerCase(), dests: [d] }));
  if (dests.length > 1 && a.destinations.sameInAll === null) return { ...a, components: a.components.filter((c) => plan.some((p) => p.id === c.id)) };
  const old = new Map(a.components.map((c) => [c.id, c]));
  const next = plan.map((p) => ({ ...(old.get(p.id) ?? blank(p.id, p.dests)), destinations: p.dests }));
  const keep = new Set(next.map((c) => c.id));
  const scale = Object.fromEntries(Object.entries(a.scale).filter(([k]) => keep.has(k)));
  return { ...a, components: next, scale };
}
