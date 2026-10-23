import type { Violation } from "./types";

export interface ProduceArgs {
  /** Produces a draft. attempt 2 receives the rule codes of the rejected draft. May throw ModelUnavailableError. */
  generate: (attempt: 1 | 2, feedback: string[]) => Promise<string>;
  verify: (text: string) => Violation[];
  /** Fixed-copy fallback built from the manifest label (never blocks the client). */
  fallback: () => string;
  /** Replacement when a country-specific claim has no approved source (R10). */
  r10Replacement: () => string;
  /** Whether the budget allows one more model call (regeneration). */
  canRegenerate: () => boolean;
}

export interface VerifiedOutput {
  text: string;
  /** The fixed-copy fallback question replaced the model text. */
  usedFallback: boolean;
  regenerated: boolean;
  /** An unapproved country-specific claim was replaced and a pending item must be signalled. */
  r10: boolean;
  /** Violations of the rejected drafts, in order (for logs/tests; never shown). */
  rejected: Violation[][];
}

const isBlocking = (vs: Violation[]): boolean => vs.some((v) => v.critical || v.rule === "R4");

/**
 * Verified output pipeline: draft → verify → (regenerate once, when the budget allows) → fixed-copy fallback.
 * An R10 violation is never regenerated: the text is replaced by the "cannot confirm yet" copy.
 */
export async function produceVerifiedText(args: ProduceArgs): Promise<VerifiedOutput> {
  const rejected: Violation[][] = [];
  const first = await args.generate(1, []);
  const v1 = args.verify(first);
  if (!isBlocking(v1)) return { text: first, usedFallback: false, regenerated: false, r10: false, rejected };
  rejected.push(v1);
  if (v1.some((v) => v.rule === "R10")) return { text: args.r10Replacement(), usedFallback: false, regenerated: false, r10: true, rejected };

  if (args.canRegenerate()) {
    const second = await args.generate(2, [...new Set(v1.map((v) => v.code))]);
    const v2 = args.verify(second);
    if (!isBlocking(v2)) return { text: second, usedFallback: false, regenerated: true, r10: false, rejected };
    rejected.push(v2);
    if (v2.some((v) => v.rule === "R10")) return { text: args.r10Replacement(), usedFallback: false, regenerated: true, r10: true, rejected };
    return { text: args.fallback(), usedFallback: true, regenerated: true, r10: false, rejected };
  }
  return { text: args.fallback(), usedFallback: true, regenerated: false, r10: false, rejected };
}
