/**
 * Understanding Core — shared types.
 *
 * Product principles encoded here (frozen decisions D1, D3, D6, D7, D11; Precision V1.0 core-product macroblock):
 *  - Discovery is the starting hypothesis and inherited KNOWLEDGE: it is known and used (never re-asked without a reason), and
 *    Precision deepens it. It does NOT complete Understanding.
 *  - The AI understands, the product decides: an interpretation is Observed / Understood / Implicit; implicit things are proposals
 *    until the client accepts them; nothing the client did not say is recorded as said.
 *  - Depth is not confirmation: a clearly stated fact is known without a confirm button; explicit confirmation is exceptional.
 *  - Priority belongs to the client and is a different thing from execution dependency.
 */
export type Loc = "es" | "en";
export type L10n = Record<Loc, string>;

/** Where a known value comes from. `discovery` carries the source pin / item reference. */
export type Provenance = "discovery" | "client_stated" | "client_confirmed" | "client_corrected" | "ai_understood";

/** What the frame knows about one probe. `undecided` = the client says the decision is still open (itself valuable knowledge). */
export type ItemStatus = "known" | "proposed" | "unknown" | "withheld" | "undecided" | "needs_review";

export type Interpretive = "observed" | "understood" | "implicit";

export interface FrameItem {
  key: string;
  value: unknown;
  /** Short client-language rendering (data, never instructions). */
  display: string;
  status: ItemStatus;
  provenance: Provenance;
  interpretive: Interpretive;
  /** The client's words that support it (verified to occur in the client's text) or, for Discovery, a source description. */
  quote?: string;
  sourceItemRef?: string;
  sourcePinId?: string;
  /** Why the client says so (rationale), when given. */
  why?: string;
  turnKey?: string;
  /** ISO time the fact was last stated/confirmed (freshness). */
  at: string;
  confidence?: number;
}

export type CountryRole = "origin" | "process" | "sales" | "operation" | "transit" | "support" | "headquarters" | "unspecified";
export interface CountryEntry { code: string; role: CountryRole; phase?: number; provenance: Provenance; quote?: string; sourceItemRef?: string; at: string }

export interface Phase { id: string; order: number; label: string; countries: string[]; provenance: Provenance; quote?: string; at: string }

export type NeedResolution = "resolved" | "ambiguous" | "unresolved" | "outcome" | "compound";
export type NeedStatus = "proposed" | "confirmed" | "removed";
export type NeedOrigin = "discovery" | "narrative" | "added" | "implied";

export interface NeedItem {
  id: string;
  /** The client's own words, cleaned (never replaced by the catalog name). */
  text: string;
  conceptIds: string[];
  resolution: NeedResolution;
  categoryKey: string | null;
  serviceKeys: string[];
  status: NeedStatus;
  origin: NeedOrigin;
  quote?: string;
  why?: string;
  /** The client moved this need to another category / marked it as not important etc. */
  note?: string;
  at: string;
}

/** An implication the AI sees but the client has not said. Never counts for sufficiency until accepted. */
export interface ImpliedItem {
  id: string;
  kind: "implied_need" | "implied_branch" | "attribute";
  conceptId: string;
  text: L10n;
  reason: L10n;
  premises: string[];
  status: "proposed" | "accepted" | "rejected";
  at: string;
}

export interface Rationale { id: string; subject: string; text: string; quote?: string; at: string }

export type PriorityStatus = "unprioritized" | "proposed" | "client_set";
export type PriorityRank = "top" | "important" | "can_wait";
export interface PriorityGroup { rank: PriorityRank; subjects: string[]; reason?: string; timing?: string }
export interface PriorityState { status: PriorityStatus; groups: PriorityGroup[]; at?: string; askedCount: number }

export type FindingKind = "specialist_review" | "decision_pending" | "missing_information" | "inconsistency" | "assumption" | "unresolved_need";
export type Specialty = "legal" | "tax" | "labor" | "customs" | "regulatory" | "corporate" | "finance";
export interface Finding {
  /** Deterministic id: the same facts always produce the same id (no duplicates, no spam). */
  id: string;
  kind: FindingKind;
  specialty?: Specialty;
  title: L10n;
  detail: L10n;
  /** Frame keys / need ids that support the finding. */
  basis: string[];
  /** Knowledge unit ids / source refs consulted for the finding (provenance), if any. */
  knowledgeRefs: string[];
  status: "open" | "resolved";
  at: string;
}

/** A value the client gave that contradicts what Discovery established (or an earlier statement) and has not been settled yet. */
export interface ConflictRecord { key: string; value: unknown; display: string; quote: string; interpretive: Interpretive; at: string; /** The newer value comes from Discovery (it changed after the client spoke here). */ source?: "discovery" }

export interface Frame {
  version: number;
  locale: Loc;
  items: Record<string, FrameItem>;
  countries: CountryEntry[];
  phases: Phase[];
  needs: NeedItem[];
  implied: ImpliedItem[];
  rationale: Rationale[];
  priority: PriorityState;
  /** Concepts mentioned by the client or inherited (drive which dimensions are material). */
  concepts: Record<string, { first: string; origin: "discovery" | "client" }>;
  /** Keys of probes already asked at least once (to avoid loops) with the count. */
  asked: Record<string, number>;
  /** Free notes the client left that match no dimension (kept for the Sherpa; never scored). */
  notes: { text: string; at: string }[];
  /** Structured record of what changed since Discovery. */
  changedSinceDiscovery: { key: string; from: string; to: string; at: string }[];
  discoveryPinId?: string | null;
  checkpoint: { offered: boolean; accepted: boolean; at?: string };
  pendingConflicts: ConflictRecord[];
  closedAt?: string | null;
}

export const emptyFrame = (locale: Loc): Frame => ({
  version: 0,
  locale,
  items: {},
  countries: [],
  phases: [],
  needs: [],
  implied: [],
  rationale: [],
  priority: { status: "unprioritized", groups: [], askedCount: 0 },
  concepts: {},
  asked: {},
  notes: [],
  changedSinceDiscovery: [],
  discoveryPinId: null,
  checkpoint: { offered: false, accepted: false },
  pendingConflicts: [],
  closedAt: null,
});
