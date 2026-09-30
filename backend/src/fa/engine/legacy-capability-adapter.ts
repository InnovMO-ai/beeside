import { NeedsMapStatus, NeedsMapValue } from "./needs-map-types";

/**
 * Level 2 MVP legacy-compatibility shim — internal only, never part of the visible journey and
 * never persisted as an `answer` row.
 *
 * Decision (owner, 2026-09-17): the pre-Level-2 "capability mother question" (CAP1,
 * `fa.operation.expected_capabilities`) and its two children (`fa.operation.banking_status`,
 * `fa.operation.insurance_status`) are removed from the visible journey — they are a near
 * word-for-word duplicate of the new Needs Explorer's own leaf-selection mechanism (composition 5,
 * `fa.needs.map`), and the owner's rule is explicit: don't keep two mechanisms asking essentially
 * the same thing.
 *
 * The open risk this file resolves: the rules engine's live, DB-stored `rules_engine_version.config`
 * (an admin-versioned JSON blob, not source in this repository) MAY reference these exact
 * field_keys in an `AreaDefinition.evidence_fields` array — `RANKING_FACTORS` includes
 * `"capability_need"`, and `fa.operation.expected_capabilities`'s own canonical field description
 * names it as the intended capability input. That config was not available to audit from this
 * checkout, so deleting the field outright is not provably safe, and re-adding the old questions to
 * the screen would violate the single-experience decision. This adapter is the reconciliation the
 * owner explicitly authorized ("adaptadores/mappings internos para datos históricos si ayudan a
 * migración o continuidad"): it derives the legacy field_key/value shape from the new
 * `fa.needs.map` answer, purely in memory, as an additional rules-engine evidence input only (see
 * the call site in snapshot-service.ts) — never shown to the user, never written to the `answer`
 * table. A real fa-qb-1.1.0 answer for these field_keys, where one already exists, always wins;
 * this is a fallback for Level 2 projects that never asked the old questions at all.
 *
 * UPDATED 2026-09-30 (Design Freeze taxonomy replacement, needs-explorer-taxonomy.ts): the leaf set
 * this map keys off of changed from the old 11-category/~30-leaf taxonomy to the frozen 6 families
 * (A–F) / 36 capabilities. Every leaf that survived the freeze kept its key (see that file's own
 * "KEY STABILITY" note), so its mapping below is unchanged; every genuinely new leaf introduced by
 * the freeze gets a best-effort mapping onto the same fixed CAP1 legacy vocabulary
 * (questions-operation.ts) below; leaves dropped by the freeze (audit, business_advisory,
 * transfer_pricing, third_party_qualification, warehouse_automation, country_market_brief,
 * feasibility, trade_market_access, growth_gtm, partnership_strategy, business_check) are removed
 * from this map — they can no longer be selected, so a dangling entry would never be read.
 *
 * ACTION NEEDED (flagging, not blocking): confirm against the live `rules_engine_version.config`
 * whether these three field_keys are actually referenced by any `AreaDefinition`. If not, this file
 * and its one call site can be deleted with zero effect on findings/capability ranks. If yes, note
 * the mapping below is a best-effort approximation across two taxonomies that are not isomorphic
 * (CAP1's 24 legacy values vs. the Needs Explorer's 36 leaves, grouped differently) — legacy values
 * with no Needs Explorer equivalent (e.g. "contracts", "manufacturing" — the taxonomy still has no
 * manufacturing leaf, a documented gap) are intentionally never derived and will simply not appear.
 * The durable fix, if the live config does depend on this, is a new `rules_engine_version` whose
 * config reads `fa.needs.map` directly — the existing Draft→Preview→Publish workflow already
 * supports publishing one without any of this adapter.
 */

const LEAF_TO_LEGACY_CAPABILITY: Readonly<Record<string, readonly string[]>> = {
  // Family A — Validate market & strategy
  market_validation: ["commercial_strategy"],
  demand_validation: ["commercial_strategy", "marketing"],
  appetite_tracker: ["commercial_strategy"],
  entry_strategy: ["commercial_strategy", "sales_channels"],
  commercial_strategy_channels: ["commercial_strategy", "sales_channels"],
  growth: ["commercial_strategy", "marketing"],
  local_partner_search_match: ["local_partner_distributor"],
  location_analysis: ["risk_due_diligence", "facilities"],
  // Family B — Establish local structure
  company_setup: ["legal_corporate"],
  tax_accounting: ["tax", "accounting"],
  banking: ["banking"],
  insurance: ["insurance"],
  regulatory_permits: ["regulatory_compliance"],
  intellectual_property: ["legal_corporate", "contracts"],
  // Family C — Prepare facilities & infrastructure
  industrial_warehouse_real_estate: ["facilities"],
  lease_purchase_development: ["facilities"],
  construction: ["facilities"],
  infrastructure_utilities: ["facilities"],
  physical_security: ["facilities", "cyber_data"],
  // Family D — Build the local team
  recruitment: ["talent_hr"],
  hr_payroll_social_security: ["talent_hr", "payroll"],
  mobility_immigration: ["talent_hr"],
  labor_advisory: ["talent_hr", "regulatory_compliance"],
  specialized_talent: ["talent_hr"],
  // Family E — Activate operations & supply chain
  supplier_search: ["suppliers"],
  purchasing_sourcing: ["suppliers"],
  foreign_trade_customs: ["customs_trade"],
  freight_mobility: ["logistics"],
  threepl_warehousing_inventory: ["warehousing", "logistics"],
  last_mile: ["logistics"],
  // Family F — Technology & digital operations
  erp: ["technology"],
  wms: ["technology"],
  tms: ["technology"],
  integrations: ["technology"],
  data_video_surveillance: ["technology", "cyber_data"],
  cybersecurity: ["cyber_data"],
};

/** NeedsMapStatus (5 states) collapsed onto the legacy 4-state RESOLUTION_STATUS (helpers.ts). The
 *  internal-vs-provider distinction has no legacy equivalent and is intentionally lost here only —
 *  it is fully preserved in the real `fa.needs.map` answer. */
function toLegacyResolutionStatus(status: NeedsMapStatus): string {
  switch (status) {
    case "covered_internally":
    case "covered_by_provider":
      return "already_in_place";
    case "in_progress":
      return "in_progress";
    case "needs_resolution":
      return "need_to_establish";
    case "needs_confirmation":
    default:
      return "not_sure_required";
  }
}

/**
 * Derives `{ "fa.operation.expected_capabilities", "fa.operation.banking_status",
 * "fa.operation.insurance_status" }` from a `fa.needs.map` answer, for merging into the rules
 * engine's evidence map only (see snapshot-service.ts). Returns an empty map when there is no
 * needs_map answer, or when it has no selections. Never throws.
 */
export function deriveLegacyCapabilityAnswers(effectiveAnswers: ReadonlyMap<string, unknown>): Map<string, unknown> {
  const derived = new Map<string, unknown>();
  const needsMap = effectiveAnswers.get("fa.needs.map") as NeedsMapValue | undefined;
  if (!needsMap || !Array.isArray(needsMap.selections) || needsMap.selections.length === 0) return derived;

  const legacyCapabilities = new Set<string>();
  for (const selection of needsMap.selections) {
    for (const legacyValue of LEAF_TO_LEGACY_CAPABILITY[selection.key] ?? []) legacyCapabilities.add(legacyValue);
  }
  if (legacyCapabilities.size > 0) derived.set("fa.operation.expected_capabilities", [...legacyCapabilities]);

  const banking = needsMap.selections.find((s) => s.key === "banking");
  if (banking) derived.set("fa.operation.banking_status", toLegacyResolutionStatus(banking.status));
  const insurance = needsMap.selections.find((s) => s.key === "insurance");
  if (insurance) derived.set("fa.operation.insurance_status", toLegacyResolutionStatus(insurance.status));

  return derived;
}
