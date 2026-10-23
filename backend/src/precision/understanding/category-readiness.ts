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
import type { FactMap } from "../manifest/types";
import { PROBE_COVERAGE, inheritedProbes } from "./category-inheritance";
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

/**
 * Readiness of a category as the project experiences it: what the project conversation established, plus what the client answered
 * IN the category (an answer given in either place resolves the aspect). Aspects that are still open split into:
 *  - `asking`: the category itself asks them (a field of its manifest answers that aspect) — they close as the client answers;
 *  - `openInProject`: no field of this category can hold the answer, but it is still a FACT the client can state. It is NOT handed to
 *    the specialist: it stays open in the Project Frame (Understanding keeps asking it) and counts against the category's readiness.
 *
 * Frozen boundary: a fact Precision can reasonably obtain from the client is asked; the specialist receives professional judgment,
 * interpretation, external validation, analysis or an execution decision — and what the client honestly does not know (`forSpecialist`).
 */
export interface CategoryUnderstanding extends CategoryReadiness {
  asking: string[];
  /** Material facts that no field of this category holds and the project has not settled: Understanding still asks them. */
  openInProject: string[];
  /** Material aspects of this category that the project already settled or the category answered. */
  settled: string[];
}

export function categoryUnderstanding(frame: Frame, categoryKey: string, facts: FactMap, manifestFields: ReadonlySet<string>): CategoryUnderstanding {
  const base = categoryReadiness(frame, categoryKey);
  const answeredHere = (probeKey: string): boolean => (PROBE_COVERAGE[probeKey] ?? []).some((f) => facts[f] !== undefined && facts[f]!.answerState !== "NOT_ASKED");
  const coveredHere = (probeKey: string): boolean => (PROBE_COVERAGE[probeKey] ?? []).some((f) => manifestFields.has(f));
  const open = base.open.filter((k) => !answeredHere(k));
  const asking = open.filter(coveredHere);
  const uncovered = open.filter((k) => !coveredHere(k));
  return {
    ...base,
    open: asking,
    asking,
    openInProject: uncovered,
    forSpecialist: base.forSpecialist,
    settled: base.material.filter((k) => !base.open.includes(k) || answeredHere(k)),
    ready: asking.length === 0 && uncovered.length === 0,
  };
}

/**
 * What the category can say it already knows, in the client's language and short ("personas en el país: 60 personas"): the settled
 * aspects of the project that inform THIS category. It opens the thread as a continuation of the project, not as a fresh interview.
 */
export function knownLines(frame: Frame, categoryKey: string, max = 3): string[] {
  const loc = frame.locale;
  const depth = evaluateDepth(frame);
  const clip = (t: string): string => (t.length <= 70 ? t : `${t.slice(0, 70).replace(/\s+\S*$/, "").trimEnd()}…`);
  const out: string[] = [];
  const first = new Set(inheritedProbes(categoryKey));
  const relevant = depth.statuses.filter((s) => first.has(s.probe.key) || (DIMENSION_CATEGORIES[s.probe.dimension] ?? []).includes(categoryKey));
  relevant.sort((a, b) => Number(first.has(b.probe.key)) - Number(first.has(a.probe.key)) || a.probe.order - b.probe.order);
  for (const s of relevant) {
    const it = s.item;
    if (!it || (it.status !== "known" && it.status !== "undecided") || s.state === "conflict") continue;
    const display = it.display.trim();
    if (!display) continue;
    out.push(`${s.probe.label[loc].toLowerCase()}: ${clip(display.charAt(0).toLowerCase() + display.slice(1))}`);
    if (out.length >= max) break;
  }
  return out;
}

void PROBES;
