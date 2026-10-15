/**
 * Sufficiency — is the approved knowledge enough for the INFORMATION INTENT of the request?
 *
 *   SUFFICIENT   approved knowledge materially answers the information need asked;
 *   PARTIAL      useful approved knowledge exists, but a material part of what was asked stays unsupported;
 *   UNAVAILABLE  nothing approved can materially address it (decided by the caller: no usable unit).
 *
 * A neighbouring topic is welcome as CONTEXT, but it never makes the request sufficient when the thing asked for is still unanswered.
 * No keyword rules live here. Structural signals decide, all from controlled vocabularies that already govern the layer:
 *
 *   1. intent specificity — the question names a concrete subtopic ("mandatory benefits", "IMMEX regimes") or asks for a determinate
 *      fact (a requirement, a rate, a cost, a deadline, steps) => SPECIFIC; otherwise it is a BROAD ask for the picture of a theme;
 *   2. topic families — a BROAD ask is answered collectively by the units of its family (informality is a component of the labour-market
 *      picture); a SPECIFIC ask is never satisfied by a sibling topic;
 *   3. authority fit — an ask for a RULE (a requirement, a tax treatment) can only be answered directly by a unit whose source may ground
 *      obligations (official primary); analytical or curated context is never the rule, however closely it talks about the topic;
 *   4. subtopic evidence — for a SPECIFIC subtopic, a unit counts as direct only if it speaks to that subtopic in the same controlled
 *      vocabulary that classifies demand (so what is requested, what is answered and what is registered as unmet cannot drift apart).
 *      Unmatched wording errs on the side of PARTIAL, never on the side of over-claiming.
 */
import { textAddressesSubtopic, type InfoType } from "./demand";
import type { Topic } from "./types";

export type TopicFamily = "labor" | "trade" | "logistics_infrastructure" | "economy" | "fiscal" | "legal_institutional";

/** Which topics are components of the same picture. Exhaustive by type: a new topic cannot be added without choosing its family. */
export const TOPIC_FAMILY: Record<Topic, TopicFamily> = {
  labor_market: "labor", informality: "labor", wages: "labor", social_security: "labor", education_talent: "labor", immigration_mobility: "labor",
  exports_trade: "trade", customs: "trade",
  transportation_logistics: "logistics_infrastructure", infrastructure: "logistics_infrastructure", energy: "logistics_infrastructure",
  economy_innovation: "economy", economic_diversification: "economy", foreign_investment: "economy", financial_access: "economy", competitiveness_state: "economy",
  taxes: "fiscal",
  corporate_law: "legal_institutional", regulatory_environment: "legal_institutional", rule_of_law: "legal_institutional", government: "legal_institutional",
};

/** Asks for a determinate fact rather than for the picture of a theme. */
/** Asks whose answer is a RULE, not a description. */
const RULE_ASKS: ReadonlySet<InfoType> = new Set(["regulatory_requirement", "tax_treatment"]);
const DETERMINATE: ReadonlySet<InfoType> = new Set(["regulatory_requirement", "tax_treatment", "procedure_steps", "cost_estimate", "timeline", "local_provider_or_site"]);

export interface AskedIntent { topics: Topic[]; topic: Topic | "unclassified"; subtopic: string; infoType: InfoType }
export interface UnitEvidence { topics: Topic[]; text: string; /** The unit's source may ground legal / tax / regulatory obligations. */ groundsObligation: boolean }
export interface Sufficiency {
  /** The approved knowledge materially answers what was asked. */
  sufficient: boolean;
  /** Topics asked that remain materially unanswered. */
  missing: Topic[];
  /** Per unit: it addresses the asked thing itself (true) or is related context (false). */
  direct: boolean[];
}

export const isSpecific = (i: Pick<AskedIntent, "subtopic" | "infoType">): boolean => i.subtopic !== "general" || DETERMINATE.has(i.infoType);

export function assessSufficiency(intent: AskedIntent, units: UnitEvidence[]): Sufficiency {
  const primary = intent.topic === "unclassified" ? null : intent.topic;
  if (!primary) return { sufficient: true, missing: [], direct: units.map(() => true) };
  const specific = isSpecific(intent);
  const subtopic = intent.subtopic !== "general" ? intent.subtopic : null;

  // a broad ask is answered collectively by its family's units; a specific one only by units that speak to the thing itself
  const ruleAsk = RULE_ASKS.has(intent.infoType);
  const direct = units.map((u) => (specific
    ? u.topics.includes(primary) && (!ruleAsk || u.groundsObligation) && (!subtopic || textAddressesSubtopic(u.text, subtopic))
    : u.topics.some((t) => TOPIC_FAMILY[t] === TOPIC_FAMILY[primary])));
  const covered = new Set(units.flatMap((u) => u.topics));
  const asked = [...new Set([primary, ...intent.topics])];

  const missing: Topic[] = [];
  // the thing asked for itself: a specific ask needs direct evidence; a broad ask is answered by its family collectively
  const familyCovered = asked.some((t) => TOPIC_FAMILY[t] === TOPIC_FAMILY[primary] && covered.has(t));
  const primaryMet = specific ? direct.some(Boolean) : familyCovered;
  if (!primaryMet) missing.push(primary);
  // any other theme in the question (another family) must be covered on its own
  for (const fam of new Set(asked.map((t) => TOPIC_FAMILY[t]))) {
    if (fam === TOPIC_FAMILY[primary]) continue;
    const ofFam = asked.filter((t) => TOPIC_FAMILY[t] === fam);
    if (!ofFam.some((t) => covered.has(t))) missing.push(...ofFam);
  }
  return { sufficient: missing.length === 0, missing, direct };
}
