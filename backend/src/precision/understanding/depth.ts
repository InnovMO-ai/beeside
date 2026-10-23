/**
 * Depth and sufficiency. Understanding is "ready" when the MATERIAL aspects of THIS project are understood — not when a generic
 * percentage is reached. What is material depends on what the project is (a company setting up a local entity with staff has
 * sizing questions a coffee exporter does not), so applicability and materiality come from the probes and the concepts in the frame.
 *
 * A probe is resolved when the client gave the value, or said the decision is open (undecided), or that they do not know it
 * (unknown), or preferred not to say (withheld). "Unknown" is honest knowledge and becomes a finding for the specialist; it never blocks.
 * Proposals (implicit inferences) never count.
 */
import { PROBES, probeByKey, viewOf, type FrameView, type ProbeDef, type Tier } from "./probes";
import type { Frame, FrameItem } from "./types";

export const MAX_ASKS_PER_PROBE = 2;
/** Valuable (non-blocking) questions asked per project, so the conversation stays a conversation. */
export const MAX_VALUABLE_ASKS = 2;

export type ProbeState = "resolved" | "open" | "partial" | "conflict";
export interface ProbeStatus { probe: ProbeDef; tier: Tier; state: ProbeState; item?: FrameItem; asks: number }

export interface Depth {
  statuses: ProbeStatus[];
  openMaterial: ProbeStatus[];
  openValuable: ProbeStatus[];
  /** Needs the client expressed that the catalog cannot place or that are ambiguous, and have not been clarified yet. */
  needsClarification: string[];
  conflicts: FrameItem[];
  resolvedMaterial: number;
  totalMaterial: number;
  hasSubstance: boolean;
  priorityDone: boolean;
  ready: boolean;
  /** Stable reason codes why it is not ready (for tests and the Sherpa-facing view; never shown as a percentage). */
  blockers: string[];
}

const RESOLVED_STATUSES = new Set(["known", "undecided", "unknown", "withheld"]);

export function probeState(p: ProbeDef, item: FrameItem | undefined, view: FrameView): ProbeState {
  if (!item) return "open";
  if (item.status === "needs_review") return "conflict";
  if (!RESOLVED_STATUSES.has(item.status)) return "open"; // proposed
  if (item.status === "known" && p.complete && !p.complete(item, view)) return "partial";
  return "resolved";
}

export function evaluateDepth(frame: Frame, extra: readonly ProbeDef[] = []): Depth {
  const view = viewOf(frame);
  const statuses: ProbeStatus[] = [];
  for (const p of [...PROBES, ...extra]) {
    if (!p.applies(view)) continue;
    const item = frame.items[p.key];
    statuses.push({ probe: p, tier: p.tier(view), state: probeState(p, item, view), ...(item ? { item } : {}), asks: frame.asked[p.key] ?? 0 });
  }
  statuses.sort((a, b) => a.probe.order - b.probe.order);

  const stuck = (s: ProbeStatus): boolean => s.asks >= MAX_ASKS_PER_PROBE; // asked enough: the planner closes it as "unknown"
  const openMaterial = statuses.filter((s) => s.tier === "material" && s.state !== "resolved" && !stuck(s));
  const openValuable = statuses.filter((s) => s.tier === "valuable" && s.state !== "resolved" && s.asks === 0);
  const material = statuses.filter((s) => s.tier === "material");

  const needsClarification = frame.needs
    .filter((n) => n.status !== "removed" && (n.resolution === "unresolved" || n.resolution === "ambiguous") && !frame.asked[`need:${n.id}`])
    .map((n) => n.id);
  const conflicts = Object.values(frame.items).filter((i) => i.status === "needs_review");

  const activeNeeds = frame.needs.filter((n) => n.status !== "removed");
  const hasSubstance = Boolean(frame.items["project.objective"]) || activeNeeds.length > 0 || frame.countries.length > 0;
  const priorityDone = frame.priority.status === "client_set" || activeNeeds.length < 2 || frame.priority.askedCount >= 2;

  const blockers: string[] = [];
  if (!hasSubstance) blockers.push("no_substance");
  if (activeNeeds.length === 0) blockers.push("no_needs");
  for (const s of openMaterial) blockers.push(`material:${s.probe.key}`);
  for (const id of needsClarification) blockers.push(`need:${id}`);
  for (const c of conflicts) blockers.push(`conflict:${c.key}`);
  if (!priorityDone) blockers.push("priority");

  return {
    statuses, openMaterial, openValuable, needsClarification, conflicts,
    resolvedMaterial: material.filter((s) => s.state === "resolved" || stuck(s)).length,
    totalMaterial: material.length,
    hasSubstance, priorityDone,
    ready: blockers.length === 0,
    blockers,
  };
}

export { probeByKey };
