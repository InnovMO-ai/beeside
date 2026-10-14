/**
 * Category readiness from what is understood about THIS project. A category is ready to start when the material aspects that
 * matter for it are understood — not when a generic percentage is reached, and not blocked by aspects of other categories.
 *
 * The aspects (probes) already apply only when the project makes them relevant (a coffee exporter has no payroll aspects), so
 * this only groups the project's own applicable aspects by the category they inform:
 *   material + open      -> blocker for that category (the client has not said, and has not said they do not know)
 *   unknown / withheld   -> honest knowledge: never a blocker, it goes to the specialist as a pending item
 *   undecided            -> the decision is open: never a blocker, the specialist helps decide
 */
import { evaluateDepth } from "./depth";
import { PROBES, type Dimension } from "./probes";
import type { Frame } from "./types";

/** Which categories each dimension informs. A probe may inform several categories. */
export const DIMENSION_CATEGORIES: Readonly<Record<Dimension, readonly string[]>> = {
  project: [],
  entity: ["corporate_legal_admin", "tax_accounting_audit", "banking_finance_insurance"],
  workforce: ["people_payroll_employment", "corporate_legal_admin"],
  scale: ["tax_accounting_audit", "procurement_supply_chain", "people_payroll_employment"],
  tax: ["tax_accounting_audit"],
  trade: ["logistics", "international_trade_customs"],
  product: ["logistics", "international_trade_customs", "procurement_supply_chain", "market_intelligence"],
  location: ["industrial_real_estate", "corporate_real_estate", "market_intelligence"],
};

export interface CategoryReadiness {
  categoryKey: string;
  /** Aspects that matter for this category in this project. */
  material: string[];
  /** Material aspects still open (blockers). */
  open: string[];
  /** Aspects the client does not know / left undecided / preferred not to say (for the specialist; never blockers). */
  forSpecialist: string[];
  ready: boolean;
}

export function categoryReadiness(frame: Frame, categoryKey: string): CategoryReadiness {
  const depth = evaluateDepth(frame);
  const mine = depth.statuses.filter((s) => (DIMENSION_CATEGORIES[s.probe.dimension] ?? []).includes(categoryKey));
  const material = mine.filter((s) => s.tier === "material");
  const open = material.filter((s) => s.state !== "resolved" && s.asks < 2).map((s) => s.probe.key);
  const forSpecialist = mine
    .filter((s) => s.item && (s.item.status === "unknown" || s.item.status === "withheld" || s.item.status === "undecided"))
    .map((s) => s.probe.key);
  return { categoryKey, material: material.map((s) => s.probe.key), open, forSpecialist, ready: open.length === 0 };
}

/** Every category the project's needs touch, with its readiness. */
export function readinessByCategory(frame: Frame): CategoryReadiness[] {
  const keys = [...new Set(frame.needs.filter((n) => n.status !== "removed" && n.categoryKey).map((n) => n.categoryKey as string))];
  return keys.map((k) => categoryReadiness(frame, k));
}

void PROBES;
