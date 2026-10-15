/**
 * Precision's side of the Knowledge Layer boundary: the ports the Understanding engine consumes, and nothing else.
 * The engine never sees the layer; adapters (./adapters.ts) translate a project Frame into contract requests and the layer's responses
 * into conversation-ready answers.
 */
import type { Frame, Loc } from "../understanding/types";
import type { Availability, BoundaryKind, DemandOutcome, DemandReason, L10n } from "../../knowledge-layer/contract";

export type { Availability, BoundaryKind, DemandOutcome, DemandReason };

export interface OrientationAnswer {
  text: string;
  /** Unit ids the answer rests on (traceable to source, edition and version through the layer). */
  sourceRefs: string[];
  sherpaNote?: string;
  /** How much approved knowledge covered the question (the layer's availability: sufficient -> full, partial, unavailable -> none). */
  coverage?: "full" | "partial" | "none";
  reason?: DemandReason;
  /** Set when the client asked for a determination that belongs to a specialist (the engine then states the boundary). */
  boundary?: { kind: BoundaryKind; area: L10n };
}

/** Optional Level-2 orientation: answers a client question from approved knowledge (never a recommendation, never an obligation). */
export interface OrientationPort {
  /** True when approved sources exist for the project's jurisdiction. */
  available(frame: Frame): Promise<boolean>;
  /** Null when nothing approved applies. An empty `text` with a boundary is valid. */
  answer(frame: Frame, question: string, locale: Loc): Promise<OrientationAnswer | null>;
}

export interface DemandInput { projectId: string; turnKey: string; frame: Frame; question: string; outcome: DemandOutcome }
export interface RegisteredDemand {
  topic: string;
  subtopic: string;
  infoType: string;
  coverage: "absent" | "partial";
  boundary: { kind: BoundaryKind; area: L10n } | null;
}
/** Registers what approved knowledge could not answer, as a normalised signal to the layer (no client text). Best-effort. */
export interface DemandPort {
  register(input: DemandInput): Promise<RegisteredDemand | null>;
}

export interface ResourceOffer { id: string; title: string; text: string }
export interface ResourcesPort {
  /** At most one offer for this frame, or null. The caller marks `frame.asked[key]` so it is never repeated. */
  offer(frame: Frame, locale: Loc, now: string, stage: "topic" | "priority"): Promise<(ResourceOffer & { key: string }) | null>;
}
