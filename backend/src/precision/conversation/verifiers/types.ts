import type { ApprovedSource, Locale, Surface } from "../types";

export type RuleId = "R1" | "R2" | "R3" | "R4" | "R6" | "R7" | "R9" | "R10" | "VOICE";

export interface Violation {
  rule: RuleId;
  /** Stable machine code, e.g. "unintroduced_crp". */
  code: string;
  hit: string;
  message: string;
  /** Critical violations (everything except R4) are never delivered. */
  critical: boolean;
}

export interface KnownFieldSignature { fieldKey: string; label: string }

export interface VerifyContext {
  locale: Locale;
  surface: Surface;
  /** Term ids already introduced to the client (e.g. "crp"). */
  introducedTerms: ReadonlySet<string>;
  /** OH active and a Sherpa really assigned (the only state in which "your Sherpa" is allowed). */
  sherpaAssigned: boolean;
  /** The Sherpa role may be explained in general terms (process answer about the Sherpa). */
  allowSherpaGeneral: boolean;
  /** Labels of fields already confirmed (R6: never re-ask known facts). */
  knownFields?: readonly KnownFieldSignature[];
  /** Label of the field being asked; used to avoid flagging the question that is supposed to be asked. */
  targetLabels?: readonly string[];
  approvedSources: readonly ApprovedSource[];
  /** Destination country names (any language) in addition to the built-in table. */
  extraCountryNames?: readonly string[];
  /** Rules to skip (e.g. R3 on a process answer that must contain no question). */
  skip?: readonly RuleId[];
  /** "none" = the text must contain no question; "one" = exactly one; "at-most-one" = zero or one. */
  questions?: "none" | "one" | "at-most-one";
}
