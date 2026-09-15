/**
 * Anti-abuse signals for the public identity step (Phase 13). A hidden honeypot field and a minimum
 * form-completion time catch unsophisticated automation; a bot-challenge provider can be plugged in
 * behind `BotChallengeVerifier` once one is chosen (none is selected here). Automated signals alone
 * never block a person: a filled honeypot is answered exactly like an existing email (nothing is
 * stored or sent), and weaker signals mark the project for REVIEW instead of refusing it.
 */

export const HONEYPOT_FIELD = "referenceCode";
export const MIN_FORM_FILL_MS = 1500;

export type ChallengeOutcome = "passed" | "failed" | "not_configured";

export interface BotChallengeVerifier {
  readonly name: string;
  verify(token: string | null, remoteAddress: string): Promise<ChallengeOutcome>;
}

/** Default until a provider is chosen: no challenge is shown and none is verified. */
export class NoBotChallenge implements BotChallengeVerifier {
  readonly name = "none";
  async verify(): Promise<ChallengeOutcome> {
    return "not_configured";
  }
}

export interface IdentityAbuseSignals {
  honeypotFilled: boolean;
  tooFast: boolean;
  challenge: ChallengeOutcome;
}

export function readIdentitySignals(body: unknown): { honeypotFilled: boolean; tooFast: boolean; challengeToken: string | null } {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const honeypot = b[HONEYPOT_FIELD];
  const elapsed = b.formElapsedMs;
  const token = b.challengeToken;
  return {
    honeypotFilled: typeof honeypot === "string" ? honeypot.trim() !== "" : honeypot !== undefined && honeypot !== null,
    tooFast: typeof elapsed === "number" && Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_FORM_FILL_MS,
    challengeToken: typeof token === "string" && token.length > 0 && token.length <= 4096 ? token : null,
  };
}

/** Trust state for a new project (Functional Specification §12): automated signals never BLOCK. */
export function trustStateFor(signals: IdentityAbuseSignals): "NORMAL" | "REVIEW" {
  return signals.tooFast || signals.challenge === "failed" ? "REVIEW" : "NORMAL";
}
