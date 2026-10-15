/**
 * Port the Understanding engine uses to record an unmet knowledge demand. Best-effort by design: registering a demand must never
 * break or delay a client turn, and it never writes the question itself (only the normalised descriptors of `describeDemand`).
 */
import type { Frame } from "../understanding/types";
import { describeDemand, type DemandOutcome, type DemandRepository, type KnowledgeDemand } from "./demand";

export interface DemandInput { projectId: string; turnKey: string; frame: Frame; question: string; outcome: DemandOutcome }
export interface DemandPort {
  /** Returns the normalised demand that was registered, or null when the knowledge covered the question. */
  register(input: DemandInput): Promise<KnowledgeDemand | null>;
}

export function createDemandPort(repo: DemandRepository, opts: { now?: () => Date; onError?: (err: unknown) => void } = {}): DemandPort {
  return {
    async register(i) {
      const d = describeDemand(i.frame, i.question, i.outcome);
      if (!d) return null;
      try {
        await repo.register(d, { projectId: i.projectId, turnKey: i.turnKey }, (opts.now ? opts.now() : new Date()).toISOString());
      } catch (err) {
        opts.onError?.(err);
      }
      return d;
    },
  };
}
