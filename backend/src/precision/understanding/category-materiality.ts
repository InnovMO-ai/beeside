/**
 * Materiality rules by category: which dimensions the project's own signals make MATERIAL, so the category is not declared understood
 * while an obvious material dimension is unexplored. FROZEN RULE: readiness = material sufficiency for THIS project — not "the generic
 * blocking fields are complete", and not "every possible field": only what the signals make material.
 *
 * Fact vs judgment: everything listed here is a FACT the client can state (is there a written agreement? what framework do you report
 * under? who are the shareholders?). Interpretation (is it arm's length? what is the treatment of the loan?) is never asked as a field:
 * it is the specialist's job. Pure and deterministic; the result is stored as the category's `material_overlay` system fact.
 */
import type { Rule } from "../manifest/ast";
import type { MaterialItem, MaterialOverlay } from "../manifest/material";
import { hasSignal, materialSignals, type MaterialSignal, type SignalKey } from "./material-signals";
import type { Frame } from "./types";

interface MaterialRule {
  field: string;
  subs?: string[];
  /** All of these signals must be present... */
  all?: SignalKey[];
  /** ...and at least one of these (when given). */
  any?: SignalKey[];
  /** Premise guard over the category's own facts. */
  unless?: Rule;
}

const noIntercompany: Rule = { op: "field_equals", field_key: "tax_has_intercompany_transactions", value: false };
const INTERCO: SignalKey[] = ["intercompany_any", "intercompany_services", "intercompany_goods", "intercompany_financing", "intercompany_ip", "parent_loan"];

const RULES: Readonly<Record<string, readonly MaterialRule[]>> = {
  tax_accounting_audit: [
    // a foreign parent with a local presence: how the local books relate to the group's
    { field: "tax_accounting_framework", all: ["foreign_parent"], any: ["local_entity", "parent_funding", "intercompany_any", "group_reporting"] },
    { field: "tax_parent_reporting_required", all: ["foreign_parent"], any: ["local_entity", "parent_funding", "intercompany_any", "group_reporting"] },
    // transactions with the group: what they are, with whom, how big, and whether there is a written agreement (facts, not judgment)
    { field: "tax_has_intercompany_transactions", any: INTERCO },
    { field: "tax_intercompany_transactions", subs: ["counterparty_country", "transaction_type", "expected_annual_value", "written_agreement"], any: INTERCO, unless: noIntercompany },
    // where transfer-pricing documentation stands (a fact) is material as soon as there are related-party transactions, whether or not the service was named
    { field: "tax_transfer_pricing_documentation_status", any: INTERCO, unless: noIntercompany },
  ],
  corporate_legal_admin: [
    { field: "legal_shareholder_structure", subs: ["holder_type", "holder_country", "ownership_share"], all: ["foreign_parent", "local_entity"] },
    { field: "legal_shareholder_structure", subs: ["holder_type", "holder_country", "ownership_share"], all: ["partners"] },
  ],
  people_payroll_employment: [
    { field: "hr_local_entity_status", all: ["foreign_parent", "workforce_direct"] },
  ],
  international_trade_customs: [
    { field: "customs_related_party_transactions", all: ["intercompany_goods"] },
  ],
};

const sigs = (signals: readonly MaterialSignal[], keys: readonly SignalKey[]): string[] => keys.filter((k) => hasSignal(signals, k));

/** The overlay for ONE category from the project's frame. Empty when nothing is material beyond the manifest's own requirements. */
export function deriveMaterial(frame: Frame, categoryKey: string, signals: readonly MaterialSignal[] = materialSignals(frame)): MaterialOverlay {
  const items: MaterialItem[] = [];
  for (const r of RULES[categoryKey] ?? []) {
    if (r.all && !r.all.every((k) => hasSignal(signals, k))) continue;
    if (r.any && sigs(signals, r.any).length === 0) continue;
    const because = [...new Set([...(r.all ?? []), ...sigs(signals, r.any ?? [])])];
    const existing = items.find((i) => i.field === r.field);
    if (existing) { existing.because = [...new Set([...existing.because, ...because])]; continue; }
    items.push({ field: r.field, ...(r.subs ? { subs: r.subs } : {}), because, ...(r.unless ? { unless: r.unless } : {}) });
  }
  return { v: 1, items };
}
