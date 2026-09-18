import type { CounterpartyListValue } from "../fa/engine/counterparty-types";
import type { NeedsMapDependency, NeedsMapValue } from "../fa/engine/needs-map-types";

/**
 * Handoff-level sanitization for `fa.needs.map` on the FA -> Precision contract (owner decision,
 * 2026-09-18, narrowest-safe-remedy variant of the restricted-counterparties policy in
 * counterparty-types.ts).
 *
 * `NeedsMapDependency.owner` and `.approvalFrom` are free text the respondent typed — unlike
 * `fa.provider.restricted_counterparties` itself, this field was never `precisionExcluded` (the
 * dependency structure as a whole is legitimate, needed Precision context), so a respondent naming a
 * restricted counterparty in either subfield would otherwise reach Precision unfiltered — the same
 * class of leak `precisionExcluded` exists to prevent, just via an untagged field.
 *
 * The remedy is scoped to exactly those two subfields, not the field, not the whole dependency, and
 * not a global blacklist: every other part of `NeedsMapValue` (selections, priorityRank,
 * blockerKeys, and the rest of each dependency — key/dependsOn/approvalRequired) passes through
 * unchanged, and matching is only ever against *this project's own* restricted-counterparty list.
 * The canonical `answer` row is never touched — this runs only on the derived copy handed to
 * Precision (see first-assessment-context.ts); the client's original text remains intact in FA's own
 * authorized-access record.
 */

/** Neutral, non-identifying stand-in for a redacted owner/approvalFrom value. Never names the
 *  restricted counterparty or the reason it's restricted. */
export const REDACTED_DEPENDENCY_VALUE = "Restricted external dependency";

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function mentionsAnyRestrictedName(value: string, normalizedRestrictedNames: readonly string[]): boolean {
  const normalizedValue = normalize(value);
  if (!normalizedValue) return false;
  return normalizedRestrictedNames.some((name) => name.length > 0 && normalizedValue.includes(name));
}

function sanitizeField(value: string | null, normalizedRestrictedNames: readonly string[]): string | null {
  if (!value) return value;
  return mentionsAnyRestrictedName(value, normalizedRestrictedNames) ? REDACTED_DEPENDENCY_VALUE : value;
}

/**
 * Returns a `NeedsMapValue` safe to include in the FA -> Precision contract: any `dependencies[].owner`
 * or `dependencies[].approvalFrom` that names one of `restrictedCounterparties` is replaced with
 * `REDACTED_DEPENDENCY_VALUE`; everything else (including the rest of that same dependency) is
 * preserved as-is. Pure and side-effect free — never mutates its inputs, and returns the original
 * object unchanged (same reference) when there is nothing to redact, so callers never pay for a copy
 * on the common case.
 */
export function sanitizeNeedsMapForPrecision(needsMap: NeedsMapValue, restrictedCounterparties: CounterpartyListValue): NeedsMapValue {
  if (needsMap.dependencies.length === 0 || restrictedCounterparties.length === 0) return needsMap;

  const normalizedRestrictedNames = restrictedCounterparties.map((entry) => normalize(entry.name)).filter((name) => name.length > 0);
  if (normalizedRestrictedNames.length === 0) return needsMap;

  let changed = false;
  const dependencies: NeedsMapDependency[] = needsMap.dependencies.map((dependency) => {
    const owner = sanitizeField(dependency.owner, normalizedRestrictedNames);
    const approvalFrom = sanitizeField(dependency.approvalFrom, normalizedRestrictedNames);
    if (owner === dependency.owner && approvalFrom === dependency.approvalFrom) return dependency;
    changed = true;
    return { ...dependency, owner, approvalFrom };
  });

  return changed ? { ...needsMap, dependencies } : needsMap;
}
