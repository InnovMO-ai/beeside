/**
 * Fact freshness. Discovery can change after Precision started (the client edited their First Assessment): the frame must follow
 * without losing what the client said here and without silently overwriting it.
 *
 *  - an item that still carries Discovery's value is updated (and the change recorded);
 *  - an item the client stated or corrected in Precision, and that now differs from Discovery's NEW value, becomes ONE question
 *    ("In Discovery you updated X ... which one applies?") — the newer source does not win silently;
 *  - Discovery needs that disappeared are removed, new ones are added as proposed; nothing the client added here is touched;
 *  - material change after the checkpoint reopens the checkpoint (the summary the client accepted is no longer current).
 * Pure and idempotent: the same pin always yields the same frame.
 */
import { seedFromDiscovery, type DiscoverySeedInput } from "./seed";
import type { Frame, NeedItem } from "./types";

export interface FreshnessResult { frame: Frame; changed: string[]; asks: string[] }

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function refreshFromDiscovery(prev: Frame, seed: DiscoverySeedInput, now: string): FreshnessResult {
  const frame = clone(prev);
  const fresh = seedFromDiscovery(seed, now).frame;
  const changed: string[] = [];
  const asks: string[] = [];

  // ---- items
  for (const [key, inc] of Object.entries(fresh.items)) {
    const cur = frame.items[key];
    if (!cur) { frame.items[key] = inc; changed.push(key); continue; }
    if (same(cur.value, inc.value)) { if (cur.provenance === "discovery") frame.items[key] = { ...cur, sourcePinId: inc.sourcePinId, at: cur.at }; continue; }
    if (cur.provenance === "discovery") {
      frame.changedSinceDiscovery.push({ key, from: cur.display, to: inc.display, at: now });
      frame.items[key] = inc;
      changed.push(key);
    } else if (!frame.pendingConflicts.some((c) => c.key === key)) {
      frame.pendingConflicts.push({ key, value: inc.value, display: inc.display, quote: inc.quote ?? inc.display, interpretive: "observed", at: now, source: "discovery" });
      asks.push(key);
    }
  }

  // ---- countries (Discovery's only)
  const fc = fresh.countries.filter((c) => c.provenance === "discovery");
  for (const c of fc) if (!frame.countries.some((x) => x.code === c.code && x.role === c.role)) { frame.countries.push(c); changed.push(`country:${c.code}`); }
  const keep = (c: Frame["countries"][number]): boolean => c.provenance !== "discovery" || fc.some((x) => x.code === c.code && x.role === c.role);
  const before = frame.countries.length;
  frame.countries = frame.countries.filter(keep);
  if (frame.countries.length !== before) changed.push("countries");

  // ---- needs Discovery lists
  const freshNeeds = new Map<string, NeedItem>(fresh.needs.filter((n) => n.id.startsWith("n:disc:")).map((n) => [n.id, n]));
  for (const [id, n] of freshNeeds) {
    const cur = frame.needs.find((x) => x.id === id);
    if (!cur) {
      // an equivalent need the client already voiced here is the same need (by concept), not a second one
      if (!frame.needs.some((x) => x.status !== "removed" && n.conceptIds.length > 0 && x.conceptIds.some((c) => n.conceptIds.includes(c)))) { frame.needs.push(n); changed.push(`need:${id}`); }
    }
  }
  for (const cur of frame.needs) {
    if (cur.id.startsWith("n:disc:") && cur.status !== "removed" && !freshNeeds.has(cur.id)) {
      cur.status = "removed";
      cur.note = "no longer in Discovery";
      frame.changedSinceDiscovery.push({ key: `need:${cur.id}`, from: cur.text, to: "", at: now });
      changed.push(`need:${cur.id}`);
    }
  }

  frame.discoveryPinId = seed.pinId ?? frame.discoveryPinId ?? null;
  if (changed.length > 0 || asks.length > 0) {
    if (frame.checkpoint.accepted) frame.checkpoint = { offered: false, accepted: false };
    frame.version += 1;
  }
  return { frame, changed, asks };
}
