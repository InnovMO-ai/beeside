import { checkCountryClaims } from "./country-claims";
import { checkTerminology } from "./terminology";
import { checkTone } from "./tone";
import { checkVoice } from "./voice";
import type { Violation, VerifyContext } from "./types";

export * from "./types";
export { checkTone, countQuestions, APPROVED_STATE_LABELS, APPROVED_VERBATIM } from "./tone";
export { checkTerminology } from "./terminology";
export { checkCountryClaims, findCountryClaims, isCountryLegalQuestion } from "./country-claims";
export { checkVoice, significantTokens } from "./voice";
export { produceVerifiedText, type VerifiedOutput, type ProduceArgs } from "./verified-output";

/** All deterministic verifiers (R1–R4, R6, R7, R9, R10, voice lint) over one assistant text. */
export function verifyAssistantText(text: string, ctx: VerifyContext): Violation[] {
  const skip = new Set(ctx.skip ?? []);
  const all = [
    ...checkTone(text, ctx),
    ...checkTerminology(text, ctx),
    ...checkCountryClaims(text, ctx),
    ...checkVoice(text, ctx),
  ];
  return all.filter((x) => !skip.has(x.rule));
}

export function hasCriticalViolation(vs: readonly Violation[]): boolean {
  return vs.some((x) => x.critical);
}
