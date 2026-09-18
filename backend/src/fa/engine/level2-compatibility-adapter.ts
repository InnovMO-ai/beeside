import { isAnswered } from "./conditions";

/**
 * Level 2 MVP legacy-compatibility shim — internal only, never part of the visible journey and
 * never persisted as an `answer` row. Companion to legacy-capability-adapter.ts (same pattern: a
 * real stored answer for either field_key always wins; this only fills the gap for a Level 2
 * project that was never asked the question at all).
 *
 * Owner decisions, 2026-09-18 ("OWNER DECISIONS — FINAL LEVEL 2 JOURNEY ALIGNMENT" — see
 * question-bank-v2.ts's file header for the full context each of these responds to):
 *
 *   - `fa.strategic.commercial_success` (SP2) is no longer a client-facing question — its meaning is
 *     sufficiently covered by `fa.goal.success_definition` (G2), and the respondent should not
 *     answer the same "what does success look like" question twice. Any downstream consumer that
 *     still reads `fa.strategic.commercial_success` (snapshot/compose.ts's strategic_prompts,
 *     fa/engine/expansion-profile.ts's commercial_validation dimension) is served a deterministic,
 *     verbatim copy of the respondent's own G2 answer — never a reworded or summarized version, and
 *     never a guess when G2 itself is unanswered.
 *   - `fa.goal.expansion_driver` (G6) is no longer a client-facing question — PR_DRIVER_STRUCTURED
 *     (`fa.project.primary_driver_structured`) is now the ONLY client-facing structured-driver
 *     interaction. The two fields already share an identical value set "by design"
 *     (structured-echo.ts's own comment on PR_DRIVER_STRUCTURED), so the confirmed structured value
 *     is copied across as-is — not translated, not reinterpreted.
 *
 * `fa.goal.timing_driver` (G5) is deliberately NOT handled here: no deterministic source exists for
 * its specific categorical taxonomy in the Level 2 journey (PR_FLEX_REASON is free text, gated only
 * when the date is somewhat fixed — a narrower, differently-shaped question). See
 * question-bank-v2.ts's file header for how its one confirmed reader degrades gracefully instead.
 */
export function deriveLevel2CompatibilityAnswers(effectiveAnswers: ReadonlyMap<string, unknown>): Map<string, unknown> {
  const derived = new Map<string, unknown>();

  const successDefinition = effectiveAnswers.get("fa.goal.success_definition");
  if (isAnswered(successDefinition)) derived.set("fa.strategic.commercial_success", successDefinition);

  const driverStructured = effectiveAnswers.get("fa.project.primary_driver_structured");
  if (isAnswered(driverStructured)) derived.set("fa.goal.expansion_driver", driverStructured);

  return derived;
}
