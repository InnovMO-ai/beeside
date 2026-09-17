/**
 * The `fa.provider.restricted_counterparties` answer value shape (dataType `counterparty_list`,
 * composition 6 "Provider Profile + Resources").
 *
 * Owner decision (2026-09-17, in response to the Design Specification's own flagged open decision
 * "Restricted-counterparty data — visibility and retention"):
 *   - Each entry now carries a `restrictionType`, not just a free-text name — "cannot contract",
 *     "do not share information", or "both" — because downstream enforcement (never disclosed to
 *     providers, excluded before matching/RFI) needs to know which kind of restriction applies.
 *   - Visibility is limited by default to: the client themselves (their own project), the assigned
 *     Sherpa, and an authorized Supervisor/Admin. NOT exposed by default to: providers, The Hive,
 *     Embassy users, BI/Revenue users, unrelated Operation Hub users, or Strategic Advisors — a
 *     Strategic Advisor's access is conditional (granted per project activity under authorized
 *     project permissions), never automatic. Providers must never learn that a restriction exists,
 *     why, or which companies are restricted. See restricted-counterparties.ts for the one sanctioned,
 *     audited read path this policy implies, and first-assessment-context.ts for the exclusion from
 *     the Precision handoff contract (`precisionExcluded` on the canonical field definition).
 *   - Retention: no field-specific policy — it rides the project's own retention_until exactly like
 *     every other `answer` row (fa_project_lifecycle / premium/retention.ts already exclude any
 *     project whose Premium was ever activated from the temporary-retention purge; a non-Premium
 *     project follows the existing FA temporary-data retention policy). Nothing new to build there.
 */

export const RESTRICTION_TYPES = ["cannot_contract", "do_not_share_information", "both"] as const;
export type RestrictionType = (typeof RESTRICTION_TYPES)[number];

export interface CounterpartyEntry {
  name: string;
  restrictionType: RestrictionType;
}

export type CounterpartyListValue = CounterpartyEntry[];

export const COUNTERPARTY_LIST_LIMITS = {
  maxEntries: 25,
  maxNameLength: 200,
} as const;
